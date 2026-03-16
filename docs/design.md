# playlite — Design Document

## What This Is

A CLI tool for AI agents (and power users) to interact with live browsers using
Playwright, with full access to project-specific helper libraries. Think of it as
`cdp` (Chrome DevTools Protocol CLI) but with Playwright's locator engine and
the ability to load your test helper code.

**Primary user:** AI coding agents (Claude Code, etc.) debugging browser-based
test failures. Not a REPL. Not a GUI. A scriptable CLI that runs TypeScript
snippets against live browsers.

## Why

When debugging Playwright test failures, there are two disconnected worlds:

1. **CDP tools** — connect to a live browser, run raw JS, take screenshots. No
   access to your test helper library. Every command is a one-off JS string.

2. **Playwright tests** — full access to helpers (locators, app-specific methods),
   but the browser closes on failure. You get a screenshot and a stack trace.

The gap: you can't run your helper code against a live browser. `playlite` bridges
this by connecting Playwright to an existing browser and injecting your helper
libraries into the execution scope.

**The killer feature:** debugging scripts are directly copy-pasteable into tests.
Zero translation between "debug mode" and "test mode."

## Architecture

```
playlite CLI
  |
  |-- connect to browser (CDP endpoint or launch new)
  |-- find/select target page (tab)
  |-- load libs (project-specific helper factories)
  |-- execute command:
  |     run <script.ts>     -- compile + run TS with libs in scope
  |     eval "<js>"         -- raw JS eval in page context
  |     screenshot [path]   -- capture current page
  |     tabs                -- list open tabs
  |     url                 -- print current page URL
  |     navigate <url>      -- go to URL
  |     launch              -- start a new browser
  |
  `-- output results to stdout/stderr
```

### Browser Connection

playlite connects to browsers via Playwright's `connectOverCDP()`:

```typescript
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const context = browser.contexts()[0];
const page = selectPage(context.pages(), tabFilter);
```

This works with any Chromium browser that has `--remote-debugging-port` enabled.
The browser can be:
- Left open by a failed Playwright test (`PAUSE_ON_FAIL=1`)
- Launched manually
- Launched by `playlite launch`

### Lib System

The `--lib` flag loads project-specific helper libraries. Libs are defined in
`.playlite/libs/` as TypeScript files that export a factory function:

```typescript
// .playlite/libs/asset-suite.ts
import { chromium, Page } from 'playwright';
import { WebTestDevice } from '@platforms/WebTestDevice';
import { AssetSuiteApp } from '@apps/asset-suite/AssetSuiteApp';
import { Table, Row, Cell } from '@apps/asset-suite/grid';

export default async function (page: Page) {
  const asDevice = new WebTestDevice(page);
  const as = new AssetSuiteApp(asDevice, {
    username: process.env.AS_USER || 'KATST',
    password: process.env.AS_PASS || 'Katalon2021!',
  });
  return { as, asDevice, Table, Row, Cell };
}
```

When `--lib asset-suite` is passed:
1. Resolve `asset-suite` → `.playlite/libs/asset-suite.ts`
2. Compile and import the module
3. Call the default export with the current `page`
4. Spread the returned object into the script's execution scope

Multiple `--lib` flags are supported. Name collisions are last-wins.

The `.playlite/` directory is searched for starting from CWD and walking up to
the filesystem root (same as `.git/` resolution). This allows a monorepo to have
one `.playlite/` at the root, or each sub-project to have its own.

### Script Execution

`playlite run <script.ts>` compiles TypeScript on the fly using `tsx` (or
`esbuild` as fallback). The script gets these globals injected:

```typescript
// Always available:
declare const page: import('playwright').Page;
declare const browser: import('playwright').Browser;
declare const context: import('playwright').BrowserContext;

// From --lib flags:
// Whatever the lib factory returns, e.g.:
declare const as: AssetSuiteApp;
declare const asDevice: TestDevice;
declare const Table: typeof Table;
```

The script is wrapped in an async IIFE so top-level `await` works:

```typescript
// User writes:
await as.searchAndNavigate('M106');
console.log(await as.getFieldValue('Work Status'));

// playlite wraps as:
(async () => {
  const { page, browser, context } = __playlite_context__;
  const { as, asDevice, Table } = __playlite_libs__;
  // --- user script ---
  await as.searchAndNavigate('M106');
  console.log(await as.getFieldValue('Work Status'));
})();
```

### Path Alias Resolution

Scripts may use the same TypeScript path aliases as the host project (e.g.,
`@apps/`, `@core/`, `@selectors/`). playlite reads the nearest `tsconfig.json`
and passes its `paths` config to the TypeScript compiler. This means lib files
and scripts can use the same imports as test files.

## Commands

### `playlite tabs`

List open tabs in the connected browser.

```
$ playlite tabs
  1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
  8: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)
```

Output format: `<id>: <title> (<url>)`

Options:
- `--port <n>` — CDP port (default: 9222)
- `--json` — JSON output

### `playlite screenshot [path]`

Capture the current page as a PNG.

```
$ playlite screenshot /tmp/m106.png
Screenshot saved to /tmp/m106.png
```

If no path is given, saves to a temp file and prints the path.

Options:
- `--port <n>` — CDP port
- `--tab <filter>` — Tab title substring or numeric ID
- `--full` — Full page screenshot (not just viewport)

### `playlite eval "<js>"`

Evaluate raw JavaScript in the page context. Equivalent to `page.evaluate()`.

```
$ playlite eval "document.title"
Asset Suite

$ playlite eval --lib asset-suite "await as.getFieldValue('Work Status')"
OPEN
```

Without `--lib`, this is a raw `page.evaluate()` (like `cdp eval`).
With `--lib`, the JS string runs in Node context with helpers available —
NOT in the browser. For browser-context eval, omit `--lib`.

Options:
- `--port <n>` — CDP port
- `--tab <filter>` — Tab filter
- `--lib <name>` — Load lib(s) into scope
- `--json` — Force JSON output

### `playlite run <script.ts>`

Run a TypeScript file with helpers injected into scope.

```
$ playlite run --lib asset-suite scripts/debug-m106.ts
[AS] M106 columns: ["Catalog ID","Q","Quantity","Duration","Need From Date"]
[AS] M106 rows: 2
M106 grid data: [{"Catalog ID":"0000000047","Q":"0",...}]
```

Options:
- `--port <n>` — CDP port
- `--tab <filter>` — Tab filter
- `--lib <name>` — Load lib(s) (repeatable)

### `playlite url`

Print the current page's URL.

```
$ playlite url
https://testops-as.trinoor.com:8443/as/ui/
```

Options:
- `--port <n>`, `--tab <filter>`

### `playlite navigate <url>`

Navigate the current page to a URL.

```
$ playlite navigate "https://testops-as.trinoor.com:8443/as/ui/"
Navigated to https://testops-as.trinoor.com:8443/as/ui/
```

Options:
- `--port <n>`, `--tab <filter>`

### `playlite launch`

Launch a new Chromium browser with remote debugging enabled.

```
$ playlite launch
Launched browser on port 9222
Profile: /tmp/playlite-profile-abc123
```

Options:
- `--port <n>` — CDP port (default: 9222)
- `--profile <path>` — Browser profile directory
- `--headless` — Launch headless (default: headed)
- `--url <url>` — Navigate to URL after launch

### `playlite connect [port]`

Test connectivity to a running browser. Prints tab count and confirms connection.
Mostly useful as a health check.

```
$ playlite connect 9222
Connected to browser on port 9222 (2 tabs)
```

## Tab Selection Logic

1. If only one page exists → auto-select it
2. If `--tab` is a number → match by CDP target ID
3. If `--tab` is a string → match by title substring (case-insensitive)
4. If multiple pages and no `--tab` → error with tab list

```
Error: Multiple tabs open. Use --tab to select:
  1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
  8: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)
```

## Configuration

### `.playlite/config.ts`

Optional project-level config:

```typescript
export default {
  // Default CDP port
  port: 9222,

  // Default browser profile directory
  profile: './web-profiles/playlite-0',

  // Default launch URL
  url: 'about:blank',

  // Browser launch args
  args: ['--disable-web-security'],
};
```

### `.playlite/libs/<name>.ts`

Each lib file exports a default async function that receives a Playwright `Page`
and returns an object of named helpers:

```typescript
import { Page } from 'playwright';

export default async function (page: Page): Promise<Record<string, any>> {
  // Set up helpers using the page
  // Return named exports that scripts can use
  return { helperA, helperB, SomeClass };
}
```

The lib name is the filename without extension: `.playlite/libs/foo.ts` →
`--lib foo`.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PLAYLITE_PORT` | Default CDP port | `9222` |
| `PLAYLITE_PROFILE` | Default browser profile path | (temp dir) |
| `PLAYLITE_CONFIG` | Path to `.playlite/` directory | (auto-detected) |

## Integration with Playwright Tests

### Pause on Failure

Projects can add a `PAUSE_ON_FAIL` mode to their Playwright fixtures. When a
test fails:

1. Don't close the browser
2. Print the CDP endpoint to stderr
3. Wait for a signal (file watch, stdin, or timeout) before teardown

Example fixture integration:

```typescript
// In the project's fixture setup
if (process.env.PAUSE_ON_FAIL && testInfo.status !== 'passed') {
  const cdpPort = extractCDPPort(browser);
  console.error(`\nTest failed. Browser left open.`);
  console.error(`Debug with: playlite connect ${cdpPort}`);
  console.error(`Press Enter to close browser and continue...`);
  await new Promise(resolve => process.stdin.once('data', resolve));
}
```

This is NOT part of playlite itself — it's a pattern that projects opt into.
playlite just needs a running browser with CDP enabled.

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js (>=18)
- **Browser automation:** Playwright (`playwright-core` — no bundled browsers)
- **TS compilation:** `tsx` for on-the-fly script execution
- **CLI framework:** Keep it minimal — `process.argv` parsing or a lightweight
  lib like `commander` if arg complexity warrants it. No heavy frameworks.
- **Package manager:** npm
- **Distribution:** npm package (`npx playlite` or global install)

## Non-Goals

- **Not a REPL.** No interactive mode. Commands are fire-and-forget.
- **Not a test runner.** Use Playwright for that. playlite is for debugging.
- **Not a recorder.** No codegen. Scripts are written by the user (or AI agent).
- **Not browser-specific.** Uses `playwright-core` so it works with whatever
  Chromium the user has. No bundled browser downloads.
- **Not a CDP wrapper.** playlite uses Playwright's API, not raw CDP. The `eval`
  command is the only thing that touches the page context directly, and it goes
  through `page.evaluate()`.

## Example: Full Debugging Session

```bash
# 1. Test fails
PAUSE_ON_FAIL=1 npx playwright test tests/dwp/dwp-wo-completion.test.ts
# Output: "Test failed. Browser left open. Debug with: playlite connect 9222"

# 2. Check what state we're in
playlite screenshot /tmp/state.png
playlite url
# → https://testops-as.trinoor.com:8443/as/ui/

# 3. Investigate with the helper lib
playlite run --lib asset-suite /tmp/debug-m106.ts

# 4. /tmp/debug-m106.ts contains:
#   await as.searchAndNavigate('M106');
#   await as.setFieldValue('W/O Task', '00409331', 0);
#   await as.setFieldValue('W/O Task', '01', 1);
#   await as.apply();
#   const grid = Table.byIndex(0);
#   const rows = await grid.getRowMaps(asDevice);
#   console.log('M106 rows:', JSON.stringify(rows, null, 2));

# 5. Fix the issue, copy the working code into the test
# 6. Press Enter to let the test fixture tear down
```
