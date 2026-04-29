/**
 * .playlite/ config resolution.
 *
 * Walks up from CWD to find the nearest .playlite/ directory and loads its
 * config.ts if present.
 */

import { existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { importTs } from './loader.js';
import { findSession } from './sessions.js';

export interface PlayliteConfig {
  /** Default CDP port (default: 9222) */
  port: number;
  /** Default browser profile directory */
  profile?: string;
  /** Default launch URL */
  url?: string;
  /** Extra browser launch args */
  args?: string[];
  /** Libs to always load (merged with CLI --lib flags; config libs come first) */
  libs?: string[];
}

const DEFAULT_CONFIG: PlayliteConfig = {
  port: 9222,
};

/**
 * Walk up from startDir (default: process.cwd()) looking for a directory
 * that contains a `.playlite/` subdirectory. Returns the absolute path to
 * the `.playlite/` directory itself.
 *
 * Throws with an actionable message if no `.playlite/` is found.
 */
export function findPlayliteDir(startDir?: string): string {
  let dir = resolve(startDir ?? process.cwd());

  // Walk up until we hit the filesystem root
  while (true) {
    const candidate = join(dir, '.playlite');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      break;
    }
    dir = parent;
  }

  throw new Error(
    'No .playlite/ directory found. Create one with: mkdir .playlite'
  );
}

/**
 * Find the nearest tsconfig.json starting from the given directory and
 * walking up. Returns the absolute path or null if not found.
 */
export function findTsconfig(startDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Parse and validate a port string. Exits with an error if invalid.
 */
export function parsePort(portStr: string): number {
  const port = parseInt(portStr, 10);
  if (isNaN(port)) {
    throw new Error(`Invalid port: "${portStr}"`);
  }
  return port;
}

/**
 * Resolve a port from `--port` and/or `--session` options.
 *
 * Precedence:
 *   1. `--session` (named session lookup) — highest
 *   2. `--port` (explicit port)
 *
 * If both are given, `--session` wins and a warning is printed to
 * stderr. If `--session` is given but the named session isn't
 * registered (or its process is dead), throws an actionable error.
 */
export function resolvePort(opts: { port?: string; session?: string }): number {
  if (opts.session) {
    if (opts.port !== undefined && opts.port !== '') {
      console.error(
        `Warning: both --session "${opts.session}" and --port "${opts.port}" given. ` +
        `Using --session.`
      );
    }
    const meta = findSession(opts.session);
    if (!meta) {
      throw new Error(
        `Session "${opts.session}" is not registered (or its browser is no longer running). ` +
        `Launch it with: playlite launch --name ${opts.session}`
      );
    }
    return meta.port;
  }
  if (opts.port === undefined || opts.port === '') {
    throw new Error('Either --port or --session is required.');
  }
  return parsePort(opts.port);
}

/**
 * Load and return the resolved config.
 *
 * 1. Find the .playlite/ directory
 * 2. If .playlite/config.ts exists, dynamically import it and merge with defaults
 * 3. If no config.ts, return defaults
 */
export async function loadConfig(): Promise<PlayliteConfig> {
  let playliteDir: string;
  try {
    playliteDir = findPlayliteDir();
  } catch (err) {
    if (err instanceof Error && err.message.includes('No .playlite/')) {
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }

  const configPath = join(playliteDir, 'config.ts');
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  // Dynamically import the config TS file via tsx
  const tsconfig = findTsconfig(playliteDir);
  const mod = await importTs(configPath, tsconfig);
  const userConfig: Partial<PlayliteConfig> = (mod.default ?? mod) as Partial<PlayliteConfig>;

  return { ...DEFAULT_CONFIG, ...userConfig };
}
