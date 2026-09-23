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
  /**
   * The priced ROWS of the REAL CONTENT block, when one was supplied (2026-09-22).
   *
   * `amounts` answers "did anyone give us this number?" — which is why a made-up
   * "Street Tacos $3.00" survived next to a price book row "fries — $3.00": 3 was
   * a supplied number, just not THAT item's. When the content lists its rows, a
   * price inside an `item.N.price` field is checked against THAT row's price.
   */
  menuRows?: MenuRowFact[];
}

/** One priced row of the REAL CONTENT block. */
export interface MenuRowFact {
  /** The row number when the content numbered it (`[item.N] …`), else null. */
  n: number | null;
  /** The item's name, normalized for matching ('' when a numbered row had none). */
  nameKey: string;
  /** The row's own prices, normalized. */
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
export function collectGroundedFacts(
  sources: Array<string | null | undefined>,
  opts?: {
    /**
     * The REAL CONTENT block (the menu rows). Its numbers join `amounts` like any
     * source, AND its priced rows become `menuRows` — so a price in a row field
     * is checked against that row, not against every number anyone typed.
     */
    menuContent?: string | null;
  },
): GroundedFacts {
  const amounts = new Set<string>();
  for (const src of [...sources, opts?.menuContent]) {
    if (typeof src !== 'string' || !src) continue;
    const matches = src.match(NUMBER_RE);
    if (!matches) continue;
    for (const m of matches) {
      const key = normalizeAmount(m);
      if (key) amounts.add(key);
    }
  }
  const menuRows = opts?.menuContent ? parseMenuRowFacts(opts.menuContent) : [];
  return menuRows.length ? { amounts, menuRows } : { amounts };
}

/** A price as it is WRITTEN in a menu row: "$14.50", "£6", or a bare decimal "12.99". */
const ROW_PRICE_RE = /[$€£¥₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d{1,4}\.\d{2}\b/g;
/** `[item.N]` — the row numbering the POS-bound content format carries. */
const ROW_NUMBER_RE = /^\[item\.(\d{1,4})\]\s*/i;

/** Normalize an item name for matching: case, accents and punctuation do not matter. */
export function menuNameKey(raw: string | null | undefined): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same item? Exact, or one name contains the other ("Birria Tacos" / "3 Birria Tacos w/ consome"). */
export function menuNamesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

/**
 * The priced rows of a REAL CONTENT block. Understands every shape a producer
 * emits: the POS plan's `[item.N] Section — Name — $price — desc`, the site
 * menu's `Section — Item — $4.25 — desc`, auto-grounding's `Name — $4.50`, and
 * a pasted chat line like `Asada Burrito 12.99`. Header lines carry no price and
 * are skipped. The NAME is the part just before the first price part, so a
 * number inside a name ("3 Birria Tacos") is never mistaken for its price.
 */
export function parseMenuRowFacts(content: string): MenuRowFact[] {
  const rows: MenuRowFact[] = [];
  for (const line of String(content || '').split(/\r?\n/)) {
    let text = line.trim();
    if (!text || text.length > 400) continue;
    const numbered = ROW_NUMBER_RE.exec(text);
    const n = numbered ? Number(numbered[1]) : null;
    if (numbered) text = text.slice(numbered[0].length);

    const amounts = new Set<string>();
    let name = '';
    const parts = text.split(/\s+[—–]\s+/).map((p) => p.trim()).filter(Boolean);
    const priceIdx = parts.findIndex((p, i) => i > 0 && p.length <= 40 && new RegExp(ROW_PRICE_RE.source).test(p));
    if (priceIdx >= 1) {
      name = parts[priceIdx - 1];
      for (const part of parts.slice(priceIdx)) {
        if (part.length > 40) continue; // a description that mentions a price is not this row's price
        for (const m of part.match(ROW_PRICE_RE) || []) {
          const key = normalizeAmount(m);
          if (key) amounts.add(key);
        }
      }
    } else {
      // A loose line: "Asada Burrito 12.99" / "Horchata $3".
      const found = text.match(ROW_PRICE_RE);
      if (!found) continue;
      for (const m of found) {
        const key = normalizeAmount(m);
        if (key) amounts.add(key);
      }
      name = text.replace(ROW_PRICE_RE, ' ').replace(/[.·•…:|_]+/g, ' ');
    }
    if (!amounts.size) continue;
    const nameKey = menuNameKey(name);
    if (!nameKey && n == null) continue;
    rows.push({ n, nameKey, amounts });
  }
  return rows;
}

/** Words that say nothing about WHICH item a row is ("Large", "House", "Combo"…). */
const NAME_FILLER = new Set([
  'with', 'and', 'the', 'our', 'your', 'house', 'special', 'specials', 'combo', 'plate',
  'large', 'small', 'medium', 'regular', 'fresh', 'classic', 'original', 'side', 'sides',
  'order', 'menu', 'item', 'items', 'extra', 'daily', 'today',
]);

function nameTokens(nameKey: string): Set<string> {
  const out = new Set<string>();
  for (const t of nameKey.split(' ')) {
    if (t.length < 4 || /^\d+$/.test(t) || NAME_FILLER.has(t)) continue;
    out.add(t.endsWith('s') && t.length > 4 ? t.slice(0, -1) : t); // tacos ~ taco
  }
  return out;
}

function sharesNameToken(a: string, b: string): boolean {
  const ta = nameTokens(a);
  for (const t of nameTokens(b)) if (ta.has(t)) return true;
  return false;
}

/** A content block with at least this many priced rows is a MENU, not a sentence. */
const MENU_ROWS_FOR_STRICT_NAMES = 3;

/**
 * Is `amountKey` this row's price? 'grounded' / 'ungrounded' when the content's
 * rows can answer, 'unknown' when they cannot (the caller falls back to the
 * permissive every-supplied-number rule).
 *
 *   NUMBERED content (`[item.N]`, a POS plan): the number decides. A price that
 *   is not row N's price is ungrounded — unless the row's NAME is another
 *   numbered row's, and the price is THAT row's (a misnumbered row is not a lie).
 *   A row number the content never had is an invented row.
 *   UNNUMBERED content (a site menu, a pasted menu): the row's name decides —
 *   the same name, or failing that a shared distinctive word ("French Fries" ~
 *   "Crispy Fries"), and the price must be one of THOSE rows'. A name that shares
 *   nothing with any row of a real menu (3+ priced rows) is an invented row
 *   ("Street Tacos $3.00" beside a price book's "fries — $3.00"); against a
 *   sentence or two of prices the permissive rule stands.
 */
export function menuRowPriceVerdict(
  amountKey: string | null,
  n: number,
  rowName: string,
  facts: GroundedFacts,
): 'grounded' | 'ungrounded' | 'unknown' {
  const rows = facts.menuRows;
  if (!rows || !rows.length || !amountKey) return 'unknown';
  const nameKey = menuNameKey(rowName);
  const byName = nameKey ? rows.filter((r) => menuNamesMatch(r.nameKey, nameKey)) : [];
  if (rows.some((r) => r.n != null)) {
    if (rows.some((r) => r.n === n && r.amounts.has(amountKey))) return 'grounded';
    if (byName.some((r) => r.amounts.has(amountKey))) return 'grounded';
    return 'ungrounded';
  }
  if (!nameKey) return 'unknown';
  const pool = byName.length ? byName : rows.filter((r) => sharesNameToken(r.nameKey, nameKey));
  if (pool.length) return pool.some((r) => r.amounts.has(amountKey)) ? 'grounded' : 'ungrounded';
  return rows.length >= MENU_ROWS_FOR_STRICT_NAMES ? 'ungrounded' : 'unknown';
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
//
// 2026-09-22 — three holes closed, each reproduced by running this file on a
// real card-layout board (docs/research/2026-09-22-ai-designer-rework/02):
//   • CARD ORPHANS. A card is category + photo + name + description + a price
//     strip. The row walk stopped at the first ancestor with two children — the
//     price strip — so an invented price left "Carne Asada Burrito" standing
//     with no price and no empty state. A price inside a board's `item.N.*`
//     fields now takes the whole item with it (the V14 row rule: the highest
//     ancestor holding every `item.N.*` field and nothing of any other row).
//   • SAMPLE MENUS. On a board that carries designed empty price slots
//     (`data-vos-sample-price="1"`), an invented price inside a `*.price` field
//     becomes that empty slot instead — the names were asked for; the prices
//     are the operator's to fill.
//   • THE $3.00 COINCIDENCE. A price in `item.N.price` is checked against row
//     N's own price when the content lists its rows (menuRowPriceVerdict).
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

/**
 * An ITEM located by its own fields (every `item.N.*` of one N, nothing of any
 * other row) is identified structurally, not by size, so it may run longer — a
 * card with a two-line description. Still a hard ceiling so nothing that grew
 * into a region can ever be taken.
 */
export const ITEM_TEXT_MAX = 600;

/** The honest empty state — an authoring affordance, never a claim. */
export const EMPTY_ITEMS_HTML =
  '<div data-vos-empty="1" data-field="items.empty" style="opacity:0.72;font-style:italic">Add your items and prices</div>';

/** What a designed, empty sample-menu price slot says: a currency mark and a dash — never a number. */
export const SAMPLE_PRICE_SLOT_TEXT = '$ —';

/** A board in sample-menu mode carries at least one designed empty price slot. */
const SAMPLE_SLOT_RE = /\sdata-vos-sample-price\s*=\s*["']?1\b/i;

/** `item.3.price` → 3 / `price`. */
const ITEM_KEY_RE = /^item\.(\d{1,4})\.([a-z0-9_-]+)$/i;
/** Any `*.price` data-field (item.N.price, combo.N.price, special.price …). */
const PRICE_KEY_RE = /(?:^|\.)price$/i;

export interface HtmlNode {
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
export function decodeEntities(s: string): string {
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

/**
 * Parse into a flat node list with parent/child links. Tolerant of bad markup.
 * A parent always precedes its children in the list. Void elements (img, br…)
 * are not nodes; `<style>` / `<script>` bodies are skipped.
 */
export function parseHtmlNodes(html: string): HtmlNode[] {
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

/** One attribute off an opening tag's text (`<div a="1">`), or null when absent. */
export function tagAttr(tagText: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tagText);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** One attribute off a parsed node's opening tag. */
export function nodeAttr(html: string, n: HtmlNode, name: string): string | null {
  return tagAttr(html.slice(n.openStart, n.openEnd), name);
}

/** All text an element renders (descendants included), entity-decoded. */
export function nodeFullText(html: string, n: HtmlNode): string {
  if (!n.closed) return '';
  return decodeEntities(html.slice(n.openEnd, n.closeStart).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only the text this element renders itself — not its children's. */
export function nodeOwnText(html: string, nodes: HtmlNode[], n: HtmlNode): string {
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

/**
 * Every editable key (`data-field` / `data-imgslot`) in the document, with the
 * span it occupies — including keys on VOID tags (`<img data-imgslot="item.3.image">`),
 * which are not parsed nodes. `<style>`/`<script>` bodies and comments are masked
 * first so text that merely looks like an attribute is never counted.
 */
export interface KeySite {
  key: string;
  /** Start of the element (its opening tag). */
  start: number;
  /** End of the element (its closing tag, or the tag itself for a void element). */
  end: number;
  /** The parsed node carrying the key, or -1 for a void element. */
  node: number;
}

export function collectKeySites(html: string, nodes: HtmlNode[]): KeySite[] {
  const masked = html.replace(/<!--[\s\S]*?-->|<(style|script)\b[\s\S]*?<\/\1\s*>/gi, (m) => ' '.repeat(m.length));
  const byOpen = new Map<number, number>();
  nodes.forEach((n, i) => byOpen.set(n.openStart, i));
  const sites: KeySite[] = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(masked)) !== null) {
    const tagText = m[0];
    for (const attr of ['data-field', 'data-imgslot']) {
      const key = tagAttr(tagText, attr);
      if (!key) continue;
      const idx = byOpen.get(m.index);
      if (idx !== undefined) {
        const n = nodes[idx];
        sites.push({ key, start: n.openStart, end: n.closed ? n.closeEnd : n.openEnd, node: idx });
      } else {
        sites.push({ key, start: m.index, end: m.index + tagText.length, node: -1 });
      }
    }
  }
  return sites;
}

/** The row number an `item.N.*` key names, or null. */
export function itemNumberOfKey(key: string | null | undefined): number | null {
  const m = ITEM_KEY_RE.exec(String(key || ''));
  return m ? Number(m[1]) : null;
}

/** The field an `item.N.<field>` key names (`name`, `price`, `desc`, `image` …), or null. */
export function itemFieldOfKey(key: string | null | undefined): string | null {
  const m = ITEM_KEY_RE.exec(String(key || ''));
  return m ? m[2].toLowerCase() : null;
}

/** Sites inside a node's span (the node's own key included). */
export function sitesWithin(sites: KeySite[], n: HtmlNode): KeySite[] {
  const end = n.closed ? n.closeEnd : n.openEnd;
  return sites.filter((s) => s.start >= n.openStart && s.end <= end);
}

/** The fixed-size stage — the model's first-child wrapper under <body>. Never a row. */
export function stageIndex(nodes: HtmlNode[]): number {
  const bodyIdx = nodes.findIndex((n) => n.tag === 'body');
  return bodyIdx >= 0 && nodes[bodyIdx].children.length ? nodes[bodyIdx].children[0] : -1;
}

/**
 * THE ITEM ROW RULE (mirrors the EDUCMS shim's V14 repeat-group detection): the
 * highest ancestor of `from` that holds only row N's fields — no field of any
 * other row, no board-level field (headline, section title), and at most one
 * `item.N.name` / `item.N.price` (two of either means it spans duplicate rows).
 * An explicit `data-menu-row="N"` on the way up is the answer. Never the stage,
 * html/head/body, an unclosed element, or anything longer than `maxText`.
 * Returns -1 when not even `from` qualifies.
 */
export function itemRowRoot(
  html: string,
  nodes: HtmlNode[],
  sites: KeySite[],
  from: number,
  n: number,
  maxText = ITEM_TEXT_MAX,
): number {
  const stage = stageIndex(nodes);
  let best = -1;
  let cursor = from;
  while (cursor >= 0) {
    const node = nodes[cursor];
    if (!node.closed || STRUCTURAL_TAGS.has(node.tag) || cursor === stage) break;
    if (nodeFullText(html, node).length > maxText) break;
    const within = sitesWithin(sites, node);
    if (within.some((s) => itemNumberOfKey(s.key) !== n)) break;
    const names = within.filter((s) => itemFieldOfKey(s.key) === 'name').length;
    const prices = within.filter((s) => itemFieldOfKey(s.key) === 'price').length;
    if (names > 1 || prices > 1) break;
    best = cursor;
    if (nodeAttr(html, node, 'data-menu-row') === String(n)) break;
    cursor = node.parent;
  }
  return best;
}

/** The deepest parsed node whose span contains [start, end) — for void-element sites. */
export function enclosingNode(nodes: HtmlNode[], start: number, end: number): number {
  let best = -1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const nEnd = n.closed ? n.closeEnd : n.openEnd;
    if (n.openStart <= start && nEnd >= end && (n.openStart < start || nEnd > end)) best = i; // later = deeper
  }
  return best;
}

/** A fact set that grounds nothing — used to FIND every claim, then judge each one. */
const NO_AMOUNTS: GroundedFacts = { amounts: new Set<string>() };

export interface HtmlGuardResult {
  html: string;
  /** The claims we refused to render. */
  dropped: string[];
  /** How many elements were removed (rows, badges, value cells). */
  removedNodes: number;
  /** Sample-menu price slots an invented price was turned back into. */
  slottedPrices?: number;
}

/**
 * Remove every element that renders a money/discount claim the operator never
 * supplied, and leave an explicit empty state behind if that empties a list.
 *
 * Deliberately conservative: a row found by the walk is ≤ ROW_TEXT_MAX chars, an
 * item found by its own fields ≤ ITEM_TEXT_MAX; html/head/body and the
 * fixed-size stage are never touched; and a board whose every number is
 * grounded comes back byte-identical (the normal case for a board built from a
 * real brief — zero cost, zero risk).
 *
 * `opts.sampleSlots` forces sample-menu mode; it is also on whenever the board
 * itself carries a `data-vos-sample-price="1"` slot.
 */
export function enforceGroundedFactsInHtml(
  html: string,
  facts: GroundedFacts,
  opts?: { sampleSlots?: boolean },
): HtmlGuardResult {
  if (typeof html !== 'string' || !html) return { html, dropped: [], removedNodes: 0 };
  const flatText = decodeEntities(
    html
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
  // Fast path — no money-shaped text at all, or (with no content rows to check
  // row prices against) nothing ungrounded.
  const allBad = findUngroundedClaims(flatText, facts);
  const hasRowFacts = !!facts.menuRows && facts.menuRows.length > 0;
  if (!allBad.length && (!hasRowFacts || !findUngroundedClaims(flatText, NO_AMOUNTS).length)) {
    return { html, dropped: [], removedNodes: 0 };
  }

  const nodes = parseHtmlNodes(html);
  if (!nodes.length) return { html, dropped: allBad, removedNodes: 0 };

  const stageIdx = stageIndex(nodes);
  const sampleMode = opts?.sampleSlots === true || SAMPLE_SLOT_RE.test(html);
  const sites = collectKeySites(html, nodes);
  const fieldOf = nodes.map((n) => nodeAttr(html, n, 'data-field'));
  const itemOfNode = nodes.map((n) => {
    const own = [nodeAttr(html, n, 'data-field'), nodeAttr(html, n, 'data-imgslot')];
    for (const k of own) {
      const num = itemNumberOfKey(k);
      if (num != null) return num;
    }
    return null as number | null;
  });
  // Nearest ancestor-or-self that is a `*.price` field — a price is judged as a
  // WHOLE ("<b>$</b>11<sup>99</sup>" is one claim, not three fragments).
  const priceUnit = new Array<number>(nodes.length).fill(-1);
  // Nearest ancestor-or-self carrying an `item.N.*` key.
  const itemAnchor = new Array<number>(nodes.length).fill(-1);
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i].parent;
    priceUnit[i] = fieldOf[i] && PRICE_KEY_RE.test(fieldOf[i]!) ? i : p >= 0 ? priceUnit[p] : -1;
    itemAnchor[i] = itemOfNode[i] != null ? i : p >= 0 ? itemAnchor[p] : -1;
  }

  const removable = (idx: number, max = ROW_TEXT_MAX): boolean => {
    if (idx < 0 || idx >= nodes.length) return false;
    const n = nodes[idx];
    if (!n.closed) return false;
    if (STRUCTURAL_TAGS.has(n.tag)) return false;
    if (idx === stageIdx) return false;
    return nodeFullText(html, n).length <= max;
  };

  /** The name row N shows — from inside its own row first, else anywhere. */
  const rowNameFor = (from: number, n: number): string => {
    const root = itemRowRoot(html, nodes, sites, from, n);
    const scope = root >= 0 ? sitesWithin(sites, nodes[root]) : sites;
    const nameSite = scope.find((s) => s.node >= 0 && s.key.toLowerCase() === `item.${n}.name`)
      || sites.find((s) => s.node >= 0 && s.key.toLowerCase() === `item.${n}.name`);
    return nameSite ? nodeFullText(html, nodes[nameSite.node]) : '';
  };

  const grounded = (claim: string, unit: number): boolean => {
    if (unit >= 0 && hasRowFacts) {
      const n = itemNumberOfKey(fieldOf[unit]);
      if (n != null && itemFieldOfKey(fieldOf[unit]) === 'price') {
        const verdict = menuRowPriceVerdict(normalizeAmount(claim), n, rowNameFor(unit, n), facts);
        if (verdict !== 'unknown') return verdict === 'grounded';
      }
    }
    return isGrounded(claim, facts);
  };

  // 1. Find the elements that actually RENDER an ungrounded claim.
  const claimLeaves: Array<{ idx: number; unit: number }> = [];
  const dropped: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const unit = priceUnit[i];
    if (unit >= 0 && unit !== i) continue; // judged as part of its price field
    const text = unit === i ? nodeFullText(html, nodes[i]) : nodeOwnText(html, nodes, nodes[i]);
    const bad = findUngroundedClaims(text, NO_AMOUNTS).filter((c) => !grounded(c, unit));
    if (bad.length) {
      claimLeaves.push({ idx: i, unit });
      dropped.push(...bad);
    }
  }
  if (!claimLeaves.length) return { html, dropped: allBad, removedNodes: 0 };

  // 2. Decide each claim's fate.
  //    • sample mode + a price field → the designed empty slot;
  //    • inside row N's fields → the whole item (never a price-less orphan);
  //    • otherwise → the nearest ROW (≥2 element children, row-sized), passing
  //      through single-child wrappers — the original rule.
  const slots = new Set<number>();
  const targets = new Set<number>();
  for (const { idx: leaf, unit } of claimLeaves) {
    if (sampleMode && unit >= 0) {
      slots.add(unit);
      continue;
    }
    const anchor = itemAnchor[leaf];
    if (anchor >= 0) {
      const root = itemRowRoot(html, nodes, sites, anchor, itemOfNode[anchor]!);
      if (root >= 0 && removable(root, ITEM_TEXT_MAX)) {
        targets.add(root);
        continue;
      }
    }
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
  if (!targets.size && !slots.size) return { html, dropped, removedNodes: 0 };

  // 3. Drop nested targets (an ancestor already covers them), and any slot a
  //    removed item already takes with it.
  const contains = (o: number, t: number) =>
    nodes[o].openStart <= nodes[t].openStart && nodes[o].closeEnd >= nodes[t].closeEnd;
  const finalTargets = [...targets].filter((t) => ![...targets].some((o) => o !== t && contains(o, t)));
  const finalSlots = [...slots].filter((s) => !finalTargets.some((t) => contains(t, s)));

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
    if (nodeOwnText(html, nodes, p)) continue;
    if (STRUCTURAL_TAGS.has(p.tag)) continue;
    edits.push({ start: p.closeStart, end: p.closeStart, text: EMPTY_ITEMS_HTML });
  }
  // 5. Sample slots: the field keeps its element + styling, loses the number.
  for (const s of finalSlots) {
    const n = nodes[s];
    edits.push({ start: n.openEnd, end: n.closeStart, text: SAMPLE_PRICE_SLOT_TEXT });
    if (nodeAttr(html, n, 'data-vos-sample-price') !== '1') {
      const tagText = html.slice(n.openStart, n.openEnd);
      const insertAt = n.openStart + tagText.length - (/\/>$/.test(tagText) ? 2 : 1);
      edits.push({ start: insertAt, end: insertAt, text: ' data-vos-sample-price="1"' });
    }
  }

  // 6. Apply back-to-front so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  return { html: out, dropped, removedNodes: finalTargets.length, slottedPrices: finalSlots.length };
}

