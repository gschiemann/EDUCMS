/**
 * conciergePos.ts — the pure logic behind the Concierge's POS card (2026-09-22).
 *
 * Greg: "our AI needs to be super tuned into our POS integrations so that when
 * we ask for an integration it knows to ask what one and ensures the template is
 * created with perfect integrations into those systems".
 *
 * When the chat looks like a menu board, the card either offers the venue's
 * connected POS menu ("Use your Toast menu — 42 items in 6 categories?", the
 * sections pre-ticked from the operator's own words, never more than one screen
 * holds) or asks which POS they use (the one their website links to
 * highlighted). The operator's pick rides with every chat turn and with
 * Generate as `posSelection`; the SERVER re-verifies it and builds the board's
 * item list itself — nothing here is trusted for that.
 *
 * PURE — no React, no network. Unit-tested in __tests__/concierge-pos.test.ts.
 */
import {
  conciergePosRowLimit,
  type ConciergeIntake,
  type ConciergePosConnection,
  type ConciergePosContext,
  type ConciergePosProviderOption,
  type ConciergePosSection,
  type ConciergePosSelection,
  type ConciergeReference,
} from '@cms/api-types';

/** Words that say the board shows a menu or prices (a food word alone does not — "welcome to our taco shop"). */
const MENU_WORDS = /\b(menu|menus|prices?|pricing|price list|specials?|happy hour|combos?|drink list|precios|carta)\b/i;
/** The same, in scripts where \b does not apply (menú, 菜单 = menu, 价格 = price, 价目 = price list). */
const MENU_WORDS_INTL = /(menú|菜单|价格|价目)/i;

/** Does the conversation so far look like a MENU board? */
export function looksLikeMenuBoard(args: {
  intake?: ConciergeIntake | null;
  operatorText?: string | null;
  references?: ReadonlyArray<ConciergeReference> | null;
}): boolean {
  const intake = args.intake || {};
  if (intake.purpose === 'menu') return true;
  if (Array.isArray(intake.widgets) && intake.widgets.includes('menu')) return true;
  if ((args.references || []).some((r) => (r?.menu?.sections?.length ?? 0) > 0)) return true;
  const text = String(args.operatorText || '');
  return MENU_WORDS.test(text) || MENU_WORDS_INTL.test(text);
}

/** How many menu rows this canvas holds — the same number the server enforces. */
export function rowLimitFor(canvas: { w: number; h: number } | null | undefined): number {
  return conciergePosRowLimit(canvas?.w, canvas?.h);
}

const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim();

/** "Tacos" is named by "just the tacos", "taco board" … (singular / plural both count). */
function namedIn(section: string, text: string): boolean {
  const s = norm(section);
  if (!s) return false;
  const t = ` ${norm(text)} `;
  if (t.includes(` ${s} `)) return true;
  const singular = s.endsWith('s') && s.length > 3 ? s.slice(0, -1) : s;
  return t.includes(` ${singular} `) || t.includes(` ${singular}s `);
}

/**
 * The sections to tick when the card opens: the ones the operator NAMED, when
 * they named any (never swapping in sections they did not ask for); otherwise
 * every section, in POS order, while they still fit one screen. A section
 * larger than one screen is never pre-ticked.
 */
export function preTickSections(
  sections: ReadonlyArray<ConciergePosSection>,
  operatorText: string | null | undefined,
  rowLimit: number,
): string[] {
  const fits = (s: ConciergePosSection) => s.itemCount > 0 && s.itemCount <= rowLimit;
  const named = sections.filter((s) => namedIn(s.name, String(operatorText || '')));
  const pool = (named.length ? named : sections).filter(fits);
  const out: string[] = [];
  let total = 0;
  for (const s of pool) {
    if (total + s.itemCount > rowLimit) continue;
    out.push(s.name);
    total += s.itemCount;
  }
  return out;
}

/** Items in the ticked sections. */
export function tickedItemCount(sections: ReadonlyArray<ConciergePosSection>, ticked: ReadonlyArray<string>): number {
  const set = new Set(ticked);
  return sections.filter((s) => set.has(s.name)).reduce((n, s) => n + s.itemCount, 0);
}

/**
 * Can this section be ticked right now? Never past the row limit — the card
 * holds the same line the server enforces, so Generate cannot be refused for it.
 */
export function canTick(
  sections: ReadonlyArray<ConciergePosSection>,
  ticked: ReadonlyArray<string>,
  name: string,
  rowLimit: number,
): boolean {
  if (ticked.includes(name)) return true;
  const section = sections.find((s) => s.name === name);
  if (!section || section.itemCount <= 0) return false;
  return tickedItemCount(sections, ticked) + section.itemCount <= rowLimit;
}

/** The selection that travels with a chat turn and Generate, or undefined. */
export function buildPosSelection(connectionId: string | null | undefined, ticked: ReadonlyArray<string>): ConciergePosSelection | undefined {
  if (!connectionId || !ticked.length) return undefined;
  return { connectionId, sections: [...ticked] };
}

/** POS providers the shared website links to (the reference endpoint's `detectedPos`). */
export function detectedPosIds(references: ReadonlyArray<ConciergeReference> | null | undefined): string[] {
  const out: string[] = [];
  for (const r of references || []) {
    for (const d of Array.isArray(r?.detectedPos) ? r.detectedPos : []) {
      const id = typeof d?.providerId === 'string' ? d.providerId : '';
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** The connection a card offers: the first with items, else the first. */
export function primaryConnection(ctx: ConciergePosContext | null | undefined): ConciergePosConnection | null {
  const list = ctx?.connections || [];
  return list.find((c) => c.itemCount > 0) || list[0] || null;
}

export type PosCardView =
  /** Not a menu board / not enabled / nothing loaded yet. */
  | { kind: 'hidden' }
  /** A POS menu is picked for this board. */
  | { kind: 'selected'; connection: ConciergePosConnection; selection: ConciergePosSelection; itemCount: number }
  /** A connected POS with a menu — offer its sections. */
  | { kind: 'offer'; connection: ConciergePosConnection }
  /** Connected, but its menu has not synced yet. */
  | { kind: 'unsynced'; connection: ConciergePosConnection }
  /** Nothing connected — which POS? (the detected ones highlighted) */
  | { kind: 'connect'; providers: ConciergePosProviderOption[]; detected: string[] }
  /** The operator said they will type the menu / use no POS. */
  | { kind: 'declined'; connection: ConciergePosConnection | null };

/** Which card to show. */
export function posCardView(args: {
  enabled: boolean;
  isMenu: boolean;
  context: ConciergePosContext | null | undefined;
  selection: ConciergePosSelection | null | undefined;
  declined: boolean;
  references?: ReadonlyArray<ConciergeReference> | null;
}): PosCardView {
  if (!args.enabled || !args.context) return { kind: 'hidden' };
  const ctx = args.context;
  if (args.selection) {
    const connection = ctx.connections.find((c) => c.id === args.selection!.connectionId);
    if (connection) {
      return { kind: 'selected', connection, selection: args.selection, itemCount: tickedItemCount(connection.sections, args.selection.sections) };
    }
  }
  if (!args.isMenu) return { kind: 'hidden' };
  const connection = primaryConnection(ctx);
  if (args.declined) return { kind: 'declined', connection };
  if (connection) return connection.itemCount > 0 ? { kind: 'offer', connection } : { kind: 'unsynced', connection };
  const detected = detectedPosIds(args.references);
  const providers = [...ctx.connectable].sort(
    (a, b) => Number(detected.includes(b.providerId)) - Number(detected.includes(a.providerId)),
  );
  return { kind: 'connect', providers, detected };
}

/** OAuth providers connect in a new tab straight from the card; the rest go to Settings → POS. */
export function connectsByOAuth(provider: ConciergePosProviderOption): boolean {
  // Shopify's authorize URL needs the shop domain first — Settings → POS asks for it.
  return provider.auth === 'oauth2' && provider.providerId !== 'shopify-pos';
}
