import { connectToBrowser, selectPage } from '../browser.js';
import { resolvePort } from '../config.js';

export interface UrlOptions {
  port: string;
  session?: string;
  wasPortGiven?: boolean;
  tab?: string;
}

export async function url(options: UrlOptions): Promise<void> {
  const port = resolvePort(options);
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);
    console.log(page.url());
  } finally {
    await browser.close();
  }
}
