/**
 * Named-session registry.
 *
 * Sessions launched via `playlite launch --name <label>` register a
 * metadata file at `~/.playlite/sessions/<name>/meta.json`. Other
 * commands resolve `--session <label>` to the registered port via
 * {@link findSession}. Anonymous (no `--name`) launches are unaffected
 * — they neither read nor write this registry.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

export interface SessionMeta {
  name: string;
  port: number;
  pid: number;
  createdAt: string;
  profile?: string;
  headless?: boolean;
}

const SESSION_NAME_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;

/** Root directory for the session registry. */
export function sessionsRoot(): string {
  return join(homedir(), '.playlite', 'sessions');
}

/** Directory for a single session. */
export function sessionDir(name: string): string {
  return join(sessionsRoot(), name);
}

/** Metadata file path for a single session. */
export function sessionMetaPath(name: string): string {
  return join(sessionDir(name), 'meta.json');
}

/**
 * Validate a session name. Names become directory names, so they're
 * restricted to a portable filesystem-friendly subset.
 */
export function assertValidSessionName(name: string): void {
  if (!SESSION_NAME_RE.test(name)) {
    throw new Error(
      `Invalid session name "${name}". Names must start with [A-Za-z0-9_-] ` +
      `and contain only [A-Za-z0-9_.-].`
    );
  }
}

/**
 * Register a new session. Throws if a session with the same name
 * already exists in the registry (whether or not it's still alive —
 * the caller should call {@link findSession} first if they want to
 * recover from a stale entry).
 */
export function registerSession(meta: SessionMeta): void {
  assertValidSessionName(meta.name);
  const dir = sessionDir(meta.name);
  if (existsSync(dir)) {
    throw new Error(
      `Session "${meta.name}" already registered at ${dir}. ` +
      `Use a different --name, or run: playlite kill ${meta.name}`
    );
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(sessionMetaPath(meta.name), JSON.stringify(meta, null, 2) + '\n');
}

/**
 * Read a session's metadata from disk without verifying liveness.
 * Returns null if no such session is registered.
 */
export function readSessionMeta(name: string): SessionMeta | null {
  const path = sessionMetaPath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SessionMeta;
  } catch {
    return null;
  }
}

/** Remove a session's directory from the registry. Idempotent. */
export function removeSession(name: string): void {
  const dir = sessionDir(name);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** True if a process with this PID is alive (POSIX `kill -0`). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = no such process. EPERM = process exists, we just can't
    // signal it (still counts as alive for our purposes).
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

/**
 * True if the CDP endpoint at the given port is reachable. Uses a
 * short-timeout HTTP probe of `/json/version` (Chrome's CDP discovery
 * endpoint) to distinguish "port closed" from "port open but not CDP".
 */
export async function isPortReachable(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/json/version', method: 'GET', timeout: timeoutMs },
      (res) => {
        // Drain response body to free the socket.
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Look up a session by name. Returns the metadata if the session is
 * registered AND its PID is still alive. Returns null otherwise; if
 * the entry was registered but the PID is dead, the entry is pruned
 * before returning null. (Liveness check is PID-only here for speed —
 * port reachability is checked by `playlite ls` which is the
 * user-facing observability command.)
 */
export function findSession(name: string): SessionMeta | null {
  const meta = readSessionMeta(name);
  if (!meta) return null;
  if (!isPidAlive(meta.pid)) {
    removeSession(name);
    return null;
  }
  return meta;
}

/**
 * Enumerate every entry currently in the session registry, regardless
 * of liveness. Used by `playlite ls` which then verifies each entry
 * and prunes the dead ones.
 */
export function listRegisteredSessions(): SessionMeta[] {
  const root = sessionsRoot();
  if (!existsSync(root)) return [];
  const entries: SessionMeta[] = [];
  for (const name of readdirSync(root).sort()) {
    const meta = readSessionMeta(name);
    if (meta) entries.push(meta);
  }
  return entries;
}
