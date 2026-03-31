import { connectToBrowser, selectPage } from '../browser.js';
import { parsePort } from '../config.js';

export interface UrlOptions {
  port: string;
  tab?: string;
}

export async function url(options: UrlOptions): Promise<void> {
  const port = parsePort(options.port);
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);
    console.log(page.url());
  } finally {
    await browser.close();
  }
}
