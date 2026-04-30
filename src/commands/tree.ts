/**
 * `playlite tree [selector]` — hierarchical DOM dump optimized for
 * LLM consumption.
 *
 * First slice of shitchell/playlite#8. Implements:
 *   - Empty-wrapper collapse
 *   - Class-stability filtering (Emotion / MUI / CSS-modules)
 *   - Implicit-role suppression
 *   - CSS-selector syntax for structure, "text" for content, bracketed
 *     load-bearing attrs
 *
 * Deferred to follow-up slices (per the issue's roadmap):
 *   - Repeated-sibling collapse (li.item × 12)
 *   - State markers ([disabled], [checked], …)
 *   - Shadow DOM / iframe boundary markers
 *   - --interactive / --text-only / --visible filters
 *   - --pretty mode (tree-drawing chars + color)
 *   - --format json
 *   - --max-text shape-preserving truncation (`/api/v2/wo/12345/…`)
 *
 * IR2 justification (in source): `page.evaluate` is required — DOM
 * traversal of this scope across N+1 individual Playwright queries
 * would be 10–100× slower for typical pages. The function is read-only
 * and runs in a single round trip.
 */

import { connectToBrowser, selectPage } from '../browser.js';
import { resolvePort } from '../config.js';

export interface TreeOptions {
  port: string;
  session?: string;
  wasPortGiven?: boolean;
  tab?: string;
  depth: string;
  showClasses: 'none' | 'stable' | 'all';
  collapse: boolean;
  maxText: string;
}

export async function tree(selector: string | undefined, options: TreeOptions): Promise<void> {
  const port = resolvePort(options);
  const depth = parseInt(options.depth, 10);
  if (isNaN(depth) || depth < 1) {
    throw new Error(`Invalid --depth: "${options.depth}"`);
  }
  const maxText = parseInt(options.maxText, 10);
  if (isNaN(maxText) || maxText < 1) {
    throw new Error(`Invalid --max-text: "${options.maxText}"`);
  }
  if (!['none', 'stable', 'all'].includes(options.showClasses)) {
    throw new Error(`--show-classes must be one of: none, stable, all`);
  }

  const { browser, context } = await connectToBrowser(port);
  try {
    const pages = context.pages();
    const page = await selectPage(pages, options.tab);
    const result = await page.evaluate(dumpTree, {
      selector: selector ?? 'body',
      depth,
      showClasses: options.showClasses,
      collapse: options.collapse,
      maxText,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    process.stdout.write(result.text);
  } finally {
    await browser.close();
  }
}

/**
 * Page-side serialization. Emits an indented tree of the matched
 * element and its descendants up to `depth`, with empty-wrapper
 * collapse and class filtering applied.
 *
 * Returns the rendered text (or an actionable error) to keep the
 * round-trip count to one — Playwright would otherwise pay per-node
 * overhead.
 */
function dumpTree(args: {
  selector: string;
  depth: number;
  showClasses: 'none' | 'stable' | 'all';
  collapse: boolean;
  maxText: number;
}): { ok: true; text: string } | { ok: false; error: string } {
  // -- self-contained helpers (must work inside page.evaluate) -----------

  const LOAD_BEARING_ATTRS = [
    'data-testid',
    'name',
    'placeholder',
    'href',
    'role',
    'aria-label',
    'type',
    'value',
    'for',
  ];

  // Drop generated/utility classes that don't help selector picking.
  const CSS_MODULES_RE = /^_[A-Za-z0-9]{5,}$/;
  const EMOTION_RE = /^css-[a-z0-9]+$/;
  // MUI generated suffix: keep the stable head, drop the trailing `-<digits>`.
  const MUI_SUFFIX_RE = /^(Mui[A-Z][A-Za-z]+(?:-[A-Za-z]+)?)-\d+$/;
  // Tailwind utility tokens (an indicative subset; "drop everything that
  // looks like a layout helper"). Conservative — keeps anything that
  // looks like a semantic class name.
  const TAILWIND_RE = new RegExp(
    '^(?:' +
      // sizing/spacing
      '[mp][trblxy]?-\\d+(?:\\.\\d+)?|' +
      'w-\\S+|h-\\S+|min-w-\\S+|min-h-\\S+|max-w-\\S+|max-h-\\S+|' +
      // flex/grid
      'flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|' +
      'flex-(?:row|col|wrap|nowrap|1|none|auto|initial)|' +
      'items-(?:start|end|center|baseline|stretch)|' +
      'justify-(?:start|end|center|between|around|evenly)|' +
      'gap-\\d+|space-[xy]-\\d+|' +
      // typography
      'text-(?:xs|sm|base|lg|xl|\\dxl|left|right|center|justify)|' +
      'font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)|' +
      // colors (light heuristic)
      '(?:bg|text|border|ring)-(?:white|black|gray|red|green|blue|yellow|purple|pink|indigo|emerald|slate|stone|neutral|zinc)-?\\d*|' +
      // borders/rounded/shadow
      'rounded(?:-\\S+)?|shadow(?:-\\S+)?|border(?:-\\S+)?|' +
      // positioning
      'absolute|relative|fixed|sticky|static|' +
      'top-\\S+|bottom-\\S+|left-\\S+|right-\\S+|inset-\\S+|' +
      // misc utilities
      'overflow-\\S+|cursor-\\S+|select-\\S+|pointer-events-\\S+|' +
      'transition(?:-\\S+)?|duration-\\d+|ease-\\S+' +
    ')$'
  );

  // Tag → implicit ARIA role. Used to suppress redundant [role=…].
  const IMPLICIT_ROLES: Record<string, string> = {
    a: 'link',
    button: 'button',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    table: 'table',
    tr: 'row',
    th: 'columnheader',
    td: 'cell',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    img: 'img',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    select: 'combobox',
    option: 'option',
    progress: 'progressbar',
    textarea: 'textbox',
  };

  function filterClass(c: string, mode: 'none' | 'stable' | 'all'): string | null {
    if (mode === 'none') return null;
    if (mode === 'all') return c;
    // 'stable':
    if (CSS_MODULES_RE.test(c)) return null;
    if (EMOTION_RE.test(c)) return null;
    if (TAILWIND_RE.test(c)) return null;
    const muiMatch = c.match(MUI_SUFFIX_RE);
    if (muiMatch) return muiMatch[1];
    return c;
  }

  function classList(el: Element, mode: 'none' | 'stable' | 'all'): string[] {
    if (mode === 'none') return [];
    const raw = el.getAttribute('class');
    if (!raw) return [];
    const parts = raw.split(/\s+/).filter(Boolean);
    const kept: string[] = [];
    for (const p of parts) {
      const filtered = filterClass(p, mode);
      if (filtered !== null) kept.push(filtered);
    }
    return kept;
  }

  function visibleText(el: Element, max: number): string | null {
    // Direct text content only — children get their own emit later.
    let t = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        t += child.textContent ?? '';
      }
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (t.length > max) t = t.slice(0, max - 1) + '…';
    return t;
  }

  function attrPairs(el: Element): string[] {
    const pairs: string[] = [];
    const tag = el.tagName.toLowerCase();
    const implicitRole = IMPLICIT_ROLES[tag];
    for (const attr of LOAD_BEARING_ATTRS) {
      const v = el.getAttribute(attr);
      if (v === null) continue;
      if (attr === 'role' && implicitRole && v === implicitRole) continue;
      pairs.push(`${attr}=${JSON.stringify(v)}`);
    }
    return pairs;
  }

  /**
   * "Empty wrapper" = a <div> or <span> with:
   *   - No id
   *   - No surviving classes after filter
   *   - No load-bearing attrs
   *   - No direct text
   *   - Exactly one element child
   * Such nodes are bypassed: their child takes their place at the same
   * indent level. Repeats while the conditions hold.
   */
  function unwrap(el: Element, mode: 'none' | 'stable' | 'all', maxText: number): Element {
    let cur: Element = el;
    while (true) {
      const tag = cur.tagName.toLowerCase();
      if (tag !== 'div' && tag !== 'span') return cur;
      if (cur.id) return cur;
      if (classList(cur, mode).length > 0) return cur;
      if (attrPairs(cur).length > 0) return cur;
      if (visibleText(cur, maxText) !== null) return cur;
      const elementChildren = Array.from(cur.children);
      if (elementChildren.length !== 1) return cur;
      // Also bail if there are non-empty text children mixed in (covered
      // above by visibleText, but defensive).
      cur = elementChildren[0];
    }
  }

  function describe(el: Element, mode: 'none' | 'stable' | 'all', maxText: number): string {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = classList(el, mode).map((c) => `.${c}`).join('');
    const attrs = attrPairs(el);
    const text = visibleText(el, maxText);
    const parts: string[] = [`${tag}${id}${cls}`];
    if (text) parts.push(JSON.stringify(text));
    if (attrs.length) parts.push(`[${attrs.join(', ')}]`);
    return parts.join(' ');
  }

  function emit(
    el: Element,
    indent: number,
    depth: number,
    mode: 'none' | 'stable' | 'all',
    collapse: boolean,
    maxText: number,
    out: string[]
  ): void {
    const effective = collapse ? unwrap(el, mode, maxText) : el;
    out.push('  '.repeat(indent) + describe(effective, mode, maxText));
    if (depth <= 0) return;
    for (const child of Array.from(effective.children)) {
      emit(child, indent + 1, depth - 1, mode, collapse, maxText, out);
    }
  }

  // -- entry point -------------------------------------------------------

  const root = document.querySelector(args.selector);
  if (!root) {
    return { ok: false, error: `Selector "${args.selector}" matched no element.` };
  }

  const out: string[] = [];
  emit(root, 0, args.depth, args.showClasses, args.collapse, args.maxText, out);
  return { ok: true, text: out.join('\n') + '\n' };
}
