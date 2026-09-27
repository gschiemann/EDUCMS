/**
 * The one freshness / recovery contract of the live game surfaces (K12-F40).
 * Pure reducer — every time is passed in.
 */
import {
  LINK_OFFLINE_STALE_AFTER_MS,
  LINK_STALE_AFTER_MS,
  acceptRevision,
  authoritativeSource,
  initialLink,
  linkIsLive,
  linkReducer,
  secondsSinceGood,
  type LinkEvent,
  type LinkState,
} from '../sports-freshness';
import { STALE_FEED_AFTER_MS } from '../board-poll';

const run = (s: LinkState, ...events: LinkEvent[]) => events.reduce(linkReducer, s);

describe('the link lifecycle', () => {
  it('connecting → live on the first good read (a 200 or a 304)', () => {
    const s = run(initialLink(0), { type: 'good', at: 400 });
    expect(s.phase).toBe('live');
    expect(linkIsLive(s)).toBe(true);
  });

  it('shares the board chip threshold, and goes stale when no good read lands inside it', () => {
    expect(LINK_STALE_AFTER_MS).toBe(STALE_FEED_AFTER_MS);
    let s = run(initialLink(0), { type: 'good', at: 1_000 });
    s = linkReducer(s, { type: 'tick', at: 1_000 + LINK_STALE_AFTER_MS });
    expect(s.phase).toBe('live'); // exactly at the edge is still live
    s = linkReducer(s, { type: 'tick', at: 1_001 + LINK_STALE_AFTER_MS });
    expect(s).toMatchObject({ phase: 'stale', staleSince: 1_001 + LINK_STALE_AFTER_MS, hadLoss: true });
    expect(secondsSinceGood(s, 12_000)).toBe(11);
  });

  it('a browser that reports offline only hastens the verdict — a good read always wins', () => {
    let s = run(initialLink(0), { type: 'good', at: 0 });
    s = linkReducer(s, { type: 'tick', at: LINK_OFFLINE_STALE_AFTER_MS - 1, browserOffline: true });
    expect(s.phase).toBe('live');
    s = linkReducer(s, { type: 'tick', at: LINK_OFFLINE_STALE_AFTER_MS + 1, browserOffline: true });
    expect(s.phase).toBe('stale');
    // Misreported offline with reads still landing: live.
    s = linkReducer(s, { type: 'good', at: 3_000 });
    expect(s.phase).toBe('live');
  });

  it('never reaching the server is stale after the same window', () => {
    const s = run(initialLink(0), { type: 'tick', at: LINK_STALE_AFTER_MS + 1 });
    expect(s).toMatchObject({ phase: 'stale', hadLoss: false });
  });

  it('display surfaces recover on the first good read; confirming surfaces wait for their person', () => {
    const display = run(initialLink(0), { type: 'good', at: 0 }, { type: 'tick', at: 9_000 }, { type: 'good', at: 9_500 });
    expect(display.phase).toBe('live');

    let pad = run(
      initialLink(0, { confirmAfterLoss: true }),
      { type: 'good', at: 0 },
      { type: 'tick', at: 9_000 },
      { type: 'good', at: 9_500 },
    );
    expect(pad.phase).toBe('recovering');
    expect(linkIsLive(pad)).toBe(false);
    pad = linkReducer(pad, { type: 'good', at: 10_200 });
    expect(pad.phase).toBe('recovering'); // more reads do not confirm for them
    pad = linkReducer(pad, { type: 'confirm', at: 10_500 });
    expect(pad.phase).toBe('live');
  });

  it('a recovering link that loses reads again is stale again', () => {
    const s = run(
      initialLink(0, { confirmAfterLoss: true }),
      { type: 'good', at: 0 },
      { type: 'tick', at: 9_000 },
      { type: 'good', at: 9_500 },
      { type: 'tick', at: 18_000 },
    );
    expect(s.phase).toBe('stale');
  });

  it('a hidden tab claims nothing; coming back waits for a fresh read (and keeps an owed confirmation)', () => {
    let s = run(initialLink(0), { type: 'good', at: 0 }, { type: 'hidden', at: 1_000 });
    expect(s.phase).toBe('paused');
    s = linkReducer(s, { type: 'good', at: 1_200 }); // a straggler
    expect(s.phase).toBe('paused');
    s = linkReducer(s, { type: 'visible', at: 600_000 });
    expect(s.phase).toBe('connecting'); // not "lost" for the ten minutes away
    s = linkReducer(s, { type: 'good', at: 600_400 });
    expect(s.phase).toBe('live');

    const pad = run(
      initialLink(0, { confirmAfterLoss: true }),
      { type: 'good', at: 0 },
      { type: 'tick', at: 9_000 },
      { type: 'hidden', at: 9_100 },
      { type: 'visible', at: 20_000 },
      { type: 'good', at: 20_300 },
    );
    expect(pad.phase).toBe('recovering');
  });
});

describe('acceptRevision', () => {
  it('never applies a payload older than the one shown', () => {
    expect(acceptRevision(12, 11)).toBe(false);
    expect(acceptRevision(12, 12)).toBe(true); // a 200 of the same revision (new serverTime)
    expect(acceptRevision(12, 13)).toBe(true);
    expect(acceptRevision(null, 3)).toBe(true);
    expect(acceptRevision(12, undefined)).toBe(true); // an API that predates revisions
  });
});

describe('authoritativeSource', () => {
  const now = Date.parse('2026-09-27T18:00:10.000Z');
  it('a fresh CTS heartbeat, else a fresh machine feed, else the table', () => {
    expect(authoritativeSource({ cts: { lastUpdateAt: '2026-09-27T18:00:08.000Z' } }, now)).toBe('cts');
    expect(authoritativeSource({ cts: { lastUpdateAt: '2026-09-27T17:59:00.000Z' } }, now)).toBe('manual');
    expect(
      authoritativeSource({ feed: { source: 'feed', accepted: true, lastPacketAt: '2026-09-27T18:00:09.000Z' } }, now),
    ).toBe('feed');
    expect(
      authoritativeSource({ feed: { source: 'feed', accepted: false, lastPacketAt: '2026-09-27T18:00:09.000Z' } }, now),
    ).toBe('manual');
    expect(authoritativeSource(null, now)).toBe('manual');
  });
});
