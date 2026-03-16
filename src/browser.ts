/**
 * Browser connection and page selection logic.
 *
 * Implemented in Chunk 2.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

export interface ConnectedBrowser {
  browser: Browser;
  context: BrowserContext;
}

/**
 * Connect to a running Chromium browser via CDP.
 */
export async function connectToBrowser(_port: number): Promise<ConnectedBrowser> {
  throw new Error('not implemented');
}

/**
 * Select a page from the context based on an optional tab filter.
 * - No filter + 1 page → return it
 * - Numeric filter → match by index in pages array
 * - String filter → case-insensitive title substring match
 * - No filter + multiple pages → throw with tab list
 */
export async function selectPage(_pages: Page[], _tabFilter?: string): Promise<Page> {
  throw new Error('not implemented');
}

/**
 * Format the list of pages as human-readable lines: `<index>: <title> (<url>)`
 */
export function listTabs(_pages: Page[]): string[] {
  throw new Error('not implemented');
}
