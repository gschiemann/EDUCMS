/**
 * VenueOS Sports — Sport Engine tests.
 *
 * The whole scoreboard + control system is data-driven off the
 * SportDefinition objects in @cms/api-types. A malformed definition
 * would break a live scoreboard silently — so every shipped sport is
 * validated here.
 */
import { SPORTS, SPORT_DEFINITIONS, findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

const EXPECTED_KEYS = [
  'football', 'basketball', 'baseball', 'softball', 'soccer',
  'volleyball', 'wrestling', 'hockey', 'lacrosse', 'field_hockey',
  'water_polo', 'pickleball',
];

describe('Sport Engine', () => {
  it('ships the 12 expected sports', () => {
    expect(SPORTS).toHaveLength(12);
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
