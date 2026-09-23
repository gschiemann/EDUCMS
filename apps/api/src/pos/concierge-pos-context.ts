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
  type ConciergePosConnection,
  type ConciergePosContext,
  type ConciergePosSection,
  type ConciergePosSelection,
} from '@cms/api-types';
import { posSectionsOf, sectionKey, type PosMenuLike } from '../ai/pos-binding-plan';

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
    connections.push({
      id: row.id,
      providerId: row.providerId,
      providerName: getPosProvider(row.providerId)?.name || row.providerId,
      ...(row.displayName ? { displayName: row.displayName } : {}),
      status: row.status,
      ...(row.statusReason ? { statusReason: row.statusReason } : {}),
      ...(row.lastSyncedAt ? { lastSyncedAt: new Date(row.lastSyncedAt).toISOString() } : {}),
      owner: row.owner,
      itemCount: sections.reduce((n, s) => n + s.itemCount, 0),
      sections,
      live: posLiveFactsFor(row.providerId),
    });
  }
  return { connections, connectable: conciergeConnectablePos() };
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
