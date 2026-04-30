/**
 * Per-session command history.
 *
 * When a connect-style command is invoked with `--session <name>`, the
 * invocation is logged to `~/.playlite/sessions/<name>/history.jsonl`
 * (one JSON object per line). Anonymous (`--port`-only) invocations
 * are NOT logged — there's no session to key off, and skipping logging
 * keeps the existing port-only workflow zero-overhead.
 *
 * `playlite history <name>` reads back the file (full or tail), or
 * truncates it with `--clear`.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sessionDir } from './sessions.js';

export interface HistoryEntry {
  /** ISO-8601 UTC timestamp of when the command started. */
  ts: string;
  /** Subcommand name (e.g., "navigate", "eval"). */
  cmd: string;
  /** Positional args passed to the command, in order. */
  args: unknown[];
  /** Selected option values relevant to reproducing the call. */
  opts: Record<string, unknown>;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** True if the command's action handler resolved without throwing. */
  ok: boolean;
  /** Error message (no stack) if `ok: false`. */
  error?: string;
}

/** Path to a session's history file. */
export function historyPath(sessionName: string): string {
  return `${sessionDir(sessionName)}/history.jsonl`;
}

/**
 * Append one entry to a session's history file. No-op if the session
 * directory doesn't exist — we never auto-create session dirs from
 * the history layer, since that would manufacture phantom sessions
 * for typos and other invalid `--session` values.
 *
 * Failures here are best-effort: history is observability, not the
 * primary action. Logging errors are printed to stderr but don't
 * propagate.
 */
export function appendHistory(sessionName: string, entry: HistoryEntry): void {
  if (!existsSync(sessionDir(sessionName))) {
    return;
  }
  try {
    appendFileSync(historyPath(sessionName), JSON.stringify(entry) + '\n');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Warning: failed to log history for session "${sessionName}": ${message}`);
  }
}

/**
 * Read every history entry for a session. Returns [] if the session
 * has no history file. Skips malformed lines silently (forward-compat
 * for future entry-shape changes).
 */
export function readHistory(sessionName: string): HistoryEntry[] {
  const path = historyPath(sessionName);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n');
  const out: HistoryEntry[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as HistoryEntry);
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
}

/** Truncate the history file. No-op if it doesn't exist. */
export function clearHistory(sessionName: string): void {
  const path = historyPath(sessionName);
  if (existsSync(path)) {
    writeFileSync(path, '');
  }
}

/**
 * Run an action and log the invocation if a session name was given.
 * Catches and re-throws errors so the caller's CLI behavior is
 * preserved exactly.
 */
export async function withHistory<T>(
  cmd: string,
  args: unknown[],
  opts: Record<string, unknown> & { session?: string },
  fn: () => Promise<T>
): Promise<T> {
  const sessionName = opts.session;
  if (!sessionName) {
    return await fn();
  }

  // Strip session+port from logged opts — the session name is already
  // the file's key, and port is recoverable from the session metadata.
  const { session: _s, port: _p, ...loggedOpts } = opts;
  const ts = new Date().toISOString();
  const start = Date.now();
  try {
    const result = await fn();
    appendHistory(sessionName, {
      ts,
      cmd,
      args,
      opts: loggedOpts,
      durationMs: Date.now() - start,
      ok: true,
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendHistory(sessionName, {
      ts,
      cmd,
      args,
      opts: loggedOpts,
      durationMs: Date.now() - start,
      ok: false,
      error: message,
    });
    throw err;
  }
}
