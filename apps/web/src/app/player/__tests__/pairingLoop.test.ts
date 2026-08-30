/**
 * Self-scheduling pairing loop (2026-08-30 player reliability program).
 * Encodes the audit's P0-1 acceptance criterion: "three consecutive pairing
 * endpoint failures recover automatically when the endpoint returns;
 * polling never silently stops."
 */
import { createPairingLoop } from '../pairingLoop';

describe('createPairingLoop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const drain = async (ms: number) => {
    // advance in 1ms steps so chained setTimeout(0) + microtasks interleave
    await jest.advanceTimersByTimeAsync(ms);
  };

  it('THE 1.1.6 BUG: 3 failures then a successful-but-still-unpaired tick — polling continues', async () => {
    const results = ['fail', 'fail', 'fail', 'continue', 'continue', 'done'] as const;
    let i = 0;
    const seen: number[] = [];
    const loop = createPairingLoop({
      tick: async () => { seen.push(i); return results[Math.min(i++, results.length - 1)]; },
      baseMs: 3000,
      backoff: () => 5000,
    });
    loop.start();
    await drain(1);           // immediate first tick (fail 1)
    await drain(5001);        // fail 2
    await drain(5001);        // fail 3
    expect(loop.failStreak()).toBe(3);
    await drain(5001);        // the "one-shot retry" — succeeds, STILL UNPAIRED
    expect(loop.failStreak()).toBe(0);
    expect(loop.running()).toBe(true);   // ← the old code died right here
    await drain(3001);        // healthy cadence continues
    await drain(3001);        // 'done' — paired
    expect(loop.running()).toBe(false);
    expect(seen.length).toBe(6);
  });

  it('a throwing tick counts as failure and keeps scheduling', async () => {
    let calls = 0;
    const loop = createPairingLoop({
      tick: async () => { calls += 1; if (calls < 3) throw new Error('net'); return 'done'; },
      baseMs: 1000,
      backoff: (n) => n * 100,
    });
    loop.start();
    await drain(1);
    await drain(101);
    await drain(201);
    expect(calls).toBe(3);
    expect(loop.running()).toBe(false);
  });

  it('stop() cancels the pending timer and later ticks never fire', async () => {
    let calls = 0;
    const loop = createPairingLoop({
      tick: async () => { calls += 1; return 'continue'; },
      baseMs: 1000,
      backoff: () => 1000,
    });
    loop.start();
    await drain(1);
    expect(calls).toBe(1);
    loop.stop();
    await drain(10_000);
    expect(calls).toBe(1);
    expect(loop.running()).toBe(false);
  });

  it('stop() during an in-flight tick suppresses the reschedule', async () => {
    let resolveTick!: () => void;
    let calls = 0;
    const loop = createPairingLoop({
      tick: () => new Promise((r) => { calls += 1; resolveTick = () => r('continue'); }),
      baseMs: 500,
      backoff: () => 500,
    });
    loop.start();
    await drain(1);
    expect(calls).toBe(1);
    loop.stop();
    resolveTick();
    await drain(5_000);
    expect(calls).toBe(1);
  });
});
