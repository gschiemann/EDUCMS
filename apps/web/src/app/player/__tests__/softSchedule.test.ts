/**
 * Soft on/off schedule — the consumer the split left unwritten.
 *
 * The 2026-08-25 split put every unproven panel's windows on
 * `display.softSchedules`, and NOTHING read that key for a week: the
 * schedule was safe and dead. This suite pins (1) the window math against
 * the device's own rules (midnight crossing, day-of-start, timezone, DST),
 * (2) the runner's edge semantics (a manual Wake sticks; a deleted schedule
 * releases; an alert defers), and (3) — at the end — that `page.tsx` still
 * wires the runner at all, the class of bug the whole feature keeps having.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  SOFT_SCHEDULE_TICK_MS,
  SoftScheduleRunner,
  covers,
  desiredOnAt,
  localPartsOf,
  nextTransitionAfter,
  parseHHmm,
  parseSoftSchedules,
  parseSoftWindow,
  resolveZone,
  softWindowsFingerprint,
  zonedInstant,
  type SoftWindow,
} from '../softSchedule';

const LA = 'America/Los_Angeles';

/** Wall-clock helper: the instant `zone` reads y-m-d hh:mm. */
const at = (zone: string, y: number, m: number, d: number, hh: number, mm = 0) =>
  zonedInstant(zone, y, m, d, hh * 60 + mm);

const win = (over: Partial<SoftWindow> & { on: string; off: string; days?: number[] }): SoftWindow => ({
  id: over.id ?? 'w',
  daysOfWeek: new Set(over.days ?? [0, 1, 2, 3, 4, 5, 6]),
  onMinute: parseHHmm(over.on) as number,
  offMinute: parseHHmm(over.off) as number,
  timezone: over.timezone ?? LA,
});

// 2026-09-02 is a Wednesday.
const WED = { y: 2026, m: 9, d: 2 };

describe('parseHHmm', () => {
  it('accepts HH:mm, H:mm and HH:mm:ss', () => {
    expect(parseHHmm('07:00')).toBe(420);
    expect(parseHHmm('7:05')).toBe(425);
    expect(parseHHmm('22:00:00')).toBe(1320);
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('23:59')).toBe(1439);
  });
  it('drops anything malformed rather than guessing', () => {
    for (const bad of ['24:00', '7', '07:60', '', ' ', 'ab:cd', '07:00:61', 7, null, undefined]) {
      expect(parseHHmm(bad)).toBeNull();
    }
  });
});

describe('parseSoftWindow / parseSoftSchedules', () => {
  const row = { id: 'r1', daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '22:00', timezone: LA, scope: 'screen' };

  it('reads a manifest row', () => {
    const w = parseSoftWindow(row);
    expect(w).toEqual({
      id: 'r1', daysOfWeek: new Set([1, 2, 3, 4, 5]), onMinute: 420, offMinute: 1320, timezone: LA,
    });
  });

  it('REJECTS onTime == offTime — a typo, not an instruction', () => {
    expect(parseSoftWindow({ ...row, offTime: '07:00' })).toBeNull();
  });

  it('drops rows with no valid day, a bad time, or isActive:false', () => {
    expect(parseSoftWindow({ ...row, daysOfWeek: [] })).toBeNull();
    expect(parseSoftWindow({ ...row, daysOfWeek: [9] })).toBeNull();
    expect(parseSoftWindow({ ...row, onTime: '25:00' })).toBeNull();
    expect(parseSoftWindow({ ...row, isActive: false })).toBeNull();
    expect(parseSoftWindow(null)).toBeNull();
    expect(parseSoftWindow([row])).toBeNull();
  });

  it('reads ONLY softSchedules — the hard array is the APK’s', () => {
    const out = parseSoftSchedules({ schedules: [row], softSchedules: [] });
    expect(out).toEqual([]);
    const soft = parseSoftSchedules({ schedules: [], softSchedules: [row, { bogus: true }] });
    expect(soft).toHaveLength(1);
    expect(soft?.[0].id).toBe('r1');
  });

  it('returns null for an ABSENT block (rule 6) and [] for a present block with no soft key', () => {
    expect(parseSoftSchedules(undefined)).toBeNull();
    expect(parseSoftSchedules(null)).toBeNull();
    expect(parseSoftSchedules('x')).toBeNull();
    // An older server that emits only `schedules` — nothing soft to draw.
    expect(parseSoftSchedules({ schedules: [row] })).toEqual([]);
  });

  it('fingerprint is order-independent', () => {
    const a = parseSoftSchedules({ softSchedules: [row, { ...row, id: 'r2', onTime: '08:00' }] }) as SoftWindow[];
    const b = parseSoftSchedules({ softSchedules: [{ ...row, id: 'r2', onTime: '08:00' }, row] }) as SoftWindow[];
    expect(softWindowsFingerprint(a)).toBe(softWindowsFingerprint(b));
    expect(softWindowsFingerprint(a)).not.toBe(softWindowsFingerprint([a[0]]));
  });
});

describe('timezone math', () => {
  it('unknown zones fall back to UTC, never the device zone', () => {
    expect(resolveZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(resolveZone('')).toBe('UTC');
    expect(resolveZone(LA)).toBe(LA);
    expect(resolveZone('UTC')).toBe('UTC');
  });

  it('round-trips a wall-clock time through the zone', () => {
    const ms = at(LA, 2026, 9, 2, 22, 0);
    const p = localPartsOf(LA, ms);
    expect([p.year, p.month, p.day, p.hour, p.minute, p.dow]).toEqual([2026, 9, 2, 22, 0, 3]);
    // PDT is UTC-7: 22:00 local = 05:00Z next day.
    expect(new Date(ms).toISOString()).toBe('2026-09-03T05:00:00.000Z');
  });

  it('is DST-correct on both sides of the fall-back day', () => {
    // 2026-11-01 is the US fall-back Sunday. 22:00 PST = 06:00Z next day.
    expect(new Date(at(LA, 2026, 11, 1, 22, 0)).toISOString()).toBe('2026-11-02T06:00:00.000Z');
    // The day before is still PDT.
    expect(new Date(at(LA, 2026, 10, 31, 22, 0)).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });
});

describe('window math (DisplayScheduleMath.kt port)', () => {
  const daytime = win({ on: '07:00', off: '22:00' });

  it('same-day window is [on, off)', () => {
    expect(covers(daytime, at(LA, WED.y, WED.m, WED.d, 6, 59))).toBe(false);
    expect(covers(daytime, at(LA, WED.y, WED.m, WED.d, 7, 0))).toBe(true);
    expect(covers(daytime, at(LA, WED.y, WED.m, WED.d, 21, 59))).toBe(true);
    expect(covers(daytime, at(LA, WED.y, WED.m, WED.d, 22, 0))).toBe(false);
  });

  it('a midnight-crossing window belongs to the day it STARTS on', () => {
    // Friday-only 22:00 → 07:00 keeps the screen lit into Saturday morning.
    const friNight = win({ on: '22:00', off: '07:00', days: [5] });
    const fri = { y: 2026, m: 9, d: 4 };
    const sat = { y: 2026, m: 9, d: 5 };
    expect(covers(friNight, at(LA, fri.y, fri.m, fri.d, 21, 59))).toBe(false);
    expect(covers(friNight, at(LA, fri.y, fri.m, fri.d, 22, 0))).toBe(true);
    expect(covers(friNight, at(LA, sat.y, sat.m, sat.d, 3, 0))).toBe(true);
    expect(covers(friNight, at(LA, sat.y, sat.m, sat.d, 6, 59))).toBe(true);
    expect(covers(friNight, at(LA, sat.y, sat.m, sat.d, 7, 0))).toBe(false);
    // Saturday 22:00 is NOT covered — Saturday is not a selected start day.
    expect(covers(friNight, at(LA, sat.y, sat.m, sat.d, 23, 0))).toBe(false);
  });

  it('desiredOnAt: null with no windows, false when none covers, true when any does', () => {
    expect(desiredOnAt([], Date.now())).toBeNull();
    expect(desiredOnAt([daytime], at(LA, WED.y, WED.m, WED.d, 12))).toBe(true);
    expect(desiredOnAt([daytime], at(LA, WED.y, WED.m, WED.d, 23))).toBe(false);
    const weekend = win({ id: 'we', on: '09:00', off: '12:00', days: [0, 6] });
    // Wednesday 23:00 — neither window; Saturday 10:00 — the weekend one.
    expect(desiredOnAt([daytime, weekend], at(LA, WED.y, WED.m, WED.d, 23))).toBe(false);
    expect(desiredOnAt([win({ on: '07:00', off: '22:00', days: [1, 2, 3, 4, 5] }), weekend], at(LA, 2026, 9, 5, 10))).toBe(true);
  });

  it('evaluates in the SCREEN’s zone — the same instant is on in LA and off in London', () => {
    const laWin = win({ on: '07:00', off: '22:00', timezone: LA });
    const lonWin = win({ on: '07:00', off: '22:00', timezone: 'Europe/London' });
    const instant = at(LA, WED.y, WED.m, WED.d, 20, 0); // 20:00 LA = 04:00 London next day
    expect(covers(laWin, instant)).toBe(true);
    expect(covers(lonWin, instant)).toBe(false);
  });

  it('nextTransitionAfter finds the off edge then the on edge', () => {
    const noon = at(LA, WED.y, WED.m, WED.d, 12);
    const t1 = nextTransitionAfter([daytime], noon);
    expect(t1).toEqual({ atMs: at(LA, WED.y, WED.m, WED.d, 22), on: false });
    const t2 = nextTransitionAfter([daytime], t1!.atMs);
    expect(t2).toEqual({ atMs: at(LA, WED.y, WED.m, WED.d + 1, 7), on: true });
    expect(nextTransitionAfter([], noon)).toBeNull();
  });

  it('a boundary that is one window’s OFF and another’s ON resolves to ON', () => {
    const a = win({ id: 'a', on: '07:00', off: '12:00' });
    const b = win({ id: 'b', on: '12:00', off: '22:00' });
    const t = nextTransitionAfter([a, b], at(LA, WED.y, WED.m, WED.d, 11));
    expect(t).toEqual({ atMs: at(LA, WED.y, WED.m, WED.d, 12), on: true });
  });
});

describe('SoftScheduleRunner', () => {
  const mkSink = (emergency = false) => {
    const calls: boolean[] = [];
    return {
      calls,
      sink: { set: (on: boolean) => calls.push(on), emergencyDisplayed: () => emergency },
    };
  };
  const daytime = [win({ on: '07:00', off: '22:00' })];
  const NOON = at(LA, WED.y, WED.m, WED.d, 12);
  const NIGHT = at(LA, WED.y, WED.m, WED.d, 23);
  const MORNING = at(LA, WED.y, WED.m, WED.d + 1, 7, 1);

  it('installing at night blanks immediately; an unchanged block does nothing', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    expect(r.install(daytime, NIGHT)).toBe(true);
    expect(calls).toEqual([false]);
    expect(r.install([...daytime], NIGHT)).toBe(false); // same fingerprint
    expect(calls).toEqual([false]);
  });

  it('installing during the day applies ON once — it never re-asserts', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NOON);
    expect(calls).toEqual([true]);
    expect(r.tick(NOON + SOFT_SCHEDULE_TICK_MS)).toEqual({ status: 'steady', on: true });
    expect(calls).toEqual([true]);
  });

  it('EDGE semantics: a manual Wake during the off window STICKS until the next boundary', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NIGHT); // → blank
    expect(calls).toEqual([false]);
    // Operator presses Wake for a late event; the page's sink flips the
    // overlay without telling the runner. The runner must NOT undo it.
    sink.set(true);
    calls.length = 0;
    expect(r.tick(NIGHT + 60_000).status).toBe('steady');
    expect(r.tick(NIGHT + 3_600_000).status).toBe('steady');
    expect(calls).toEqual([]);
    // Morning boundary: ON edge applies (idempotent on the glass).
    expect(r.tick(MORNING)).toEqual({ status: 'applied', on: true });
    // Next night it blanks again — the schedule is still in force.
    expect(r.tick(NIGHT + 86_400_000)).toEqual({ status: 'applied', on: false });
  });

  it('an absent block (null) changes nothing', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NIGHT);
    expect(r.install(null, NIGHT)).toBe(false);
    expect(r.installed).toHaveLength(1);
    expect(calls).toEqual([false]);
  });

  it('deleting the schedule RELEASES a blank the runner drew', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NIGHT);
    expect(calls).toEqual([false]);
    expect(r.install([], NIGHT)).toBe(true);
    expect(calls).toEqual([false, true]);
    expect(r.tick(NIGHT)).toEqual({ status: 'idle' });
    expect(r.applied).toBeNull();
  });

  it('deleting the schedule never touches a blank it did NOT draw', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NOON); // applied ON
    calls.length = 0;
    r.install([], NOON);
    expect(calls).toEqual([]); // an operator's manual Blank would survive
  });

  it('EMERGENCY: an off edge during an alert is deferred, then fires after all-clear', () => {
    let emergency = true;
    const calls: boolean[] = [];
    const sink = { set: (on: boolean) => calls.push(on), emergencyDisplayed: () => emergency };
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NOON);
    expect(calls).toEqual([true]);
    expect(r.tick(NIGHT)).toEqual({ status: 'deferred' });
    expect(calls).toEqual([true]);
    expect(r.applied).toBe(true); // not advanced
    emergency = false;
    expect(r.tick(NIGHT + SOFT_SCHEDULE_TICK_MS)).toEqual({ status: 'applied', on: false });
    expect(calls).toEqual([true, false]);
  });

  it('an ON edge is never deferred by an alert — waking is always safe', () => {
    const { sink, calls } = mkSink(true);
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, MORNING);
    expect(calls).toEqual([true]);
  });

  it('a changed schedule re-applies the level (the operator moved off from 22:00 to 23:30)', () => {
    const { sink, calls } = mkSink();
    const r = new SoftScheduleRunner(sink);
    r.install(daytime, NIGHT); // 23:00 → blank
    expect(calls).toEqual([false]);
    r.install([win({ on: '07:00', off: '23:30' })], NIGHT);
    expect(calls).toEqual([false, true]); // now inside the window → wake
  });
});

// ─────────────────────────────────────────────────────────────────────
// The wiring guard — the bug this feature keeps having is "correct in
// isolation, called by nothing". The split's own softSchedules key sat
// unread for a week. Pin the call sites in page.tsx at source level.
// ─────────────────────────────────────────────────────────────────────
describe('page.tsx wires the soft schedule', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');

  it('installs the parsed softSchedules where the manifest display block is applied', () => {
    expect(src).toMatch(/softScheduleRef\.current\?\.install\(\s*parseSoftSchedules\(manifest\.display\)/);
  });

  it('ticks the runner on a timer', () => {
    expect(src).toMatch(/softScheduleRef\.current\?\.tick\(/);
    expect(src).toContain('SOFT_SCHEDULE_TICK_MS');
  });

  it('constructs the runner over the soft-blank sink', () => {
    expect(src).toMatch(/new SoftScheduleRunner\(softBlankSinkRef\.current\)/);
  });
});
