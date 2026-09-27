/**
 * K-12 launch audit F26 — places from marks never invent a tie-break.
 */
import { competitionPlaces } from '../meet-places';

describe('competitionPlaces', () => {
  it('lower is better (times): equal marks share a place and the next skips ("1224")', () => {
    expect(competitionPlaces([55.0, 54.9, 55.0, 56.1], 'lower')).toEqual([2, 1, 2, 4]);
  });

  it('higher is better (dive totals)', () => {
    expect(competitionPlaces([245.6, 312.45, 245.6, 198.1], 'higher')).toEqual([2, 1, 2, 4]);
  });

  it('a three-way tie for first', () => {
    expect(competitionPlaces([10, 10, 10, 11], 'lower')).toEqual([1, 1, 1, 4]);
  });

  it('floating-point noise from minutes-to-seconds arithmetic never splits a tie', () => {
    // "1:08.04" parses to 60 + 8.04 = 68.03999999999999, not 68.04.
    expect(60 + 8.04).not.toBe(68.04);
    expect(competitionPlaces([60 + 8.04, 68.04], 'lower')).toEqual([1, 1]);
  });

  it('distinct marks keep strictly increasing places; empty input is fine', () => {
    expect(competitionPlaces([3, 1, 2], 'lower')).toEqual([3, 1, 2]);
    expect(competitionPlaces([], 'higher')).toEqual([]);
  });
});
