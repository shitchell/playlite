/**
 * `playlite history <name>` — dump the per-session command history.
 *
 * Default: human-readable lines (timestamp · cmd args). With `--json`,
 * prints raw JSONL exactly as stored. With `-n <N>`, prints the last
 * N entries. With `--clear`, truncates the file (mutually exclusive
 * with reading flags).
 */

import { clearHistory, readHistory, type HistoryEntry } from '../history.js';
import { readSessionMeta } from '../sessions.js';

export interface HistoryOptions {
  json: boolean;
  format?: string;
  n?: string;
  clear: boolean;
}

export async function history(name: string, options: HistoryOptions): Promise<void> {
  // Validate the session is known. We don't require the session to
  // still be alive — history is post-hoc; users may want to inspect it
  // after the browser is gone (and before the entry is pruned).
  const meta = readSessionMeta(name);
  if (!meta) {
    throw new Error(`Session "${name}" is not registered.`);
  }

  if (options.clear) {
    clearHistory(name);
    console.error(`Cleared history for session "${name}".`);
    return;
  }

  let entries = readHistory(name);

  if (options.n !== undefined) {
    const n = parseInt(options.n, 10);
    if (isNaN(n) || n < 0) {
      throw new Error(`Invalid -n value: "${options.n}"`);
    }
    entries = entries.slice(-n);
  }

  if (options.json || options.format === 'json') {
    for (const e of entries) {
      console.log(JSON.stringify(e));
    }
    return;
  }

  if (entries.length === 0) {
    console.error(`No history for session "${name}".`);
    return;
  }

  for (const e of entries) {
    console.log(formatEntry(e));
  }
}

/**
 * Render an entry as a single human-readable line:
 *   2026-04-29T02:30:00Z  ✓  navigate "https://example.com"  (145ms)
 *
 * Long arg strings are truncated to keep the line scannable; the JSON
 * form remains the source of truth for full data.
 */
function formatEntry(e: HistoryEntry): string {
  const ok = e.ok ? '✓' : '✗';
  const args = e.args
    .map((a) => (typeof a === 'string' ? quoteAndTrim(a) : JSON.stringify(a)))
    .join(' ');
  const optsBits: string[] = [];
  for (const [k, v] of Object.entries(e.opts)) {
    if (v === undefined || v === false || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'lib' && Array.isArray(v)) {
      optsBits.push(`--lib ${v.join(',')}`);
      continue;
    }
    if (typeof v === 'boolean') {
      optsBits.push(`--${k}`);
      continue;
    }
    optsBits.push(`--${k} ${JSON.stringify(v)}`);
  }
  const opts = optsBits.length ? '  ' + optsBits.join(' ') : '';
  const tail = e.ok ? `(${e.durationMs}ms)` : `(${e.durationMs}ms — ${e.error ?? 'error'})`;
  return `${e.ts}  ${ok}  ${e.cmd} ${args}${opts}  ${tail}`.trimEnd();
}

function quoteAndTrim(s: string, max = 80): string {
  const truncated = s.length > max ? s.slice(0, max - 1) + '…' : s;
  return JSON.stringify(truncated);
}
