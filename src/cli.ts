#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { tabs } from './commands/tabs.js';
import { connect } from './commands/connect.js';
import { url } from './commands/url.js';
import { screenshot } from './commands/screenshot.js';
import { navigate } from './commands/navigate.js';
import { evalCommand } from './commands/eval.js';
import { run } from './commands/run.js';
import { launch } from './commands/launch.js';
import { observe } from './commands/observe.js';
import { loadConfig } from './config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// Load project config (port, profile, etc.) before defining commands.
// loadConfig() is async (uses tsx to import config.ts), so we wrap
// the CLI setup in an async IIFE to allow top-level await.
(async () => {
const config = await loadConfig();
const defaultPort = String(config.port);
const configLibs: string[] = config.libs ?? [];

const program = new Command();

program
  .name('playlite')
  .description('Playwright-based browser debugging CLI for AI agents')
  .version(pkg.version);

// ----------------------------------------------------------------------------
// tabs — list open tabs
// ----------------------------------------------------------------------------
program
  .command('tabs')
  .description('List open tabs in the connected browser')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--json', 'JSON output', false)
  .action(async (options) => {
    await tabs(options);
  });

// ----------------------------------------------------------------------------
// connect [port] — test connectivity
// ----------------------------------------------------------------------------
program
  .command('connect [port]')
  .description('Test connectivity to a running browser')
  .option('--port <n>', 'CDP port', defaultPort)
  .action(async (portArg, options) => {
    // The optional positional arg is a convenience alias for --port.
    // Positional wins if given; falls back to --port (or its default).
    // If only positional is given, use it.
    const effectivePort: string = portArg ?? options.port;
    await connect({ port: effectivePort });
  });

// ----------------------------------------------------------------------------
// url — print current page URL
// ----------------------------------------------------------------------------
program
  .command('url')
  .description("Print the current page's URL")
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .action(async (options) => {
    await url(options);
  });

// ----------------------------------------------------------------------------
// screenshot [path] — capture page as PNG
// ----------------------------------------------------------------------------
program
  .command('screenshot [path]')
  .description('Capture the current page as a PNG')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--full', 'Full page screenshot (not just viewport)', false)
  .action(async (path, options) => {
    await screenshot(path, options);
  });

// ----------------------------------------------------------------------------
// navigate <url> — navigate to URL
// ----------------------------------------------------------------------------
program
  .command('navigate <url>')
  .description('Navigate the current page to a URL')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .action(async (targetUrl, options) => {
    await navigate(targetUrl, options);
  });

// ----------------------------------------------------------------------------
// eval "<js>" — evaluate JS in page context (or Node context with --lib)
// ----------------------------------------------------------------------------
program
  .command('eval <code>')
  .description(
    'Evaluate JavaScript. Without --lib: runs in browser context (page.evaluate). ' +
    'With --lib: runs in Node context with lib helpers in scope.'
  )
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--lib <name>', 'Load lib(s) into scope (repeatable)', collect, [])
  .option('--json', 'Force JSON output', false)
  .action(async (code, options) => {
    // Merge config libs (first) with CLI --lib flags (appended/override).
    options.lib = [...configLibs, ...options.lib];
    await evalCommand(code, options);
  });

// ----------------------------------------------------------------------------
// run [script.ts] — run a TypeScript file (or stdin) with helpers injected
// ----------------------------------------------------------------------------
program
  .command('run [script]')
  .description(
    'Run a TypeScript file with browser and lib helpers injected into scope. ' +
    'Pass - or omit the script argument to read from stdin.'
  )
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--lib <name>', 'Load lib(s) into scope (repeatable)', collect, [])
  .action(async (script, options) => {
    // Merge config libs (first) with CLI --lib flags (appended/override).
    options.lib = [...configLibs, ...options.lib];
    await run(script, options);
  });

// ----------------------------------------------------------------------------
// launch — start a new Chromium browser with remote debugging enabled
// ----------------------------------------------------------------------------
program
  .command('launch')
  .description('Launch a new Chromium browser with remote debugging enabled')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--profile <path>', 'Browser profile directory')
  .option('--headless', 'Launch headless (default: headed)', false)
  .option('--url <url>', 'Navigate to URL after launch')
  .action(async (options) => {
    await launch(options);
  });

// ----------------------------------------------------------------------------
// observe — stream MutationObserver events from the connected page
// ----------------------------------------------------------------------------
program
  .command('observe')
  .description('Stream DOM mutations from the connected page in real time. Press Ctrl+C to stop.')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--root <selector>', 'Observe only this subtree (default: whole document)')
  .option('--no-childList', 'Disable childList mutations')
  .option('--no-attributes', 'Disable attribute mutations')
  .option('--no-characterData', 'Disable text-content mutations')
  .option('--no-subtree', 'Observe only the root node, not its descendants')
  .option('--attribute-filter <name...>', 'Restrict attribute mutations to these names')
  .option('--duration <ms>', 'Auto-stop after this many milliseconds')
  .option('--json', 'Emit raw JSON records (the on-bridge shape)', false)
  .action(async (options) => {
    await observe(options);
  });

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Collector for repeatable --lib flags: accumulates values into an array. */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/** Print unhandled rejections (thrown from command actions) cleanly, without stack traces. */
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(message);
  process.exit(1);
});

program.parse();
})();
