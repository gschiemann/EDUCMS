/**
 * Regression tests for the sticky OTA failure signal (OTA-02).
 *
 * `POST /screens/status/:fp/ota-state` writes `lastOtaState`, a
 * last-writer-wins column that the canary auto-promote gate read as its ONLY
 * health input. Two ways that erased itself:
 *   1. the player reports `CHECKING` at the head of EVERY OTA cycle, so with
 *      the default 24 h force-window equal to the default 24 h soak, the
 *      state at soak expiry was routinely `CHECKING` — a failing build
 *      promoted itself with no attacker involved;
 *   2. the route needs no authentication, so anyone with one fingerprint
 *      could overwrite a genuine ERROR on purpose.
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-ota-state';
const FP = 'android-fp-1';

function harness() {
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: SCREEN_ID,
          name: 'Hallway',
          tenantId: 'tenant-1',
          screenGroupId: null,
          status: 'ONLINE',
          credentialEpoch: 0,
          credentialEpochRotatedAt: null,
          lastOtaState: 'DOWNLOADING',
          playerVersionCode: 63,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: SCREEN_ID,
          name: 'Hallway',
          tenantId: 'tenant-1',
          deviceFingerprint: FP,
        }),
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

const writtenData = (prisma: any) => prisma.client.screen.update.mock.calls[0][0].data;

beforeEach(() => invalidateDeviceCredentialCache());

describe('OTA-02 — the failure signal must survive the device’s own next poll', () => {
  it('an ERROR stamps the sticky columns as well as lastOtaState', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'ERROR', message: 'INSTALL_FAILED' }, anonReq());
    const data = writtenData(prisma);
    expect(data.lastOtaState).toBe('ERROR');
    expect(data.lastOtaErrorAt).toBeInstanceOf(Date);
    expect(data.lastOtaErrorMessage).toBe('INSTALL_FAILED');
  });

  it('a later CHECKING report CANNOT clear the sticky error — the self-erase is closed', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'CHECKING' }, anonReq());
    const data = writtenData(prisma);
    // The live-progress column still moves (the dashboard depends on it)…
    expect(data.lastOtaState).toBe('CHECKING');
    // …but the failure record is not touched, in either direction.
    expect(data).not.toHaveProperty('lastOtaErrorAt');
    expect(data).not.toHaveProperty('lastOtaErrorMessage');
  });

  it('no intermediate state can clear it either', async () => {
    for (const state of ['DOWNLOADING', 'VERIFYING', 'INSTALLING']) {
      const { controller, prisma } = harness();
      await controller.reportOtaState(FP, { state }, anonReq());
      expect(writtenData(prisma)).not.toHaveProperty('lastOtaErrorAt');
    }
  });

  it('records WHETHER the failure came from a device-authenticated caller', async () => {
    // An authenticated failure is trustworthy and vetoes a promotion
    // outright; an anonymous one is subject to the cohort error-rate
    // threshold, so a single forged ERROR cannot hold the pipeline closed.
    const anon = harness();
    await anon.controller.reportOtaState(FP, { state: 'ERROR' }, anonReq());
    expect(writtenData(anon.prisma).lastOtaErrorAuthenticated).toBe(false);

    const authed = harness();
    await authed.controller.reportOtaState(FP, { state: 'ERROR' }, deviceReq());
    expect(writtenData(authed.prisma).lastOtaErrorAuthenticated).toBe(true);
  });

  it('an operator re-push clears the sticky error — one of only two things that may', async () => {
    const { controller, prisma } = harness();
    await controller.forceUpdateOne(
      { user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } } as any,
      SCREEN_ID,
      {} as any,
    ).catch(() => { /* the broadcast leg is not under test */ });
    const call = prisma.client.screen.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.forceApkUpdatePendingAt instanceof Date,
    );
    expect(call).toBeDefined();
    expect(call[0].data.lastOtaErrorAt).toBeNull();
    expect(call[0].data.lastOtaErrorAuthenticated).toBe(false);
  });

  it('still short-circuits preview fingerprints and Manager self-update noise', async () => {
    const { controller, prisma } = harness();
    await expect(controller.reportOtaState('preview-abc', { state: 'ERROR' }, anonReq()))
      .resolves.toMatchObject({ ignored: 'preview' });
    await expect(
      controller.reportOtaState(FP, { state: 'ERROR', message: 'Manager v1.0.17 (up to date)' }, anonReq()),
    ).resolves.toMatchObject({ ignored: 'manager-self-update-noise' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });
});
