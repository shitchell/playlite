/**
 * .playlite/ config resolution.
 *
 * Walks up from CWD to find the nearest .playlite/ directory and loads its
 * config.ts if present.
 *
 * Implemented in Chunk 4.
 */

export interface PlayliteConfig {
  /** Default CDP port (default: 9222) */
  port: number;
  /** Default browser profile directory */
  profile?: string;
  /** Default launch URL */
  url?: string;
  /** Extra browser launch args */
  args?: string[];
}

const DEFAULT_CONFIG: PlayliteConfig = {
  port: 9222,
};

/**
 * Walk up from startDir (default: process.cwd()) looking for a .playlite/
 * directory. Returns the path if found, or null.
 */
export function findPlayliteDir(_startDir?: string): string | null {
  throw new Error('not implemented');
}

/**
 * Load and return the resolved config. Returns defaults if no config file
 * is found.
 */
export async function loadConfig(): Promise<PlayliteConfig> {
  return { ...DEFAULT_CONFIG };
}
