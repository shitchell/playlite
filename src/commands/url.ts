import { connectToBrowser, selectPage } from '../browser.js';

export interface UrlOptions {
  port: string;
  tab?: string;
}

export async function url(options: UrlOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);
    console.log(page.url());
  } finally {
    await browser.close();
  }
}
