/**
 * What the Concierge knows about THIS venue's POS (2026-09-22).
 *
 * Before this the Concierge promised "live prices straight from your POS" and
 * "auto-86" to every operator, connected or not, and nothing ever asked which
 * POS they use. Now the chat, the "Use your Toast menu?" card and the bound
 * board generator all read the same facts from here:
 *
 *   • the POS connections this location can bind a board to — its own and its
 *     chain parent's (a chain connects Toast once at the top), with status and
 *     last sync;
 *   • per connection, the menu's sections and how many BINDABLE items each has
 *     (priced, with a POS id) — read through MenuService.resolvePosMenuForLocation
 *     for this location, sold-out items and out-of-hours sections included (the
 *     board is designed once and repainted live);
 *   • what each provider honestly keeps live (POS_LIVE_FACTS — Toast and
 *     Lightspeed report no sold-out).
 *
 * TENANT SCOPE: every read is keyed on the caller's tenant id and its parent —
 * never an id from the request. A selection names a connection; it is honoured
 * only if that connection is in THIS list (resolveConciergePosSelection).
 *
 * Plain functions over injected deps so PosService (the endpoint) and AiService
 * (the chat + generator, which already hold PrismaService + MenuService) share
 * one implementation without a new DI edge.
 */
import {
  conciergeConnectablePos,
  getPosProvider,
  posLiveFactsFor,
  type ConciergeDetectedPos,
  type ConciergePosBoundItem,
  type ConciergePosBoundMenu,
  type ConciergePosConnection,
  type ConciergePosContext,
  type ConciergePosSection,
  type ConciergePosSelection,
} from '@cms/api-types';
import {
  formatPosPrice,
  posBindableItems,
  posSectionsOf,
  sectionKey,
  type PosMenuLike,
} from '../ai/pos-binding-plan';

export interface ConciergePosDeps {
  prisma: { client: any };
  menu: {
    resolvePosMenuForLocation(
      locationTenantId: string,
      opts?: { connectionId?: string; includeUnavailable?: boolean; ignoreDayparts?: boolean },
    ): Promise<PosMenuLike>;
  };
}

/** The design-time read of one connection's menu for this location. */
export function readConnectionMenu(deps: ConciergePosDeps, tenantId: string, connectionId: string): Promise<PosMenuLike> {
  return deps.menu.resolvePosMenuForLocation(tenantId, { connectionId, includeUnavailable: true, ignoreDayparts: true });
}

/** POS connections a board at this location may bind to: its own first, then its chain parent's. */
export async function loadBindableConnections(
  deps: ConciergePosDeps,
  tenantId: string,
): Promise<Array<{ id: string; tenantId: string; providerId: string; displayName: string | null; status: string; statusReason: string | null; lastSyncedAt: Date | null; owner: 'self' | 'parent' }>> {
  // ten-ok: the caller's OWN tenant row (req.user.tenantId), read only to find its chain parent.
  const me = (await deps.prisma.client.tenant.findUnique({
    where: { id: tenantId },
    select: { parentId: true },
  })) as { parentId?: string | null } | null;
  const owners = Array.from(new Set([tenantId, me?.parentId].filter((x): x is string => !!x)));
  const rows = (await deps.prisma.client.posProviderConnection.findMany({
    where: { tenantId: { in: owners } },
    select: { id: true, tenantId: true, providerId: true, displayName: true, status: true, statusReason: true, lastSyncedAt: true },
    orderBy: { createdAt: 'desc' },
  })) as Array<{ id: string; tenantId: string; providerId: string; displayName: string | null; status: string; statusReason: string | null; lastSyncedAt: Date | null }>;
  return rows
    .filter((r) => owners.includes(r.tenantId))
    .map((r) => ({ ...r, owner: r.tenantId === tenantId ? ('self' as const) : ('parent' as const) }))
    .sort((a, b) => (a.owner === b.owner ? 0 : a.owner === 'self' ? -1 : 1));
}

type BindableConnection = Awaited<
  ReturnType<typeof loadBindableConnections>
>[number];

/** One connection as the Concierge card and the builder describe it. */
function describeConnection(
  row: BindableConnection,
  sections: ConciergePosSection[],
): ConciergePosConnection {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName: getPosProvider(row.providerId)?.name || row.providerId,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    status: row.status,
    ...(row.statusReason ? { statusReason: row.statusReason } : {}),
    ...(row.lastSyncedAt
      ? { lastSyncedAt: new Date(row.lastSyncedAt).toISOString() }
      : {}),
    owner: row.owner,
    itemCount: sections.reduce((n, s) => n + s.itemCount, 0),
    sections,
    live: posLiveFactsFor(row.providerId),
  };
}

/**
 * GET /templates/concierge/pos-context — and the chat's POS state. A menu that
 * cannot be read (a DB blip on one connection) reports that connection with no
 * sections rather than failing the whole read.
 */
export async function loadConciergePosContext(deps: ConciergePosDeps, tenantId: string): Promise<ConciergePosContext> {
  const rows = await loadBindableConnections(deps, tenantId);
  const connections: ConciergePosConnection[] = [];
  for (const row of rows) {
    let sections: ConciergePosSection[] = [];
    try {
      const menu = await readConnectionMenu(deps, tenantId, row.id);
      sections = posSectionsOf(menu).map((s) => ({ name: s.name, itemCount: s.items.length }));
    } catch {
      sections = [];
    }
    connections.push(describeConnection(row, sections));
  }
  return { connections, connectable: conciergeConnectablePos() };
}

/**
 * GET /templates/concierge/pos-bound-menu (2026-09-23, POS-A) — what the
 * builder checks a POS-bound board's rows against: the connection it is bound
 * to, and that connection's menu for THIS location, read exactly the way the
 * board was bound (sold-out items included, every section whatever the hour).
 *
 * TENANT SCOPE: the connection id comes from the board's saved config, which the
 * operator controls — so it is honoured only if it is one of this location's
 * own or its chain parent's connections (loadBindableConnections, keyed on the
 * caller's tenant). Anything else answers `connection: null` and no items; it
 * is never read. A menu that cannot be read keeps the connection, `readable:
 * false`.
 */
export async function loadPosBoundMenu(
  deps: ConciergePosDeps,
  tenantId: string,
  connectionId: unknown,
): Promise<ConciergePosBoundMenu> {
  const id = typeof connectionId === 'string' ? connectionId.trim() : '';
  const none: ConciergePosBoundMenu = {
    connection: null,
    items: [],
    readable: true,
  };
  if (!id || id.length > 64) return none;
  const rows = await loadBindableConnections(deps, tenantId);
  const row = rows.find((r) => r.id === id);
  if (!row) return none;
  let menu: PosMenuLike | null = null;
  try {
    menu = await readConnectionMenu(deps, tenantId, row.id);
  } catch {
    menu = null;
  }
  if (!menu) {
    return {
      connection: describeConnection(row, []),
      items: [],
      readable: false,
    };
  }
  const sections = posSectionsOf(menu).map((s) => ({
    name: s.name,
    itemCount: s.items.length,
  }));
  const items: ConciergePosBoundItem[] = posBindableItems(menu).map((it) => ({
    externalId: String(it.externalId),
    name: String(it.name),
    price: formatPosPrice(it.priceCents),
    available: it.available !== false,
  }));
  return {
    connection: describeConnection(row, sections),
    items,
    readable: true,
  };
}

/** Integration-discovery rule ids → POS catalog ids (they differ for two providers). */
const DISCOVERY_TO_CATALOG: Readonly<Record<string, string>> = {
  square: 'square',
  toast: 'toast',
  clover: 'clover',
  lightspeed: 'lightspeed-retail',
  shopify: 'shopify-pos',
};

/** Below this, a match is a passing mention ("Square reader"), not a link to their POS. */
const DETECTED_POS_MIN_CONFIDENCE = 0.5;

/**
 * The POS a website links to, from IntegrationDiscoveryService.discoverFromUrl's
 * candidates (an order.toasttab.com / squareup.com / clover.com link). Only
 * providers the operator can connect themselves are reported.
 */
export function detectedPosFromDiscovery(
  candidates: Array<{ id: string; category: string; confidence: number }> | null | undefined,
): ConciergeDetectedPos[] {
  const known = new Map(conciergeConnectablePos().map((p) => [p.providerId, p.name]));
  const out: ConciergeDetectedPos[] = [];
  for (const c of candidates || []) {
    if (c.category !== 'pos' || !(c.confidence >= DETECTED_POS_MIN_CONFIDENCE)) continue;
    const providerId = DISCOVERY_TO_CATALOG[c.id];
    if (!providerId || !known.has(providerId) || out.some((o) => o.providerId === providerId)) continue;
    out.push({ providerId, name: known.get(providerId)!, confidence: Math.min(1, c.confidence) });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

/** A selection this tenant may use: its connection, and the chosen sections that exist. */
export interface ResolvedPosSelection {
  connection: ConciergePosConnection;
  sections: ConciergePosSection[];
  itemCount: number;
}

/**
 * Honour a client's `posSelection` only against THIS tenant's own context: an
 * unknown connection (another tenant's, a deleted one) or sections that do not
 * exist resolve to null — the chat then talks as if nothing was selected.
 */
export function resolveConciergePosSelection(
  ctx: ConciergePosContext | null | undefined,
  selection: ConciergePosSelection | null | undefined,
): ResolvedPosSelection | null {
  if (!ctx || !selection || !selection.connectionId) return null;
  const connection = ctx.connections.find((c) => c.id === selection.connectionId);
  if (!connection) return null;
  const wanted = new Set((selection.sections || []).map(sectionKey));
  const sections = connection.sections.filter((s) => wanted.has(sectionKey(s.name)));
  if (!sections.length) return null;
  return { connection, sections, itemCount: sections.reduce((n, s) => n + s.itemCount, 0) };
}
