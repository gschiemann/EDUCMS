import {
  BLOCK_MS, CRASH_WINDOW_MS, LS_LOOP_BLOCKED_UNTIL, LS_LOOP_MARKER,
  blockFor, bootCheck, isBlocked, isDeviceShapedFailure, markAlive, markStarted, markStopped, readLeadMs, writeLeadMs, type KV,
} from '../loopGuard';

function mem(): KV & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}
const T0 = 1_800_000_000_000;

describe('block', () => {
  it('blocks for a day and then gives the device another chance', () => {
    const kv = mem();
    expect(isBlocked(kv, T0)).toBe(false);
    blockFor(kv, T0);
    expect(isBlocked(kv, T0 + BLOCK_MS - 1)).toBe(true);
    expect(isBlocked(kv, T0 + BLOCK_MS + 1)).toBe(false);
  });
  it('unreadable or throwing storage never throws into playback', () => {
    const bad: KV = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(isBlocked(bad, T0)).toBe(false);
    expect(() => { blockFor(bad, T0); markStarted(bad, T0); markAlive(bad, T0); markStopped(bad); writeLeadMs(bad, 100); }).not.toThrow();
    expect(bootCheck(bad, T0)).toBe(false);
    expect(readLeadMs(bad)).toBeNull();
  });
});

describe('crash marker', () => {
  it('a clean stop leaves nothing behind', () => {
    const kv = mem();
    markStarted(kv, T0);
    markStopped(kv);
    expect(bootCheck(kv, T0 + 60_000)).toBe(false);
    expect(LS_LOOP_MARKER in kv.data).toBe(false);
  });

  it('one session that died soon after starting is noted, not yet blocking', () => {
    const kv = mem();
    markStarted(kv, T0);
    markAlive(kv, T0 + 60_000);
    expect(bootCheck(kv, T0 + 120_000)).toBe(false);
    expect(isBlocked(kv, T0 + 120_000)).toBe(false);
  });

  it('two in a row block two-deck for a day (a crash loop)', () => {
    const kv = mem();
    markStarted(kv, T0); markAlive(kv, T0 + 30_000);
    bootCheck(kv, T0 + 60_000);
    markStarted(kv, T0 + 61_000); markAlive(kv, T0 + 90_000);
    expect(bootCheck(kv, T0 + 120_000)).toBe(true);
    expect(isBlocked(kv, T0 + 130_000)).toBe(true);
    expect(LS_LOOP_BLOCKED_UNTIL in kv.data).toBe(true);
  });

  it('a nightly power cut is NOT a crash: a session that ran past the window never counts', () => {
    const kv = mem();
    for (let day = 0; day < 5; day++) {
      const t = T0 + day * 86_400_000;
      markStarted(kv, t);
      markAlive(kv, t + CRASH_WINDOW_MS + 60_000); // it lived for hours; the mains were cut
      expect(bootCheck(kv, t + 30_000_000)).toBe(false);
    }
    expect(isBlocked(kv, T0 + 5 * 86_400_000)).toBe(false);
  });

  it('a clean session between two short ones resets the streak', () => {
    const kv = mem();
    markStarted(kv, T0); markAlive(kv, T0 + 10_000); bootCheck(kv, T0 + 20_000); // crash 1
    markStarted(kv, T0 + 21_000); markStopped(kv); bootCheck(kv, T0 + 30_000); // clean
    markStarted(kv, T0 + 31_000); markAlive(kv, T0 + 40_000);
    expect(bootCheck(kv, T0 + 50_000)).toBe(false); // crash 1 again, not 2
    expect(isBlocked(kv, T0 + 50_000)).toBe(false);
  });

  it('an unreadable marker is treated as a session of unknown length, not a crash', () => {
    const kv = mem();
    kv.setItem(LS_LOOP_MARKER, '{not json');
    expect(bootCheck(kv, T0)).toBe(false);
  });
});

describe('lead + failure classification', () => {
  it('persists a believable resume latency only', () => {
    const kv = mem();
    expect(readLeadMs(kv)).toBeNull();
    writeLeadMs(kv, 97.6);
    expect(readLeadMs(kv)).toBe(98);
    writeLeadMs(kv, 5000);
    expect(readLeadMs(kv)).toBeNull(); // out of band: ignored
    writeLeadMs(kv, Number.NaN);
    expect(readLeadMs(kv)).toBeNull();
  });
  it('device-shaped failures block; a one-off does not', () => {
    for (const r of ['standby-error', 'standby-not-ready', 'handoff-timeout', 'play-rejected', 'standby-setup-failed', 'play-threw', 'degraded-playback']) expect(isDeviceShapedFailure(r)).toBe(true);
    // 'not-keeping-up' is a state of the file or the moment, not a verdict on the device.
    for (const r of ['stalled', 'unmounted', 'not-keeping-up', 'x']) expect(isDeviceShapedFailure(r)).toBe(false);
  });
});
