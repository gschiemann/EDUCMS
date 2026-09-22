/**
 * conciergeMenuContent.ts — the venue's REAL menu, formatted as the designer's
 * REAL CONTENT block (2026-09-22).
 *
 * WHY THIS EXISTS. Greg pasted his restaurant's website into the AI template
 * dialog and asked for a menu board. The Concierge said "I'll pull the menu
 * items from your website"; the three boards came back showing his tenant's
 * TEST price book — `burger $2.99 / fries $3.00 / shake $5.00` — on a
 * near-empty layout.
 *
 * The API now reads the real menu off that site and hangs it on the reference
 * (`ConciergeReference.menu`). This is the last hop: turning it into the
 * `content` field of the designer request, which is the ONE slot that does
 * three things at once —
 *
 *   1. It short-circuits the server's auto-grounding ("grounding only fills a
 *      GAP"), which is what was reaching into the tenant's catalog and pulling
 *      out the test price book.
 *   2. It is a GROUNDED-FACTS source (`collectGroundedFacts` in the API's
 *      fact-guard), so every price here is allowed onto the board and any price
 *      that is NOT here is stripped before the operator sees it.
 *   3. Past 8 rows it switches the designer prompt into full-board menu layout
 *      — every row rendered, sections as columns, type scaled down rather than
 *      rows dropped.
 *
 * PURE. No React, no network. The row shape is `Section — Item — $price —
 * description`, which is what `countMenuContentRows` on the API side counts.
 */
import type { ConciergeReference } from '@cms/api-types';

/** The designer request caps `content` at 8000; stay clear of the edge. */
const CONTENT_MAX = 7_500;

type MenuLike = {
  sections?: Array<{ name?: unknown; items?: Array<{ name?: unknown; price?: unknown; description?: unknown }> }>;
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Every menu across the gathered references, as the designer's REAL CONTENT
 * block. Returns `undefined` when no reference carries a menu — in which case
 * the request omits `content` entirely and behaves exactly as it did before
 * this existed (auto-grounding still gets its shot).
 */
export function buildMenuContentFromReferences(
  references: ReadonlyArray<ConciergeReference> | undefined | null,
): string | undefined {
  const blocks: string[] = [];

  for (const reference of references || []) {
    const menu = (reference as { menu?: MenuLike } | undefined)?.menu;
    const sections = Array.isArray(menu?.sections) ? menu!.sections! : [];
    if (!sections.length) continue;

    const rows: string[] = [];
    for (const section of sections) {
      const sectionName = str(section?.name) || 'Menu';
      for (const item of Array.isArray(section?.items) ? section.items! : []) {
        const name = str(item?.name);
        if (!name) continue;
        const price = str(item?.price);
        const description = str(item?.description);
        // `Section — Item — $4.25 — marinated pork, pineapple`
        rows.push([sectionName, name, price, description].filter(Boolean).join(' — '));
      }
    }
    if (!rows.length) continue;

    const where = str(reference.label) || 'the venue website';
    const sectionCount = new Set(sections.map((s) => str(s?.name) || 'Menu')).size;
    blocks.push(
      [
        // Deliberately carries no currency amount and no " — ": the API counts
        // menu ROWS by exactly those two markers, and a header that looked like
        // a row would inflate the count it uses to decide the layout.
        `REAL MENU from the venue's own website (${where}). ${rows.length} items across ${sectionCount} sections. ` +
          `Every row below is theirs: put ALL of them on the board, names and prices exactly as written, and invent nothing.`,
        ...rows,
      ].join('\n'),
    );
  }

  if (!blocks.length) return undefined;

  const joined = blocks.join('\n\n');
  if (joined.length <= CONTENT_MAX) return joined;
  // Truncate on a LINE boundary — a half-written price is a lie, and the fact
  // guard would strip it from the board anyway.
  const cut = joined.slice(0, CONTENT_MAX);
  return cut.slice(0, cut.lastIndexOf('\n')).trimEnd();
}

/** How many items a reference's menu carries — for the "Menu · 23 items" chip. */
export function referenceMenuItemCount(reference: ConciergeReference | undefined | null): number {
  const menu = (reference as { menu?: MenuLike & { itemCount?: unknown } } | undefined)?.menu;
  if (!menu) return 0;
  if (typeof menu.itemCount === 'number' && Number.isFinite(menu.itemCount) && menu.itemCount > 0) {
    return Math.floor(menu.itemCount);
  }
  // Fall back to counting, so a menu that somehow arrives without its tally
  // still shows the operator that we found one.
  let count = 0;
  for (const section of Array.isArray(menu.sections) ? menu.sections : []) {
    for (const item of Array.isArray(section?.items) ? section.items! : []) {
      if (str(item?.name)) count += 1;
    }
  }
  return count;
}

/**
 * A menu the operator PASTED OR TYPED into the chat (2026-09-22).
 *
 * When a restaurant's website publishes no readable menu (supertacomex.com's
 * prices live inside Toast's ordering app), the Concierge now asks for it the
 * easy way: "paste your menu here, one item per line with its price". Those
 * lines are the operator's own words — the strongest source there is — so they
 * ride to the designer as REAL CONTENT exactly like a website menu does: that
 * short-circuits the server's price-book fallback, grounds every price for the
 * fact guard, and past 8 rows switches the board into full menu layout.
 *
 * A message counts as a menu only when it carries at least THREE priced lines —
 * a sentence like "make the burrito $12 and the tacos $3" is an instruction,
 * not a menu, and stays in the prompt where it already rides. Short unpriced
 * lines sitting directly above a priced line are kept as section headers.
 * The header carries no currency amount and no em-dash pair, for the same
 * reason as the website header above (the API counts rows by those markers).
 */
const PRICED_LINE = /[$€£¥]\s?\d|\b\d{1,4}\.\d{2}\b/;
const MAX_LINE = 200;

export function buildMenuContentFromChat(operatorText: string | null | undefined): string | undefined {
  const lines = String(operatorText || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && l.length <= MAX_LINE);
  const priced = lines.filter((l) => PRICED_LINE.test(l));
  if (priced.length < 3) return undefined;

  const rows: string[] = [];
  lines.forEach((line, i) => {
    if (PRICED_LINE.test(line)) {
      rows.push(line);
      return;
    }
    const next = lines[i + 1];
    const looksLikeHeader = line.length <= 60 && !/[.!?]$/.test(line) && !!next && PRICED_LINE.test(next);
    if (looksLikeHeader) rows.push(line.endsWith(':') ? line : `${line}:`);
  });

  const out = [
    `REAL MENU typed or pasted by the operator in the chat. ${priced.length} priced items. ` +
      `Every row below is theirs: put ALL of them on the board, names and prices exactly as written, and invent nothing.`,
    ...rows,
  ].join('\n');
  if (out.length <= CONTENT_MAX) return out;
  const cut = out.slice(0, CONTENT_MAX);
  return cut.slice(0, cut.lastIndexOf('\n')).trimEnd();
}
