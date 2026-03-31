import { connectToBrowser, selectPage } from '../browser.js';
import { parsePort } from '../config.js';

export interface ScreenshotOptions {
  port: string;
  tab?: string;
  full: boolean;
}

export async function screenshot(path: string | undefined, options: ScreenshotOptions): Promise<void> {
  const port = parsePort(options.port);
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);

    const outputPath = path ?? `/tmp/playlite-screenshot-${Date.now()}.png`;

    await page.screenshot({ path: outputPath, fullPage: options.full });

    console.error(`Screenshot saved to ${outputPath}`);
    console.log(outputPath);
  } finally {
    await browser.close();
  }
}
