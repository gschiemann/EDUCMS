/**
 * "Sleeping" status — state → label mapping. The evidence is the SAME as the
 * Sleep / Awake buttons (sleep-awake.ts `observedState`) plus the on/off
 * schedule; a dark screen with no stated reason stays a problem.
 */
import { deriveScreenStatus, sleepingDescriptor, type OpsScreen } from '../screenOps';
import type { DisplayScheduleRow } from '@/components/dashboard/district/uptime';

const NOW = Date.parse('2026-08-31T17:00:00.000Z');
const SHA = 'abc123def456';

function scr(over: Partial<OpsScreen> = {}): OpsScreen {
  return {
    id: 'scr-1', name: 'G43', status: 'ONLINE',
    lastPingAt: new Date(NOW - 8_000).toISOString(),
    renderHealth: 'OK', renderStale: false,
    lastRenderedAt: new Date(NOW - 20_000).toISOString(),
    lastRenderedHash: 'content:9f2', lastBundleSha: SHA,
    pendingRefreshAt: null, pushChannel: 'live',
    lastPushConnectedAt: new Date(NOW - 30_000).toISOString(),
    authState: 'PROVEN', ...over,
  };
}
// Not painting for 20 minutes: dark.
const DARK = { renderStale: true, lastRenderedAt: new Date(NOW - 20 * 60_000).toISOString() };
const NATIVE_ASLEEP = {
  nativeRuntimeReport: { interactive: false },
  nativeRuntimeReportAt: new Date(NOW - 60_000).toISOString(),
};
const OFF_NOW: DisplayScheduleRow[] = [
  { screenId: 'scr-1', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '07:00', offTime: '15:00', timezone: 'UTC' },
];
const ON_NOW: DisplayScheduleRow[] = [
  { screenId: 'scr-1', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '07:00', offTime: '20:00', timezone: 'UTC' },
];
const run = (over: Partial<OpsScreen>, displaySchedules?: DisplayScheduleRow[]) =>
  deriveScreenStatus({ screen: scr(over), deployedSha: SHA, displaySchedules, now: NOW });

describe('Sleeping status', () => {
  it('schedule off window + dark -> Sleeping on/off schedule (calm, no attention)', () => {
    const s = run(DARK, OFF_NOW);
    expect(s.key).toBe('sleeping');
    expect(s.label).toBe('Sleeping · on/off schedule');
    expect(s.tone).toBe('neutral');
    expect(s.needsAttention).toBe(false);
  });
  it('native report asleep (Sleep command / standby) -> Sleeping', () => {
    const s = run(NATIVE_ASLEEP);
    expect(s.key).toBe('sleeping');
    expect(s.label).toBe('Sleeping');
  });
  it('native vendor backlight off -> Sleeping', () => {
    const s = run({
      nativeRuntimeReport: { sleep: { vb: { off: true } } },
      nativeRuntimeReportAt: new Date(NOW - 60_000).toISOString(),
    });
    expect(s.key).toBe('sleeping');
  });
  it('awake and painting -> not sleeping, even with a schedule that says on', () => {
    expect(run({}, ON_NOW).key).toBe('current');
  });
  it('inside the schedule off window but still painting -> not claimed as sleeping', () => {
    expect(run({}, OFF_NOW).key).not.toBe('sleeping');
  });
  it('dark with no schedule and no native report stays a problem', () => {
    expect(run(DARK).key).not.toBe('sleeping');
    expect(run(DARK, ON_NOW).key).not.toBe('sleeping');
  });
  it('offline stays Offline even when scheduled off', () => {
    expect(run({ status: 'OFFLINE', ...DARK }, OFF_NOW).key).toBe('offline');
  });
  it('unknown evidence (no render proof, no report) is not sleeping', () => {
    expect(run({ renderHealth: null, lastRenderedAt: null, lastRenderedHash: null }).key).not.toBe('sleeping');
  });
  it('carries catalogue references for en/es/zh', () => {
    expect(sleepingDescriptor('schedule').messages?.label?.key).toBe('screens.contentState.sleepingSchedule');
    expect(sleepingDescriptor('device').messages?.label?.key).toBe('screens.contentState.sleeping');
  });
});
