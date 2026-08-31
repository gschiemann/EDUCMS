/**
 * ISO-01 / EM-04 (2026-08-04) — a screen may only join a ScreenGroup owned by
 * its OWN tenant.
 *
 * THE BUG this proves is fixed: both `PUT /screens/:id` and the pair/claim
 * endpoint wrote `body.screenGroupId` straight onto the row. Nothing checked
 * the group's tenant. ScreenGroup ids are opaque cuids, but an admin who
 * learned one — a support thread, a shared screenshot, a previous employer —
 * could bind their own screen into another tenant's group.
 *
 * Why it matters beyond tidiness: schedule resolution matches a screen by its
 * group id, so the screen begins playing the OTHER tenant's playlists on
 * hardware the attacker physically controls. That is a pull-based cross-tenant
 * content read, and group scope is also a targeting unit for emergency
 * broadcasts and frame-locked sync.
 *
 * Every other controller taking a screenGroupId already validated it
 * (schedules.controller.ts:146-153, screen-groups, emergency, sports). This
 * file was the gap. Mirrors the mock harness in screens.hardware-model.spec.ts.
 */

import { ScreensController } from './screens.controller';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const OWN_TENANT = 'tenant-springfield';
const OTHER_TENANT = 'tenant-shelbyville';
const SCREEN = { id: 'screen-1', tenantId: OWN_TENANT, name: 'Gym Wall', screenGroupId: null, config: null };

function makeController(groupRows: Array<{ id: string; tenantId: string }>) {
  const prisma: any = {
    client: {
      // readableTenantIds (fleet-scoped update, 2026-08-31): no children
      // in these fixtures -> the readable set collapses to the caller.
      tenant: { findMany: jest.fn(async () => []) },
      screen: {
        findFirst: jest.fn(async () => ({ ...SCREEN })),
        findUnique: jest.fn(async () => ({ ...SCREEN, tenantId: null, pairingCode: 'ABC123' })),
        update: jest.fn(async ({ data }: any) => ({ ...SCREEN, ...data })),
      },
      screenGroup: {
        // Faithful to the real query: matches on BOTH id and tenantId.
        findFirst: jest.fn(async ({ where }: any) =>
          groupRows.find((g) => g.id === where.id && g.tenantId === where.tenantId) ?? null,
        ),
      },
    },
  };
  const controller = new ScreensController(
    prisma,
    { publish: jest.fn() } as any,
    { signMessage: jest.fn(() => ({ type: 'SYNC', signature: 'x', timestamp: 1 })) } as any,
    { assertSeatAvailable: jest.fn() } as any,
    { syncSubscriptionQuantity: jest.fn(() => Promise.resolve()) } as any,
    {} as any,
  );
  return { controller, prisma };
}

const req = { user: { id: 'user-1', tenantId: OWN_TENANT, role: 'SCHOOL_ADMIN' } };

describe('ISO-01 — PUT /screens/:id cannot bind a screen into another tenant’s group', () => {
  it('rejects a group id belonging to a different tenant', async () => {
    const { controller, prisma } = makeController([{ id: 'group-foreign', tenantId: OTHER_TENANT }]);

    await expect(
      controller.update(req, SCREEN.id, { screenGroupId: 'group-foreign' }),
    ).rejects.toMatchObject({ status: 404 });

    // THE POINT: the write never happened.
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND, never FORBIDDEN — a 403 would confirm the id exists elsewhere', async () => {
    const { controller } = makeController([{ id: 'group-foreign', tenantId: OTHER_TENANT }]);

    // A group that exists in another tenant and one that exists nowhere must be
    // indistinguishable, or the endpoint becomes an id-probing oracle.
    const foreign = await controller
      .update(req, SCREEN.id, { screenGroupId: 'group-foreign' })
      .catch((e: any) => e);
    const missing = await controller
      .update(req, SCREEN.id, { screenGroupId: 'group-does-not-exist' })
      .catch((e: any) => e);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.getResponse()).toEqual(missing.getResponse());
  });

  it('allows a group the tenant actually owns', async () => {
    const { controller, prisma } = makeController([{ id: 'group-mine', tenantId: OWN_TENANT }]);

    await controller.update(req, SCREEN.id, { screenGroupId: 'group-mine' });

    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    expect(prisma.client.screen.update.mock.calls[0][0].data.screenGroupId).toBe('group-mine');
  });

  it('still allows clearing the group, and does not query for null/undefined', async () => {
    const { controller, prisma } = makeController([]);

    // null = "remove this screen from its group" — cannot move it into another
    // tenant, so it must not require (or perform) a lookup.
    await controller.update(req, SCREEN.id, { screenGroupId: null });
    expect(prisma.client.screenGroup.findFirst).not.toHaveBeenCalled();
    expect(prisma.client.screen.update.mock.calls[0][0].data.screenGroupId).toBeNull();

    // Field absent entirely = leave unchanged.
    await controller.update(req, SCREEN.id, { name: 'Renamed' });
    expect(prisma.client.screenGroup.findFirst).not.toHaveBeenCalled();
  });
});

describe('fleet-scoped update (2026-08-31 — dashboard device drawer)', () => {
  // A parent fixes a CHILD location's screen from the HQ dashboard. The
  // readable set is self + direct non-archived children; the group check
  // follows the SCREEN's tenant, and the manifest-cache bust lands on the
  // screen's tenant too — never the caller's.
  const PARENT = 'tenant-corp';
  const CHILD = 'tenant-store-9';
  const childScreen = { id: 'screen-c9', tenantId: CHILD, name: 'Store 9 Lobby', screenGroupId: null, config: null };

  function makeFleetController(groupRows: Array<{ id: string; tenantId: string }>) {
    const notified: string[] = [];
    const prisma: any = {
      client: {
        tenant: { findMany: jest.fn(async () => [{ id: CHILD }]) },
        screen: {
          // Faithful to the real query: BOTH the id and the readable-set
          // membership must match.
          findFirst: jest.fn(async ({ where }: any) =>
            where.id === childScreen.id && (where.tenantId.in as string[]).includes(childScreen.tenantId)
              ? { ...childScreen }
              : null,
          ),
          update: jest.fn(async ({ data }: any) => ({ ...childScreen, ...data })),
        },
        screenGroup: {
          findFirst: jest.fn(async ({ where }: any) =>
            groupRows.find((g) => g.id === where.id && g.tenantId === where.tenantId) ?? null,
          ),
        },
      },
    };
    const controller = new ScreensController(
      prisma,
      { publish: jest.fn() } as any,
      { signMessage: jest.fn(() => ({ type: 'SYNC', signature: 'x', timestamp: 1 })) } as any,
      { assertSeatAvailable: jest.fn() } as any,
      { syncSubscriptionQuantity: jest.fn(() => Promise.resolve()) } as any,
      {} as any,
    );
    (controller as any).notifySync = (t: string) => notified.push(t);
    return { controller, prisma, notified };
  }

  const parentReq = { user: { id: 'user-1', tenantId: PARENT, role: 'DISTRICT_ADMIN' } };

  it('a parent renames a direct child location’s screen, and the cache bust follows the screen', async () => {
    const { controller, prisma, notified } = makeFleetController([]);
    const out: any = await controller.update(parentReq, childScreen.id, { name: 'Store 9 Entry' });
    expect(out.name).toBe('Store 9 Entry');
    // Membership was enforced on the QUERY.
    const where = prisma.client.screen.findFirst.mock.calls[0][0].where;
    expect(where.tenantId).toEqual({ in: [PARENT, CHILD] });
    expect(notified).toEqual([CHILD]);
  });

  it('the group check runs against the SCREEN’s tenant — a parent-owned group is refused for a child’s screen', async () => {
    const { controller } = makeFleetController([{ id: 'group-parent', tenantId: PARENT }]);
    // Same refusal shape ISO-01 established: the group does not resolve
    // within the SCREEN's tenant, so the bind is rejected.
    await expect(
      controller.update(parentReq, childScreen.id, { screenGroupId: 'group-parent' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a screen id outside the readable set stays a 404', async () => {
    const { controller } = makeFleetController([]);
    await expect(controller.update(parentReq, 'screen-elsewhere', { name: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});
