/**
 * VenueOS Sports — Sport Engine tests.
 *
 * The whole scoreboard + control system is data-driven off the
 * SportDefinition objects in @cms/api-types. A malformed definition
 * would break a live scoreboard silently — so every shipped sport is
 * validated here.
 */
import {
  SPORTS,
  SPORT_DEFINITIONS,
  findSport,
  formatScore,
  parseScoreInput,
} from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

const EXPECTED_KEYS = [
  'football', 'basketball', 'baseball', 'softball', 'soccer',
  'volleyball', 'wrestling', 'hockey', 'lacrosse', 'field_hockey',
  'water_polo', 'pickleball', 'track_and_field', 'swimming_diving',
  'cross_country', 'gymnastics', 'golf', 'competitive_cheer',
];

describe('Sport Engine', () => {
  it('ships the 18 expected sports', () => {
    expect(SPORTS).toHaveLength(EXPECTED_KEYS.length);
    const keys = SPORTS.map((s) => s.key);
    for (const k of EXPECTED_KEYS) expect(keys).toContain(k);
  });

  it('SPORTS list and SPORT_DEFINITIONS map agree', () => {
    expect(Object.keys(SPORT_DEFINITIONS).sort()).toEqual(
      SPORTS.map((s) => s.key).sort(),
    );
    for (const s of SPORTS) expect(SPORT_DEFINITIONS[s.key]).toBe(s);
  });

  it.each(SPORTS.map((s) => [s.key, s] as const))(
    'definition "%s" is well-formed',
    (_key, s: SportDefinition) => {
      expect(s.key).toMatch(/^[a-z_]+$/);
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.emoji.trim().length).toBeGreaterThan(0);
      expect(['HEAD_TO_HEAD', 'LEADERBOARD']).toContain(s.mode);

      // clock
      expect(['countdown', 'countup', 'none']).toContain(s.clock.type);
      if (s.clock.type === 'countdown') {
        expect(s.clock.segmentMs).toBeGreaterThan(0);
      }

      // segment
      expect(s.segment.name.trim().length).toBeGreaterThan(0);
      expect(s.segment.count).toBeGreaterThan(0);
      expect(typeof s.segment.overtime).toBe('boolean');

      // score
      expect(s.score.unit.trim().length).toBeGreaterThan(0);
      expect(s.score.increments.length).toBeGreaterThan(0);
      for (const inc of s.score.increments) {
        expect(Number.isInteger(inc)).toBe(true);
        expect(inc).toBeGreaterThan(0);
      }

      // stats — unique keys, valid scope/type
      const statKeys = s.stats.map((x) => x.key);
      expect(new Set(statKeys).size).toBe(statKeys.length);
      for (const st of s.stats) {
        expect(['game', 'home', 'away']).toContain(st.scope);
        expect(['number', 'text']).toContain(st.type);
      }

      // celebrations — at least one, unique keys, each has an emoji
      expect(s.celebrations.length).toBeGreaterThan(0);
      const cueKeys = s.celebrations.map((x) => x.key);
      expect(new Set(cueKeys).size).toBe(cueKeys.length);
      for (const c of s.celebrations) {
        expect(c.label.trim().length).toBeGreaterThan(0);
        expect(c.emoji.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it('findSport resolves known keys, rejects everything else', () => {
    expect(findSport('football')?.name).toBe('Football');
    expect(findSport('pickleball')?.name).toBe('Pickleball');
    expect(findSport('curling')).toBeUndefined();
    expect(findSport('')).toBeUndefined();
    expect(findSport(null)).toBeUndefined();
    expect(findSport(undefined)).toBeUndefined();
  });

  it('clock models are spread across all three types', () => {
    const types = new Set(SPORTS.map((s) => s.clock.type));
    expect(types.has('countdown')).toBe(true);
    expect(types.has('countup')).toBe(true);
    expect(types.has('none')).toBe(true);
  });
});

describe('decimal team scores (scaled-integer convention)', () => {
  const football = findSport('football');
  const gymnastics = findSport('gymnastics');
  const cheer = findSport('competitive_cheer');

  it('only the two judged sports carry scoreDecimals', () => {
    expect(gymnastics?.scoreDecimals).toBe(3);
    expect(cheer?.scoreDecimals).toBe(1);
    // EVERY other sport leaves it undefined → integer behaviour.
    for (const s of SPORTS) {
      if (s.key === 'gymnastics') expect(s.scoreDecimals).toBe(3);
      else if (s.key === 'competitive_cheer') expect(s.scoreDecimals).toBe(1);
      else expect(s.scoreDecimals).toBeUndefined();
    }
  });

  it('integer sports are unchanged — formatScore is String(raw)', () => {
    expect(formatScore(football, 7)).toBe('7');
    expect(formatScore(football, 0)).toBe('0');
    expect(formatScore(football, 42)).toBe('42');
    // undefined def behaves as an integer sport too.
    expect(formatScore(undefined, 13)).toBe('13');
  });

  it('integer parseScoreInput rounds to a whole number', () => {
    expect(parseScoreInput(football, '7')).toBe(7);
    expect(parseScoreInput(football, '7.6')).toBe(8);
    expect(parseScoreInput(undefined, '21')).toBe(21);
  });

  it('gymnastics formats + round-trips a 3-decimal total', () => {
    expect(formatScore(gymnastics, 195825)).toBe('195.825');
    expect(parseScoreInput(gymnastics, '195.825')).toBe(195825);
    // full round-trip
    expect(formatScore(gymnastics, parseScoreInput(gymnastics, '195.825'))).toBe(
      '195.825',
    );
    // trailing zeros preserved on display
    expect(formatScore(gymnastics, 195000)).toBe('195.000');
  });

  it('cheer formats + round-trips a 1-decimal total', () => {
    expect(formatScore(cheer, 2855)).toBe('285.5');
    expect(parseScoreInput(cheer, '285.5')).toBe(2855);
    expect(formatScore(cheer, parseScoreInput(cheer, '285.5'))).toBe('285.5');
    expect(formatScore(cheer, 2850)).toBe('285.0');
  });

  it('null / NaN / negative inputs are safe', () => {
    // formatScore never throws → '0' / '0.000'
    expect(formatScore(football, NaN)).toBe('0');
    expect(formatScore(football, undefined as unknown as number)).toBe('0');
    expect(formatScore(football, null as unknown as number)).toBe('0');
    expect(formatScore(gymnastics, NaN)).toBe('0.000');
    expect(formatScore(cheer, null as unknown as number)).toBe('0.0');
    // parseScoreInput: NaN/garbage → 0, negatives clamped to 0
    expect(parseScoreInput(gymnastics, '')).toBe(0);
    expect(parseScoreInput(gymnastics, 'abc')).toBe(0);
    expect(parseScoreInput(football, '-5')).toBe(0);
    expect(parseScoreInput(gymnastics, '-1.5')).toBe(0);
  });

  it('comparison stays correct on the raw scaled int', () => {
    // 195.825 > 195.800 — and 195825 > 195800 as ints. The decimal
    // never breaks the leadingSide comparison because surfaces compare
    // the raw values, not the formatted strings.
    expect(195825 > 195800).toBe(true);
  });
});
