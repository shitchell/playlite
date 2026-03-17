# playlite -- Architecture & Contributor Guide

How the codebase is structured, key design decisions, and how to extend it.

---

## Directory Structure

```
playlite/
  src/
    cli.ts              # Entry point: commander setup, subcommand routing
    browser.ts          # Browser connection (CDP) and page/tab selection
    config.ts           # .playlite/ directory discovery, tsconfig finding, config loading (scaffolded)
    libs.ts             # Lib factory loading and merging
    loader.ts           # TypeScript dynamic import via tsx (tsImport)
    runner.ts           # Temp-wrapper generation and execution for run/eval --lib
    commands/
      connect.ts        # `playlite connect` -- health check
      eval.ts           # `playlite eval` -- browser or Node context eval
      launch.ts         # `playlite launch` -- start a new Chromium
      navigate.ts       # `playlite navigate` -- go to URL
      run.ts            # `playlite run` -- execute a TypeScript file
      screenshot.ts     # `playlite screenshot` -- capture page as PNG
      tabs.ts           # `playlite tabs` -- list open tabs
      url.ts            # `playlite url` -- print page URL
  examples/
    libs/greeter.ts     # Minimal example lib
    scripts/hello.ts    # Minimal example script
  docs/
    usage.md            # Full usage reference
    architecture.md     # This file
    design.md           # Original design document (historical)
    plan.md             # Original implementation plan (historical)
  dist/                 # Compiled JS output (gitignored)
  .tmp/                 # Temp wrapper files during execution (gitignored)
```

---

## How a Command Runs

Every playlite command follows the same lifecycle:

### Simple commands (tabs, connect, url, navigate, screenshot, eval without --lib)

```
cli.ts (commander)
  -> command handler (e.g., commands/screenshot.ts)
    -> connectToBrowser(port)     [browser.ts]
    -> selectPage(pages, filter)  [browser.ts]
    -> perform action (screenshot, navigate, evaluate, etc.)
    -> browser.close()
```

These commands run in-process. They connect to the browser via Playwright's `connectOverCDP()`, perform a single action, and disconnect. The browser keeps running -- only the Playwright connection is closed.

### Script execution (run, eval --lib)

```
cli.ts (commander)
  -> command handler (commands/run.ts or commands/eval.ts)
    -> executeWrapper(options)    [runner.ts]
      -> generateWrapper()        [runner.ts]
        -> read user script (if file or stdin)
        -> splitImports()         (hoist imports out of IIFE)
        -> generatePageSelection() (inline tab selection logic)
        -> generateLibLoading()   (inline lib import + factory calls)
        -> inject __name polyfill into browser page context
        -> assemble complete .ts wrapper file
      -> write wrapper to .tmp/wrapper-<random>.ts
      -> find tsx binary
      -> find host project's tsconfig.json
      -> generate temp tsconfig.json extending host tsconfig (ESM overrides)
      -> execFileSync(tsx, [--tsconfig, tempTsconfig, wrapper.ts],
                      { cwd: projectRoot })   (CWD = parent of .playlite/)
      -> clean up temp files
```

This is fundamentally different: the user's code does NOT run in the playlite process. Instead, playlite generates a self-contained TypeScript file and executes it in a fresh `tsx` subprocess. This is the "temp wrapper" approach described below.

---

## Key Design Decisions

### The Temp Wrapper Approach (runner.ts)

The most architecturally significant decision. When `playlite run script.ts` is invoked:

1. playlite reads the user's script (from file or stdin)
2. It generates a temporary `.ts` file that:
   - Imports `playwright-core`
   - Connects to the browser via CDP
   - Selects the correct page (tab)
   - Injects a `__name` polyfill into the browser page context (see below)
   - Dynamically imports and calls lib factory functions
   - Assigns lib exports to `globalThis`
   - Runs the user's code inside a `try/finally` block
   - Closes the browser connection in `finally`
3. It generates a temporary `tsconfig.json` that extends the host project's tsconfig with ESM-compatible overrides (see Wrapper tsconfig below)
4. It executes this wrapper via `tsx` with the temp tsconfig, with CWD set to the project root
5. It deletes both temp files

**Why not run in-process?** Several reasons:

- **Loader isolation.** tsx's TypeScript loader needs to be registered at process startup to handle `.ts` imports. Libs import from the host project (e.g., `@apps/myapp/Helper`), which means the host project's tsconfig paths must be active. Doing this in the playlite process itself would require loader registration before any imports, which is fragile.

- **Dependency isolation.** The temp wrapper runs in a fresh process where `playwright-core` resolves from playlite's own `node_modules`, but lib imports resolve from the host project via tsx's tsconfig support. This clean separation avoids version conflicts.

- **Simplicity.** Generating a self-contained `.ts` file is straightforward to debug -- you can read the temp file to see exactly what's being executed. The alternative (Node's `vm` module or dynamic import hooks) is significantly more complex.

**The temp file lives in `.tmp/` inside the playlite package directory** (not the host project). This ensures `playwright-core` resolves correctly from playlite's node_modules.

### Wrapper tsconfig

Host projects often use `"module": "commonjs"` in their tsconfig, which conflicts with the ESM imports required by the generated wrapper. The runner writes a second temp file — a `tsconfig` that `extends` the host project's tsconfig and overrides just the module-related settings:

```json
{
  "extends": "/path/to/host/tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

This lets the wrapper use ESM-compatible syntax while still inheriting all path aliases, `baseUrl`, and other settings from the host tsconfig.

### `__name` polyfill

esbuild (used by tsx) applies a `keepNames` transform that rewrites function declarations as:

```typescript
const myFn = __name(function myFn() { ... }, "myFn");
```

When Playwright serializes a function passed to `page.evaluate()`, it does not know about the `__name` helper, causing a `ReferenceError: __name is not defined` inside the browser. The runner injects a no-op polyfill into the page context before running any user code:

```typescript
await page.addInitScript(() => {
  (globalThis as any).__name = (fn: unknown) => fn;
});
```

This is automatic and transparent — users never need to think about it.

### CWD during script execution

The `tsx` subprocess is started with `cwd` set to the project root (the parent directory of `.playlite/`), not to the directory where `playlite run` was invoked. This ensures that relative path resolution and environment-loading tools (e.g., `dotenv.config()`) find the correct files regardless of which subdirectory the user ran playlite from.

### Import Hoisting (splitImports in runner.ts)

User scripts can contain `import` statements. Since the user's code is placed inside an async IIFE (for top-level await support), static imports must be extracted and placed at the top of the generated wrapper file. The `splitImports()` function handles this by:

1. Scanning for lines starting with `import`
2. Handling multi-line imports (opening `{` without closing `}`)
3. Moving them before the IIFE
4. Leaving everything else inside the IIFE body

This is a pragmatic heuristic, not a full parser. It handles standard import patterns but could be confused by unusual formatting.

### Two Execution Modes for eval

`playlite eval` has a critical behavioral split:

- **Without `--lib`:** Runs in the browser via `page.evaluate(code)`. The code string is sent to the browser and executed in the browser's JS context. This is equivalent to typing in the browser console. No access to Node.js APIs, Playwright APIs, or lib helpers.

- **With `--lib`:** Runs in a Node.js subprocess via the temp wrapper (same as `run`). The code has access to Playwright's `page` object, lib helpers, and Node.js APIs. It talks to the browser through Playwright, not directly in the browser.

This dual behavior is intentional. Sometimes you want raw browser JS (DOM inspection, ExtJS widget queries). Sometimes you want your Playwright helpers. The `--lib` flag switches between these modes.

### tsx for TypeScript (loader.ts)

playlite uses [tsx](https://github.com/privatenumber/tsx) in two ways:

1. **`tsImport()` (programmatic API)** -- Used by `libs.ts` and `config.ts` to dynamically import `.ts` files in the playlite process. This is the `tsx/esm/api` export, which registers a loader scoped to a single import chain. Used for loading `.playlite/config.ts` and `.playlite/libs/*.ts` in simple commands.

2. **`tsx` binary (subprocess)** -- Used by `runner.ts` to execute the generated temp wrapper. This gives the subprocess full TypeScript support with the host project's tsconfig paths.

The `findTsxBin()` function in `runner.ts` searches for tsx in order:
1. playlite's own `node_modules/.bin/tsx`
2. The current project's `node_modules/.bin/tsx`
3. Falls back to `tsx` on PATH

### Configuration

`config.ts` exports a `loadConfig()` function that reads `.playlite/config.ts`. It is called at startup in `cli.ts` before commander parses options, and its values are used to set commander defaults dynamically. The supported fields are `port`, `profile`, `url`, `args`, and `libs`.

The `libs` field is the most impactful: config libs are prepended to any `--lib` flags given on the command line, so projects can set their standard lib(s) once in config and skip `--lib` on every invocation.

### .playlite/ Directory Walk

The `.playlite/` directory and `tsconfig.json` are found by walking up from CWD to the filesystem root, checking for the target at each level. This mirrors how git finds `.git/`:

```
/home/user/project/src/tests/   <-- CWD, no .playlite/
/home/user/project/src/         <-- no .playlite/
/home/user/project/             <-- .playlite/ found!
```

This is implemented in `findPlayliteDir()` in `config.ts`. The `findTsconfig()` function uses the same walk-up pattern to find the nearest `tsconfig.json`.

### Lib Loading as globalThis Assignment

When libs are loaded in the temp wrapper, their exports are assigned to `globalThis`:

```typescript
const __lib_myapp = await import('file:///path/to/.playlite/libs/myapp.ts');
Object.assign(__mergedExports, await __lib_myapp.default(page));
Object.assign(globalThis, __mergedExports);
```

This allows user code to reference lib exports as bare identifiers (`greeting` instead of `libs.greeting`). The tradeoff is that lib exports share the global namespace, which is why name collision warnings exist.

---

## How to Add a New Command

1. **Create the command file:** `src/commands/mycommand.ts`

```typescript
import { connectToBrowser, selectPage } from '../browser.js';

export interface MyCommandOptions {
  port: string;
  tab?: string;
}

export async function myCommand(options: MyCommandOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }

  const { browser, context } = await connectToBrowser(port);
  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);

    // Do your thing with `page`

  } finally {
    await browser.close();
  }
}
```

2. **Wire it into cli.ts:**

```typescript
import { myCommand } from './commands/mycommand.js';

program
  .command('mycommand')
  .description('Does the thing')
  .option('--port <n>', 'CDP port', '9222')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .action(async (options) => {
    await myCommand(options);
  });
```

3. **Build and test:** `npm run build && node dist/cli.js mycommand`

**Patterns to follow:**

- Parse and validate `--port` early (NaN guard)
- Always close the browser connection in a `finally` block
- Data to stdout, status to stderr
- Actionable error messages (tell the user what to do, not just what went wrong)
- The `--port` default is always `'9222'` (as a string, parsed with `parseInt`)

---

## Module Dependency Graph

```
cli.ts
  |-- commands/connect.ts  --> browser.ts
  |-- commands/tabs.ts     --> browser.ts
  |-- commands/url.ts      --> browser.ts
  |-- commands/navigate.ts --> browser.ts
  |-- commands/screenshot.ts -> browser.ts
  |-- commands/eval.ts     --> browser.ts, runner.ts
  |-- commands/run.ts      --> runner.ts
  |-- commands/launch.ts   (standalone, uses playwright-core directly)

browser.ts    (playwright-core connection + page selection)
config.ts     --> loader.ts  (.playlite/ discovery, config loading)
libs.ts       --> config.ts, loader.ts  (lib factory loading)
loader.ts     (tsx/esm/api wrapper)
runner.ts     --> config.ts  (temp wrapper generation + execution)
```

Note that `runner.ts` does NOT depend on `browser.ts` or `libs.ts`. The generated temp wrapper contains its own inline browser connection, page selection, and lib loading code. This is intentional -- the subprocess must be self-contained.

---

## Build and Development

```bash
# Build (TypeScript -> dist/)
npm run build

# Run from source (without building)
npx tsx src/cli.ts tabs

# Test against a live browser
google-chrome --remote-debugging-port=9222 &
node dist/cli.js connect
node dist/cli.js tabs
node dist/cli.js screenshot /tmp/test.png
```

The compiled output goes to `dist/` and the `bin` entry in `package.json` points to `dist/cli.js`. After a global install (`npm install -g`), the `playlite` command runs the compiled version.

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Matches the test codebases playlite debugs |
| Runtime | Node.js 18+ | ESM support, stable `fs`, `child_process` |
| Browser automation | `playwright-core` | No bundled browser downloads. Uses the system's Chromium. |
| TS compilation | `tsx` | Fast, supports tsconfig paths, both programmatic and CLI use |
| CLI framework | `commander` | Lightweight, well-known, handles subcommands and option parsing |
| Package manager | npm | Standard, no extra tooling |

---

## Non-Goals

These are intentional omissions, not TODOs:

- **Not a REPL.** No interactive mode. The primary user (AI agents) sends commands, not keystrokes.
- **Not a test runner.** Use Playwright for that. playlite is for debugging.
- **Not a recorder.** No codegen. Scripts are written by the user or AI agent.
- **Not browser-specific.** Uses `playwright-core` so it works with whatever Chromium the user has.
- **Not a CDP wrapper.** playlite uses Playwright's API, not raw CDP. The browser-context `eval` (without `--lib`) is the only thing that touches the page directly.
