/**
 * TypeScript dynamic import via tsx.
 *
 * Uses tsx's programmatic ESM API (tsImport) to dynamically import .ts files
 * at runtime without requiring --import flags at process startup.
 *
 * Supports tsconfig path aliases from the host project.
 */

import { pathToFileURL } from 'node:url';

/**
 * Dynamically import a TypeScript file using tsx.
 *
 * @param filePath  - Absolute path to the .ts file to import
 * @param tsconfig  - Optional absolute path to a tsconfig.json for path alias resolution
 * @returns The imported module
 */
export async function importTs(filePath: string, tsconfig?: string | null): Promise<Record<string, unknown>> {
  // tsx/esm/api is an ESM-only export — import it dynamically to avoid
  // issues if this module is somehow loaded in a CJS context.
  const { tsImport } = await import('tsx/esm/api');

  const fileUrl = pathToFileURL(filePath).href;

  const mod = await tsImport(fileUrl, {
    parentURL: import.meta.url,
    ...(tsconfig ? { tsconfig } : {}),
  });

  return mod;
}
