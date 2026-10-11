import {
  mechanismKind,
  parsePlayerVersion,
  summarizeSleepWake,
  versionAtLeast,
  NATIVE_REPORT_FRESH_MS,
} from '../sleep-wake';

const NOW = Date.parse('2026-10-11T18:00:00.000Z');

/** VisionCore's X80 as the database showed it on 2026-10-11 (1.1.24, asleep since 03:16:42Z). */
const x80 = {
  playerVersion: '1.1.24',
  displayCapabilities: {
    schema: 1,
    build: { sdk: 30, release: '11', model: 'X80' },
    verdict: { screenBlank: 'screen-timeout', brightness: 'settings', volume: 'audiomanager', reboot: 'none' },
  },
  nativeRuntimeReport: {
    schema: 1,
    foreground: false,
    powerOnAck: null,
    interactive: false,
    standbySinceMs: 1791688602995,
    elapsedRealtimeMs: 114340276,
  },
  nativeRuntimeReportAt: new Date(NOW - 30_000).toISOString(),
  nativePowerOnAt: '2026-10-09T15:40:00.960Z',
  nowMs: NOW,
};

describe('sleep & wake — what each screen can do, and what it proved', () => {
  it('parses player versions, including field and debug suffixes', () => {
    expect(parsePlayerVersion('1.1.24')).toEqual([1, 1, 24]);
    expect(parsePlayerVersion('1.1.25-field.1')).toEqual([1, 1, 25]);
    expect(parsePlayerVersion('1.0.55-debug')).toEqual([1, 0, 55]);
    expect(parsePlayerVersion('garbage')).toBeNull();
    expect(parsePlayerVersion(null)).toBeNull();
    expect(versionAtLeast([1, 1, 24], [1, 1, 24])).toBe(true);
    expect(versionAtLeast([1, 1, 23], [1, 1, 24])).toBe(false);
    expect(versionAtLeast([1, 2, 0], [1, 1, 24])).toBe(true);
    expect(versionAtLeast(null, [1, 1, 24])).toBe(false);
  });

  it('the X80 today: asleep per Android, every native path present, Turn-on never confirmed', () => {
    const s = summarizeSleepWake(x80);
    expect(s.androidRelease).toBe('11');
    expect(s.mechanism).toBe('screen-timeout');
    expect(s.now).toEqual({ asleep: true, sinceMs: 1791688602995, reportAgeMs: 30_000 });
    expect(s.alertWakesSleeping).toBe('yes');
    expect(s.turnOnReachesSleeping).toBe('yes');
    expect(s.backToOffAfterAlert).toBe('yes');
    expect(s.lastTurnOn).toEqual({ requestedAtMs: Date.parse('2026-10-09T15:40:00.960Z'), acknowledged: false });
    // 1.1.24 sends no sleep evidence block.
    expect(s.noEvidence).toBe(true);
  });

  it('an old player is told what it lacks, never shown "no" for an unknown', () => {
    const s = summarizeSleepWake({ ...x80, playerVersion: '1.1.12', nativeRuntimeReport: null, nativeRuntimeReportAt: null });
    expect(s.alertWakesSleeping).toBe('no');
    expect(s.turnOnReachesSleeping).toBe('no');
    expect(s.backToOffAfterAlert).toBe('no');
    expect(s.now).toBeNull();
    const unknown = summarizeSleepWake({ nowMs: NOW });
    expect(unknown.alertWakesSleeping).toBe('unknown');
    expect(unknown.mechanism).toBe('unknown');
  });

  it('only a FRESH native report speaks about "now"', () => {
    const stale = summarizeSleepWake({
      ...x80,
      nativeRuntimeReportAt: new Date(NOW - NATIVE_REPORT_FRESH_MS - 1).toISOString(),
    });
    expect(stale.now).toBeNull();
    const unread = summarizeSleepWake({
      ...x80,
      nativeRuntimeReport: { ...x80.nativeRuntimeReport, interactive: null },
    });
    expect(unread.now).toBeNull();
  });

  it('a black overlay is never a real sleep, and a seen screensaver demotes the timeout', () => {
    expect(mechanismKind('software-dim', false)).toBe('black-only');
    expect(mechanismKind('none', false)).toBe('black-only');
    expect(mechanismKind('novastar-sdk', false)).toBe('black-only');
    expect(mechanismKind('screen-timeout', true)).toBe('screensaver');
    // The player itself demotes to software-dim once it sees one.
    expect(mechanismKind('software-dim', true)).toBe('screensaver');
    expect(mechanismKind('device-admin', false)).toBe('device-admin');
    expect(mechanismKind('accessibility-lock', false)).toBe('accessibility');
    expect(mechanismKind('vendor-recipe', false)).toBe('vendor');
    expect(mechanismKind(null, false)).toBe('unknown');
  });

  it('reads the player sleep evidence block (1.1.25 candidate), preferring its live mechanism', () => {
    const s = summarizeSleepWake({
      ...x80,
      playerVersion: '1.1.25',
      nativeRuntimeReport: {
        ...x80.nativeRuntimeReport,
        powerOnAck: '2026-10-09T15:40:00.960Z',
        sleep: {
          blank: 'software-dim',
          dream: true,
          a11y: false,
          admin: false,
          last: { m: 'screen-timeout', o: 'dream', at: NOW - 3_600_000 },
          restore: { d: 'RESTORE', o: 'black', at: NOW - 3_600_000 },
        },
      },
    });
    expect(s.mechanism).toBe('screensaver');
    expect(s.lastSleep).toEqual({ mechanism: 'screen-timeout', outcome: 'dream', atMs: NOW - 3_600_000 });
    expect(s.lastRestore).toEqual({ decision: 'RESTORE', outcome: 'black', atMs: NOW - 3_600_000 });
    expect(s.lastTurnOn?.acknowledged).toBe(true);
    expect(s.noEvidence).toBe(false);
  });

  it('an unrecognised outcome is "unknown", never passed through', () => {
    const s = summarizeSleepWake({
      ...x80,
      nativeRuntimeReport: {
        ...x80.nativeRuntimeReport,
        sleep: { last: { m: 'screen-timeout', o: 'definitely-off', at: NOW } },
      },
    });
    expect(s.lastSleep?.outcome).toBe('unknown');
  });

  it('accepts the stored JSON as a string too (some rows arrive serialised)', () => {
    const s = summarizeSleepWake({
      ...x80,
      displayCapabilities: JSON.stringify(x80.displayCapabilities),
      nativeRuntimeReport: JSON.stringify(x80.nativeRuntimeReport),
    });
    expect(s.mechanism).toBe('screen-timeout');
    expect(s.now?.asleep).toBe(true);
  });
});
