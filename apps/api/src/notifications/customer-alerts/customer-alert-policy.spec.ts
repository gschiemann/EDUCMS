/**
 * Customer alert emails — one test per rule that keeps an email from going
 * out (2026-10-23). The PR's suppression table names these tests.
 */
import {
  ALERT_RULES,
  ConsecutiveScans,
  intendedDowntime,
  isFlapping,
  lastPowerCommandOf,
  noContentVerdict,
  orgHourlyLimit,
  platformClusterAround,
  platformGate,
  resolveAlertMode,
  type ScreenFacts,
} from './customer-alert-policy';
import { otaWindowOf, parseOnWindow } from './schedule-windows';

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
