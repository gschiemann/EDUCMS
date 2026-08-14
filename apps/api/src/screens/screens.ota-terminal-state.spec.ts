/**
 * Regression tests for the OTA terminal-state fix (2026-08-14).
 *
 * THE BUG. `OtaUpdateWorker` reported `CHECKING` at the head of every check,
 * then BOTH up-to-date branches returned without reporting anything — while
 * every ERROR path did report. So `lastOtaState` stayed pinned at `CHECKING`
 * forever on every HEALTHY, up-to-date screen (all four pilot boxes were
 * sitting exactly like that), making a healthy screen indistinguishable from a
 * genuinely wedged one. The player now reports `UP_TO_DATE` on both branches.
 *
 * These tests pin the three things that had to hold for that to be safe:
 *   1. the API accepts the new value (an unknown state 400s, so a rejected
 *      terminal report would have left the fleet on the old broken behaviour);
 *   2. it is NOT a failure signal — it must not stamp or clear the sticky
 *      OTA-02 error columns;
 *   3. it writes ONLY manifest-hot-cache telemetry-only columns. This report
 *      now fires fleet-wide on every periodic check, and a single
 *      non-telemetry column in that update would bust every screen's cached
 *      manifest at check cadence — re-creating the 25 GB/mo Supabase egress
 *      the cache was built to kill (docs/research/2026-07-30-supabase-bill-diet).
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { ScreensController } from './screens.controller';
import { SCREEN_TELEMETRY_ONLY_FIELDS } from './manifest-hot-cache';
import { invalidateDeviceCredentialCache } from './device-auth';

const SCREEN_ID = 'screen-ota-terminal';
const FP = 'android-fp-terminal';

function harness() {
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: SCREEN_ID,
          name: 'Lobby',
          tenantId: 'tenant-1',
          screenGroupId: null,
          status: 'ONLINE',
          credentialEpoch: 0,
          credentialEpochRotatedAt: null,
          lastOtaState: 'CHECKING',
          playerVersionCode: 63,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: SCREEN_ID, name: 'Lobby', tenantId: 'tenant-1', deviceFingerprint: FP,
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
const writtenData = (prisma: any) => prisma.client.screen.update.mock.calls[0][0].data;

beforeEach(() => invalidateDeviceCredentialCache());

describe('OTA terminal state — a healthy screen must not look wedged', () => {
  it('accepts UP_TO_DATE and persists it as the live state', async () => {
    const { controller, prisma } = harness();
    await expect(
      controller.reportOtaState(FP, { state: 'UP_TO_DATE', message: 'v1.1.1 — already current' }, anonReq()),
    ).resolves.toMatchObject({ ok: true });
    const data = writtenData(prisma);
    expect(data.lastOtaState).toBe('UP_TO_DATE');
    expect(data.lastOtaMessage).toBe('v1.1.1 — already current');
    expect(data.lastOtaAt).toBeInstanceOf(Date);
  });

  it('normalises case, the way every other state is normalised', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: ' up_to_date ' }, anonReq());
    expect(writtenData(prisma).lastOtaState).toBe('UP_TO_DATE');
  });

  it('is NOT a failure signal — it neither stamps nor clears the sticky error', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'UP_TO_DATE' }, anonReq());
    const data = writtenData(prisma);
    expect(data).not.toHaveProperty('lastOtaErrorAt');
    expect(data).not.toHaveProperty('lastOtaErrorMessage');
    expect(data).not.toHaveProperty('lastOtaErrorAuthenticated');
  });

  it('writes ONLY manifest-hot-cache telemetry-only columns (egress guard)', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'UP_TO_DATE', progress: 100 }, anonReq());
    const keys = Object.keys(writtenData(prisma));
    expect(keys.length).toBeGreaterThan(0);
    const offenders = keys.filter((k) => !SCREEN_TELEMETRY_ONLY_FIELDS.has(k));
    expect(offenders).toEqual([]);
  });

  it('still rejects an unknown state — the allowlist is a real gate', async () => {
    const { controller, prisma } = harness();
    await expect(controller.reportOtaState(FP, { state: 'UPTODATE' }, anonReq())).rejects.toThrow();
    await expect(controller.reportOtaState(FP, { state: 'WHATEVER' }, anonReq())).rejects.toThrow();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });
});
