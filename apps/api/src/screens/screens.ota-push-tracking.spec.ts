/**
 * Tracked APK pushes at the device's OTA report and the operator's cancel
 * (2026-10-18, unattended-updates piece 3 — player-ota/push-tracking.ts).
 * The install outcome states themselves (NEEDS_TAP, FAILED_<code>) are pinned
 * by screens.ota-needs-tap.spec.ts (piece 2); this file pins what they now do
 * to the PUSH:
 *
 *   * a device that SAYS it needs a tap (or names a terminal failure) holds an
 *     active push at once — but only on a device-authenticated report: a hold
 *     stops an operator's update, so an anonymous caller may not cause one;
 *   * while a push is held, or its install is committed and still landing,
 *     a CHECKING / UP_TO_DATE cannot overwrite the status line with "current";
 *   * "Cancel update" clears the push and its whole tracked record, audited —
 *     and only the push it read;
 *   * a new push starts a fresh record, and none of these columns busts the
 *     manifest cache.
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';
import { SCREEN_TELEMETRY_ONLY_FIELDS } from './manifest-hot-cache';
import { FRESH_PUSH_STATE } from './screen-commands';
import { resetManagerLaneNoise } from '../player-ota/manager-lane-noise';

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-push-1';
const FP = 'android-push-1';
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
    lastOtaState: 'DOWNLOADING',
    lastOtaAt: new Date(Date.now() - 4 * MIN),
    playerVersionCode: 10123,
    forceApkUpdatePendingAt: new Date(Date.now() - 6 * MIN),
    forceApkUpdateHold: null,
    forceApkUpdateOfferCount: 1,
    forceApkUpdateLastOfferAt: new Date(Date.now() - 5 * MIN),
    forceApkUpdateTargetVersion: '1.1.41',
    forceApkUpdateTargetVersionCode: 10141,
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
  return { controller, prisma, screen };
}

const anonReq = () => ({ headers: {} }) as any;
const deviceReq = () => ({
  headers: {
    authorization: `Bearer ${jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0 }, SECRET, { expiresIn: '180d' })}`,
  },
}) as any;
const written = (prisma: any) => prisma.client.screen.update.mock.calls[0]?.[0].data;
const audits = (prisma: any, action: string) =>
  prisma.client.auditLog.create.mock.calls.map((x: any) => x[0].data).filter((d: any) => d.action === action);

beforeEach(() => {
  invalidateDeviceCredentialCache();
  resetManagerLaneNoise();
});

describe('a device report that explains a stuck push holds it — authenticated only', () => {
  it('NEEDS_TAP from the device itself holds the active push at once, and audits it', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP', message: 'v1.1.41' }, deviceReq());
    const data = written(prisma);
    expect(data.lastOtaState).toBe('NEEDS_TAP');
    expect(data.forceApkUpdateHold).toBe('NEEDS_TAP');
    expect(data.forceApkUpdateHoldAt).toBeInstanceOf(Date);
    expect(data.forceApkUpdateHoldReason).toMatch(/^device-reported-needs-tap: Android on this screen is waiting/);
    const [audit] = audits(prisma, 'OTA_PUSH_HELD');
    expect(audit).toMatchObject({ targetType: 'screen', targetId: SCREEN_ID, tenantId: 'tenant-1', userId: null });
    expect(JSON.parse(audit.details)).toMatchObject({ hold: 'NEEDS_TAP', reason: 'device-reported-needs-tap', offers: 1 });
  });

  it('FAILED_<code> from the device holds it as FAILED (and stamps the sticky failure, as before)', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'FAILED_INCOMPATIBLE' }, deviceReq());
    expect(written(prisma).forceApkUpdateHold).toBe('FAILED');
    expect(written(prisma).forceApkUpdateHoldReason).toMatch(/^device-reported-failed_incompatible: /);
    expect(written(prisma).lastOtaErrorAt).toBeInstanceOf(Date);
  });

  it('an ANONYMOUS NEEDS_TAP is recorded for display but holds nothing (a hold stops an operator\'s update)', async () => {
    const { controller, prisma } = harness();
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP' }, anonReq());
    expect(written(prisma).lastOtaState).toBe('NEEDS_TAP');
    expect(written(prisma)).not.toHaveProperty('forceApkUpdateHold');
    expect(audits(prisma, 'OTA_PUSH_HELD')).toHaveLength(0);
  });

  it('no pending push → nothing to hold', async () => {
    const { controller, prisma } = harness({ forceApkUpdatePendingAt: null });
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP' }, deviceReq());
    expect(written(prisma)).not.toHaveProperty('forceApkUpdateHold');
  });

  it('an already-held push is not re-held (one transition, one audit row)', async () => {
    const { controller, prisma } = harness({ forceApkUpdateHold: 'NEEDS_TAP' });
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP' }, deviceReq());
    expect(written(prisma)).not.toHaveProperty('forceApkUpdateHold');
    expect(audits(prisma, 'OTA_PUSH_HELD')).toHaveLength(0);
  });
});

describe('a HELD push owns the status line until the screen reaches the offered build', () => {
  const held = { forceApkUpdateHold: 'NEEDS_TAP', lastOtaState: 'NEEDS_TAP' };

  it.each(['CHECKING', 'UP_TO_DATE'])('%s from a below-target screen is acknowledged and NOT stored — every hold, signed or not', async (state) => {
    // The Player from 1.1.41 signs its reports, and an EXPIRED / STALLED /
    // FAILED push is answered plain `uptoDate` — whose UP_TO_DATE would read
    // "Already on v1.1.23 ✓" on a screen that is behind.
    for (const hold of ['NEEDS_TAP', 'STALLED', 'FAILED', 'EXPIRED']) {
      for (const req of [deviceReq(), anonReq()]) {
        const { controller, prisma } = harness({ forceApkUpdateHold: hold, lastOtaState: 'DOWNLOADING' });
        await expect(controller.reportOtaState(FP, { state }, req)).resolves.toEqual({ ok: true, ignored: 'push-held' });
        expect(prisma.client.screen.update).not.toHaveBeenCalled();
      }
    }
  });

  it('an anonymous check over a NEEDS_TAP is already caught by piece 2\'s rule — still not stored', async () => {
    const { controller, prisma } = harness(held);
    await expect(controller.reportOtaState(FP, { state: 'UP_TO_DATE' }, anonReq())).resolves.toEqual({ ok: true, ignored: 'needs-tap-pending' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('real progress after someone presses Install now on the panel IS stored', async () => {
    const { controller, prisma } = harness(held);
    await controller.reportOtaState(FP, { state: 'DOWNLOADING', progress: 40 }, deviceReq());
    expect(written(prisma).lastOtaState).toBe('DOWNLOADING');
  });

  it('a screen already on the offered build reports normally', async () => {
    const { controller, prisma } = harness({ ...held, playerVersionCode: 10141 });
    await controller.reportOtaState(FP, { state: 'UP_TO_DATE' }, deviceReq());
    expect(written(prisma).lastOtaState).toBe('UP_TO_DATE');
  });
});

describe('a COMMITTED install still landing keeps its INSTALLING', () => {
  // The second check of a push is answered `installInFlight`; the UP_TO_DATE
  // a player reports for that answer would hide the INSTALLING the push
  // decision reads once the settle window is over.
  const committed = { lastOtaState: 'INSTALLING', lastOtaAt: new Date(Date.now() - 2 * MIN) };

  it.each(['CHECKING', 'UP_TO_DATE'])('%s is acknowledged and NOT stored', async (state) => {
    const { controller, prisma } = harness(committed);
    await expect(controller.reportOtaState(FP, { state }, deviceReq())).resolves.toEqual({ ok: true, ignored: 'install-in-flight' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('an INSTALLING from before the last offer is an earlier attempt — reports are stored', async () => {
    const { controller, prisma } = harness({ lastOtaState: 'INSTALLING', lastOtaAt: new Date(Date.now() - 20 * MIN) });
    await controller.reportOtaState(FP, { state: 'UP_TO_DATE' }, deviceReq());
    expect(written(prisma).lastOtaState).toBe('UP_TO_DATE');
  });

  it('…and so is anything that is not a check (a NEEDS_TAP, a failure)', async () => {
    const { controller, prisma } = harness(committed);
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP' }, deviceReq());
    expect(written(prisma).lastOtaState).toBe('NEEDS_TAP');
  });
});

describe('POST /screens/:id/force-update/cancel', () => {
  const adminReq = () => ({ user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } }) as any;

  it('clears the push and its whole tracked record — this push only — and audits it', async () => {
    const { controller, prisma, screen } = harness({ forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateOfferCount: 2 });
    const res = await controller.cancelForceUpdate(adminReq(), SCREEN_ID);
    expect(res).toEqual({ ok: true, screenId: SCREEN_ID, cancelled: true });
    const { where, data } = prisma.client.screen.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: SCREEN_ID, tenantId: 'tenant-1', forceApkUpdatePendingAt: screen.forceApkUpdatePendingAt });
    expect(data).toEqual({ forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false, ...FRESH_PUSH_STATE });
    const [audit] = audits(prisma, 'FORCE_APK_UPDATE_CANCEL');
    expect(audit).toMatchObject({ targetType: 'screen', targetId: SCREEN_ID, tenantId: 'tenant-1', userId: 'u1' });
    expect(JSON.parse(audit.details)).toMatchObject({ hold: 'NEEDS_TAP', offers: 2, screenName: 'G43' });
  });

  it('no pending push → a harmless no-op (double click): no write, no audit', async () => {
    const { controller, prisma } = harness({ forceApkUpdatePendingAt: null });
    await expect(controller.cancelForceUpdate(adminReq(), SCREEN_ID)).resolves.toEqual({ ok: true, screenId: SCREEN_ID, cancelled: false });
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
    expect(audits(prisma, 'FORCE_APK_UPDATE_CANCEL')).toHaveLength(0);
  });

  it('a push re-sent between the read and the write is left alone: cancelled:false, no audit', async () => {
    const { controller, prisma } = harness();
    prisma.client.screen.updateMany.mockResolvedValue({ count: 0 });
    await expect(controller.cancelForceUpdate(adminReq(), SCREEN_ID)).resolves.toMatchObject({ cancelled: false });
    expect(audits(prisma, 'FORCE_APK_UPDATE_CANCEL')).toHaveLength(0);
  });

  it('a screen outside the caller\'s tenant is not found', async () => {
    const { controller, prisma } = harness();
    prisma.client.screen.findFirst.mockResolvedValue(null);
    await expect(controller.cancelForceUpdate(adminReq(), 'other')).rejects.toMatchObject({ status: 404 });
    expect(prisma.client.screen.findFirst.mock.calls[0][0].where).toEqual({ id: 'other', tenantId: 'tenant-1' });
  });
});

describe('a new push starts a fresh tracked record', () => {
  const adminReq = () => ({ user: { tenantId: 'tenant-1', role: 'SCHOOL_ADMIN', id: 'u1' } }) as any;

  it('one screen', async () => {
    const { controller, prisma } = harness({ forceApkUpdateHold: 'EXPIRED', forceApkUpdateOfferCount: 3 });
    await controller.forceUpdateOne(adminReq(), SCREEN_ID, {} as any);
    const arm = prisma.client.screen.update.mock.calls[0][0].data;
    expect(arm.forceApkUpdatePendingAt).toBeInstanceOf(Date);
    for (const [k, v] of Object.entries(FRESH_PUSH_STATE)) expect(arm[k]).toEqual(v);
  });

  it('every screen of the location', async () => {
    const { controller, prisma } = harness();
    await controller.forceUpdateAll(adminReq());
    const arm = prisma.client.screen.updateMany.mock.calls[0][0].data;
    expect(arm.forceApkUpdatePendingAt).toBeInstanceOf(Date);
    for (const [k, v] of Object.entries(FRESH_PUSH_STATE)) expect(arm[k]).toEqual(v);
  });
});

describe('the push columns never bust the manifest cache', () => {
  it('every tracked-push column (and the window override written beside them) is telemetry-only', () => {
    for (const k of Object.keys(FRESH_PUSH_STATE)) expect(SCREEN_TELEMETRY_ONLY_FIELDS.has(k)).toBe(true);
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('forceApkUpdatePendingAt')).toBe(true);
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('forceApkUpdateOverrideWindow')).toBe(true);
  });
});
