import {
  nativeGlassPlaying,
  nativePowerStateChanged,
  parseNativeRuntime,
  pendingNativePowerOn,
  NATIVE_GLASS_FRAME_FRESH_MS,
  NATIVE_GLASS_REPORT_FRESH_MS,
  NATIVE_POWER_ON_TTL_MS,
} from './native-runtime';

const runtime = {
  schema: 1,
  interactive: false,
  foreground: false,
  standbySinceMs: 123456,
  elapsedRealtimeMs: 456789,
  powerOnAck: null,
};

describe('native power evidence and command freshness', () => {
  it('retains a dark panel independently of the native process heartbeat', () => {
    expect(parseNativeRuntime(JSON.stringify(runtime))).toEqual(runtime);
    expect(
      parseNativeRuntime(JSON.stringify({ ...runtime, interactive: null })),
    ).toMatchObject({ interactive: null });
  });
  it('bounds the header and strips arbitrary nested device input', () => {
    expect(
      parseNativeRuntime(
        JSON.stringify({ ...runtime, arbitrary: { secret: 'discard' } }),
      ),
    ).toEqual(runtime);
    for (const v of [
      undefined,
      [],
      'invalid',
      ' '.repeat(1025),
      '{}',
      JSON.stringify({ ...runtime, foreground: 'false' }),
      JSON.stringify({ ...runtime, elapsedRealtimeMs: -1 }),
      JSON.stringify({ ...runtime, powerOnAck: 'invalid' }),
    ]) {
      expect(parseNativeRuntime(v)).toBeNull();
    }
  });
  it('only carries a fresh operator wake, with a stable identity despite device clock skew', () => {
    const issued = new Date('2026-10-09T00:00:00.123Z');
    expect(pendingNativePowerOn(issued, issued.getTime() + 60_000)).toBe(
      issued.toISOString(),
    );
    expect(
      pendingNativePowerOn(issued, issued.getTime() + NATIVE_POWER_ON_TTL_MS),
    ).toBeNull();
    expect(pendingNativePowerOn(issued, issued.getTime() - 1)).toBeNull();
    expect(pendingNativePowerOn(null)).toBeNull();
  });
  it('a report is a CHANGE only when the power / wake state moved, never the uptime counter', () => {
    const r = parseNativeRuntime(JSON.stringify(runtime))!;
    expect(nativePowerStateChanged(runtime, { ...r, elapsedRealtimeMs: r.elapsedRealtimeMs + 3000 })).toBe(false);
    for (const change of [
      { interactive: true },
      { interactive: null },
      { foreground: true },
      { standbySinceMs: null },
      { standbySinceMs: 999 },
      { powerOnAck: '2026-10-09T00:00:00.123Z' },
    ]) {
      expect(nativePowerStateChanged(runtime, { ...r, ...change })).toBe(true);
    }
    // Nothing stored yet, or something unreadable: write it.
    for (const stored of [null, undefined, {}, 'x', { ...runtime, foreground: 'no' }]) {
      expect(nativePowerStateChanged(stored, r)).toBe(true);
    }
  });

  // 2026-10-11 — what the player OBSERVED about sleeping (SleepProof).
  const sleep = {
    blank: 'screen-timeout',
    dream: true,
    a11y: false,
    admin: false,
    last: { m: 'screen-timeout', o: 'dream', at: 1791688602995 },
    restore: { d: 'RESTORE', o: 'black', at: 1791688602995 },
    offIdleS: 14_400,
    offAt: 1791688602995,
    attS: 14_400,
    // 1.1.42: the proven cause of that off, and the system screen-off timeout it was judged against.
    off: 'screen-timeout',
    sotS: 1_800,
  };
  it('accepts the sleep evidence block and an attempt count, additively', () => {
    const full = { ...runtime, powerOnAttempts: 1, sleep };
    expect(parseNativeRuntime(JSON.stringify(full))).toEqual(full);
    // A 1.1.24 report (no block) parses exactly as before.
    expect(parseNativeRuntime(JSON.stringify(runtime))).toEqual(runtime);
    // A partial block is fine: every key is optional.
    expect(
      parseNativeRuntime(JSON.stringify({ ...runtime, sleep: { blank: 'device-admin' } })),
    ).toMatchObject({ sleep: { blank: 'device-admin' } });
  });
  it('refuses a malformed sleep block rather than storing a device-invented claim', () => {
    for (const bad of [
      { ...sleep, last: { ...sleep.last, o: 'definitely-off' } },
      { ...sleep, blank: 'Not A Mechanism!' },
      { ...sleep, blank: 'x'.repeat(33) },
      { ...sleep, restore: { ...sleep.restore, d: 'restore; drop table' } },
      { ...sleep, last: { ...sleep.last, at: -5 } },
      { ...sleep, dream: 'yes' },
      // 1.1.42: the cause is one of three codes, never a device-invented claim.
      { ...sleep, off: 'android-turned-it-off' },
      { ...sleep, off: 'power-key' },
      { ...sleep, sotS: 'never' },
    ]) {
      expect(parseNativeRuntime(JSON.stringify({ ...runtime, sleep: bad }))).toBeNull();
    }
    // The owner's remote: 3 s idle is a display-off, which a 1.1.42 player reports as such.
    expect(parseNativeRuntime(JSON.stringify({ ...runtime, sleep: { blank: 'screen-timeout', off: 'display-off', offIdleS: 3, offAt: 1791688602995, sotS: 1_800 } })))
      .toMatchObject({ sleep: { blank: 'screen-timeout', off: 'display-off', offIdleS: 3, sotS: 1_800 } });
    expect(parseNativeRuntime(JSON.stringify({ ...runtime, powerOnAttempts: 50 }))).toBeNull();
  });
  // 2026-10-11 — the wake timeline and the reporting process (player WakeReport).
  const wake = {
    src: 'dead-man-revert',
    reqAt: 1791688602995,
    onAt: 1791688603400,
    resAt: 1791688604100,
    loadAt: 1791688660000,
    n: 1,
    out: 'on-glass',
  };
  const proc = { pid: 12345, at: 1791688000000, boot: 17 };
  it('accepts the wake timeline and the process block, additively and partially', () => {
    const full = { ...runtime, wake, proc };
    expect(parseNativeRuntime(JSON.stringify(full))).toEqual(full);
    expect(
      parseNativeRuntime(JSON.stringify({ ...runtime, wake: { src: 'screen-on', reqAt: 1, n: 0, out: 'pending' } })),
    ).toMatchObject({ wake: { src: 'screen-on', out: 'pending' } });
    expect(parseNativeRuntime(JSON.stringify({ ...runtime, proc: { pid: 1, at: 1 } }))).toMatchObject({ proc: { pid: 1 } });
  });
  it('refuses a malformed wake or process block rather than storing a device-invented claim', () => {
    for (const bad of [
      { ...wake, out: 'definitely-on-glass' },
      { ...wake, src: 'Not A Source!' },
      { ...wake, src: 'x'.repeat(25) },
      { ...wake, n: 10 },
      { ...wake, reqAt: -1 },
    ]) {
      expect(parseNativeRuntime(JSON.stringify({ ...runtime, wake: bad }))).toBeNull();
    }
    expect(parseNativeRuntime(JSON.stringify({ ...runtime, proc: { pid: -1, at: 1 } }))).toBeNull();
    expect(parseNativeRuntime(JSON.stringify({ ...runtime, proc: { pid: 'x', at: 1 } }))).toBeNull();
  });
  it('a wake step or a new process is a CHANGE; the same wake re-reported is not', () => {
    const r = parseNativeRuntime(JSON.stringify({ ...runtime, wake, proc }))!;
    expect(nativePowerStateChanged(r, { ...r, elapsedRealtimeMs: r.elapsedRealtimeMs + 60_000 })).toBe(false);
    for (const next of [
      { ...r, wake: { ...wake, reqAt: wake.reqAt + 1 } },
      { ...r, wake: { ...wake, resAt: undefined } },
      { ...r, wake: { ...wake, onAt: wake.onAt + 1 } },
      { ...r, wake: { ...wake, out: 'not-on-glass' as const } },
      { ...r, proc: { ...proc, pid: proc.pid + 1 } },
    ]) {
      expect(nativePowerStateChanged(r, next as typeof r)).toBe(true);
    }
    // The first report that carries a wake is a change against one that did not.
    expect(nativePowerStateChanged({ ...runtime, sleep: undefined }, r)).toBe(true);
  });
  it('a new sleep observation or capability is a CHANGE; an identical block is not', () => {
    const r = parseNativeRuntime(JSON.stringify({ ...runtime, sleep }))!;
    expect(nativePowerStateChanged(r, { ...r, elapsedRealtimeMs: r.elapsedRealtimeMs + 60_000 })).toBe(false);
    for (const next of [
      { ...sleep, last: { ...sleep.last, at: sleep.last.at + 1 } },
      { ...sleep, restore: { ...sleep.restore, o: 'off' } },
      { ...sleep, blank: 'software-dim' },
      { ...sleep, dream: false },
      { ...sleep, a11y: true },
      { ...sleep, admin: true },
    ]) {
      expect(nativePowerStateChanged(r, { ...r, sleep: next as typeof r.sleep })).toBe(true);
    }
  });
});

describe('native-first §4.4 — nativePresenting on the status heartbeat (telemetry only)', () => {
  const on = { ...runtime, interactive: true, foreground: true, standbySinceMs: null };
  const presenting = { sha8: 'abcdef01', uniqueFrames: 4200, ageMs: 40 };
  const NOW = Date.parse('2026-10-19T12:00:00.000Z');
  const at = (msAgo: number) => new Date(NOW - msAgo);

  it('accepts the block additively; a malformed one drops the report (never a device-invented claim)', () => {
    expect(parseNativeRuntime(JSON.stringify({ ...on, nativePresenting: presenting }))).toEqual({ ...on, nativePresenting: presenting });
    expect(parseNativeRuntime(JSON.stringify(on))).toEqual(on);
    for (const bad of [
      { ...presenting, sha8: 'https://x' },
      { ...presenting, sha8: 'ABCDEF01' },
      { ...presenting, uniqueFrames: -1 },
      { ...presenting, ageMs: 1.5 },
      { sha8: 'abcdef01' },
    ]) {
      expect(parseNativeRuntime(JSON.stringify({ ...on, nativePresenting: bad }))).toBeNull();
    }
    // Fits the header budget with every other block present.
    const full = JSON.stringify({ ...on, nativePresenting: presenting, proc: { pid: 2147483647, at: NOW, boot: 2147483647 } });
    expect(full.length).toBeLessThan(400);
  });

  it('never forces a row write: frames advancing every beat are not a power-state change', () => {
    const a = parseNativeRuntime(JSON.stringify({ ...on, nativePresenting: presenting }))!;
    const b = parseNativeRuntime(JSON.stringify({ ...on, nativePresenting: { ...presenting, uniqueFrames: 9999, ageMs: 10 } }))!;
    expect(nativePowerStateChanged(a, b)).toBe(false);
  });

  it('grades "page down, glass playing" only on a fresh report with a recent frame on a lit panel', () => {
    const report = { ...on, nativePresenting: presenting };
    expect(nativeGlassPlaying(report, at(30_000), NOW)).toEqual(presenting);
    expect(nativeGlassPlaying(report, at(NATIVE_GLASS_REPORT_FRESH_MS + 1), NOW)).toBeNull();
    expect(nativeGlassPlaying(report, null, NOW)).toBeNull();
    expect(nativeGlassPlaying({ ...report, nativePresenting: { ...presenting, ageMs: NATIVE_GLASS_FRAME_FRESH_MS + 1 } }, at(1), NOW)).toBeNull();
    expect(nativeGlassPlaying({ ...report, nativePresenting: { ...presenting, uniqueFrames: 0 } }, at(1), NOW)).toBeNull();
    expect(nativeGlassPlaying({ ...report, interactive: false }, at(1), NOW)).toBeNull();
    expect(nativeGlassPlaying(on, at(1), NOW)).toBeNull();
    expect(nativeGlassPlaying('garbage', at(1), NOW)).toBeNull();
    // A report from the future (device clock) never counts.
    expect(nativeGlassPlaying(report, new Date(NOW + 5_000), NOW)).toBeNull();
  });
});
