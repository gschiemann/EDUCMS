/**
 * MenuService tests — menu-management-at-scale (2026-05-29).
 * ─────────────────────────────────────────────────────────
 *
 * Covers the three load-bearing behaviours of the per-location menu
 * engine:
 *
 *   1. resolveMenuForLocation — the resolution rule:
 *        price   = override.priceCents ?? item.defaultPriceCents
 *        visible = !isHidden && isAvailable
 *                  && (soldOutUntil == null || soldOutUntil < now)
 *      + daypart filtering by the location's local time.
 *
 *   2. ingestCustomWebhookMenu — { menu } upsert is idempotent
 *      (re-pushing the same item upserts by catalog+externalId, never
 *      duplicates) and ALWAYS scopes to the connection's tenant, never a
 *      client-supplied tenantId.
 *
 *   3. applyAutoEightySix / applySquareInventoryCounts — flip
 *      availability from a stock signal.
 *
 * The Prisma client is mocked per-model. We assert on the upsert
 * `where` / `create` / `update` payloads (tenant provenance, override
 * keys) rather than a real DB.
 */
import { MenuService } from './menu.service';

const TENANT = 'chain-tenant';
const LOC_A = 'location-A';
const LOC_B = 'location-B';

function makeMockPrisma(seed?: {
  catalogs?: any[];
  categories?: any[];
  items?: any[];
  overrides?: any[];
  posLocations?: any[];
}) {
  const menuCatalog = {
    findMany: jest.fn().mockResolvedValue(seed?.catalogs ?? []),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'cat-created' }),
  };
  const menuCategory = {
    findMany: jest.fn().mockResolvedValue(seed?.categories ?? []),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'category-created' }),
  };
  const menuItem = {
    findMany: jest.fn().mockResolvedValue(seed?.items ?? []),
    findFirst: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: create?.externalId ? `item-${create.externalId}` : 'item-x', ...create })),
  };
  const menuLocationOverride = {
    findMany: jest.fn().mockResolvedValue(seed?.overrides ?? []),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const posLocation = {
    findMany: jest.fn().mockResolvedValue(seed?.posLocations ?? []),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const processedPosEvent = { create: jest.fn().mockResolvedValue({}) };

  return {
    client: {
      menuCatalog,
      menuCategory,
      menuItem,
      menuLocationOverride,
      posLocation,
      auditLog,
      processedPosEvent,
    },
  } as any;
}

function svcWith(prisma: any): MenuService {
  return new MenuService(prisma);
}

describe('MenuService.resolveMenuForLocation', () => {
  it('uses the location override price when set, else the catalog default', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      categories: [],
      items: [
        { id: 'i1', externalId: 'burger', name: 'Burger', description: null, defaultPriceCents: 799, imageUrl: null, allergens: [], tags: [], sortOrder: 0, categoryId: null },
        { id: 'i2', externalId: 'fries', name: 'Fries', description: null, defaultPriceCents: 349, imageUrl: null, allergens: ['V'], tags: [], sortOrder: 1, categoryId: null },
      ],
      // LOC_A overrides burger to $9.49; fries inherits.
      overrides: [{ menuItemId: 'i1', priceCents: 949, isAvailable: true, isHidden: false, soldOutUntil: null }],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });

    const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(byId['i1'].priceCents).toBe(949);
    expect(byId['i1'].priceOverridden).toBe(true);
    expect(byId['i2'].priceCents).toBe(349);
    expect(byId['i2'].priceOverridden).toBe(false);
    expect(byId['i2'].allergens).toEqual(['V']);
    // Overrides were queried scoped to the LOCATION tenant.
    expect(prisma.client.menuLocationOverride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationTenantId: LOC_A }) }),
    );
  });

  it('priceCents=0 override is a real free price, not "inherit"', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      items: [{ id: 'i1', externalId: 'water', name: 'Water', defaultPriceCents: 200, allergens: [], tags: [], sortOrder: 0, categoryId: null }],
      overrides: [{ menuItemId: 'i1', priceCents: 0, isAvailable: true, isHidden: false, soldOutUntil: null }],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(res.items[0].priceCents).toBe(0);
    expect(res.items[0].priceOverridden).toBe(true);
  });

  it('hides a 86d item (isAvailable=false) from the player result but keeps it under includeHidden', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      items: [
        { id: 'i1', externalId: 'a', name: 'A', defaultPriceCents: 100, allergens: [], tags: [], sortOrder: 0, categoryId: null },
        { id: 'i2', externalId: 'b', name: 'B', defaultPriceCents: 200, allergens: [], tags: [], sortOrder: 1, categoryId: null },
      ],
      overrides: [{ menuItemId: 'i2', priceCents: null, isAvailable: false, isHidden: false, soldOutUntil: null }],
    });
    const visible = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(visible.items.map((i) => i.id)).toEqual(['i1']);

    const all = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, includeHidden: true });
    expect(all.items.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });

  it('hides an item whose soldOutUntil is in the future, shows it once that passes', async () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const future = new Date('2026-05-29T18:00:00Z');
    const past = new Date('2026-05-29T06:00:00Z');
    const prismaFuture = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      items: [{ id: 'i1', externalId: 'a', name: 'A', defaultPriceCents: 100, allergens: [], tags: [], sortOrder: 0, categoryId: null }],
      overrides: [{ menuItemId: 'i1', priceCents: null, isAvailable: true, isHidden: false, soldOutUntil: future }],
    });
    expect((await svcWith(prismaFuture).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, now })).items).toHaveLength(0);

    const prismaPast = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      items: [{ id: 'i1', externalId: 'a', name: 'A', defaultPriceCents: 100, allergens: [], tags: [], sortOrder: 0, categoryId: null }],
      overrides: [{ menuItemId: 'i1', priceCents: null, isAvailable: true, isHidden: false, soldOutUntil: past }],
    });
    expect((await svcWith(prismaPast).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, now })).items).toHaveLength(1);
  });

  it('hides an explicitly hidden item even when available', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      items: [{ id: 'i1', externalId: 'a', name: 'A', defaultPriceCents: 100, allergens: [], tags: [], sortOrder: 0, categoryId: null }],
      overrides: [{ menuItemId: 'i1', priceCents: null, isAvailable: true, isHidden: true, soldOutUntil: null }],
    });
    expect((await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT })).items).toHaveLength(0);
  });

  it('returns an empty menu when the location/chain has no active catalog', async () => {
    const prisma = makeMockPrisma({ catalogs: [] });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(res.items).toHaveLength(0);
    expect(res.categories).toHaveLength(0);
    // Never queried items/overrides if no catalog.
    expect(prisma.client.menuItem.findMany).not.toHaveBeenCalled();
  });

  it('filters items in a dayparted-out category but keeps always-on categories', async () => {
    // Breakfast daypart 06:00-11:00 America/Chicago. Pick a `now` that is
    // 15:00 Chicago (CDT = UTC-5 in late May) → breakfast is OUT.
    const now = new Date('2026-05-29T20:00:00Z'); // 15:00 CDT
    const breakfast = { id: 'dp-bk', daysOfWeek: [], timeStart: '06:00', timeEnd: '11:00', timezone: 'America/Chicago' };
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      categories: [
        { id: 'c-breakfast', name: 'Breakfast', sortOrder: 0, daypartId: 'dp-bk', daypart: breakfast },
        { id: 'c-allday', name: 'All Day', sortOrder: 1, daypartId: null, daypart: null },
      ],
      items: [
        { id: 'i-bk', externalId: 'pancakes', name: 'Pancakes', defaultPriceCents: 600, allergens: [], tags: [], sortOrder: 0, categoryId: 'c-breakfast' },
        { id: 'i-ad', externalId: 'soda', name: 'Soda', defaultPriceCents: 200, allergens: [], tags: [], sortOrder: 0, categoryId: 'c-allday' },
      ],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, now });
    expect(res.items.map((i) => i.id)).toEqual(['i-ad']);
    expect(res.categories.map((c) => c.id)).toEqual(['c-allday']);
  });

  it('shows a dayparted item when inside its window', async () => {
    const now = new Date('2026-05-29T13:00:00Z'); // 08:00 CDT — inside breakfast
    const breakfast = { id: 'dp-bk', daysOfWeek: [], timeStart: '06:00', timeEnd: '11:00', timezone: 'America/Chicago' };
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      categories: [{ id: 'c-breakfast', name: 'Breakfast', sortOrder: 0, daypartId: 'dp-bk', daypart: breakfast }],
      items: [{ id: 'i-bk', externalId: 'pancakes', name: 'Pancakes', defaultPriceCents: 600, allergens: [], tags: [], sortOrder: 0, categoryId: 'c-breakfast' }],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, now });
    expect(res.items.map((i) => i.id)).toEqual(['i-bk']);
  });
});

describe('MenuService.isDaypartActive', () => {
  const svc = new MenuService({} as any);

  it('respects daysOfWeek', () => {
    // 2026-05-29 is a Friday (dow=5). Restrict to Mon-only (dow=1).
    const fridayNoon = new Date('2026-05-29T17:00:00Z'); // 12:00 CDT Fri
    expect(svc.isDaypartActive({ daysOfWeek: [1], timeStart: '00:00', timeEnd: '23:59', timezone: 'America/Chicago' }, fridayNoon)).toBe(false);
    expect(svc.isDaypartActive({ daysOfWeek: [5], timeStart: '00:00', timeEnd: '23:59', timezone: 'America/Chicago' }, fridayNoon)).toBe(true);
    expect(svc.isDaypartActive({ daysOfWeek: [], timeStart: '00:00', timeEnd: '23:59', timezone: 'America/Chicago' }, fridayNoon)).toBe(true);
  });

  it('handles a wraparound window (22:00 → 02:00)', () => {
    const lateNight = new Date('2026-05-29T04:00:00Z'); // 23:00 CDT (prev day) → inside
    expect(svc.isDaypartActive({ daysOfWeek: [], timeStart: '22:00', timeEnd: '02:00', timezone: 'America/Chicago' }, lateNight)).toBe(true);
    const afternoon = new Date('2026-05-29T20:00:00Z'); // 15:00 CDT → outside
    expect(svc.isDaypartActive({ daysOfWeek: [], timeStart: '22:00', timeEnd: '02:00', timezone: 'America/Chicago' }, afternoon)).toBe(false);
  });

  it('treats a malformed daypart as active (does not vanish content)', () => {
    expect(svc.isDaypartActive({ daysOfWeek: [], timeStart: 'oops', timeEnd: 'nope', timezone: 'Mars/Phobos' }, new Date())).toBe(true);
  });
});

describe('MenuService.ingestCustomWebhookMenu', () => {
  const conn = { id: 'conn-1', tenantId: TENANT, providerId: 'custom-webhook' };

  it('upserts a MenuItem keyed on catalogId+externalId under the CONNECTION tenant (never a client tenantId)', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-1' }); // existing catalog for conn
    const res = await svcWith(prisma).ingestCustomWebhookMenu(conn, {
      menu: [
        { id: 'burger', name: 'Burger', price: 7.99, category: 'Mains', tenantId: 'EVIL-TENANT' },
      ],
    });
    expect(res.itemsUpserted).toBe(1);
    expect(prisma.client.menuItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { catalogId_externalId: { catalogId: 'cat-1', externalId: 'burger' } },
        create: expect.objectContaining({ tenantId: TENANT, externalId: 'burger', name: 'Burger', defaultPriceCents: 799 }),
      }),
    );
    // The attacker-supplied tenantId never reached the create.
    const createArg = prisma.client.menuItem.upsert.mock.calls[0][0].create;
    expect(createArg.tenantId).toBe(TENANT);
  });

  it('is idempotent — re-pushing the same item upserts (not duplicates) by catalog+externalId', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-1' });
    const payload = { menu: [{ id: 'fries', name: 'Fries', priceCents: 349 }] };
    await svcWith(prisma).ingestCustomWebhookMenu(conn, payload);
    await svcWith(prisma).ingestCustomWebhookMenu(conn, payload);
    // Both calls used the SAME upsert key — Prisma upsert is the
    // idempotency mechanism (insert-or-update on the unique key).
    expect(prisma.client.menuItem.upsert).toHaveBeenCalledTimes(2);
    const k1 = prisma.client.menuItem.upsert.mock.calls[0][0].where;
    const k2 = prisma.client.menuItem.upsert.mock.calls[1][0].where;
    expect(k1).toEqual(k2);
    expect(k1).toEqual({ catalogId_externalId: { catalogId: 'cat-1', externalId: 'fries' } });
  });

  it('writes per-location overrides keyed on (locationTenantId, item) with inherit-vs-set price', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-1' });
    await svcWith(prisma).ingestCustomWebhookMenu(conn, {
      menu: [
        {
          id: 'latte',
          name: 'Latte',
          defaultPriceCents: 450,
          locations: [
            { locationTenantId: LOC_A, priceCents: 500 },          // override
            { locationTenantId: LOC_B },                           // inherit (price null)
            { locationTenantId: LOC_B, isAvailable: false },       // 86 at B
          ],
        },
      ],
    });
    expect(prisma.client.menuLocationOverride.upsert).toHaveBeenCalledTimes(3);
    const calls = prisma.client.menuLocationOverride.upsert.mock.calls.map((c: any[]) => c[0]);
    const aCall = calls.find((c: any) => c.where.locationTenantId_menuItemId.locationTenantId === LOC_A);
    expect(aCall.create.priceCents).toBe(500);
    expect(aCall.create.source).toBe('custom-webhook');
    expect(aCall.create.tenantId).toBe(TENANT);
    const bInherit = calls.find((c: any) => c.where.locationTenantId_menuItemId.locationTenantId === LOC_B && c.create.priceCents === null);
    expect(bInherit).toBeTruthy();
  });

  it('skips entries missing id or name and counts them', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-1' });
    const res = await svcWith(prisma).ingestCustomWebhookMenu(conn, {
      menu: [{ name: 'no id' }, { id: 'no-name' }, { id: 'ok', name: 'Good', priceCents: 100 }],
    });
    expect(res).toMatchObject({ itemsUpserted: 1, skipped: 2 });
    expect(prisma.client.menuItem.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects a body without a menu array', async () => {
    const prisma = makeMockPrisma();
    await expect(svcWith(prisma).ingestCustomWebhookMenu(conn, {} as any)).rejects.toThrow();
    expect(prisma.client.menuItem.upsert).not.toHaveBeenCalled();
  });

  it('auto-creates the connection catalog when none exists, audits the ingest', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue(null); // none yet
    prisma.client.menuCatalog.create.mockResolvedValue({ id: 'cat-new' });
    const res = await svcWith(prisma).ingestCustomWebhookMenu(conn, { menu: [{ id: 'x', name: 'X', priceCents: 1 }] });
    expect(prisma.client.menuCatalog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, connectionId: 'conn-1' }) }),
    );
    expect(res.catalogId).toBe('cat-new');
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'MENU_INGEST_CUSTOM_WEBHOOK', tenantId: TENANT }) }),
    );
  });
});

describe('MenuService.applyAutoEightySix (custom-webhook { items: available:false })', () => {
  const conn = { id: 'conn-1', tenantId: TENANT, providerId: 'custom-webhook' };

  it('flips isAvailable=false for the targeted location and audits', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      posLocations: [{ locationTenantId: LOC_A }, { locationTenantId: LOC_B }],
    });
    prisma.client.menuItem.findFirst.mockResolvedValue({ id: 'item-burger' });
    const res = await svcWith(prisma).applyAutoEightySix(conn, [
      { externalId: 'burger', available: false, locationTenantId: LOC_A },
    ]);
    expect(res.itemsMatched).toBe(1);
    expect(res.overridesUpdated).toBe(1);
    const call = prisma.client.menuLocationOverride.upsert.mock.calls[0][0];
    expect(call.where.locationTenantId_menuItemId).toEqual({ locationTenantId: LOC_A, menuItemId: 'item-burger' });
    expect(call.update.isAvailable).toBe(false);
    expect(call.create.tenantId).toBe(TENANT);
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'MENU_AUTO_86' }) }),
    );
  });

  it('fans a location-less 86 out to every mapped location for the connection', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      posLocations: [{ locationTenantId: LOC_A }, { locationTenantId: LOC_B }],
    });
    prisma.client.menuItem.findFirst.mockResolvedValue({ id: 'item-x' });
    const res = await svcWith(prisma).applyAutoEightySix(conn, [{ externalId: 'x', available: false }]);
    expect(res.overridesUpdated).toBe(2); // both locations
    const targets = prisma.client.menuLocationOverride.upsert.mock.calls.map(
      (c: any[]) => c[0].where.locationTenantId_menuItemId.locationTenantId,
    );
    expect(targets.sort()).toEqual([LOC_A, LOC_B]);
  });

  it('skips an externalId that matches no item', async () => {
    const prisma = makeMockPrisma({ catalogs: [{ id: 'cat-1' }], posLocations: [{ locationTenantId: LOC_A }] });
    prisma.client.menuItem.findFirst.mockResolvedValue(null);
    const res = await svcWith(prisma).applyAutoEightySix(conn, [{ externalId: 'ghost', available: false, locationTenantId: LOC_A }]);
    expect(res).toMatchObject({ itemsMatched: 0, overridesUpdated: 0, skipped: 1 });
  });

  it('available:true clears the 86 (isAvailable=true, soldOutUntil=null)', async () => {
    const prisma = makeMockPrisma({ catalogs: [{ id: 'cat-1' }], posLocations: [{ locationTenantId: LOC_A }] });
    prisma.client.menuItem.findFirst.mockResolvedValue({ id: 'item-x' });
    await svcWith(prisma).applyAutoEightySix(conn, [{ externalId: 'x', available: true, locationTenantId: LOC_A }]);
    const call = prisma.client.menuLocationOverride.upsert.mock.calls[0][0];
    expect(call.update.isAvailable).toBe(true);
    expect(call.update.soldOutUntil).toBeNull();
  });
});

describe('MenuService.applySquareInventoryCounts', () => {
  const conn = { id: 'conn-sq', tenantId: TENANT, providerId: 'square' };

  it('86s the matched variation at the mapped location when quantity hits 0', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      // Square location_id "L1" maps to LOC_A.
      posLocations: [{ externalId: 'L1', locationTenantId: LOC_A }],
    });
    // MenuItem externalId is the `${itemId}:${variationId}` form.
    prisma.client.menuItem.findFirst.mockResolvedValue({ id: 'item-1' });
    const res = await svcWith(prisma).applySquareInventoryCounts(conn, [
      { catalog_object_id: 'VAR123', location_id: 'L1', quantity: '0', state: 'IN_STOCK' },
    ]);
    expect(res.itemsMatched).toBe(1);
    const call = prisma.client.menuLocationOverride.upsert.mock.calls[0][0];
    expect(call.where.locationTenantId_menuItemId).toEqual({ locationTenantId: LOC_A, menuItemId: 'item-1' });
    expect(call.update.isAvailable).toBe(false);
    expect(call.update.source).toBe('square');
    // The findFirst matched on exact externalId OR `:VAR123` suffix.
    const where = prisma.client.menuItem.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ externalId: 'VAR123' }, { externalId: { endsWith: ':VAR123' } }]);
  });

  it('restores availability when quantity is positive', async () => {
    const prisma = makeMockPrisma({ catalogs: [{ id: 'cat-1' }], posLocations: [{ externalId: 'L1', locationTenantId: LOC_A }] });
    prisma.client.menuItem.findFirst.mockResolvedValue({ id: 'item-1' });
    await svcWith(prisma).applySquareInventoryCounts(conn, [
      { catalog_object_id: 'VAR123', location_id: 'L1', quantity: '5' },
    ]);
    expect(prisma.client.menuLocationOverride.upsert.mock.calls[0][0].update.isAvailable).toBe(true);
  });

  it('ignores counts for an unmapped location', async () => {
    const prisma = makeMockPrisma({ catalogs: [{ id: 'cat-1' }], posLocations: [{ externalId: 'L1', locationTenantId: LOC_A }] });
    prisma.client.menuItem.findFirst.mockResolvedValue({ id: 'item-1' });
    const res = await svcWith(prisma).applySquareInventoryCounts(conn, [
      { catalog_object_id: 'VAR123', location_id: 'UNKNOWN', quantity: '0' },
    ]);
    expect(res).toMatchObject({ itemsMatched: 0, overridesUpdated: 0, skipped: 1 });
    expect(prisma.client.menuLocationOverride.upsert).not.toHaveBeenCalled();
  });
});

describe('MenuService.ingestOperatorMenu (dashboard "paste your menu")', () => {
  it('upserts into a CONNECTION-LESS catalog (connectionId null) scoped to the actor tenant', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue(null); // no manual catalog yet
    prisma.client.menuCatalog.create.mockResolvedValue({ id: 'cat-manual' });
    const res = await svcWith(prisma).ingestOperatorMenu(TENANT, 'user-1', {
      // The frontend's parseMenuText always stamps an externalId
      // (pasted-<slug>-<i>); a real import never sends a name without one.
      menu: [{ externalId: 'pasted-latte-0', name: 'Latte', price: 4.5, tenantId: 'EVIL' }],
    });
    expect(res.imported).toBe(1);
    expect(res.catalogId).toBe('cat-manual');
    // catalog created with connectionId: null and the actor's tenant (NOT EVIL)
    expect(prisma.client.menuCatalog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, connectionId: null }) }),
    );
    const createArg = prisma.client.menuItem.upsert.mock.calls[0][0].create;
    expect(createArg.tenantId).toBe(TENANT);
    expect(createArg.defaultPriceCents).toBe(450);
  });

  it('is idempotent — re-importing the same item upserts by catalog+externalId', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-manual' });
    const payload = { menu: [{ externalId: 'fries', name: 'Fries', priceCents: 349 }] };
    await svcWith(prisma).ingestOperatorMenu(TENANT, 'user-1', payload);
    await svcWith(prisma).ingestOperatorMenu(TENANT, 'user-1', payload);
    const k1 = prisma.client.menuItem.upsert.mock.calls[0][0].where;
    const k2 = prisma.client.menuItem.upsert.mock.calls[1][0].where;
    expect(k1).toEqual(k2);
    expect(k1).toEqual({ catalogId_externalId: { catalogId: 'cat-manual', externalId: 'fries' } });
  });

  it('tags overrides + audit with source operator-import', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-manual' });
    await svcWith(prisma).ingestOperatorMenu(TENANT, 'user-1', {
      menu: [{ id: 'latte', name: 'Latte', defaultPriceCents: 450, locations: [{ locationTenantId: LOC_A, priceCents: 500 }] }],
    });
    expect(prisma.client.menuLocationOverride.upsert.mock.calls[0][0].create.source).toBe('operator-import');
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'MENU_IMPORT_OPERATOR', userId: 'user-1' }) }),
    );
  });

  it('rejects a body without a menu array', async () => {
    const prisma = makeMockPrisma();
    await expect(svcWith(prisma).ingestOperatorMenu(TENANT, 'user-1', {} as any)).rejects.toThrow();
  });
});
