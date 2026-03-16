/**
 * `playlite run <script.ts>` — execute a TypeScript file with browser and lib
 * helpers injected into scope.
 *
 * Generates a temp wrapper that connects to the browser, loads any --lib libs,
 * and inlines the user's script code so that `page`, `browser`, `context`, and
 * all lib exports are available as local variables. Executed via tsx.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeWrapper } from '../runner.js';

export interface RunOptions {
  port: string;
  tab?: string;
  lib?: string[];
}

export async function run(script: string, options: RunOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }

  const scriptPath = resolve(script);
  if (!existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  executeWrapper({
    port,
    tab: options.tab,
    libs: options.lib ?? [],
    code: scriptPath,
    isFile: true,
  });
}
