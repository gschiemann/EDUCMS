/**
 * K-12 launch lane A4 — K12-F18: the winner comes from the SPORT's result
 * model under the game's own rules, never from the raw score columns. The
 * audit's acceptance list, one case each: volleyball 3–1, pickleball 2–0, a
 * wrestling dual won against the last bout's winner, golf / cross-country low
 * score, a legitimate tie, and a corrected final.
 */
import {
  appendSetScore,
  finalCueKey,
  gameResult,
  readSetScores,
  SET_SCORES_MAX,
  setCountKeys,
} from './sports-result';
import { findRulesProfile, snapshotRules } from './sports-rules';
import { SPORT_DEFINITIONS, SPORTS } from './sports';

const final = (g: Record<string, unknown>) => gameResult({ status: 'FINAL', ...g });

describe('gameResult — the audit acceptance list (K12-F18)', () => {
  it('volleyball 3–1: the sets decide, the zeroed rally score is never a 0–0 tie', () => {
    const r = final({
      sport: 'volleyball',
      homeScore: 0,
      awayScore: 0,
      stats: {
        homeSets: 3,
        awaySets: 1,
        setScores: [
          { home: 25, away: 20 },
          { home: 22, away: 25 },
          { home: 25, away: 18 },
          { home: 25, away: 23 },
        ],
      },
    });
    expect(r).toMatchObject({ basis: 'sets', unit: 'sets', home: 3, away: 1, outcome: 'home', winner: 'home' });
    expect(r.homeText).toBe('3');
    expect(r.sets).toHaveLength(4);
    expect(finalCueKey(r)).toBe('status:final-home');
  });

  it('pickleball 2–0: games won decide', () => {
    const r = final({ sport: 'pickleball', homeScore: 0, awayScore: 0, stats: { homeGames: 0, awayGames: 2 } });
    expect(r).toMatchObject({ basis: 'sets', unit: 'games', home: 0, away: 2, winner: 'away', outcome: 'away' });
  });

  it('a wrestling dual is won on TEAM points, even when the other team won the last bout', () => {
    // Last bout (the score columns): away 9–2. Dual: home 30–27.
    const r = final({
      sport: 'wrestling',
      homeScore: 2,
      awayScore: 9,
      stats: { homeTeamPoints: 30, awayTeamPoints: 27 },
    });
    expect(r).toMatchObject({ basis: 'team-points', unit: 'team-points', home: 30, away: 27, winner: 'home' });
  });

  it('a single bout (team score never used) is decided by its match points', () => {
    const r = final({ sport: 'wrestling', homeScore: 4, awayScore: 7, stats: {} });
    expect(r).toMatchObject({ basis: 'score', unit: null, winner: 'away' });
  });

  it('golf and cross-country: the LOWER total wins', () => {
    expect(final({ sport: 'golf', homeScore: 312, awayScore: 305 })).toMatchObject({
      basis: 'low-score',
      winner: 'away',
    });
    expect(final({ sport: 'cross_country', homeScore: 27, awayScore: 30 })).toMatchObject({
      basis: 'low-score',
      winner: 'home',
    });
  });

  it('a low-score side with no total cannot win; both empty is no result, not a tie', () => {
    expect(final({ sport: 'cross_country', homeScore: 0, awayScore: 41 })).toMatchObject({ winner: 'away' });
    expect(final({ sport: 'golf', homeScore: 0, awayScore: 0 })).toMatchObject({ outcome: 'none', winner: null });
  });

  it('a legitimate tie is a tie (a 0–0 soccer draw, a level dual)', () => {
    const soccer = final({ sport: 'soccer', homeScore: 0, awayScore: 0 });
    expect(soccer).toMatchObject({ outcome: 'tie', winner: null });
    expect(finalCueKey(soccer)).toBe('status:final-tie');
    expect(final({ sport: 'wrestling', stats: { homeTeamPoints: 33, awayTeamPoints: 33 } })).toMatchObject({
      basis: 'team-points',
      outcome: 'tie',
    });
    expect(final({ sport: 'volleyball', stats: { homeSets: 1, awaySets: 1 } })).toMatchObject({
      basis: 'sets',
      outcome: 'tie',
    });
  });

  it('a corrected final is the result of the corrected revision', () => {
    const before = final({ sport: 'volleyball', version: 41, stats: { homeSets: 3, awaySets: 1 } });
    // Reopened, the fourth set re-credited to away, played to 2–3, ended again.
    const after = final({ sport: 'volleyball', version: 57, stats: { homeSets: 2, awaySets: 3 } });
    expect(before).toMatchObject({ winner: 'home', revision: 41 });
    expect(after).toMatchObject({ winner: 'away', revision: 57 });
    // The board payload names the revision `revision`.
    expect(gameResult({ sport: 'soccer', revision: 9 }).revision).toBe(9);
  });
});

describe('gameResult — honest fallbacks and edges', () => {
  it('names no winner before FINAL — only a leader', () => {
    const live = gameResult({ sport: 'volleyball', status: 'LIVE', homeScore: 3, awayScore: 11, stats: { homeSets: 2, awaySets: 0 } });
    expect(live).toMatchObject({ final: false, outcome: null, winner: null, leader: 'home' });
  });

  it('a set sport with no completed set is decided by the set in play', () => {
    expect(final({ sport: 'volleyball', homeScore: 18, awayScore: 12, stats: {} })).toMatchObject({
      basis: 'score',
      winner: 'home',
    });
    // Nothing played at all: no result — never a "0–0 TIE".
    expect(final({ sport: 'volleyball', homeScore: 0, awayScore: 0, stats: {} })).toMatchObject({ outcome: 'none' });
    expect(finalCueKey(final({ sport: 'pickleball' }))).toBe('status:final-none');
  });

  it('a meet with no points recorded has no result', () => {
    expect(final({ sport: 'track_and_field', homeScore: 0, awayScore: 0 })).toMatchObject({ outcome: 'none' });
    expect(final({ sport: 'track_and_field', homeScore: 74, awayScore: 63 })).toMatchObject({ winner: 'home' });
  });

  it('prints a judged total with its decimals, sets as whole numbers', () => {
    const gym = final({ sport: 'gymnastics', homeScore: 195825, awayScore: 196100 });
    expect(gym).toMatchObject({ winner: 'away', homeText: '195.825', awayText: '196.100' });
  });

  it('reads the game’s bound rules profile (sportForGame), not the base catalog', () => {
    const bo1 = findRulesProfile('pickleball-bo1-15@2026-09');
    expect(bo1).toBeDefined();
    const r = final({ sport: 'pickleball', rules: snapshotRules(bo1!), stats: { homeGames: 1, awayGames: 0 } });
    expect(r).toMatchObject({ basis: 'sets', winner: 'home' });
    const jh = findRulesProfile('uil-volleyball-junior-high@2026-27');
    const vb = final({ sport: 'volleyball', rules: snapshotRules(jh!), stats: { homeSets: 2, awaySets: 1 } });
    expect(vb).toMatchObject({ basis: 'sets', winner: 'home' });
  });

  it('shows the set history only when it accounts for every set won', () => {
    const partial = final({ sport: 'volleyball', stats: { homeSets: 3, awaySets: 0, setScores: [{ home: 25, away: 10 }] } });
    expect(partial.sets).toEqual([]);
  });

  it('never throws on an unknown sport or junk input', () => {
    expect(gameResult(null)).toMatchObject({ basis: 'score', outcome: null });
    expect(final({ sport: 'curling', homeScore: 5, awayScore: 3 })).toMatchObject({ winner: 'home' });
    expect(final({ sport: 'volleyball', stats: { homeSets: 'x', awaySets: -2 } })).toMatchObject({ outcome: 'none' });
  });

  it('every shipped sport resolves to a basis (no sport falls through silently)', () => {
    const basisOf = (key: string) => final({ sport: key, homeScore: 1, awayScore: 2, stats: {} }).basis;
    for (const def of SPORTS) {
      const expected = def.lowScoreWins ? 'low-score' : 'score';
      // A set sport / dual with no set / team points falls back to the score.
      expect(basisOf(def.key)).toBe(expected);
    }
    expect(SPORT_DEFINITIONS.golf.lowScoreWins).toBe(true);
    expect(SPORT_DEFINITIONS.cross_country.lowScoreWins).toBe(true);
  });
});

describe('set history helpers', () => {
  it('appends, sanitises and caps', () => {
    expect(appendSetScore({}, 25, 20)).toEqual([{ home: 25, away: 20 }]);
    const long = Array.from({ length: SET_SCORES_MAX }, () => ({ home: 11, away: 9 }));
    expect(appendSetScore({ setScores: long }, 15, 13)).toHaveLength(SET_SCORES_MAX);
    expect(readSetScores({ setScores: [null, { home: '25', away: 7.9 }, 'x'] })).toEqual([{ home: 25, away: 7 }]);
  });

  it('knows the set-count keys from the definition', () => {
    expect(setCountKeys(SPORT_DEFINITIONS.volleyball)).toEqual({ home: 'homeSets', away: 'awaySets' });
    expect(setCountKeys(SPORT_DEFINITIONS.pickleball)).toEqual({ home: 'homeGames', away: 'awayGames' });
    expect(setCountKeys(SPORT_DEFINITIONS.basketball)).toBeNull();
  });
});
