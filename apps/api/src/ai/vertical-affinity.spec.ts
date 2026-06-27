import {
  VERTICALS,
  VERTICAL_DESIGN_AFFINITY,
  NEUTRAL_DESIGN_AFFINITY,
  getVerticalDesignAffinity,
} from '@cms/api-types';
import { ARCHETYPE_IDS, THEMES } from '@cms/signage-design';

// Drift guard (2026-06-27): VERTICAL_DESIGN_AFFINITY lives in @cms/api-types
// (dependency-light) but references @cms/signage-design archetype + theme ids by
// string. A typo'd id would silently fall back to clean-corporate and defeat the
// whole per-vertical fix. This test pins every id to a real one.
describe('VERTICAL_DESIGN_AFFINITY ↔ signage-design ids', () => {
  const archetypeIds = new Set<string>(ARCHETYPE_IDS as string[]);
  const themeIds = new Set<string>(THEMES.map((t) => t.id));

  it('exposes affinity for every canonical vertical', () => {
    for (const v of VERTICALS) {
      expect(VERTICAL_DESIGN_AFFINITY[v]).toBeDefined();
      expect(VERTICAL_DESIGN_AFFINITY[v].archetypes.length).toBeGreaterThan(0);
      expect(VERTICAL_DESIGN_AFFINITY[v].themes.length).toBeGreaterThan(0);
    }
  });

  it('every affinity archetype id resolves to a real archetype', () => {
    const all = [...Object.values(VERTICAL_DESIGN_AFFINITY), NEUTRAL_DESIGN_AFFINITY];
    for (const aff of all) {
      for (const a of aff.archetypes) {
        expect(archetypeIds.has(a)).toBe(true);
      }
    }
  });

  it('every affinity theme id resolves to a real theme', () => {
    const all = [...Object.values(VERTICAL_DESIGN_AFFINITY), NEUTRAL_DESIGN_AFFINITY];
    for (const aff of all) {
      for (const t of aff.themes) {
        expect(themeIds.has(t)).toBe(true);
      }
    }
  });

  it('resolves aliases + unknown to a usable affinity (never empty)', () => {
    expect(getVerticalDesignAffinity('FITNESS').archetypes.length).toBeGreaterThan(0); // alias → GYM
    expect(getVerticalDesignAffinity('qsr')).toBe(VERTICAL_DESIGN_AFFINITY.QSR); // lowercase
    expect(getVerticalDesignAffinity('venue')).toBe(NEUTRAL_DESIGN_AFFINITY); // unset
    expect(getVerticalDesignAffinity(undefined)).toBe(NEUTRAL_DESIGN_AFFINITY);
    expect(getVerticalDesignAffinity('totally-bogus')).toBe(NEUTRAL_DESIGN_AFFINITY);
  });
});
