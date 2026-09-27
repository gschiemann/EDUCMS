/**
 * scoringSource — who drives the score a phone operator is tapping (K12-F15).
 * "Live" only inside the source's freshness window; silence is reported in
 * seconds, never as live.
 */
import { scoringSource } from '../phone-run';

const NOW = Date.parse('2026-09-27T20:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('scoringSource', () => {
  it('no console and no feed → this console is scoring', () => {
    expect(scoringSource({}, NOW)).toEqual({ kind: 'manual' });
    expect(scoringSource(null, NOW)).toEqual({ kind: 'manual' });
  });

  it('a CTS heartbeat inside 5 s → the scoreboard console is live (its score wins)', () => {
    expect(scoringSource({ cts: { lastUpdateAt: ago(1_000) } }, NOW)).toEqual({ kind: 'cts-live' });
  });

  it('a CTS heartbeat older than 5 s → silent for N s, taps show', () => {
    expect(scoringSource({ cts: { lastUpdateAt: ago(12_400) } }, NOW)).toEqual({ kind: 'cts-stale', seconds: 12 });
  });

  it('a generic feed packet inside 20 s → the feed is sending', () => {
    expect(scoringSource({ feed: { lastPacketAt: ago(3_000), source: 'feed' } }, NOW)).toEqual({ kind: 'feed-live' });
  });

  it('a generic feed silent past 20 s → silent for N s', () => {
    expect(scoringSource({ feed: { lastPacketAt: ago(61_000), source: 'feed' } }, NOW)).toEqual({
      kind: 'feed-stale',
      seconds: 61,
    });
  });

  it('a feed stamp from the CTS or swim bridge is not reported as a second source', () => {
    expect(scoringSource({ feed: { lastPacketAt: ago(1_000), source: 'swim' } }, NOW)).toEqual({ kind: 'manual' });
  });

  it('a garbage timestamp is never read as live', () => {
    expect(scoringSource({ cts: { lastUpdateAt: 'not-a-date' } }, NOW)).toEqual({ kind: 'manual' });
  });
});
