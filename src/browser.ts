/**
 * Browser connection and page selection logic.
 */

import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

export interface ConnectedBrowser {
  browser: Browser;
  context: BrowserContext;
}

export interface TabInfo {
  index: number;
  title: string;
  url: string;
}

/**
 * Connect to a running Chromium browser via CDP.
 *
 * Throws an actionable error if the connection is refused.
 */
export async function connectToBrowser(port: number): Promise<ConnectedBrowser> {
  const endpoint = `http://localhost:${port}`;
  try {
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(`Connected to browser on port ${port} but no browser context found.`);
    }
    return { browser, context };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Playwright surfaces connection errors with "ECONNREFUSED", "ERR_CONNECTION_REFUSED",
    // or "connect ECONNREFUSED". Only rewrite errors that are clearly connection failures.
    if (message.includes('ECONNREFUSED') || message.includes('ERR_CONNECTION_REFUSED')) {
      throw new Error(
        `No browser found on port ${port}. Launch one with: playlite launch`
      );
    }
    throw err;
  }
}

/**
 * Select a page from the context based on an optional tab filter.
 *
 * Selection rules (in order):
 *   1. No filter + 1 page  → return it
 *   2. Numeric filter       → match by index in pages array (1-based, per displayed output)
 *   3. String filter        → case-insensitive title substring match
 *   4. No filter + multiple → throw with formatted tab list
 */
export async function selectPage(pages: Page[], tabFilter?: string): Promise<Page> {
  if (pages.length === 0) {
    throw new Error('No pages found in the browser context.');
  }

  // Rule 1: single page, no filter
  if (!tabFilter && pages.length === 1) {
    return pages[0];
  }

  // Rules 2 & 3: filter provided
  if (tabFilter !== undefined) {
    const asNumber = Number(tabFilter);

    if (!isNaN(asNumber) && Number.isInteger(asNumber)) {
      // Rule 2: numeric → 1-based index matching the displayed list
      const idx = asNumber - 1;
      if (idx < 0 || idx >= pages.length) {
        const tabList = await formatTabList(pages);
        throw new Error(
          `Tab index ${asNumber} is out of range. ` +
          `${pages.length} tab(s) available:\n` +
          tabList
        );
      }
      return pages[idx];
    }

    // Rule 3: string → case-insensitive title substring
    const lower = tabFilter.toLowerCase();
    const titles = await Promise.all(pages.map(p => p.title()));
    const matches = pages.filter((_, i) => titles[i].toLowerCase().includes(lower));

    if (matches.length === 1) {
      return matches[0];
    }

    const tabList = await formatTabList(pages);

    if (matches.length === 0) {
      throw new Error(
        `No tab found matching "${tabFilter}".\nAvailable tabs:\n` +
        tabList
      );
    }

    // Multiple matches
    throw new Error(
      `Multiple tabs match "${tabFilter}". Be more specific:\n` +
      tabList
    );
  }

  // Rule 4: no filter, multiple pages
  const tabList = await formatTabList(pages);
  throw new Error(
    'Error: Multiple tabs open. Use --tab to select:\n' +
    tabList
  );
}

/**
 * Return an array of tab info objects for all pages.
 */
export async function listTabs(pages: Page[]): Promise<TabInfo[]> {
  const titles = await Promise.all(pages.map(p => p.title()));
  return pages.map((page, i) => ({
    index: i + 1,
    title: titles[i],
    url: page.url(),
  }));
}

/**
 * Format the tab list as human-readable lines: `  <index>: <title> (<url>)`
 */
async function formatTabList(pages: Page[]): Promise<string> {
  const tabs = await listTabs(pages);
  return tabs.map(t => `  ${t.index}: ${t.title} (${t.url})`).join('\n');
}
