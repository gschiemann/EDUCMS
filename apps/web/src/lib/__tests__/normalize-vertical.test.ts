/**
 * Regression guard for the 2026-06-01 "every account shows School" report.
 *
 * Root cause was a DISPLAY fallback: the dashboard resolves a tenant's
 * industry from `tenantVertical`, and the old code did
 * `isVertical(v) ? v : DEFAULT_VERTICAL` — so a legacy value like
 * 'FITNESS' (renamed to GYM) failed the strict check and rendered as K12
 * (school). `normalizeVertical()` is the fix: canonical + legacy-alias +
 * case-insensitive resolution, K12 only for genuinely-unknown values.
 *
 * `useTenantCopy()` now uses normalizeVertical(), so this locks the
 * behavior in.
 */

import { normalizeVertical } from '@cms/api-types';

describe('normalizeVertical (industry display resolution)', () => {
  it('passes through canonical verticals', () => {
    expect(normalizeVertical('GYM')).toBe('GYM');
    expect(normalizeVertical('SPORTS')).toBe('SPORTS');
    expect(normalizeVertical('QSR')).toBe('QSR');
    expect(normalizeVertical('K12')).toBe('K12');
  });

  it('maps the legacy FITNESS value to GYM (not School)', () => {
    expect(normalizeVertical('FITNESS')).toBe('GYM');
  });

  it('is case-insensitive', () => {
    expect(normalizeVertical('gym')).toBe('GYM');
    expect(normalizeVertical('fitness')).toBe('GYM');
    expect(normalizeVertical('sports')).toBe('SPORTS');
  });

  it('falls back to K12 ONLY for genuinely missing / unknown values', () => {
    expect(normalizeVertical(null)).toBe('K12');
    expect(normalizeVertical(undefined)).toBe('K12');
    expect(normalizeVertical('')).toBe('K12');
    expect(normalizeVertical('totally-not-a-vertical')).toBe('K12');
    expect(normalizeVertical(42)).toBe('K12');
  });
});
