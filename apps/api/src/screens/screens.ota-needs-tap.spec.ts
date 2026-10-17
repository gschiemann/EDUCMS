/**
 * The install outcomes at POST /screens/status/:fp/ota-state (2026-10-17,
 * unattended-updates piece 2 — player-ota/ota-install-state.ts):
 *
 *   * NEEDS_TAP and FAILED_<CODE> are states of their own; a FAILED_<CODE> is
 *     a failure for the sticky OTA stamp, exactly like ERROR;
 *   * while a pending push waits for a tap, the companion Manager 1.0.24's
 *     anonymous CHECKING / UP_TO_DATE every 30 minutes cannot overwrite it
 *     (it would tell the dashboard and the panel the screen is current, and
 *     re-open the offer). The Player's own token-carrying reports still land.
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';
import { noteManagerCheckRefused, resetManagerLaneNoise } from '../player-ota/manager-lane-noise';

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-needs-tap-1';
const FP = 'android-needs-tap-1';
const MIN = 60_000;

function harness(row: Record<string, unknown> = {}) {
  const screen = {
    id: SCREEN_ID,
    name: 'G43',
    tenantId: 'tenant-1',
    screenGroupId: null,
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    lastOtaState: 'INSTALLING',
    lastOtaAt: new Date(Date.now() - 5 * MIN),
    playerVersionCode: 10123,
    forceApkUpdatePendingAt: new Date(Date.now() - 30 * MIN),
    ...row,
  };
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn().mockResolvedValue(screen),
        findFirst: jest.fn().mockResolvedValue(screen),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
const deviceReq = () => ({
  headers: {
    authorization: `Bearer ${jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0 }, SECRET, { expiresIn: '180d' })}`,
  },
}) as any;
const written = (prisma: any) => prisma.client.screen.update.mock.calls[0]?.[0].data;

beforeEach(() => {
  invalidateDeviceCredentialCache();
  resetManagerLaneNoise();
});

describe('the install outcomes are states of their own', () => {
  it.each(['NEEDS_TAP', 'FAILED_ABORTED', 'FAILED_INCOMPATIBLE', 'FAILED_STORAGE', 'FAILED_UNKNOWN'])(
    '%s is accepted and recorded as-is',
    async (state) => {
      const { controller, prisma } = harness();
      await expect(controller.reportOtaState(FP, { state }, deviceReq())).resolves.toEqual({ ok: true });
      expect(written(prisma).lastOtaState).toBe(state);
    },
  );

  it('anything else shaped like a failure is refused', async () => {
    const { controller } = harness();
    for (const state of ['FAILED', 'FAILED_', 'FAILED_X;Y', 'INSTALLED_SILENT']) {
      await expect(controller.reportOtaState(FP, { state }, anonReq())).rejects.toMatchObject({ status: 400 });
    }
  });

  it('a FAILED_<CODE> stamps the sticky failure like ERROR (OTA-02)', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'FAILED_STORAGE' }, deviceReq());
    expect(written(prisma).lastOtaErrorAt).toBeInstanceOf(Date);
    expect(written(prisma).lastOtaErrorMessage).toBe('FAILED_STORAGE');
    expect(written(prisma).lastOtaErrorAuthenticated).toBe(true);
  });

  it('NEEDS_TAP is not a failure — no sticky stamp, the push is not cleared', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP' }, deviceReq());
    expect(written(prisma)).not.toHaveProperty('lastOtaErrorAt');
    expect(written(prisma)).not.toHaveProperty('forceApkUpdatePendingAt');
  });
});

describe('a screen waiting for a tap is not overwritten by the Manager\'s 30-minute noise', () => {
  const waiting = { lastOtaState: 'NEEDS_TAP', lastOtaAt: new Date(Date.now() - 10 * MIN) };

  it.each(['CHECKING', 'UP_TO_DATE'])('anonymous %s is acknowledged and NOT stored', async (state) => {
    const { controller, prisma } = harness(waiting);
    await expect(controller.reportOtaState(FP, { state }, anonReq())).resolves.toEqual({ ok: true, ignored: 'needs-tap-pending' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it("the Player's own CHECKING (a person pressed Update on the panel) IS stored", async () => {
    const { controller, prisma } = harness(waiting);
    await controller.reportOtaState(FP, { state: 'CHECKING' }, deviceReq());
    expect(written(prisma).lastOtaState).toBe('CHECKING');
  });

  it('real progress is stored even anonymously', async () => {
    const { controller, prisma } = harness(waiting);
    await controller.reportOtaState(FP, { state: 'DOWNLOADING', progress: 40 }, anonReq());
    expect(written(prisma).lastOtaState).toBe('DOWNLOADING');
  });

  it('with no pending push, or a NEEDS_TAP older than the push, nothing is suppressed', async () => {
    const noPush = harness({ ...waiting, forceApkUpdatePendingAt: null });
    await noPush.controller.reportOtaState(FP, { state: 'UP_TO_DATE' }, anonReq());
    expect(written(noPush.prisma).lastOtaState).toBe('UP_TO_DATE');
    const older = harness({ ...waiting, forceApkUpdatePendingAt: new Date(Date.now() - 5 * MIN) });
    await older.controller.reportOtaState(FP, { state: 'UP_TO_DATE' }, anonReq());
    expect(written(older.prisma).lastOtaState).toBe('UP_TO_DATE');
  });
});

describe("the Manager's refused Player lane never reaches the Player's status", () => {
  it('its CHECKING ("… → checking") is acknowledged and not stored', async () => {
    const { controller, prisma } = harness({ forceApkUpdatePendingAt: null });
    await expect(controller.reportOtaState(FP, { state: 'CHECKING', message: 'v1.1.23 → checking' }, anonReq()))
      .resolves.toEqual({ ok: true, ignored: 'manager-lane-noise' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('its UP_TO_DATE right after the refusal is not "Already on v1.1.23 ✓"', async () => {
    const { controller, prisma } = harness();
    noteManagerCheckRefused(FP); // what player-ota.controller does on the refusal
    await expect(controller.reportOtaState(FP, { state: 'UP_TO_DATE', message: 'v1.1.23 — no newer release offered' }, anonReq()))
      .resolves.toEqual({ ok: true, ignored: 'manager-lane-noise' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it("the Player's own signed UP_TO_DATE is stored even right after a refusal", async () => {
    const { controller, prisma } = harness({ forceApkUpdatePendingAt: null });
    noteManagerCheckRefused(FP);
    await controller.reportOtaState(FP, { state: 'UP_TO_DATE', message: 'v1.1.41 — no newer release offered' }, deviceReq());
    expect(written(prisma).lastOtaState).toBe('UP_TO_DATE');
  });
});
