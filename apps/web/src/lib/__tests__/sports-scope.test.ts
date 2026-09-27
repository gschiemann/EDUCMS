/**
 * K-12 launch audit F26 — which sports VenueOS RUNS (a game) and which it
 * only DISPLAYS results for (a meet). The scope comes from the catalog's own
 * `mode`, so a sport can never be a "game" in one place and a "results
 * display" in another.
 */
import { SPORTS, SPORT_DEFINITIONS, findSport } from '@cms/api-types';
import { resultsKind, sportScope } from '../sports-scope';

describe('sportScope', () => {
  it('every leaderboard sport is a results display; every head-to-head sport is a game', () => {
    for (const def of Object.values(SPORT_DEFINITIONS)) {
      expect([def.key, sportScope(def)]).toEqual([def.key, def.mode === 'LEADERBOARD' ? 'results' : 'game']);
      // a key and a definition answer the same
      expect(sportScope(def.key)).toBe(sportScope(def));
    }
  });

  it('the meet sports the audit named are all results displays', () => {
    for (const key of ['track_and_field', 'cross_country', 'swimming', 'diving', 'gymnastics', 'golf', 'competitive_cheer']) {
      expect([key, sportScope(key)]).toEqual([key, 'results']);
    }
    expect(sportScope('football')).toBe('game');
    expect(sportScope('wrestling')).toBe('game');
  });

  it('an unknown or missing sport is treated as a game (what the console does)', () => {
    expect(sportScope('curling')).toBe('game');
    expect(sportScope(null)).toBe('game');
    expect(sportScope(undefined)).toBe('game');
  });
});

describe('resultsKind', () => {
  it('names what stays with the officials, per sport', () => {
    expect(resultsKind('swimming')).toBe('timed');
    expect(resultsKind('track_and_field')).toBe('timed');
    expect(resultsKind('cross_country')).toBe('timed');
    expect(resultsKind('swimming_diving')).toBe('timed');
    expect(resultsKind('diving')).toBe('dive');
    expect(resultsKind('gymnastics')).toBe('judged');
    expect(resultsKind('competitive_cheer')).toBe('judged');
    expect(resultsKind('golf')).toBe('golf');
    expect(resultsKind('basketball')).toBeNull();
  });

  it('drift guard: every leaderboard sport in the picker has its own sentence, not the generic one', () => {
    const generic = SPORTS.filter((s) => s.mode === 'LEADERBOARD' && resultsKind(s) === 'other').map((s) => s.key);
    expect(generic).toEqual([]);
  });

  it('a leaderboard sport added later falls back to the generic sentence, never a wrong one', () => {
    const future = { ...findSport('golf')!, key: 'archery' };
    expect(resultsKind(future)).toBe('other');
    expect(sportScope(future)).toBe('results');
  });
});
