/**
 * The overlap rule, as pure math — the server half of the client rule that
 * `playlistOps.windowsCollide` already enforces in the UI.
 *
 * Any drift between the two re-opens the hole this closed: the client going
 * silent for breakfast-vs-lunch while the server stands the other rule down
 * anyway. These cases mirror `screenConflicts.test.ts` deliberately.
 */

import {
  FALLBACK_PRIORITY,
  isAlwaysOn,
  isFallbackRule,
  shouldDisplace,
  windowsCollide,
} from './schedule-window-overlap';

const w = (daysOfWeek: string | null, timeStart: string | null, timeEnd: string | null) =>
  ({ daysOfWeek, timeStart, timeEnd });

describe('windowsCollide', () => {
  it('breakfast beside lunch does not collide', () => {
    expect(windowsCollide(w(null, '06:00', '10:00'), w(null, '11:00', '14:00'))).toBe(false);
  });
  it('an overlap collides', () => {
    expect(windowsCollide(w(null, '06:00', '10:00'), w(null, '09:00', '12:00'))).toBe(true);
  });
  it('touching edges do not collide', () => {
    expect(windowsCollide(w(null, '08:00', '12:00'), w(null, '12:00', '17:00'))).toBe(false);
  });
  it('different days never collide at identical hours', () => {
    expect(windowsCollide(w('Sat,Sun', '09:00', '17:00'), w('Mon,Tue,Wed,Thu,Fri', '09:00', '17:00'))).toBe(false);
  });
  it('ALWAYS collides with everything — a missing field is "no constraint", not "no overlap"', () => {
    expect(windowsCollide({}, w(null, '06:00', '10:00'))).toBe(true);
    expect(windowsCollide(w(null, '06:00', '10:00'), {})).toBe(true);
    expect(windowsCollide({}, {})).toBe(true);
  });
  it('an EMPTY daysOfWeek means every day, never zero days', () => {
    // '' reaches here only in theory — the zero-day case is rejected at the API
    // boundary — but reading it as "no days" would silently stop displacing.
    expect(windowsCollide(w('', '09:00', '17:00'), w('Mon', '09:00', '17:00'))).toBe(true);
  });
});

describe('the fallback tier', () => {
  it('is always-on at a negative priority', () => {
    expect(isFallbackRule({ priority: FALLBACK_PRIORITY })).toBe(true);
    expect(isAlwaysOn({})).toBe(true);
  });
  it('a NEGATIVE priority with a window is NOT a fallback', () => {
    expect(isFallbackRule({ priority: -1, timeStart: '06:00', timeEnd: '10:00' })).toBe(false);
  });
  it('an ordinary always-on rule at priority 0 is NOT a fallback', () => {
    expect(isFallbackRule({ priority: 0 })).toBe(false);
  });
});

describe('shouldDisplace', () => {
  it('OMITTED incoming keeps the pre-2026-09-16 behaviour exactly', () => {
    // Both existing displacement specs call the helper without a window, and
    // the 2026-06-26 group-supersession fix depends on this staying true.
    expect(shouldDisplace(w(null, '06:00', '10:00'))).toBe(true);
    expect(shouldDisplace({ priority: FALLBACK_PRIORITY })).toBe(true);
  });
  it('spares a non-overlapping rule', () => {
    expect(shouldDisplace(w(null, '11:00', '14:00'), w(null, '06:00', '10:00'))).toBe(false);
  });
  it('stands down an overlapping rule', () => {
    expect(shouldDisplace(w(null, '09:00', '12:00'), w(null, '06:00', '10:00'))).toBe(true);
  });
  it('NEVER stands down the fallback, whatever is publishing', () => {
    expect(shouldDisplace({ priority: FALLBACK_PRIORITY }, w(null, '06:00', '10:00'))).toBe(false);
    expect(shouldDisplace({ priority: FALLBACK_PRIORITY }, {})).toBe(false);
  });
  it('publishing the fallback stands down NOTHING', () => {
    expect(shouldDisplace(w(null, '06:00', '10:00'), { priority: FALLBACK_PRIORITY })).toBe(false);
    expect(shouldDisplace({}, { priority: FALLBACK_PRIORITY })).toBe(false);
  });
});
