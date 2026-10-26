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
  isTimeLimited,
  keepsAsFallback,
  shouldDisplace,
  START_SLACK_MS,
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

// Launch QA U15 (2026-10-24). The web port (`playlistOps.isTimeLimited`) is
// pinned by the same cases in screenConflicts.test.ts.
describe('isTimeLimited — does a rule cover only part of the time?', () => {
  const NOW = Date.parse('2026-10-24T12:00:00Z');

  it('a day/time window is time-limited', () => {
    expect(isTimeLimited({ daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00', timeEnd: '15:00' }, NOW)).toBe(true);
    expect(isTimeLimited({ timeStart: '06:00', timeEnd: '10:00' }, NOW)).toBe(true);
    expect(isTimeLimited({ daysOfWeek: 'Sat,Sun' }, NOW)).toBe(true);
  });

  it('an end date is time-limited (the rule stops by itself)', () => {
    expect(isTimeLimited({ endTime: '2026-12-31T23:59:59Z' }, NOW)).toBe(true);
    expect(isTimeLimited({ endTime: new Date('2026-12-31T23:59:59Z') }, NOW)).toBe(true);
  });

  it('a start still ahead is time-limited; "now" (within a minute of slack) is not', () => {
    expect(isTimeLimited({ startTime: new Date(NOW + 2 * START_SLACK_MS).toISOString() }, NOW)).toBe(true);
    expect(isTimeLimited({ startTime: new Date(NOW + START_SLACK_MS / 2).toISOString() }, NOW)).toBe(false);
    expect(isTimeLimited({ startTime: new Date(NOW - 60_000).toISOString() }, NOW)).toBe(false);
  });

  it('no window, no end, a past start → always on', () => {
    expect(isTimeLimited({}, NOW)).toBe(false);
    expect(isTimeLimited({ startTime: '2026-01-01T00:00:00Z', endTime: null }, NOW)).toBe(false);
    expect(isTimeLimited({ startTime: 'not a date' }, NOW)).toBe(false);
  });
});

describe('keepsAsFallback — keep the always-on playlist instead of switching it off', () => {
  const SCHOOL = { daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00', timeEnd: '15:00', priority: 0 };

  it('an always-on replace rule under a time-limited publish is kept', () => {
    expect(keepsAsFallback({ priority: 0, mode: 'replace' }, SCHOOL)).toBe(true);
    expect(keepsAsFallback({}, SCHOOL)).toBe(true);
  });

  it('a windowed competitor is not kept (an overlap is still a replace)', () => {
    expect(keepsAsFallback({ timeStart: '11:00', timeEnd: '13:00' }, SCHOOL)).toBe(false);
  });

  it('an always-on publish keeps nothing — two always-on playlists cannot share a screen', () => {
    expect(keepsAsFallback({}, { priority: 0 })).toBe(false);
  });

  it('an append-mode competitor is not kept, and the existing fallback is not touched again', () => {
    expect(keepsAsFallback({ mode: 'append' }, SCHOOL)).toBe(false);
    expect(keepsAsFallback({ priority: FALLBACK_PRIORITY }, SCHOOL)).toBe(false);
  });

  it('publishing the fallback itself keeps (and displaces) nothing', () => {
    expect(keepsAsFallback({}, { priority: FALLBACK_PRIORITY, endTime: '2026-12-31T00:00:00Z' })).toBe(false);
  });
});
