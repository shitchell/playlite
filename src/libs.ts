/**
 * Lib loading logic.
 *
 * Resolves .playlite/libs/<name>.ts, dynamically imports it via tsx, calls the
 * default export factory with the current page, and returns the named helpers.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { findPlayliteDir, findTsconfig } from './config.js';
import { importTs } from './loader.js';

export type LibExports = Record<string, unknown>;

/**
 * Load a single lib by name and return its exports.
 *
 * 1. Find .playlite/ dir via findPlayliteDir()
 * 2. Resolve name to .playlite/libs/<name>.ts
 * 3. Verify the file exists (actionable error if not)
 * 4. Dynamically import the file via tsx (with host tsconfig for path aliases)
 * 5. Call the default export with `page`
 * 6. Return the resulting object
 */
export async function loadLib(name: string, page: Page): Promise<LibExports> {
  const playliteDir = findPlayliteDir();
  const libPath = join(playliteDir, 'libs', `${name}.ts`);

  if (!existsSync(libPath)) {
    throw new Error(
      `Lib '${name}' not found at ${libPath}`
    );
  }

  // Find nearest tsconfig for path alias support
  const tsconfig = findTsconfig(playliteDir);

  // Dynamically import the TypeScript lib file via tsx
  const mod = await importTs(libPath, tsconfig);

  if (typeof mod.default !== 'function') {
    throw new Error(
      `Lib '${name}' at ${libPath} must export a default function. ` +
      `Got: ${typeof mod.default}`
    );
  }

  const exports = await mod.default(page);

  if (typeof exports !== 'object' || exports === null) {
    throw new Error(
      `Lib '${name}' factory must return an object. Got: ${typeof exports}`
    );
  }

  return exports as LibExports;
}

/**
 * Load multiple libs, merging their exports (last-wins on collision).
 * Warns to stderr on name collisions.
 */
export async function loadLibs(names: string[], page: Page): Promise<LibExports> {
  const merged: LibExports = {};
  const sourceMap = new Map<string, string>(); // key → lib name that defined it

  for (const name of names) {
    const exports = await loadLib(name, page);

    for (const [key, value] of Object.entries(exports)) {
      if (key in merged) {
        const previousLib = sourceMap.get(key)!;
        console.error(
          `Warning: lib '${name}' overwrites '${key}' (previously defined by '${previousLib}')`
        );
      }
      merged[key] = value;
      sourceMap.set(key, name);
    }
  }

  return merged;
}
