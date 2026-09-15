/**
 * Uptime · last 24h — the maths behind the redesigned pulse card (2026-09-14).
 * A fixed 96-slot grid; scheduled sleep is neither uptime nor downtime;
 * outages are episodes; the denominator is named; "now" is live.
 */
import { computeUptime, asleepCountAt, SLOTS, TICK_MS, type PulseTick, type DisplayScheduleRow } from '../uptime';

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0); // 2026-09-14 12:00Z, on a 15-min boundary
const tick = (i: number, online: number, offline: number, notPainting = 0, total = 4): PulseTick => ({ ts: T0 + i * TICK_MS, online, offline, notPainting, total });
const screens = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', screenGroup: { id: 'g1' } }];
// UTC schedule: off 00:00–06:00 every day  (onTime 06:00, offTime 00:00)
const nightly: DisplayScheduleRow = { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '06:00', offTime: '00:00', timezone: 'UTC' };
const known = (u: ReturnType<typeof computeUptime>) => u.cells.filter((c) => c.state !== 'none');

describe('computeUptime', () => {
  it('always draws the fixed 24h grid, with empty slots where nothing was recorded', () => {
    const u = computeUptime([tick(0, 4, 0), tick(1, 4, 0), tick(2, 4, 0)], screens, [], T0 + 2 * TICK_MS);
    expect(u.cells).toHaveLength(SLOTS);
    expect(u.samples).toBe(3);
    expect(known(u)).toHaveLength(3);
    // the last slot ends "now"; the three ticks are the three newest slots
    expect(u.cells[SLOTS - 1].ts).toBe(T0 + 2 * TICK_MS);
    expect(u.cells.slice(0, SLOTS - 3).every((c) => c.state === 'none')).toBe(true);
    expect(u.spanMs).toBe(2 * TICK_MS);
  });
  it('all online, no schedules → 100% around the clock, no outages', () => {
    const u = computeUptime([tick(0, 4, 0), tick(1, 4, 0), tick(2, 4, 0)], screens, [], T0 + 2 * TICK_MS);
    expect(u.ontimePct).toBe(100);
    expect(u.denominator).toBe('around-the-clock');
    expect(u.outages).toBe(0);
    expect(known(u).every((c) => c.state === 'ok')).toBe(true);
  });
  it('a tick older than the window is ignored, one in the future lands in the newest slot', () => {
    const u = computeUptime([tick(-200, 0, 4), tick(0, 4, 0), { ...tick(0, 3, 1), ts: T0 + 5 * 60_000 }], screens, [], T0);
    expect(u.samples).toBe(2);
    // the 12:05 tick beat the 12:00 tick for the newest slot (latest wins)
    expect(u.cells[SLOTS - 1].online).toBe(3);
  });
  it('counts outage EPISODES, the longest one, and screen-minutes lost', () => {
    // one screen down for 2 ticks, recovers, then down again for 1 tick
    const pts = [tick(0, 4, 0), tick(1, 3, 1), tick(2, 3, 1), tick(3, 4, 0), tick(4, 3, 1), tick(5, 4, 0)];
    const u = computeUptime(pts, screens, [], T0 + 5 * TICK_MS);
    expect(u.outages).toBe(2);
    expect(u.longestOutageMin).toBe(30);
    expect(u.offlineScreenMinutes).toBe(45);
    expect(u.ontimePct).toBe(Math.round((21 / 24) * 1000) / 10);
    expect(u.offlineNow).toBe(0);
  });
  it('a gap in the samples neither ends nor extends an outage', () => {
    // down, (no sample), down → ONE episode of 2 known ticks, not two
    const pts = [tick(0, 3, 1), tick(2, 3, 1), tick(3, 4, 0)];
    const u = computeUptime(pts, screens, [], T0 + 3 * TICK_MS);
    expect(u.outages).toBe(1);
    expect(u.longestOutageMin).toBe(30);
    expect(u.cells[SLOTS - 3].state).toBe('none');
  });
  it('a screen asleep on schedule is neither up nor down', () => {
    // ticks at 02:00Z (inside the off window) — all four screens dark, pulse says 0 online / 4 offline
    const night = Date.UTC(2026, 8, 14, 2, 0, 0);
    const pts = [{ ts: night, online: 0, offline: 4, notPainting: 0, total: 4 }, { ts: night + TICK_MS, online: 0, offline: 4, notPainting: 0, total: 4 }];
    const u = computeUptime(pts, screens, [nightly], night + TICK_MS);
    expect(u.denominator).toBe('scheduled');
    const k = known(u);
    expect(k).toHaveLength(2);
    expect(k[0].asleep).toBe(4);
    expect(k[0].expected).toBe(0);
    expect(k[0].state).toBe('asleep');
    expect(u.ontimePct).toBeNull();     // nothing was expected on — no verdict, not 0%
    expect(u.outages).toBe(0);
    expect(u.asleepNow).toBe(4);
    expect(u.sleepScreens).toBe(4);
  });
  it('a screen dark OUTSIDE its sleep window is an outage', () => {
    const noon = Date.UTC(2026, 8, 14, 12, 0, 0);
    const u = computeUptime([{ ts: noon, online: 3, offline: 1, notPainting: 0, total: 4 }], screens, [nightly], noon);
    const k = known(u);
    expect(k[0].asleep).toBe(0);
    expect(k[0].state).toBe('offline');
    expect(u.ontimePct).toBe(75);
  });
  it('not painting is its own state and its own count — and is netted against screens scheduled dark', () => {
    const u = computeUptime([tick(0, 4, 0, 2)], screens, [], T0);
    expect(known(u)[0].state).toBe('not-painting');
    expect(u.notPaintingNow).toBe(2);
    expect(u.ontimePct).toBe(100);
    // 02:00Z: two screens "online, no picture" while all four are scheduled dark → not a problem
    const night = Date.UTC(2026, 8, 14, 2, 0, 0);
    const n = computeUptime([{ ts: night, online: 4, offline: 0, notPainting: 2, total: 4 }], screens, [nightly], night);
    expect(known(n)[0].notPainting).toBe(0);
    expect(known(n)[0].state).toBe('asleep');
  });
  it('"now" comes from the live screen list when given, never from a stale sample', () => {
    // last sample said all fine; the live list (what the pills read) says 1 offline, 1 not painting
    const u = computeUptime([tick(0, 4, 0)], screens, [], T0 + 40 * 60_000, { offline: 1, notPainting: 1 });
    expect(u.offlineNow).toBe(1);
    expect(u.notPaintingNow).toBe(1);
    // without a live list the last sample is the best available answer
    expect(computeUptime([tick(0, 3, 1, 1)], screens, [], T0).offlineNow).toBe(1);
  });
});

describe('asleepCountAt', () => {
  it('screen rows beat group rows beat tenant-wide rows', () => {
    const night = Date.UTC(2026, 8, 14, 2, 0, 0);
    const rows: DisplayScheduleRow[] = [
      nightly,                                                                                   // tenant-wide: dark at 02:00
      { screenGroupId: 'g1', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '00:00', offTime: '23:59', timezone: 'UTC' }, // group g1: on
    ];
    expect(asleepCountAt(screens, rows, night)).toBe(3);   // a, b, c asleep; d (group g1) is on
  });
  it('an inactive row governs nothing', () => {
    const night = Date.UTC(2026, 8, 14, 2, 0, 0);
    expect(asleepCountAt(screens, [{ ...nightly, isActive: false }], night)).toBe(0);
  });
});

describe('computeUptime — Codex card fields (2026-09-14)', () => {
  it('counts paired-but-silent screens as unknown per slot and live', () => {
    // 4 screens: 2 online, 1 offline, 1 pending (neither) → unknown 1
    const u = computeUptime([{ ts: T0, online: 2, offline: 1, notPainting: 0, total: 4 }], screens, [], T0, { unknown: 3 });
    const k = u.cells.filter((c) => c.state !== 'none');
    expect(k[0].unknown).toBe(1);
    expect(u.unknownNow).toBe(3);
  });
  it('coverage is the share of the 24h window with a sample', () => {
    expect(computeUptime([tick(0, 4, 0)], screens, [], T0).coveragePct).toBe(1);
    expect(computeUptime(Array.from({ length: 48 }, (_, i) => tick(-i, 4, 0)), screens, [], T0).coveragePct).toBe(50);
  });
});
