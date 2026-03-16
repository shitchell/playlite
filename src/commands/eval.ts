import { connectToBrowser, selectPage } from '../browser.js';

export interface EvalOptions {
  port: string;
  tab?: string;
  lib?: string[];
  json: boolean;
}

export async function evalCommand(code: string, options: EvalOptions): Promise<void> {
  if (options.lib?.length) {
    console.error('--lib is not yet supported for eval. Coming in a future release.');
    process.exit(1);
  }

  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }
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
