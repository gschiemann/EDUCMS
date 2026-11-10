import { parseProcessHealthHeader, processHealthOff, PROCESS_HEALTH_HEADER } from './process-health';
import { parseNativeRuntime } from './native-runtime';

const good = {
  v: 1,
  mem: { n: 3, max: 15, last: 15, ageMs: 40000, frees: 1, rssMb: 310, availMb: 420, low: false },
  main: { openMs: 30000, n: 2, maxMs: 14000, lastMs: 11000, ageMs: 60000, starved: 0, stack: 'MainActivity.loadPlayer:10;Looper.loop:1' },
  exits: [{ at: 1762700000000, r: 6, st: 0, imp: 100, pssKb: 0, rssKb: 0, desc: 'Input dispatching timed out' }],
  th: 0,
};

describe('process-health header (2026-11-09)', () => {
  it('names the header the APK sends', () => {
    expect(PROCESS_HEALTH_HEADER).toBe('x-venueos-process-health');
  });

  it('parses the shape ProcessHealthReport.kt builds', () => {
    expect(parseProcessHealthHeader(JSON.stringify(good))).toEqual(good);
  });

  it('accepts a minimal report (no exits, no thermal, no ages)', () => {
    const min = { v: 1, mem: { n: 0, max: 0, last: 0, frees: 0 }, main: { openMs: 0, n: 0, maxMs: 0, lastMs: 0, starved: 0 } };
    expect(parseProcessHealthHeader(JSON.stringify(min))).toEqual(min);
  });

  it.each([
    ['absent', undefined],
    ['not JSON', '{nope'],
    ['too long', 'x'.repeat(2049)],
    ['unknown key', JSON.stringify({ ...good, extra: 1 })],
    ['wrong version', JSON.stringify({ ...good, v: 2 })],
    ['thermal out of range', JSON.stringify({ ...good, th: 9 })],
    ['five exits', JSON.stringify({ ...good, exits: Array(5).fill(good.exits[0]) })],
    ['non-ASCII stack', JSON.stringify({ ...good, main: { ...good.main, stack: 'a b' } })],
    ['negative stall', JSON.stringify({ ...good, main: { ...good.main, openMs: -1 } })],
  ])('reads %s as no report', (_label, value) => {
    expect(parseProcessHealthHeader(value)).toBeNull();
  });

  it('the kill switch is exactly off', () => {
    expect(processHealthOff({ PLAYER_PROCESS_HEALTH: 'off' } as any)).toBe(true);
    expect(processHealthOff({ PLAYER_PROCESS_HEALTH: ' OFF ' } as any)).toBe(true);
    expect(processHealthOff({ PLAYER_PROCESS_HEALTH: 'no' } as any)).toBe(false);
    expect(processHealthOff({} as any)).toBe(false);
  });

  it('a malformed block stored in the runtime report never drops the power report', () => {
    const runtime = {
      schema: 1, interactive: true, foreground: true, standbySinceMs: null,
      elapsedRealtimeMs: 1000, powerOnAck: null,
      processHealth: { v: 9 },
    };
    const parsed = parseNativeRuntime(JSON.stringify(runtime));
    expect(parsed).not.toBeNull();
    expect(parsed!.processHealth).toBeUndefined();
    const withGood = parseNativeRuntime(JSON.stringify({ ...runtime, processHealth: good }));
    expect(withGood!.processHealth).toEqual(good);
  });
});
