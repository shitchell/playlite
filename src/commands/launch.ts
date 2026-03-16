import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import * as path from 'path';

export interface LaunchOptions {
  port: string;
  profile?: string;
  headless: boolean;
  url?: string;
}

export async function launch(options: LaunchOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }

  const args = [`--remote-debugging-port=${port}`];
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  if (options.profile) {
    const profilePath = path.resolve(options.profile);
    context = await chromium.launchPersistentContext(profilePath, {
      headless: options.headless,
      args,
    });
    console.error(`Launched browser on port ${port}`);
    console.error(`Profile: ${profilePath}`);
  } else {
    browser = await chromium.launch({
      headless: options.headless,
      args,
    });
    console.error(`Launched browser on port ${port}`);
  }

  if (options.url) {
    const page = context ? context.pages()[0] ?? await context.newPage()
                        : await browser!.newPage();
    await page.goto(options.url);
  }

  // Keep process alive until SIGINT
  await new Promise<void>((resolve) => {
    process.on('SIGINT', resolve);
  });

  // Graceful shutdown
  if (context) {
    await context.close();
  } else if (browser) {
    await browser.close();
  }
}
