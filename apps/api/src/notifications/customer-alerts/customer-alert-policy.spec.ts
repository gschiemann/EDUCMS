/**
 * Customer alert emails — one test per rule that keeps an email from going
 * out (2026-10-23). The PR's suppression table names these tests.
 */
import {
  ALERT_RULES,
  ConsecutiveScans,
  effectivePowerCommand,
  intendedDowntime,
  isFlapping,
  lastPowerCommandOf,
  maintenanceReason,
  repeatsDailyDark,
  sharedProofStall,
  missedOnTime,
  noContentVerdict,
  orgHourlyLimit,
  platformClusterAround,
  platformGate,
  resolveAlertMode,
  type PowerEvidence,
  type ScreenFacts,
} from './customer-alert-policy';
import { lastOnTransitionAtOrBefore, otaWindowOf, parseOnWindow } from './schedule-windows';

const MIN = 60_000;
const NOW = Date.parse('2026-10-21T15:00:00Z'); // a Wednesday, 10:00 in Chicago

function facts(over: Partial<ScreenFacts> = {}): ScreenFacts {
  return {
    id: 's1',
    status: 'OFFLINE',
    tenantId: 't1',
    pairedAt: new Date(NOW - 30 * 24 * 60 * MIN),
    lastPingAt: new Date(NOW - 20 * MIN),
    nativeRuntimeReport: null,
    nativeRuntimeReportAt: null,
    credentialEpochRotatedAt: new Date(NOW - 3 * 24 * 60 * MIN),
    lastOtaAt: null,
    lastOtaState: null,
    forceApkUpdatePendingAt: null,
    forceApkUpdateHold: null,
    displayWindows: [],
    otaWindow: null,
    lastPowerCommand: null,
    lastMaintenanceAt: null,
    ...over,
  };
}
const start = NOW - 20 * MIN;
/** A well-formed native runtime report (screens/native-runtime.ts). */
const report = (interactive: boolean) => ({ schema: 1, interactive, foreground: !interactive, standbySinceMs: null, elapsedRealtimeMs: 1000, powerOnAck: null });

describe('mode + kill switch', () => {
  it('defaults to SHADOW; an unknown value is shadow, never on', () => {
    expect(resolveAlertMode({})).toBe('shadow');
    expect(resolveAlertMode({ CUSTOMER_ALERT_EMAILS_MODE: 'ON ' })).toBe('on');
    expect(resolveAlertMode({ CUSTOMER_ALERT_EMAILS_MODE: 'off' })).toBe('off');
    expect(resolveAlertMode({ CUSTOMER_ALERT_EMAILS_MODE: 'yes please' })).toBe('shadow');
  });
  it('CUSTOMER_ALERT_EMAILS_DISABLED=1 beats every mode', () => {
    expect(resolveAlertMode({ CUSTOMER_ALERT_EMAILS_DISABLED: '1', CUSTOMER_ALERT_EMAILS_MODE: 'on' })).toBe('off');
    expect(resolveAlertMode({ CUSTOMER_ALERT_EMAILS_DISABLED: 'true', CUSTOMER_ALERT_EMAILS_MODE: 'on' })).toBe('off');
  });
  it('the hourly limit is 6 unless a sane override is set', () => {
    expect(orgHourlyLimit({})).toBe(6);
    expect(orgHourlyLimit({ CUSTOMER_ALERT_EMAILS_PER_HOUR: '3' })).toBe(3);
    expect(orgHourlyLimit({ CUSTOMER_ALERT_EMAILS_PER_HOUR: '0' })).toBe(6);
  });
});

describe('platform gate', () => {
  const ok = { uptimeMs: 60 * MIN, degradedComponents: [], platformQuietUntilMs: 0, nowMs: NOW };
  it('open when healthy', () => expect(platformGate(ok)).toEqual({ open: true }));
  it('API restart: closed for 15 min after boot', () => {
    expect(platformGate({ ...ok, uptimeMs: 14 * MIN })).toEqual({ open: false, reason: 'api-restart' });
    expect(platformGate({ ...ok, uptimeMs: 15 * MIN })).toEqual({ open: true });
  });
  it('platform degraded (storage / DB / realtime watchdog): closed', () => {
    expect(platformGate({ ...ok, degradedComponents: ['storage:degraded'] })).toEqual({ open: false, reason: 'platform-degraded' });
  });
  it('inside a platform-incident quiet window: closed', () => {
    expect(platformGate({ ...ok, platformQuietUntilMs: NOW + MIN })).toEqual({ open: false, reason: 'platform-incident' });
  });
});

describe('intended downtime — every reason defers', () => {
  it('a normal offline screen: no reason', () => expect(intendedDowntime(facts(), 'OFFLINE', start, NOW)).toBeNull());
  it('unpaired / revoked / pending', () => {
    expect(intendedDowntime(facts({ status: 'REVOKED' }), 'OFFLINE', start, NOW)).toBe('unpaired');
    expect(intendedDowntime(facts({ status: 'PENDING' }), 'OFFLINE', start, NOW)).toBe('unpaired');
    expect(intendedDowntime(facts({ tenantId: null }), 'OFFLINE', start, NOW)).toBe('unpaired');
  });
  it('never online in the last 24 h (unused / unboxed)', () => {
    expect(intendedDowntime(facts({ lastPingAt: new Date(NOW - 25 * 60 * MIN) }), 'OFFLINE', start, NOW)).toBe('not-recently-used');
    expect(intendedDowntime(facts({ lastPingAt: null }), 'OFFLINE', start, NOW)).toBe('not-recently-used');
  });
  it('paired less than 2 h before the problem (still being installed)', () => {
    expect(intendedDowntime(facts({ pairedAt: new Date(start - 30 * MIN) }), 'OFFLINE', start, NOW)).toBe('just-installed');
  });
  it('remote power-off / blank that was not followed by a power-on', () => {
    expect(
      intendedDowntime(facts({ lastPowerCommand: { state: 'off', at: new Date(NOW - 3 * 60 * MIN) } }), 'OFFLINE', start, NOW),
    ).toBe('remote-power-off');
    expect(
      intendedDowntime(facts({ lastPowerCommand: { state: 'on', at: new Date(NOW - 3 * 60 * MIN) } }), 'OFFLINE', start, NOW),
    ).toBeNull();
  });
  it('standby: Android said the panel was asleep in its last report before going quiet', () => {
    const at = new Date(NOW - 21 * MIN);
    expect(
      intendedDowntime(facts({ nativeRuntimeReport: report(false), nativeRuntimeReportAt: at }), 'OFFLINE', start, NOW),
    ).toBe('standby');
    expect(
      intendedDowntime(facts({ nativeRuntimeReport: report(true), nativeRuntimeReportAt: at }), 'OFFLINE', start, NOW),
    ).toBeNull();
  });
  it('standby (no-content): a fresh asleep report', () => {
    expect(
      intendedDowntime(
        facts({ nativeRuntimeReport: report(false), nativeRuntimeReportAt: new Date(NOW - MIN) }),
        'NO_CONTENT',
        start,
        NOW,
      ),
    ).toBe('standby');
  });
  it('inside its on/off schedule OFF window', () => {
    // On 07:00–09:00 Chicago weekdays → 10:00 Chicago is OFF.
    const w = parseOnWindow({ daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '09:00', timezone: 'America/Chicago' })!;
    expect(intendedDowntime(facts({ displayWindows: [w] }), 'OFFLINE', start, NOW)).toBe('display-schedule-off');
  });
  it('within 30 min after the schedule switched it back on (still waking)', () => {
    // On from 09:45 Chicago = 15 min ago; the 30-min-ago sample was OFF.
    const w = parseOnWindow({ daysOfWeek: [3], onTime: '09:45', offTime: '22:00', timezone: 'America/Chicago' })!;
    expect(intendedDowntime(facts({ displayWindows: [w] }), 'OFFLINE', start, NOW)).toBe('display-schedule-off');
    // …but 31+ min after the on-time, a dark screen IS a problem.
    const early = parseOnWindow({ daysOfWeek: [3], onTime: '08:00', offTime: '22:00', timezone: 'America/Chicago' })!;
    expect(intendedDowntime(facts({ displayWindows: [early] }), 'OFFLINE', start, NOW)).toBeNull();
  });
  it('inside the tenant player-update window (nightly update / vendor reboot)', () => {
    const w = otaWindowOf({ otaWindowStart: '09:30', otaWindowEnd: '11:00', otaWindowTimezone: 'America/Chicago' })!;
    expect(intendedDowntime(facts({ otaWindow: w }), 'OFFLINE', start, NOW)).toBe('update-window');
    const night = otaWindowOf({ otaWindowStart: '02:00', otaWindowEnd: '04:00', otaWindowTimezone: 'America/Chicago' })!;
    expect(intendedDowntime(facts({ otaWindow: night }), 'OFFLINE', start, NOW)).toBeNull();
  });
  it('a reboot / update / relaunch in the last 30 min', () => {
    expect(intendedDowntime(facts({ lastMaintenanceAt: new Date(NOW - 10 * MIN) }), 'OFFLINE', start, NOW)).toBe('maintenance');
    expect(intendedDowntime(facts({ lastMaintenanceAt: new Date(NOW - 40 * MIN) }), 'OFFLINE', start, NOW)).toBeNull();
    expect(intendedDowntime(facts({ forceApkUpdatePendingAt: new Date(NOW - 5 * MIN) }), 'OFFLINE', start, NOW)).toBe('maintenance');
    expect(
      intendedDowntime(facts({ lastOtaAt: new Date(NOW - 5 * MIN), lastOtaState: 'INSTALLING' }), 'OFFLINE', start, NOW),
    ).toBe('maintenance');
  });
  it('no-content: a page that booted in the last 30 min has not proved anything yet', () => {
    expect(intendedDowntime(facts({ credentialEpochRotatedAt: new Date(NOW - 2 * MIN) }), 'NO_CONTENT', start, NOW)).toBe('maintenance');
  });
});

describe('online but not showing content — narrow on purpose', () => {
  const at = new Date(NOW - 25 * MIN);
  it('not-painting (red chip) and "Content unavailable" are blanks', () => {
    expect(noContentVerdict('not-painting', at)).toEqual({ blank: true, signal: 'stale-proof', sinceMs: at.getTime() });
    expect(noContentVerdict('content-unavailable', at)).toEqual({ blank: true, signal: 'content-unavailable' });
  });
  it('never a blank: older player (unknown), chronic, in-progress, idle, paused, credential, alert grades', () => {
    for (const g of [
      'unknown',
      'stale-chronic',
      'checking',
      'downloading',
      'content-loading',
      'connecting',
      'idle',
      'paused',
      'repair-required',
      'media-stalled',
      'alert-unconfirmed',
      'alert-not-painted',
      'painting',
      'offline',
    ] as const) {
      expect([g, noContentVerdict(g, at)]).toEqual([g, { blank: false }]);
    }
  });
});

describe('platform incident ≠ customer incident', () => {
  const ev = (screenId: string, orgId: string, dMin = 0) => ({ screenId, orgId, startedAtMs: NOW + dMin * MIN });
  it('3 organisations at once → platform incident', () => {
    expect(platformClusterAround(NOW, [ev('a', 'o1'), ev('b', 'o2', 2), ev('c', 'o3', -3)], 1000).incident).toBe(true);
  });
  it('2 organisations and ≥ 30% of the recently-active fleet → platform incident', () => {
    const events = [...Array.from({ length: 6 }, (_, i) => ev(`a${i}`, 'o1')), ...Array.from({ length: 4 }, (_, i) => ev(`b${i}`, 'o2'))];
    expect(platformClusterAround(NOW, events, 30).incident).toBe(true);
    expect(platformClusterAround(NOW, events, 100).incident).toBe(false);
  });
  it('ONE organisation, however large, is the customer’s own incident', () => {
    const events = Array.from({ length: 50 }, (_, i) => ev(`a${i}`, 'o1'));
    expect(platformClusterAround(NOW, events, 60).incident).toBe(false);
  });
  it('problems more than 5 minutes apart are not the same moment', () => {
    expect(platformClusterAround(NOW, [ev('a', 'o1'), ev('b', 'o2', 6), ev('c', 'o3', -6)], 1000).incident).toBe(false);
  });
});

describe('two consecutive scans', () => {
  it('needs two scans in a row; one good scan in between starts over', () => {
    const c = new ConsecutiveScans();
    c.observe(['a'], NOW);
    expect(c.confirmed('a')).toBe(false);
    c.observe(['a'], NOW + MIN);
    expect(c.confirmed('a')).toBe(true);
    c.observe([], NOW + 2 * MIN);
    c.observe(['a'], NOW + 3 * MIN);
    expect(c.confirmed('a')).toBe(false);
    expect(c.since('a')).toBe(NOW + 3 * MIN);
  });
});

describe('flap protection', () => {
  it('at most one problem email per screen per 6 h', () => {
    expect(isFlapping(new Date(NOW - 5 * 60 * MIN), NOW)).toBe(true);
    expect(isFlapping(new Date(NOW - ALERT_RULES.FLAP_WINDOW_MS - 1), NOW)).toBe(false);
    expect(isFlapping(null, NOW)).toBe(false);
  });
});

describe('remote power command from the display-control audit trail', () => {
  const row = (requested: string, dMin: number) => ({ details: JSON.stringify({ requested }), createdAt: new Date(NOW - dMin * MIN) });
  it('newest power-relevant command wins; volume etc. are ignored', () => {
    expect(lastPowerCommandOf([row('SET_VOLUME', 1), row('POWER_OFF', 10), row('WAKE', 60)])).toMatchObject({ state: 'off' });
    expect(lastPowerCommandOf([row('POWER_ON', 1), row('BLANK', 10)])).toMatchObject({ state: 'on' });
    expect(lastPowerCommandOf([{ details: 'not json', createdAt: new Date(NOW) }])).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2026-10-25 — the owner's two new rules (shadow mode, owner-only).
// ═════════════════════════════════════════════════════════════════════════

/** Brookfield's weekday group, as production stores it: Mon–Fri 07:00–18:00 Los Angeles. */
const weekday = parseOnWindow({ daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '18:00', timezone: 'America/Los_Angeles' })!;
const daily = parseOnWindow({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '07:00', offTime: '18:00', timezone: 'America/Los_Angeles' })!;
const PDT = (iso: string) => Date.parse(`${iso}-07:00`);

describe('the schedule’s switch-on moments', () => {
  it('Monday 07:00 Los Angeles is the switch-on after a weekend; the previous one is Friday 07:00', () => {
    const on = lastOnTransitionAtOrBefore([weekday], PDT('2026-10-26T07:16:00'));
    expect(on).toEqual({ atMs: PDT('2026-10-26T07:00:00'), timeZone: 'America/Los_Angeles' });
    expect(lastOnTransitionAtOrBefore([weekday], on!.atMs - 1)?.atMs).toBe(PDT('2026-10-23T07:00:00'));
  });
  it('a window opening inside another one is not a switch-on', () => {
    const late = parseOnWindow({ daysOfWeek: [1], onTime: '09:00', offTime: '20:00', timezone: 'America/Los_Angeles' })!;
    expect(lastOnTransitionAtOrBefore([weekday, late], PDT('2026-10-26T09:30:00'))?.atMs).toBe(PDT('2026-10-26T07:00:00'));
  });
  it('no windows → none', () => expect(lastOnTransitionAtOrBefore([], NOW)).toBeNull());
});

describe('Rule 1 — "didn’t come back on at its scheduled on time"', () => {
  it('G24 (production): dark Saturday 01:32, still dark at Monday 07:16 → a problem that started at Monday 07:00', () => {
    expect(missedOnTime([weekday], PDT('2026-10-24T01:32:59'), PDT('2026-10-26T07:16:00'))).toEqual({
      onAtMs: PDT('2026-10-26T07:00:00'),
      timeZone: 'America/Los_Angeles',
      previousOnAtMs: PDT('2026-10-23T07:00:00'),
    });
  });
  it('…but NOT all weekend: the schedule has it off, there is no switch-on since it went dark', () => {
    expect(missedOnTime([weekday], PDT('2026-10-24T01:32:59'), PDT('2026-10-25T12:00:00'))).toBeNull();
  });
  it('dark for a week in a scheduled group → never (last seen before the previous switch-on)', () => {
    expect(missedOnTime([daily], PDT('2026-10-19T10:00:00'), PDT('2026-10-26T07:16:00'))).toBeNull();
  });
  it('died in the last minutes of the ON window, not back at the next switch-on → a problem from the switch-on', () => {
    expect(missedOnTime([daily], PDT('2026-10-25T17:55:00'), PDT('2026-10-26T07:20:00'))?.onAtMs).toBe(PDT('2026-10-26T07:00:00'));
  });
  it('checked in since the switch-on → not this rule (the normal one applies)', () => {
    expect(missedOnTime([daily], PDT('2026-10-26T07:03:00'), PDT('2026-10-26T07:30:00'))).toBeNull();
  });
  it('the window that opened has closed again → not meant to be on now', () => {
    const short = parseOnWindow({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '07:00', offTime: '07:10', timezone: 'America/Los_Angeles' })!;
    expect(missedOnTime([short], PDT('2026-10-26T02:00:00'), PDT('2026-10-26T07:16:00'))).toBeNull();
  });
  it('no schedule → never', () => expect(missedOnTime([], NOW - 3 * 60 * MIN, NOW)).toBeNull());

  it('intendedDowntime judges it from the switch-on: not "unused" after a 2-day weekend, not "still waking", not stale standby', () => {
    const now = PDT('2026-10-26T07:16:00');
    const onAt = PDT('2026-10-26T07:00:00');
    const g24 = facts({
      lastPingAt: new Date(PDT('2026-10-24T01:32:59')),
      displayWindows: [weekday],
      nativeRuntimeReport: report(false),
      nativeRuntimeReportAt: new Date(PDT('2026-10-24T01:32:00')),
    });
    expect(intendedDowntime(g24, 'OFFLINE', onAt, now, 'missed-on-time')).toBeNull();
    // The same facts judged the old way: excused three times over.
    expect(intendedDowntime(g24, 'OFFLINE', PDT('2026-10-24T01:32:59'), now)).toBe('not-recently-used');
    // Every other rail still applies — a remote power-off still in force, an update window, a reboot.
    expect(intendedDowntime({ ...g24, lastPowerCommand: { state: 'off', at: new Date(onAt + 2 * MIN) } }, 'OFFLINE', onAt, now, 'missed-on-time')).toBe(
      'remote-power-off',
    );
    expect(intendedDowntime({ ...g24, lastMaintenanceAt: new Date(onAt + MIN) }, 'OFFLINE', onAt, now, 'missed-on-time')).toBe('maintenance');
    expect(intendedDowntime({ ...g24, pairedAt: new Date(onAt - 30 * MIN) }, 'OFFLINE', onAt, now, 'missed-on-time')).toBe('just-installed');
  });

  it('a platform incident needs at least one screen that really DROPPED: same-minute switch-ons alone are not one', () => {
    const at = PDT('2026-10-26T07:00:00');
    const scheduled = ['o1', 'o2', 'o3'].map((orgId, i) => ({ screenId: `s${i}`, orgId, startedAtMs: at, scheduled: true }));
    expect(platformClusterAround(at, scheduled, 1000).incident).toBe(false);
    expect(platformClusterAround(at, [...scheduled, { screenId: 'riot', orgId: 'o4', startedAtMs: at - 2 * MIN }], 1000).incident).toBe(true);
  });
});

describe('Rule 2 — a remote power-off excuses a screen only while it is really off by our command', () => {
  const T = PDT('2026-10-26T10:00:00');
  const AT = new Date(T);
  const row = (requested: string, dMin: number, extra: Record<string, unknown> = {}) => ({
    details: JSON.stringify({ requested, ...extra }),
    createdAt: new Date(T + dMin * MIN),
  });
  const off = { state: 'off' as const, at: AT, verb: 'POWER_OFF' as const };
  const evidence = (over: Partial<PowerEvidence> = {}): PowerEvidence => ({
    nowMs: T + 60 * MIN,
    displayWindows: [],
    lastRenderedAt: null,
    credentialEpochRotatedAt: null,
    nativeRuntimeReport: null,
    nativeRuntimeReportAt: null,
    ...over,
  });
  /** A stored native report (screens/native-runtime.ts shape) with its own blank / wake record (device ms). */
  const native = (interactive: boolean | null, extra: Record<string, unknown> = {}) => ({
    schema: 1,
    interactive,
    foreground: true,
    standbySinceMs: null,
    elapsedRealtimeMs: 1000,
    powerOnAck: null,
    ...extra,
  });

  it('a REFUSED or UNDELIVERED power-off never excuses (the one before it still stands)', () => {
    expect(lastPowerCommandOf([row('POWER_OFF', 0, { outcome: 'refused' })])).toBeNull();
    expect(lastPowerCommandOf([row('POWER_OFF', 0, { outcome: 'undelivered' })])).toBeNull();
    expect(lastPowerCommandOf([row('POWER_OFF', 0, { outcome: 'refused' }), row('POWER_ON', -60, { outcome: 'dispatched' })])).toMatchObject({
      state: 'on',
    });
    expect(lastPowerCommandOf([row('POWER_ON', 0, { outcome: 'refused' }), row('POWER_OFF', -60, { outcome: 'dispatched' })])).toMatchObject({
      state: 'off',
      verb: 'POWER_OFF',
    });
  });
  it('a dispatched row voided by its own "undelivered" correction (the publish threw) never excuses', () => {
    const rows = [
      row('POWER_OFF', 0, { outcome: 'undelivered', actionId: 'a1' }),
      row('POWER_OFF', 0, { outcome: 'dispatched', actionId: 'a1' }),
    ];
    expect(lastPowerCommandOf(rows)).toBeNull();
  });
  it('a row from before `outcome` existed still counts as sent', () => {
    expect(lastPowerCommandOf([row('POWER_OFF', 0)])).toMatchObject({ state: 'off', verb: 'POWER_OFF' });
  });

  it('M43 (production replay): POWER_OFF on 10-11, its daily schedule has switched it on every morning since → NOT in force', () => {
    const m43 = evidence({
      nowMs: Date.parse('2026-10-26T03:21:00Z'),
      displayWindows: [daily],
      lastRenderedAt: new Date('2026-10-26T03:20:59Z'),
      nativeRuntimeReportAt: new Date('2026-10-26T03:07:35Z'),
      // As stored: the schedule's own vendor-backlight blank at 18:00, Android awake.
      nativeRuntimeReport: native(true, { sleep: { blank: 'vendor-backlight', last: { m: 'vendor-backlight', o: 'off', at: 1792976400176 } } }),
    });
    expect(effectivePowerCommand({ state: 'off', at: new Date('2026-10-11T18:31:00Z'), verb: 'POWER_OFF' }, m43)).toBeNull();
  });
  it('L55VEC (production replay): POWER_OFF on 10-12, switched on by its schedule since (its own wake record says so too) → NOT in force', () => {
    const l55 = evidence({
      nowMs: Date.parse('2026-10-26T03:21:30Z'),
      displayWindows: [daily],
      lastRenderedAt: new Date('2026-10-26T02:57:09Z'),
      nativeRuntimeReportAt: new Date('2026-10-26T03:21:18Z'),
      nativeRuntimeReport: native(false, {
        wake: { src: 'schedule-on', reqAt: 1792936800083, onAt: 1792936800083, n: 0, out: 'on-glass' },
        sleep: { blank: 'vendor-backlight', last: { m: 'vendor-backlight', o: 'off', at: 1792983424821 } },
      }),
    });
    expect(effectivePowerCommand({ state: 'off', at: new Date('2026-10-12T00:38:00Z'), verb: 'POWER_OFF' }, l55)).toBeNull();
  });

  it('an ACCEPTED power-off with no wake is still excused — even while the page keeps painting behind the dark backlight', () => {
    const e = evidence({
      lastRenderedAt: new Date(T + 59 * MIN),
      nativeRuntimeReportAt: new Date(T + 58 * MIN),
      nativeRuntimeReport: native(true, { sleep: { blank: 'vendor-backlight', last: { m: 'vendor-backlight', o: 'off', at: T + 5_000 } } }),
    });
    expect(effectivePowerCommand(off, e)).toBe(off);
  });
  it('accepted, and Android reports asleep → still excused', () => {
    expect(effectivePowerCommand(off, evidence({ nativeRuntimeReportAt: new Date(T + 30 * MIN), nativeRuntimeReport: native(false) }))).toBe(off);
  });
  it('the panel’s own record says the blank did not take → NOT excused', () => {
    const e = evidence({
      nativeRuntimeReportAt: new Date(T + 30 * MIN),
      nativeRuntimeReport: native(true, { sleep: { last: { m: 'device-admin', o: 'kept-on', at: T + 4_000 } } }),
    });
    expect(effectivePowerCommand(off, e)).toBeNull();
  });
  it('woken after our blank (remote power key, dashboard, schedule) → NOT excused; an emergency wake re-blanks after the all-clear → still excused', () => {
    const woke = (src: string) =>
      evidence({
        nativeRuntimeReportAt: new Date(T + 30 * MIN),
        nativeRuntimeReport: native(true, {
          sleep: { last: { m: 'vendor-backlight', o: 'off', at: T + 5_000 } },
          wake: { src, reqAt: T + 20 * MIN, onAt: T + 20 * MIN + 500, n: 0, out: 'on-glass' },
        }),
      });
    expect(effectivePowerCommand(off, woke('screen-on'))).toBeNull();
    expect(effectivePowerCommand(off, woke('emergency'))).toBe(off);
  });
  it('awake with no blank recorded since the command → it never went dark → NOT excused', () => {
    expect(effectivePowerCommand(off, evidence({ nativeRuntimeReportAt: new Date(T + 30 * MIN), nativeRuntimeReport: native(true) }))).toBeNull();
  });
  it('no native word (browser player, older APK): page proof long after the command → NOT excused; proof that stopped → excused', () => {
    expect(effectivePowerCommand(off, evidence({ lastRenderedAt: new Date(T + 20 * MIN) }))).toBeNull();
    expect(effectivePowerCommand(off, evidence({ lastRenderedAt: new Date(T + 20_000) }))).toBe(off);
  });
  it('the soft BLANK overlay: a page boot since → NOT excused (a reload fails bright); page proof alone never ends it', () => {
    const blank = { state: 'off' as const, at: AT, verb: 'BLANK' as const };
    expect(effectivePowerCommand(blank, evidence({ credentialEpochRotatedAt: new Date(T + 10 * MIN) }))).toBeNull();
    expect(effectivePowerCommand(blank, evidence({ lastRenderedAt: new Date(T + 50 * MIN) }))).toBe(blank);
  });
  it('a schedule switch-on after the command ends it; one before the command does not', () => {
    const now = PDT('2026-10-27T08:00:00');
    expect(effectivePowerCommand(off, evidence({ nowMs: now, displayWindows: [daily] }))).toBeNull();
    expect(effectivePowerCommand(off, evidence({ nowMs: PDT('2026-10-26T15:00:00'), displayWindows: [daily] }))).toBe(off);
  });
  it('14 days is the upper bound', () => {
    expect(effectivePowerCommand(off, evidence({ nowMs: T + 14 * 24 * 60 * MIN + MIN }))).toBeNull();
  });
  it('an explicit on is passed through untouched', () => {
    const on = { state: 'on' as const, at: AT };
    expect(effectivePowerCommand(on, evidence())).toBe(on);
    expect(effectivePowerCommand(null, evidence())).toBeNull();
  });
});


// --- 2026-10-31 accuracy pass: each case is cut from a real production row shape ---

describe('maintenance is judged against the DROP, not against the decision (OTA 1.1.55 rollout)', () => {
  // The screen's last check-in (= the drop) was 20 min before NOW; the decision
  // is made after 15 min + two scans, so an install that ran 20 min before the
  // drop is 40 min old at decision time, outside the old "last 30 min" test.
  const dropAt = NOW - 20 * MIN;
  it('an update install 20 min before the drop still explains it (2 h settle)', () => {
    const f = facts({ maintenanceTimes: [new Date(dropAt - 20 * MIN)], lastMaintenanceAt: new Date(dropAt - 20 * MIN) });
    expect(intendedDowntime(f, 'OFFLINE', dropAt, NOW)).toBe('maintenance');
  });
  it('a relaunch 10 min AFTER the drop (the install killed the app) explains it too', () => {
    const f = facts({ maintenanceTimes: [new Date(dropAt + 10 * MIN)] });
    expect(maintenanceReason(f, 'OFFLINE', dropAt, NOW)).toBe('maintenance');
  });
  it('but only for 2 h after the event: a screen that did not come back is judged as any outage', () => {
    const ev = new Date(NOW - 2 * 60 * MIN - MIN);
    const f = facts({ maintenanceTimes: [ev] });
    expect(maintenanceReason(f, 'OFFLINE', ev.getTime() - 5 * MIN, NOW)).toBeNull();
  });
  it('and an event far from the drop (rebooted at 09:13, dropped at noon) explains nothing', () => {
    const f = facts({ maintenanceTimes: [new Date(dropAt - 3 * 60 * MIN)] });
    expect(maintenanceReason(f, 'OFFLINE', dropAt, NOW)).toBeNull();
  });
  it('the dashboard and the email give the same answer for the same facts', () => {
    const f = facts({ maintenanceTimes: [new Date(dropAt - 20 * MIN)] });
    expect(maintenanceReason(f, 'OFFLINE', dropAt, NOW)).toBe(intendedDowntime(f, 'OFFLINE', dropAt, NOW));
  });
});

describe('the usual nightly dark spell is not an outage (venue closes, outlet timer)', () => {
  const H = 60 * MIN;
  // Real shape: dark ~21:20Z, back ~10:36Z next morning (13 h 16 min), every day.
  const prev = { open: false, reason: null, startedAt: new Date(NOW - 24 * H), closedAt: new Date(NOW - 24 * H + 13 * H + 16 * MIN) };
  const drop = NOW - 20 * MIN;
  it("same time of day as yesterday's spell is excused", () => {
    expect(repeatsDailyDark(prev, drop, NOW)).toBe(true);
    expect(intendedDowntime(facts({ offlineHistory: prev }), 'OFFLINE', drop, NOW)).toBe('daily-pattern');
  });
  it('a pattern two days back (nobody looked yesterday) still counts', () => {
    expect(repeatsDailyDark({ ...prev, startedAt: new Date(NOW - 48 * H), closedAt: new Date(NOW - 48 * H + 13 * H) }, drop, NOW)).toBe(true);
  });
  it('a different time of day (3 h apart) is a NEW problem', () => {
    expect(repeatsDailyDark({ ...prev, startedAt: new Date(NOW - 24 * H - 3 * H), closedAt: new Date(NOW - 24 * H + 10 * H) }, drop, NOW)).toBe(false);
  });
  it('a short blip yesterday (40 min) is not a pattern', () => {
    expect(repeatsDailyDark({ ...prev, closedAt: new Date(NOW - 24 * H + 40 * MIN) }, drop, NOW)).toBe(false);
  });
  it('excused only until it has run 2 h longer than the usual: a unit that does not return is an outage', () => {
    const lateDrop = NOW - (13 * H + 16 * MIN + 2 * H + MIN);
    expect(repeatsDailyDark({ ...prev, startedAt: new Date(lateDrop - 24 * H), closedAt: new Date(lateDrop - 24 * H + 13 * H + 16 * MIN) }, lateDrop, NOW)).toBe(false);
  });
  it('a missed-on-time or platform-incident row is a clock setting, never the pattern', () => {
    expect(repeatsDailyDark({ ...prev, reason: 'missed-on-time' }, drop, NOW)).toBe(false);
    expect(repeatsDailyDark({ ...prev, reason: 'platform-incident' }, drop, NOW)).toBe(false);
  });
  it('the spell already recognised (open, reason daily-pattern) keeps being excused; any other open row is not', () => {
    const open = { open: true, reason: 'daily-pattern', startedAt: new Date(drop), closedAt: null };
    expect(repeatsDailyDark(open, drop, NOW)).toBe(true);
    expect(repeatsDailyDark({ ...open, reason: 'flap' }, drop, NOW)).toBe(false);
  });
  it('no history: never excused (the first night is the only one that can email)', () => {
    expect(repeatsDailyDark(null, drop, NOW)).toBe(false);
    expect(intendedDowntime(facts(), 'OFFLINE', drop, NOW)).toBeNull();
  });
});

describe('picture proof that stopped on several screens at once is one cause, not N dead screens', () => {
  const at = NOW - 40 * MIN;
  it('7 screens of one organisation whose proof stopped within 11 s are all held back', () => {
    const problems = Array.from({ length: 7 }, (_, i) => ({ screenId: `s${i}`, orgId: 'o1', startedAtMs: at + i * 1_800 }));
    expect([...sharedProofStall(problems)].sort()).toEqual(problems.map((p) => p.screenId).sort());
  });
  it('two screens, or three spread over minutes, are independent and still emailed', () => {
    expect(sharedProofStall([{ screenId: 'a', orgId: 'o', startedAtMs: at }, { screenId: 'b', orgId: 'o', startedAtMs: at + 1_000 }]).size).toBe(0);
    expect(sharedProofStall([0, 5, 11].map((m, i) => ({ screenId: `s${i}`, orgId: 'o', startedAtMs: at + m * MIN }))).size).toBe(0);
  });
  it('three screens at the same second but in three different organisations are not a stall of one', () => {
    expect(sharedProofStall(['a', 'b', 'c'].map((o) => ({ screenId: o, orgId: o, startedAtMs: at }))).size).toBe(0);
  });
});
