/**
 * menu-extractor.ts — READ THE OPERATOR'S ACTUAL MENU OFF THEIR OWN WEBSITE.
 *
 * WHY THIS EXISTS (2026-09-22, operator incident). Greg pasted his restaurant's
 * website into the Signage Concierge and asked for a menu board. The Concierge
 * answered "I'll pull the menu items from your website" and wrote a brief that
 * said "Include all menu items from the website with their prices" — and then
 * the three generated boards showed `burger $2.99 / fries $3.00 / shake $5.00`
 * on a near-empty layout. Those are his tenant's TEST price book, pulled in by
 * the designer's auto-grounding because nothing had supplied any real content.
 *
 * The root cause was not the design engine. It was that NOTHING read the menu:
 * `POST concierge/reference/url` scraped BRANDING (name, tagline, palette,
 * fonts, logo, hero image) and nothing else, so the Concierge was promising a
 * capability the platform did not have. This module is that capability.
 *
 * ORDER OF ATTACK (deterministic first, model last):
 *   1. schema.org JSON-LD on the pasted page (`Menu` / `hasMenuSection` /
 *      `MenuSection` / `hasMenuItem` / `MenuItem` + `offers.price`), including
 *      `@graph` wrappers and arrays at every level.
 *   2. schema.org MICRODATA on the same page (`itemtype=".../MenuItem"`).
 *   3. DISCOVERY — if the pasted page carries neither, follow up to 2 same-host
 *      links whose text or href looks like a menu, and run 1+2 on each.
 *   4. LLM FALLBACK — on a page with no structured data at all, hand the model
 *      the page's visible text and ask for STRICT JSON. Every price it returns
 *      is then VERIFIED against the page text; an item whose price is not
 *      physically on the page is DROPPED. A model that invents a plausible
 *      "$12.95" must not be able to put it on a wall.
 *
 * PURE-ISH: every side effect is injected (`fetch`, `askModel`, `logger`,
 * `now`), so the whole thing unit-tests without network or a provider key. The
 * default fetcher is `safeFetch` — the SSRF/byte/timeout posture every
 * operator-supplied URL in this codebase must flow through. NEVER call
 * `fetch()` here.
 *
 * NEVER THROWS. Every failure mode — fetch error, `SsrfError`, a non-HTML
 * document, an empty page, a model that returns garbage — returns `null`, and
 * the caller behaves exactly as it did before this module existed.
 */

import * as cheerio from 'cheerio';
import { safeFetch } from '../branding/safe-fetch';

// ───────────────────────────────────────────────────────────────────────────
// Shape
// ───────────────────────────────────────────────────────────────────────────

export interface ExtractedMenuItem {
  name: string;
  /** Canonical price string, currency symbol preserved: "$12.50", "8", "£4". */
  price?: string;
  description?: string;
}

export interface ExtractedMenuSection {
  name: string;
  items: ExtractedMenuItem[];
}

export interface ExtractedMenu {
  sections: ExtractedMenuSection[];
  itemCount: number;
  source: { url: string; method: 'jsonld' | 'llm' };
}

export interface MenuExtractorDeps {
  /** Injected for tests. Defaults to `safeFetch` — never plain `fetch`. */
  fetch?: typeof safeFetch;
  /**
   * The model call. OMIT IT and the extractor is deterministic-only (no LLM
   * fallback) — which is exactly what a tenant with no provider key gets.
   * Returns the model's raw text, or null when it could not be called.
   */
  askModel?: (args: { system: string; user: string }) => Promise<string | null>;
  logger?: { debug?: (msg: string) => void; warn?: (msg: string) => void };
  now?: () => number;
}

// ───────────────────────────────────────────────────────────────────────────
// Budgets + caps. These bound BOTH the operator's wait and what can ever reach
// a prompt: a 400-item catalogue on a board is not a board.
// ───────────────────────────────────────────────────────────────────────────

/** Whole-extraction wall-clock budget (fetches + discovery + the model call). */
export const MENU_BUDGET_MS = 8_000;
/** Whole-extraction byte budget across every page fetched. */
export const MENU_BYTE_BUDGET = 1_500_000;
/** Menu-page candidates followed when the pasted page has no structured data. */
export const MENU_MAX_CANDIDATE_PAGES = 2;
/** Visible page text handed to the model. */
export const MENU_LLM_TEXT_CAP = 12_000;
/** The model's output budget — a menu, not an essay. */
export const MENU_LLM_MAX_TOKENS = 1200;

export const MENU_MAX_SECTIONS = 8;
export const MENU_MAX_ITEMS = 60;
export const MENU_NAME_MAX = 80;
export const MENU_DESC_MAX = 140;
export const MENU_PRICE_MAX = 16;

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** Non-global (so `.test()` is stateless) — a currency amount anywhere. */
const HAS_MONEY_RE = /[$€£¥₹]\s?\d|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|dollars?)\b/i;
/** Every number-ish run, for the "is this price actually on the page" check. */
const NUMBER_RUN_RE = /\d[\d,]*(?:[.,]\d{1,2})?/g;

/** Same-host links that look like a menu page. */
const MENU_LINK_RE = /\bmenus?\b|order(-| )online|food|drinks?/i;
/**
 * The UNAMBIGUOUS half of the admission regex. `food` / `drinks` let real menu
 * pages in ("/food", "Drinks") but also let "Food safety policy" in, so a match
 * on those alone ranks BELOW a match on "menu" / "order online". Admission is
 * still MENU_LINK_RE; this only decides which candidate we spend a fetch on
 * first, and we only ever fetch two.
 */
const MENU_LINK_STRONG_RE = /\bmenus?\b|order(-| )online/i;
/** Links we can never parse as HTML — a menu PDF is a real thing, just not ours. */
const NON_HTML_HREF_RE = /\.(pdf|jpe?g|png|gif|webp|svg|avif|mp4|mov|zip|docx?|xlsx?)(\?|#|$)/i;

const CURRENCY_SYMBOL_BY_CODE: Record<string, string> = {
  USD: '$', CAD: '$', AUD: '$', NZD: '$', MXN: '$', SGD: '$', HKD: '$',
  EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹',
};

// ───────────────────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read the menu off a public website. Returns `null` — never throws — when the
 * site has no menu we can read, when it cannot be fetched, or when the model
 * returned nothing we can verify.
 */
export async function extractMenuFromSite(
  url: string,
  deps: MenuExtractorDeps = {},
): Promise<ExtractedMenu | null> {
  const fetchFn = deps.fetch ?? safeFetch;
  const now = deps.now ?? (() => Date.now());
  const debug = (msg: string) => { try { deps.logger?.debug?.(`[menu-extractor] ${msg}`); } catch { /* logging must never break extraction */ } };

  const deadline = now() + MENU_BUDGET_MS;
  let bytesLeft = MENU_BYTE_BUDGET;

  /** Fetch one page inside the shared time + byte budget. Never throws. */
  const grab = async (target: string): Promise<{ url: string; html: string } | null> => {
    const msLeft = deadline - now();
    if (msLeft <= 250 || bytesLeft <= 2048) {
      debug(`budget exhausted before ${safeLabel(target)}`);
      return null;
    }
    try {
      const res = await fetchFn(target, {
        timeoutMs: Math.min(msLeft, 6_000),
        maxBytes: Math.min(bytesLeft, MENU_BYTE_BUDGET),
        accept: HTML_ACCEPT,
      });
      bytesLeft -= res.body.length;
      if (!/html|xml/i.test(res.contentType || '')) {
        debug(`not HTML (${res.contentType}) at ${safeLabel(target)}`);
        return null;
      }
      const html = res.body.toString('utf-8');
      if (!html.trim()) {
        debug(`empty document at ${safeLabel(target)}`);
        return null;
      }
      return { url: res.finalUrl || target, html };
    } catch (e: any) {
      // SsrfError / FetchTooLargeError / timeouts / DNS — all the same answer.
      debug(`fetch failed for ${safeLabel(target)}: ${e?.name || 'Error'}`);
      return null;
    }
  };

  const first = await grab(url);
  if (!first) return null;

  const structured = menuFromDocument(first.html);
  if (structured) {
    const out = finalizeMenu(structured, first.url, 'jsonld');
    if (out) { debug(`structured menu on ${safeLabel(first.url)}: ${out.itemCount} items`); return out; }
  }

  // No structured data on the pasted page — go looking for the menu page.
  const candidates = discoverMenuLinks(first.html, first.url).slice(0, MENU_MAX_CANDIDATE_PAGES);
  let llmPage = first;
  for (const candidate of candidates) {
    const page = await grab(candidate);
    if (!page) continue;
    llmPage = page; // the most menu-looking page we actually hold
    const found = menuFromDocument(page.html);
    if (found) {
      const out = finalizeMenu(found, page.url, 'jsonld');
      if (out) { debug(`structured menu on ${safeLabel(page.url)}: ${out.itemCount} items`); return out; }
    }
  }

  // Deterministic paths exhausted. A tenant with no provider key stops here.
  if (!deps.askModel) { debug('no structured menu and no model available'); return null; }

  const pageText = visibleMenuText(llmPage.html);
  if (!pageText || !HAS_MONEY_RE.test(pageText)) {
    debug(`no priced text to read on ${safeLabel(llmPage.url)}`);
    return null;
  }
  if (deadline - now() <= 500) { debug('budget exhausted before the model call'); return null; }

  let raw: string | null = null;
  try {
    raw = await deps.askModel({
      system: MENU_EXTRACTION_SYSTEM_PROMPT,
      user: buildMenuExtractionUserPrompt(pageText),
    });
  } catch (e: any) {
    debug(`model call failed: ${e?.message || 'error'}`);
    return null;
  }
  if (!raw || !raw.trim()) { debug('model returned nothing'); return null; }

  const parsed = parseModelMenu(raw);
  if (!parsed) { debug('model reply was not usable JSON'); return null; }

  // THE GUARD: a price the model produced must physically appear on the page.
  const verified = dropUnverifiedPrices(parsed, pageText);
  const out = finalizeMenu(verified, llmPage.url, 'llm');
  if (!out) { debug('nothing survived price verification'); return null; }
  debug(`model-read menu on ${safeLabel(out.source.url)}: ${out.itemCount} items`);
  return out;
}

/**
 * One line the Concierge (and the reference chip) can read: what we found and
 * where. Prepended to the reference summary so the model cannot miss it.
 */
export function describeExtractedMenu(menu: ExtractedMenu): string {
  const where = pathOf(menu.source.url);
  const names = menu.sections.map((s) => s.name).filter(Boolean).slice(0, 8);
  const sectionList = names.length ? ` (${names.join(', ')})` : '';
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return (
    `Menu found on ${where}: ${plural(menu.itemCount, 'item')} in ` +
    `${plural(menu.sections.length, 'section')}${sectionList}. ` +
    `USE THESE EXACT items and prices.`
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 1 + 2. Structured data — JSON-LD, then microdata.
// ───────────────────────────────────────────────────────────────────────────

interface RawItem { name: string; price?: string; description?: string }
interface RawSection { name: string; items: RawItem[] }

function menuFromDocument(html: string): RawSection[] | null {
  let $: cheerio.CheerioAPI;
  try { $ = cheerio.load(html); } catch { return null; }
  const ld = menuFromJsonLd($);
  if (ld && ld.length) return ld;
  const micro = menuFromMicrodata($);
  if (micro && micro.length) return micro;
  return null;
}

function menuFromJsonLd($: cheerio.CheerioAPI): RawSection[] | null {
  const sections: RawSection[] = [];
  const looseItems: RawItem[] = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).contents().text() || $(el).text();
    const roots = parseJsonLoose(text);
    for (const root of roots) walkLd(root, null, sections, looseItems, 0);
  });

  if (looseItems.length) sections.push({ name: 'Menu', items: looseItems });
  return sections.length ? sections : null;
}

/** Parse a JSON-LD block into the list of top-level nodes it carries. */
function parseJsonLoose(text: string): any[] {
  const trimmed = String(text || '')
    .replace(/^\s*<!\[CDATA\[/i, '')
    .replace(/\]\]>\s*$/i, '')
    .trim();
  if (!trimmed) return [];
  let parsed: any;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** True when a node's `@type` (string OR array) names `want`, case-insensitively. */
function isType(node: any, want: string): boolean {
  const t = node?.['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === 'string' && x.trim().toLowerCase().replace(/^.*\//, '') === want.toLowerCase());
}

function asArray(v: any): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Walk a JSON-LD node tree collecting sections + items. Handles `@graph`
 * wrappers, arrays at every level, `Restaurant.hasMenu`, `Menu.hasMenuSection`,
 * nested `MenuSection.hasMenuSection`, and items hung directly off a `Menu`.
 */
function walkLd(
  node: any,
  sectionName: string | null,
  sections: RawSection[],
  looseItems: RawItem[],
  depth: number,
): void {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) {
    for (const n of node) walkLd(n, sectionName, sections, looseItems, depth + 1);
    return;
  }
  if (node['@graph']) {
    for (const n of asArray(node['@graph'])) walkLd(n, sectionName, sections, looseItems, depth + 1);
  }

  if (isType(node, 'MenuItem')) {
    const item = itemFromLd(node);
    if (item) {
      const target = sectionName ? findOrCreateSection(sections, sectionName) : null;
      (target ? target.items : looseItems).push(item);
    }
    return;
  }

  if (isType(node, 'MenuSection')) {
    const name = cleanText(node.name) || sectionName || 'Menu';
    const bucket = findOrCreateSection(sections, name);
    for (const raw of asArray(node.hasMenuItem)) {
      if (isType(raw, 'MenuSection')) { walkLd(raw, name, sections, looseItems, depth + 1); continue; }
      const item = itemFromLd(raw);
      if (item) bucket.items.push(item);
    }
    // Nested sub-sections become their own flat sections (their own names).
    for (const sub of asArray(node.hasMenuSection)) walkLd(sub, name, sections, looseItems, depth + 1);
    return;
  }

  if (isType(node, 'Menu')) {
    const menuName = cleanText(node.name) || null;
    for (const sub of asArray(node.hasMenuSection)) walkLd(sub, menuName, sections, looseItems, depth + 1);
    // A Menu may hang items directly, with no sections at all.
    const direct = asArray(node.hasMenuItem);
    if (direct.length) {
      const bucket = findOrCreateSection(sections, menuName || 'Menu');
      for (const raw of direct) {
        const item = itemFromLd(raw);
        if (item) bucket.items.push(item);
      }
    }
    return;
  }

  // Anything else that can CARRY a menu (Restaurant / FoodEstablishment /
  // LocalBusiness) — `hasMenu` is often a bare URL string, which we ignore.
  for (const sub of asArray(node.hasMenu)) {
    if (typeof sub === 'object') walkLd(sub, sectionName, sections, looseItems, depth + 1);
  }
  for (const sub of asArray(node.hasMenuSection)) walkLd(sub, sectionName, sections, looseItems, depth + 1);
  for (const sub of asArray(node.hasPart)) walkLd(sub, sectionName, sections, looseItems, depth + 1);
  for (const sub of asArray(node.mainEntity)) walkLd(sub, sectionName, sections, looseItems, depth + 1);
}

function findOrCreateSection(sections: RawSection[], name: string): RawSection {
  const key = name.trim().toLowerCase();
  const found = sections.find((s) => s.name.trim().toLowerCase() === key);
  if (found) return found;
  const created: RawSection = { name, items: [] };
  sections.push(created);
  return created;
}

function itemFromLd(node: any): RawItem | null {
  if (!node || typeof node !== 'object') return null;
  if (!isType(node, 'MenuItem') && node.name == null) return null;
  const name = cleanText(node.name);
  if (!name) return null;
  const item: RawItem = { name };
  const description = cleanText(node.description);
  if (description) item.description = description;
  const price = priceFromLdOffers(node.offers) ?? normalizeMenuPrice(node.price, node.priceCurrency);
  if (price) item.price = price;
  return item;
}

/** `offers` can be one Offer, an array of Offers, or carry a priceSpecification. */
function priceFromLdOffers(offers: any): string | null {
  for (const offer of asArray(offers)) {
    if (!offer || typeof offer !== 'object') continue;
    const direct = normalizeMenuPrice(offer.price, offer.priceCurrency);
    if (direct) return direct;
    for (const spec of asArray(offer.priceSpecification)) {
      const fromSpec = normalizeMenuPrice(spec?.price, spec?.priceCurrency);
      if (fromSpec) return fromSpec;
    }
  }
  return null;
}

/** schema.org MICRODATA — `itemtype=".../MenuItem"` inside `.../MenuSection`. */
function menuFromMicrodata($: cheerio.CheerioAPI): RawSection[] | null {
  const sections: RawSection[] = [];
  $('[itemtype]').each((_i, el) => {
    const $el = $(el);
    const type = String($el.attr('itemtype') || '');
    if (!/\/menuitem\s*$/i.test(type.trim())) return;
    const name = cleanText(microProp($, $el, 'name'));
    if (!name) return;
    const sectionEl = $el.parents('[itemtype]').filter((_j, p) => /\/menusection\s*$/i.test(String($(p).attr('itemtype') || '').trim())).first();
    const sectionName = (sectionEl.length ? cleanText(microProp($, sectionEl, 'name')) : '') || 'Menu';
    const bucket = findOrCreateSection(sections, sectionName);
    const item: RawItem = { name };
    const description = cleanText(microProp($, $el, 'description'));
    if (description) item.description = description;
    const priceRaw = microProp($, $el, 'price');
    const currency = microProp($, $el, 'priceCurrency');
    const price = normalizeMenuPrice(priceRaw, currency);
    if (price) item.price = price;
    bucket.items.push(item);
  });
  return sections.length ? sections : null;
}

/** First descendant carrying `itemprop`, preferring its `content` attribute. */
function microProp($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>, prop: string): string {
  const $hit = $scope.find(`[itemprop="${prop}"]`).first();
  if (!$hit.length) return '';
  const content = $hit.attr('content');
  if (content && content.trim()) return content.trim();
  return $hit.text();
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Menu-page discovery
// ───────────────────────────────────────────────────────────────────────────

/**
 * Same-host links whose TEXT or HREF looks like a menu page, ranked by how
 * confident the signal is: an unambiguous TEXT match ("Our Menu") beats an
 * unambiguous HREF match ("/order-online"), which beats the loose `food` /
 * `drinks` matches ("Food safety policy" is admitted, but last). Document
 * order within each tier.
 */
export function discoverMenuLinks(html: string, baseUrl: string): string[] {
  let $: cheerio.CheerioAPI;
  let base: URL;
  try {
    $ = cheerio.load(html);
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const here = normalizedKey(base.toString());
  const seen = new Set<string>([here]);
  const strongText: string[] = [];
  const strongHref: string[] = [];
  const weakText: string[] = [];
  const weakHref: string[] = [];

  $('a[href]').each((_i, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
    let abs: URL;
    try { abs = new URL(href, base); } catch { return; }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    if (abs.host !== base.host) return;                 // same host only
    if (NON_HTML_HREF_RE.test(abs.pathname)) return;    // we cannot read a PDF menu
    const key = normalizedKey(abs.toString());
    if (seen.has(key)) return;

    const text = cleanText($(el).text());
    const textMatch = !!text && MENU_LINK_RE.test(text);
    const hrefMatch = MENU_LINK_RE.test(abs.pathname);
    if (!textMatch && !hrefMatch) return;

    seen.add(key);
    const target = abs.toString();
    if (textMatch && MENU_LINK_STRONG_RE.test(text)) strongText.push(target);
    else if (hrefMatch && MENU_LINK_STRONG_RE.test(abs.pathname)) strongHref.push(target);
    else if (textMatch) weakText.push(target);
    else weakHref.push(target);
  });

  return [...strongText, ...strongHref, ...weakText, ...weakHref];
}

function normalizedKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 4. LLM fallback
// ───────────────────────────────────────────────────────────────────────────

export const MENU_EXTRACTION_SYSTEM_PROMPT = [
  'You read the VISIBLE TEXT of one restaurant / bar / cafe web page and return the menu it contains as STRICT JSON.',
  '',
  'RULES — these are absolute:',
  '- Copy every item name and every price VERBATIM from the text. Do not reword, translate, title-case, pluralize, or "clean up" a name.',
  '- INVENT NOTHING. If the text does not state a price for an item, omit the "price" field entirely — never estimate one, never carry a price down from another item.',
  '- Never add an item, a section, a combo, or a deal that is not written in the text.',
  '- Group items under the section headings the page itself uses (e.g. "Tacos", "Burritos", "Drinks"). If the page has no headings, use one section named "Menu".',
  '- Skip navigation, cookie notices, hours, addresses, phone numbers, reviews and marketing copy. Items only.',
  '- A price is the amount as written, without the currency symbol (e.g. "12.50", "8").',
  '',
  'OUTPUT CONTRACT — return ONLY this JSON object, no prose, no markdown, no code fences:',
  '{ "sections": [ { "name": "…", "items": [ { "name": "…", "price": "12.50", "description": "…" } ] } ] }',
  'If the page contains no menu at all, return { "sections": [] }.',
].join('\n');

export function buildMenuExtractionUserPrompt(pageText: string): string {
  return [
    'VISIBLE TEXT OF THE PAGE:',
    '---',
    String(pageText || '').slice(0, MENU_LLM_TEXT_CAP),
    '---',
    'Return the menu as the JSON object described above, and nothing else.',
  ].join('\n');
}

/**
 * The page's visible text, shaped for menu reading: headings, list items, table
 * rows and definition lists (what a real menu is built from) plus any element
 * that carries a currency amount (hand-rolled `<div>` price grids match none of
 * the structural selectors). Script/style/nav/footer/header/aside are dropped.
 */
export function visibleMenuText(html: string): string {
  let $: cheerio.CheerioAPI;
  try { $ = cheerio.load(html); } catch { return ''; }
  $('script,style,noscript,template,svg,iframe,form,nav,footer,header,aside').remove();

  const lines: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  const push = (raw: string): boolean => {
    if (total >= MENU_LLM_TEXT_CAP) return false;
    const t = cleanText(raw);
    if (!t || t.length > 400) return true;
    const key = t.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    lines.push(t);
    total += t.length + 1;
    return total < MENU_LLM_TEXT_CAP;
  };

  let room = true;
  $('h1,h2,h3,h4,h5,h6,li,tr,dt,dd,p,figcaption').each((_i, el) => {
    room = push(textOf(el));
    return room;
  });
  if (room) {
    // Innermost money-bearing elements only — otherwise a page wrapper
    // re-emits the whole document on every match.
    $('div,span,td,th,b,strong,em').each((_i, el) => {
      const own = textOf(el);
      if (!HAS_MONEY_RE.test(own)) return room;
      const kids: any[] = (el as any).children || [];
      if (kids.some((c) => c.type === 'tag' && HAS_MONEY_RE.test(textOf(c)))) return room;
      room = push(rowTextFor(el, cleanText(own)));
      return room;
    });
  }
  return lines.join('\n').slice(0, MENU_LLM_TEXT_CAP);
}

/**
 * Text content with a SPACE at every element boundary.
 *
 * `$(el).text()` concatenates with no separator, so the near-universal menu
 * markup `<div class=row><div>Al Pastor</div><div>$4.25</div></div>` came out
 * as `Al Pastor$4.25` — and the first version of this file was worse still: it
 * handed the model a page whose only visible lines were bare prices, because
 * the innermost priced element was `<div>$4.25</div>` and its own text is all
 * we pushed. The item NAMES never reached the model at all. Caught by the
 * "model sees Al Pastor" assertion in the spec, not by review.
 */
function textOf(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.data || '';
  const kids: any[] = node.children || [];
  if (!kids.length) return '';
  return kids.map(textOf).join(' ');
}

/**
 * From an innermost priced element, climb to the smallest ancestor that adds
 * real content — i.e. the ROW: the item name, its description, and the price.
 * Stops at 5 hops, at `<body>`, or as soon as an ancestor grows past a row's
 * worth of text (that is the page, not a row).
 */
function rowTextFor(el: any, own: string): string {
  let cur: any = el.parent;
  for (let hops = 0; cur && hops < 5; hops++, cur = cur.parent) {
    const tag = cur.tagName || cur.name;
    if (!tag || tag === 'body' || tag === 'html') break;
    const text = cleanText(textOf(cur));
    if (!text || text.length > 400) break;
    if (text.length > own.length) return text;
  }
  return own;
}

/** Defensive parse of the model's reply (fences, preamble, junk) into sections. */
function parseModelMenu(raw: string): RawSection[] | null {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let obj: any = null;
  try { obj = JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) { try { obj = JSON.parse(text.slice(start, end + 1)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.sections)) return null;

  const sections: RawSection[] = [];
  for (const rawSection of obj.sections) {
    if (!rawSection || typeof rawSection !== 'object') continue;
    const name = cleanText(rawSection.name) || 'Menu';
    const items: RawItem[] = [];
    for (const rawItem of Array.isArray(rawSection.items) ? rawSection.items : []) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const itemName = cleanText(rawItem.name);
      if (!itemName) continue;
      const item: RawItem = { name: itemName };
      const description = cleanText(rawItem.description);
      if (description) item.description = description;
      const price = normalizeMenuPrice(rawItem.price);
      if (price) item.price = price;
      items.push(item);
    }
    if (items.length) sections.push({ name, items });
  }
  return sections.length ? sections : null;
}

/**
 * THE ANTI-FABRICATION GUARD. A price the MODEL produced only survives if that
 * amount physically appears in the page text. An item whose price fails is
 * dropped entirely — a menu row with a wrong price is worse than no row, and
 * "this item exists but we could not read its price" is not something we can
 * assert either.
 */
export function dropUnverifiedPrices(sections: RawSection[], pageText: string): RawSection[] {
  const onPage = new Set<string>();
  for (const run of String(pageText || '').match(NUMBER_RUN_RE) || []) {
    const key = amountKey(run);
    if (key) onPage.add(key);
  }
  const out: RawSection[] = [];
  for (const section of sections) {
    const items = section.items.filter((item) => {
      if (!item.price) return true;               // no claim, nothing to verify
      const key = amountKey(item.price);
      return !!key && onPage.has(key);
    });
    if (items.length) out.push({ name: section.name, items });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Normalisation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Canonical price string. Keeps the currency SYMBOL seen (or the one implied by
 * a `priceCurrency` code) and normalises the amount: `$4.5` → `$4.50`,
 * `"24.00"`+USD → `$24`, `12,50` (European decimal comma) → `12.50`, `8` → `8`.
 */
export function normalizeMenuPrice(raw: unknown, currency?: unknown): string | null {
  if (raw == null) return null;
  const s = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (!s) return null;
  const run = s.match(/\d[\d,]*(?:[.,]\d{1,2})?/);
  if (!run) return null;

  let digits = run[0];
  if (/,\d{1,2}$/.test(digits) && !digits.includes('.')) {
    digits = digits.replace(/\./g, '').replace(',', '.');   // 1.299,50 → 1299.50
  } else {
    digits = digits.replace(/,/g, '');                      // 1,299.50 → 1299.50
  }
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n) || n < 0) return null;

  const symbolInRaw = s.match(/[$€£¥₹]/);
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  const symbol = symbolInRaw ? symbolInRaw[0] : (CURRENCY_SYMBOL_BY_CODE[code] || '');
  const amount = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${symbol}${amount}`.slice(0, MENU_PRICE_MAX);
}

/** "$4.50" → "4.5" — the comparable key both sides of the price check use. */
function amountKey(raw: string): string | null {
  const normalized = normalizeMenuPrice(raw);
  if (!normalized) return null;
  const n = Number.parseFloat(normalized.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? String(n) : null;
}

function cleanText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim();
}

function clampText(v: string, max: number): string {
  const t = cleanText(v);
  return t.length > max ? t.slice(0, max).trim() : t;
}

/** Trim, cap, de-duplicate by (section, name), and enforce the section/item caps. */
function finalizeMenu(
  raw: RawSection[],
  url: string,
  method: 'jsonld' | 'llm',
): ExtractedMenu | null {
  const sections: ExtractedMenuSection[] = [];
  const seen = new Set<string>();
  let itemCount = 0;

  for (const rawSection of raw) {
    if (sections.length >= MENU_MAX_SECTIONS || itemCount >= MENU_MAX_ITEMS) break;
    const name = clampText(rawSection.name || 'Menu', MENU_NAME_MAX) || 'Menu';
    const items: ExtractedMenuItem[] = [];
    for (const rawItem of rawSection.items || []) {
      if (itemCount >= MENU_MAX_ITEMS) break;
      const itemName = clampText(rawItem.name || '', MENU_NAME_MAX);
      if (!itemName) continue;
      const key = `${name.toLowerCase()} ${itemName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item: ExtractedMenuItem = { name: itemName };
      if (rawItem.price) item.price = clampText(rawItem.price, MENU_PRICE_MAX);
      const description = clampText(rawItem.description || '', MENU_DESC_MAX);
      if (description) item.description = description;
      items.push(item);
      itemCount++;
    }
    if (items.length) sections.push({ name, items });
  }

  if (!itemCount) return null;
  return { sections, itemCount, source: { url, method } };
}

/** Path for the operator-facing "found on …" line — `/menu`, `/`, … */
function pathOf(url: string): string {
  try { return new URL(url).pathname || '/'; } catch { return '/'; }
}

/** A URL is operator input — log its shape, never its query string. */
function safeLabel(url: string): string {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return '(unparseable url)'; }
}
