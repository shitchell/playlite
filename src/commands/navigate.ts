import { connectToBrowser, selectPage } from '../browser.js';
import { parsePort } from '../config.js';

export interface NavigateOptions {
  port: string;
  tab?: string;
}

export async function navigate(url: string, options: NavigateOptions): Promise<void> {
  const port = parsePort(options.port);
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    console.error(`Navigated to ${url}`);
    console.log(url);
  } finally {
    await browser.close();
  }
}
