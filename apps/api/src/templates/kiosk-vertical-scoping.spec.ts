import { resolvePresetVerticalTag, verticalMatchOr } from './ensure-system-presets';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';

/**
 * Kiosk vertical scoping (2026-08-16).
 *
 * The 19 touch kiosks shipped tagged 'ALL' ("for testing ease", 2026-06-03),
 * which surfaced a Bar & Tap House kiosk, Fast-Food Self-Order, and a
 * Veterinary Check-In inside every K-12 school's gallery. Operator: "i saw
 * incorrect templates in k-12... we gotta make this perfect."
 *
 * These tests pin the retag and the invariant behind it: what a vertical's
 * gallery shows is decided by the tag map, and the tag map must never let a
 * kiosk leak into a vertical it doesn't belong to. The boot seeder re-syncs
 * Template.vertical from this map on every deploy, so the map IS production.
 */

/** Mirrors the templates-list query: does `tag` surface for `vertical`? */
function visibleTo(tag: string, vertical: string): boolean {
  // verticalMatchOr builds Prisma OR conditions; evaluate them literally.
  const conds = verticalMatchOr(vertical);
  return conds.some((c: any) => {
    const v = c.vertical;
    if (typeof v === 'string') return tag === v;
    if (v.startsWith) return tag.startsWith(v.startsWith);
    if (v.endsWith) return tag.endsWith(v.endsWith);
    if (v.contains) return tag.includes(v.contains);
    return false;
  });
}

const kioskIds = SYSTEM_TEMPLATE_PRESETS.filter((p) => p.category === 'KIOSK').map((p) => p.id);

describe('touch-kiosk vertical scoping', () => {
  it('no kiosk preset is tagged ALL anymore — the universal tier is over', () => {
    for (const id of kioskIds) {
      expect(resolvePresetVerticalTag(id)).not.toBe('ALL');
      expect(resolvePresetVerticalTag(id).split('|')).not.toContain('ALL');
    }
  });

  it('a K-12 school sees ONLY the kiosks a school would deploy', () => {
    const k12Kiosks = kioskIds.filter((id) => visibleTo(resolvePresetVerticalTag(id), 'K12')).sort();
    expect(k12Kiosks).toEqual(
      [
        'preset-kiosk-food-nutrition', // cafeteria allergen board — real K-12 need
        'preset-kiosk-museum', // exhibits — science fairs, open houses
        'preset-kiosk-museum-quest',
        'preset-kiosk-school', // Campus Hub
        'preset-kiosk-school-frontoffice',
      ].sort(),
    );
  });

  it('the kiosks the operator flagged can NEVER reach a K-12 gallery', () => {
    for (const id of [
      'preset-kiosk-bar',
      'preset-kiosk-bar-jukebox',
      'preset-kiosk-qsr',
      'preset-kiosk-qsr-pickup',
      'preset-kiosk-gym',
      'preset-kiosk-gym-workout',
      'preset-kiosk-clinic',
      'preset-kiosk-vet',
      'preset-kiosk-office',
      'preset-kiosk-office-room',
      'preset-kiosk-realestate',
      'preset-kiosk-realestate-models',
      'preset-kiosk-realestate-resident',
      'preset-kiosk-food',
    ]) {
      expect(visibleTo(resolvePresetVerticalTag(id), 'K12')).toBe(false);
    }
  });

  it('every kiosk still surfaces in at least one vertical (scoping must never orphan one)', () => {
    const verticals = ['K12', 'GYM', 'RETAIL', 'CORPORATE', 'QSR', 'FASHION', 'BAR', 'HEALTHCARE', 'HOSPITALITY', 'RESTAURANT', 'SPORTS', 'WORSHIP'];
    for (const id of kioskIds) {
      const tag = resolvePresetVerticalTag(id);
      expect(verticals.some((v) => visibleTo(tag, v))).toBe(true);
    }
  });

  it('each vertical keeps its own trade kiosks (spot checks)', () => {
    expect(visibleTo(resolvePresetVerticalTag('preset-kiosk-bar'), 'BAR')).toBe(true);
    expect(visibleTo(resolvePresetVerticalTag('preset-kiosk-qsr'), 'QSR')).toBe(true);
    expect(visibleTo(resolvePresetVerticalTag('preset-kiosk-gym'), 'GYM')).toBe(true);
    expect(visibleTo(resolvePresetVerticalTag('preset-kiosk-clinic'), 'HEALTHCARE')).toBe(true);
    expect(visibleTo(resolvePresetVerticalTag('preset-kiosk-vet'), 'HEALTHCARE')).toBe(true);
    expect(visibleTo(resolvePresetVerticalTag('preset-kiosk-food'), 'RESTAURANT')).toBe(true);
  });
});
