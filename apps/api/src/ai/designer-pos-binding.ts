/**
 * designer-pos-binding.ts — POS-bound AI boards, end to end (2026-09-22).
 *
 * The three moments a board's POS binding is decided, all on the server:
 *
 *   GENERATE  the operator picked "Use your Toast menu" (posSelection). The item
 *             list comes from THIS tenant's catalog for that connection
 *             (loadPosBindingPlan) — never from the client — and every board is
 *             bound, guarded and validated (finishDesignerBoard).
 *   KEEP      create-designer reads the bindings back off the board, verifies
 *             every id against THIS tenant's catalog, strips the rest, and saves
 *             Codex's zone config (verifiedBoardBindings → posZoneConfig).
 *   REVISE    "Edit with words" re-stamps the same bindings on the revised board,
 *             so a model that dropped an attribute cannot unbind a row.
 *
 * Plain functions over injected deps (PrismaService + MenuService), shared by
 * AiService and TemplatesController without a new DI edge.
 *
 * ITEM PHOTOS (2026-09-23). The Super Taco boards carry a photo per card; an AI
 * board carried at most one hero, and `MenuItem.imageUrl` never reached the
 * plan. GENERATE now checks and copies up to 12 of the POS's own item photos
 * into our bucket BEFORE the draw (attachPlanPhotos — four at a time, one
 * shared 8 s budget), so the rows the model sees can say "photo: item.N.photo"
 * and the binder can hold every card to its own photo. A photo that fails is
 * simply absent; a row with no photo never gets a stock photo of some other
 * dish. KEEP saves nothing new for photos (they are static per keep — a live
 * photo repaint is a later step), and REVISE leaves images as they are.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { safeFetch } from '../branding/safe-fetch';
// TYPE-ONLY at module load: designer-assets.ts reaches cheerio (through menu-extractor.ts), and
// the web test fixtures load THIS module from source under a transformer that cannot parse
// cheerio. The runtime import happens inside attachPlanPhotos, the only caller.
import type { DesignerAssetStorage } from './designer-assets';
import type * as DesignerAssets from './designer-assets';
import { conciergePosRowLimit, getPosProvider, type ConciergePosSelection } from '@cms/api-types';
import {
  loadBindableConnections,
  readConnectionMenu,
  type ConciergePosDeps,
} from '../pos/concierge-pos-context';
import { buildPosBindingPlan, formatPosPrice, PosPlanError, posBindableItems } from './pos-binding-plan';
import {
  bindMenuRows,
  readMenuBindings,
  validateBoundBoard,
  type BindingPlan,
} from './menu-binding';
import { enforceGroundedFactsInHtml, type GroundedFacts } from './fact-guard';

/** Codex's POS zone-config convention (ToastItemBindingsPanel / WidgetRenderer). */
export interface PosZoneConfig {
  posSync: true;
  dataSource: 'POS';
  posProvider: string;
  posConnectionId: string;
  /** `{ 'item.N': '<externalId>' }` */
  posItemBindings: Record<string, string>;
}

/** 422 with a stable code the web maps to plain words. */
function unprocessable(code: string, message: string, details: Record<string, unknown> = {}): HttpException {
  return new HttpException({ code, message, ...details }, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * How a plan's item photos are fetched and stored. AiService passes its own
 * injected SupabaseStorageService (the bucket every other AI-board image is
 * copied to); fetch / clock default to safeFetch / Date.now. No storage ⇒ no
 * item photos — never a hotlink.
 */
export interface PlanPhotoDeps {
  storage?: DesignerAssetStorage | null;
  fetch?: typeof safeFetch;
  now?: () => number;
  log?: (msg: string) => void;
  /** The one shared budget for every photo of the plan (default 8 s). */
  budgetMs?: number;
}

/**
 * GENERATE — the plan for a posSelection: the connection must be this
 * location's own or its chain parent's, and the chosen sections' bindable items
 * must fit one screen (conciergePosRowLimit — the card shows the same number).
 * Then the POS's own item photos are checked and copied (attachPlanPhotos).
 */
export async function loadPosBindingPlan(
  deps: ConciergePosDeps & { photos?: PlanPhotoDeps | null },
  tenantId: string,
  selection: ConciergePosSelection,
  canvas: { width: number; height: number },
): Promise<BindingPlan> {
  const connections = await loadBindableConnections(deps, tenantId);
  const connection = connections.find((c) => c.id === selection.connectionId);
  if (!connection) {
    throw unprocessable('POS_CONNECTION_NOT_FOUND', 'That POS connection is not available here. Pick your POS again in the card.');
  }
  const providerName = getPosProvider(connection.providerId)?.name || connection.providerId;
  const menu = await readConnectionMenu(deps, tenantId, connection.id);
  let plan: BindingPlan;
  try {
    plan = buildPosBindingPlan({
      menu,
      sections: selection.sections,
      providerId: connection.providerId,
      providerName,
      connectionId: connection.id,
      rowLimit: conciergePosRowLimit(canvas.width, canvas.height),
    });
  } catch (e) {
    if (e instanceof PosPlanError) throw unprocessable(e.code, e.message, e.details);
    throw e;
  }
  await attachPlanPhotos(plan, { tenantId, canvas }, deps.photos ?? null);
  return plan;
}

/**
 * The POS's own photo for up to 12 rows, checked and copied to OUR bucket
 * (designer-assets.rehostItemPhotos — safeFetch, the decoded-size gate sized
 * for a menu card's frame, ~1.25× that frame, four at a time, ONE shared 8 s
 * budget). A row gets `imageUrl` = our copy, or nothing. Marks the plan as the
 * whole truth about photos (`itemPhotos`), so the binder holds every card to
 * its own photo — with no photos at all, that means no borrowed ones either.
 * NEVER throws: a photo problem never costs the board.
 */
export async function attachPlanPhotos(
  plan: BindingPlan,
  opts: { tenantId: string; canvas: { width: number; height: number } },
  photoDeps: PlanPhotoDeps | null,
): Promise<void> {
  plan.itemPhotos = true;
  const wanted = plan.items
    .filter((it) => typeof it.sourceImageUrl === 'string' && it.sourceImageUrl)
    .map((it) => ({ n: it.n, url: it.sourceImageUrl as string }));
  if (!wanted.length || !photoDeps?.storage) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rehostItemPhotos } = require('./designer-assets') as typeof DesignerAssets;
    const res = await rehostItemPhotos(
      wanted,
      {
        tenantId: opts.tenantId,
        screenWidth: opts.canvas.width,
        screenHeight: opts.canvas.height,
        ...(photoDeps.budgetMs ? { budgetMs: photoDeps.budgetMs } : {}),
      },
      {
        storage: photoDeps.storage,
        ...(photoDeps.fetch ? { fetch: photoDeps.fetch } : {}),
        ...(photoDeps.now ? { now: photoDeps.now } : {}),
        ...(photoDeps.log ? { log: photoDeps.log } : {}),
      },
    );
    for (const it of plan.items) {
      const got = res.photos.get(it.n);
      if (got) it.imageUrl = got.url;
    }
  } catch {
    // rehostItemPhotos never throws; this only keeps that promise here too.
  }
}

/**
 * The one line a retry adds to the user prompt: which `[item.N]` rows the last
 * board lost. Row numbers only — the model never sees an id.
 */
export function missingRowsNudge(missing: number[]): string {
  const rows = missing.slice(0, 12).map((n) => `[item.${n}]`).join(', ');
  const more = missing.length > 12 ? ` and ${missing.length - 12} more` : '';
  return `\n\nIMPORTANT — the previous attempt left out ${rows}${more}. Render EVERY [item.N] row exactly once, keyed data-menu-row="N" with its data-field="item.N.name" and data-field="item.N.price", and make the type scale fit them all.`;
}

/** Every planned row, bound and priced, did not survive: "21 items don't fit one screen". */
export function menuBindingIncomplete(plan: BindingPlan, missing: number[]): HttpException {
  return unprocessable(
    'MENU_BINDING_INCOMPLETE',
    `${plan.items.length} items don't fit one screen — choose fewer sections.`,
    { items: plan.items.length, missing: missing.length },
  );
}

/**
 * GENERATE / REVISE — one sanitized board through bind → price guard →
 * validate. With no plan this is exactly the price guard it always was.
 */
export function finishDesignerBoard(
  cleanHtml: string,
  facts: GroundedFacts,
  plan: BindingPlan | null,
  opts: { removeStrays?: boolean } = {},
): { html: string; dropped: string[]; removedNodes: number; binding: { ok: boolean; missing: number[] } | null } {
  const bound = plan ? bindMenuRows(cleanHtml, plan, { removeStrays: opts.removeStrays !== false }).html : cleanHtml;
  const guarded = enforceGroundedFactsInHtml(bound, facts);
  return {
    html: guarded.html,
    dropped: guarded.dropped,
    removedNodes: guarded.removedNodes,
    binding: plan ? validateBoundBoard(guarded.html, plan) : null,
  };
}

/**
 * KEEP / REVISE — the bindings a board carries, verified against THIS tenant.
 * Returns null when the board carries none. Otherwise a plan holding only the
 * rows whose ids are in the connection's catalog for this location (catalog
 * names + prices), and the ids that were not (another tenant's, a deleted
 * item's, anything the page made up).
 */
export async function verifiedBoardBindings(
  deps: ConciergePosDeps,
  tenantId: string,
  html: string,
): Promise<{ plan: BindingPlan | null; dropped: string[] } | null> {
  const read = readMenuBindings(html);
  const slotEntries = Object.entries(read.slots);
  if (!slotEntries.length && !read.connectionId) return null;
  const all = slotEntries.map(([, id]) => id);
  const connection = read.connectionId
    ? (await loadBindableConnections(deps, tenantId)).find((c) => c.id === read.connectionId)
    : undefined;
  if (!connection) return { plan: null, dropped: all };
  const menu = await readConnectionMenu(deps, tenantId, connection.id);
  const byId = new Map(posBindableItems(menu).map((it) => [String(it.externalId), it]));
  const providerName = getPosProvider(connection.providerId)?.name || connection.providerId;
  const plan: BindingPlan = { providerId: connection.providerId, providerName, connectionId: connection.id, items: [] };
  const dropped: string[] = [];
  for (const [slot, id] of slotEntries) {
    const it = byId.get(id);
    const n = Number(slot.slice('item.'.length));
    if (!it || !Number.isInteger(n)) { dropped.push(id); continue; }
    plan.items.push({
      n,
      externalId: id,
      name: String(it.name),
      priceCents: it.priceCents,
      priceText: formatPosPrice(it.priceCents),
      section: String(it.category || ''),
      description: it.description ?? null,
    });
  }
  return { plan: plan.items.length ? plan : null, dropped };
}

/** The zone config a kept board saves with its html (Codex's convention). */
export function posZoneConfig(plan: BindingPlan): PosZoneConfig {
  const posItemBindings: Record<string, string> = {};
  for (const it of [...plan.items].sort((a, b) => a.n - b.n)) posItemBindings[`item.${it.n}`] = it.externalId;
  return {
    posSync: true,
    dataSource: 'POS',
    posProvider: plan.providerId,
    posConnectionId: plan.connectionId,
    posItemBindings,
  };
}

/** Every binding attribute off a board (rows and root) — nothing on it could be verified. */
export function stripBoardBindings(html: string): string {
  const empty: BindingPlan = { providerId: '', providerName: '', connectionId: '', items: [] };
  return bindMenuRows(html, empty, { removeStrays: false }).html;
}

/**
 * KEEP / REVISE (controller) — the html to save and the POS config to save with
 * it. Verified rows are re-stamped with the catalog's names + prices; rows whose
 * ids could not be verified are unbound (their html stays). `config` is null for
 * a board with nothing left bound. Returns null for a board that carries no
 * bindings at all (save it exactly as before).
 */
export async function bindingsForSave(
  deps: ConciergePosDeps,
  tenantId: string,
  html: string,
): Promise<{ html: string; config: PosZoneConfig | null; dropped: string[] } | null> {
  const verified = await verifiedBoardBindings(deps, tenantId, html);
  if (!verified) return null;
  if (!verified.plan) return { html: stripBoardBindings(html), config: null, dropped: verified.dropped };
  const rebound = bindMenuRows(html, verified.plan, { removeStrays: false });
  return { html: rebound.html, config: posZoneConfig(verified.plan), dropped: verified.dropped };
}
