/**
 * PostRestartFleetCheckService end to end against an in-memory database
 * (2026-10-23): the boot snapshot, both check points, the intended-downtime
 * facts read by the REAL CustomerAlertEmailsService, the per-deployment claim,
 * and the owner email itself. Every name below is a fixture.
 */
import * as jwt from 'jsonwebtoken';
import { PostRestartFleetCheckService } from './post-restart-fleet-check.service';
import { CustomerAlertEmailsService } from '../customer-alerts/customer-alert-emails.service';
import { reportPlatformComponent, resetPlatformDegradationForTests } from '../../health/platform-degradation';
import { __resetDeviceCredentialRefusalsForTests, noteWsDeviceCredentialRefusal } from './device-credential-refusals';

const MIN = 60_000;
const SEC = 1_000;
const BOOT = Date.parse('2026-10-23T05:42:00Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Row = Record<string, any>;

function makeWorld() {
  const tenants = new Map<string, Row>();
  const screens = new Map<string, Row>();
  const displaySchedules: Row[] = [];
  const auditLogs: Row[] = [];
  const screenEvents: Row[] = [];
  const fail = { snapshot: 0, schedules: false };
  const withTenant = (s: Row) => ({ ...s, tenant: { archivedAt: tenants.get(s.tenantId)?.archivedAt ?? null } });
  const client: Row = {
    tenant: { findMany: jest.fn(async ({ where }: any) => [...tenants.values()].filter((t) => where.id.in.includes(t.id))) },
    screen: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.id?.in) return [...screens.values()].filter((s) => where.id.in.includes(s.id)).map(withTenant);
        if (fail.snapshot > 0) {
          fail.snapshot--;
          throw new Error('pool not warm');
        }
        // The boot snapshot.
        const gte = where.lastPingAt.gte.getTime();
        const lte = where.lastPingAt.lte.getTime();
        const pairedBy = where.OR[1].pairedAt.lte.getTime();
        return [...screens.values()]
          .filter(
            (s) =>
              s.tenantId &&
              s.status !== 'REVOKED' &&
              !tenants.get(s.tenantId)?.archivedAt &&
              s.lastPingAt &&
              s.lastPingAt.getTime() >= gte &&
              s.lastPingAt.getTime() <= lte &&
              (!s.pairedAt || s.pairedAt.getTime() <= pairedBy),
          )
          .map((s) => ({ id: s.id }));
      }),
    },
    displaySchedule: {
      findMany: jest.fn(async () => {
        if (fail.schedules) throw new Error('read failed');
        return displaySchedules;
      }),
    },
    auditLog: { findMany: jest.fn(async ({ where }: any) => auditLogs.filter((a) => where.targetId.in.includes(a.targetId))) },
    screenEvent: { findMany: jest.fn(async ({ where }: any) => screenEvents.filter((e) => where.screenId.in.includes(e.screenId))) },
  };
  return { client, tenants, screens, displaySchedules, auditLogs, screenEvents, fail };
}

type World = ReturnType<typeof makeWorld>;

/** Five organisations (one a district with two schools), 34 screens checking in just before the boot. */
function seed(w: World, bootAt = BOOT) {
  const t = (id: string, name: string, parentId: string | null = null) =>
    w.tenants.set(id, { id, name, slug: id, parentId, archivedAt: null, otaWindowStart: null, otaWindowEnd: null, otaWindowTimezone: null });
  t('district', 'Fixture District');
  t('school-a', 'Fixture School A', 'district');
  t('school-b', 'Fixture School B', 'district');
  t('gym', 'Fixture Gym');
  t('cafe', 'Fixture Cafe');
  t('arena', 'Fixture Arena');
  t('office', 'Fixture Office');
  const homes = ['school-a', 'school-b', 'gym', 'cafe', 'arena', 'office'];
  for (let n = 1; n <= 34; n++) {
    w.screens.set(uuid(n), {
      id: uuid(n),
      name: `Fixture Screen ${n}`,
      tenantId: homes[n % homes.length],
      status: 'ONLINE',
      deviceFingerprint: `fixture-fingerprint-${n}`,
      pairedAt: new Date(bootAt - 30 * 24 * 60 * MIN),
      lastPingAt: new Date(bootAt - (20 + n) * SEC),
      screenGroupId: null,
      faceOfScreenId: null,
      lastRenderedAt: new Date(bootAt - 20 * SEC),
      lastRenderedHash: 'abc',
      authState: 'PROVEN',
      authStateChangedAt: new Date(bootAt - 10 * 24 * 60 * MIN),
      nativeRuntimeReport: null,
      nativeRuntimeReportAt: null,
      credentialEpochRotatedAt: new Date(bootAt - 3 * 24 * 60 * MIN),
      lastOtaAt: null,
      lastOtaState: null,
      forceApkUpdatePendingAt: null,
      forceApkUpdateHold: null,
      lastVideoReport: null,
      lastVideoReportAt: null,
      playerVersionAt: null,
      managerVersionAt: null,
    });
  }
}

/** Every screen not in `except` checked in a few seconds before `at` (it came back and kept going). */
function keepCheckingIn(w: World, at: number, except: string[] = []) {
  for (const s of w.screens.values()) if (!except.includes(s.id)) s.lastPingAt = new Date(at - 7 * SEC);
}

function build(w: World, bootAt = BOOT, redis?: any) {
  const mailer = { sendAlert: jest.fn(async () => undefined) };
  const alerts = new CustomerAlertEmailsService({ client: w.client } as any);
  const svc = new PostRestartFleetCheckService({ client: w.client } as any, alerts, mailer as any, undefined, redis);
  svc.bootAtMs = bootAt;
  const clock = { now: bootAt + 30 * SEC };
  svc.now = () => clock.now;
  return { svc, mailer, clock };
}

const ENV = { ...process.env };
let w: World;
beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.POST_RESTART_FLEET_CHECK_DISABLED;
  delete process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED;
  delete process.env.RAILWAY_DEPLOYMENT_ID;
  resetPlatformDegradationForTests();
  __resetDeviceCredentialRefusalsForTests();
  w = makeWorld();
  seed(w);
});
afterAll(() => {
  process.env = ENV;
});

const TEN = 10 * MIN;
const TWENTY = 20 * MIN;

describe('a NORMAL deploy sends nothing', () => {
  it('every screen back within 3 minutes and checking in since → nothing at +10, nothing at +20', async () => {
    const { svc, mailer, clock } = build(w);
    expect(await svc.snapshot()).toBe(34);
    // Reconnected at boot + 0.5…3 min, checking in every ~25 s since.
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now);
    const ten = await svc.check(TEN);
    expect(ten).toMatchObject({ status: 'ok', verdict: { cohort: 34, expected: 34, alert: false } });
    clock.now = BOOT + TWENTY;
    keepCheckingIn(w, clock.now);
    expect((await svc.check(TWENTY)).status).toBe('ok');
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('a screen that took 4½ minutes to come back is back', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now);
    w.screens.get(uuid(1))!.lastPingAt = new Date(BOOT + 4.5 * MIN + 25 * SEC * 13);
    expect((await svc.check(TEN)).status).toBe('ok');
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('two screens that went dark for their own reasons do not make an alarm', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, [uuid(1), uuid(2)]);
    expect((await svc.check(TEN)).verdict).toMatchObject({ alert: false, threshold: 3 });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });
});

describe('an outage that begins AT the restart is reported at +10 min', () => {
  const dark = Array.from({ length: 14 }, (_, i) => uuid(i + 1));

  function darkAtBoot() {
    // The old container served them through the hand-over; the new one never did.
    dark.forEach((id, i) => (w.screens.get(id)!.lastPingAt = new Date(BOOT + (60 + i * 4) * SEC)));
  }

  it('one email at +10 min naming each screen, its organisation and its last check-in; nothing more at +20', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    darkAtBoot();
    // Their players keep trying and are refused on the socket…
    const retired = 'a-key-this-server-no-longer-holds-0123456789abcdef';
    for (let t = BOOT + 70 * SEC; t <= BOOT + TEN; t += 30 * SEC) {
      for (const id of dark) {
        const token = jwt.sign({ sub: id, deviceId: id, kind: 'device', ep: 3 }, retired, { expiresIn: '180d' });
        noteWsDeviceCredentialRefusal(undefined, 'jwt_invalid:invalid signature', token, t);
      }
    }
    // …while the units themselves are up (the Manager's anonymous update check).
    w.screens.get(uuid(3))!.managerVersionAt = new Date(BOOT + 8 * MIN);
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, dark);

    const ten = await svc.check(TEN);
    expect(ten.status).toBe('alerted');
    expect(ten.verdict).toMatchObject({ cohort: 34, expected: 34, alert: true });
    expect(ten.verdict!.missing.map((m) => m.id)).toEqual(dark);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = mailer.sendAlert.mock.calls[0] as unknown as [string, string, string];
    expect(kind).toBe('ALERT_POST_RESTART_FLEET_CHECK');
    expect(subject).toBe('[VenueOS] After the API restart, 14 of 34 screens are not back (5 organisations) — +10 min');
    expect(body).toContain('The API restarted at 2026-10-23 05:42Z');
    expect(body).toContain('14 have not checked in since the restart');
    expect(body).toContain('Fixture District › Fixture School A › Fixture Screen 6');
    expect(body).toContain(`Fixture Gym › Fixture Screen 2 [${uuid(2)}] — last check-in 2026-10-23 05:43Z (9 min ago)`);
    expect(body).not.toContain('1-hour credential —'); // no zero-count lines
    expect(body).toContain('the unit itself is up (version report 2026-10-23 05:50Z)');
    expect(body).toContain('device credential refused: websocket (signature no current key verifies)');
    for (const n of [15, 16, 34]) expect(body).not.toContain(`Fixture Screen ${n} [`);
    // Never a token, a fingerprint or a key.
    expect(body).not.toMatch(/fixture-fingerprint|eyJ|no-longer-holds/);

    clock.now = BOOT + TWENTY;
    keepCheckingIn(w, clock.now, dark);
    expect((await svc.check(TWENTY)).status).toBe('already-alerted');
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('a slow outage the +10 check could not yet see is caught at +20', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, dark.slice(0, 2)); // only 2 dark at +10
    expect((await svc.check(TEN)).status).toBe('ok');
    clock.now = BOOT + TWENTY;
    keepCheckingIn(w, clock.now, dark.slice(0, 6));
    // These 4 checked in last 4 minutes after the boot and then nothing.
    for (const id of dark.slice(2, 6)) w.screens.get(id)!.lastPingAt = new Date(BOOT + 4 * MIN);
    expect((await svc.check(TWENTY)).status).toBe('alerted');
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('screens that came back on a 1-hour credential ("re-pair required" since the restart) are reported too', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now);
    for (const id of dark.slice(0, 6)) Object.assign(w.screens.get(id)!, { authState: 'REPAIR_REQUIRED', authStateChangedAt: new Date(BOOT + 75 * SEC) });
    const ten = await svc.check(TEN);
    expect(ten.status).toBe('alerted');
    expect(ten.verdict!.downgraded).toHaveLength(6);
    const body = (mailer.sendAlert.mock.calls[0] as unknown as [string, string])[1];
    expect(body).toContain('6 checked in, but only on a 1-hour credential');
    expect(body).toContain('Back, but on a 1-hour credential');
  });
});

describe('a screen that is MEANT to be off is not missing', () => {
  // 21:58 in Chicago: an on/off schedule switches the screens off at 22:00.
  const BOOT_LATE = Date.parse('2026-10-23T02:58:00Z');

  it('switched off by its on/off schedule two minutes after the deploy → excused, no alert', async () => {
    w = makeWorld();
    seed(w, BOOT_LATE);
    // One row per organisation: a schedule governs its own tenant's screens only (2026-10-25).
    for (const tenantId of ['school-a', 'school-b', 'gym', 'cafe', 'arena', 'office']) {
      w.displaySchedules.push({
        id: `ds-${tenantId}`,
        tenantId,
        screenId: null,
        screenGroupId: null,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        onTime: '07:00',
        offTime: '22:00',
        timezone: 'America/Chicago',
        isActive: true,
      });
    }
    const off = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)];
    const { svc, mailer, clock } = build(w, BOOT_LATE);
    await svc.snapshot();
    clock.now = BOOT_LATE + TEN;
    keepCheckingIn(w, clock.now, off);
    for (const id of off) w.screens.get(id)!.lastPingAt = new Date(BOOT_LATE + 2.5 * MIN);
    const ten = await svc.check(TEN);
    expect(ten.status).toBe('ok');
    expect(ten.verdict!.excused).toEqual({ 'display-schedule-off': 5 });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('…and the same five without a schedule ARE an alarm (the control)', async () => {
    w = makeWorld();
    seed(w, BOOT_LATE);
    const off = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)];
    const { svc, mailer, clock } = build(w, BOOT_LATE);
    await svc.snapshot();
    clock.now = BOOT_LATE + TEN;
    keepCheckingIn(w, clock.now, off);
    for (const id of off) w.screens.get(id)!.lastPingAt = new Date(BOOT_LATE + 2.5 * MIN);
    expect((await svc.check(TEN)).status).toBe('alerted');
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('remote power-off just before the deploy → excused', async () => {
    const off = [uuid(1), uuid(2), uuid(3)];
    for (const id of off) {
      w.auditLogs.push({ targetId: id, action: 'SCREEN_DISPLAY_CONTROL', details: JSON.stringify({ requested: 'POWER_OFF' }), createdAt: new Date(BOOT - 2 * MIN) });
    }
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, off);
    const ten = await svc.check(TEN);
    expect(ten.verdict!.excused).toEqual({ 'remote-power-off': 3 });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('Android standby (the panel reported itself asleep as it went quiet) → excused', async () => {
    const off = [uuid(1), uuid(2), uuid(3)];
    for (const id of off) {
      Object.assign(w.screens.get(id)!, {
        lastPingAt: new Date(BOOT + 30 * SEC),
        nativeRuntimeReportAt: new Date(BOOT + 30 * SEC),
        nativeRuntimeReport: { schema: 1, interactive: false, foreground: false, standbySinceMs: null, elapsedRealtimeMs: 1000, powerOnAck: null },
      });
    }
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, off);
    const ten = await svc.check(TEN);
    expect(ten.verdict!.excused).toEqual({ standby: 3 });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });
});

describe('never guessed', () => {
  it('the platform health monitor reports the database / signer down → skipped', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    reportPlatformComponent('platform', 'critical', clock.now);
    expect(await svc.check(TEN)).toMatchObject({ status: 'skipped', reason: 'platform-critical' });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('the on/off-schedule facts cannot be read → skipped (an unknown schedule might have been an off one)', async () => {
    const { svc, mailer, clock } = build(w);
    await svc.snapshot();
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, [uuid(1), uuid(2), uuid(3), uuid(4)]);
    w.fail.schedules = true;
    expect(await svc.check(TEN)).toMatchObject({ status: 'skipped', reason: 'intended-downtime-unreadable' });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('a boot snapshot that failed is retaken at the first check, with the same cohort', async () => {
    const { svc, mailer, clock } = build(w);
    w.fail.snapshot = 1;
    expect(await svc.snapshot()).toBeNull();
    const dark = [uuid(1), uuid(2), uuid(3)];
    for (const id of dark) w.screens.get(id)!.lastPingAt = new Date(BOOT + 70 * SEC);
    clock.now = BOOT + TEN;
    keepCheckingIn(w, clock.now, dark);
    const ten = await svc.check(TEN);
    expect(ten.status).toBe('alerted');
    expect(ten.verdict!.cohort).toBe(34);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('a screen paired AFTER the boot is not in the cohort', async () => {
    w.screens.set(uuid(99), { ...w.screens.get(uuid(1))!, id: uuid(99), pairedAt: new Date(BOOT + MIN), lastPingAt: new Date(BOOT + 2 * MIN) });
    const { svc } = build(w);
    expect(await svc.snapshot()).toBe(34);
  });
});

describe('one alert per deployment', () => {
  it('two replicas of the same deployment: only the first claim sends', async () => {
    process.env.RAILWAY_DEPLOYMENT_ID = 'dep-fixture';
    const claims = new Map<string, string>();
    const redis = {
      isConnected: () => true,
      publisher: {
        set: jest.fn(async (k: string, v: string) => (claims.has(k) ? null : (claims.set(k, v), 'OK'))),
        smembers: jest.fn(async () => []),
        sadd: jest.fn(async () => 1),
        pexpire: jest.fn(async () => 1),
      },
    };
    const dark = [uuid(1), uuid(2), uuid(3)];
    for (const id of dark) w.screens.get(id)!.lastPingAt = new Date(BOOT + 70 * SEC);
    const a = build(w, BOOT, redis);
    const b = build(w, BOOT + 4 * SEC, redis);
    await a.svc.snapshot();
    await b.svc.snapshot();
    a.clock.now = b.clock.now = BOOT + TEN + 5 * SEC;
    keepCheckingIn(w, a.clock.now, dark);
    expect((await a.svc.check(TEN)).status).toBe('alerted');
    expect((await b.svc.check(TEN)).status).toBe('already-alerted');
    expect(a.mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(b.mailer.sendAlert).not.toHaveBeenCalled();
    expect([...claims.keys()]).toEqual(['venueos:fleet-check:alerted:deploy:dep-fixture']);
  });
});

describe('kill switch + timers', () => {
  it('POST_RESTART_FLEET_CHECK_DISABLED=1 arms nothing; without it the snapshot and both checks are armed', () => {
    process.env.NODE_ENV = 'production';
    process.env.POST_RESTART_FLEET_CHECK_DISABLED = '1';
    const off = build(w).svc;
    off.onModuleInit();
    expect((off as any).timers).toHaveLength(0);
    delete process.env.POST_RESTART_FLEET_CHECK_DISABLED;
    const on = build(w).svc;
    (on as any).logger = { log: jest.fn(), warn: jest.fn() };
    on.onModuleInit();
    expect((on as any).timers).toHaveLength(3);
    on.onModuleDestroy();
    expect((on as any).timers).toHaveLength(0);
  });
});
