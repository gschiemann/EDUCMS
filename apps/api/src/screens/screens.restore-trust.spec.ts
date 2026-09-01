/**
 * Regression tests for POST /screens/:id/restore-trust (2026-09-01).
 *
 * THE GAP. The credential heal path designed in deep-audit B-P1-7 shipped
 * server-side — `verifyPriorToken`'s `unproven-restorable` branch renews a
 * REPAIR_REQUIRED screen to a proven 180-day token when the operator has
 * just stamped `authState='PROVEN'` and rotated the epoch. But only POST
 * /screens/pair could ARM it, and pairing needs a pairing code that a
 * REPAIR_REQUIRED screen never shows (it is still playing content on
 * renewed 1-hour unproven tokens). Five production screens sat in that
 * state while both the fleet chip and the on-glass banner told the
 * operator to "re-pair from the dashboard".
 *
 * What these tests pin — the four properties that make this endpoint the
 * pair endpoint's credential half and NOTHING more:
 *   1. it is tenant-scoped, and an out-of-scope id 404s (scope-hiding);
 *   2. it REFUSES a REVOKED screen (409) and never touches
 *      `credentialRevokedAt` — restoring trust is not a revoke escape hatch;
 *   3. an already-PROVEN screen is a no-op — no epoch rotation, because
 *      rotating retires the healthy token the device is holding right now;
 *   4. a REPAIR_REQUIRED screen gets EXACTLY the pair endpoint's credential
 *      fields (epoch +1, rotation stamp, PROVEN, state-change stamp) and an
 *      immutable AuditLog row — no tenant move, no pairing code, no revoke
 *      clear.
 *
 * Plus the OTA half of the same wave: RELAUNCH_BLOCKED (an install that
 * landed but that Android would not let relaunch itself) is accepted, and
 * the allowlist is still a real gate for anything else.
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { ScreensController } from './screens.controller';
import { SCREEN_TELEMETRY_ONLY_FIELDS } from './manifest-hot-cache';
import { invalidateDeviceCredentialCache } from './device-auth';

const SCREEN_ID = 'screen-repair-1';
const TENANT_ID = 'tenant-1';
const CHILD_TENANT_ID = 'tenant-child-1';

const screenRow = (overrides: Record<string, unknown> = {}) => ({
  id: SCREEN_ID,
  name: 'Gym Lobby',
  tenantId: TENANT_ID,
  status: 'ONLINE',
  authState: 'REPAIR_REQUIRED',
  ...overrides,
});

/**
 * findFirst is mocked to honour the controller's own `where` — that is what
 * makes the cross-tenant test meaningful rather than a mock that always
 * hands the row back regardless of scope.
 */
function harness(row: any | null, children: string[] = []) {
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (!row) return null;
          if (where?.id && where.id !== row.id) return null;
          const scope = where?.tenantId?.in;
          if (Array.isArray(scope) && !scope.includes(row.tenantId)) return null;
          return row;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      tenant: {
        findMany: jest.fn().mockResolvedValue(children.map((id) => ({ id }))),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const redis: any = { publish: jest.fn(), sismember: jest.fn().mockResolvedValue(false) };
  const signer: any = { signMessage: jest.fn().mockReturnValue({}) };
  const controller = new ScreensController(
    prisma, redis, signer, {} as any, { syncSubscriptionQuantity: jest.fn() } as any, {} as any,
  );
  return { controller, prisma, redis };
}

const admin = (tenantId = TENANT_ID) =>
  ({ user: { tenantId, role: 'SCHOOL_ADMIN', id: 'user-1' } }) as any;

const writtenData = (prisma: any) => prisma.client.screen.update.mock.calls[0][0].data;
const writtenWhere = (prisma: any) => prisma.client.screen.update.mock.calls[0][0].where;

beforeEach(() => invalidateDeviceCredentialCache());

describe('POST /screens/:id/restore-trust — the missing half of B-P1-7', () => {
  it('restores a REPAIR_REQUIRED screen: epoch +1, rotation stamped, authState PROVEN', async () => {
    const { controller, prisma } = harness(screenRow());
    const res = await controller.restoreTrust(admin(), SCREEN_ID);

    const data = writtenData(prisma);
    expect(data.credentialEpoch).toEqual({ increment: 1 });
    expect(data.credentialEpochRotatedAt).toBeInstanceOf(Date);
    expect(data.authState).toBe('PROVEN');
    expect(data.authStateChangedAt).toBeInstanceOf(Date);
    expect(res).toMatchObject({ success: true, screenId: SCREEN_ID });
    // Truth-first copy: the heal happens on the DEVICE's next check-in, so
    // the message must never claim the screen is healthy right now.
    expect(res.message).toMatch(/next check-in/i);
  });

  it('writes ONLY the pair endpoint’s credential fields — no tenant move, no pairing code, no revoke clear', async () => {
    const { controller, prisma } = harness(screenRow());
    await controller.restoreTrust(admin(), SCREEN_ID);

    const data = writtenData(prisma);
    expect(Object.keys(data).sort()).toEqual(
      ['authState', 'authStateChangedAt', 'credentialEpoch', 'credentialEpochRotatedAt'].sort(),
    );
    // Named individually so a future edit that adds one of them fails loudly.
    expect(data).not.toHaveProperty('tenantId');
    expect(data).not.toHaveProperty('pairingCode');
    expect(data).not.toHaveProperty('credentialRevokedAt');
    expect(data).not.toHaveProperty('status');
  });

  it('records an immutable AuditLog row naming the operator and the prior state', async () => {
    const { controller, prisma } = harness(screenRow());
    await controller.restoreTrust(admin(), SCREEN_ID);

    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    const row = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('SCREEN_TRUST_RESTORED');
    expect(row.targetType).toBe('screen');
    expect(row.targetId).toBe(SCREEN_ID);
    expect(row.tenantId).toBe(TENANT_ID);
    expect(row.userId).toBe('user-1');
    expect(JSON.parse(row.details)).toEqual({
      screenName: 'Gym Lobby',
      priorAuthState: 'REPAIR_REQUIRED',
    });
  });

  it('scopes the write itself to the tenant, not just the read', async () => {
    const { controller, prisma } = harness(screenRow());
    await controller.restoreTrust(admin(), SCREEN_ID);
    expect(writtenWhere(prisma)).toEqual({ id: SCREEN_ID, tenantId: TENANT_ID });
  });

  it('404s a screen in another tenant — scope-hiding, and NOTHING is written', async () => {
    const { controller, prisma } = harness(screenRow({ tenantId: 'tenant-other' }));
    await expect(controller.restoreTrust(admin(), SCREEN_ID)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('400s a tenantless principal — readableTenantIds(undefined) would scope to EVERY tenant', async () => {
    const { controller, prisma } = harness(screenRow());
    await expect(
      controller.restoreTrust({ user: { role: 'SUPER_ADMIN', id: 'u1' } } as any, SCREEN_ID),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.client.screen.findFirst).not.toHaveBeenCalled();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('404s an id that does not exist at all', async () => {
    const { controller, prisma } = harness(null);
    await expect(controller.restoreTrust(admin(), 'no-such-screen')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('lets HQ heal a screen at a CHILD location (same readable set as every fleet action)', async () => {
    const { controller, prisma } = harness(
      screenRow({ tenantId: CHILD_TENANT_ID }),
      [CHILD_TENANT_ID],
    );
    await expect(controller.restoreTrust(admin(), SCREEN_ID)).resolves.toMatchObject({
      success: true,
    });
    expect(writtenWhere(prisma)).toEqual({ id: SCREEN_ID, tenantId: CHILD_TENANT_ID });
  });

  it('409s a REVOKED screen — restore-trust must never undo an operator revoke', async () => {
    const { controller, prisma } = harness(screenRow({ status: 'REVOKED' }));
    await expect(controller.restoreTrust(admin(), SCREEN_ID)).rejects.toMatchObject({
      status: 409,
    });
    // The critical assertion: no write at all, so `credentialRevokedAt`
    // cannot be cleared through this route by any path.
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('is idempotent on an already-PROVEN screen — no epoch rotation on a healthy credential', async () => {
    const { controller, prisma } = harness(screenRow({ authState: 'PROVEN' }));
    const res = await controller.restoreTrust(admin(), SCREEN_ID);
    expect(res).toMatchObject({ success: true, alreadyProven: true });
    // A gratuitous rotation would retire the token the device holds RIGHT
    // NOW and push a healthy screen through a renewal it never needed.
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('restores a screen whose authState was never stamped (pre-column row)', async () => {
    const { controller, prisma } = harness(screenRow({ authState: null }));
    await expect(controller.restoreTrust(admin(), SCREEN_ID)).resolves.toMatchObject({
      success: true,
    });
    expect(writtenData(prisma).authState).toBe('PROVEN');
    expect(JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details).priorAuthState)
      .toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// OTA — RELAUNCH_BLOCKED
// ═══════════════════════════════════════════════════════════════════════

const FP = 'android-fp-relaunch';

function otaHarness() {
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'screen-ota-1',
          name: 'Cafeteria',
          tenantId: TENANT_ID,
          screenGroupId: null,
          status: 'ONLINE',
          credentialEpoch: 0,
          credentialEpochRotatedAt: null,
          lastOtaState: 'INSTALLING',
          playerVersionCode: 71,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const redis: any = { publish: jest.fn(), sismember: jest.fn().mockResolvedValue(false) };
  const controller = new ScreensController(
    prisma, redis, { signMessage: jest.fn() } as any, {} as any,
    { syncSubscriptionQuantity: jest.fn() } as any, {} as any,
  );
  return { controller, prisma };
}

const anonReq = () => ({ headers: {} }) as any;

describe('OTA state RELAUNCH_BLOCKED — installed, but Android blocked the relaunch', () => {
  it('is accepted and persisted, with the device’s message naming the missing grant', async () => {
    const { controller, prisma } = otaHarness();
    await expect(
      controller.reportOtaState(
        FP,
        { state: 'RELAUNCH_BLOCKED', message: 'Install succeeded — “Display over other apps” is off' },
        anonReq(),
      ),
    ).resolves.toMatchObject({ ok: true });
    const data = prisma.client.screen.update.mock.calls[0][0].data;
    expect(data.lastOtaState).toBe('RELAUNCH_BLOCKED');
    expect(data.lastOtaMessage).toContain('Display over other apps');
    expect(data.lastOtaAt).toBeInstanceOf(Date);
  });

  it('normalises case like every other state', async () => {
    const { controller, prisma } = otaHarness();
    await controller.reportOtaState(FP, { state: ' relaunch_blocked ' }, anonReq());
    expect(prisma.client.screen.update.mock.calls[0][0].data.lastOtaState).toBe('RELAUNCH_BLOCKED');
  });

  it('is NOT a failure signal — it neither stamps nor clears the sticky OTA-02 error columns', async () => {
    const { controller, prisma } = otaHarness();
    await controller.reportOtaState(FP, { state: 'RELAUNCH_BLOCKED' }, anonReq());
    const data = prisma.client.screen.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('lastOtaErrorAt');
    expect(data).not.toHaveProperty('lastOtaErrorMessage');
    expect(data).not.toHaveProperty('lastOtaErrorAuthenticated');
  });

  it('writes ONLY manifest-hot-cache telemetry-only columns (egress guard)', async () => {
    const { controller, prisma } = otaHarness();
    await controller.reportOtaState(FP, { state: 'RELAUNCH_BLOCKED', progress: 100 }, anonReq());
    const keys = Object.keys(prisma.client.screen.update.mock.calls[0][0].data);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !SCREEN_TELEMETRY_ONLY_FIELDS.has(k))).toEqual([]);
  });

  it('still rejects an unknown state — the allowlist is a real gate', async () => {
    const { controller, prisma } = otaHarness();
    await expect(controller.reportOtaState(FP, { state: 'RELAUNCHBLOCKED' }, anonReq())).rejects.toThrow();
    await expect(controller.reportOtaState(FP, { state: 'BLOCKED' }, anonReq())).rejects.toThrow();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });
});
