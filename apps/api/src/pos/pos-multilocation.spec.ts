/**
 * POS per-location pricing engine — tests (2026-06-02).
 * ─────────────────────────────────────────────────────────
 *
 * The chain: Square locations + per-location price overrides → our
 * PosLocation rows → (operator maps store→location) → the menu-platform
 * bridge writes per-location MenuLocationOverride(source='square') →
 * resolveMenuForLocation serves each store its own price.
 *
 * Covers the load-bearing pieces, no network / no DB:
 *   1. squareFetchLocations parses /v2/locations.
 *   2. squareFetchCatalog captures variation `location_overrides` +
 *      item present/absent into NormalizedItem.locationPrices.
 *   3. MenuService.ingestPosCatalog upserts MenuItem + per-location override
 *      ONLY for mapped locations, and NEVER clobbers a source='manual' row.
 */
import { squareFetchLocations, squareFetchCatalog } from './providers/square';
import { MenuService } from './menu.service';

function mockJson(payload: any) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('squareFetchLocations', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

  it('maps /v2/locations to NormalizedLocation (id, name, address, timezone, status)', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(mockJson({
      locations: [
        { id: 'SQ-L1', name: 'Austin', timezone: 'America/Chicago', status: 'ACTIVE',
          address: { address_line_1: '1 Main St', locality: 'Austin', administrative_district_level_1: 'TX', postal_code: '78701' } },
        { id: 'SQ-L2', name: 'Dallas', status: 'INACTIVE' },
      ],
    }));
    const locs = await squareFetchLocations('tok');
    expect(locs).toHaveLength(2);
    expect(locs[0]).toEqual({
      externalId: 'SQ-L1', name: 'Austin', timezone: 'America/Chicago', status: 'ACTIVE',
      address: '1 Main St, Austin, TX, 78701',
    });
    expect(locs[1].externalId).toBe('SQ-L2');
    expect(locs[1].address).toBeUndefined();
  });
});

describe('squareFetchCatalog — per-location price capture', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

  it('captures variation location_overrides + item absent list into locationPrices', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(mockJson({
      objects: [
        {
          type: 'ITEM', id: 'ITEM1', is_deleted: false,
          present_at_all_locations: true, absent_at_location_ids: ['SQ-L2'],
          item_data: {
            name: 'Burger', category_id: 'CAT1',
            variations: [{
              id: 'VAR1', is_deleted: false,
              item_variation_data: {
                name: 'Regular',
                price_money: { amount: 899 },
                location_overrides: [{ location_id: 'SQ-L1', price_money: { amount: 1099 } }],
              },
            }],
          },
        },
        { type: 'CATEGORY', id: 'CAT1', category_data: { name: 'Mains', ordinal: 1 } },
      ],
      cursor: undefined,
    }));
    const snap = await squareFetchCatalog('tok');
    const item = snap.items.find((i) => i.externalId === 'ITEM1:VAR1')!;
    expect(item.priceCents).toBe(899);              // base
    expect(item.category).toBe('Mains');
    const lp = item.locationPrices!;
    // SQ-L1 → price override; SQ-L2 → 86 (absent).
    expect(lp).toEqual(expect.arrayContaining([
      { externalLocationId: 'SQ-L1', priceCents: 1099 },
      { externalLocationId: 'SQ-L2', available: false },
    ]));
  });
});

describe('MenuService.ingestPosCatalog — POS drives per-location pricing', () => {
  function makePrisma(opts: { mappedLocations: any[]; existingOverride?: any }) {
    const menuLocationOverride = {
      findUnique: jest.fn().mockResolvedValue(opts.existingOverride ?? null),
      upsert: jest.fn().mockResolvedValue({}),
    };
    return {
      override: menuLocationOverride,
      client: {
        menuCatalog: { findFirst: jest.fn().mockResolvedValue({ id: 'catalog-1' }), create: jest.fn() },
        menuCategory: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'category-1' }) },
        menuItem: { upsert: jest.fn().mockResolvedValue({ id: 'item-1' }) },
        menuLocationOverride,
        posLocation: { findMany: jest.fn().mockResolvedValue(opts.mappedLocations) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    } as any;
  }

  const conn = { id: 'conn-1', tenantId: 'chain-1', providerId: 'square' };
  const snapshot = {
    categories: [{ externalId: 'CAT1', name: 'Mains', sortOrder: 1 }],
    items: [{
      externalId: 'ITEM1:VAR1', name: 'Burger', priceCents: 899, category: 'Mains', available: true,
      locationPrices: [
        { externalLocationId: 'SQ-L1', priceCents: 1099 },   // mapped → write
        { externalLocationId: 'SQ-UNMAPPED', priceCents: 999 }, // unmapped → skip
      ],
    }],
  } as any;

  it('writes a MenuItem + per-location override only for MAPPED stores', async () => {
    const prisma = makePrisma({ mappedLocations: [{ externalId: 'SQ-L1', locationTenantId: 'loc-A' }] });
    const res = await new MenuService(prisma).ingestPosCatalog(conn, snapshot);

    expect(prisma.client.menuItem.upsert).toHaveBeenCalledTimes(1);
    // Exactly one override — the mapped SQ-L1 → loc-A — at the Austin price.
    expect(prisma.override.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.override.upsert.mock.calls[0][0];
    expect(arg.where.locationTenantId_menuItemId.locationTenantId).toBe('loc-A');
    expect(arg.create.priceCents).toBe(1099);
    expect(arg.create.source).toBe('square');
    expect(res.overridesUpserted).toBe(1); // SQ-UNMAPPED was skipped
  });

  it('NEVER clobbers a source=manual override (operator edit wins)', async () => {
    const prisma = makePrisma({
      mappedLocations: [{ externalId: 'SQ-L1', locationTenantId: 'loc-A' }],
      existingOverride: { source: 'manual' },
    });
    const res = await new MenuService(prisma).ingestPosCatalog(conn, snapshot);

    expect(prisma.override.upsert).not.toHaveBeenCalled();
    expect(res.overridesSkippedManual).toBe(1);
    expect(res.overridesUpserted).toBe(0);
  });
});
