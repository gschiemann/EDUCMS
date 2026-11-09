import {
  ALERT_WATCH_WATCHDOG_HEADER,
  ALERT_WATCH_WATCHDOG_INTERVENTIONS,
  parseAlertWatchWatchdogHeader,
} from './alert-watch-watchdog';
import { parseNativeRuntime } from './native-runtime';

const good = {
  v: 1, verdict: 'rearm-sent', mode: 'on', ageMs: 12000, stampAgeMs: 250000, stampState: 'watching',
  faces: 2, ladder: { rung: 'rearm', ageMs: 12000 }, n24h: 1,
};

describe('x-venueos-alert-watch-watchdog — the Manager verdict the Player carries (wave 5)', () => {
  it('names the header the APK sends', () => {
    expect(ALERT_WATCH_WATCHDOG_HEADER).toBe('x-venueos-alert-watch-watchdog');
  });

  it('parses the APK shape, with and without a ladder, reason and kick', () => {
    expect(parseAlertWatchWatchdogHeader(JSON.stringify(good))).toEqual(good);
    const plain = { v: 1, verdict: 'healthy', mode: 'observe', ageMs: 5, stampAgeMs: 3000, stampState: 'watching', faces: 1, n24h: 0, kicked: 'rearm' };
    expect(parseAlertWatchWatchdogHeader(JSON.stringify(plain))).toEqual(plain);
    const reason = { v: 1, verdict: 'not-watchable', mode: 'on', ageMs: 1, faces: 0, n24h: 0, reason: 'this screen is not paired (no usable device token)' };
    expect(parseAlertWatchWatchdogHeader(JSON.stringify(reason))).toEqual(reason);
  });

  it('refuses anything malformed: unknown verdict, unknown key, negative age, non-ASCII reason, too long', () => {
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, verdict: 'fixed' }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, extra: 1 }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, ageMs: -1 }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, mode: 'off' }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, faces: 9 }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, reason: 'ñ' }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, ladder: { rung: 'launch', ageMs: 1 } }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, v: 2 }))).toBeNull();
    expect(parseAlertWatchWatchdogHeader('{')).toBeNull();
    expect(parseAlertWatchWatchdogHeader('')).toBeNull();
    expect(parseAlertWatchWatchdogHeader(undefined)).toBeNull();
    expect(parseAlertWatchWatchdogHeader(['a'])).toBeNull();
    expect(parseAlertWatchWatchdogHeader(JSON.stringify({ ...good, reason: 'x'.repeat(1100) }))).toBeNull();
  });

  it('a malformed block inside the runtime report drops ITSELF, never the power report', () => {
    const base = { schema: 1, interactive: false, foreground: false, standbySinceMs: null, elapsedRealtimeMs: 1000, powerOnAck: null };
    const withGood = parseNativeRuntime(JSON.stringify({ ...base, alertWatchWatchdog: good }));
    expect(withGood?.alertWatchWatchdog).toEqual(good);
    const withBad = parseNativeRuntime(JSON.stringify({ ...base, alertWatchWatchdog: { v: 1, verdict: 'fixed' } }));
    expect(withBad).not.toBeNull();
    expect(withBad?.interactive).toBe(false);
    expect(withBad?.alertWatchWatchdog).toBeUndefined();
    const without = parseNativeRuntime(JSON.stringify(base));
    expect(without?.alertWatchWatchdog).toBeUndefined();
  });

  it('knows which verdicts are interventions', () => {
    for (const v of ['rearm-sent', 'restart-sent', 'unrecovered', 'silent-observed', 'silent-backoff', 'silent-capped'] as const) {
      expect(ALERT_WATCH_WATCHDOG_INTERVENTIONS.has(v)).toBe(true);
    }
    for (const v of ['panel-on', 'healthy', 'recovered', 'hold', 'deferred-liveness', 'no-stamp', 'not-watchable'] as const) {
      expect(ALERT_WATCH_WATCHDOG_INTERVENTIONS.has(v)).toBe(false);
    }
  });
});
