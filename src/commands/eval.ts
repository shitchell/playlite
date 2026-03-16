/**
 * `playlite eval "<code>"` — evaluate code in the browser or Node context.
 *
 * Without --lib: runs code in the browser via page.evaluate() (existing behavior).
 * With --lib: runs code in Node context via a temp wrapper with lib helpers in scope.
 */

import { connectToBrowser, selectPage } from '../browser.js';
import { executeWrapper } from '../runner.js';

export interface EvalOptions {
  port: string;
  tab?: string;
  lib?: string[];
  json: boolean;
}

export async function evalCommand(code: string, options: EvalOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }

  // With --lib: Node-context execution with lib helpers available
  if (options.lib?.length) {
    executeWrapper({
      port,
      tab: options.tab,
      libs: options.lib,
      code,
      isFile: false,
    });
    return;
  }

  // Without --lib: browser-context eval via page.evaluate() (original behavior)
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);

    let result: unknown;
    try {
      result = await page.evaluate(code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(1);
    }

    if (options.json || (typeof result === 'object' && result !== null)) {
      console.log(JSON.stringify(result));
    } else if (typeof result === 'string') {
      console.log(result);
    } else {
      console.log(String(result));
    }
  } finally {
    await browser.close();
  }
}
