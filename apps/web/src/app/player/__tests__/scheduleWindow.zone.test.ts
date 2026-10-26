/**
 * Schedule windows on the SCREEN's wall clock (2026-10-24).
 *
 * Until this change `isWindowOpen` judged dayparting on the DEVICE's clock, so
 * a Goodview GUQ left on Asia/Shanghai switched its lunch menu and weekday
 * boards about fifteen hours off while its clocks already showed the right
 * time. Every case here uses a fixed UTC instant and a named zone, so the
 * verdicts do not depend on the machine the tests run on; the device-fallback
 * cases compare against the Date's own local getters for the same reason.
 */
import { isItemWindowOpen, isWindowOpen, wallClockAt, windowSignature } from '../scheduleWindow';

const LA = 'America/Los_Angeles';
const SH = 'Asia/Shanghai';
const NY = 'America/New_York';
const utc = (y: number, m: number, d: number, h: number, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));

/** What the DEVICE running this test would say for `now` (its own local clock). */
const deviceClock = (now: Date) => ({
  hhmm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  dayIndex: now.getDay(),
});

describe('wallClockAt — three answers, kept apart', () => {
  // 2026-01-14 (Wed) 20:30Z = Wed 12:30 PST in Los Angeles = Thu 04:30 CST in Shanghai.
  const now = utc(2026, 1, 14, 20, 30);

  it('a known zone gives that zone’s wall clock, including a different weekday', () => {
    expect(wallClockAt(now, LA)).toEqual({ hhmm: '12:30', dayIndex: 3, source: 'zone' });
    expect(wallClockAt(now, SH)).toEqual({ hhmm: '04:30', dayIndex: 4, source: 'zone' });
    expect(wallClockAt(now, NY)).toEqual({ hhmm: '15:30', dayIndex: 3, source: 'zone' });
  });

  it('null / undefined / empty → the device’s clock, as before', () => {
    const expected = { ...deviceClock(now), source: 'device' as const };
    expect(wallClockAt(now, null)).toEqual(expected);
    expect(wallClockAt(now, undefined)).toEqual(expected);
    expect(wallClockAt(now)).toEqual(expected);
    expect(wallClockAt(now, '')).toEqual(expected);
  });

  it('an unknown zone → the device’s clock, never a throw, never UTC', () => {
    expect(() => wallClockAt(now, 'Mars/Olympus')).not.toThrow();
    expect(wallClockAt(now, 'Mars/Olympus')).toEqual({ ...deviceClock(now), source: 'device' });
    expect(wallClockAt(now, 'not a zone at all; drop table')).toEqual({ ...deviceClock(now), source: 'device' });
  });

  it('midnight in the zone reads 00:xx, never 24:xx', () => {
    // 2026-01-15 08:05Z = 00:05 PST.
    expect(wallClockAt(utc(2026, 1, 15, 8, 5), LA).hhmm).toBe('00:05');
  });
});

describe('isWindowOpen on the screen’s zone — the GUQ on Shanghai time', () => {
  // The lunch menu: 11:00–14:00 on the screen in Los Angeles.
  const lunch = { timeStart: '11:00', timeEnd: '14:00' };

  it('is open at LA lunchtime even though the device (Shanghai) says 04:30', () => {
    const now = utc(2026, 1, 14, 20, 30); // 12:30 PST / 04:30+1 CST
    expect(isWindowOpen(lunch, now, LA)).toBe(true);
    expect(isWindowOpen(lunch, now, SH)).toBe(false);
  });

  it('a window crossing midnight: 22:00–06:00 on the screen’s clock', () => {
    const night = { timeStart: '22:00', timeEnd: '06:00' };
    expect(isWindowOpen(night, utc(2026, 1, 15, 7, 0), LA)).toBe(true); // 23:00 PST Wed
    expect(isWindowOpen(night, utc(2026, 1, 15, 10, 0), LA)).toBe(true); // 02:00 PST Thu
    expect(isWindowOpen(night, utc(2026, 1, 15, 14, 0), LA)).toBe(true); // 06:00 PST — inclusive
    expect(isWindowOpen(night, utc(2026, 1, 15, 14, 1), LA)).toBe(false); // 06:01 PST
    expect(isWindowOpen(night, utc(2026, 1, 15, 20, 0), LA)).toBe(false); // 12:00 PST
    // The same instants read as daytime in Shanghai: the night window is closed there.
    expect(isWindowOpen(night, utc(2026, 1, 15, 7, 0), SH)).toBe(false); // 15:00 CST
  });

  it('a daysOfWeek boundary where the device date and the screen date differ', () => {
    // 2026-01-16 (Fri) 03:00Z = Thu 19:00 PST in LA = Fri 11:00 CST in Shanghai.
    const now = utc(2026, 1, 16, 3, 0);
    const weekdaysOnly = { daysOfWeek: 'Mon,Tue,Wed,Thu,Fri' };
    const friOnly = { daysOfWeek: 'Fri' };
    const thuOnly = { daysOfWeek: 'Thu' };
    expect(isWindowOpen(thuOnly, now, LA)).toBe(true);
    expect(isWindowOpen(friOnly, now, LA)).toBe(false);
    expect(isWindowOpen(friOnly, now, SH)).toBe(true);
    expect(isWindowOpen(thuOnly, now, SH)).toBe(false);
    expect(isWindowOpen(weekdaysOnly, now, LA)).toBe(true);
    // Friday night 22:00–06:00 owns Saturday 02:00 on the SCREEN's calendar:
    // 2026-01-17 (Sat) 10:00Z = Sat 02:00 PST → open; in Shanghai it is Sat 18:00 → closed.
    const friNight = { daysOfWeek: 'Fri', timeStart: '22:00', timeEnd: '06:00' };
    expect(isWindowOpen(friNight, utc(2026, 1, 17, 10, 0), LA)).toBe(true);
    expect(isWindowOpen(friNight, utc(2026, 1, 17, 10, 0), SH)).toBe(false);
  });

  it('DST spring forward (US, 2026-03-08): the 02:00 hour does not exist, the clock jumps to 03:00', () => {
    // 09:59Z = 01:59 PST; 10:00Z = 03:00 PDT (02:xx never happens).
    expect(wallClockAt(utc(2026, 3, 8, 9, 59), LA).hhmm).toBe('01:59');
    expect(wallClockAt(utc(2026, 3, 8, 10, 0), LA).hhmm).toBe('03:00');
    const early = { timeStart: '02:00', timeEnd: '02:59' };
    expect(isWindowOpen(early, utc(2026, 3, 8, 9, 59), LA)).toBe(false);
    expect(isWindowOpen(early, utc(2026, 3, 8, 10, 0), LA)).toBe(false); // the window is simply skipped that night
    const morning = { timeStart: '03:00', timeEnd: '11:00' };
    expect(isWindowOpen(morning, utc(2026, 3, 8, 10, 0), LA)).toBe(true);
    // The day after, 10:00Z is 03:00 PDT too — and 17:00Z is 10:00 PDT, not 09:00.
    expect(wallClockAt(utc(2026, 3, 9, 17, 0), LA).hhmm).toBe('10:00');
  });

  it('DST fall back (US, 2026-11-01): 01:30 happens twice; both read 01:30 on the screen', () => {
    // 08:30Z = 01:30 PDT (first pass); 09:30Z = 01:30 PST (second pass); 10:30Z = 02:30 PST.
    expect(wallClockAt(utc(2026, 11, 1, 8, 30), LA).hhmm).toBe('01:30');
    expect(wallClockAt(utc(2026, 11, 1, 9, 30), LA).hhmm).toBe('01:30');
    expect(wallClockAt(utc(2026, 11, 1, 10, 30), LA).hhmm).toBe('02:30');
    const night = { timeStart: '22:00', timeEnd: '06:00' };
    expect(isWindowOpen(night, utc(2026, 11, 1, 8, 30), LA)).toBe(true);
    expect(isWindowOpen(night, utc(2026, 11, 1, 9, 30), LA)).toBe(true);
    const lateMorning = { timeStart: '09:00', timeEnd: '11:00' };
    // After the fall-back 17:30Z is 09:30 PST (it was 10:30 PDT the day before).
    expect(isWindowOpen(lateMorning, utc(2026, 11, 1, 17, 30), LA)).toBe(true);
    expect(wallClockAt(utc(2026, 10, 31, 17, 30), LA).hhmm).toBe('10:30');
  });

  it('a null zone judges on the device clock exactly as before; an invalid zone does the same', () => {
    const now = utc(2026, 1, 14, 20, 30);
    const dev = deviceClock(now);
    const windowAroundDeviceNow = { timeStart: dev.hhmm, timeEnd: dev.hhmm };
    expect(isWindowOpen(windowAroundDeviceNow, now)).toBe(true);
    expect(isWindowOpen(windowAroundDeviceNow, now, null)).toBe(true);
    expect(isWindowOpen(windowAroundDeviceNow, now, 'Mars/Olympus')).toBe(true);
    const deviceDay = { daysOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dev.dayIndex] };
    expect(isWindowOpen(deviceDay, now, null)).toBe(true);
    expect(isWindowOpen(deviceDay, now, 'Not/AZone')).toBe(true);
  });

  it('windowSignature carries the zone, so a window edge in the screen’s zone is an edge', () => {
    const playlists = [{ schedule: { timeStart: '11:00', timeEnd: '14:00' } }, { schedule: null }];
    expect(windowSignature(playlists, utc(2026, 1, 14, 20, 30), LA)).toBe('11'); // 12:30 PST
    expect(windowSignature(playlists, utc(2026, 1, 14, 20, 30), SH)).toBe('01'); // 04:30 CST
    expect(windowSignature(playlists, utc(2026, 1, 14, 22, 1), LA)).toBe('01'); // 14:01 PST
  });
});

describe('isItemWindowOpen — the per-item gate, same semantics, screen clock', () => {
  const now = utc(2026, 1, 14, 20, 30); // Wed 12:30 PST / Thu 04:30 CST

  it('day gate by name, time gate inclusive at both ends, no overnight wrap — on the screen’s zone', () => {
    expect(isItemWindowOpen({ daysOfWeek: 'Wed' }, now, LA)).toBe(true);
    expect(isItemWindowOpen({ daysOfWeek: 'Wed' }, now, SH)).toBe(false);
    expect(isItemWindowOpen({ timeStart: '12:30', timeEnd: '12:30' }, now, LA)).toBe(true);
    expect(isItemWindowOpen({ timeStart: '12:31', timeEnd: '13:00' }, now, LA)).toBe(false);
    // A start-only or end-only item window never gates (both bounds are needed) — as before.
    expect(isItemWindowOpen({ timeStart: '23:00' }, now, LA)).toBe(true);
    // An item window written as an overnight wrap is never open — as before (the playlist window wraps, this one does not).
    expect(isItemWindowOpen({ timeStart: '22:00', timeEnd: '06:00' }, utc(2026, 1, 15, 7, 0), LA)).toBe(false);
  });

  it('no fields → open; null item → open; null / invalid zone → the device clock', () => {
    expect(isItemWindowOpen(null, now, LA)).toBe(true);
    expect(isItemWindowOpen({}, now, LA)).toBe(true);
    const dev = deviceClock(now);
    expect(isItemWindowOpen({ timeStart: dev.hhmm, timeEnd: dev.hhmm }, now, null)).toBe(true);
    expect(isItemWindowOpen({ timeStart: dev.hhmm, timeEnd: dev.hhmm }, now, 'Mars/Olympus')).toBe(true);
  });
});
