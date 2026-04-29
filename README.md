# playlite

A CLI for AI agents (and power users) to interact with live browsers using Playwright, with full access to project-specific helper libraries.

The primary audience is AI coding agents debugging browser-based test failures. Scripts written against a live browser via `playlite run` are directly copy-pasteable into Playwright tests -- zero translation between debug mode and test mode.

The killer feature is `--lib`: load your project's own TypeScript helpers (the same code used in tests) so debugging scripts and test code are identical. No translation layer, no throwaway CDP hacks.

---

## Install

```bash
# Global install
npm install -g playlite

# Or run without installing
npx playlite
```

Requires Node.js 18+. Uses `playwright-core` -- no bundled browser downloads.

---

## Quick Start

```bash
# 1. Launch a browser (or connect to any Chromium with --remote-debugging-port)
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

# 6. Run a TypeScript file with your helpers injected
playlite run --lib myapp scripts/debug.ts

# Or, if your .playlite/config.ts sets libs: ['myapp'], skip the flag entirely
playlite run scripts/debug.ts

# Or pipe a script via stdin
echo "console.log(await page.title())" | playlite run -
```

---

## Commands

| Command | Description |
|---------|-------------|
| `playlite launch` | Launch a Chromium browser with CDP enabled |
| `playlite connect [port]` | Test connectivity to a running browser |
| `playlite tabs` | List open tabs |
| `playlite url` | Print current page URL |
| `playlite navigate <url>` | Navigate to a URL |
| `playlite screenshot [path]` | Capture the page as PNG |
| `playlite eval "<code>"` | Evaluate JS in browser context (or Node context with `--lib`) |
| `playlite run [script.ts]` | Run a TypeScript file (or stdin) with browser + lib helpers in scope |

All commands that connect to a browser accept `--port <n>` (default: 9222). Commands that interact with a page accept `--tab <filter>` (title substring or 1-based index).

See [docs/usage.md](docs/usage.md) for full options, examples, and edge cases.

---

## Lib System (the key feature)

Libs inject project-specific helpers into `run` and `eval --lib` commands. Create `.playlite/libs/<name>.ts` at your project root:

```typescript
// .playlite/libs/myapp.ts
import type { Page } from 'playwright-core';
import { MyAppHelper } from '@apps/myapp/MyAppHelper';

export default async function (page: Page) {
  const helper = new MyAppHelper(page);
  return { helper, MyAppHelper };
}
```

Then use it:

```bash
playlite eval --lib myapp "await helper.getStatus()"
playlite run --lib myapp scripts/investigate.ts
```

Everything returned by the factory becomes a global in your script scope. Multiple `--lib` flags are supported (last-wins on name collision).

You can also set default libs in `.playlite/config.ts` so you never need `--lib` at all:

```typescript
// .playlite/config.ts
export default {
  port: 9223,
  libs: ['myapp'],  // Always loaded — no --lib flag needed
};
```

Config libs are prepended to any `--lib` flags given on the command line.

Config code runs in playlite's process; do not write to stdout. See [docs/usage.md#writing-playliteconfigts](docs/usage.md#writing-playliteconfigts).

See [docs/usage.md#lib-system](docs/usage.md#lib-system) for the full lib authoring guide.

---

## Integration with Playwright Tests

The primary use case: a test fails and you want to inspect the browser state with your app helpers.

```bash
# 1. Run test with pause-on-failure (your project implements this hook)
PAUSE_ON_FAIL=1 npx playwright test tests/dwp/my-test.test.ts
# -> "Test failed. Browser left open. Debug with: playlite connect 9222"

# 2. Inspect
playlite screenshot /tmp/state.png
playlite run --lib myapp /tmp/debug.ts

# 3. Copy working code into the test
```

See [docs/usage.md#integration-with-playwright-tests](docs/usage.md#integration-with-playwright-tests) for the PAUSE_ON_FAIL fixture pattern.

---

## Documentation

- **[docs/usage.md](docs/usage.md)** -- Full command reference, lib system details, configuration, error reference
- **[docs/architecture.md](docs/architecture.md)** -- Codebase structure, design decisions, contributor guide
- **[docs/design.md](docs/design.md)** -- Original design document (historical, pre-implementation)
- **[docs/plan.md](docs/plan.md)** -- Original implementation plan (historical, completed)
