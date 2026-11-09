/**
 * Companion Manager health + signed Manager reports (2026-11-08,
 * manager-health.ts):
 *   * the parser converts device times to the server clock and drops junk;
 *   * the heartbeat stores the report ONLY on a paired, device-authenticated
 *     request, forces a write only on news, and tells the Player the kill
 *     switch's answer;
 *   * a relayed Manager ota-state is signed but still the companion: it keeps
 *     the Manager-noise filters and can never hold a push;
 *   * Manager 1.0.24's anonymous posts are accepted exactly as before, and
 *     marked unauthenticated.
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';
import { noteManagerCheckRefused, resetManagerLaneNoise } from '../player-ota/manager-lane-noise';
import { SCREEN_TELEMETRY_ONLY_FIELDS } from './manifest-hot-cache';
import {
  MANAGER_HEALTH_HEADER,
  isRelayedManagerReport,
  managerHealthChanged,
  managerReportRelayOff,
  parseManagerHealthHeader,
} from './manager-health';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const received = new Date('2026-11-08T12:00:00.000Z');
// The panel's clock is 3 hours fast: every stored time must still be right.
const deviceNow = received.getTime() + 3 * 60 * MIN;

function report(over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    now: deviceNow,
    version: '1.1.66-field.1',
    versionCode: 10166,
    watchdogTickAt: deviceNow - 20_000,
    watchdogStartedAt: deviceNow - DAY,
    relaunches: {
      total: 4,
      recent: [
        { at: deviceNow - 2 * DAY, reason: 'player-unresponsive' },
        { at: deviceNow - DAY, reason: 'player-unresponsive' },
        { at: deviceNow - 8 * DAY, reason: 'player-unresponsive' }, // outside the week
        { at: deviceNow - MIN, reason: 'made-up' }, // unknown reason
        { at: deviceNow + MIN, reason: 'after-update' }, // in the device's future
      ],
    },
    rollback: null,
    quarantined: [10165, 10165, -1, 'x'],
    installPermission: true,
    installTapPendingSince: null,
    ...over,
  };
}

describe('parseManagerHealthHeader', () => {
  it('stores every fact on the server clock, whatever the panel clock says', () => {
    const r = parseManagerHealthHeader(JSON.stringify(report()), received)!;
    expect(r.reportedAt).toBe(received.toISOString());
    expect(r.watchdogTickAt).toBe(new Date(received.getTime() - 20_000).toISOString());
    expect(r.relaunches.recent).toEqual([
      { at: new Date(received.getTime() - 2 * DAY).toISOString(), reason: 'player-unresponsive' },
      { at: new Date(received.getTime() - DAY).toISOString(), reason: 'player-unresponsive' },
    ]);
    expect(r.relaunches.total).toBe(4);
    expect(r.quarantined).toEqual([10165]);
    expect(r.version).toBe('1.1.66-field.1');
    expect(r.installPermission).toBe(true);
    expect(r.installTapPendingSince).toBeNull();
    expect(r.rollback).toBeNull();
  });

  it('refuses a report with no schema or clock, and anything that is not JSON', () => {
    for (const bad of [undefined, null, '', 'nope', '{}', JSON.stringify({ ...report(), schema: 2 }), JSON.stringify({ ...report(), now: 0 }), 'x'.repeat(5000)]) {
      expect(parseManagerHealthHeader(bad, received)).toBeNull();
    }
  });

  it('a pending tap and a rollback are carried; an unknown permission stays unknown', () => {
    const r = parseManagerHealthHeader(
      JSON.stringify(report({ installTapPendingSince: deviceNow - 5 * MIN, rollback: { at: deviceNow - DAY, versionCode: 10165 }, installPermission: 'yes' })),
      received,
    )!;
    expect(r.installTapPendingSince).toBe(new Date(received.getTime() - 5 * MIN).toISOString());
    expect(r.rollback).toEqual({ at: new Date(received.getTime() - DAY).toISOString(), versionCode: 10165 });
    expect(r.installPermission).toBeNull();
  });

  it('only news forces a write; the moving watchdog tick does not', () => {
    const a = parseManagerHealthHeader(JSON.stringify(report()), received)!;
    expect(managerHealthChanged(null, a)).toBe(true);
    const tickOnly = parseManagerHealthHeader(JSON.stringify(report({ watchdogTickAt: deviceNow - 1000 })), received)!;
    expect(managerHealthChanged(a, tickOnly)).toBe(false);
    const relaunched = parseManagerHealthHeader(JSON.stringify(report({ relaunches: { total: 5, recent: [] } })), received)!;
    expect(managerHealthChanged(a, relaunched)).toBe(true);
    const tap = parseManagerHealthHeader(JSON.stringify(report({ installTapPendingSince: deviceNow })), received)!;
    expect(managerHealthChanged(a, tap)).toBe(true);
    expect(managerHealthChanged(a, null)).toBe(false);
  });

  it('the kill switch is exactly "off"', () => {
    expect(managerReportRelayOff({} as any)).toBe(false);
    expect(managerReportRelayOff({ MANAGER_REPORT_RELAY: 'off' } as any)).toBe(true);
    expect(managerReportRelayOff({ MANAGER_REPORT_RELAY: ' OFF ' } as any)).toBe(true);
    expect(managerReportRelayOff({ MANAGER_REPORT_RELAY: '0' } as any)).toBe(false);
  });

  it('a relayed report needs the body AND the credential', () => {
    expect(isRelayedManagerReport({ source: 'manager', relayedBy: 'player' }, true)).toBe(true);
    expect(isRelayedManagerReport({ source: 'manager', relayedBy: 'player' }, false)).toBe(false);
    expect(isRelayedManagerReport({ source: 'manager' }, true)).toBe(false);
  });

  it('the new columns never bust the manifest cache', () => {
    for (const f of ['managerHealthReport', 'managerHealthReportAt', 'lastCrashAuthenticated']) {
      expect(SCREEN_TELEMETRY_ONLY_FIELDS.has(f)).toBe(true);
    }
  });
});

// ── the heartbeat ───────────────────────────────────────────────────────

function heartbeatHarness(proved = true, paired = true, prior: unknown = null) {
  const row = {
    id: 'wall', tenantId: paired ? 'tenant-1' : null, deviceFingerprint: 'android-wall',
    playerVersion: '1.1.66', playerVersionCode: 10166, managerVersion: '1.1.66',
    managerHealthReport: prior, nativeRuntimeReport: null, pairingCode: null, faceOfScreenId: null,
    forceApkUpdatePendingAt: null, nativePowerOnAt: null,
  };
  const screen = {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(row),
    count: jest.fn().mockResolvedValue(0),
  };
  const controller = new ScreensController(
    { client: { screen, auditLog: { create: jest.fn() } } } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  jest.spyOn(controller as any, 'heartbeatProvesDevice').mockResolvedValue({ presented: proved, proved });
  return { controller, screen };
}

const beat = (c: ScreensController, header: unknown, mv: string | undefined = '1.1.66') =>
  c.deviceStatus(`android-wall`, '1.1.66', '10166', mv, { headers: { [MANAGER_HEALTH_HEADER]: header } });

describe('the signed heartbeat carries companion health', () => {
  const env = process.env.MANAGER_REPORT_RELAY;
  afterEach(() => {
    if (env === undefined) delete process.env.MANAGER_REPORT_RELAY;
    else process.env.MANAGER_REPORT_RELAY = env;
  });
  beforeEach(() => invalidateDeviceCredentialCache());

  it('stores it on a paired, authenticated heartbeat and answers managerRelay on', async () => {
    const { controller, screen } = heartbeatHarness();
    const res: any = await beat(controller, JSON.stringify(report()));
    expect(res.managerRelay).toBe('on');
    const data = screen.update.mock.calls[0][0].data;
    expect(data.managerHealthReport.relaunches.total).toBe(4);
    expect(data.managerHealthReportAt).toBeInstanceOf(Date);
  });

  it('never stores it, nor says anything about the relay, for an anonymous or unpaired caller', async () => {
    for (const [proved, paired] of [[false, true], [true, false]] as const) {
      const { controller, screen } = heartbeatHarness(proved, paired);
      const res: any = await beat(controller, JSON.stringify(report()));
      expect(res).not.toHaveProperty('managerRelay');
      for (const call of screen.update.mock.calls) expect(call[0].data).not.toHaveProperty('managerHealthReport');
    }
  });

  it('MANAGER_REPORT_RELAY=off ignores the header and tells the Player to stop relaying', async () => {
    process.env.MANAGER_REPORT_RELAY = 'off';
    const { controller, screen } = heartbeatHarness();
    const res: any = await beat(controller, JSON.stringify(report()));
    expect(res.managerRelay).toBe('off');
    for (const call of screen.update.mock.calls) expect(call[0].data).not.toHaveProperty('managerHealthReport');
  });

  it('an old Player (no header) changes nothing about the companion columns', async () => {
    const { controller, screen } = heartbeatHarness();
    await beat(controller, undefined);
    for (const call of screen.update.mock.calls) expect(call[0].data).not.toHaveProperty('managerHealthReport');
  });

  it('a Player that says the companion is gone clears its health with its version', async () => {
    const { controller, screen } = heartbeatHarness(true, true, { schema: 1 });
    await beat(controller, undefined, '');
    const data = screen.update.mock.calls[0][0].data;
    expect(data.managerVersion).toBeNull();
    expect(data.managerHealthReport).toBeNull();
  });
});

// ── ota-state and crash-report ─────────────────────────────────────────

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-mgr-1';
const FP = 'android-mgr-1';

function reportHarness(row: Record<string, unknown> = {}) {
  const screen = {
    id: SCREEN_ID, name: 'Lobby', tenantId: 'tenant-1', screenGroupId: null, status: 'ONLINE',
    credentialEpoch: 0, credentialEpochRotatedAt: null,
    lastOtaState: 'UP_TO_DATE', lastOtaAt: new Date(Date.now() - 60 * MIN), playerVersionCode: 10166,
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
  headers: { authorization: `Bearer ${jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0 }, SECRET, { expiresIn: '180d' })}` },
}) as any;
const written = (prisma: any) => prisma.client.screen.update.mock.calls[0]?.[0].data;
const relayed = { source: 'manager', relayedBy: 'player' };

describe('Manager ota-state: signed through the Player, legacy anonymous unchanged', () => {
  beforeEach(() => {
    invalidateDeviceCredentialCache();
    resetManagerLaneNoise();
  });

  it('a relayed install error is stored and marked authenticated', async () => {
    const { controller, prisma } = reportHarness();
    await expect(
      controller.reportOtaState(FP, { state: 'ERROR', message: 'com.educms.player: Install failed', ...relayed }, deviceReq()),
    ).resolves.toEqual({ ok: true });
    expect(written(prisma).lastOtaState).toBe('ERROR');
    expect(written(prisma).lastOtaErrorAuthenticated).toBe(true);
  });

  it('a relayed report can never hold a push — that is the Player\'s own rule', async () => {
    const { controller, prisma } = reportHarness();
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP', ...relayed }, deviceReq());
    expect(written(prisma)).not.toHaveProperty('forceApkUpdateHold');
    // The Player's own signed NEEDS_TAP still does (unchanged behaviour).
    const own = reportHarness();
    await own.controller.reportOtaState(FP, { state: 'NEEDS_TAP' }, deviceReq());
    expect(written(own.prisma).forceApkUpdateHold).toBeTruthy();
  });

  it('the Manager-lane noise filter still applies to a signed Manager report', async () => {
    const { controller, prisma } = reportHarness();
    await expect(
      controller.reportOtaState(FP, { state: 'CHECKING', message: 'v1.1.66 → checking', ...relayed }, deviceReq()),
    ).resolves.toEqual({ ok: true, ignored: 'manager-lane-noise' });
    noteManagerCheckRefused(FP);
    await expect(
      controller.reportOtaState(FP, { state: 'UP_TO_DATE', ...relayed }, deviceReq()),
    ).resolves.toEqual({ ok: true, ignored: 'manager-lane-noise' });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('Manager 1.0.24\'s anonymous post is accepted as before and stored unauthenticated', async () => {
    const { controller, prisma } = reportHarness();
    await expect(
      controller.reportOtaState(FP, { state: 'ERROR', message: 'com.educms.player: Install failed' }, anonReq()),
    ).resolves.toEqual({ ok: true });
    expect(written(prisma).lastOtaErrorAuthenticated).toBe(false);
    expect(written(prisma)).not.toHaveProperty('forceApkUpdateHold');
    // …and its refused-lane noise is still discarded.
    const noisy = reportHarness();
    await expect(
      noisy.controller.reportOtaState(FP, { state: 'CHECKING', message: 'v1.1.23 → checking' }, anonReq()),
    ).resolves.toEqual({ ok: true, ignored: 'manager-lane-noise' });
  });

  it('an anonymous caller claiming to be relayed is just anonymous', async () => {
    const { controller, prisma } = reportHarness();
    await controller.reportOtaState(FP, { state: 'NEEDS_TAP', ...relayed }, anonReq());
    expect(written(prisma)).not.toHaveProperty('forceApkUpdateHold');
  });
});

describe('Manager crash-report: authenticated when relayed, anonymous still accepted', () => {
  beforeEach(() => invalidateDeviceCredentialCache());

  it('records whether the caller proved the credential', async () => {
    for (const [req, expected] of [[deviceReq(), true], [anonReq(), false]] as const) {
      const { controller, prisma } = reportHarness();
      jest.spyOn(controller as any, 'heartbeatProvesDevice').mockResolvedValue({ presented: expected, proved: expected });
      await expect(
        controller.reportCrash(FP, { source: 'manager', versionName: '1.1.66', message: 'boom', stack: 'at x' }, req),
      ).resolves.toEqual({ ok: true });
      expect(written(prisma)).toMatchObject({ lastCrashSource: 'manager', lastCrashMessage: 'boom', lastCrashAuthenticated: expected });
    }
  });
});
