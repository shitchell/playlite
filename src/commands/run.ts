/**
 * `playlite run [script.ts]` — execute a TypeScript file with browser and lib
 * helpers injected into scope.
 *
 * Generates a temp wrapper that connects to the browser, loads any --lib libs,
 * and inlines the user's script code so that `page`, `browser`, `context`, and
 * all lib exports are available as local variables. Executed via tsx.
 *
 * When script is `-` or omitted and stdin is not a TTY, reads code from stdin.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePort } from '../config.js';
import { executeWrapper } from '../runner.js';

export interface RunOptions {
  port: string;
  session?: string;
  wasPortGiven?: boolean;
  tab?: string;
  lib?: string[];
}

/**
 * Read all of stdin synchronously and return it as a string.
 * Works for piped input and heredocs.
 */
function readStdin(): string {
  return readFileSync(0, 'utf8');
}

export async function run(script: string | undefined, options: RunOptions): Promise<void> {
  const port = resolvePort(options);

  // Determine whether we're reading from stdin or a file.
  const useStdin = script === '-' || (script === undefined && !process.stdin.isTTY);

  if (useStdin) {
    let code: string;
    try {
      code = readStdin();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to read from stdin: ${message}`);
      process.exit(1);
    }

    executeWrapper({
      port,
      tab: options.tab,
      libs: options.lib ?? [],
      code,
      isFile: false,
    });
    return;
  }

  if (script === undefined) {
    console.error('No script specified. Provide a script path, pass - to read from stdin, or pipe code via stdin.');
    process.exit(1);
  }

  const scriptPath = resolve(script);
  if (!existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  executeWrapper({
    port,
    tab: options.tab,
    libs: options.lib ?? [],
    code: scriptPath,
    isFile: true,
  });
}
