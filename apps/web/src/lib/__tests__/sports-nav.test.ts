import { showsSportsNav } from '../sports-nav';

/**
 * K-12 sports launch (2026-09-27): a school gets the Sports (game day) entry
 * in its navigation; a SPORTS venue keeps it; no other vertical gains it; and
 * an INFERRED K-12 (the vertical was never actually known) never paints it.
 */
describe('showsSportsNav', () => {
  it('a sports venue keeps the entry', () => {
    expect(showsSportsNav({ vertical: 'SPORTS', verticalKnown: true })).toBe(true);
  });

  it('a K-12 school now gets it', () => {
    expect(showsSportsNav({ vertical: 'K12', verticalKnown: true })).toBe(true);
    // callers that do not carry verticalKnown still work
    expect(showsSportsNav({ vertical: 'K12' })).toBe(true);
  });

  it('an inferred K-12 does not', () => {
    expect(showsSportsNav({ vertical: 'K12', verticalKnown: false })).toBe(false);
  });

  it.each(['GYM', 'RETAIL', 'CORPORATE', 'QSR', 'FASHION', 'BAR', 'HEALTHCARE', 'HOSPITALITY', 'RESTAURANT', 'WORSHIP'])(
    '%s is unchanged (no entry)',
    (vertical) => {
      expect(showsSportsNav({ vertical, verticalKnown: true })).toBe(false);
    },
  );
});
