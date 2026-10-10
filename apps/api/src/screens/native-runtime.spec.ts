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
});
