import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import { resolve } from 'node:path';
import { parsePort } from '../config.js';
import {
  assertValidSessionName,
  findSession,
  registerSession,
  removeSession,
  type SessionMeta,
} from '../sessions.js';

export interface LaunchOptions {
  port: string;
  profile?: string;
  headless: boolean;
  url?: string;
  /** Optional label for the session registry. */
  name?: string;
}

export async function launch(options: LaunchOptions): Promise<void> {
  const port = parsePort(options.port);

  if (options.name) {
    assertValidSessionName(options.name);
    if (findSession(options.name)) {
      throw new Error(
        `Session "${options.name}" already exists. ` +
        `Pick another --name, or run: playlite kill ${options.name}`
      );
    }
  }

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

  if (options.name) {
    const meta: SessionMeta = {
      name: options.name,
      port,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      profile: options.profile,
      headless: options.headless,
    };
    registerSession(meta);
    console.error(`Registered session "${options.name}"`);
  }

  if (options.url) {
    const page = context ? context.pages()[0] ?? await context.newPage()
                        : await browser!.newPage();
    await page.goto(options.url);
  }

  // Keep process alive until SIGINT or SIGTERM
  try {
    await new Promise<void>((done) => {
      process.on('SIGINT', done);
      process.on('SIGTERM', done);
    });
  } finally {
    // Graceful shutdown — always remove the session entry, even if the
    // browser close throws, to avoid leaking stale registry entries.
    if (options.name) {
      try { removeSession(options.name); } catch { /* best-effort */ }
    }
    if (context) {
      await context.close();
    } else if (browser) {
      await browser.close();
    }
  }
}
