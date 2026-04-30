/**
 * `playlite ls` — list active named sessions.
 *
 * Walks the session registry, verifies each entry's PID and CDP port
 * are still live, prunes the dead ones, and prints the live ones.
 */

import {
  isPidAlive,
  isPortReachable,
  listRegisteredSessions,
  removeSession,
  type SessionMeta,
} from '../sessions.js';

export interface LsOptions {
  json: boolean;
  format?: string;
}

interface LiveSession extends SessionMeta {
  alive: true;
  ageMs: number;
}

export async function ls(options: LsOptions): Promise<void> {
  const entries = listRegisteredSessions();
  const live: LiveSession[] = [];

  for (const meta of entries) {
    const pidAlive = isPidAlive(meta.pid);
    const portAlive = pidAlive && (await isPortReachable(meta.port));
    if (!pidAlive || !portAlive) {
      removeSession(meta.name);
      continue;
    }
    live.push({
      ...meta,
      alive: true,
      ageMs: Date.now() - new Date(meta.createdAt).getTime(),
    });
  }

  if (options.json || options.format === 'json') {
    // JSON contract = on-disk SessionMeta[] (D20). Drop the human-formatter-only
    // fields (alive is tautological for ls; ageMs is derivable from createdAt).
    const metaOnly: SessionMeta[] = live.map(({ alive: _a, ageMs: _b, ...meta }) => meta);
    console.log(JSON.stringify(metaOnly, null, 2));
    return;
  }

  if (live.length === 0) {
    console.error('No active sessions. Launch one with: playlite launch --name <label>');
    return;
  }

  // Human-readable table.
  const rows = live.map((s) => ({
    name: s.name,
    port: String(s.port),
    pid: String(s.pid),
    age: formatAge(s.ageMs),
  }));
  const headers = { name: 'NAME', port: 'PORT', pid: 'PID', age: 'AGE' };
  const all = [headers, ...rows];
  const widths = {
    name: Math.max(...all.map((r) => r.name.length)),
    port: Math.max(...all.map((r) => r.port.length)),
    pid: Math.max(...all.map((r) => r.pid.length)),
    age: Math.max(...all.map((r) => r.age.length)),
  };
  for (const r of all) {
    console.log(
      `${r.name.padEnd(widths.name)}  ${r.port.padEnd(widths.port)}  ` +
      `${r.pid.padEnd(widths.pid)}  ${r.age.padEnd(widths.age)}`
    );
  }
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}
