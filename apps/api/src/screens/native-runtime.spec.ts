import {
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
});
