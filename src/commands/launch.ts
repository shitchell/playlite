import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import { resolve } from 'node:path';
import { parsePort } from '../config.js';

export interface LaunchOptions {
  port: string;
  profile?: string;
  headless: boolean;
  url?: string;
}

export async function launch(options: LaunchOptions): Promise<void> {
  const port = parsePort(options.port);

  const args = [`--remote-debugging-port=${port}`];
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  if (options.profile) {
    const profilePath = resolve(options.profile);
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

  // Keep process alive until SIGINT or SIGTERM
  await new Promise<void>((done) => {
    process.on('SIGINT', done);
    process.on('SIGTERM', done);
  });

  // Graceful shutdown
  if (context) {
    await context.close();
  } else if (browser) {
    await browser.close();
  }
}
