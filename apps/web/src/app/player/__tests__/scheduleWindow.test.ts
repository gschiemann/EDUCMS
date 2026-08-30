/**
 * Schedule windows (2026-08-30 deep audit B-P0-1/B-P0-2). These pin the
 * shapes that were broken or latching before this module existed.
 */
import { isWindowOpen, windowSignature } from '../scheduleWindow';

// Local-time constructor: year, monthIndex, day, h, m — Jan 2026: the 5th is a Monday.
const at = (day: number, h: number, m = 0) => new Date(2026, 0, day, h, m);
const MON = 5, TUE = 6, FRI = 9, SAT = 10, SUN = 11;

describe('isWindowOpen — simple windows', () => {
  it('no fields → always open', () => {
    expect(isWindowOpen(null, at(MON, 12))).toBe(true);
    expect(isWindowOpen({}, at(MON, 12))).toBe(true);
    expect(isWindowOpen({ daysOfWeek: null, timeStart: null, timeEnd: null }, at(MON, 12))).toBe(true);
  });

  it('day gate', () => {
    const sched = { daysOfWeek: 'Mon,Tue,Wed,Thu,Fri' };
    expect(isWindowOpen(sched, at(MON, 12))).toBe(true);
    expect(isWindowOpen(sched, at(SAT, 12))).toBe(false);
  });

  it('same-day time window (the lunch menu): 11:00–14:00', () => {
    const sched = { timeStart: '11:00', timeEnd: '14:00' };
    expect(isWindowOpen(sched, at(MON, 10, 59))).toBe(false);
    expect(isWindowOpen(sched, at(MON, 11, 0))).toBe(true);
    expect(isWindowOpen(sched, at(MON, 14, 0))).toBe(true);
    expect(isWindowOpen(sched, at(MON, 14, 1))).toBe(false);
  });

  it('start-only and end-only stay open-ended', () => {
    expect(isWindowOpen({ timeStart: '08:00' }, at(MON, 7))).toBe(false);
    expect(isWindowOpen({ timeStart: '08:00' }, at(MON, 23))).toBe(true);
    expect(isWindowOpen({ timeEnd: '16:00' }, at(MON, 15))).toBe(true);
    expect(isWindowOpen({ timeEnd: '16:00' }, at(MON, 17))).toBe(false);
  });
});

describe('isWindowOpen — THE B-P0-2 CASE: overnight wrap', () => {
  const night = { timeStart: '22:00', timeEnd: '06:00' };

  it('22:00–06:00 is OPEN at 23:00 and at 02:00 (was never open before)', () => {
    expect(isWindowOpen(night, at(MON, 23))).toBe(true);
    expect(isWindowOpen(night, at(TUE, 2))).toBe(true);
  });

  it('…and CLOSED mid-day', () => {
    expect(isWindowOpen(night, at(MON, 12))).toBe(false);
    expect(isWindowOpen(night, at(MON, 21, 59))).toBe(false);
    expect(isWindowOpen(night, at(MON, 6, 1))).toBe(false);
  });

  it('boundaries are inclusive on both halves', () => {
    expect(isWindowOpen(night, at(MON, 22, 0))).toBe(true);
    expect(isWindowOpen(night, at(MON, 6, 0))).toBe(true);
  });

  it('THE DAY-SEMANTICS RULE: the start day owns the wrap — Fri 22:00–06:00 covers Sat 02:00, not Sun 02:00', () => {
    const friNight = { daysOfWeek: 'Fri', timeStart: '22:00', timeEnd: '06:00' };
    expect(isWindowOpen(friNight, at(FRI, 23))).toBe(true);   // Friday 23:00
    expect(isWindowOpen(friNight, at(SAT, 2))).toBe(true);    // Saturday 02:00 ← Friday's night
    expect(isWindowOpen(friNight, at(SAT, 23))).toBe(false);  // Saturday 23:00 is not Friday night
    expect(isWindowOpen(friNight, at(SUN, 2))).toBe(false);   // Sunday 02:00 is Saturday's night
    expect(isWindowOpen(friNight, at(FRI, 12))).toBe(false);  // Friday noon — outside hours
  });

  it('Sunday-night wrap reaches back across the week boundary (Mon 02:00 belongs to Sun)', () => {
    const sunNight = { daysOfWeek: 'Sun', timeStart: '22:00', timeEnd: '06:00' };
    expect(isWindowOpen(sunNight, at(SUN, 23))).toBe(true);
    expect(isWindowOpen(sunNight, at(SUN + 1, 2))).toBe(true); // Monday 02:00
  });
});

describe('windowSignature — THE B-P0-1 EDGE DETECTOR', () => {
  const playlists = [
    { schedule: { timeStart: '07:00', timeEnd: '16:00' } },
    { schedule: null },
    { schedule: { daysOfWeek: 'Sat,Sun' } },
  ];

  it('flips exactly at the window edge — the signal that must bust the 304', () => {
    expect(windowSignature(playlists, at(MON, 6, 59))).toBe('010');
    expect(windowSignature(playlists, at(MON, 7, 0))).toBe('110');
    expect(windowSignature(playlists, at(MON, 16, 0))).toBe('110');
    expect(windowSignature(playlists, at(MON, 16, 1))).toBe('010');
    expect(windowSignature(playlists, at(SAT, 12))).toBe('111');
  });

  it('empty/absent playlists → empty signature (nothing to diff)', () => {
    expect(windowSignature(null, at(MON, 12))).toBe('');
    expect(windowSignature([], at(MON, 12))).toBe('');
  });
});
