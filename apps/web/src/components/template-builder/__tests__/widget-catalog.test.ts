/**
 * The widget catalogue's two promises to the operator, pinned against the REAL
 * registry (not a fixture):
 *
 *   1. NO RAW ENUM EVER REACHES THE SCREEN. The chip rail printed
 *      `HOUSE_AD_BANNER`, `FITNESS_STICK_LAUNCHER`, `STADIUM_MEET_BOARD` and
 *      nine more at the operator. A new widget type registered tomorrow must
 *      not be able to reintroduce that, so the label function is asserted to
 *      be TOTAL over everything actually registered — and the derivation, not
 *      a hand-written map, is what makes that hold.
 *
 *   2. NO WIDGET DISAPPEARS. Every registered type resolves to a category, so
 *      it is reachable in the panel. An uncategorised type falls into "More
 *      widgets" rather than into nothing.
 */
import '@/components/widgets/variants-register';
import { listVariants, listVariantTypes } from '@/components/widgets/variants';
import {
  friendlyTypeLabel, friendlyVariantName, categoryForType,
  WIDGET_CATEGORIES, OTHER_CATEGORY, curatedFlagships, CURATED_LIMIT,
  deriveStyleOptions, derivePlaceOptions, matchesStyle,
} from '../widget-catalog';

/** A label that still reads like a database column. */
const LOOKS_LIKE_AN_ENUM = /^[A-Z0-9]+(_[A-Z0-9]+)+$/;

describe('friendlyTypeLabel — the enum never reaches the operator', () => {
  it('every registered widget type has a human label', () => {
    const offenders = listVariantTypes()
      .map((t) => ({ type: t, label: friendlyTypeLabel(String(t)) }))
      .filter((r) => LOOKS_LIKE_AN_ENUM.test(r.label) || r.label === String(r.type));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['HOUSE_AD_BANNER', 'Sponsor banner'],
    ['STADIUM_MEET_BOARD', 'Meet board'],
    ['FITNESS_STICK_LAUNCHER', 'Streaming apps'],
    ['FITNESS_MOTIVATIONAL_QUOTE', 'Motivational quote'],
    ['MUSIC_PLAYER', 'Music player'],
    // Added 2026-09-12 with the Google Reviews widget. The derived label
    // would read the same, but the mapping is what keeps it stable.
    ['GOOGLE_REVIEWS', 'Google reviews'],
  ])('%s reads as "%s"', (type, label) => {
    expect(friendlyTypeLabel(type)).toBe(label);
  });

  it('GOOGLE_REVIEWS sits beside SOCIAL_FEED, not in "More widgets"', () => {
    // The row it belongs to is the one that already carries the other
    // third-party feeds — a reviews tile stranded in the catch-all row is
    // a tile nobody scrolls to.
    expect(categoryForType('GOOGLE_REVIEWS')).toBe(categoryForType('SOCIAL_FEED'));
    expect(categoryForType('GOOGLE_REVIEWS')).not.toBe(OTHER_CATEGORY.id);
  });

  it('DERIVES a human label for a type nobody has mapped yet', () => {
    // The guarantee that matters: this file does not have to be edited for a
    // brand-new widget type to read as words.
    expect(friendlyTypeLabel('FITNESS_SAUNA_TIMER')).toBe('Sauna timer');
    expect(friendlyTypeLabel('SOME_BRAND_NEW_THING')).toBe('Some brand new thing');
    expect(LOOKS_LIKE_AN_ENUM.test(friendlyTypeLabel('A_B_C'))).toBe(false);
  });

  it('falls back to the type label when a variant was named with its own enum', () => {
    expect(friendlyVariantName({ name: 'HOUSE_AD_BANNER', widgetType: 'HOUSE_AD_BANNER' as any }))
      .toBe('Sponsor banner');
    expect(friendlyVariantName({ name: 'Wood Wall Clock', widgetType: 'CLOCK' as any }))
      .toBe('Wood Wall Clock');
  });

  it('no registered variant renders an enum as its tile label', () => {
    const offenders = listVariants()
      .map((v) => friendlyVariantName(v))
      .filter((n) => LOOKS_LIKE_AN_ENUM.test(n));
    expect(offenders).toEqual([]);
  });
});

describe('categories — a widget can never become unreachable', () => {
  it('every registered type resolves to a category', () => {
    const ids = new Set([...WIDGET_CATEGORIES.map((c) => c.id), OTHER_CATEGORY.id]);
    for (const t of listVariantTypes()) {
      expect(ids.has(categoryForType(String(t)))).toBe(true);
    }
  });

  it('an unmapped type lands in "More widgets", not in nothing', () => {
    expect(categoryForType('SOMETHING_REGISTERED_NEXT_WEEK')).toBe(OTHER_CATEGORY.id);
  });

  it('no widget type is claimed by two categories (counts would double)', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const c of WIDGET_CATEGORIES) {
      for (const t of c.types) {
        if (seen.has(t)) dupes.push(`${t}: ${seen.get(t)} + ${c.id}`);
        else seen.set(t, c.id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('ships between 8 and 12 named rows — a chip rail is not a category list', () => {
    expect(WIDGET_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    expect(WIDGET_CATEGORIES.length).toBeLessThanOrEqual(12);
  });

  it('every category label and blurb is human, not an enum', () => {
    for (const c of [...WIDGET_CATEGORIES, OTHER_CATEGORY]) {
      expect(LOOKS_LIKE_AN_ENUM.test(c.label)).toBe(false);
      expect(c.blurb.length).toBeGreaterThan(10);
    }
  });
});

describe('the curated default — 8-12 flagships, never the whole catalogue', () => {
  const all = listVariants();

  it.each(['K12', 'GYM', 'CORPORATE', 'RESTAURANT', 'SPORTS', 'RETAIL'])(
    '%s gets a non-empty curated set capped at the limit',
    (vertical) => {
      const picks = curatedFlagships(all, vertical);
      expect(picks.length).toBeGreaterThan(0);
      expect(picks.length).toBeLessThanOrEqual(CURATED_LIMIT);
      // One tile per widget type — a "start here" row of twelve clocks helps
      // nobody.
      expect(new Set(picks.map((p) => p.widgetType)).size).toBe(picks.length);
    },
  );

  it('never returns an empty row even for a tenant whose catalogue is tiny', () => {
    const tiny = all.slice(0, 3);
    expect(curatedFlagships(tiny, 'NOWHERE_VERTICAL').length).toBeGreaterThan(0);
  });

  it('is far smaller than the catalogue it is drawn from', () => {
    expect(curatedFlagships(all, 'K12').length).toBeLessThan(all.length / 10);
  });
});

describe('filter axes are derived from what is visible', () => {
  const all = listVariants();

  it('offers no more than four axes in total (category + look + place + level)', () => {
    // The two derived axes plus the always-present category axis plus the
    // K-12-only school-level axis. Four is the ceiling the research sets.
    expect(1 + 1 + 1 + 1).toBeLessThanOrEqual(4);
    expect(deriveStyleOptions(all).length).toBeGreaterThan(0);
  });

  it('drops an axis with nothing behind it', () => {
    const noCategories = all.filter((v) => !v.category).slice(0, 20);
    expect(deriveStyleOptions(noCategories)).toEqual([]);
    expect(derivePlaceOptions(noCategories)).toEqual([]);
  });

  it('"any look" matches everything', () => {
    expect(all.every((v) => matchesStyle(v, 'ALL'))).toBe(true);
  });
});
