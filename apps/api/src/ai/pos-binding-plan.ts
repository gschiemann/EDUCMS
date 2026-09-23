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
  /** The POS's own photo of the item (`MenuItem.imageUrl` — Toast today). */
  imageUrl?: string | null;
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

/** An https photo URL the POS gave us, or undefined (never http, never a data: blob). */
function httpsPhotoUrl(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const u = v.trim();
  if (u.length > 2048) return undefined;
  try {
    return new URL(u).protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

function clean(v: string | null | undefined, max: number): string {
  return (typeof v === 'string' ? v : '')
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
      const photo = httpsPhotoUrl(it.imageUrl);
      items.push({
        n: items.length,
        externalId: String(it.externalId).trim(),
        name: clean(it.name, 80),
        priceCents: it.priceCents,
        priceText: formatPosPrice(it.priceCents),
        section: section.name,
        description: clean(it.description, 120) || null,
        // The POS's photo is only a SOURCE: designer-pos-binding.ts checks and
        // copies it, and only our copy (`imageUrl`) ever reaches a prompt or a board.
        ...(photo ? { sourceImageUrl: photo } : {}),
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
 * The REAL CONTENT block for a POS plan:
 *
 *   LIVE POS MENU from Toast. 21 items in 2 sections, bound to the venue's POS.
 *   Tacos:
 *   [item.0] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef — photo: item.0.photo
 *   [item.1] Tacos — Fish Taco — $4.50
 *   Item photos (the POS's own photo of each dish; each belongs to its own row only):
 *   item.0.photo: https://…/ai-designer/<tenant>/item-<hash>.jpg
 *
 * The header avoids " — " and currency so it is not counted as a row. No id
 * ever appears here — the model is never given one to copy. The row contract
 * (data-menu-row / item.N.*) is NOT restated here: the designer prompt reads
 * these [item.N] rows and states it ONCE, after them
 * (buildPosBoundRowsDirective in designer-prompt.ts).
 *
 * ITEM PHOTOS (2026-09-23): a row whose photo was checked and copied to our
 * bucket ends "— photo: item.N.photo", and our URL is listed under "Item
 * photos" after the rows — never on the row itself, which stays short enough to
 * count as a row (countMenuContentRows ignores a line over 300 characters; a
 * long description is shortened to keep the marker). Only OUR copy is ever
 * printed: the POS's own URL (`sourceImageUrl`) never is.
 */
export function formatPosPlanContent(plan: BindingPlan): string {
  const sections: string[] = [];
  for (const it of plan.items) if (!sections.includes(it.section)) sections.push(it.section);
  const lines: string[] = [
    `LIVE POS MENU from ${plan.providerName}. ${plan.items.length} item${plan.items.length === 1 ? '' : 's'} in ${sections.length} section${sections.length === 1 ? '' : 's'}, bound to the venue's POS.`,
  ];
  for (const section of sections) {
    lines.push(`${section}:`);
    for (const it of plan.items.filter((i) => i.section === section)) lines.push(posRowLine(it));
  }
  const photos = plan.items.filter((it) => it.imageUrl);
  if (photos.length) {
    lines.push(ITEM_PHOTOS_HEADING);
    for (const it of photos) lines.push(`item.${it.n}.photo: ${it.imageUrl}`);
  }
  return lines.join('\n');
}

/** Heads the photo list — no " — " and no currency, so it never counts as a menu row. */
export const ITEM_PHOTOS_HEADING =
  "Item photos (the POS's own photo of each dish; each belongs to its own row only):";

/** A menu row is read as one only up to this length (countMenuContentRows). */
const MAX_ROW_CHARS = 300;

/** `[item.N] Section — Name — $price — desc — photo: item.N.photo`, never over MAX_ROW_CHARS. */
function posRowLine(it: BindingPlanItem): string {
  const head = [`[item.${it.n}] ${it.section}`, it.name, it.priceText];
  const photo = it.imageUrl ? `photo: item.${it.n}.photo` : '';
  let desc = it.description || '';
  if (desc) {
    const room = MAX_ROW_CHARS - [...head, photo].filter(Boolean).join(' — ').length - ' — '.length;
    if (desc.length > room) desc = room >= 12 ? `${desc.slice(0, room - 1).trimEnd()}…` : '';
  }
  return [...head, desc, photo].filter(Boolean).join(' — ');
}
