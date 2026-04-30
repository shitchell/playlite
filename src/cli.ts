#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command, Option } from 'commander';
import { tabs } from './commands/tabs.js';
import { connect } from './commands/connect.js';
import { url } from './commands/url.js';
import { screenshot } from './commands/screenshot.js';
import { navigate } from './commands/navigate.js';
import { evalCommand } from './commands/eval.js';
import { run } from './commands/run.js';
import { launch } from './commands/launch.js';
import { ls } from './commands/ls.js';
import { kill } from './commands/kill.js';
import { tree } from './commands/tree.js';
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
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--json', 'JSON output', false)
  .addOption(new Option('--format <fmt>', "Output format (alias for '--json'): json").choices(['json']))
  .action(async (options, cmd) => {
    options.json = options.json || options.format === 'json';
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    await tabs(options);
  });

// ----------------------------------------------------------------------------
// connect [port] — test connectivity
// ----------------------------------------------------------------------------
program
  .command('connect [port]')
  .description(
    'Test connectivity to a running browser. Exit code 0 = connected, ' +
    'non-zero = not connected. Use the exit code (not stdout text) ' +
    'when scripting a poll loop.'
  )
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .action(async (portArg, options, cmd) => {
    // The optional positional arg is a convenience alias for --port.
    // Positional wins if given; falls back to --port (or its default).
    // If only positional is given, use it.
    const effectivePort: string = portArg ?? options.port;
    const wasPortGiven = !!portArg || cmd.getOptionValueSource('port') === 'cli';
    await connect({ port: effectivePort, session: options.session, wasPortGiven });
  });

// ----------------------------------------------------------------------------
// url — print current page URL
// ----------------------------------------------------------------------------
program
  .command('url')
  .description("Print the current page's URL")
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .action(async (options, cmd) => {
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    await url(options);
  });

// ----------------------------------------------------------------------------
// screenshot [path] — capture page as PNG
// ----------------------------------------------------------------------------
program
  .command('screenshot [path]')
  .description('Capture the current page as a PNG')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--full', 'Full page screenshot (not just viewport)', false)
  .action(async (path, options, cmd) => {
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    await screenshot(path, options);
  });

// ----------------------------------------------------------------------------
// navigate <url> — navigate to URL
// ----------------------------------------------------------------------------
program
  .command('navigate <url>')
  .description('Navigate the current page to a URL')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .action(async (targetUrl, options, cmd) => {
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    await navigate(targetUrl, options);
  });

// ----------------------------------------------------------------------------
// eval "<js>" — evaluate JS in page context (or Node context with --lib)
// ----------------------------------------------------------------------------
program
  .command('eval [code]')
  .description(
    'Evaluate JavaScript. Code is the value of the last expression. ' +
    'Without --lib: page.evaluate(code) in the browser. ' +
    'With --lib: Node.js subprocess with page + lib helpers in scope. ' +
    'Function literals are NOT auto-called; wrap in an IIFE.'
  )
  .option('-e, --expression <code>', 'Code to evaluate (alias for positional)')
  .option('-c, --code <code>', 'Code to evaluate (alias for positional)')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--lib <name>', 'Load lib(s) into scope (repeatable)', collect, [])
  .option('--json', 'Force JSON output', false)
  .addOption(new Option('--format <fmt>', "Output format (alias for '--json'): json").choices(['json']))
  .action(async (code, options, cmd) => {
    const provided = [code, options.expression, options.code].filter(Boolean);
    if (provided.length === 0) {
      console.error('No code provided. Use a positional, -e/--expression, or -c/--code.');
      process.exit(1);
    }
    if (provided.length > 1) {
      console.error('Pass code via positional, -e/--expression, OR -c/--code — not multiple.');
      process.exit(1);
    }
    code = provided[0]!;
    options.json = options.json || options.format === 'json';
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    // Config libs do NOT auto-apply to eval — see D19 (#006).
    // Eval's context (browser vs Node) is determined by explicit --lib only.
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
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--lib <name>', 'Load lib(s) into scope (repeatable)', collect, [])
  .action(async (script, options, cmd) => {
    // Merge config libs (first) with CLI --lib flags (appended/override).
    options.lib = [...configLibs, ...options.lib];
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    await run(script, options);
  });

// ----------------------------------------------------------------------------
// launch — start a new Chromium browser with remote debugging enabled
// ----------------------------------------------------------------------------
program
  .command('launch')
  .description('Launch a new Chromium browser with remote debugging enabled')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--name <label>', 'Register as a named session for later --session lookup')
  .option('--profile <path>', 'Browser profile directory')
  .option('--headless', 'Launch headless (default: headed)', false)
  .option('--url <url>', 'Navigate to URL after launch')
  .action(async (options) => {
    await launch(options);
  });

// ----------------------------------------------------------------------------
// ls — list active named sessions
// ----------------------------------------------------------------------------
program
  .command('ls')
  .description('List active named sessions')
  .option('--json', 'JSON output', false)
  .addOption(new Option('--format <fmt>', "Output format (alias for '--json'): json").choices(['json']))
  .action(async (options) => {
    await ls(options);
  });

// ----------------------------------------------------------------------------
// kill <name> — terminate a named session
// ----------------------------------------------------------------------------
program
  .command('kill <name>')
  .description('Terminate a named session and prune its registry entry')
  .option('-9, --force', 'Send SIGKILL instead of SIGTERM', false)
  .action(async (name, options) => {
    await kill(name, options);
  });

// ----------------------------------------------------------------------------
// tree [selector] — hierarchical DOM dump (issue #8 slice 1)
// ----------------------------------------------------------------------------
program
  .command('tree [selector]')
  .description(
    'Print a compact hierarchical view of the page DOM (or a subtree). ' +
    'Optimized for LLM consumption: empty wrappers collapsed, generated ' +
    'classes filtered, redundant roles suppressed.'
  )
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--depth <n>', 'Maximum tree depth', '6')
  .option('--show-classes <mode>', 'Class filter aggressiveness: none|stable|all', 'stable')
  .option('--no-collapse', 'Disable empty-wrapper collapse')
  .option('--max-text <n>', 'Truncate visible text to N chars', '60')
  .action(async (selector, options, cmd) => {
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
    await tree(selector, options);
  });

// ----------------------------------------------------------------------------
// observe — stream MutationObserver events from the connected page
// ----------------------------------------------------------------------------
program
  .command('observe')
  .description('Stream DOM mutations from the connected page in real time. Press Ctrl+C to stop.')
  .option('--port <n>', 'CDP port', defaultPort)
  .option('--session <name>', 'Named session (overrides --port)')
  .option('--tab <filter>', 'Tab title substring or numeric ID')
  .option('--root <selector>', 'Observe only this subtree (default: whole document)')
  .option('--no-childList', 'Disable childList mutations')
  .option('--no-attributes', 'Disable attribute mutations')
  .option('--no-characterData', 'Disable text-content mutations')
  .option('--no-subtree', 'Observe only the root node, not its descendants')
  .option('--attribute-filter <name...>', 'Restrict attribute mutations to these names')
  .option('--duration <ms>', 'Auto-stop after this many milliseconds')
  .option('--json', 'Emit raw JSON records, one per line (newline-delimited)', false)
  .addOption(new Option('--format <fmt>', "Output format (alias for '--json'): json").choices(['json']))
  .action(async (options, cmd) => {
    options.wasPortGiven = cmd.getOptionValueSource('port') === 'cli';
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
