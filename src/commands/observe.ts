/**
 * `playlite observe` — stream DOM mutations from the connected page
 * in real time.
 *
 * Installs a MutationObserver on the page (either `document.body` /
 * `document.documentElement` or a `--root` subtree) and bridges each
 * mutation back to the CLI via `page.exposeFunction`. Prints one
 * formatted line per mutation until Ctrl+C or `--duration` elapses.
 *
 * IR2 justification: no native Playwright API exposes MutationObserver
 * events to Node-land. `page.evaluate` is required to install the
 * observer in page context; `page.exposeFunction` is the canonical
 * Playwright mechanism for streaming results back without polling.
 */

import { connectToBrowser, selectPage } from '../browser.js';
import { parsePort } from '../config.js';

export interface ObserveOptions {
  port: string;
  tab?: string;
  root?: string;
  childList: boolean;
  attributes: boolean;
  characterData: boolean;
  subtree: boolean;
  attributeFilter?: string[];
  duration?: string;
  json: boolean;
}

/**
 * Page-side mutation record. Mirrors what the in-page script
 * serializes; kept narrow on purpose so we don't pay the cost of
 * arbitrary node graphs over the bridge.
 */
interface MutationRecordLite {
  type: 'childList' | 'attributes' | 'characterData';
  target: string;
  attributeName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  addedNodes?: string[];
  removedNodes?: string[];
}

export async function observe(options: ObserveOptions): Promise<void> {
  const port = parsePort(options.port);
  const { browser, context } = await connectToBrowser(port);

  let durationMs: number | undefined;
  if (options.duration !== undefined) {
    durationMs = parseInt(options.duration, 10);
    if (isNaN(durationMs) || durationMs <= 0) {
      throw new Error(`Invalid --duration: "${options.duration}"`);
    }
  }

  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);

    let count = 0;
    await page.exposeFunction('__playliteMutation', (record: MutationRecordLite) => {
      count++;
      if (options.json) {
        console.log(JSON.stringify(record));
      } else {
        console.log(formatRecord(record));
      }
    });

    const installed = await page.evaluate(installObserver, {
      root: options.root,
      config: {
        childList: options.childList,
        attributes: options.attributes,
        characterData: options.characterData,
        subtree: options.subtree,
        attributeOldValue: options.attributes,
        characterDataOldValue: options.characterData,
        attributeFilter: options.attributeFilter,
      },
    });

    if (!installed.ok) {
      throw new Error(installed.error);
    }
    console.error(
      `Observing ${installed.targetDescription}. ` +
      (durationMs ? `Auto-stop in ${durationMs}ms.` : 'Press Ctrl+C to stop.')
    );

    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      if (durationMs !== undefined) {
        setTimeout(stop, durationMs);
      }
    });

    // Best-effort teardown — page may have navigated/closed by now.
    await page.evaluate(uninstallObserver).catch(() => {});

    console.error(`Observed ${count} mutation(s).`);
  } finally {
    await browser.close();
  }
}

/**
 * Installed in page context. Sets up the observer and bridges each
 * mutation to the Node-side callback exposed via
 * `page.exposeFunction`. Returns metadata about the install for the
 * caller to surface (target description, error if the root selector
 * didn't match, etc.).
 */
function installObserver(args: {
  root?: string;
  config: MutationObserverInit;
}): { ok: true; targetDescription: string } | { ok: false; error: string } {
  type MutationBridge = (record: MutationRecordLite) => void;
  interface MutationRecordLite {
    type: 'childList' | 'attributes' | 'characterData';
    target: string;
    attributeName?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    addedNodes?: string[];
    removedNodes?: string[];
  }
  interface PlayliteWindow extends Window {
    __playliteMutation?: MutationBridge;
    __playliteObserver?: MutationObserver;
  }
  const w = window as unknown as PlayliteWindow;

  let target: Node;
  let targetDescription: string;
  if (args.root) {
    const found = document.querySelector(args.root);
    if (!found) {
      return { ok: false, error: `--root "${args.root}" matched no element.` };
    }
    target = found;
    targetDescription = `subtree of ${args.root}`;
  } else {
    target = document.documentElement;
    targetDescription = 'whole document';
  }

  // Best-effort: short selector-ish description for a node. Not a
  // full CSS path — just enough to identify it in a stream of
  // events. Picks tag + id + first stable-ish class.
  function describe(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').trim().slice(0, 40);
      return `#text "${t}"`;
    }
    if (!(node instanceof Element)) {
      return `node[${node.nodeType}]`;
    }
    let s = node.tagName.toLowerCase();
    if (node.id) s += `#${node.id}`;
    const cls = (node.className && typeof node.className === 'string'
      ? node.className.split(/\s+/).filter(Boolean)
      : []
    ).slice(0, 3);
    for (const c of cls) s += `.${c}`;
    return s;
  }

  const bridge = w.__playliteMutation;
  if (!bridge) {
    return { ok: false, error: 'Internal: __playliteMutation bridge not exposed.' };
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        const newValue =
          r.target instanceof Element && r.attributeName
            ? r.target.getAttribute(r.attributeName)
            : null;
        bridge({
          type: 'attributes',
          target: describe(r.target),
          attributeName: r.attributeName,
          oldValue: r.oldValue,
          newValue,
        });
      } else if (r.type === 'characterData') {
        bridge({
          type: 'characterData',
          target: describe(r.target),
          oldValue: r.oldValue,
          newValue: r.target.textContent,
        });
      } else if (r.type === 'childList') {
        const added = Array.from(r.addedNodes).map(describe);
        const removed = Array.from(r.removedNodes).map(describe);
        bridge({
          type: 'childList',
          target: describe(r.target),
          addedNodes: added,
          removedNodes: removed,
        });
      }
    }
  });

  observer.observe(target, args.config);
  w.__playliteObserver = observer;
  return { ok: true, targetDescription };
}

/** Disconnect and remove the page-side observer. Tolerant of repeat calls. */
function uninstallObserver(): void {
  interface PlayliteWindow extends Window {
    __playliteObserver?: MutationObserver;
  }
  const w = window as unknown as PlayliteWindow;
  if (w.__playliteObserver) {
    w.__playliteObserver.disconnect();
    delete w.__playliteObserver;
  }
}

/** Render a mutation record as a one-line human-readable summary. */
function formatRecord(r: { type: string; target: string; attributeName?: string | null; oldValue?: string | null; newValue?: string | null; addedNodes?: string[]; removedNodes?: string[] }): string {
  const t = r.target.padEnd(40);
  if (r.type === 'attributes') {
    const name = r.attributeName ?? '?';
    const old = JSON.stringify(r.oldValue ?? null);
    const next = JSON.stringify(r.newValue ?? null);
    return `[ATTR]  ${t}  ${name}: ${old} → ${next}`;
  }
  if (r.type === 'characterData') {
    const old = JSON.stringify(r.oldValue ?? null);
    const next = JSON.stringify(r.newValue ?? null);
    return `[TEXT]  ${t}  ${old} → ${next}`;
  }
  if (r.type === 'childList') {
    const adds = (r.addedNodes ?? []).map((n) => `+ ${n}`).join('  ');
    const dels = (r.removedNodes ?? []).map((n) => `- ${n}`).join('  ');
    const tail = [adds, dels].filter(Boolean).join('  ');
    return `[CHILD] ${t}  ${tail}`;
  }
  return `[?]     ${t}  ${JSON.stringify(r)}`;
}
