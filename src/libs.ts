/**
 * Lib loading logic.
 *
 * Resolves .playlite/libs/<name>.ts, compiles with tsx, calls the default
 * export factory with the current page, and returns the named helpers.
 *
 * Implemented in Chunk 4.
 */

import type { Page } from 'playwright-core';

export type LibExports = Record<string, unknown>;

/**
 * Load a single lib by name and return its exports.
 */
export async function loadLib(_name: string, _page: Page): Promise<LibExports> {
  throw new Error('not implemented');
}

/**
 * Load multiple libs, merging their exports (last-wins on collision).
 * Warns to stderr on name collisions.
 */
export async function loadLibs(_names: string[], _page: Page): Promise<LibExports> {
  throw new Error('not implemented');
}
