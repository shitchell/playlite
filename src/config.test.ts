import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parsePort, findPlayliteDir, findTsconfig } from './config.js';

// Track temp dirs for cleanup
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'playlite-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('parsePort', () => {
  it('parses a valid port string', () => {
    assert.equal(parsePort('9222'), 9222);
  });

  it('parses zero as a valid port', () => {
    assert.equal(parsePort('0'), 0);
  });

  it('parses 443 as a valid port', () => {
    assert.equal(parsePort('443'), 443);
  });

  it('throws on non-numeric string', () => {
    assert.throws(() => parsePort('abc'), {
      message: /Invalid port/,
    });
  });

  it('throws on empty string', () => {
    assert.throws(() => parsePort(''), {
      message: /Invalid port/,
    });
  });
});

describe('findPlayliteDir', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds .playlite/ in the start directory', () => {
    const tmp = createTempDir();
    const playliteDir = join(tmp, '.playlite');
    mkdirSync(playliteDir);

    const result = findPlayliteDir(tmp);
    assert.equal(result, playliteDir);
  });

  it('walks up to find .playlite/ in a parent directory', () => {
    const tmp = createTempDir();
    const playliteDir = join(tmp, '.playlite');
    mkdirSync(playliteDir);

    const deepDir = join(tmp, 'child', 'deep');
    mkdirSync(deepDir, { recursive: true });

    const result = findPlayliteDir(deepDir);
    assert.equal(result, playliteDir);
  });

  it('throws when no .playlite/ directory exists', () => {
    const tmp = createTempDir();
    // No .playlite/ created — should throw
    assert.throws(() => findPlayliteDir(tmp), {
      message: /No .playlite\/ directory found/,
    });
  });
});

describe('findTsconfig', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds tsconfig.json in the start directory', () => {
    const tmp = createTempDir();
    const tsconfigPath = join(tmp, 'tsconfig.json');
    writeFileSync(tsconfigPath, '{}');

    const result = findTsconfig(tmp);
    assert.equal(result, tsconfigPath);
  });

  it('walks up to find tsconfig.json in a parent directory', () => {
    const tmp = createTempDir();
    const tsconfigPath = join(tmp, 'tsconfig.json');
    writeFileSync(tsconfigPath, '{}');

    const deepDir = join(tmp, 'child', 'deep');
    mkdirSync(deepDir, { recursive: true });

    const result = findTsconfig(deepDir);
    assert.equal(result, tsconfigPath);
  });

  it('returns null when no tsconfig.json exists in the tree', () => {
    const tmp = createTempDir();
    // Create a deeply nested dir to start from, ensuring we do not
    // accidentally pick up a tsconfig.json from the real filesystem above tmp.
    // mkdtempSync already gives us an isolated path under /tmp, and the walk
    // will reach "/" without finding one (unless the system root has one,
    // which is extremely unlikely).
    const deepDir = join(tmp, 'a', 'b', 'c');
    mkdirSync(deepDir, { recursive: true });

    const result = findTsconfig(deepDir);
    assert.equal(result, null);
  });
});
