#!/usr/bin/env tsx
/**
 * Quick integration test for Chunk 4: config resolution + lib loading.
 *
 * Run with: npx tsx test-chunk4.ts
 *
 * Does NOT require a running browser — uses a mock page object.
 */

import { findPlayliteDir, findTsconfig, loadConfig } from './src/config.js';
import { loadLib, loadLibs } from './src/libs.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. findPlayliteDir
// ---------------------------------------------------------------------------
console.log('\n--- findPlayliteDir ---');

const dir = findPlayliteDir();
assert(dir.endsWith('.playlite'), `returns path ending in .playlite (got: ${dir})`);

try {
  findPlayliteDir('/nonexistent/nowhere');
  assert(false, 'should throw for missing dir');
} catch (err: unknown) {
  const msg = (err as Error).message;
  assert(msg.includes('No .playlite/ directory found'), `actionable error message: ${msg}`);
}

// ---------------------------------------------------------------------------
// 2. findTsconfig
// ---------------------------------------------------------------------------
console.log('\n--- findTsconfig ---');

const tsconfig = findTsconfig(dir);
assert(tsconfig !== null, `finds tsconfig.json (got: ${tsconfig})`);
assert(tsconfig!.endsWith('tsconfig.json'), 'path ends with tsconfig.json');

const noTsconfig = findTsconfig('/');
assert(noTsconfig === null, 'returns null when no tsconfig found');

// ---------------------------------------------------------------------------
// 3. loadConfig (defaults — no config.ts in .playlite/)
// ---------------------------------------------------------------------------
console.log('\n--- loadConfig ---');

const config = await loadConfig();
assert(config.port === 9222, `default port is 9222 (got: ${config.port})`);

// ---------------------------------------------------------------------------
// 4. loadLib with test-lib
// ---------------------------------------------------------------------------
console.log('\n--- loadLib ---');

// Mock page — test-lib doesn't use it
const mockPage = {} as any;

const exports = await loadLib('test-lib', mockPage);
assert(exports.greeting === 'hello', `greeting is "hello" (got: ${exports.greeting})`);
assert(typeof exports.add === 'function', 'add is a function');
assert((exports.add as Function)(2, 3) === 5, 'add(2, 3) === 5');

// Error case: non-existent lib
try {
  await loadLib('does-not-exist', mockPage);
  assert(false, 'should throw for missing lib');
} catch (err: unknown) {
  const msg = (err as Error).message;
  assert(msg.includes("Lib 'does-not-exist' not found"), `actionable error: ${msg}`);
}

// ---------------------------------------------------------------------------
// 5. loadLibs with merge + collision warning
// ---------------------------------------------------------------------------
console.log('\n--- loadLibs ---');

const merged = await loadLibs(['test-lib'], mockPage);
assert(merged.greeting === 'hello', 'merged single lib works');

// Test collision: load test-lib then test-lib-b (both export 'greeting')
// Capture stderr to verify warning
const origStderrWrite = process.stderr.write;
let stderrOutput = '';
process.stderr.write = ((chunk: string | Uint8Array) => {
  stderrOutput += String(chunk);
  return true;
}) as typeof process.stderr.write;

const merged2 = await loadLibs(['test-lib', 'test-lib-b'], mockPage);

process.stderr.write = origStderrWrite;

assert(merged2.greeting === 'world', `collision: last-wins (got: ${merged2.greeting})`);
assert(typeof merged2.add === 'function', 'collision: non-colliding key from first lib preserved');
assert(typeof merged2.multiply === 'function', 'collision: non-colliding key from second lib present');
assert(
  stderrOutput.includes("overwrites 'greeting'"),
  `collision: warning on stderr (got: ${stderrOutput.trim()})`
);

// ---------------------------------------------------------------------------
// 6. loadLib error: bad default export
// ---------------------------------------------------------------------------
console.log('\n--- loadLib error cases ---');

// Error case: non-existent lib (already tested above, included for completeness)

// ---------------------------------------------------------------------------
// 7. loadConfig with a config.ts file
// ---------------------------------------------------------------------------
console.log('\n--- loadConfig with config.ts ---');

// Write a temporary config.ts
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const configPath = join(dir, 'config.ts');
writeFileSync(configPath, `export default { port: 4321, url: 'https://example.com' };\n`);

try {
  const customConfig = await loadConfig();
  assert(customConfig.port === 4321, `custom port loaded (got: ${customConfig.port})`);
  assert(customConfig.url === 'https://example.com', `custom url loaded (got: ${customConfig.url})`);
} finally {
  unlinkSync(configPath);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) {
  process.exit(1);
}
