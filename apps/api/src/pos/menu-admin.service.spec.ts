/**
 * MenuAdminService + MenuAdminController tests — price-book console API.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Covers the load-bearing behaviours of the operator-facing menu console:
 *
 *   1. listCatalog  — shapes MenuItem rows → MenuCatalogItem (grid rows).
 *   2. listLocations — child tenants (or self when single-location).
 *   3. setOverride  — set price / 86 / revert-to-inherited-deletes-the-row.
 *   4. bulkSetOverride — transactional apply across many locations,
 *      drops foreign location ids, summary audit.
 *   5. importMenu   — delegates to MenuService.ingestOperatorMenu.
 *   6. cross-tenant — a foreign menuItemId is 404'd (requireOwnedItem),
 *      and a foreign locationTenantId on setOverride is 404'd.
 *   7. RBAC — the controller's @RequireRoles metadata rejects a
 *      CONTRIBUTOR on every mutation via the real RbacGuard.
 *
 * Prisma is mocked per-model; we assert on the upsert/delete payloads
 * (tenant provenance, override keys, delete-on-inherit) rather than a
 * real DB.
 */
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRole } from '@cms/database';
import { MenuAdminService } from './menu-admin.service';
import { MenuAdminController } from './menu-admin.controller';
import { RbacGuard } from '../auth/rbac.guard';
import { ROLES_KEY } from '../auth/roles.decorator';

const TENANT = 'chain-tenant';
const LOC_A = 'location-A';
const LOC_B = 'location-B';
const ITEM = 'item-1';

function makeMockPrisma(seed?: {
  catalogs?: any[];
  items?: any[];
  categories?: any[];
  overrides?: any[];
  children?: any[];
  self?: any;
  existingOverride?: any | null;
  ownedItem?: any | null;
}) {
  const menuCatalog = {
    findMany: jest.fn().mockResolvedValue(seed?.catalogs ?? []),
  };
  const menuItem = {
    findMany: jest.fn().mockResolvedValue(seed?.items ?? []),
    // requireOwnedItem uses findFirst({ where: { id, tenantId } }).
    findFirst: jest
      .fn()
      .mockResolvedValue(
        seed?.ownedItem === undefined ? { id: ITEM } : seed?.ownedItem,
      ),
  };
  const menuCategory = {
    findMany: jest.fn().mockResolvedValue(seed?.categories ?? []),
  };
  const menuLocationOverride = {
    findMany: jest.fn().mockResolvedValue(seed?.overrides ?? []),
    findUnique: jest
      .fn()
      .mockResolvedValue(
        seed?.existingOverride === undefined ? null : seed?.existingOverride,
      ),
    upsert: jest
      .fn()
      .mockImplementation(({ create }: any) => Promise.resolve({ ...create })),
    delete: jest.fn().mockResolvedValue({}),
  };
  const tenant = {
    findMany: jest.fn().mockResolvedValue(seed?.children ?? []),
    findUnique: jest
      .fn()
      .mockResolvedValue(
        seed?.self === undefined
          ? { id: TENANT, name: 'Chain', slug: 'chain' }
          : seed?.self,
      ),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };

  const client: any = {
    menuCatalog,
    menuItem,
    menuCategory,
    menuLocationOverride,
    tenant,
    auditLog,
  };
  // $transaction runs the callback against the SAME mocked client so the
  // bulk path's tx.menuLocationOverride.* calls hit the same spies.
  client.$transaction = jest.fn((cb: any) => cb(client));

  return { client } as any;
}

function svcWith(prisma: any, menu?: any): MenuAdminService {
  return new MenuAdminService(
    prisma,
    menu ?? { ingestOperatorMenu: jest.fn() },
  );
}

describe('MenuAdminService.listCatalog', () => {
  it('shapes MenuItem rows into MenuCatalogItem grid rows', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      categories: [{ id: 'c-mains', name: 'Mains' }],
      items: [
        {
          id: 'i1',
          externalId: 'burger',
          name: 'Burger',
          description: 'beef',
          defaultPriceCents: 799,
          imageUrl: 'u',
          allergens: ['GF'],
          tags: ['popular'],
          categoryId: 'c-mains',
          sortOrder: 0,
        },
      ],
    });
    const out = await svcWith(prisma).listCatalog(TENANT);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'i1',
      externalId: 'burger',
      name: 'Burger',
      defaultPriceCents: 799,
      category: 'Mains',
      available: true,
    });
    expect(out[0].badges).toEqual(expect.arrayContaining(['popular', 'GF']));
    // scoped to the tenant's active catalogs
    expect(prisma.client.menuCatalog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, isActive: true } }),
    );
  });

  it('returns [] when the tenant has no catalogs', async () => {
    const prisma = makeMockPrisma({ catalogs: [] });
    expect(await svcWith(prisma).listCatalog(TENANT)).toEqual([]);
  });

  it('falls back externalId → item id when the item has no provider id', async () => {
    const prisma = makeMockPrisma({
      catalogs: [{ id: 'cat-1' }],
      items: [
        {
          id: 'i9',
          externalId: null,
          name: 'Hand item',
          defaultPriceCents: 100,
          allergens: [],
          tags: [],
          categoryId: null,
          sortOrder: 0,
        },
      ],
    });
    const out = await svcWith(prisma).listCatalog(TENANT);
    expect(out[0].externalId).toBe('i9');
  });
});

describe('MenuAdminService.listLocations', () => {
  it('returns child tenants when present', async () => {
    const prisma = makeMockPrisma({
      children: [
        { id: LOC_A, name: 'Downtown', slug: 'downtown' },
        { id: LOC_B, name: 'Airport', slug: 'airport' },
      ],
    });
    const out = await svcWith(prisma).listLocations(TENANT);
    expect(out).toEqual([
      { id: LOC_A, name: 'Downtown', slug: 'downtown' },
      { id: LOC_B, name: 'Airport', slug: 'airport' },
    ]);
  });

  it('falls back to the tenant itself when there are no children', async () => {
    const prisma = makeMockPrisma({
      children: [],
      self: { id: TENANT, name: 'Solo Cafe', slug: 'solo' },
    });
    const out = await svcWith(prisma).listLocations(TENANT);
    expect(out).toEqual([{ id: TENANT, name: 'Solo Cafe', slug: 'solo' }]);
  });
});

describe('MenuAdminService.listOverrides', () => {
  it('scopes overrides to the tenant and normalizes the shape', async () => {
    const prisma = makeMockPrisma({
      overrides: [
        {
          locationTenantId: LOC_A,
          menuItemId: ITEM,
          priceCents: 949,
          isAvailable: true,
          soldOutUntil: null,
          isHidden: false,
        },
        {
          locationTenantId: LOC_B,
          menuItemId: ITEM,
          priceCents: null,
          isAvailable: false,
          soldOutUntil: null,
          isHidden: false,
        },
      ],
    });
    const out = await svcWith(prisma).listOverrides(TENANT);
    expect(prisma.client.menuLocationOverride.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
    });
    expect(out[0]).toEqual({
      locationTenantId: LOC_A,
      menuItemId: ITEM,
      priceCents: 949,
      isAvailable: true,
      soldOutUntil: null,
      isHidden: false,
    });
    expect(out[1].isAvailable).toBe(false);
  });
});

describe('MenuAdminService.setOverride', () => {
  it('sets a price override at one location (create) with manual source + tenant', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }],
      existingOverride: null,
    });
    const out = await svcWith(prisma).setOverride(
      TENANT,
      'user-1',
      LOC_A,
      ITEM,
      { priceCents: 949 },
    );
    expect(prisma.client.menuLocationOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locationTenantId_menuItemId: {
            locationTenantId: LOC_A,
            menuItemId: ITEM,
          },
        },
        create: expect.objectContaining({
          tenantId: TENANT,
          locationTenantId: LOC_A,
          menuItemId: ITEM,
          priceCents: 949,
          source: 'manual',
        }),
      }),
    );
    expect(out.priceCents).toBe(949);
    // audit row written with before/after price
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'MENU_OVERRIDE_SET',
          userId: 'user-1',
        }),
      }),
    );
  });

  it('a null-price patch with no other divergence DELETES the row (revert-to-inherited)', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }],
      existingOverride: {
        locationTenantId: LOC_A,
        menuItemId: ITEM,
        priceCents: 949,
        isAvailable: true,
        isHidden: false,
        soldOutUntil: null,
      },
    });
    const out = await svcWith(prisma).setOverride(
      TENANT,
      'user-1',
      LOC_A,
      ITEM,
      { priceCents: null },
    );
    expect(prisma.client.menuLocationOverride.delete).toHaveBeenCalledWith({
      where: {
        locationTenantId_menuItemId: {
          locationTenantId: LOC_A,
          menuItemId: ITEM,
        },
      },
    });
    expect(prisma.client.menuLocationOverride.upsert).not.toHaveBeenCalled();
    expect(out.priceCents).toBeNull();
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MENU_OVERRIDE_REVERT' }),
      }),
    );
  });

  it('a null-price patch KEEPS the row when the item is still 86 (isAvailable false)', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }],
      existingOverride: {
        locationTenantId: LOC_A,
        menuItemId: ITEM,
        priceCents: 949,
        isAvailable: false,
        isHidden: false,
        soldOutUntil: null,
      },
    });
    await svcWith(prisma).setOverride(TENANT, 'user-1', LOC_A, ITEM, {
      priceCents: null,
    });
    // price clears but the 86 stays → upsert, not delete
    expect(prisma.client.menuLocationOverride.delete).not.toHaveBeenCalled();
    expect(prisma.client.menuLocationOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          priceCents: null,
          isAvailable: false,
        }),
      }),
    );
  });

  it('86 (isAvailable:false) on an otherwise-inherited cell creates a row, not a delete', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }],
      existingOverride: null,
    });
    await svcWith(prisma).setOverride(TENANT, 'user-1', LOC_A, ITEM, {
      isAvailable: false,
    });
    expect(prisma.client.menuLocationOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          isAvailable: false,
          priceCents: null,
        }),
      }),
    );
    expect(prisma.client.menuLocationOverride.delete).not.toHaveBeenCalled();
  });

  it('rejects a foreign menuItemId with 404 (cross-tenant IDOR defense)', async () => {
    const prisma = makeMockPrisma({ ownedItem: null }); // requireOwnedItem → null
    await expect(
      svcWith(prisma).setOverride(TENANT, 'user-1', LOC_A, 'foreign-item', {
        priceCents: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.menuLocationOverride.upsert).not.toHaveBeenCalled();
  });

  it('rejects a foreign locationTenantId with 404', async () => {
    const prisma = makeMockPrisma({ children: [{ id: LOC_A }] }); // only LOC_A is a child
    await expect(
      svcWith(prisma).setOverride(TENANT, 'user-1', 'foreign-loc', ITEM, {
        priceCents: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MenuAdminService.deleteOverride', () => {
  it('deletes a tenant-owned override and audits the revert', async () => {
    const prisma = makeMockPrisma({
      existingOverride: { tenantId: TENANT, priceCents: 500 },
    });
    await svcWith(prisma).deleteOverride(TENANT, 'user-1', LOC_A, ITEM);
    expect(prisma.client.menuLocationOverride.delete).toHaveBeenCalled();
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MENU_OVERRIDE_REVERT' }),
      }),
    );
  });

  it('is a no-op when the override does not exist (idempotent)', async () => {
    const prisma = makeMockPrisma({ existingOverride: null });
    await svcWith(prisma).deleteOverride(TENANT, 'user-1', LOC_A, ITEM);
    expect(prisma.client.menuLocationOverride.delete).not.toHaveBeenCalled();
  });

  it('does NOT delete an override belonging to another tenant', async () => {
    const prisma = makeMockPrisma({
      existingOverride: { tenantId: 'OTHER', priceCents: 1 },
    });
    await svcWith(prisma).deleteOverride(TENANT, 'user-1', LOC_A, ITEM);
    expect(prisma.client.menuLocationOverride.delete).not.toHaveBeenCalled();
  });
});

describe('MenuAdminService.bulkSetOverride', () => {
  it('applies one price across all locations in a transaction', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }, { id: LOC_B }],
      existingOverride: null,
    });
    const res = await svcWith(prisma).bulkSetOverride(TENANT, 'user-1', {
      menuItemId: ITEM,
      patch: { priceCents: 499 },
    });
    // self (TENANT) + LOC_A + LOC_B = 3 targets
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.client.menuLocationOverride.upsert).toHaveBeenCalledTimes(3);
    expect(res.updated).toBe(3);
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MENU_OVERRIDE_BULK' }),
      }),
    );
  });

  it('drops foreign location ids and only applies to owned ones', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }, { id: LOC_B }],
      existingOverride: null,
    });
    const res = await svcWith(prisma).bulkSetOverride(TENANT, 'user-1', {
      menuItemId: ITEM,
      locationTenantIds: [LOC_A, 'foreign-loc', LOC_B],
      patch: { priceCents: 499 },
    });
    expect(prisma.client.menuLocationOverride.upsert).toHaveBeenCalledTimes(2); // LOC_A + LOC_B only
    expect(res.updated).toBe(2);
  });

  it('throws when every requested location is foreign', async () => {
    const prisma = makeMockPrisma({ children: [{ id: LOC_A }] });
    await expect(
      svcWith(prisma).bulkSetOverride(TENANT, 'user-1', {
        menuItemId: ITEM,
        locationTenantIds: ['nope-1', 'nope-2'],
        patch: { priceCents: 1 },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a menuItemId and a non-empty patch', async () => {
    const prisma = makeMockPrisma({ children: [{ id: LOC_A }] });
    await expect(
      svcWith(prisma).bulkSetOverride(TENANT, 'user-1', {
        patch: { priceCents: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      svcWith(prisma).bulkSetOverride(TENANT, 'user-1', {
        menuItemId: ITEM,
        patch: {},
      }),
    ).rejects.toThrow();
  });

  it('rejects a bulk against a foreign item (cross-tenant)', async () => {
    const prisma = makeMockPrisma({
      children: [{ id: LOC_A }],
      ownedItem: null,
    });
    await expect(
      svcWith(prisma).bulkSetOverride(TENANT, 'user-1', {
        menuItemId: 'foreign',
        patch: { priceCents: 1 },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MenuAdminService.importMenu', () => {
  it('delegates to MenuService.ingestOperatorMenu and returns imported/skipped/catalogId', async () => {
    const prisma = makeMockPrisma();
    const menu = {
      ingestOperatorMenu: jest.fn().mockResolvedValue({
        imported: 3,
        itemsUpserted: 3,
        overridesUpserted: 0,
        skipped: 1,
        catalogId: 'cat-x',
      }),
    };
    const res = await svcWith(prisma, menu).importMenu(TENANT, 'user-1', {
      menu: [{ name: 'A', price: 1 }],
    });
    expect(menu.ingestOperatorMenu).toHaveBeenCalledWith(TENANT, 'user-1', {
      menu: [{ name: 'A', price: 1 }],
    });
    expect(res).toEqual({ imported: 3, skipped: 1, catalogId: 'cat-x' });
  });
});

// ─── Controller RBAC — the real RbacGuard against the route metadata ───
describe('MenuAdminController RBAC metadata', () => {
  const reflector = new Reflector();
  const guard = new RbacGuard(reflector);

  function ctxFor(
    methodName: keyof MenuAdminController,
    role: AppRole,
  ): ExecutionContext {
    const handler = (MenuAdminController.prototype as any)[methodName];
    return {
      getHandler: () => handler,
      getClass: () => MenuAdminController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role, userId: 'u', tenantId: TENANT },
          params: {},
          query: {},
          body: {},
        }),
      }),
    } as unknown as ExecutionContext;
  }

  const mutations: (keyof MenuAdminController)[] = [
    'setOverride',
    'revertOverride',
    'bulkSetOverride',
    'importMenu',
  ];

  it.each(mutations)('mutation %s rejects a CONTRIBUTOR', (m) => {
    expect(() => guard.canActivate(ctxFor(m, AppRole.CONTRIBUTOR))).toThrow(
      ForbiddenException,
    );
  });

  it.each(mutations)('mutation %s rejects a RESTRICTED_VIEWER', (m) => {
    expect(() =>
      guard.canActivate(ctxFor(m, AppRole.RESTRICTED_VIEWER)),
    ).toThrow(ForbiddenException);
  });

  it.each(mutations)('mutation %s allows a SCHOOL_ADMIN', (m) => {
    expect(guard.canActivate(ctxFor(m, AppRole.SCHOOL_ADMIN))).toBe(true);
  });

  it('reads (listCatalog) allow a RESTRICTED_VIEWER', () => {
    expect(
      guard.canActivate(ctxFor('listCatalog', AppRole.RESTRICTED_VIEWER)),
    ).toBe(true);
  });

  it('reads (listOverrides) allow a CONTRIBUTOR', () => {
    expect(
      guard.canActivate(ctxFor('listOverrides', AppRole.CONTRIBUTOR)),
    ).toBe(true);
  });

  it('declares the mutation roles via @RequireRoles metadata (no public mutation)', () => {
    for (const m of mutations) {
      const roles = reflector.get(
        ROLES_KEY,
        (MenuAdminController.prototype as any)[m],
      );
      expect(roles).toBeDefined();
      expect(roles).not.toContain(AppRole.CONTRIBUTOR);
      expect(roles).not.toContain(AppRole.RESTRICTED_VIEWER);
    }
  });
});
