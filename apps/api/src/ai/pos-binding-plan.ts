/**
 * pos-binding-plan.ts — the SERVER builds the item list a POS-bound AI board shows.
 *
 * 2026-09-22 (Greg: "…ensures the template is created with perfect integrations
 * into those systems"). When the operator picks "Use your Toast menu" in the
 * Concierge, the request carries only `{ connectionId, sections[] }`. Every item
 * on the board comes from here — this tenant's POS-synced catalog
 * (`MenuService.resolvePosMenuForLocation`, the location + its chain parent),
 * filtered to the chosen sections — never from anything the client sent, and
 * the server's own auto-grounding is skipped (it would only duplicate this).
 *
 * The plan numbers every item (`n`), and that number is the ONLY identity the
 * model sees: `formatPosPlanContent` writes `[item.N] Section — Name — $price —
 * desc` rows with no ids in them. `menu-binding.ts` then stamps each row's
 * catalog id back onto the board from the plan.
 *
 * PURE — no Nest, no Prisma. The row limit and the provider facts live in
 * `@cms/api-types` (concierge-pos.ts) so the web card and the server agree.
 */
import type { BindingPlan, BindingPlanItem } from './menu-binding';

/** One item as MenuService resolves it (the fields a plan needs). */
export interface PosMenuItemLike {
  externalId: string | null;
  name: string;
  description?: string | null;
  priceCents: number;
  category?: string | null;
  available?: boolean;
}

/** A resolved menu — `ResolvedMenu` from MenuService, structurally. */
export interface PosMenuLike {
  categories: Array<{ id: string; name: string }>;
  items: PosMenuItemLike[];
}

/** Items with no POS section are shown under this name. */
export const UNCATEGORIZED_SECTION = 'Menu';

export type PosPlanErrorCode = 'POS_SELECTION_EMPTY' | 'MENU_TOO_MANY_ITEMS';

/** A selection that cannot become one board — mapped to a 422 by the caller. */
export class PosPlanError extends Error {
  constructor(
    readonly code: PosPlanErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PosPlanError';
  }
}

/** "$14.50" — the same format the screen menu feed uses (device-menu.ts fmtCents). */
export function formatPosPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function clean(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    // The row format is " — "-delimited: a dash inside a name must not look like a delimiter.
    .replace(/\s[—–]\s/g, ' - ')
    // …and nothing may look like a row number.
    .replace(/\[item\.\d+\]/gi, '')
    .trim()
    .slice(0, max)
    .trim();
}

/** Section names compare case- and space-insensitively. */
export function sectionKey(name: string): string {
  return clean(name, 80).toLowerCase();
}

/**
 * Items a board can BIND: a POS id to bind to, a name, and a real price (an
 * open-priced or $0 line is a modifier, not a menu row). First copy of an id wins.
 */
export function posBindableItems(menu: PosMenuLike): PosMenuItemLike[] {
  const seen = new Set<string>();
  const out: PosMenuItemLike[] = [];
  for (const it of menu.items || []) {
    const id = typeof it.externalId === 'string' ? it.externalId.trim() : '';
    if (!id || seen.has(id)) continue;
    if (!clean(it.name, 80)) continue;
    if (typeof it.priceCents !== 'number' || !Number.isFinite(it.priceCents) || it.priceCents <= 0) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

/** The menu's sections in POS order (uncategorized items last), bindable items only. */
export function posSectionsOf(menu: PosMenuLike): Array<{ name: string; items: PosMenuItemLike[] }> {
  const order: string[] = [];
  const byKey = new Map<string, { name: string; items: PosMenuItemLike[] }>();
  const ensure = (name: string) => {
    const key = sectionKey(name);
    if (!byKey.has(key)) {
      byKey.set(key, { name: clean(name, 60) || UNCATEGORIZED_SECTION, items: [] });
      order.push(key);
    }
    return byKey.get(key)!;
  };
  for (const c of menu.categories || []) if (clean(c.name, 60)) ensure(c.name);
  const uncategorized: PosMenuItemLike[] = [];
  for (const it of posBindableItems(menu)) {
    if (it.category && clean(it.category, 60)) ensure(it.category).items.push(it);
    else uncategorized.push(it);
  }
  if (uncategorized.length) ensure(UNCATEGORIZED_SECTION).items.push(...uncategorized);
  return order.map((k) => byKey.get(k)!).filter((s) => s.items.length > 0);
}

/**
 * The plan: the chosen sections' bindable items, numbered in section order.
 * Throws PosPlanError when nothing is chosen, or when more is chosen than one
 * screen can show (`rowLimit`, from conciergePosRowLimit — the card enforces the
 * same number, the server is the one that counts).
 */
export function buildPosBindingPlan(args: {
  menu: PosMenuLike;
  sections: string[];
  providerId: string;
  providerName: string;
  connectionId: string;
  rowLimit: number;
}): BindingPlan {
  const wanted = new Set((args.sections || []).map(sectionKey).filter(Boolean));
  const chosen = posSectionsOf(args.menu).filter((s) => wanted.has(sectionKey(s.name)));
  const items: BindingPlanItem[] = [];
  for (const section of chosen) {
    for (const it of section.items) {
      items.push({
        n: items.length,
        externalId: String(it.externalId).trim(),
        name: clean(it.name, 80),
        priceCents: it.priceCents,
        priceText: formatPosPrice(it.priceCents),
        section: section.name,
        description: clean(it.description, 120) || null,
      });
    }
  }
  if (!items.length) {
    throw new PosPlanError(
      'POS_SELECTION_EMPTY',
      `None of the sections you picked has a priced item in your ${args.providerName} menu. Pick another section, or sync ${args.providerName} in Settings → POS.`,
      { sections: args.sections },
    );
  }
  if (items.length > args.rowLimit) {
    throw new PosPlanError(
      'MENU_TOO_MANY_ITEMS',
      `${items.length} items don't fit one screen — choose fewer sections (up to ${args.rowLimit} items).`,
      { count: items.length, rowLimit: args.rowLimit },
    );
  }
  return {
    providerId: args.providerId,
    providerName: args.providerName,
    connectionId: args.connectionId,
    items,
  };
}

/**
 * The row contract, restated where the rows are. The designer prompt owns the
 * full directive (data-menu-row / item.N.* — the prompt agent's
 * designer-prompt.ts); this one line keeps a POS board bindable on its own and
 * can go once that directive is merged. No currency and no " — " in it, so
 * countMenuContentRows never counts it as a menu row.
 */
export const POS_ROW_CONTRACT_LINE =
  'Every [item.N] row below is bound to the POS: render each one exactly once and keep its number, wrap each row in ONE element carrying data-menu-row="N", mark its name data-field="item.N.name" and its price data-field="item.N.price" (a shown description: data-field="item.N.desc"), copy names and prices exactly as written, and never hide or drop a row.';

/**
 * The REAL CONTENT block for a POS plan:
 *
 *   LIVE POS MENU from Toast. 21 items in 2 sections, bound to the venue's POS.
 *   <row contract>
 *   Tacos:
 *   [item.0] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef
 *
 * The header avoids " — " and currency so it is not counted as a row. No id
 * ever appears here — the model is never given one to copy.
 */
export function formatPosPlanContent(plan: BindingPlan): string {
  const sections: string[] = [];
  for (const it of plan.items) if (!sections.includes(it.section)) sections.push(it.section);
  const lines: string[] = [
    `LIVE POS MENU from ${plan.providerName}. ${plan.items.length} item${plan.items.length === 1 ? '' : 's'} in ${sections.length} section${sections.length === 1 ? '' : 's'}, bound to the venue's POS.`,
    POS_ROW_CONTRACT_LINE,
  ];
  for (const section of sections) {
    lines.push(`${section}:`);
    for (const it of plan.items.filter((i) => i.section === section)) {
      lines.push(
        [`[item.${it.n}] ${it.section}`, it.name, it.priceText, it.description || '']
          .filter(Boolean)
          .join(' — '),
      );
    }
  }
  return lines.join('\n');
}
