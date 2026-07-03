/**
 * game-list — pure logic unit tests (Sports Wave S4-2, 2026-07-02
 * deep-pass audit P2 "Game list scales badly").
 */
import { formatGameWhen, groupOf, orderGames, type GameListItem } from '../game-list';

function g(id: string, over: Partial<GameListItem> = {}): GameListItem {
  return { id, status: 'SCHEDULED', ...over };
}

describe('groupOf', () => {
  it('buckets LIVE and HALFTIME as live', () => {
    expect(groupOf('LIVE')).toBe('live');
    expect(groupOf('HALFTIME')).toBe('live');
  });
  it('buckets FINAL as past', () => {
    expect(groupOf('FINAL')).toBe('past');
  });
  it('buckets SCHEDULED, PRE_GAME, and unknown as upcoming', () => {
    expect(groupOf('SCHEDULED')).toBe('upcoming');
    expect(groupOf('PRE_GAME')).toBe('upcoming');
    expect(groupOf(undefined)).toBe('upcoming');
    expect(groupOf(null)).toBe('upcoming');
  });
});

describe('orderGames', () => {
  it('puts LIVE games in the live bucket ahead of upcoming and past', () => {
    const games = [
      g('final-1', { status: 'FINAL' }),
      g('sched-1', { status: 'SCHEDULED' }),
      g('live-1', { status: 'LIVE' }),
    ];
    const { live, upcoming, past } = orderGames(games);
    expect(live.map((x) => x.id)).toEqual(['live-1']);
    expect(upcoming.map((x) => x.id)).toEqual(['sched-1']);
    expect(past.map((x) => x.id)).toEqual(['final-1']);
  });

  it('orders live games by most-recently-started first', () => {
    const games = [
      g('live-old', { status: 'LIVE', startedAt: '2026-07-01T18:00:00.000Z' }),
      g('live-new', { status: 'LIVE', startedAt: '2026-07-02T18:00:00.000Z' }),
    ];
    const { live } = orderGames(games);
    expect(live.map((x) => x.id)).toEqual(['live-new', 'live-old']);
  });

  it('falls back to createdAt for a live game missing startedAt', () => {
    const games = [
      g('live-a', { status: 'LIVE', createdAt: '2026-07-01T10:00:00.000Z' }),
      g('live-b', { status: 'LIVE', createdAt: '2026-07-02T10:00:00.000Z' }),
    ];
    const { live } = orderGames(games);
    expect(live.map((x) => x.id)).toEqual(['live-b', 'live-a']);
  });

  it('orders upcoming dated games soonest-first, ahead of every undated game', () => {
    const games = [
      g('undated-1', { status: 'SCHEDULED', createdAt: '2026-07-01T00:00:00.000Z' }),
      g('dated-late', { status: 'SCHEDULED', scheduledAt: '2026-08-01T19:00:00.000Z' }),
      g('dated-soon', { status: 'PRE_GAME', scheduledAt: '2026-07-10T19:00:00.000Z' }),
      g('undated-2', { status: 'SCHEDULED', createdAt: '2026-06-30T00:00:00.000Z' }),
    ];
    const { upcoming } = orderGames(games);
    // dated games first (soonest first), then undated games (FIFO by createdAt).
    expect(upcoming.map((x) => x.id)).toEqual([
      'dated-soon',
      'dated-late',
      'undated-2',
      'undated-1',
    ]);
  });

  it('orders past (FINAL) games most-recently-played first', () => {
    const games = [
      g('final-old', { status: 'FINAL', startedAt: '2026-06-01T18:00:00.000Z' }),
      g('final-new', { status: 'FINAL', startedAt: '2026-06-15T18:00:00.000Z' }),
    ];
    const { past } = orderGames(games);
    expect(past.map((x) => x.id)).toEqual(['final-new', 'final-old']);
  });

  it('does not mutate the input array', () => {
    const games = [g('a', { status: 'FINAL' }), g('b', { status: 'LIVE' })];
    const copy = [...games];
    orderGames(games);
    expect(games).toEqual(copy);
  });

  it('handles an empty list', () => {
    expect(orderGames([])).toEqual({ live: [], upcoming: [], past: [] });
  });
});

describe('formatGameWhen', () => {
  const now = new Date('2026-07-02T12:00:00');

  it('returns empty string when there is no scheduled time', () => {
    expect(formatGameWhen(null, now)).toBe('');
    expect(formatGameWhen(undefined, now)).toBe('');
  });

  it('renders "Tonight" for an evening time today', () => {
    const when = formatGameWhen(new Date('2026-07-02T19:00:00'), now);
    expect(when).toMatch(/^Tonight /);
  });

  it('renders "Today" for a daytime time today', () => {
    const when = formatGameWhen(new Date('2026-07-02T09:00:00'), now);
    expect(when).toMatch(/^Today /);
  });

  it('renders "Tomorrow" for the next day', () => {
    const when = formatGameWhen(new Date('2026-07-03T19:00:00'), now);
    expect(when).toMatch(/^Tomorrow /);
  });

  it('renders a weekday name within the next 6 days', () => {
    const when = formatGameWhen(new Date('2026-07-06T19:00:00'), now); // +4 days
    expect(when).not.toMatch(/^(Tonight|Today|Tomorrow)/);
    expect(when.length).toBeGreaterThan(0);
  });

  it('renders a month/day for dates further out', () => {
    const when = formatGameWhen(new Date('2026-08-21T19:00:00'), now);
    expect(when).toMatch(/^Aug 21,/);
  });

  it('handles an unparseable value as empty', () => {
    expect(formatGameWhen('not-a-date', now)).toBe('');
  });
});
