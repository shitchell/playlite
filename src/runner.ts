/**
 * Shared temp-wrapper generation and execution for `run` and `eval --lib`.
 *
 * Generates a temporary TypeScript wrapper that:
 *   1. Connects to the browser via CDP
 *   2. Selects a page (by tab filter)
 *   3. Loads any requested libs (calling their factories with the page)
 *   4. Makes page, browser, context, and lib exports available as local variables
 *   5. Executes the user's code with all those variables in scope
 *   6. Cleans up the browser connection
 *
 * The wrapper is executed via `tsx` in a child process, inheriting stdio so the
 * user's stdout/stderr flows through naturally.
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { findPlayliteDir, findTsconfig } from './config.js';

export interface RunnerOptions {
  /** CDP port number */
  port: number;
  /** Tab filter (index or title substring) */
  tab?: string;
  /** Lib names to load */
  libs: string[];
  /**
   * The user's code.
   * - When isFile is true: an absolute or relative path to a .ts file
   * - When isFile is false: raw TypeScript/JavaScript code to execute
   */
  code: string;
  /** If true, `code` is a file path; if false, it's inline code. */
  isFile: boolean;
}

/**
 * Split a script into import lines and body lines.
 *
 * This is a pragmatic heuristic — it handles the common cases:
 *   - `import ... from '...'`
 *   - `import '...'` (side-effect imports)
 *   - `import type ...`
 *   - Multi-line imports (lines with unmatched opening braces)
 *
 * Import lines get hoisted to the wrapper's top level (outside the IIFE) so
 * they remain valid ESM static imports. Everything else stays in the IIFE body.
 *
 * Note: `export` lines are NOT hoisted — they stay in the body. User scripts
 * are not expected to have exports, and hoisting them outside the IIFE would
 * break their scope references.
 */
function splitImports(source: string): { imports: string; body: string } {
  const lines = source.split('\n');
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  let inMultiLineImport = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inMultiLineImport) {
      importLines.push(line);
      // End of multi-line import when we see `from` or just a closing `}`
      if (trimmed.includes('from ') || trimmed.startsWith('}')) {
        inMultiLineImport = false;
      }
      continue;
    }

    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('import{')
    ) {
      importLines.push(line);
      // Check for multi-line import: has `{` but no `}` on the same line
      if (trimmed.includes('{') && !trimmed.includes('}')) {
        inMultiLineImport = true;
      }
    } else {
      bodyLines.push(line);
    }
  }

  return {
    imports: importLines.join('\n'),
    body: bodyLines.join('\n'),
  };
}

/**
 * Generate the page selection code snippet for the wrapper.
 * Inlined to avoid importing playlite modules into the subprocess.
 */
function generatePageSelection(tab?: string): string {
  if (tab !== undefined) {
    const asNumber = Number(tab);
    if (!isNaN(asNumber) && Number.isInteger(asNumber)) {
      return [
        `  if (__pages.length === 0) throw new Error('No pages found.');`,
        `  const __tabIdx = ${asNumber} - 1;`,
        `  if (__tabIdx < 0 || __tabIdx >= __pages.length) {`,
        `    throw new Error(\`Tab index ${asNumber} out of range. \${__pages.length} tab(s) available.\`);`,
        `  }`,
        `  const page = __pages[__tabIdx];`,
      ].join('\n');
    }
    // String filter
    return [
      `  if (__pages.length === 0) throw new Error('No pages found.');`,
      `  const __titles = await Promise.all(__pages.map(p => p.title()));`,
      `  const __lower = ${JSON.stringify(tab.toLowerCase())};`,
      `  const __matches = __pages.filter((_, i) => __titles[i].toLowerCase().includes(__lower));`,
      `  if (__matches.length === 0) throw new Error('No tab matching ${JSON.stringify(tab)}.');`,
      `  if (__matches.length > 1) throw new Error('Multiple tabs match ${JSON.stringify(tab)}. Be more specific.');`,
      `  const page = __matches[0];`,
    ].join('\n');
  }
  // No filter
  return [
    `  if (__pages.length === 0) throw new Error('No pages found.');`,
    `  if (__pages.length > 1) throw new Error('Multiple tabs open. Use --tab to select.');`,
    `  const page = __pages[0];`,
  ].join('\n');
}

/**
 * Generate lib-loading code that calls each lib factory and merges exports
 * onto globalThis so the user's code can reference them as bare identifiers.
 */
function generateLibLoading(libs: string[]): string {
  if (libs.length === 0) return '';

  const playliteDir = findPlayliteDir();
  const lines: string[] = [
    `  // Load libs`,
    `  const __mergedExports: Record<string, unknown> = {};`,
  ];

  for (const lib of libs) {
    const libPath = join(playliteDir, 'libs', `${lib}.ts`);
    const safeVar = `__lib_${lib.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    lines.push(
      `  const ${safeVar} = await import(${JSON.stringify(`file://${libPath}`)});`,
      `  if (typeof ${safeVar}.default !== 'function') {`,
      `    throw new Error('Lib \\'${lib}\\' must export a default function.');`,
      `  }`,
      `  Object.assign(__mergedExports, await ${safeVar}.default(page));`,
    );
  }

  // Assign exports to globalThis so they're accessible as bare identifiers
  // in the user's inlined code (e.g., `greeting` instead of `lib.greeting`).
  lines.push(
    `  Object.assign(globalThis, __mergedExports);`,
  );

  return lines.join('\n');
}

/**
 * Generate the complete wrapper source code.
 */
function generateWrapper(options: RunnerOptions): string {
  const { port, tab, libs, code, isFile } = options;

  // Get the user's source code
  let userSource: string;
  if (isFile) {
    const filePath = resolve(code);
    userSource = readFileSync(filePath, 'utf8');
  } else {
    userSource = code;
  }

  // Split imports from body
  const { imports: userImports, body: userBody } = splitImports(userSource);

  // Generate subsections
  const pageSelection = generatePageSelection(tab);
  const libLoading = generateLibLoading(libs);

  // Assemble the wrapper
  const parts: string[] = [
    `// Auto-generated playlite wrapper — deleted after execution`,
    `import { chromium } from 'playwright-core';`,
    `import type { Browser, BrowserContext, Page } from 'playwright-core';`,
  ];

  // Hoist user imports
  if (userImports.trim()) {
    parts.push(``, `// User imports (hoisted)`, userImports);
  }

  parts.push(
    ``,
    `(async () => {`,
    `  const browser = await chromium.connectOverCDP('http://localhost:${port}');`,
    `  const context = browser.contexts()[0];`,
    `  if (!context) throw new Error('Connected but no browser context found.');`,
    `  const __pages = context.pages();`,
    ``,
    pageSelection,
  );

  if (libLoading) {
    parts.push(``, libLoading);
  }

  parts.push(
    ``,
    `  try {`,
    `    // --- User code ---`,
  );

  // Indent user body inside the try block
  const indentedBody = userBody
    .split('\n')
    .map(line => (line.trim() ? `    ${line}` : line))
    .join('\n');
  parts.push(indentedBody);

  parts.push(
    `    // --- End user code ---`,
    `  } finally {`,
    `    await browser.close();`,
    `  }`,
    `})().catch((err: unknown) => {`,
    `  const msg = err instanceof Error ? err.message : String(err);`,
    `  console.error(msg);`,
    `  process.exit(1);`,
    `});`,
  );

  return parts.join('\n');
}

/**
 * Resolve the playlite package root directory.
 * import.meta.url points to src/runner.ts or dist/runner.js — go up two levels.
 */
function getPackageRoot(): string {
  const thisFile = new URL(import.meta.url).pathname;
  return dirname(dirname(thisFile));
}

/**
 * Resolve the path to the tsx binary.
 *
 * Looks for it in the playlite package's own node_modules first (reliable
 * when playlite is installed globally or via npx), then falls back to
 * looking in the current project's node_modules, then PATH.
 */
function findTsxBin(): string {
  const packageRoot = getPackageRoot();
  const candidates = [
    join(packageRoot, 'node_modules', '.bin', 'tsx'),
    join(process.cwd(), 'node_modules', '.bin', 'tsx'),
  ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      continue;
    }
  }

  // Last resort: hope it's on PATH
  return 'tsx';
}

/**
 * Execute user code via a temporary tsx wrapper.
 *
 * Generates the wrapper, writes it to a temp file, runs it with tsx,
 * and cleans up afterward. Throws on non-zero exit.
 */
export function executeWrapper(options: RunnerOptions): void {
  const wrapperCode = generateWrapper(options);

  // Write the temp file inside the playlite package directory so that tsx
  // resolves `playwright-core` and other dependencies from the package's own
  // node_modules (tsx resolves relative to the executing file, not cwd).
  const packageRoot = getPackageRoot();
  const tempDir = join(packageRoot, '.tmp');
  mkdirSync(tempDir, { recursive: true });
  const tempFile = join(tempDir, `wrapper-${randomBytes(8).toString('hex')}.ts`);

  try {
    writeFileSync(tempFile, wrapperCode, 'utf8');

    // Find tsx binary
    const tsxBin = findTsxBin();

    // Find the host project's tsconfig for path alias resolution
    const tsconfigArgs: string[] = [];
    try {
      const playliteDir = findPlayliteDir();
      const tsconfig = findTsconfig(dirname(playliteDir));
      if (tsconfig) {
        tsconfigArgs.push('--tsconfig', tsconfig);
      }
    } catch {
      // No .playlite dir — that's fine, skip tsconfig
    }

    // Execute the wrapper with tsx, inheriting stdio for pass-through.
    // cwd is set to the playlite package root so that `playwright-core` and
    // other dependencies resolve from playlite's own node_modules.
    try {
      execFileSync(tsxBin, [...tsconfigArgs, tempFile], {
        stdio: 'inherit',
        cwd: getPackageRoot(),
        env: { ...process.env },
      });
    } catch (err: unknown) {
      // tsx already printed the error via inherited stderr.
      // Exit with the subprocess's code rather than propagating the ChildProcessError.
      const code = (err as NodeJS.ErrnoException & { status?: number }).status ?? 1;
      process.exit(code);
    }
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempFile);
    } catch {
      // Best effort cleanup
    }
  }
}
