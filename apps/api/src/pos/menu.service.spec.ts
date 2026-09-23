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
  it('limits a menu wall to its selected Toast connection inside the tenant scope', async () => {
    const prisma = makeMockPrisma();
    await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, connectionId: 'toast-connection' });
    expect(prisma.client.menuCatalog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: 'toast-connection', isActive: true }),
    }));
  });
  it('limits an unbound Super Taco preset to active Toast connections owned by its location or chain', async () => {
    const prisma = makeMockPrisma();
    prisma.client.posProviderConnection = { findMany: jest.fn().mockResolvedValue([{ id: 'toast-connection' }]) };
    await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, providerId: 'toast' });
    expect(prisma.client.posProviderConnection.findMany).toHaveBeenCalledWith({
      where: { tenantId: { in: [TENANT, LOC_A] }, providerId: 'toast', status: 'ACTIVE' }, select: { id: true },
    });
    expect(prisma.client.menuCatalog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: { in: ['toast-connection'] } }),
    }));
  });
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
    expect(res.sourceConfigured).toBe(false);
    // Never queried items/overrides if no catalog.
    expect(prisma.client.menuItem.findMany).not.toHaveBeenCalled();
  });

  it('marks an existing but empty catalog as configured so the screen clears sample prices', async () => {
    const prisma = makeMockPrisma({ catalogs: [{ id: 'cat-1' }], items: [] });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(res.items).toEqual([]);
    expect(res.sourceConfigured).toBe(true);
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

    // 2026-09-22 — DESIGNING a board is not playing one: the breakfast section
    // exists at 3pm too, so the Concierge / bound-board generator ask for every
    // section. Opt-in only — the player default above is unchanged.
    const all = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, now, ignoreDayparts: true });
    expect(all.items.map((i) => i.id)).toEqual(['i-bk', 'i-ad']);
    expect(all.categories.map((c) => c.id)).toEqual(['c-breakfast', 'c-allday']);
  });

  // ── Parent/child catalog scoping (POS sandbox bug #2, 2026-08-04) ──
  // A location/school tenant WITH a parent that connects its own POS
  // owns its catalogs itself. The device menu used to scope catalogs to
  // the parent only, so those screens rendered an empty wall while the
  // dashboard reported a successful sync.

  it('resolves catalogs owned by the LOCATION tenant when the chain has none (child-with-own-POS)', async () => {
    const prisma = makeMockPrisma({
      // The school's own catalog — owned by LOC_A, not the parent chain.
      catalogs: [{ id: 'cat-school', tenantId: LOC_A }],
      items: [
        { id: 'i1', externalId: 'taco', name: 'Taco', defaultPriceCents: 450, allergens: [], tags: [], sortOrder: 0, categoryId: null, catalogId: 'cat-school' },
      ],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });

    // The item the school synced MUST reach the wall.
    expect(res.items.map((i) => i.id)).toEqual(['i1']);
    // The catalog query scoped to BOTH the chain and the location tenant.
    expect(prisma.client.menuCatalog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: { in: expect.arrayContaining([TENANT, LOC_A]) },
        }),
      }),
    );
  });

  it('merges chain + location catalogs; location-owned item wins an externalId collision', async () => {
    const prisma = makeMockPrisma({
      catalogs: [
        { id: 'cat-chain', tenantId: TENANT },
        { id: 'cat-loc', tenantId: LOC_A },
      ],
      items: [
        // Same externalId in both catalogs → the location's row wins.
        { id: 'i-chain-burger', externalId: 'burger', name: 'Burger (chain)', defaultPriceCents: 799, allergens: [], tags: [], sortOrder: 0, categoryId: null, catalogId: 'cat-chain' },
        { id: 'i-loc-burger', externalId: 'burger', name: 'Burger (local)', defaultPriceCents: 899, allergens: [], tags: [], sortOrder: 1, categoryId: null, catalogId: 'cat-loc' },
        // Chain-only + location-only items both survive.
        { id: 'i-chain-fries', externalId: 'fries', name: 'Fries', defaultPriceCents: 349, allergens: [], tags: [], sortOrder: 2, categoryId: null, catalogId: 'cat-chain' },
        { id: 'i-loc-taco', externalId: 'taco', name: 'Taco', defaultPriceCents: 450, allergens: [], tags: [], sortOrder: 3, categoryId: null, catalogId: 'cat-loc' },
        // No externalId → never deduped, even across catalogs.
        { id: 'i-chain-anon', externalId: null, name: 'Special', defaultPriceCents: 500, allergens: [], tags: [], sortOrder: 4, categoryId: null, catalogId: 'cat-chain' },
      ],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });

    const ids = res.items.map((i) => i.id);
    expect(ids).toContain('i-loc-burger');
    expect(ids).not.toContain('i-chain-burger');
    expect(ids).toContain('i-chain-fries');
    expect(ids).toContain('i-loc-taco');
    expect(ids).toContain('i-chain-anon');
  });

  it('keeps single-tenant scoping when chain and location tenant are the same', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1', tenantId: LOC_A }],
      items: [{ id: 'i1', externalId: 'a', name: 'A', defaultPriceCents: 100, allergens: [], tags: [], sortOrder: 0, categoryId: null, catalogId: 'cat-1' }],
    });
    const res = await svcWith(prisma).resolveMenuForLocation(LOC_A, { catalogTenantId: LOC_A });
    expect(res.items).toHaveLength(1);
    // Degenerate case stays a plain equality filter (no `in`).
    expect(prisma.client.menuCatalog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: LOC_A }) }),
    );
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

// ─── POS-sandbox bug #1 (2026-08-04): catalog-level availability ─────────
// ingestPosCatalog used to drop `item.available` on the floor, so a Clover/
// Lightspeed/Shopify item the POS marks hidden or unavailable (only Square
// emits per-location locationPrices) still rendered on real kiosks via the
// device-authed GET /screens/:id/menu. Mirrors the sandbox proof: a Clover
// snapshot with an available:false item must be absent from
// resolveMenuForLocation output. Repro harness: scripts/pos-sandbox/.
describe('MenuService.ingestPosCatalog — catalog-level availability', () => {
  const cloverConn = { id: 'conn-clover', tenantId: TENANT, providerId: 'clover' };

  it('persists item.available=false onto MenuItem.isAvailable (create AND update)', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-1' });
    // Clover-style snapshot: hidden item carries available:false, NO
    // locationPrices (only Square emits those).
    const snapshot = {
      items: [
        { externalId: 'burger', name: 'Burger', priceCents: 799, available: true },
        { externalId: 'secret-item', name: 'Hidden Special', priceCents: 999, available: false },
      ],
      categories: [],
    } as any;
    const res = await svcWith(prisma).ingestPosCatalog(cloverConn, snapshot);
    expect(res.itemsUpserted).toBe(2);

    const calls = prisma.client.menuItem.upsert.mock.calls.map((c: any[]) => c[0]);
    const hiddenCall = calls.find((c: any) => c.where.catalogId_externalId.externalId === 'secret-item');
    expect(hiddenCall.create.isAvailable).toBe(false);
    expect(hiddenCall.update.isAvailable).toBe(false); // a later sync that hides an existing item must stick
    const visibleCall = calls.find((c: any) => c.where.catalogId_externalId.externalId === 'burger');
    expect(visibleCall.create.isAvailable).toBe(true);
    expect(visibleCall.update.isAvailable).toBe(true); // and un-hiding must stick too
  });

  it('treats a missing available flag as available (inherit-true, zero regression)', async () => {
    const prisma = makeMockPrisma();
    prisma.client.menuCatalog.findFirst.mockResolvedValue({ id: 'cat-1' });
    await svcWith(prisma).ingestPosCatalog(cloverConn, {
      items: [{ externalId: 'x', name: 'X', priceCents: 100 }],
      categories: [],
    } as any);
    expect(prisma.client.menuItem.upsert.mock.calls[0][0].create.isAvailable).toBe(true);
  });
});

describe('MenuService.resolveMenuForLocation — MenuItem.isAvailable (POS catalog-level)', () => {
  const seed = () => ({
    catalogs: [{ id: 'cat-1' }],
    items: [
      { id: 'i1', externalId: 'burger', name: 'Burger', defaultPriceCents: 799, allergens: [], tags: [], sortOrder: 0, categoryId: null, isAvailable: true },
      { id: 'i2', externalId: 'secret-item', name: 'Hidden Special', defaultPriceCents: 999, allergens: [], tags: [], sortOrder: 1, categoryId: null, isAvailable: false },
    ],
    overrides: [],
  });

  it('drops a POS-unavailable item from the player/kiosk result (the sandbox proof)', async () => {
    const res = await svcWith(makeMockPrisma(seed())).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(res.items.map((i) => i.id)).toEqual(['i1']);
  });

  it('keeps it hidden even under includeUnavailable (POS-hidden ≠ greyed-out 86)', async () => {
    const res = await svcWith(makeMockPrisma(seed())).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, includeUnavailable: true });
    expect(res.items.map((i) => i.id)).toEqual(['i1']);
  });

  it('admin console (includeHidden) still sees it, flagged available:false', async () => {
    const res = await svcWith(makeMockPrisma(seed())).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT, includeHidden: true });
    const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(byId['i2']).toBeTruthy();
    expect(byId['i2'].available).toBe(false);
  });

  it('a per-location override cannot resurrect a POS-catalog-unavailable item', async () => {
    const s = seed();
    (s as any).overrides = [{ menuItemId: 'i2', priceCents: null, isAvailable: true, isHidden: false, soldOutUntil: null }];
    const res = await svcWith(makeMockPrisma(s)).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(res.items.map((i) => i.id)).toEqual(['i1']);
  });

  it('legacy rows without the column (isAvailable undefined) keep rendering', async () => {
    const s = seed();
    (s as any).items = [{ id: 'i3', externalId: 'legacy', name: 'Legacy', defaultPriceCents: 100, allergens: [], tags: [], sortOrder: 0, categoryId: null }];
    const res = await svcWith(makeMockPrisma(s)).resolveMenuForLocation(LOC_A, { catalogTenantId: TENANT });
    expect(res.items.map((i) => i.id)).toEqual(['i3']);
  });
});

// ── 2026-09-22 — only a POS-SYNCED menu may ground an AI board without being asked ──
describe('MenuService.resolvePosMenuForLocation — POS-synced catalogs only', () => {
  function svcWith(catalogs: Array<{ id: string; tenantId: string; connectionId: string | null }>, parentId: string | null) {
    const findMany = jest.fn(async ({ where }: any) =>
      catalogs.filter(
        (c) => where.tenantId.in.includes(c.tenantId) && where.isActive === true && (where.connectionId?.not === null ? c.connectionId !== null : true),
      ),
    );
    const prisma: any = {
      client: {
        tenant: { findUnique: jest.fn(async () => ({ parentId })) },
        menuCatalog: { findMany },
      },
    };
    const svc = new MenuService(prisma);
    const resolveSpy = jest.spyOn(svc, 'resolveMenuForLocation').mockImplementation(async (loc: string, opts: any) => ({
      locationTenantId: loc,
      generatedAt: 'x',
      sourceConfigured: true,
      categories: [],
      items: [{ id: `item-of-${opts.catalogId}`, name: opts.catalogId } as any],
    }));
    return { svc, findMany, resolveSpy };
  }

  it('a hand-built price book (no POS connection) grounds nothing — Greg\'s burger / fries / shake', async () => {
    const { svc, resolveSpy } = svcWith([{ id: 'pricebook', tenantId: 'riot', connectionId: null }], null);
    const menu = await svc.resolvePosMenuForLocation('riot');
    expect(menu.items).toEqual([]);
    expect(menu.sourceConfigured).toBe(false);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('reads only the POS-linked catalogs, for the location AND its chain parent', async () => {
    const { svc, findMany, resolveSpy } = svcWith(
      [
        { id: 'toast-chain', tenantId: 'chain', connectionId: 'conn-toast' },
        { id: 'square-site', tenantId: 'site', connectionId: 'conn-square' },
        { id: 'pasted', tenantId: 'site', connectionId: null },
        { id: 'other-tenant', tenantId: 'elsewhere', connectionId: 'conn-x' },
      ],
      'chain',
    );
    const menu = await svc.resolvePosMenuForLocation('site');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ tenantId: { in: ['site', 'chain'] }, isActive: true, connectionId: { not: null } });
    expect(menu.items.map((i: any) => i.name).sort()).toEqual(['square-site', 'toast-chain']);
    expect(resolveSpy).toHaveBeenCalledWith('site', { catalogTenantId: 'chain', catalogId: 'toast-chain' });
    expect(resolveSpy).toHaveBeenCalledWith('site', { catalogTenantId: 'site', catalogId: 'square-site' });
  });

  it('design-time read: one connection, sold-out items and out-of-hours sections included (2026-09-22)', async () => {
    const findMany = jest.fn(async () => [{ id: 'toast-chain', tenantId: 'chain' }]);
    const prisma: any = { client: { tenant: { findUnique: jest.fn(async () => ({ parentId: 'chain' })) }, menuCatalog: { findMany } } };
    const svc = new MenuService(prisma);
    const resolveSpy = jest.spyOn(svc, 'resolveMenuForLocation').mockResolvedValue({
      locationTenantId: 'site', generatedAt: 'x', sourceConfigured: true, categories: [], items: [],
    });
    await svc.resolvePosMenuForLocation('site', { connectionId: 'conn-toast', includeUnavailable: true, ignoreDayparts: true });
    // Still scoped to the location + its chain parent — the connection id only NARROWS.
    expect((findMany.mock.calls[0] as any)[0].where).toEqual({ tenantId: { in: ['site', 'chain'] }, isActive: true, connectionId: 'conn-toast' });
    expect(resolveSpy).toHaveBeenCalledWith('site', {
      catalogTenantId: 'chain', catalogId: 'toast-chain', includeUnavailable: true, ignoreDayparts: true,
    });
  });
});
