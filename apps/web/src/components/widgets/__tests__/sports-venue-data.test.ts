/**
 * K-12 launch audit F28 / F29 / F38 — the pure data rules behind the
 * sports-venue pack (`v2/sports-venue-data.ts`).
 */
import { findSport, formatScore } from '@cms/api-types';
import {
  asOfLabel, defaultLineupCount, findRosterPlayer, gameStatPairs, hasTypedTeam,
  lineupFromRoster, liveTeamView, ownCopy, ownSponsorName, splitName, statLineFromRoster,
  teamCode, typedTeamView, DEMO_HOME,
  type VenueGameSnapshot,
} from '../v2/sports-venue-data';

const SNAP: VenueGameSnapshot = {
  sport: 'basketball',
  status: 'LIVE',
  segment: 3,
  homeTeam: 'Riverside Hawks',
  awayTeam: 'Lakeview Wolves',
  homeScore: 41,
  awayScore: 37,
  homeColor: '#0f766e',
  awayColor: '#7c2d12',
  homeLogoUrl: 'https://cdn.example/hawks.png',
  awayLogoUrl: null,
  stats: { homeFouls: 4, awayFouls: 6, homeTimeouts: 2, awayTimeouts: 3, possession: 'away' },
  roster: [
    { id: 'h1', team: 'home', name: 'Jordan Lee', number: '3', position: 'g', photoUrl: 'https://cdn.example/jl.png', stats: { PTS: '14', lane: 4 } },
    { id: 'h2', team: 'home', name: 'Maya Patel', number: '11', position: 'g', stats: {} },
    { id: 'a1', team: 'away', name: 'Sam Rivera', number: '3', position: 'f', stats: { PTS: '9' } },
  ],
};
const fmt = (n: number) => formatScore(findSport('basketball'), n);

describe('legacy seeded copy never reaches a screen (F38)', () => {
  it('treats the old seeded beer / airline / Kiss Cam / child-name copy as unset', () => {
    for (const legacy of [
      'BUDWEISER · OFFICIAL BEER PARTNER',
      'KING OF BEERS',
      'BROUGHT TO YOU BY JEWELED VOWS DIAMOND CO.',
      "BROUGHT TO YOU BY POPEYE'S",
      'JAMES, AGE 8',
      'Fly the Bulls and earn double AAdvantage miles all season long.',
      'Take the escalator to the upper concourse, walk left past Goose Island.',
    ]) {
      expect(ownCopy(legacy)).toBeUndefined();
    }
  });

  it('keeps anything the operator actually typed, including ordinary words the old samples used', () => {
    expect(ownCopy('HAPPY BIRTHDAY')).toBe('HAPPY BIRTHDAY');
    expect(ownCopy('Go Eagles!')).toBe('Go Eagles!');
    expect(ownCopy('  ')).toBeUndefined();
    expect(ownCopy(12)).toBe('12');
  });

  it('only scrubs a seeded sponsor NAME while its seeded tagline is still beside it', () => {
    expect(ownSponsorName('BUDWEISER', 'KING OF BEERS')).toBeUndefined();
    expect(ownSponsorName('AMERICAN AIRLINES', 'Going for great.')).toBeUndefined();
    // A venue that typed its real sponsor over its own tagline keeps it.
    expect(ownSponsorName('American Airlines', 'Official airline of the arena')).toBe('American Airlines');
    expect(ownSponsorName('Riverside Credit Union', undefined)).toBe('Riverside Credit Union');
  });
});

describe('live team view — game facts come only from the game (F28 / F29)', () => {
  it('reads score, fouls, timeouts, colours and logo from the snapshot', () => {
    const home = liveTeamView(SNAP, 'home', undefined, fmt);
    expect(home).toMatchObject({ name: 'Riverside Hawks', code: 'RIV', score: '41', fouls: 4, timeouts: 2, color: '#0f766e', logoUrl: 'https://cdn.example/hawks.png' });
    const away = liveTeamView(SNAP, 'away', undefined, fmt);
    expect(away).toMatchObject({ name: 'Lakeview Wolves', code: 'LAK', score: '37', fouls: 6, timeouts: 3 });
  });

  it('a score typed before binding can never mask the live score; identity overrides still apply', () => {
    const home = liveTeamView(SNAP, 'home', { score: 99, fouls: 0, code: 'HAWKS', color: '#123456' }, fmt);
    expect(home.score).toBe('41');
    expect(home.fouls).toBe(4);
    expect(home.code).toBe('HAWKS');
    expect(home.color).toBe('#123456');
  });

  it('a sport without fouls / timeouts reports null, not zero', () => {
    const v = liveTeamView({ ...SNAP, stats: {} }, 'home', undefined, fmt);
    expect(v.fouls).toBeNull();
    expect(v.timeouts).toBeNull();
  });
});

describe('typed (manual / demo) team view', () => {
  it('uses the demo only when handed one, and neutral HOME / dashes otherwise', () => {
    expect(typedTeamView(undefined, null, 'home')).toMatchObject({ name: 'HOME', code: 'HOME', score: '—' });
    expect(typedTeamView(undefined, DEMO_HOME, 'home')).toMatchObject({ name: 'Eagles', code: 'EAG' });
  });
  it('hasTypedTeam ignores empty strings and legacy seeded copy', () => {
    expect(hasTypedTeam({ name: '' })).toBe(false);
    expect(hasTypedTeam({ name: 'Eagles' })).toBe(true);
  });
  it('teamCode', () => {
    expect(teamCode('Lakeview Wolves')).toBe('LAK');
    expect(teamCode('')).toBe('—');
  });
});

describe('roster → lineup / player card', () => {
  it('takes the first N on the chosen side, in roster order', () => {
    const home = lineupFromRoster(SNAP.roster, 'home', 5);
    expect(home.map((p) => p.number)).toEqual(['3', '11']);
    expect(home[0]).toMatchObject({ first: 'JORDAN', last: 'LEE', position: 'G', photoUrl: 'https://cdn.example/jl.png' });
    expect(lineupFromRoster(SNAP.roster, 'away', 5).map((p) => p.last)).toEqual(['RIVERA']);
    expect(lineupFromRoster(null, 'home', 5)).toEqual([]);
  });
  it('finds a player by side + jersey number (the same number on both sides stays distinct)', () => {
    expect(findRosterPlayer(SNAP.roster, 'home', '3')?.id).toBe('h1');
    expect(findRosterPlayer(SNAP.roster, 'away', 3)?.id).toBe('a1');
    expect(findRosterPlayer(SNAP.roster, 'home', '')).toBeNull();
  });
  it('stat line skips timing hints and blanks', () => {
    expect(statLineFromRoster(SNAP.roster![0])).toEqual([{ label: 'PTS', value: '14' }]);
  });
  it('lineup count defaults by sport', () => {
    expect(defaultLineupCount('basketball')).toBe(5);
    expect(defaultLineupCount('volleyball')).toBe(6);
    expect(defaultLineupCount('soccer')).toBe(11);
    expect(defaultLineupCount('unknown')).toBe(5);
  });
  it('splitName', () => {
    expect(splitName('Mary Jo Smith')).toEqual({ first: 'MARY JO', last: 'SMITH' });
    expect(splitName('Pele')).toEqual({ first: '', last: 'PELE' });
    // A roster the school redacted to numbers only has no name at all.
    expect(splitName('')).toEqual({ first: '', last: '' });
  });
});

describe('head-to-head game stats', () => {
  it('pairs the sport\'s home/away numeric stats and reads the live values', () => {
    const rows = gameStatPairs(findSport('basketball')?.stats, SNAP.stats);
    expect(rows).toEqual([
      { label: 'FOULS', home: 4, away: 6 },
      { label: 'TIMEOUTS', home: 2, away: 3 },
    ]);
  });
  it('a missing live value shows a dash, never a zero', () => {
    const rows = gameStatPairs(findSport('basketball')?.stats, {});
    expect(rows[0]).toEqual({ label: 'FOULS', home: '—', away: '—' });
  });
});

describe('manual-score freshness stamp', () => {
  const now = new Date(2026, 9, 14, 20, 5);
  it('reads "AS OF <time>" today and adds the date on older edits', () => {
    expect(asOfLabel(new Date(2026, 9, 14, 19, 42).toISOString(), now)).toBe('AS OF 7:42 PM');
    expect(asOfLabel(new Date(2026, 9, 12, 9, 5).toISOString(), now)).toBe('AS OF OCT 12, 9:05 AM');
  });
  it('is empty when never stamped (the widget then shows no freshness claim at all)', () => {
    expect(asOfLabel(undefined, now)).toBe('');
    expect(asOfLabel('not a date', now)).toBe('');
  });
});
