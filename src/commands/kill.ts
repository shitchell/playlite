/**
 * `playlite kill <name>` — terminate a named session and remove its
 * registry entry. Sends SIGTERM to the registered PID; the launch
 * process is responsible for cleaning up the registry entry on
 * shutdown, but we also remove it here as a fallback in case the
 * launch process can't or won't.
 */

import { isPidAlive, readSessionMeta, removeSession } from '../sessions.js';

export interface KillOptions {
  /** Send SIGKILL instead of SIGTERM. */
  force: boolean;
}

export async function kill(name: string, options: KillOptions): Promise<void> {
  const meta = readSessionMeta(name);
  if (!meta) {
    throw new Error(`Session "${name}" is not registered.`);
  }

  const signal = options.force ? 'SIGKILL' : 'SIGTERM';

  if (isPidAlive(meta.pid)) {
    try {
      process.kill(meta.pid, signal);
      console.error(`Sent ${signal} to ${name} (pid ${meta.pid})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to signal pid ${meta.pid}: ${message}`);
    }
  } else {
    console.error(`Session "${name}" was already dead — pruning registry entry.`);
  }

  // Remove the registry entry. The launch process's `finally` should
  // also remove it, but doing it here makes the result observable
  // immediately even if the launch process is slow to shut down.
  removeSession(name);
}
