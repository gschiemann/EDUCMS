/**
 * The Concierge's POS context (2026-09-22) — tenant-scoped, parent-aware, honest.
 *
 * The prisma double FILTERS by the `where` it is handed (never returns a fixed
 * list), so a query that forgot its tenant predicate would return the other
 * tenant's connection and fail these tests. The menu double is shaped like
 * MenuService.resolvePosMenuForLocation's ResolvedMenu.
 */
import { loadConciergePosContext, resolveConciergePosSelection } from './concierge-pos-context';
import { PosService } from './pos.service';

const CONNECTIONS = [
  { id: 'conn-site-square', tenantId: 'site', providerId: 'square', displayName: 'Downtown Square', status: 'ACTIVE', statusReason: null, lastSyncedAt: new Date('2026-09-22T19:55:00Z'), createdAt: new Date('2026-09-01') },
  { id: 'conn-chain-toast', tenantId: 'chain', providerId: 'toast', displayName: null, status: 'ACTIVE', statusReason: null, lastSyncedAt: new Date('2026-09-22T19:58:00Z'), createdAt: new Date('2026-08-01') },
  { id: 'conn-other-tenant', tenantId: 'someone-else', providerId: 'toast', displayName: 'NOT YOURS', status: 'ACTIVE', statusReason: null, lastSyncedAt: null, createdAt: new Date('2026-09-02') },
];

const item = (externalId: string | null, name: string, priceCents: number, category: string | null) => ({
  id: `mi-${name}`, externalId, name, description: null, priceCents, priceOverridden: false, imageUrl: null,
  allergens: [], tags: [], category, categoryId: category, sortOrder: 0, available: true, soldOut: false,
});

const MENUS: Record<string, any> = {
  'conn-chain-toast': {
    locationTenantId: 'site', generatedAt: 'x', sourceConfigured: true,
    categories: [{ id: 'Tacos', name: 'Tacos', sortOrder: 0, daypartId: null }, { id: 'Drinks', name: 'Drinks', sortOrder: 1, daypartId: null }],
    items: [
      item('t1', 'Fish Taco', 450, 'Tacos'),
      item('t2', 'Birria Taco', 500, 'Tacos'),
      item(null, 'Hand-typed', 300, 'Tacos'), // not bindable
      { ...item('d1', 'Horchata', 325, 'Drinks'), available: false, soldOut: true }, // sold out right now: still on the menu
    ],
  },
  'conn-site-square': {
    locationTenantId: 'site', generatedAt: 'x', sourceConfigured: true,
    categories: [{ id: 'Coffee', name: 'Coffee', sortOrder: 0, daypartId: null }],
    items: [item('sq1', 'Cortado', 450, 'Coffee')],
  },
};

function deps(opts: { parentId?: string | null; failFor?: string } = {}) {
  const findMany = jest.fn(async ({ where }: any) =>
    CONNECTIONS.filter((c) => where.tenantId.in.includes(c.tenantId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  );
  const tenantFind = jest.fn(async ({ where }: any) => (where.id === 'site' ? { parentId: opts.parentId === undefined ? 'chain' : opts.parentId } : null));
  const resolvePosMenuForLocation = jest.fn(async (_loc: string, o: any) => {
    if (o?.connectionId === opts.failFor) throw new Error('db blip');
    return MENUS[o.connectionId] ?? { locationTenantId: 'site', generatedAt: 'x', sourceConfigured: false, categories: [], items: [] };
  });
  return {
    d: { prisma: { client: { tenant: { findUnique: tenantFind }, posProviderConnection: { findMany } } }, menu: { resolvePosMenuForLocation } },
    findMany,
    resolvePosMenuForLocation,
  };
}

describe('loadConciergePosContext', () => {
  it('lists the location\'s own connection first, then its chain parent\'s — never another tenant\'s', async () => {
    const { d, findMany } = deps();
    const ctx = await loadConciergePosContext(d, 'site');
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: { in: ['site', 'chain'] } });
    expect(ctx.connections.map((c) => [c.id, c.owner])).toEqual([
      ['conn-site-square', 'self'],
      ['conn-chain-toast', 'parent'],
    ]);
    expect(JSON.stringify(ctx)).not.toContain('NOT YOURS');
  });

  it('counts BINDABLE items per section, sold-out ones included, read at design time for this location', async () => {
    const { d, resolvePosMenuForLocation } = deps();
    const ctx = await loadConciergePosContext(d, 'site');
    const toast = ctx.connections.find((c) => c.providerId === 'toast')!;
    expect(toast.sections).toEqual([{ name: 'Tacos', itemCount: 2 }, { name: 'Drinks', itemCount: 1 }]);
    expect(toast.itemCount).toBe(3);
    expect(toast.providerName).toBe('Toast');
    expect(toast.lastSyncedAt).toBe('2026-09-22T19:58:00.000Z');
    expect(resolvePosMenuForLocation).toHaveBeenCalledWith('site', { connectionId: 'conn-chain-toast', includeUnavailable: true, ignoreDayparts: true });
  });

  it('says honestly what each POS keeps live — Toast reports no sold-out, Square does', async () => {
    const { d } = deps();
    const ctx = await loadConciergePosContext(d, 'site');
    expect(ctx.connections.find((c) => c.providerId === 'toast')!.live).toMatchObject({ soldOut: false, cadence: 'publish-5min', photos: true });
    expect(ctx.connections.find((c) => c.providerId === 'square')!.live).toMatchObject({ soldOut: true, cadence: 'webhook', photos: false });
  });

  it('offers a Connect button for every self-serve POS (never the developer webhook or a sales-led one)', async () => {
    const { d } = deps();
    const ctx = await loadConciergePosContext(d, 'site');
    expect(ctx.connectable.map((p) => p.providerId)).toEqual(['square', 'toast', 'clover', 'lightspeed-retail', 'shopify-pos']);
  });

  it('a menu that cannot be read costs that connection its sections, never the whole answer', async () => {
    const { d } = deps({ failFor: 'conn-chain-toast' });
    const ctx = await loadConciergePosContext(d, 'site');
    expect(ctx.connections.find((c) => c.id === 'conn-chain-toast')!.sections).toEqual([]);
    expect(ctx.connections.find((c) => c.id === 'conn-site-square')!.itemCount).toBe(1);
  });

  it('a single-location venue reads only its own connections', async () => {
    const { d, findMany } = deps({ parentId: null });
    await loadConciergePosContext(d, 'site');
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: { in: ['site'] } });
  });

  it('PosService.conciergePosContext is the same read, over its own prisma + MenuService', async () => {
    const { d } = deps();
    const svc = new PosService(d.prisma as any, d.menu as any);
    const ctx = await svc.conciergePosContext('site');
    expect(ctx.connections).toHaveLength(2);
  });
});

describe('resolveConciergePosSelection', () => {
  it('honours a selection only against this tenant\'s own connections and sections', async () => {
    const { d } = deps();
    const ctx = await loadConciergePosContext(d, 'site');
    expect(resolveConciergePosSelection(ctx, { connectionId: 'conn-chain-toast', sections: ['tacos', 'Desserts'] })).toEqual({
      connection: expect.objectContaining({ id: 'conn-chain-toast' }),
      sections: [{ name: 'Tacos', itemCount: 2 }],
      itemCount: 2,
    });
    expect(resolveConciergePosSelection(ctx, { connectionId: 'conn-other-tenant', sections: ['Tacos'] })).toBeNull();
    expect(resolveConciergePosSelection(ctx, { connectionId: 'conn-chain-toast', sections: ['Desserts'] })).toBeNull();
    expect(resolveConciergePosSelection(null, { connectionId: 'conn-chain-toast', sections: ['Tacos'] })).toBeNull();
  });
});
