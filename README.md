# playlite

A CLI for AI agents (and power users) to interact with live browsers using Playwright, with full access to project-specific helper libraries. Think of it as a scriptable `cdp` tool — but with Playwright's locator engine and the ability to load your own TypeScript helpers into the execution scope.

The primary audience is AI coding agents debugging browser-based test failures. Scripts written against a live browser via `playlite run` are directly copy-pasteable into Playwright tests — zero translation between debug mode and test mode.

---

## Install

```bash
# Global install
npm install -g playlite

# Or run without installing
npx playlite
```

Requires Node.js 18+. Uses `playwright-core` — no bundled browser downloads.

---

## Quick Start

```bash
# 1. Launch a browser
playlite launch

# 2. Check what's open
playlite tabs
#   1: New Tab (about:blank)

# 3. Navigate somewhere
playlite navigate "https://example.com"

# 4. Take a screenshot
playlite screenshot /tmp/state.png

# 5. Eval JS in the page
playlite eval "document.title"
#   Example Domain

# 6. Run a script with your helpers
playlite run --lib myapp scripts/debug.ts
```

---

## Commands

### `tabs`

List open tabs in the connected browser.

```bash
playlite tabs
#   1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
#   2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)

playlite tabs --json
```

Options:
- `--port <n>` — CDP port (default: 9222)
- `--json` — JSON output

---

### `connect [port]`

Test connectivity to a running browser. Useful as a health check.

```bash
playlite connect
# Connected to browser on port 9222 (2 tabs)

playlite connect 9223
# Connected to browser on port 9223 (1 tab)
```

Options:
- `--port <n>` — CDP port (default: 9222)

The port can also be given as a positional argument: `playlite connect 9222`.

---

### `url`

Print the current page's URL.

```bash
playlite url
# https://testops-as.trinoor.com:8443/as/ui/

playlite url --tab "Asset Suite"
# https://testops-as.trinoor.com:8443/as/ui/
```

Options:
- `--port <n>` — CDP port (default: 9222)
- `--tab <filter>` — Tab title substring or numeric index

---

### `screenshot [path]`

Capture the current page as a PNG. If no path is given, saves to a temp file and prints the path to stdout.

```bash
playlite screenshot /tmp/state.png
# Screenshot saved to /tmp/state.png  (stderr)
# /tmp/state.png                       (stdout)

# Auto-named temp file:
playlite screenshot
# /tmp/playlite-screenshot-1234567890.png

# Full-page (not just viewport):
playlite screenshot --full /tmp/full.png
```

Options:
- `--port <n>` — CDP port (default: 9222)
- `--tab <filter>` — Tab title substring or numeric index
- `--full` — Full page screenshot (not just viewport)

---

### `navigate <url>`

Navigate the current page to a URL. Waits for `domcontentloaded`.

```bash
playlite navigate "https://example.com"
# Navigated to https://example.com  (stderr)
# https://example.com                (stdout)
```

Options:
- `--port <n>` — CDP port (default: 9222)
- `--tab <filter>` — Tab title substring or numeric index

---

### `eval "<code>"`

Evaluate JavaScript. Behavior depends on whether `--lib` is passed.

**Without `--lib`:** runs in the browser context via `page.evaluate()` — equivalent to `cdp eval`.

```bash
playlite eval "document.title"
# Asset Suite

playlite eval "document.querySelectorAll('input').length"
# 3
```

**With `--lib`:** runs in Node context with your lib helpers in scope.

```bash
playlite eval --lib asset-suite "await as.getFieldValue('Work Status')"
# OPEN
```

Options:
- `--port <n>` — CDP port (default: 9222)
- `--tab <filter>` — Tab title substring or numeric index
- `--lib <name>` — Load lib(s) into scope (repeatable)
- `--json` — Force JSON output

---

### `run <script.ts>`

Run a TypeScript file with browser globals and lib helpers injected into scope.

```bash
playlite run --lib asset-suite scripts/debug-m106.ts
```

The script has these globals available automatically:
- `page` — Playwright `Page` for the selected tab
- `browser` — Playwright `Browser`
- `context` — Playwright `BrowserContext`
- Plus anything returned by your `--lib` factories

Top-level `await` works. The script runs inside an async wrapper.

```typescript
// scripts/debug-m106.ts
await as.searchAndNavigate('M106');
const grid = Table.byIndex(0);
const rows = await grid.getRowMaps(asDevice);
console.log('M106 rows:', JSON.stringify(rows, null, 2));
```

Scripts use the same TypeScript path aliases as your project (`@apps/`, `@core/`, etc.) — playlite reads the nearest `tsconfig.json` automatically.

Options:
- `--port <n>` — CDP port (default: 9222)
- `--tab <filter>` — Tab title substring or numeric index
- `--lib <name>` — Load lib(s) into scope (repeatable)

---

### `launch`

Launch a new Chromium browser with remote debugging enabled. Keeps running until you press Ctrl-C.

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

Options:
- `--port <n>` — CDP port (default: 9222)
- `--profile <path>` — Browser profile directory (persistent context)
- `--headless` — Launch headless (default: headed)
- `--url <url>` — Navigate to this URL after launch

---

## Tab Selection

Commands that interact with a page accept `--tab <filter>`:

1. **No filter, one tab** — auto-selected
2. **Numeric filter** (`--tab 2`) — select by 1-based index from `playlite tabs`
3. **String filter** (`--tab "Asset Suite"`) — case-insensitive title substring match
4. **No filter, multiple tabs** — error with tab list

```
Error: Multiple tabs open. Use --tab to select:
  1: TAShelix (https://testops-th.trinoor.com:8080/helix/)
  2: Asset Suite (https://testops-as.trinoor.com:8443/as/ui/)
```

---

## Lib System

Libs let you inject project-specific helpers into `eval --lib` and `run --lib` commands.

### Creating a lib

Create a `.playlite/libs/` directory at the project root (or anywhere in the path — playlite walks up from CWD, like `.git/`). Each lib is a `.ts` file that exports a default async factory function:

```typescript
// .playlite/libs/myapp.ts
import type { Page } from 'playwright-core';
import { MyAppHelper } from '@apps/myapp/MyAppHelper';

export default async function (page: Page) {
  const helper = new MyAppHelper(page, {
    username: process.env.APP_USER ?? 'admin',
    password: process.env.APP_PASS ?? 'password',
  });
  return { helper, MyAppHelper };
}
```

The factory receives the current `page` and returns named exports that become globals in your script.

### Using a lib

```bash
# In a run script
playlite run --lib myapp scripts/debug.ts

# In eval
playlite eval --lib myapp "await helper.getStatus()"

# Multiple libs (last-wins on name collision)
playlite run --lib core --lib myapp scripts/debug.ts
```

### Lib resolution

The lib name is the filename without extension: `.playlite/libs/myapp.ts` → `--lib myapp`.

`.playlite/` is found by walking up from CWD to the filesystem root. A monorepo can have one `.playlite/` at the root, or each sub-project can have its own.

### Example lib (see `examples/libs/greeter.ts`)

```typescript
import type { Page } from 'playwright-core';

export default async function (_page: Page) {
  return {
    greeting: 'hello',
    add: (a: number, b: number) => a + b,
  };
}
```

```bash
playlite run --lib greeter examples/scripts/hello.ts
# greeting: hello
# add(2, 3): 5
# page title: New Tab
```

---

## Configuration

Create `.playlite/config.ts` to set project-level defaults:

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
};
```

All fields are optional. The config is used by `playlite launch`. The `port` value becomes the default for all commands.

**Environment variables** also work:

| Variable | Purpose | Default |
|----------|---------|---------|
| `PLAYLITE_PORT` | Default CDP port | `9222` |
| `PLAYLITE_PROFILE` | Default browser profile path | (temp dir) |
| `PLAYLITE_CONFIG` | Path to `.playlite/` directory | (auto-detected) |

---

## Integration with Playwright Tests

The primary use case: a test fails and you want to inspect the browser state with your app helpers.

Add a `PAUSE_ON_FAIL` hook to your Playwright fixture setup:

```typescript
// In your project's fixture file
if (process.env.PAUSE_ON_FAIL && testInfo.status !== 'passed') {
  const cdpPort = 9222; // however your project tracks this
  console.error(`\nTest failed. Browser left open.`);
  console.error(`Debug with: playlite connect ${cdpPort}`);
  console.error(`Press Enter to close browser and continue...`);
  await new Promise(resolve => process.stdin.once('data', resolve));
}
```

This is a pattern projects opt into — playlite just needs a running browser with CDP enabled.

### Full debugging session

```bash
# 1. Run test with pause on failure
PAUSE_ON_FAIL=1 npx playwright test tests/dwp/dwp-wo-completion.test.ts
# → "Test failed. Browser left open. Debug with: playlite connect 9222"

# 2. Check current state
playlite screenshot /tmp/state.png
playlite url
# → https://testops-as.trinoor.com:8443/as/ui/

# 3. Investigate with helpers
playlite run --lib asset-suite /tmp/debug-m106.ts

# /tmp/debug-m106.ts:
#   await as.searchAndNavigate('M106');
#   const grid = Table.byIndex(0);
#   const rows = await grid.getRowMaps(asDevice);
#   console.log('rows:', JSON.stringify(rows, null, 2));

# 4. Copy the working code into the test, press Enter to tear down
```

---

## Error Reference

| Situation | Message |
|-----------|---------|
| No browser on port | `No browser found on port 9222. Launch one with: playlite launch` |
| No `.playlite/` dir | `No .playlite/ directory found. Create one with: mkdir .playlite` |
| Lib not found | `Lib 'foo' not found at /path/to/.playlite/libs/foo.ts` |
| Multiple tabs, no filter | `Multiple tabs open. Use --tab to select: ...` |
| Tab not found | `No tab found matching "foo". Available tabs: ...` |
| Multiple tab matches | `Multiple tabs match "foo". Be more specific: ...` |
| Script not found | `Script not found: /path/to/script.ts` |
