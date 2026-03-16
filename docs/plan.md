# playlite -- Implementation Plan

> **Historical document.** This was the implementation plan used to build playlite.
> All seven chunks have been completed. The plan is preserved here for reference on
> the order of implementation and the rationale behind the chunk boundaries.
> For current documentation, see [usage.md](usage.md) and [architecture.md](architecture.md).

---

## Prerequisites

Read `docs/design.md` in full before starting any chunk. The design doc is the
source of truth for behavior, CLI syntax, and architecture decisions.

## Chunk 1: Project Scaffolding

**Goal:** Empty but buildable TypeScript project with CLI entry point.

### Steps

1. Initialize npm project:
   ```bash
   npm init -y
   ```
   Set `name: "playlite"`, `type: "module"`, `bin: { "playlite": "./dist/cli.js" }`

2. Install dependencies:
   ```bash
   npm install playwright-core commander
   npm install -D typescript @types/node tsx
   ```
   - `playwright-core` (not `playwright`) — no bundled browsers
   - `commander` — CLI arg parsing (lightweight, well-known)
   - `tsx` — on-the-fly TS compilation for `playlite run`

3. Create `tsconfig.json`:
   - `target: "ES2022"`, `module: "Node16"`, `moduleResolution: "Node16"`
   - `outDir: "dist"`, `rootDir: "src"`
   - `strict: true`

4. Create directory structure:
   ```
   src/
     cli.ts              # Entry point — commander setup, subcommand routing
     commands/            # One file per command
     browser.ts           # Browser connection/page selection logic
     libs.ts              # Lib loading logic
     config.ts            # .playlite/ config resolution
   ```

5. Create `src/cli.ts` with commander skeleton — all subcommands defined but
   stubbed with `console.log('not implemented')`.

6. Verify: `npx tsc && node dist/cli.js --help` prints usage.

### Acceptance

- `npm run build` succeeds
- `node dist/cli.js --help` shows all subcommands
- `node dist/cli.js tabs` prints "not implemented" (stub)

---

## Chunk 2: Browser Connection + Tab Selection

**Goal:** `playlite tabs`, `playlite connect`, `playlite url` working against a
live browser.

### Steps

1. Implement `src/browser.ts`:
   - `connectToBrowser(port: number)` — wraps `chromium.connectOverCDP()`
   - `selectPage(pages, tabFilter?)` — implements tab selection logic:
     - 1 page, no filter → return it
     - `--tab <number>` → match by index in pages array
     - `--tab <string>` → case-insensitive title substring match
     - Multiple pages, no filter → throw with tab list
   - `listTabs(pages)` — returns formatted tab list

2. Implement `src/commands/tabs.ts`:
   - Connect to browser, list all pages
   - Output: `<index>: <title> (<url>)` per line
   - `--json` flag for JSON output

3. Implement `src/commands/connect.ts`:
   - Connect to browser, print tab count
   - Exit 0 on success, 1 on failure

4. Implement `src/commands/url.ts`:
   - Connect, select page, print URL

5. Wire commands into `src/cli.ts`.

### Testing

- Start a Chrome with `--remote-debugging-port=9222`
- `playlite tabs` lists pages
- `playlite connect` prints success
- `playlite url --tab "Asset"` prints URL for matching tab
- Error case: multiple tabs without `--tab` shows helpful error

### Acceptance

- All three commands work against a live browser
- Tab selection logic handles all four cases from design doc
- Clean error messages on connection failure

---

## Chunk 3: Screenshot + Navigate + Eval

**Goal:** The three "simple action" commands that replace `cdp`.

### Steps

1. Implement `src/commands/screenshot.ts`:
   - Connect, select page
   - `page.screenshot({ path, fullPage })`
   - If no path, generate temp path and print it
   - Print confirmation to stderr, path to stdout (for piping)

2. Implement `src/commands/navigate.ts`:
   - Connect, select page
   - `page.goto(url, { waitUntil: 'domcontentloaded' })`
   - Print confirmation

3. Implement `src/commands/eval.ts`:
   - Connect, select page
   - `page.evaluate(code)` — runs in browser context
   - Print result (JSON.stringify for objects, raw for strings/numbers)
   - Handle errors gracefully

4. Wire into CLI.

### Testing

- `playlite screenshot /tmp/test.png` saves a valid PNG
- `playlite navigate "https://example.com"` changes the page
- `playlite eval "document.title"` returns the title string
- `playlite eval "({a: 1, b: 2})"` returns JSON

### Acceptance

- All three commands work
- `eval` without `--lib` runs in browser context (like `cdp eval`)
- Screenshot handles both path and no-path cases

---

## Chunk 4: Config Resolution + Lib Loading

**Goal:** `.playlite/` directory discovery and lib factory execution.

### Steps

1. Implement `src/config.ts`:
   - `findPlayliteDir(startDir?)` — walk up from CWD looking for `.playlite/`
   - `loadConfig()` — read `.playlite/config.ts` if it exists, return defaults
     otherwise
   - Config shape: `{ port, profile, url, args }`

2. Implement `src/libs.ts`:
   - `loadLib(name, page)`:
     1. Resolve `name` → `.playlite/libs/<name>.ts`
     2. Compile with `tsx` (use `tsx` loader or `tsImport` from `tsx` package)
     3. Call default export with `page`
     4. Return the resulting object (named helpers)
   - `loadLibs(names[], page)` — load multiple, merge results (last wins on
     collision, warn on stderr)
   - Must resolve the host project's `tsconfig.json` paths so that lib files
     can use aliases like `@apps/`, `@core/`, etc.

3. Wire `--lib` flag into `eval` command:
   - With `--lib`: run code in Node context (not browser), with helpers in scope
   - Without `--lib`: run code in browser context via `page.evaluate()`
   - This distinction is critical — document it in `--help`

### Key Detail: tsconfig Path Resolution

Lib files live in `.playlite/libs/` but import from the host project (e.g.,
`@apps/asset-suite/AssetSuiteApp`). The host project's `tsconfig.json` defines
these paths. playlite must:

1. Find the nearest `tsconfig.json` (from `.playlite/` directory, walk up)
2. Pass its `paths` and `baseUrl` to the TS compiler when loading libs
3. `tsx` supports this via `--tsconfig` flag or `TSX_TSCONFIG_PATH` env var

### Testing

- Create a test `.playlite/libs/test-lib.ts` that returns `{ greeting: "hello" }`
- `playlite eval --lib test-lib "greeting"` returns "hello"
- Missing lib name → clear error
- Missing `.playlite/` directory → clear error

### Acceptance

- `.playlite/` discovery works from nested directories
- Libs load and their exports are available in script scope
- Host project path aliases resolve correctly
- `--lib` flag works on `eval` command

---

## Chunk 5: Script Runner (`playlite run`)

**Goal:** The main feature — run TypeScript files with libs injected.

### Steps

1. Implement `src/commands/run.ts`:
   - Read the script file
   - Connect to browser, select page
   - Load any `--lib` libs
   - Wrap script in async IIFE with injected scope:
     ```typescript
     const __run = async ({ page, browser, context, ...libs }) => {
       // --- user script contents ---
     };
     ```
   - Compile and execute via `tsx`
   - Capture stdout/stderr, forward to parent process

2. Implementation approach for script wrapping:
   - Generate a temporary `.ts` file that:
     1. Imports playwright-core
     2. Connects to the browser (port passed as env var)
     3. Loads libs (lib paths passed as env var or inline)
     4. Runs the user's script code in an async context
   - Execute with `tsx <temp-file.ts>`
   - Clean up temp file after execution

3. Alternative approach (may be simpler):
   - Use Node's `vm` module or dynamic `import()` with `tsx` loader
   - This avoids temp files but is trickier with TypeScript
   - Recommend starting with temp file approach — simpler to debug

### Testing

- Write a simple script that logs `page.url()`
- `playlite run script.ts` outputs the URL
- Write a script using `--lib` helpers
- `playlite run --lib asset-suite debug.ts` runs AS helper methods
- Script errors propagate clearly (line numbers, stack traces)

### Acceptance

- Scripts run with top-level `await`
- Lib helpers are available in script scope
- Console output from scripts appears in terminal
- TypeScript compilation errors are clear
- Host project path aliases work in scripts

---

## Chunk 6: Browser Launch

**Goal:** `playlite launch` to start a fresh browser.

### Steps

1. Implement `src/commands/launch.ts`:
   - `chromium.launchPersistentContext(profileDir, { ... })`
   - `--port` — enable CDP on this port (via `--remote-debugging-port` arg)
   - `--profile` — profile directory (default from config or temp)
   - `--headless` flag
   - `--url` — navigate after launch
   - Print port and profile path to stdout
   - Keep process running (browser stays open until Ctrl+C)

2. Wire into CLI.

### Testing

- `playlite launch` opens a browser window
- `playlite tabs` (in another terminal) sees the launched browser
- `playlite launch --url "https://example.com"` opens to that URL
- Ctrl+C closes the browser

### Acceptance

- Browser launches and stays open
- Other playlite commands can connect to it
- Profile directory persists between launches

---

## Chunk 7: Polish + Documentation

**Goal:** README, error messages, edge cases.

### Steps

1. Write `README.md`:
   - Quick start (install, connect, run a script)
   - Command reference (one section per command)
   - Lib authoring guide
   - Integration with Playwright tests (PAUSE_ON_FAIL pattern)

2. Error message review:
   - Connection refused → "No browser found on port 9222. Launch one with: playlite launch"
   - No `.playlite/` dir → "No .playlite/ directory found. Create one with: mkdir .playlite"
   - Lib not found → "Lib 'foo' not found. Available libs: asset-suite, helix"
   - Tab ambiguity → list tabs with hint

3. Add `--version` flag (reads from package.json)

4. Add `--quiet` / `--verbose` flags for controlling output

5. Create `.playlite/` example directory in repo for reference

### Acceptance

- README covers all commands with examples
- All error paths produce actionable messages
- `npx playlite --help` is useful
- Example `.playlite/` directory demonstrates the lib pattern

---

## Dependency Graph

```
Chunk 1 (scaffolding)
  |
  v
Chunk 2 (browser + tabs)
  |
  +---> Chunk 3 (screenshot + eval + navigate)
  |
  +---> Chunk 4 (config + libs)
          |
          v
        Chunk 5 (script runner)  -- depends on both Chunk 3 and Chunk 4
          |
          v
        Chunk 6 (browser launch)
          |
          v
        Chunk 7 (polish + docs)
```

Chunks 3 and 4 can be built in parallel after Chunk 2.

## Notes for Implementing Agents

- **Read `docs/design.md` first.** It has the full spec for every command,
  tab selection logic, lib loading, and non-goals.
- **Use `playwright-core`, not `playwright`.** We don't want to download browsers.
- **Keep it simple.** This is a debugging tool, not a framework. Minimal
  abstractions, clear error messages, predictable behavior.
- **Test against a real browser.** Start Chrome with
  `google-chrome --remote-debugging-port=9222` and verify each command works.
- **The lib system is the hardest part.** Getting TypeScript compilation with
  path alias resolution right is the main technical challenge. Focus Chunk 4
  on getting this solid before moving to Chunk 5.
