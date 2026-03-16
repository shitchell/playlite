import { connectToBrowser, selectPage } from '../browser.js';

export interface NavigateOptions {
  port: string;
  tab?: string;
}

export async function navigate(url: string, options: NavigateOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    console.error(`Navigated to: ${url}`);
  } finally {
    await browser.close();
  }
}
