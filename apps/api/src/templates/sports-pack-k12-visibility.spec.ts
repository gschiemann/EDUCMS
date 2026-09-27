import {
  ALL_PRESETS,
  SPORTS_PACK_PRESET_IDS,
  resolvePresetVerticalTag,
  verticalMatchOr,
} from './ensure-system-presets';
import { SPORTS_TEMPLATE_PRESETS } from './sports-presets';

/**
 * K-12 sports launch, lane B3 (2026-09-27). Greg: "make it visible for k-12 as
 * well" — the sports pack (the 44 SPORTS presets + the 7 scoreboard / ribbon /
 * scorebug presets in the general file) used to surface to SPORTS tenants only.
 *
 * The tag map IS production: the boot seeder re-syncs Template.vertical from
 * it on every deploy, and the gallery query is `verticalMatchOr`. So these
 * tests evaluate the real query conditions against the real tags.
 */

/** Mirrors the templates-list query: does `tag` surface for `vertical`? */
type VerticalCondition = {
  vertical:
    | string
    | { startsWith?: string; endsWith?: string; contains?: string };
};

function visibleTo(tag: string, vertical: string): boolean {
  return (verticalMatchOr(vertical) as VerticalCondition[]).some((c) => {
    const v = c.vertical;
    if (typeof v === 'string') return tag === v;
    if (v.startsWith) return tag.startsWith(v.startsWith);
    if (v.endsWith) return tag.endsWith(v.endsWith);
    if (v.contains) return tag.includes(v.contains);
    return false;
  });
}

const OTHER_VERTICALS = [
  'GYM',
  'RETAIL',
  'CORPORATE',
  'QSR',
  'FASHION',
  'BAR',
  'HEALTHCARE',
  'HOSPITALITY',
  'RESTAURANT',
  'WORSHIP',
];

describe('sports pack — visible to K-12 as well as SPORTS', () => {
  it('is the 51-preset pack: every SPORTS preset plus the seven scoreboard / ribbon / scorebug presets', () => {
    expect(SPORTS_TEMPLATE_PRESETS.length).toBe(44);
    expect(SPORTS_PACK_PRESET_IDS.length).toBe(51);
    expect(new Set(SPORTS_PACK_PRESET_IDS).size).toBe(51);
    // Every id is a real, seeded preset — a typo would tag nothing.
    const seeded = new Set(ALL_PRESETS.map((p) => p.id));
    for (const id of SPORTS_PACK_PRESET_IDS) expect(seeded.has(id)).toBe(true);
  });

  it('every preset in the pack surfaces to a SPORTS tenant AND a K-12 tenant', () => {
    for (const id of SPORTS_PACK_PRESET_IDS) {
      const tag = resolvePresetVerticalTag(id);
      expect(tag).toBe('SPORTS|K12');
      expect(visibleTo(tag, 'SPORTS')).toBe(true);
      expect(visibleTo(tag, 'K12')).toBe(true);
    }
  });

  it('no other vertical gains the pack (other verticals unchanged)', () => {
    for (const id of SPORTS_PACK_PRESET_IDS) {
      const tag = resolvePresetVerticalTag(id);
      for (const v of OTHER_VERTICALS) expect(visibleTo(tag, v)).toBe(false);
    }
  });

  it('nothing outside the pack changed tag because of it', () => {
    const pack = new Set(SPORTS_PACK_PRESET_IDS);
    const leaked = ALL_PRESETS.map((p) => p.id)
      .filter((id) => !pack.has(id))
      .filter((id) =>
        resolvePresetVerticalTag(id).split('|').includes('SPORTS'),
      );
    expect(leaked).toEqual([]);
  });
});
