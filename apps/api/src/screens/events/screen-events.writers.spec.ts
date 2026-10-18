/**
 * Every interruption-ledger writer outside the emergency, demotion and
 * media-publication suites (those have their own ledger blocks), driven
 * through its REAL route or function with the REAL ScreenEventsService on a
 * mocked database (2026-10-18). Each writer: the row it writes, and that a
 * repeat inside the dedup window writes nothing more.
 *
 *   page-reload    recordPushDeployment (operator, publish) · wedge detector · telemetry bundle-apply
 *   app-relaunch   status heartbeat proc (reboot / process restart / update install) · boot-diagnostic
 *   engine-*       telemetry (start, stop: failed + session history, swap: both ways)
 *   ota-*          ota-state transitions · ota-installed from telemetry and the status heartbeat
 *   GET /screens/:id/events?hours=24|72 and the legacy timeline that leaves ledger rows out
 */
jest.mock('../../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
jest.mock('../device-auth', () => {
  const actual = jest.requireActual('../device-auth');
  return { ...actual, verifyDeviceForScreen: jest.fn() };
});

import { ScreenEventsService, resetScreenEventsDedupForTests } from './screen-events.service';
import { PlayerOtaController } from '../../player-ota/player-ota.controller';
import { LEDGER_KIND_LIST } from './screen-events';
import { recordPushDeployment } from '../deployment-record';
import { ScreenWedgeDetectorCron } from '../screen-wedge-detector.cron';
import { ScreensController } from '../screens.controller';
import { TelemetryController, resetTelemetryStateForTests } from '../../telemetry/telemetry.controller';
import { resetManifestCacheForTests } from '../manifest-hot-cache';
import { invalidateDeviceCredentialCache } from '../device-auth';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const deviceAuth = require('../device-auth') as { verifyDeviceForScreen: jest.Mock };

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const SHA = 'c'.repeat(64);
const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4444-8444-444444444444';

/** A screenEvent table the ledger writes into; `rows(kind)` reads them back. */
function eventTable() {
  const created: any[] = [];
  const screenEvent = {
    create: jest.fn(async ({ data }: any) => {
      created.push(data);
      return { id: `ev-${created.length}` };
    }),
    createMany: jest.fn(async ({ data }: any) => {
      created.push(...data);
      return { count: data.length };
    }),
  };
  const rows = (kind?: string) => created.filter((r) => r.cause !== undefined && (!kind || r.kind === kind));
  return { screenEvent, created, rows };
}

beforeEach(() => resetScreenEventsDedupForTests());
afterEach(() => {
  jest.useRealTimers();
});

// ── page-reload: operator pushes (refresh-web, bulk Resync, publish-to-fleet) ──
describe('page-reload · recordPushDeployment', () => {
  function client(over: Record<string, any> = {}) {
    const t = eventTable();
    return {
      t,
      prisma: {
        client: {
          screen: {
            findMany: jest.fn(async () => [{ id: 'scr-a', tenantId: 'ten-1' }, { id: 'scr-b', tenantId: 'ten-2' }]),
            updateMany: jest.fn(async () => ({ count: 2 })),
          },
          deployment: { create: jest.fn(async () => ({})) },
          screenEvent: t.screenEvent,
          ...over,
        },
      } as any,
    };
  }
  const value = new Date(NOW);

  it('one row per target, each with its OWN tenant, cause operator', async () => {
    const { t, prisma } = client();
    await recordPushDeployment(prisma, { tenantId: 'ten-1', targetTenantIds: ['ten-1', 'ten-2'], createdById: 'u', value, corrId: 'rw-1', scope: 'tenant' });
    expect(t.rows('page-reload')).toEqual([
      expect.objectContaining({ screenId: 'scr-a', tenantId: 'ten-1', cause: 'operator', source: 'operator', createdAt: value, detail: { scope: 'tenant', corrId: 'rw-1' } }),
      expect.objectContaining({ screenId: 'scr-b', tenantId: 'ten-2', cause: 'operator', source: 'operator' }),
    ]);
    // the timeline's own rows are untouched
    expect(t.created.filter((r) => r.kind === 'refresh-requested')).toHaveLength(2);
  });

  it('a content publish says so', async () => {
    const { t, prisma } = client();
    await recordPushDeployment(prisma, { tenantId: 'ten-1', targetTenantIds: ['ten-1'], createdById: 'u', value, corrId: 'pub-1', scope: 'tenant', playlistId: 'pl-1' });
    expect(t.rows('page-reload')[0].detail).toEqual({ scope: 'tenant', corrId: 'pub-1', publish: true, playlistId: 'pl-1' });
  });

  it('is written even when the Deployment row fails — but never when the durable stamp failed', async () => {
    const a = client({ deployment: { create: jest.fn(async () => { throw new Error('db'); }) } });
    await recordPushDeployment(a.prisma, { tenantId: 'ten-1', targetTenantIds: ['ten-1'], createdById: 'u', value, corrId: 'rw-2', scope: 'screen', screenIds: ['scr-a'] });
    expect(a.t.rows('page-reload')).toHaveLength(2);
    const b = client();
    b.prisma.client.screen.updateMany = jest.fn(async () => { throw new Error('db'); });
    await recordPushDeployment(b.prisma, { tenantId: 'ten-1', targetTenantIds: ['ten-1'], createdById: 'u', value, corrId: 'rw-3', scope: 'screen', screenIds: ['scr-a'] });
    expect(b.t.rows('page-reload')).toHaveLength(0);
  });

  it('dedup: a push is ONE event — its rows go out once, in one statement per 1,000 screens', async () => {
    const { t, prisma } = client();
    await recordPushDeployment(prisma, { tenantId: 'ten-1', targetTenantIds: ['ten-1', 'ten-2'], createdById: 'u', value, corrId: 'rw-4', scope: 'tenant' });
    const ledgerCalls = t.screenEvent.createMany.mock.calls.filter(([arg]: any) => arg.data.some((r: any) => r.kind === 'page-reload'));
    expect(ledgerCalls).toHaveLength(1);
    expect(new Set(t.rows('page-reload').map((r) => r.screenId)).size).toBe(t.rows('page-reload').length);
  });
});

// ── page-reload: the wedge detector's durable refresh ──
describe('page-reload · wedge detector', () => {
  it('writes the timeline row as before plus one ledger row; a repeat inside 60 s writes no second ledger row', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const t = eventTable();
    const prisma: any = { client: { screenEvent: t.screenEvent } };
    const cron = new ScreenWedgeDetectorCron(prisma, {} as any, {} as any, undefined, new ScreenEventsService(prisma));
    await (cron as any).recordAutoRefreshEvent('scr-w', 'ten-1', 'wedge', 'wedge-1');
    jest.setSystemTime(NOW + 30_000);
    await (cron as any).recordAutoRefreshEvent('scr-w', 'ten-1', 'push-dead');
    expect(t.created.filter((r) => r.kind === 'auto-refresh-requested')).toHaveLength(2);
    expect(t.rows('page-reload')).toEqual([
      expect.objectContaining({ screenId: 'scr-w', tenantId: 'ten-1', cause: 'wedge-detector', source: 'system', detail: { reason: 'wedge', requested: true, corrId: 'wedge-1' } }),
    ]);
  });
});

// ── telemetry: bundle-apply, engine start / stop / swap, ota-installed ──
describe('telemetry writers', () => {
  let seq = 0;
  let SCREEN = 'tel-0';

  function harness(row: Record<string, unknown> = {}) {
    SCREEN = `tel-${++seq}`;
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: true, sub: SCREEN, screen: { id: SCREEN, tenantId: 'ten-1' }, tenantId: 'ten-1', token: 'x' });
    const t = eventTable();
    const base = {
      id: SCREEN, tenantId: 'ten-1', name: 'Lobby', playerVersion: '1.1.29', playerVersionCode: 10129,
      managerVersion: null, forceApkUpdatePendingAt: null, pendingRefreshAt: null, lastOtaState: null,
      lastOtaProgress: null, lastOtaMessage: null, lastOtaAt: null, displayCapabilitiesAt: new Date(NOW - 60_000),
      lastVideoReport: null, faceIndex: 0, credentialEpochRotatedAt: null, ...row,
    };
    const prisma: any = {
      client: {
        screen: { findUnique: jest.fn(async () => base), update: jest.fn(async () => ({ id: SCREEN })) },
        screenEvent: t.screenEvent,
        screenFilePlayback: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
        $queryRaw: jest.fn(async () => []),
      },
    };
    const controller = new TelemetryController(prisma, { sismember: jest.fn(async () => false) } as any, undefined, new ScreenEventsService(prisma));
    const post = async (body: Record<string, unknown>, atMs: number) => {
      jest.setSystemTime(atMs);
      resetTelemetryStateForTests();
      return controller.report(SCREEN, { headers: { authorization: 'Bearer x' } } as any, body);
    };
    return { t, post };
  }
  const nativeBlock = (over: Record<string, unknown> = {}) => ({
    version: 1, state: 'presenting', sessionId: S1, revision: 'r1', sha256: SHA, faceIndex: 0, ...over,
  });
  const timing = (entries: any[]) => ({
    decodedFrames: 10, submittedFrames: 10, lateFrames: 0, lastLateUs: 0, maxLateUs: 0, maxSubmitGapMs: 33,
    leadUs: 50_000, sourceWidth: 1920, sourceHeight: 1080, history: { entries, overflow: 0 },
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    resetManifestCacheForTests();
  });

  it('page-reload bundle-apply: once per bundle, however often the report repeats', async () => {
    const { t, post } = harness();
    const update = { fromBundleId: 'b1', toBundleId: 'b2', window: 'nightly', boundary: 'item', zone: 'UTC', zoneSource: 'utc', capture: 'live', blankMs: 120, coverMs: 300, converged: true };
    await post({ update }, NOW);
    await post({ update }, NOW + 31_000);
    expect(t.rows('page-reload')).toEqual([
      expect.objectContaining({ cause: 'bundle-apply', source: 'device', detail: { window: 'nightly', fromBundleId: 'b1', toBundleId: 'b2', blankMs: 120, coverMs: 300 } }),
    ]);
    // the timeline's own row, as before (twice — it never had a dedup)
    expect(t.created.filter((r) => r.kind === 'update-applied')).toHaveLength(2);
  });

  it('engine-start: once per native session', async () => {
    const { t, post } = harness();
    await post({ nativeVideo: nativeBlock() }, NOW);
    await post({ nativeVideo: nativeBlock() }, NOW + 31_000);
    expect(t.rows('engine-start')).toEqual([expect.objectContaining({ cause: 'native', sessionId: S1, versionCode: 10129 })]);
  });

  it('engine-swap web→native: the browser had the file a moment ago; once per session', async () => {
    const { t, post } = harness({ lastVideoReport: { url: 'x.mp4', sha256: SHA, at: new Date(NOW - 60_000).toISOString() } });
    await post({ nativeVideo: nativeBlock() }, NOW);
    await post({ nativeVideo: nativeBlock() }, NOW + 31_000);
    expect(t.rows('engine-swap')).toEqual([expect.objectContaining({ cause: 'web-to-native', sessionId: S1 })]);
  });

  it('engine-swap native→web: the browser now plays what native presented; once per session', async () => {
    const { t, post } = harness({
      lastVideoReport: { native: { state: 'presenting', sessionId: S1, sha256: SHA, faceIndex: 0, at: new Date(NOW - 60_000).toISOString() } },
    });
    const video = { url: 'https://cdn.example/x.mp4', totalFrames: 900, droppedFrames: 0, sha256: SHA, engine: 'continuous' };
    await post({ video }, NOW);
    await post({ video }, NOW + 31_000);
    expect(t.rows('engine-swap')).toEqual([expect.objectContaining({ cause: 'native-to-web', sessionId: S1 })]);
  });

  it('engine-stop: a failed state with its reason, once per session', async () => {
    const { t, post } = harness();
    await post({ nativeVideo: nativeBlock({ state: 'failed', reason: 'output-stalled' }) }, NOW);
    await post({ nativeVideo: nativeBlock({ state: 'failed', reason: 'output-stalled' }) }, NOW + 31_000);
    expect(t.rows('engine-stop')).toEqual([expect.objectContaining({ cause: 'output-stalled', sessionId: S1 })]);
  });

  it('engine-stop: a new entry in the persisted session history, once per entry', async () => {
    const old = { at: NOW - 900_000, face: 0, reason: 'content-changed' };
    const ended = { at: NOW - 20_000, face: 0, reason: 'activity-paused', sha8: 'cccccccc' };
    const { t, post } = harness({
      lastVideoReport: { native: { state: 'presenting', sessionId: S2, sha256: SHA, faceIndex: 0, at: new Date(NOW - 60_000).toISOString(), timing: { history: { entries: [old] } } } },
    });
    await post({ nativeVideo: nativeBlock({ timing: timing([old, ended]) }) }, NOW);
    await post({ nativeVideo: nativeBlock({ timing: timing([old, ended]) }) }, NOW + 31_000);
    expect(t.rows('engine-stop')).toEqual([
      expect.objectContaining({ cause: 'activity-paused', sessionId: null, createdAt: new Date(ended.at) }),
    ]);
  });

  it('ota-installed: a new Player build, once per build', async () => {
    const { t, post } = harness();
    await post({ versions: { player: '1.1.41', playerCode: 10141 } }, NOW);
    await post({ versions: { player: '1.1.41', playerCode: 10141 } }, NOW + 31_000);
    expect(t.rows('ota-installed')).toEqual([
      expect.objectContaining({ cause: 'version-change', versionCode: 10141, detail: { from: 10129, to: 10141, version: '1.1.41' } }),
    ]);
  });

  it('a ledger that cannot write never fails the report', async () => {
    const { t, post } = harness();
    t.screenEvent.create.mockRejectedValue(new Error('pool timeout'));
    await expect(post({ nativeVideo: nativeBlock() }, NOW)).resolves.toMatchObject({ ok: true });
  });
});

// ── the screens controller: status heartbeat, ota-state, boot-diagnostic ──
function screensHarness(row: Record<string, unknown>, proved = true) {
  const t = eventTable();
  const screen = {
    findUnique: jest.fn(async () => row),
    findFirst: jest.fn(async () => row),
    update: jest.fn(async () => row),
    updateMany: jest.fn(async () => ({ count: 1 })),
    count: jest.fn(async () => 0),
  };
  const prisma: any = {
    client: {
      screen,
      screenEvent: t.screenEvent,
      auditLog: { create: jest.fn(async () => ({})) },
      tenant: { findMany: jest.fn(async () => []) },
    },
  };
  const controller = new ScreensController(
    prisma, { publish: jest.fn(), sismember: jest.fn(async () => false) } as any, { signMessage: jest.fn() } as any,
    {} as any, {} as any, {} as any, new ScreenEventsService(prisma),
  );
  jest.spyOn(controller as any, 'heartbeatProvesDevice').mockResolvedValue({ presented: proved, proved });
  return { t, prisma, controller };
}

describe('app-relaunch + ota-installed · status heartbeat', () => {
  const proc = (pid: number, at: number, boot: number) => ({
    schema: 1, interactive: true, foreground: true, standbySinceMs: null, elapsedRealtimeMs: 5000, powerOnAck: null, proc: { pid, at, boot },
  });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'hb-1', tenantId: 'ten-1', deviceFingerprint: 'fp-hb', playerVersion: '1.1.41', playerVersionCode: 10141,
    pairingCode: null, faceOfScreenId: null, forceApkUpdatePendingAt: null, nativePowerOnAt: null,
    nativeRuntimeReport: proc(100, NOW - 9e6, 7), nativeRuntimeReportAt: new Date(NOW - 60_000), ...over,
  });
  const beat = (c: ScreensController, report: unknown, vn = '1.1.41', vc = '10141', fp = 'fp-hb') =>
    c.deviceStatus(fp, vn, vc, undefined, { headers: { 'x-venueos-native-runtime': JSON.stringify(report) } });

  beforeEach(() => invalidateDeviceCredentialCache());

  it('a new boot count is a reboot — once, however many heartbeats repeat it', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { t, controller } = screensHarness(row());
    await beat(controller, proc(200, NOW - 40_000, 8), '1.1.41', '10141', 'fp-hb-1');
    jest.setSystemTime(NOW + 30_000);
    await beat(controller, proc(200, NOW - 40_000, 8), '1.1.41', '10141', 'fp-hb-1');
    expect(t.rows('app-relaunch')).toEqual([
      expect.objectContaining({ cause: 'reboot', source: 'device', createdAt: new Date(NOW - 40_000), detail: { bootFrom: 7, bootTo: 8, deviceAt: NOW - 40_000 } }),
    ]);
  });

  it('a new process on the same boot is a restart; with a new build it is the update install, and the build is ota-installed', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const a = screensHarness(row());
    await beat(a.controller, proc(300, NOW - 10_000, 7), '1.1.41', '10141', 'fp-hb-2');
    expect(a.t.rows('app-relaunch')).toEqual([expect.objectContaining({ cause: 'process-restart' })]);
    const b = screensHarness(row({ id: 'hb-2', playerVersion: '1.1.29', playerVersionCode: 10129 }));
    await beat(b.controller, proc(300, NOW - 10_000, 7), '1.1.41', '10141', 'fp-hb-3');
    expect(b.t.rows('app-relaunch')).toEqual([expect.objectContaining({ cause: 'update-install', versionCode: 10141 })]);
    expect(b.t.rows('ota-installed')).toEqual([expect.objectContaining({ cause: 'version-change', detail: expect.objectContaining({ from: 10129, to: 10141 }) })]);
    jest.setSystemTime(NOW + 30_000);
    await beat(b.controller, proc(300, NOW - 10_000, 7), '1.1.41', '10141', 'fp-hb-3');
    expect(b.t.rows('ota-installed')).toHaveLength(1);
  });

  it('an anonymous heartbeat writes nothing to the ledger', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { t, controller } = screensHarness(row({ tenantId: null }), false);
    await beat(controller, proc(200, NOW - 40_000, 8), '1.1.41', '10141', 'fp-hb-4');
    expect(t.rows()).toEqual([]);
  });
});

describe('ota-installed · player-ota update-check (persistReportedVersion)', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  function otaHarness(prior: Record<string, unknown> | null) {
    const t = eventTable();
    const prisma: any = {
      client: {
        screen: { findFirst: jest.fn(async () => prior), updateMany: jest.fn(async () => ({ count: 1 })) },
        auditLog: { create: jest.fn(async () => ({})) },
        screenEvent: t.screenEvent,
      },
    };
    const controller = new PlayerOtaController(prisma, { sismember: jest.fn(async () => false) } as any);
    const report = (ctx: { deviceAuthenticated: boolean }) =>
      (controller as any).persistReportedVersion({ fingerprint: 'fp-ota-check', versionName: '1.1.41', versionCode: 10141 }, ctx);
    return { t, report };
  }

  it('a build the screen had not reported before: one row (anonymous or not), none for the repeat, none without a tenant', async () => {
    const { t, report } = otaHarness({ id: 'scr-o', tenantId: 'ten-1', playerVersionCode: 10129, forceApkUpdatePendingAt: null, forceApkUpdateTargetVersionCode: null });
    await report({ deviceAuthenticated: false });
    await report({ deviceAuthenticated: true });
    await flush();
    expect(t.rows('ota-installed')).toEqual([
      expect.objectContaining({
        screenId: 'scr-o', tenantId: 'ten-1', cause: 'version-change', source: 'device', versionCode: 10141,
        detail: { from: 10129, to: 10141, version: '1.1.41', authenticated: false },
      }),
    ]);
    const unpaired = otaHarness({ id: 'scr-u', tenantId: null, playerVersionCode: 10129 });
    await unpaired.report({ deviceAuthenticated: false });
    await flush();
    expect(unpaired.t.rows()).toEqual([]);
  });
});

describe('ota-* · POST /screens/status/:fp/ota-state', () => {
  const row = (lastOtaState: string | null) => ({
    id: 'ota-1', name: 'G43', tenantId: 'ten-1', lastOtaState, lastOtaAt: new Date(NOW - 60_000), playerVersionCode: 10129,
    forceApkUpdatePendingAt: null, forceApkUpdateHold: null, credentialEpoch: 0, status: 'ONLINE',
  });
  const anon = { headers: {} } as any;

  // An anonymous report (the shipped OTA worker sends no token).
  beforeEach(() => deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: false, reason: 'no_auth' }));

  it.each([
    ['CHECKING', 'DOWNLOADING', 'ota-download', 'downloading'],
    ['DOWNLOADING', 'INSTALLING', 'ota-install', 'installing'],
    ['INSTALLING', 'NEEDS_TAP', 'ota-needs-tap', 'needs_tap'],
    ['INSTALLING', 'FAILED_ABORTED', 'ota-failed', 'failed_aborted'],
    ['INSTALLING', 'RELAUNCH_BLOCKED', 'ota-failed', 'relaunch_blocked'],
  ])('%s → %s writes one %s row, and a repeat inside a minute writes no second', async (from, state, kind, cause) => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { t, controller } = screensHarness(row(from));
    await controller.reportOtaState('fp-ota', { state, progress: 50 }, anon);
    jest.setSystemTime(NOW + 20_000);
    await controller.reportOtaState('fp-ota', { state, progress: 70 }, anon);
    expect(t.rows(kind)).toEqual([
      expect.objectContaining({ cause, source: 'device', versionCode: 10129, detail: { from, progress: 50, authenticated: false } }),
    ]);
  });

  it('a report inside the same state (progress) writes nothing; CHECKING / UP_TO_DATE never do', async () => {
    const { t, controller } = screensHarness(row('DOWNLOADING'));
    await controller.reportOtaState('fp-ota', { state: 'DOWNLOADING', progress: 80 }, anon);
    await controller.reportOtaState('fp-ota', { state: 'UP_TO_DATE' }, anon);
    expect(t.rows()).toEqual([]);
  });
});

describe('app-relaunch · boot-diagnostic', () => {
  it('the start-up check card is on the glass: one row per reason a minute', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { t, controller } = screensHarness({ id: 'boot-1', tenantId: 'ten-1', playerVersionCode: 10141 }, false);
    await controller.reportBootDiagnostic('fp-boot', { reason: 'NO_CLIENT_BOOT', versionName: '1.1.41' }, { headers: {} } as any);
    jest.setSystemTime(NOW + 10_000);
    await controller.reportBootDiagnostic('fp-boot', { reason: 'NO_CLIENT_BOOT', versionName: '1.1.41' }, { headers: {} } as any);
    expect(t.rows('app-relaunch')).toEqual([
      expect.objectContaining({ cause: 'boot-diagnostic', versionCode: 10141, detail: { reason: 'NO_CLIENT_BOOT', authenticated: false, version: '1.1.41' } }),
    ]);
  });

  it('an unpaired screen has no ledger', async () => {
    const { t, controller } = screensHarness({ id: 'boot-2', tenantId: null, playerVersionCode: null }, false);
    await controller.reportBootDiagnostic('fp-boot-2', { reason: 'NO_REGISTER_RESULT' }, { headers: {} } as any);
    expect(t.rows()).toEqual([]);
  });
});

describe('GET /screens/:id/events', () => {
  const admin = { user: { id: 'u', role: 'SCHOOL_ADMIN', tenantId: 'ten-1' } };

  function routeHarness() {
    const { prisma, controller } = screensHarness({ id: 'scr-r', tenantId: 'ten-1' });
    prisma.client.screenEvent.groupBy = jest.fn(async () => [{ kind: 'page-reload', cause: 'operator', _count: { _all: 1 } }]);
    prisma.client.screenEvent.count = jest.fn(async () => 0);
    prisma.client.screenEvent.findMany = jest.fn(async () => [
      { id: 'e1', kind: 'page-reload', cause: 'operator', source: 'operator', detail: null, sessionId: null, versionCode: null, createdAt: new Date(NOW) },
    ]);
    return { prisma, controller };
  }

  it('?hours=72 answers the ledger window and its summary', async () => {
    const { controller } = routeHarness();
    const out: any = await controller.screenEvents(admin, 'scr-r', undefined, '72');
    expect(out).toMatchObject({ hours: 72, summary: { interruptions: 1, drills: 0, byKind: { 'page-reload': 1 } } });
    expect(out.events[0]).toMatchObject({ id: 'e1', kind: 'page-reload', interruption: true });
  });

  it('only 24 or 72 hours', async () => {
    const { controller } = routeHarness();
    for (const h of ['48', '0', 'abc', '']) {
      await expect(controller.screenEvents(admin, 'scr-r', undefined, h)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('a screen outside the caller’s scope is a 404, never its ledger', async () => {
    const { prisma, controller } = routeHarness();
    prisma.client.screen.findFirst = jest.fn(async () => null);
    await expect(controller.screenEvents(admin, 'foreign', undefined, '24')).rejects.toMatchObject({ status: 404 });
    expect(prisma.client.screenEvent.groupBy).not.toHaveBeenCalled();
  });

  it('without hours the timeline answers as before, ledger rows left out', async () => {
    const { prisma, controller } = routeHarness();
    await controller.screenEvents(admin, 'scr-r');
    expect(prisma.client.screenEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { screenId: 'scr-r', kind: { notIn: LEDGER_KIND_LIST } }, take: 20 }),
    );
  });
});
