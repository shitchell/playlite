# playlite -- Usage Guide

Complete reference for every command, option, and feature. For a quick overview, see [the README](../README.md).

---

## Table of Contents

- [Global Options](#global-options)
- [Commands](#commands)
  - [launch](#launch)
  - [connect](#connect)
  - [tabs](#tabs)
  - [url](#url)
  - [navigate](#navigate)
  - [screenshot](#screenshot)
  - [eval](#eval)
  - [run](#run)
- [Tab Selection](#tab-selection)
- [Lib System](#lib-system)
  - [Creating a Lib](#creating-a-lib)
  - [Using a Lib](#using-a-lib)
  - [Lib Resolution](#lib-resolution)
  - [Multiple Libs](#multiple-libs)
  - [Path Aliases in Libs](#path-aliases-in-libs)
  - [Example Lib](#example-lib)
- [Configuration](#configuration)
  - [Writing `.playlite/config.ts`](#writing-playliteconfigts)
- [Integration with Playwright Tests](#integration-with-playwright-tests)
- [Technical Notes](#technical-notes)
- [Error Reference](#error-reference)
- [Output Conventions](#output-conventions)

---

## Global Options

These options are available on all commands:

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port to connect to | `9222` |
| `--version` | Print version and exit | |
| `--help` | Print help and exit | |

The default port is 9222 for all commands.

---

## Commands

### `launch`

Launch a new Chromium browser with remote debugging (CDP) enabled. The process stays alive until Ctrl-C.

```bash
playlite launch
# Launched browser on port 9222

playlite launch --port 9223 --url "https://example.com"
# Launched browser on port 9223

playlite launch --profile ./web-profiles/default
# Launched browser on port 9222
# Profile: /home/user/project/web-profiles/default

playlite launch --headless
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--profile <path>` | Browser profile directory (persistent context) | Temp directory |
| `--headless` | Launch headless | `false` (headed) |
| `--url <url>` | Navigate to this URL after launch | |

**Behavior details:**

- Without `--profile`, launches a non-persistent browser context (temporary profile, discarded on exit).
- With `--profile`, uses `chromium.launchPersistentContext()` -- cookies, localStorage, etc. persist between sessions.
- Status messages go to stderr. This is intentional so that piping stdout in other commands works cleanly.
- The browser keeps running until you send SIGINT (Ctrl-C), at which point it shuts down gracefully.

**Connecting a separate browser instead of using launch:**

You do not have to use `playlite launch`. Any Chromium browser started with `--remote-debugging-port` works:

```bash
google-chrome --remote-debugging-port=9222
# or
chromium-browser --remote-debugging-port=9222
```

---

### `connect`

Test connectivity to a running browser. Prints tab count and exits. Useful as a health check before running other commands.

```bash
playlite connect
# Connected to browser on port 9222 (2 tabs)

playlite connect 9223
# Connected to browser on port 9223 (1 tab)
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |

The port can also be given as a positional argument: `playlite connect 9222`. If both positional and `--port` are given, the positional argument wins.

**Polling pattern:**

`connect` is the right building block for waiting on a browser that is starting up. Use the **exit code** (`$?`), not the stdout text -- the success message format is informational and may change, and the failure message can contain the port number, which trivially defeats `grep`-based checks.

```bash
# Correct: poll the exit code
until playlite connect >/dev/null 2>&1; do sleep 2; done
echo "Browser is up"
```

```bash
# Wrong: grepping stdout
until playlite connect 2>&1 | grep -q 'Connected\|9223'; do sleep 2; done
# ^^^ This was a real consumer poll. It short-circuited on failure
#     because the failure message ("...port 9223...") contains "9223",
#     so grep matched and the loop exited before the browser was up.
```

**Exit codes:**

- `0` -- connected successfully
- `1` -- connection failed

---

### `tabs`

List open tabs in the connected browser.

```bash
playlite tabs
#   1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
#   2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)

playlite tabs --json
# [
#   { "index": 1, "title": "TAShelix", "url": "https://testops-th.trinoor.com:8080/helix/" },
#   { "index": 2, "title": "Asset Suite", "url": "https://testops-as.trinoor.com:8443/as/ui/" }
# ]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--json` | JSON output | `false` |
| `--format <fmt>` | Output format (alias for `--json`): `json` | |

`--format json` is accepted as an alias for `--json` (same effect).

The tab index shown here is the same 1-based index used by `--tab` on other commands.

---

### `url`

Print the current page's URL to stdout.

```bash
playlite url
# https://testops-as.trinoor.com:8443/as/ui/

playlite url --tab "Asset Suite"
# https://testops-as.trinoor.com:8443/as/ui/
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--tab <filter>` | Tab title substring or numeric index | |

---

### `navigate`

Navigate the current page to a URL. Waits for `domcontentloaded` before returning.

```bash
playlite navigate "https://example.com"
# Navigated to https://example.com     (stderr)
# https://example.com                   (stdout)
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--tab <filter>` | Tab title substring or numeric index | |

The URL argument is required. The confirmation message goes to stderr; the raw URL goes to stdout for easy piping.

---

### `screenshot`

Capture the current page as a PNG.

```bash
# Save to a specific path
playlite screenshot /tmp/state.png
# Screenshot saved to /tmp/state.png     (stderr)
# /tmp/state.png                          (stdout)

# Auto-named temp file (when path is omitted)
playlite screenshot
# Screenshot saved to /tmp/playlite-screenshot-1710579600000.png    (stderr)
# /tmp/playlite-screenshot-1710579600000.png                        (stdout)

# Full-page (not just viewport)
playlite screenshot --full /tmp/full.png
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--tab <filter>` | Tab title substring or numeric index | |
| `--full` | Full page screenshot (not just viewport) | `false` |

When no path is given, the file is saved to `/tmp/playlite-screenshot-<timestamp>.png`. The path is always printed to stdout (for programmatic use) and a human-readable confirmation goes to stderr.

---

### `eval`

Evaluate code. Behavior depends on whether `--lib` is passed.

**Without `--lib` -- browser context:**

Runs in the browser via `page.evaluate()`. Equivalent to running JS in the browser console. No access to Node.js APIs or lib helpers.

```bash
playlite eval "document.title"
# Example Domain

playlite eval "document.querySelectorAll('input').length"
# 3

playlite eval "({a: 1, b: 2})"
# {"a":1,"b":2}
```

**With `--lib` -- Node context:**

Runs in a Node.js process with Playwright's `page` object and lib helpers in scope. This means you can use Playwright locator APIs, your lib methods, `await`, etc. The code does NOT run in the browser -- it runs in Node and talks to the browser through Playwright.

```bash
playlite eval --lib asset-suite "await as.getFieldValue('Work Status')"
# OPEN

playlite eval --lib myapp "console.log(await page.locator('h1').textContent())"
# Welcome
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--tab <filter>` | Tab title substring or numeric index | |
| `--lib <name>` | Load lib(s) into scope (repeatable) | |
| `--json` | Force JSON output for the result | `false` |
| `--format <fmt>` | Output format (alias for `--json`): `json` | |

`--format json` is accepted as an alias for `--json` (same effect).

**Output formatting:**

- Strings print as-is (no quotes)
- Numbers and booleans print as-is
- Objects and arrays print as JSON
- `--json` forces JSON output for all types

**Key distinction:** Without `--lib`, the code string is sent to the browser and executed there (like `cdp eval`). With `--lib`, a full Node.js subprocess is spawned that connects to the browser via Playwright and runs your code with helpers in scope. This is a fundamentally different execution model. If you want raw browser JS, omit `--lib`. If you want Playwright APIs and your helpers, use `--lib`.

---

### `run`

Run a TypeScript file (or stdin) with browser globals and lib helpers injected into scope. This is the primary command for debugging sessions.

The script argument is optional. Three input modes are supported:

```bash
# File path (standard usage)
playlite run scripts/check-state.ts
playlite run --lib asset-suite scripts/debug-m106.ts
playlite run --lib core --lib myapp scripts/investigate.ts

# Explicit stdin marker
playlite run -

# Heredoc or pipe (stdin auto-detected when no argument and not a TTY)
playlite run << 'EOF'
await as.searchAndNavigate('M106');
console.log(await page.title());
EOF

echo "console.log(await page.title())" | playlite run
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--port <n>` | CDP port | `9222` |
| `--tab <filter>` | Tab title substring or numeric index | |
| `--lib <name>` | Load lib(s) into scope (repeatable) | |

**Globals available in the script:**

These are always available, regardless of `--lib`:

- `page` -- Playwright `Page` for the selected tab
- `browser` -- Playwright `Browser`
- `context` -- Playwright `BrowserContext`

With `--lib`, whatever the lib factory returns is also available as bare globals:

```typescript
// With --lib asset-suite (if the lib returns { as, asDevice, Table, Row, Cell })
await as.searchAndNavigate('M106');
const grid = Table.byIndex(0);
const rows = await grid.getRowMaps(asDevice);
console.log('rows:', JSON.stringify(rows, null, 2));
```

**Top-level await works.** The script is wrapped in an async IIFE, so you can write `await` at the top level without wrapping in an async function.

**Imports work.** Static `import` statements are hoisted out of the wrapper so they remain valid ESM imports. You can import from your project's modules using the same path aliases as your tests:

```typescript
import { someUtil } from '@core/utils';

const result = await someUtil(page);
console.log(result);
```

**Script output:** `console.log()` and `console.error()` in the script flow to the parent process's stdout/stderr. There is no special output wrapping.

**The copy-paste promise:** Code you write in a `playlite run` script is meant to be directly pasted into a Playwright test file. The same `page`, `await`, and lib helpers work in both contexts.

---

## Tab Selection

Commands that interact with a page (`url`, `navigate`, `screenshot`, `eval`, `run`) accept `--tab <filter>` to choose which tab to operate on.

**Selection rules (in priority order):**

| Condition | Behavior |
|-----------|----------|
| One tab open, no `--tab` | Auto-selected |
| `--tab 2` (numeric) | Select by 1-based index (matches the index from `playlite tabs`) |
| `--tab "Asset Suite"` (string) | Case-insensitive title substring match |
| Multiple tabs, no `--tab` | Error with tab list |

**Error cases:**

```
# No filter, multiple tabs
Error: Multiple tabs open. Use --tab to select:
  1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
  2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)

# String filter, no match
Error: No tab found matching "foo".
Available tabs:
  1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
  2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)

# String filter, multiple matches
Error: Multiple tabs match "test". Be more specific:
  1: Test Page 1 (https://example.com/a)
  2: Test Page 2 (https://example.com/b)

# Numeric filter, out of range
Error: Tab index 5 is out of range. 2 tab(s) available:
  1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
  2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)
```

**Practical tip for AI agents:** Run `playlite tabs` first to see what's available, then use `--tab` with either the index or a title substring.

---

## Lib System

Libs are the key feature that separates playlite from raw CDP tools. They let you load your project's test helpers -- the same classes and functions used in your Playwright tests -- into the debugging scope.

### Creating a Lib

1. Create a `.playlite/libs/` directory at your project root (or anywhere in the path -- playlite walks up from CWD, like `.git/` resolution).

2. Create a `.ts` file that exports a default async factory function:

```typescript
// .playlite/libs/myapp.ts
import type { Page } from 'playwright-core';
import { MyAppHelper } from '@apps/myapp/MyAppHelper';
import { SomeUtil } from '@core/utils';

export default async function (page: Page) {
  const helper = new MyAppHelper(page, {
    username: process.env.APP_USER ?? 'admin',
    password: process.env.APP_PASS ?? 'password',
  });
  return { helper, MyAppHelper, SomeUtil };
}
```

**The factory contract:**

- Receives a Playwright `Page` object (the selected tab)
- Must return an object -- each key/value becomes a global in the script scope
- Can be async (constructor setup, config loading, etc.)
- Can import from your project using path aliases (see [Path Aliases in Libs](#path-aliases-in-libs))
- Can read environment variables for credentials and configuration

### Using a Lib

```bash
# In a run script
playlite run --lib myapp scripts/debug.ts

# In eval (switches to Node context)
playlite eval --lib myapp "await helper.getStatus()"

# Multiple libs
playlite run --lib core --lib myapp scripts/debug.ts
```

### Lib Resolution

The lib name is the filename without extension: `.playlite/libs/myapp.ts` maps to `--lib myapp`.

playlite finds the `.playlite/` directory by walking up from the current working directory to the filesystem root. This means:

- A monorepo can have one `.playlite/` at the root
- Sub-projects can have their own `.playlite/` that shadows the parent
- You can run playlite from any subdirectory and it will find the nearest `.playlite/`

### Multiple Libs

When multiple `--lib` flags are given, libs are loaded in order. If two libs export the same name, the last one wins and a warning is printed to stderr:

```
Warning: lib 'myapp' overwrites 'page' (previously defined by 'core')
```

### Path Aliases in Libs

Lib files can use the same TypeScript path aliases as your project (`@apps/`, `@core/`, `@selectors/`, etc.). playlite finds the nearest `tsconfig.json` starting from the `.playlite/` directory and walks up. The `paths` and `baseUrl` from that tsconfig are passed to the TypeScript compiler (tsx) when loading the lib.

This means `import { Foo } from '@apps/bar/Foo'` in a lib file resolves the same way it does in your test files.

### Example Lib

The `examples/` directory contains a minimal working example:

```typescript
// examples/libs/greeter.ts
import type { Page } from 'playwright-core';

export default async function (_page: Page) {
  return {
    greeting: 'hello',
    add: (a: number, b: number) => a + b,
  };
}
```

```typescript
// examples/scripts/hello.ts
console.log(`greeting: ${greeting}`);
console.log(`add(2, 3): ${add(2, 3)}`);
console.log(`page title: ${await page.title()}`);
console.log(`page url: ${page.url()}`);
```

```bash
playlite run --lib greeter examples/scripts/hello.ts
# greeting: hello
# add(2, 3): 5
# page title: New Tab
# page url: about:blank
```

Note: to run this example, the lib must be at `.playlite/libs/greeter.ts` (playlite resolves libs from the `.playlite/` directory, not from the `examples/` directory). Copy it there or create a symlink.

---

## Configuration

### `.playlite/config.ts`

Place a `config.ts` file in your `.playlite/` directory to set project-level defaults. The config is loaded at startup and its values are used as defaults for all commands (CLI flags still override them).

```typescript
// .playlite/config.ts
export default {
  // Default CDP port
  port: 9222,

  // Default browser profile directory
  profile: './web-profiles/playlite-0',

  // Default launch URL
  url: 'about:blank',

  // Extra browser launch args
  args: ['--disable-web-security'],

  // Default libs — always loaded by run/eval, no --lib flag needed
  libs: ['asset-suite'],
};
```

**`libs` field:** Config libs are prepended to any `--lib` flags given on the command line. This lets projects skip `--lib` entirely for their standard helper(s). If the same lib name appears in both config and CLI flags, it is loaded once (CLI flag order preserved after config libs).

**Fallback behavior:** If no config file exists, all defaults remain hardcoded (port 9222, headed mode, no profile).

### Writing `.playlite/config.ts`

`.playlite/config.ts` is loaded in playlite's process via `tsImport` and runs at startup for **every** command. **Code in this file (and anything it imports) must not write to stdout** -- playlite reserves stdout for machine-readable output (see [Output Conventions](#output-conventions); aligns with V4: Predictable output conventions). Status, warnings, and other human-readable text belong on stderr.

The canonical pitfall is `dotenv`. Calling `dotenv.config()` without `{ quiet: true }` prints a `[dotenv@<version>] injecting env (N) from .env -- tip: ...` line to stdout, which then leaks into the output of every playlite command (e.g. `playlite tabs --json` would emit dotenv lines mixed with JSON, breaking machine consumers).

```typescript
// .playlite/config.ts -- correct

// Preload form (silent by default in dotenv 17.3.1+):
import 'dotenv/config';

// OR programmatic form (must pass { quiet: true }):
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export default { libs: ['myapp'] };
```

```typescript
// .playlite/config.ts -- incorrect: pollutes every command's stdout
import dotenv from 'dotenv';
dotenv.config(); // prints "[dotenv@17.x] injecting env ..." to stdout

export default { libs: ['myapp'] };
```

The same rule applies to **any** dependency that prints to stdout on import or initialization. If you need diagnostic output during config load, write it to `process.stderr` (or `console.error`) instead.

Why playlite does not silence this for you: config files are CLI input, not output sources. Playlite does not patch user dependencies or intercept their stdout — that would set a hostile precedent against simplicity (V1) and host-project compatibility (V3, where the user owns their config). The contract is documented here so the runtime stays predictable.

This is the root cause of the noise reported in [shitchell/playlite#6](https://github.com/shitchell/playlite/issues/6) -- playlite itself has zero `dotenv` invocations and `dotenv` is not a (direct or transitive) dependency; the output originates in the user's config.

---

## Integration with Playwright Tests

playlite is designed to work with any Chromium browser that has CDP enabled. The most powerful integration is with Playwright test suites that leave the browser open on failure.

### The PAUSE_ON_FAIL Pattern

This is NOT part of playlite itself -- it is a pattern your project implements in its Playwright fixture teardown:

```typescript
// In your project's fixture file (e.g., fixtures.ts)
import { test as base } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);

    // After test completes: if it failed and PAUSE_ON_FAIL is set, keep browser open
    if (process.env.PAUSE_ON_FAIL && testInfo.status !== 'passed') {
      const cdpPort = 9222; // however your project tracks this
      console.error(`\nTest failed. Browser left open.`);
      console.error(`Debug with: playlite connect ${cdpPort}`);
      console.error(`Press Enter to close browser and continue...`);
      await new Promise(resolve => process.stdin.once('data', resolve));
    }
  },
});
```

### Full Debugging Session

```bash
# 1. Run the failing test
PAUSE_ON_FAIL=1 npx playwright test tests/dwp/dwp-wo-completion.test.ts
# -> "Test failed. Browser left open. Debug with: playlite connect 9222"

# 2. Check connectivity and see what's open
playlite connect
# Connected to browser on port 9222 (2 tabs)

playlite tabs
#   1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
#   2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)

# 3. Check current state
playlite screenshot --tab "Asset" /tmp/state.png
playlite url --tab "Asset"
# https://testops-as.trinoor.com:8443/as/ui/

# 4. Write a debug script
cat > /tmp/debug-m106.ts << 'SCRIPT'
await as.searchAndNavigate('M106');
const grid = Table.byIndex(0);
const rows = await grid.getRowMaps(asDevice);
console.log('M106 rows:', JSON.stringify(rows, null, 2));
SCRIPT

# 5. Run it with helpers
playlite run --lib asset-suite --tab "Asset" /tmp/debug-m106.ts

# 6. Iterate: edit the script, run again, until you understand the failure

# 7. Copy the working code into the test, press Enter to let the fixture tear down
```

---

## Technical Notes

### `__name` polyfill

When running scripts with `run` or `eval --lib`, playlite injects a `__name` polyfill into the browser page context. This is a workaround for a conflict between esbuild/tsx's `keepNames` transform (which wraps functions with `__name(fn, "name")` calls) and Playwright's `page.evaluate()` serialization (which does not know about `__name`). The polyfill is injected automatically before any user code runs — no configuration is needed.

### Wrapper tsconfig

The runner generates a temporary `tsconfig.json` that extends the host project's `tsconfig.json` with ESM-compatible overrides (`"module": "ESNext"`, `"moduleResolution": "bundler"`). This prevents CJS/ESM conflicts when the host project uses `"module": "commonjs"` in its own tsconfig. The wrapper tsconfig is written to `.tmp/` alongside the wrapper script and cleaned up after execution.

### CWD during script execution

The runner sets the working directory of the `tsx` subprocess to the project root (the parent directory of `.playlite/`), not to the directory where `playlite run` was invoked. This ensures that tools relying on CWD for resolution — such as `dotenv.config()` — find the project's `.env` file correctly regardless of where you invoke playlite from.

---

## Error Reference

All error messages are designed to be actionable -- they tell you what went wrong and what to do about it.

| Situation | Error Message | Resolution |
|-----------|--------------|------------|
| No browser on port | `No browser found on port 9222. Launch one with: playlite launch` | Start a browser with `playlite launch` or `chrome --remote-debugging-port=9222` |
| Invalid port | `Invalid port: "abc"` | Pass a valid number to `--port` |
| No `.playlite/` dir (when --lib used) | `No .playlite/ directory found. Create one with: mkdir .playlite` | Create the directory and add your libs |
| Lib not found | `Lib 'foo' not found at /path/to/.playlite/libs/foo.ts` | Check the lib name and verify the file exists |
| Lib has no default export | `Lib 'foo' at /path/... must export a default function. Got: undefined` | Add `export default async function(page) { ... }` |
| Lib factory returns non-object | `Lib 'foo' factory must return an object. Got: string` | Return `{ key: value }` from the factory |
| No browser context | `Connected to browser on port 9222 but no browser context found.` | The browser may be in an unusual state; restart it |
| No pages found | `No pages found in the browser context.` | Open a tab in the browser |
| Multiple tabs, no filter | `Multiple tabs open. Use --tab to select: ...` | Pass `--tab <index>` or `--tab "title substring"` |
| Tab not found by title | `No tab found matching "foo". Available tabs: ...` | Check spelling; use `playlite tabs` to see what's open |
| Multiple tab matches | `Multiple tabs match "foo". Be more specific: ...` | Use a more specific substring or use the numeric index |
| Tab index out of range | `Tab index 5 is out of range. 2 tab(s) available: ...` | Use `playlite tabs` to see valid indices |
| Script not found | `Script not found: /path/to/script.ts` | Check the file path |

---

## Output Conventions

playlite follows a consistent pattern for output:

- **Machine-readable data goes to stdout** -- URLs, file paths, JSON, eval results
- **Human-readable status goes to stderr** -- "Screenshot saved to...", "Navigated to...", "Connected to..."
- **Errors go to stderr** -- all error messages, warnings about lib collisions

This means you can pipe stdout reliably:

```bash
# Save the URL to a variable
URL=$(playlite url --tab "Asset")

# Pass the screenshot path to another tool
playlite screenshot | xargs open
```
