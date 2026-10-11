import {
  nativePowerStateChanged,
  parseNativeRuntime,
  pendingNativePowerOn,
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
    ]) {
      expect(parseNativeRuntime(JSON.stringify({ ...runtime, sleep: bad }))).toBeNull();
    }
    expect(parseNativeRuntime(JSON.stringify({ ...runtime, powerOnAttempts: 50 }))).toBeNull();
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
