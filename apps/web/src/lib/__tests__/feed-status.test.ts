/**
 * computeFeedStatus / readFeedStats (lib/cts-merge.ts) — the pure math
 * behind the guided scoreboard-feed setup card's status pill
 * (Inputs-wave GUIDED, 2026-08-10).
 *
 * `Game.stats.feed = { lastPacketAt, source, accepted }` is stamped
 * server-side by all three machine-ingest paths; this function turns it
 * into never ("Waiting for first packet…") / fresh ("Receiving") /
 * stale, using a caller-supplied clock reference so the component can
 * pass Date.now() (CtsConsoleStatus precedent).
 */
import {
  computeFeedStatus,
  readFeedStats,
  FEED_FRESH_MS,
} from '../cts-merge';

const NOW = 1_700_000_000_000;

function statsWithFeed(agoMs: number, extra: Record<string, unknown> = {}) {
  return {
    feed: {
      lastPacketAt: new Date(NOW - agoMs).toISOString(),
      source: 'feed',
      accepted: true,
      ...extra,
    },
  };
}

describe('readFeedStats', () => {
  it('returns null for absent / malformed shapes, never throwing', () => {
    expect(readFeedStats(null)).toBeNull();
    expect(readFeedStats(undefined)).toBeNull();
    expect(readFeedStats('nope')).toBeNull();
    expect(readFeedStats({})).toBeNull();
    expect(readFeedStats({ feed: 'not-an-object' })).toBeNull();
  });

  it('returns the feed block when present', () => {
    const stats = statsWithFeed(1000);
    expect(readFeedStats(stats)).toBe(stats.feed);
  });
});

describe('computeFeedStatus', () => {
  it('"never" when there is no stamp at all — the Waiting state', () => {
    for (const stats of [null, undefined, {}, { cts: {} }, { feed: {} }]) {
      const s = computeFeedStatus(stats, NOW);
      expect(s.kind).toBe('never');
      expect(s.ageMs).toBeNull();
      expect(s.source).toBeNull();
      expect(s.label).toBe('Waiting for first packet…');
    }
  });

  it('"never" when lastPacketAt is unparseable (defensive)', () => {
    const s = computeFeedStatus({ feed: { lastPacketAt: 'garbage' } }, NOW);
    expect(s.kind).toBe('never');
    expect(s.ageMs).toBeNull();
  });

  it('"fresh" inside the window, with the age and the source passed through', () => {
    const s = computeFeedStatus(statsWithFeed(3_000), NOW);
    expect(s.kind).toBe('fresh');
    expect(s.ageMs).toBe(3_000);
    expect(s.source).toBe('feed');
    expect(s.label).toBe('Receiving');
  });

  it.each(['feed', 'cts', 'swim'] as const)('passes through source %s', (src) => {
    const s = computeFeedStatus(statsWithFeed(1_000, { source: src }), NOW);
    expect(s.source).toBe(src);
  });

  it('nulls an unknown source value instead of trusting it', () => {
    const s = computeFeedStatus(statsWithFeed(1_000, { source: 'evil' }), NOW);
    expect(s.kind).toBe('fresh');
    expect(s.source).toBeNull();
  });

  it('"stale" once the window is exceeded (boundary is exclusive)', () => {
    expect(computeFeedStatus(statsWithFeed(FEED_FRESH_MS - 1), NOW).kind).toBe('fresh');
    expect(computeFeedStatus(statsWithFeed(FEED_FRESH_MS), NOW).kind).toBe('stale');
    const s = computeFeedStatus(statsWithFeed(120_000), NOW);
    expect(s.kind).toBe('stale');
    expect(s.ageMs).toBe(120_000);
    expect(s.label).toBe('No packets');
  });

  it('uses the caller-supplied clock reference, not the wall clock', () => {
    // A stamp 3s before the REFERENCE time is fresh even if the wall
    // clock is somewhere else entirely — the function must be pure.
    const stats = statsWithFeed(3_000);
    expect(computeFeedStatus(stats, NOW).kind).toBe('fresh');
    expect(computeFeedStatus(stats, NOW + FEED_FRESH_MS).kind).toBe('stale');
  });

  it('is pure — same inputs, same output object shape', () => {
    const stats = statsWithFeed(4_000);
    expect(computeFeedStatus(stats, NOW)).toEqual(computeFeedStatus(stats, NOW));
  });
});
