/**
 * fact-guard.ts — THE NO-FABRICATED-FACT LAW for AI-generated boards.
 *
 * WHY THIS EXISTS (2026-08-25, operator incident). A 7-turn concierge chat on a
 * QSR-vertical tenant produced a board carrying a full invented price list —
 * "Burger $2.99 / Griddled, melty, craveable", "Fries $3.00", "Shake $5.00" and
 * a "DEAL · 2 for $6 · All Day" starburst. Nobody had told us a single price.
 * Those numbers came out of the prompt layer (the QSR voice playbook literally
 * shipped `GOLD: "2 for $6, All Day"` as an exemplar, and the designer system
 * prompt told the model to "invent … believable items/offers"), and nothing
 * downstream checked them.
 *
 * A price on a customer-facing screen is a CLAIM. An invented one is worse than
 * an empty zone: it is wrong at a glance, in public, in the venue's own voice.
 * This product already holds that line elsewhere — the fitness board's music
 * source note says the board "will not invent a now-playing track" (see
 * MediaSourcePicker.tsx), the art-director omits `targetDate` rather than fake a
 * countdown, and auto-grounding pulls REAL catalog rows "not invented ones".
 * This module is that same law, enforced deterministically instead of hoped for.
 *
 * THE RULE
 *   A currency amount (or an "N% off" discount claim) may appear on a generated
 *   board ONLY if that number came from the operator: their brief, their chat,
 *   the REAL CONTENT block, the auto-grounded catalog, or the scraped reference.
 *   Anything else is dropped — the priced ROW goes, and if that empties the list
 *   the container gets an explicit empty state. Never sample data. Never an
 *   invented number.
 *
 * PURE — no Nest, no Prisma, no network, no DOM. Unit-tested in fact-guard.spec.ts.
 */

// ───────────────────────────────────────────────────────────────────────────
// 1. GROUNDED FACTS — every number the operator actually gave us.
// ───────────────────────────────────────────────────────────────────────────

/** Normalized numeric claims the operator supplied (e.g. "6", "4.99", "3"). */
export interface GroundedFacts {
  amounts: Set<string>;
}

/** Any number-ish run: 6 · 4.99 · 1,299.00 · 12.5 */
const NUMBER_RE = /\d[\d,]*(?:\.\d{1,2})?/g;

/**
 * A currency CLAIM in generated content. Deliberately narrow: only amounts that
 * are unambiguously money (a currency symbol / currency word) or an explicit
 * "N% off" discount. Times ("6 PM"), counts ("12 spots left"), dates and street
 * numbers are NOT money and are NOT touched here — over-reach would gut good
 * boards, and the prompt-side law covers the rest.
 */
const MONEY_CLAIM_RE =
  /(?:[$€£¥₹]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|dollars?|bucks)\b)|(?:\d[\d,]*(?:\.\d{1,2})?\s?(?:%|percent)\s*(?:off|discount))/gi;

/** Normalize a numeric run to a comparable key: "$4.50" → "4.5", "1,299.00" → "1299". */
export function normalizeAmount(raw: string): string | null {
  const digits = String(raw || '').replace(/[^\d.]/g, '');
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

/**
 * Harvest every number the operator supplied. PERMISSIVE on purpose — a bare
 * "6" in the brief grounds "$6" on the board. False negatives here would drop a
 * REAL price, which is the one failure mode worse than being slightly lenient.
 */
export function collectGroundedFacts(sources: Array<string | null | undefined>): GroundedFacts {
  const amounts = new Set<string>();
  for (const src of sources) {
    if (typeof src !== 'string' || !src) continue;
    const matches = src.match(NUMBER_RE);
    if (!matches) continue;
    for (const m of matches) {
      const key = normalizeAmount(m);
      if (key) amounts.add(key);
    }
  }
  return { amounts };
}

/** True when this money/discount claim traces back to something the operator gave us. */
export function isGrounded(claim: string, facts: GroundedFacts): boolean {
  const key = normalizeAmount(claim);
  if (!key) return true; // unparseable → not a claim we can police; leave it alone
  return facts.amounts.has(key);
}

/** Every money/discount claim in a plain-text run that the operator never supplied. */
export function findUngroundedClaims(text: string, facts: GroundedFacts): string[] {
  const out: string[] = [];
  const src = String(text || '');
  MONEY_CLAIM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY_CLAIM_RE.exec(src)) !== null) {
    if (!isGrounded(m[0], facts)) out.push(m[0]);
  }
  return out;
}

/** True when the text carries at least one money/discount claim we cannot vouch for. */
export function hasUngroundedClaim(text: string | null | undefined, facts: GroundedFacts): boolean {
  return findUngroundedClaims(String(text || ''), facts).length > 0;
}

/**
 * Remove ungrounded money claims from a copy string and tidy the wreckage
 * (dangling separators / doubled spaces). Used on the ENGINE path where a
 * required field (a headline) cannot simply be deleted.
 */
export function stripUngroundedMoney(text: string, facts: GroundedFacts): string {
  const src = String(text || '');
  if (!src) return src;
  let out = src.replace(MONEY_CLAIM_RE, (m) => (isGrounded(m, facts) ? m : ' '));
  if (out === src) return src;
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s\-–—·|,;:]+/, '')
    .replace(/[\s\-–—·|,;:]+$/, '')
    .trim();
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. ENGINE PATH — art-director `copy` (items become menu/grid rows).
// ───────────────────────────────────────────────────────────────────────────

interface CopyItemLike {
  label?: string;
  value?: string;
  detail?: string;
  [k: string]: unknown;
}

interface CopyLike {
  kicker?: string;
  headline?: string;
  body?: string;
  cta?: string;
  items?: CopyItemLike[];
  [k: string]: unknown;
}

export interface CopyGuardResult<T> {
  copy: T;
  /** The claims we refused to render — logged + audited, never silent. */
  dropped: string[];
}

/**
 * Enforce the law on an art-director spec's `copy`.
 *
 *   - An ITEM whose label/value/detail carries an ungrounded price is DROPPED
 *     WHOLE. A priced row whose price we invented is a fabricated row; keeping
 *     the name and blanking the price would just move the lie. Dropping the item
 *     is enough — art-director.ts already skips empty text zones, so the row
 *     simply does not exist on the board.
 *   - An OPTIONAL copy field (kicker / body / cta) carrying one is DROPPED.
 *   - The REQUIRED headline has the claim STRIPPED in place (it cannot be
 *     deleted); if that leaves nothing, the headline goes empty rather than
 *     ship a number we made up.
 */
export function enforceGroundedFactsInCopy<T extends CopyLike>(
  copy: T,
  facts: GroundedFacts,
): CopyGuardResult<T> {
  const dropped: string[] = [];
  const next: CopyLike = { ...copy };

  if (Array.isArray(copy.items)) {
    const kept: CopyItemLike[] = [];
    for (const item of copy.items) {
      const blob = [item?.label, item?.value, item?.detail].filter(Boolean).join(' ');
      const bad = findUngroundedClaims(blob, facts);
      if (bad.length) {
        dropped.push(...bad);
        continue;
      }
      kept.push(item);
    }
    next.items = kept;
  }

  for (const field of ['kicker', 'body', 'cta'] as const) {
    const v = copy[field];
    if (typeof v !== 'string' || !v) continue;
    const bad = findUngroundedClaims(v, facts);
    if (bad.length) {
      dropped.push(...bad);
      delete next[field];
    }
  }

  if (typeof copy.headline === 'string' && copy.headline) {
    const bad = findUngroundedClaims(copy.headline, facts);
    if (bad.length) {
      dropped.push(...bad);
      const stripped = stripUngroundedMoney(copy.headline, facts);
      next.headline = stripped.length >= 3 ? stripped : '';
    }
  }

  return { copy: next as T, dropped };
}

// ───────────────────────────────────────────────────────────────────────────
// 3. DESIGNER PATH — raw model-authored HTML.
//
// The designer path hands back a whole HTML document, so the law has to be
// enforced structurally. A tiny tag-balanced walker (no new dependency; the
// input has already been through sanitizeDesignerHtml, so there are no scripts,
// no event handlers, and no nested frames) locates the element that renders an
// ungrounded price, walks up to its ROW, and removes the row.
// ───────────────────────────────────────────────────────────────────────────

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Never removable, whatever they contain. */
const STRUCTURAL_TAGS = new Set(['html', 'head', 'body', 'style', 'title']);

/**
 * A drop target must be a ROW, not a region. 200 chars is comfortably above a
 * priced menu row ("Brown Sugar Oat Latte · house syrup · oat milk · $5.75") and
 * far below a content column, so the walk can never eat the board.
 */
const ROW_TEXT_MAX = 200;

/** The honest empty state — an authoring affordance, never a claim. */
export const EMPTY_ITEMS_HTML =
  '<div data-vos-empty="1" data-field="items.empty" style="opacity:0.72;font-style:italic">Add your items and prices</div>';

interface HtmlNode {
  tag: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  parent: number;
  children: number[];
  closed: boolean;
}

/** Decode the handful of entities that can hide a currency symbol or separator. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#0*36;|&dollar;/gi, '$')
    .replace(/&#0*163;|&pound;/gi, '£')
    .replace(/&#0*8364;|&euro;/gi, '€')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d{1,5});/g, (_m, d: string) => {
      const code = Number(d);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    });
}

/** Parse into a flat node list with parent/child links. Tolerant of bad markup. */
function parseHtmlNodes(html: string): HtmlNode[] {
  const nodes: HtmlNode[] = [];
  const stack: number[] = [];
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const raw = m[0];
    if (raw.startsWith('<!--')) continue;
    const tag = (m[1] || '').toLowerCase();
    const isClose = raw[1] === '/';
    const selfClosing = /\/>\s*$/.test(raw) || VOID_TAGS.has(tag);

    // <style> content can contain '<' — skip straight past its close tag.
    if (!isClose && (tag === 'style' || tag === 'script')) {
      const close = html.toLowerCase().indexOf(`</${tag}`, tagRe.lastIndex);
      if (close !== -1) {
        const end = html.indexOf('>', close);
        tagRe.lastIndex = end === -1 ? html.length : end + 1;
      }
      continue;
    }

    if (isClose) {
      // Find the nearest matching open on the stack (tolerates stray closes).
      let found = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (nodes[stack[i]].tag === tag) { found = i; break; }
      }
      if (found === -1) continue;
      const idx = stack[found];
      nodes[idx].closeStart = m.index;
      nodes[idx].closeEnd = tagRe.lastIndex;
      nodes[idx].closed = true;
      stack.length = found; // implicitly closes anything left unclosed inside
      continue;
    }

    if (selfClosing) continue;

    const node: HtmlNode = {
      tag,
      openStart: m.index,
      openEnd: tagRe.lastIndex,
      closeStart: -1,
      closeEnd: -1,
      parent: stack.length ? stack[stack.length - 1] : -1,
      children: [],
      closed: false,
    };
    const idx = nodes.push(node) - 1;
    if (node.parent >= 0) nodes[node.parent].children.push(idx);
    stack.push(idx);
  }
  return nodes;
}

/** All text an element renders (descendants included), entity-decoded. */
function fullText(html: string, n: HtmlNode): string {
  if (!n.closed) return '';
  return decodeEntities(html.slice(n.openEnd, n.closeStart).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only the text this element renders itself — not its children's. */
function ownText(html: string, nodes: HtmlNode[], n: HtmlNode): string {
  if (!n.closed) return '';
  let out = '';
  let cursor = n.openEnd;
  for (const c of n.children) {
    const child = nodes[c];
    out += html.slice(cursor, child.openStart);
    cursor = child.closed ? child.closeEnd : child.openEnd;
  }
  out += html.slice(cursor, n.closeStart);
  return decodeEntities(out.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface HtmlGuardResult {
  html: string;
  /** The claims we refused to render. */
  dropped: string[];
  /** How many elements were removed (rows, badges, value cells). */
  removedNodes: number;
}

/**
 * Remove every element that renders a money/discount claim the operator never
 * supplied, and leave an explicit empty state behind if that empties a list.
 *
 * Deliberately conservative: it only ever removes a subtree whose ENTIRE text is
 * ≤ ROW_TEXT_MAX chars, never touches html/head/body or the fixed-size stage,
 * and does nothing at all when every number on the board is grounded (the normal
 * case for a board built from a real brief — zero cost, zero risk).
 */
export function enforceGroundedFactsInHtml(html: string, facts: GroundedFacts): HtmlGuardResult {
  if (typeof html !== 'string' || !html) return { html, dropped: [], removedNodes: 0 };
  // Fast path — no money-shaped text at all, or nothing ungrounded.
  const flatText = decodeEntities(
    html
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
  const allBad = findUngroundedClaims(flatText, facts);
  if (!allBad.length) return { html, dropped: [], removedNodes: 0 };

  const nodes = parseHtmlNodes(html);
  if (!nodes.length) return { html, dropped: allBad, removedNodes: 0 };

  const bodyIdx = nodes.findIndex((n) => n.tag === 'body');
  // The fixed-size stage — the model's first-child wrapper. Never removable.
  const stageIdx = bodyIdx >= 0 && nodes[bodyIdx].children.length ? nodes[bodyIdx].children[0] : -1;

  const removable = (idx: number): boolean => {
    if (idx < 0 || idx >= nodes.length) return false;
    const n = nodes[idx];
    if (!n.closed) return false;
    if (STRUCTURAL_TAGS.has(n.tag)) return false;
    if (idx === stageIdx) return false;
    return fullText(html, n).length <= ROW_TEXT_MAX;
  };

  // 1. Find the deepest elements that actually RENDER an ungrounded claim.
  const claimLeaves: number[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const bad = findUngroundedClaims(ownText(html, nodes, nodes[i]), facts);
    if (bad.length) {
      claimLeaves.push(i);
      dropped.push(...bad);
    }
  }
  if (!claimLeaves.length) return { html, dropped: allBad, removedNodes: 0 };

  // 2. Walk each claim up to its ROW (the nearest ancestor with ≥2 element
  //    children that is still row-sized), passing through single-child wrappers.
  const targets = new Set<number>();
  for (const leaf of claimLeaves) {
    let target = removable(leaf) ? leaf : -1;
    let cursor = leaf;
    for (let up = 0; up < 4; up++) {
      const parent = nodes[cursor].parent;
      if (parent < 0 || !removable(parent)) break;
      if (nodes[parent].children.length >= 2) { target = parent; break; }
      target = parent; // lone-child wrapper — keep climbing
      cursor = parent;
    }
    if (target >= 0) targets.add(target);
  }
  if (!targets.size) return { html, dropped, removedNodes: 0 };

  // 3. Drop nested targets (an ancestor already covers them).
  const finalTargets = [...targets].filter(
    (t) => ![...targets].some((o) => o !== t && nodes[o].openStart <= nodes[t].openStart && nodes[o].closeEnd >= nodes[t].closeEnd),
  );

  // 4. A container that loses ALL of its element children (and has no text of
  //    its own) gets the explicit empty state instead of becoming a dead panel.
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const byParent = new Map<number, number>();
  for (const t of finalTargets) {
    edits.push({ start: nodes[t].openStart, end: nodes[t].closeEnd, text: '' });
    const p = nodes[t].parent;
    if (p >= 0) byParent.set(p, (byParent.get(p) || 0) + 1);
  }
  for (const [parent, lost] of byParent) {
    const p = nodes[parent];
    if (!p.closed) continue;
    if (p.children.length !== lost) continue;
    if (ownText(html, nodes, p)) continue;
    if (STRUCTURAL_TAGS.has(p.tag)) continue;
    edits.push({ start: p.closeStart, end: p.closeStart, text: EMPTY_ITEMS_HTML });
  }

  // 5. Apply back-to-front so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  return { html: out, dropped, removedNodes: finalTargets.length };
}
