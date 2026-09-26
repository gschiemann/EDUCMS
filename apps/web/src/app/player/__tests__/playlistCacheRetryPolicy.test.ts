import { PlaylistCacheRetryPolicy } from '../playlistCacheRetryPolicy';

describe('PlaylistCacheRetryPolicy', () => {
  it('is due immediately before any failure and again right after a success', () => {
    const p = new PlaylistCacheRetryPolicy();
    expect(p.isDue(0)).toBe(true);
    p.recordFailure(1_000);
    expect(p.isDue(1_000)).toBe(false);
    p.recordSuccess();
    expect(p.isDue(1_000)).toBe(true);
    expect(p.consecutiveFailures).toBe(0);
  });

  it('backs off exponentially from the base and caps at the ceiling', () => {
    const p = new PlaylistCacheRetryPolicy({ baseMs: 30_000, factor: 2, maxMs: 600_000 });
    expect(p.recordFailure(0)).toBe(30_000);
    expect(p.recordFailure(0)).toBe(60_000);
    expect(p.recordFailure(0)).toBe(120_000);
    expect(p.recordFailure(0)).toBe(240_000);
    expect(p.recordFailure(0)).toBe(480_000);
    expect(p.recordFailure(0)).toBe(600_000);
    expect(p.recordFailure(0)).toBe(600_000);
    expect(p.consecutiveFailures).toBe(7);
  });

  it('reports when the next attempt is due', () => {
    const p = new PlaylistCacheRetryPolicy({ baseMs: 10_000 });
    p.recordFailure(5_000);
    expect(p.isDue(14_999)).toBe(false);
    expect(p.msUntilDue(14_999)).toBe(1);
    expect(p.isDue(15_000)).toBe(true);
    expect(p.msUntilDue(20_000)).toBe(0);
  });

  it('expedite makes the attempt due now without forgetting the failure count', () => {
    const p = new PlaylistCacheRetryPolicy({ baseMs: 10_000 });
    p.recordFailure(0);
    p.recordFailure(0);
    expect(p.isDue(1_000)).toBe(false);
    p.expedite();
    expect(p.isDue(1_000)).toBe(true);
    expect(p.consecutiveFailures).toBe(2);
    // the next failure keeps climbing rather than restarting at the base
    expect(p.recordFailure(1_000)).toBe(40_000);
  });

  it('delayFor is monotone and zero for no failures', () => {
    const p = new PlaylistCacheRetryPolicy({ baseMs: 1_000, factor: 3, maxMs: 50_000 });
    expect(p.delayFor(0)).toBe(0);
    expect(p.delayFor(1)).toBe(1_000);
    expect(p.delayFor(2)).toBe(3_000);
    expect(p.delayFor(3)).toBe(9_000);
    expect(p.delayFor(10)).toBe(50_000);
  });
});
