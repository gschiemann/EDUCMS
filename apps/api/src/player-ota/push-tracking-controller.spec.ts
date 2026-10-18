/**
 * Tracked APK pushes through the REAL update-check handler (2026-10-18).
 *
 * The decision itself is pinned in push-tracking.spec.ts; this file pins the
 * controller around it — what each caller is answered, what is persisted
 * (and only for the push that was read), and that nothing is resolved or
 * downloaded for a held push. The first block replays the field failure end
 * to end against an in-memory screen row: one push to an Android 9 panel
 * that needs a tap, then a check every 30 minutes for a day.
 */
import { PlayerOtaController } from './player-ota.controller';
import * as field from './field-candidate';
import { PUSH_MAX_OFFERS } from './push-tracking';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const MIN = 60_000;
const T0 = new Date('2026-10-16T09:00:00Z').getTime();
const realFetch = global.fetch;
const saved = { ...process.env };

const release = {
  versionName: '1.1.41-field.1',
  versionCode: 10141,
  sha256: 'b'.repeat(64),
  size: 8,
  sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/1',
};

beforeEach(() => {
  // Hermetic: no GitHub. Offers below use the private field-candidate path,
  // which never touches the release catalogue.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
  process.env.PLAYER_APK_FIELD_CANDIDATE = release.versionName;
  process.env.PLAYER_APK_FIELD_TENANT_ID = TENANT;
  process.env.PLAYER_APK_FIELD_SCREEN_IDS = SCREEN;
  // A field authorization lives at most 24 h (field-candidate.ts); `at()`
  // below moves it along with the simulated clock.
  process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(Date.now() + 60 * MIN).toISOString();
  process.env.DEVICE_SECRET_KEY = 'fake-test-key';
  jest.spyOn(field, 'configuredFieldRelease').mockReturnValue(release as any);
  jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = { ...saved };
  global.fetch = realFetch;
});

function screenRow(over: Record<string, unknown> = {}) {
  return {
    id: SCREEN,
    tenantId: TENANT,
    name: 'M24',
    status: 'ONLINE',
    screenGroupId: null,
    autoUpdatePlayerOverride: null,
    playerVersionCode: 10123,
    forceApkUpdatePendingAt: new Date(Date.now() - 40 * MIN),
    forceApkUpdateOverrideWindow: true,
    forceApkUpdateHold: null,
    forceApkUpdateOfferCount: 0,
    forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null,
    forceApkUpdateTargetVersionCode: null,
    lastOtaState: null,
    lastOtaMessage: null,
    lastOtaAt: null,
    tenant: {
      autoUpdatePlayerEnabled: false,
      otaWindowStart: null,
      otaWindowEnd: null,
      otaWindowTimezone: null,
      canaryFleetPercent: 100,
    },
    ...over,
  };
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? a != null && b != null && new Date(a as any).getTime() === new Date(b as any).getTime()
    : a === b;

/**
 * A Prisma stand-in backed by ONE mutable row: `updateMany` honours its
 * `where` (id, tenant, the push's identity, `hold: null`) and `{ increment }`,
 * so the handler's guarded writes behave as they would against Postgres.
 */
function harness(initial: any, opts: { auth?: boolean; inventory?: unknown } = {}) {
  const row: any = { ...initial };
  const updateMany = jest.fn(async ({ where, data }: any) => {
    const matches = Object.entries(where).every(([k, v]) => sameValue(row[k], v));
    if (!matches) return { count: 0 };
    for (const [k, v] of Object.entries(data)) {
      row[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (Number(row[k]) || 0) + (v as any).increment : v;
    }
    return { count: 1 };
  });
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn(async () => ({ ...row })),
        update: jest.fn().mockResolvedValue({}),
        updateMany,
      },
      screenDeviceInventory: {
        findUnique: jest.fn().mockResolvedValue(opts.inventory === undefined ? null : { report: opts.inventory }),
      },
      displaySchedule: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    },
  };
  const c = new PlayerOtaController(prisma, { sismember: jest.fn().mockResolvedValue(false) } as any);
  jest.spyOn(c as any, 'isDeviceAuthenticated').mockResolvedValue(opts.auth ?? true);
  // The version-persist side path is covered by update-check-authz.spec.ts.
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  const lines: string[] = [];
  jest.spyOn((c as any).logger, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
  jest.spyOn((c as any).logger, 'warn').mockImplementation((m: any) => { lines.push(String(m)); });
  jest.spyOn((c as any).logger, 'error').mockImplementation((m: any) => { lines.push(String(m)); });
  return { c, prisma, row, lines };
}

const req = { headers: {}, protocol: 'https', get: () => 'api.example.test' } as any;
const playerBody = { fingerprint: 'android-m24', versionCode: 10123, versionName: '1.1.23', abi: 'armeabi-v7a' } as any;
const audits = (prisma: any, action: string) =>
  prisma.client.auditLog.create.mock.calls.map((x: any) => x[0].data).filter((d: any) => d.action === action);
const at = (ms: number) => {
  jest.setSystemTime(new Date(ms));
  process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(ms + 60 * MIN).toISOString();
};
/** What the ota-state route stores when the device reports (server clock). */
const deviceSays = (row: any, state: string, atMs: number, message: string | null = null) => {
  row.lastOtaState = state;
  row.lastOtaMessage = message;
  row.lastOtaAt = new Date(atMs);
};
const ANDROID_9 = { app: { versionCode: 10123, silentUpdateArmed: false, sdkInt: 28 } };
const ANDROID_12_SILENT = { app: { versionCode: 10123, silentUpdateArmed: true, sdkInt: 31 } };

describe('the field failure, replayed: one push, then a check every 30 minutes for a day', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));

  it('Android 9 panel that needs a tap → 2 downloads (WebSocket + heartbeat), then NEEDS_TAP — never 48', async () => {
    at(T0);
    const { c, row, prisma } = harness(screenRow({ forceApkUpdatePendingAt: new Date(T0) }), { inventory: ANDROID_9 });
    let offers = 0;
    const check = async (atMs: number) => {
      at(atMs);
      const res: any = await c.updateCheck(playerBody, req);
      if (res.latest) offers += 1;
      return res;
    };
    await check(T0 + 5_000); // CHECK_FOR_UPDATES over the WebSocket
    deviceSays(row, 'DOWNLOADING', T0 + 10_000);
    // The heartbeat's forceUpdatePending fires a second check, which
    // REPLACEs the first worker — it must be offered, not told "up to date".
    expect((await check(T0 + 40_000)).latest).toBeDefined();
    deviceSays(row, 'INSTALLING', T0 + 70_000, 'v1.1.41-field.1'); // the dialog nobody taps
    const answers: any[] = [];
    for (let i = 1; i <= 46; i++) answers.push(await check(T0 + i * 30 * MIN));
    expect(offers).toBe(2);
    expect(row.forceApkUpdateOfferCount).toBe(2);
    expect(row.forceApkUpdateTargetVersionCode).toBe(10141);
    expect(row.forceApkUpdateHold).toBe('NEEDS_TAP');
    // Visible: the push is still pending, and the status line says why.
    expect(row.forceApkUpdatePendingAt).toEqual(new Date(T0));
    expect(row.lastOtaState).toBe('NEEDS_TAP');
    expect(answers.every((a) => a.uptoDate === true && a.needsTap === true && a.pushHold === 'NEEDS_TAP')).toBe(true);
    // One hold transition, one audit row — not one per check.
    expect(audits(prisma, 'OTA_PUSH_HELD')).toHaveLength(1);
  });

  it('Android 12 panel that installs silently and still did not land → STALLED, and its status line is left alone', async () => {
    at(T0);
    const { c, row } = harness(screenRow({ forceApkUpdatePendingAt: new Date(T0) }), { inventory: ANDROID_12_SILENT });
    at(T0 + 5_000);
    await c.updateCheck(playerBody, req);
    deviceSays(row, 'INSTALLING', T0 + 30_000);
    at(T0 + 6 * 60 * MIN);
    const res: any = await c.updateCheck(playerBody, req);
    expect(res).toEqual({ uptoDate: true, needsTap: false, pushHold: 'STALLED' });
    expect(row.forceApkUpdateHold).toBe('STALLED');
    expect(row.forceApkUpdateHoldReason).toMatch(/^silent-install-did-not-land: /);
    // STALLED is not a device state: the device's own last words stay.
    expect(row.lastOtaState).toBe('INSTALLING');
  });

  it('a screen that never gets as far as installing is offered at most PUSH_MAX_OFFERS times, then STALLED', async () => {
    at(T0);
    const { c, row } = harness(screenRow({ forceApkUpdatePendingAt: new Date(T0) }), { inventory: ANDROID_9 });
    let offers = 0;
    for (let i = 0; i < 12; i++) {
      at(T0 + i * 6 * 60 * MIN + 1_000);
      const res: any = await c.updateCheck(playerBody, req);
      if (res.latest) offers += 1;
      deviceSays(row, 'DOWNLOADING', T0 + i * 6 * 60 * MIN + 5_000); // …and then the download dies
    }
    expect(offers).toBe(PUSH_MAX_OFFERS);
    expect(row.forceApkUpdateHold).toBe('STALLED');
    expect(row.forceApkUpdateHoldReason).toMatch(/^offer-limit-reached: .*offered 4 times/);
  });
});

describe('a push that was offered and did not land is HELD — once, visibly', () => {
  const m24 = () => screenRow({
    forceApkUpdateOfferCount: 1,
    forceApkUpdateLastOfferAt: new Date(Date.now() - 30 * MIN),
    forceApkUpdateTargetVersion: '1.1.29',
    forceApkUpdateTargetVersionCode: 10129,
    lastOtaState: 'INSTALLING',
    lastOtaAt: new Date(Date.now() - 29 * MIN),
  });

  it('M24 SHAPE: offered 30 min ago, INSTALLING reported, still on 1.1.23 → needsTap + one guarded hold write', async () => {
    const { c, prisma, row } = harness(m24(), { inventory: ANDROID_9 });
    const pushAt = row.forceApkUpdatePendingAt;
    const res = await c.updateCheck(playerBody, req);
    expect(res).toEqual({ uptoDate: true, needsTap: true, pushHold: 'NEEDS_TAP' });
    expect(prisma.client.screen.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.client.screen.updateMany.mock.calls[0][0];
    // Only THIS push, and only if nothing held it meanwhile.
    expect(where).toEqual({ id: SCREEN, tenantId: TENANT, forceApkUpdatePendingAt: pushAt, forceApkUpdateHold: null });
    expect(data.forceApkUpdateHold).toBe('NEEDS_TAP');
    expect(data.forceApkUpdateHoldReason).toMatch(/^did-not-land-needs-tap-class: /);
    // Server-inferred NEEDS_TAP becomes the status line every surface words.
    expect(data.lastOtaState).toBe('NEEDS_TAP');
    expect(data.lastOtaMessage).toContain('needs someone to tap Install');
    expect(audits(prisma, 'OTA_PUSH_HELD')).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a push re-sent while the check was in flight is left alone: no hold on the NEW push, no audit row', async () => {
    const { c, prisma, row } = harness(m24(), { inventory: ANDROID_9 });
    // The operator pressed Send update again between the read and the write.
    prisma.client.screen.findFirst.mockResolvedValueOnce({ ...row });
    row.forceApkUpdatePendingAt = new Date();
    await c.updateCheck(playerBody, req);
    expect(row.forceApkUpdateHold).toBeNull();
    expect(audits(prisma, 'OTA_PUSH_HELD')).toHaveLength(0);
  });

  it('an already-held push is answered from the record with NO write', async () => {
    const { c, prisma } = harness(screenRow({
      forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateOfferCount: 1,
      forceApkUpdateLastOfferAt: new Date(Date.now() - 60 * MIN),
      forceApkUpdateTargetVersion: '1.1.29', forceApkUpdateTargetVersionCode: 10129,
    }));
    const res: any = await c.updateCheck(playerBody, req);
    expect(res).toEqual({ uptoDate: true, needsTap: true, pushHold: 'NEEDS_TAP' });
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('a committed install inside the settle window: no second offer (no second download), nothing written', async () => {
    const { c, prisma } = harness(screenRow({
      forceApkUpdateOfferCount: 1,
      forceApkUpdateLastOfferAt: new Date(Date.now() - 3 * MIN),
      forceApkUpdateTargetVersionCode: 10141,
      lastOtaState: 'INSTALLING',
      lastOtaAt: new Date(Date.now() - 2 * MIN),
    }));
    await expect(c.updateCheck(playerBody, req)).resolves.toEqual({ uptoDate: true, installInFlight: true });
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
  });

  it('a push no check was handed within 24 h becomes EXPIRED — visibly, not deleted, status line untouched', async () => {
    const { c, row } = harness(screenRow({
      forceApkUpdatePendingAt: new Date(Date.now() - 25 * 60 * MIN),
      lastOtaState: 'UP_TO_DATE', lastOtaAt: new Date(Date.now() - 26 * 60 * MIN),
    }));
    const pushAt = row.forceApkUpdatePendingAt;
    const res: any = await c.updateCheck(playerBody, req);
    expect(res).toEqual({ uptoDate: true, needsTap: false, pushHold: 'EXPIRED' });
    expect(row.forceApkUpdateHold).toBe('EXPIRED');
    expect(row.forceApkUpdateHoldReason).toMatch(/^not-offered-within-24h: /);
    // The push itself stays until a person cancels it or sends it again.
    expect(row.forceApkUpdatePendingAt).toBe(pushAt);
    expect(row.lastOtaState).toBe('UP_TO_DATE');
  });

  const heldForTap = () => screenRow({
    forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateOfferCount: 1,
    forceApkUpdateLastOfferAt: new Date(Date.now() - 60 * MIN), forceApkUpdateTargetVersionCode: 10141,
  });

  it('a person pressing Install now on the panel is never held — on an ordinary screen the tap path comes first', async () => {
    delete process.env.PLAYER_APK_FIELD_SCREEN_IDS; // not a field-candidate screen
    const { c, lines } = harness(heldForTap());
    await c.updateCheck({ ...playerBody, source: 'user' }, req);
    expect(lines.join('\n')).toContain('reason=panel-user-tap');
    expect(lines.join('\n')).not.toContain('push-held');
  });

  it('…and on a FIELD-candidate screen (which skips that path) the push gate lets the person through, uncounted', async () => {
    const { c, row } = harness(heldForTap());
    const res: any = await c.updateCheck({ ...playerBody, source: 'user' }, req);
    expect(res.latest?.versionName).toBe('1.1.41-field.1');
    expect(row.forceApkUpdateHold).toBe('NEEDS_TAP'); // the hold stands until the build lands
    expect(row.forceApkUpdateOfferCount).toBe(1);
  });

  it('a source=user claim WITHOUT the device credential is an unattended check, and stays held', async () => {
    const { c } = harness(heldForTap(), { auth: false });
    await expect(c.updateCheck({ ...playerBody, source: 'user' }, req))
      .resolves.toEqual({ uptoDate: true, needsTap: true, pushHold: 'NEEDS_TAP' });
  });
});

describe('an offer is counted against the push it was made for', () => {
  it('first offer of a fresh push → latest is returned AND offerCount/target are recorded, guarded by the push', async () => {
    const { c, prisma, row } = harness(screenRow());
    const pushAt = row.forceApkUpdatePendingAt;
    const res: any = await c.updateCheck(playerBody, req);
    expect(res.latest?.versionCode).toBe(10141);
    const call = prisma.client.screen.updateMany.mock.calls.map((x: any) => x[0]).find((x: any) => 'forceApkUpdateOfferCount' in x.data);
    expect(call.where).toEqual({ id: SCREEN, tenantId: TENANT, forceApkUpdatePendingAt: pushAt });
    expect(call.data).toEqual({
      forceApkUpdateOfferCount: { increment: 1 },
      forceApkUpdateLastOfferAt: expect.any(Date),
      forceApkUpdateTargetVersion: '1.1.41-field.1',
      forceApkUpdateTargetVersionCode: 10141,
    });
    expect(row.forceApkUpdateOfferCount).toBe(1);
  });

  it('a screen already on the candidate has nothing to install: its push is cleared (authenticated, this push only)', async () => {
    const { c, prisma, row, lines } = harness(screenRow({ playerVersionCode: 10141 }));
    const pushAt = row.forceApkUpdatePendingAt;
    const res = await c.updateCheck({ ...playerBody, versionCode: 10141, versionName: '1.1.41-field.1' }, req);
    expect(res).toEqual({ uptoDate: true });
    const clear = prisma.client.screen.updateMany.mock.calls.map((x: any) => x[0]).find((x: any) => x.data.forceApkUpdatePendingAt === null);
    expect(clear.where).toEqual({ id: SCREEN, tenantId: TENANT, forceApkUpdatePendingAt: pushAt });
    expect(row.forceApkUpdatePendingAt).toBeNull();
    expect(lines.join('\n')).toContain('push-cleared-already-current');
  });

  it('an unauthenticated check is never counted and never clears anything', async () => {
    const { c, prisma } = harness(screenRow(), { auth: false });
    await c.updateCheck(playerBody, req);
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
  });
});

describe('a NEEDS_TAP the screen reported for this push (piece 2) is still honoured', () => {
  it('a push armed before this record existed — never tracked — is not offered once more', async () => {
    const row = screenRow({ lastOtaState: 'NEEDS_TAP', lastOtaAt: new Date(Date.now() - 30 * MIN) });
    const anon = harness(row, { auth: false });
    await expect(anon.c.updateCheck(playerBody, req)).resolves.toEqual({ uptoDate: true, needsTap: true, pushHold: 'NEEDS_TAP' });
    expect(anon.prisma.client.screen.updateMany).not.toHaveBeenCalled(); // anonymous: honoured, not recorded
    const authed = harness(row);
    await authed.c.updateCheck(playerBody, req);
    expect(authed.row.forceApkUpdateHold).toBe('NEEDS_TAP');
    // The device's own words stay the status line.
    expect(authed.prisma.client.screen.updateMany.mock.calls[0][0].data).not.toHaveProperty('lastOtaState');
  });
});
