/**
 * SyncClock unit tests — Cristian/NTP-style offset estimation with
 * min-RTT filtering, slew-not-step application, and honest uncertainty.
 * docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §4.
 */
import { SyncClock } from '../syncClock';

/** Feed a clean sample: server is exactly `offset` ahead of mono. */
function feed(clock: SyncClock, monoAt: number, offset: number, rtt: number) {
  const t0 = monoAt - rtt;
  const t1 = monoAt;
  // serverNow measured at mid-flight: mono mid = t0 + rtt/2
  const serverNow = t0 + rtt / 2 + offset;
  clock.addSample(serverNow, t0, t1);
}

describe('SyncClock — estimation', () => {
  it('one clean sample recovers the true offset', () => {
    const c = new SyncClock();
    feed(c, 1_000, 5_000, 20);
    expect(c.now(1_000)).toBeCloseTo(6_000, 0);
  });

  it('min-RTT filtering rejects queue-delayed garbage samples', () => {
    const c = new SyncClock();
    // 6 clean low-RTT samples at true offset 5000…
    for (let i = 0; i < 6; i++) feed(c, 1_000 + i * 100, 5_000, 12 + i);
    // …plus 12 congested samples whose asymmetric delay skews them +400ms
    for (let i = 0; i < 12; i++) {
      const monoAt = 2_000 + i * 100;
      const rtt = 900 + i * 10;
      const t0 = monoAt - rtt;
      const t1 = monoAt;
      // all delay on the return leg → naive offset reads +rtt/2 too high
      const serverNow = t0 + rtt / 2 + 5_000 + 400;
      c.addSample(serverNow, t0, t1);
    }
    // best-RTT 25% are the clean ones → estimate stays ~5000
    const now = c.now(4_000)!;
    expect(Math.abs(now - (4_000 + 5_000))).toBeLessThan(20);
  });

  it('ignores invalid samples outright', () => {
    const c = new SyncClock();
    c.addSample(NaN, 0, 10);
    c.addSample(1_000, 20, 10); // t1 < t0
    c.addSample(1_000, 0, 20_000); // rtt > 10s cap
    expect(c.now(100)).toBeNull();
  });
});

describe('SyncClock — slew vs step', () => {
  it('slews small corrections at ≤2ms/s (content never visibly jumps)', () => {
    const c = new SyncClock();
    for (let i = 0; i < 8; i++) feed(c, 1_000 + i * 50, 5_000, 10);
    const locked = c.now(2_000)!; // initial lock (step allowed)
    expect(locked).toBeCloseTo(7_000, 0);
    // New reality: offset moved +100ms (below the 250ms step threshold).
    for (let i = 0; i < 24; i++) feed(c, 3_000 + i * 10, 5_100, 10);
    // One second later the applied offset must have moved AT MOST ~2ms.
    const after1s = c.now(4_000)!;
    const drift = after1s - (4_000 + 5_000);
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(drift).toBeLessThanOrEqual(2 * 2 + 1); // 2s window at slew cap + rounding
    // …and eventually converges to the new offset.
    let t = 4_000;
    for (let i = 0; i < 120; i++) {
      t += 1_000;
      c.now(t);
    }
    expect(c.now(t)! - (t + 5_100)).toBeCloseTo(0, 0);
  });

  it('steps immediately on a wild correction (>250ms)', () => {
    const c = new SyncClock();
    for (let i = 0; i < 8; i++) feed(c, 1_000 + i * 50, 5_000, 10);
    c.now(2_000);
    for (let i = 0; i < 24; i++) feed(c, 3_000 + i * 10, 9_000, 10);
    expect(c.now(3_500)! - (3_500 + 9_000)).toBeCloseTo(0, 0);
  });
});

describe('SyncClock — uncertainty and lock gating', () => {
  it('is unlocked (infinite uncertainty) until enough samples', () => {
    const c = new SyncClock();
    expect(c.uncertaintyMs(0)).toBe(Number.POSITIVE_INFINITY);
    feed(c, 100, 5_000, 10);
    feed(c, 200, 5_000, 10);
    feed(c, 300, 5_000, 10);
    expect(c.isLocked(400, 80)).toBe(false);
    feed(c, 400, 5_000, 10);
    expect(c.isLocked(500, 80)).toBe(true);
  });

  it('uncertainty grows while coasting (crystal-drift allowance)', () => {
    const c = new SyncClock();
    for (let i = 0; i < 8; i++) feed(c, 1_000 + i * 50, 5_000, 10);
    const fresh = c.uncertaintyMs(2_000);
    const coasted = c.uncertaintyMs(2_000 + 10 * 60_000); // +10 min
    expect(coasted).toBeGreaterThan(fresh);
    // 10 min at 30ppm ≈ 18ms of allowance
    expect(coasted - fresh).toBeGreaterThan(15);
    expect(coasted - fresh).toBeLessThan(25);
  });

  it('reset() drops everything (device-sleep recovery path)', () => {
    const c = new SyncClock();
    for (let i = 0; i < 8; i++) feed(c, 1_000 + i * 50, 5_000, 10);
    expect(c.now(2_000)).not.toBeNull();
    c.reset();
    expect(c.now(2_100)).toBeNull();
    expect(c.uncertaintyMs(2_100)).toBe(Number.POSITIVE_INFINITY);
  });

  it('THE sync property: two clocks fed from the same server agree within a few ms', () => {
    // Screen A and screen B have different mono origins and different RTT
    // noise, but sample the same server clock. Their synced "now" for the
    // same true instant must agree tightly — that agreement IS the
    // screen-to-screen sync error.
    const a = new SyncClock();
    const b = new SyncClock();
    const serverAtTrue = (trueMs: number) => 1_700_000_000_000 + trueMs;
    // A's mono = true - 123456; B's mono = true - 98765 (different boots)
    const monoA = (trueMs: number) => trueMs - 123_456;
    const monoB = (trueMs: number) => trueMs - 98_765;
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 16; i++) {
      const trueMs = 200_000 + i * 250;
      const rttA = 8 + rand() * 30;
      const rttB = 8 + rand() * 30;
      a.addSample(serverAtTrue(trueMs), monoA(trueMs) - rttA, monoA(trueMs));
      b.addSample(serverAtTrue(trueMs), monoB(trueMs) - rttB, monoB(trueMs));
    }
    const trueNow = 210_000;
    const aNow = a.now(monoA(trueNow))!;
    const bNow = b.now(monoB(trueNow))!;
    expect(Math.abs(aNow - bNow)).toBeLessThan(10);
  });
});
