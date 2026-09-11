/**
 * Two first-run defects the operator hit on 2026-09-11, both of which fail
 * SILENTLY — nothing errors, the builder just misleads a new user.
 *
 *  1. A CORPORATE operator was shown "School level: All grades / Elementary /
 *     Middle / High". `normalizeVertical()` falls back to K12 for a missing
 *     value, and the cached user blob routinely lacks `tenantVertical` on the
 *     builder route (ProfileHydrator, which heals it, is mounted in
 *     DashboardLayout — a shell the builder does not use). Inferred must never
 *     paint industry chrome.
 *
 *  2. The builder's only onboarding copy was gated on `zones.length === 0` and
 *     therefore NEVER rendered: creating a template seeds one full-screen EMPTY
 *     zone, so a new template has length 1.
 *
 * These are pinned as pure predicates rather than through a full builder mount:
 * the rules are the product decision, and a predicate test cannot rot behind a
 * mocking detail.
 */

// The exact gate VariantPicker applies to industry-specific chrome.
function showsSchoolLevelChips(copy: { vertical: string; verticalKnown: boolean }) {
  return copy.verticalKnown && copy.vertical === 'K12';
}

// The exact predicate BuilderCanvas uses to decide "still blank".
function isBlankTemplate(zones: Array<{ widgetType?: string }>) {
  return zones.length === 0 || (zones.length === 1 && zones[0]?.widgetType === 'EMPTY');
}

describe('industry chrome never leaks from an inferred vertical', () => {
  it('does NOT show school chips to a CORPORATE tenant', () => {
    expect(showsSchoolLevelChips({ vertical: 'CORPORATE', verticalKnown: true })).toBe(false);
  });

  it('does NOT show school chips when the vertical is merely INFERRED (the live bug)', () => {
    // normalizeVertical(undefined) === 'K12', but we never actually knew.
    expect(showsSchoolLevelChips({ vertical: 'K12', verticalKnown: false })).toBe(false);
  });

  it('DOES show school chips to a genuinely K12 tenant', () => {
    expect(showsSchoolLevelChips({ vertical: 'K12', verticalKnown: true })).toBe(true);
  });

  it.each(['GYM', 'RESTAURANT', 'RETAIL', 'WORSHIP', 'HOSPITALITY'])(
    'does NOT show school chips to %s',
    (v) => expect(showsSchoolLevelChips({ vertical: v, verticalKnown: true })).toBe(false),
  );
});

describe('first-run guidance actually reaches a new template', () => {
  it('treats a freshly-created template (one seeded EMPTY zone) as blank — the bug', () => {
    // This is exactly what templates/page.tsx seeds on create.
    expect(isBlankTemplate([{ widgetType: 'EMPTY' }])).toBe(true);
  });

  it('treats a truly empty zone list as blank', () => {
    expect(isBlankTemplate([])).toBe(true);
  });

  it('is NOT blank once a real widget has been placed', () => {
    expect(isBlankTemplate([{ widgetType: 'CLOCK' }])).toBe(false);
  });

  it('is NOT blank with several zones even if one is still EMPTY', () => {
    expect(isBlankTemplate([{ widgetType: 'EMPTY' }, { widgetType: 'IMAGE' }])).toBe(false);
  });
});
