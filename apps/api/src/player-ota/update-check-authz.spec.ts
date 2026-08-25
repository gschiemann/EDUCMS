/**
 * Regression tests for OTA-01 — unauthenticated `/player/update-check`
 * silently cancelled an operator's pending APK push.
 *
 * The attack: `POST /api/v1/player/update-check` takes no authentication of
 * any kind, and `persistReportedVersion` is what clears
 * `forceApkUpdatePendingAt`. Anyone who knew ONE device fingerprint — a
 * value `GET /screen-groups` handed to every CONTRIBUTOR (and, via the RBAC
 * GET pass-through, every RESTRICTED_VIEWER), and that 60 seconds of adb on
 * any single kiosk yields — could POST a fabricated version bump and cancel
 * the push. Looped, that holds a whole tenant fleet off the patch channel
 * indefinitely while the dashboard's "push pending" chip clears as if the
 * install had succeeded. That is the exact channel that would ship the fix
 * for the confirmed debuggable-APK / stolen-device-token CRITICALs.
 *
 * The constraint the fix had to respect: the SHIPPED Kotlin OTA worker sends
 * no Authorization header, and no APK can ship with this change. Requiring
 * auth outright would have taken the entire live fleet off updates — the
 * very outcome being defended against. So the read path stays open and the
 * one destructive write is gated.
 */

import * as jwt from 'jsonwebtoken';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { PlayerOtaController } from './player-ota.controller';
import { invalidateDeviceCredentialCache } from '../screens/device-auth';

// ⚠️ HERMETIC FETCH — this spec used to hit the LIVE GitHub API (2026-08-17).
//
// The harness mocks Prisma, Redis and required-secret, but `updateCheck`'s
// release lookup calls raw `fetch('https://api.github.com/...releases...')`,
// which nothing here intercepted. So every run of this file made a real
// network call and pulled the repo's ACTUAL latest release — the CI log
// literally showed `decision=install-gh target=v1.1.2` the day v1.1.2
// shipped. It stayed green only while GitHub answered inside Jest's 5s
// budget. On 2026-08-17 the shared Actions runners were rate-limited and the
// same test timed out twice in a row (run 32037673294 + its rerun), turning
// `Build, Lint & Test` — a BLOCKING job — red on a web-only commit that
// could not have caused it. Locally the same call left an undici keep-alive
// socket open and Jest hung at exit.
//
// A unit test that depends on api.github.com's mood is not a test. The
// controller reads exactly `resp.ok`, `resp.status` and `resp.json()` (an
// array of releases); an empty array is the "no release found" path, which
// is irrelevant to what THIS spec asserts — it exercises the AUTHZ split
// (anonymous read stays open, the destructive clear is gated), not release
// resolution. Release-resolution behaviour has its own coverage; if a future
// spec needs a populated catalog, extend the mock — do not remove it.
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  }) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-ota-1';
const FP = 'android-abcdef123456';

function harness(priorScreen: any) {
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn().mockResolvedValue(priorScreen),
        findUnique: jest.fn().mockResolvedValue(priorScreen),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const redis: any = { sismember: jest.fn().mockResolvedValue(false) };
  return { controller: new PlayerOtaController(prisma, redis), prisma };
}

const screenWithPendingPush = () => ({
  id: SCREEN_ID,
  tenantId: 'tenant-1',
  screenGroupId: null,
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
  playerVersionCode: 63,
  forceApkUpdatePendingAt: new Date(),
});

const deviceReq = () => ({
  headers: {
    authorization: `Bearer ${jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0 }, SECRET, { expiresIn: '180d' })}`,
  },
}) as any;

const anonReq = () => ({ headers: {} }) as any;

const bumpBody = { fingerprint: FP, versionName: '1.0.64', versionCode: 64 };

/** The `data` object of the single updateMany the persist path performs. */
const persistedData = (prisma: any) => prisma.client.screen.updateMany.mock.calls[0][0].data;

beforeEach(() => invalidateDeviceCredentialCache());

describe('OTA-01 — clearing a pending push is privileged', () => {
  it('an UNAUTHENTICATED version bump does NOT clear the operator’s pending push', async () => {
    const { controller, prisma } = harness(screenWithPendingPush());
    await (controller as any).persistReportedVersion(bumpBody, { deviceAuthenticated: false });
    const data = persistedData(prisma);
    expect(data).not.toHaveProperty('forceApkUpdatePendingAt');
    expect(data).not.toHaveProperty('forceApkUpdateOverrideWindow');
  });

  it('an unauthenticated install claim leaves a forensic AuditLog row', async () => {
    // The audit specifically called out that this cancellation left no
    // record anywhere. Now the refusal is recorded.
    const { controller, prisma } = harness(screenWithPendingPush());
    await (controller as any).persistReportedVersion(bumpBody, { deviceAuthenticated: false });
    const row = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('OTA_UNAUTHENTICATED_INSTALL_CLAIM');
    expect(row.targetId).toBe(SCREEN_ID);
    expect(JSON.parse(row.details).claimedVersionCode).toBe(64);
  });

  it('a DEVICE-AUTHENTICATED version bump still clears the push exactly as before', async () => {
    const { controller, prisma } = harness(screenWithPendingPush());
    await (controller as any).persistReportedVersion(bumpBody, { deviceAuthenticated: true });
    const data = persistedData(prisma);
    expect(data.forceApkUpdatePendingAt).toBeNull();
    expect(data.forceApkUpdateOverrideWindow).toBe(false);
    // …and clears the sticky OTA failure stamp: a real install IS resolution.
    expect(data.lastOtaErrorAt).toBeNull();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('the fleet keeps reporting its version either way — telemetry is not gated', async () => {
    // Gating version telemetry would blind the whole fleet-version chip for
    // every kiosk on the shipped (tokenless) APK. Only the destructive
    // write is privileged.
    const { controller, prisma } = harness(screenWithPendingPush());
    await (controller as any).persistReportedVersion(bumpBody, { deviceAuthenticated: false });
    const data = persistedData(prisma);
    expect(data.playerVersion).toBe('1.0.64');
    expect(data.playerVersionCode).toBe(64);
  });

  it('isDeviceAuthenticated: true for a valid credential bound to the fingerprint’s screen', async () => {
    const { controller } = harness(screenWithPendingPush());
    await expect((controller as any).isDeviceAuthenticated(deviceReq(), FP)).resolves.toBe(true);
  });

  it('isDeviceAuthenticated: false with no Authorization header (the shipped APK)', async () => {
    const { controller } = harness(screenWithPendingPush());
    await expect((controller as any).isDeviceAuthenticated(anonReq(), FP)).resolves.toBe(false);
  });

  it('isDeviceAuthenticated: false for a REVOKED screen, even with a signed token', async () => {
    // Not merely "wrong screen" — a revoked credential counts as
    // unauthenticated here too, so a compromised kiosk cannot cancel pushes.
    const { controller } = harness({ ...screenWithPendingPush(), status: 'REVOKED' });
    await expect((controller as any).isDeviceAuthenticated(deviceReq(), FP)).resolves.toBe(false);
  });

  it('isDeviceAuthenticated: false when the fingerprint resolves to no screen', async () => {
    const { controller } = harness(null);
    await expect((controller as any).isDeviceAuthenticated(deviceReq(), FP)).resolves.toBe(false);
  });

  it('OTA_REQUIRE_DEVICE_AUTH=true turns the route into a hard gate (post-fleet-update)', async () => {
    const { controller } = harness(screenWithPendingPush());
    process.env.OTA_REQUIRE_DEVICE_AUTH = 'true';
    try {
      await expect(controller.updateCheck(bumpBody, anonReq())).rejects.toMatchObject({ status: 401 });
    } finally {
      delete process.env.OTA_REQUIRE_DEVICE_AUTH;
    }
  });

  it('is OFF by default — enabling it must be a deliberate act taken with knowledge of the fleet', async () => {
    const { controller } = harness(screenWithPendingPush());
    delete process.env.OTA_REQUIRE_DEVICE_AUTH;
    // Resolves (to uptoDate or a release offer) rather than throwing 401.
    await expect(controller.updateCheck(bumpBody, anonReq())).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2026-08-25 — the panel's own Update button must WORK (operator, L55VEC:
// "it needs to work from a button push"). A device-authenticated check
// carrying source='user' is honored as explicit operator authorization —
// equal to a dashboard push — bypassing tenant auto-off AND the canary
// hold. Spoof-proof: without the device token it stays gated (OTA-01
// posture), so an attacker with a bare fingerprint cannot pull a
// rollout-held build or write audit rows.
// ─────────────────────────────────────────────────────────────────────────
describe('panel-user-tap — an authenticated human tap is authorization', () => {
  const gatedScreen = (canaryPct: number | null = null) => ({
    id: SCREEN_ID,
    tenantId: 'tenant-1',
    name: 'L55VEC',
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    playerVersionCode: 10102,
    forceApkUpdatePendingAt: null, // no dashboard push
    lastOtaState: 'UP_TO_DATE',
    lastOtaAt: new Date(),
    tenant: {
      autoUpdatePlayerEnabled: false, // rollout held back
      otaWindowStart: null,
      otaWindowEnd: null,
      otaWindowTimezone: null,
      canaryFleetPercent: canaryPct,
    },
  });
  const tapBody = { fingerprint: FP, versionName: '1.1.2', versionCode: 10102, source: 'user' } as any;
  const clearDedup = () => ((PlayerOtaController as any).userTapAuditAt as Map<string, number>).clear();

  beforeEach(clearDedup);

  it('DEVICE-AUTHENTICATED tap → offer granted (reason=panel-user-tap) + PANEL_USER_UPDATE audit row', async () => {
    const { controller, prisma } = harness(gatedScreen());
    const lines: string[] = [];
    jest.spyOn((controller as any).logger, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
    await controller.updateCheck(tapBody, deviceReq());
    expect(lines.join('\n')).toContain('reason=panel-user-tap');
    expect(lines.join('\n')).toContain('decision=offer-latest');
    const audit = prisma.client.auditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.action === 'PANEL_USER_UPDATE');
    expect(audit).toBeDefined();
    expect(audit.targetId).toBe(SCREEN_ID);
    expect(audit.tenantId).toBe('tenant-1');
    expect(JSON.parse(audit.details).screenName).toBe('L55VEC');
  });

  it('UNAUTHENTICATED source=user stays gated — no offer, no audit row (no spoofed pacing bypass)', async () => {
    const { controller, prisma } = harness(gatedScreen());
    const lines: string[] = [];
    jest.spyOn((controller as any).logger, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
    await controller.updateCheck(tapBody, anonReq());
    expect(lines.join('\n')).toContain('decision=uptoDate');
    expect(lines.join('\n')).not.toContain('panel-user-tap');
    const audit = prisma.client.auditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.action === 'PANEL_USER_UPDATE');
    expect(audit).toBeUndefined();
  });

  it('canary hold (0%) does NOT block an authenticated tap — a human asked', async () => {
    const { controller } = harness(gatedScreen(0));
    const lines: string[] = [];
    jest.spyOn((controller as any).logger, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
    await controller.updateCheck(tapBody, deviceReq());
    expect(lines.join('\n')).toContain('decision=offer-latest');
    expect(lines.join('\n')).toContain('reason=panel-user-tap');
    expect(lines.join('\n')).not.toContain('canary-gate-blocked');
  });

  it('audit rows dedupe per screen within 10 minutes (retry noise stays bounded)', async () => {
    const { controller, prisma } = harness(gatedScreen());
    jest.spyOn((controller as any).logger, 'log').mockImplementation(() => {});
    await controller.updateCheck(tapBody, deviceReq());
    await controller.updateCheck(tapBody, deviceReq());
    const audits = prisma.client.auditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .filter((d: any) => d.action === 'PANEL_USER_UPDATE');
    expect(audits).toHaveLength(1);
  });

  it('a periodic (sourceless) authenticated check is UNCHANGED — still gated when rollout is held', async () => {
    const { controller } = harness(gatedScreen());
    const lines: string[] = [];
    jest.spyOn((controller as any).logger, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
    await controller.updateCheck({ fingerprint: FP, versionName: '1.1.2', versionCode: 10102 } as any, deviceReq());
    expect(lines.join('\n')).toContain('decision=uptoDate');
  });
});
