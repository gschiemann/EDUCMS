/**
 * Down / resting / dormant (2026-10-24) — one test per rule that keeps an
 * offline screen OUT of the dashboard's red "Screens down" card.
 */
import type { ScreenFacts } from '../customer-alerts/customer-alert-policy';
import { otaWindowOf, parseOnWindow } from '../customer-alerts/schedule-windows';
import {
  ATTENTION_RULES,
  classifyOfflineScreen,
  dormantReason,
  isBrowserTestScreen,
  restingReason,
} from './screen-attention-policy';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.parse('2026-10-21T15:00:00Z'); // a Wednesday, 10:00 in Chicago

function facts(over: Partial<ScreenFacts> = {}): ScreenFacts {
  return {
    id: 's1',
    status: 'OFFLINE',
    tenantId: 't1',
    pairedAt: new Date(NOW - 60 * DAY),
    lastPingAt: new Date(NOW - 20 * MIN),
    nativeRuntimeReport: null,
    nativeRuntimeReportAt: null,
    credentialEpochRotatedAt: new Date(NOW - 3 * DAY),
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
const report = (interactive: boolean) => ({ schema: 1, interactive, foreground: !interactive, standbySinceMs: null, elapsedRealtimeMs: 1000, powerOnAck: null });
const android = { hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.54' };

describe('dormant — old news, never red', () => {
  it('the owner\'s "Test 1": an iPhone browser silent since Aug 6', () => {
    const test1 = { lastPingAt: new Date('2026-08-06T19:10:58Z'), hardwareModel: 'web', osInfo: 'iOS', playerVersion: null };
    expect(dormantReason(test1, NOW)).toBe('not-seen-30-days');
    expect(classifyOfflineScreen(test1, facts(), NOW)).toEqual({ bucket: 'dormant', reason: 'not-seen-30-days' });
  });
  it('any screen silent for more than 30 days', () => {
    expect(dormantReason({ ...android, lastPingAt: new Date(NOW - 31 * DAY) }, NOW)).toBe('not-seen-30-days');
    expect(dormantReason({ ...android, lastPingAt: new Date(NOW - 29 * DAY) }, NOW)).toBeNull();
  });
  it('a screen that never connected', () => {
    expect(dormantReason({ ...android, lastPingAt: null }, NOW)).toBe('never-connected');
  });
  it('a phone / tablet / Mac browser test screen after a day', () => {
    const phone = { lastPingAt: new Date(NOW - 2 * DAY), hardwareModel: 'web', osInfo: 'iOS', playerVersion: null };
    expect(dormantReason(phone, NOW)).toBe('test-screen');
    expect(dormantReason({ ...phone, lastPingAt: new Date(NOW - 2 * 60 * MIN) }, NOW)).toBeNull();
  });
  it('a PC, a Linux box or an Android TV box running a browser is a real installation', () => {
    for (const osInfo of ['Windows', 'Linux', 'Android']) {
      expect(isBrowserTestScreen({ lastPingAt: null, hardwareModel: null, osInfo, playerVersion: null })).toBe(false);
    }
    expect(isBrowserTestScreen({ lastPingAt: null, hardwareModel: 'web', osInfo: 'macOS', playerVersion: null })).toBe(true);
    // The player app reports a version: never a "test" screen.
    expect(isBrowserTestScreen({ lastPingAt: null, hardwareModel: 'web', osInfo: 'iOS', playerVersion: '1.1.54' })).toBe(false);
  });
  it('the window is 30 days', () => expect(ATTENTION_RULES.DORMANT_MS).toBe(30 * DAY));
});

describe('resting — off on purpose (the alert emails\' facts)', () => {
  const offline = { ...android, lastPingAt: new Date(NOW - 20 * MIN) };

  it('turned off from the dashboard', () => {
    const f = facts({ lastPowerCommand: { state: 'off', at: new Date(NOW - 2 * 60 * MIN) } });
    expect(restingReason(f, NOW)).toBe('remote-power-off');
    expect(classifyOfflineScreen(offline, f, NOW)).toEqual({ bucket: 'resting', reason: 'remote-power-off' });
  });
  it('turned back ON from the dashboard is not resting', () => {
    expect(restingReason(facts({ lastPowerCommand: { state: 'on', at: new Date(NOW - 60 * MIN) } }), NOW)).toBeNull();
  });
  it('the panel reported standby just before it went quiet', () => {
    const at = new Date(NOW - 21 * MIN);
    expect(restingReason(facts({ nativeRuntimeReport: report(false), nativeRuntimeReportAt: at }), NOW)).toBe('standby');
    expect(restingReason(facts({ nativeRuntimeReport: report(true), nativeRuntimeReportAt: at }), NOW)).toBeNull();
  });
  it('the on/off schedule says off right now', () => {
    const w = parseOnWindow({ daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '09:00', timezone: 'America/Chicago' })!;
    expect(restingReason(facts({ displayWindows: [w] }), NOW)).toBe('display-schedule-off');
  });
  it('the schedule turned it on 15 min ago: still waking (30-min grace)', () => {
    const w = parseOnWindow({ daysOfWeek: [3], onTime: '09:45', offTime: '22:00', timezone: 'America/Chicago' })!;
    expect(restingReason(facts({ displayWindows: [w] }), NOW)).toBe('display-schedule-off');
  });
  it('NOW is what counts: dark all night on the schedule and STILL dark mid-morning is down', () => {
    // On since 08:00 Chicago; it went quiet overnight (schedule off) and never came back.
    const w = parseOnWindow({ daysOfWeek: [3], onTime: '08:00', offTime: '22:00', timezone: 'America/Chicago' })!;
    const f = facts({ displayWindows: [w], lastPingAt: new Date(NOW - 14 * 60 * MIN) });
    expect(restingReason(f, NOW)).toBeNull();
    expect(classifyOfflineScreen({ ...android, lastPingAt: f.lastPingAt }, f, NOW)).toEqual({ bucket: 'down' });
  });
  it('inside the player-update window', () => {
    const w = otaWindowOf({ otaWindowStart: '09:30', otaWindowEnd: '11:00', otaWindowTimezone: 'America/Chicago' })!;
    expect(restingReason(facts({ otaWindow: w }), NOW)).toBe('update-window');
  });
  it('restarting: a reboot or an update in the last 30 minutes', () => {
    expect(restingReason(facts({ lastMaintenanceAt: new Date(NOW - 10 * MIN) }), NOW)).toBe('maintenance');
    expect(restingReason(facts({ lastMaintenanceAt: new Date(NOW - 40 * MIN) }), NOW)).toBeNull();
    expect(restingReason(facts({ lastOtaAt: new Date(NOW - 5 * MIN), lastOtaState: 'INSTALLING' }), NOW)).toBe('maintenance');
    expect(restingReason(facts({ forceApkUpdatePendingAt: new Date(NOW - 5 * MIN) }), NOW)).toBe('maintenance');
    // A HELD update is not an update in progress.
    expect(restingReason(facts({ forceApkUpdatePendingAt: new Date(NOW - 5 * MIN), forceApkUpdateHold: 'NEEDS_TAP' }), NOW)).toBeNull();
  });
});

describe('down — a real, recent outage', () => {
  it('nothing says it is meant to be off', () => {
    expect(classifyOfflineScreen({ ...android, lastPingAt: new Date(NOW - 20 * MIN) }, facts(), NOW)).toEqual({ bucket: 'down' });
  });
  it('the owner\'s Media Player: last power command POWER_ON, no schedule, silent a day → down', () => {
    const f = facts({ lastPingAt: new Date(NOW - DAY), lastPowerCommand: { state: 'on', at: new Date(NOW - 12 * DAY) } });
    expect(classifyOfflineScreen({ ...android, lastPingAt: f.lastPingAt }, f, NOW)).toEqual({ bucket: 'down' });
  });
  it('facts that could not be read never hide an outage', () => {
    expect(classifyOfflineScreen({ ...android, lastPingAt: new Date(NOW - 20 * MIN) }, null, NOW)).toEqual({ bucket: 'down' });
  });
});
