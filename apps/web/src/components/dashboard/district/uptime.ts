/**
 * Uptime · last 24h — the numbers a signage fleet manager actually acts on
 * (Greg, 2026-09-14: the stacked online/degraded/offline area "shows me nothing").
 *
 * Inputs are what the product already records: the 15-minute fleet pulse
 * (online / offline / not-painting / total per tick), the tenant's display
 * (on/off) schedules, and the fleet's screens. Nothing here is a guess:
 *
 *  - The 24 hours are a FIXED GRID of 96 fifteen-minute slots ending now.
 *    A recorded tick lands in its slot; a slot with no tick is "no data",
 *    drawn empty — never stretched to hide a gap, never counted either way.
 *    (The pulse endpoint buckets to the minute and a cron restart skips a
 *    tick; equal-width cells over an irregular series would lie about time.)
 *  - ON-TIME %: online over EXPECTED-on, summed across known slots. A screen
 *    inside its scheduled sleep window is not expected on, so it neither
 *    counts for nor against you. With no schedule known, the screen is
 *    expected on around the clock — the card says which.
 *  - ASLEEP: screens whose schedule says "off" at that slot (client-side,
 *    from the same `desiredOnAt` the player runs) — a real fleet is dark
 *    overnight on purpose and that must read as "asleep", never "offline".
 *    A screen with no confirmed picture while it is scheduled dark is not
 *    "not painting" either; that count is netted against sleep.
 *  - OUTAGES: episodes where expected-on screens were short, with the
 *    longest one and the screen-minutes lost. A no-data slot neither ends
 *    nor extends an episode (an outage across an API restart is one outage).
 *  - "NOW" numbers come from the LIVE screen list the pills beside the card
 *    use (`live`), never from the last sample — a sample can be 15 minutes
 *    old and the two must never disagree on the same page.
 *
 * Limits, stated: the pulse is per-tenant COUNTS, not per-screen rows, so
 * asleep is subtracted from the expected-on denominator as a count (capped
 * at the tick's total); schedules of child locations are not visible from
 * an HQ session, so their screens count as expected-on.
 */
import { desiredOnAt, parseSoftWindow, type SoftWindow } from '@/app/player/softSchedule';

export interface PulseTick { ts: number; online: number; offline: number; notPainting: number; total: number }
export interface UptimeScreen { id: string; screenGroup?: { id: string } | null; status?: string; renderHealth?: string | null }
export interface DisplayScheduleRow { id?: string; screenId?: string | null; screenGroupId?: string | null; daysOfWeek: number[]; onTime: string; offTime: string; timezone: string; isActive?: boolean }
/** Live counts from the same screen list the assurance pills read. */
export interface LiveCounts { offline?: number; notPainting?: number; unknown?: number }

export interface UptimeCell {
  ts: number;
  total: number;
  online: number;
  offline: number;
  /** Online with no confirmed picture, net of screens scheduled dark. */
  notPainting: number;
  /** Paired but never answering (PENDING / no status) — neither online nor offline. */
  unknown: number;
  /** Screens scheduled off at this slot (0 when no schedule applies). */
  asleep: number;
  /** Expected-on screens (total − asleep, never below the online count). */
  expected: number;
  /** Worst thing true in this slot, for the strip colour; 'none' = no sample. */
  state: 'ok' | 'not-painting' | 'offline' | 'asleep' | 'none';
}

export interface UptimeSummary {
  /** Exactly SLOTS cells, oldest first, the last one ending at `nowMs`. */
  cells: UptimeCell[];
  /** Recorded ticks that landed inside the window. */
  samples: number;
  /** 0–100, or null when there is nothing to measure. */
  ontimePct: number | null;
  /** How the denominator was formed — surfaced on the card, never hidden. */
  denominator: 'scheduled' | 'around-the-clock';
  outages: number;
  longestOutageMin: number;
  offlineScreenMinutes: number;
  offlineNow: number;
  notPaintingNow: number;
  /** Screens whose status is neither online nor offline right now. */
  unknownNow: number;
  asleepNow: number;
  /** Share of the 24h window that has a recorded sample, 0–100. */
  coveragePct: number;
  /** Screens that have a schedule at all. */
  sleepScreens: number;
  /** Time covered by recorded samples (first → last), for the "building history" header. */
  spanMs: number;
}

export const TICK_MS = 15 * 60_000;
export const SLOTS = 96;

/** The schedule rows that govern one screen — screen rows beat group rows beat tenant-wide rows (all-or-nothing per level, like the manifest). */
export function windowsForScreen(screen: UptimeScreen, rows: DisplayScheduleRow[]): SoftWindow[] {
  const active = rows.filter((r) => r.isActive !== false);
  const own = active.filter((r) => r.screenId && r.screenId === screen.id);
  const group = screen.screenGroup?.id ? active.filter((r) => !r.screenId && r.screenGroupId && r.screenGroupId === screen.screenGroup!.id) : [];
  const tenant = active.filter((r) => !r.screenId && !r.screenGroupId);
  const pick = own.length ? own : group.length ? group : tenant;
  return pick.map(parseSoftWindow).filter((w): w is SoftWindow => !!w);
}

/** Screens scheduled OFF at `atMs`. */
export function asleepCountAt(screens: UptimeScreen[], rows: DisplayScheduleRow[], atMs: number): number {
  if (!rows.length || !screens.length) return 0;
  return countAsleep(screens.map((s) => windowsForScreen(s, rows)).filter((w) => w.length > 0), atMs);
}

function countAsleep(perScreen: SoftWindow[][], atMs: number): number {
  let n = 0;
  for (const w of perScreen) if (desiredOnAt(w, atMs) === false) n += 1;
  return n;
}

export function computeUptime(
  points: PulseTick[],
  screens: UptimeScreen[],
  rows: DisplayScheduleRow[],
  nowMs: number,
  live: LiveCounts = {},
): UptimeSummary {
  const hasSchedules = rows.some((r) => r.isActive !== false);
  // Parse every screen's windows ONCE — 96 slots × N screens is the hot loop.
  const perScreen = hasSchedules ? screens.map((s) => windowsForScreen(s, rows)).filter((w) => w.length > 0) : [];
  const end = Math.floor(nowMs / TICK_MS) * TICK_MS;
  const start = end - (SLOTS - 1) * TICK_MS;

  // Land each recorded tick in its slot (latest wins on a double-fire).
  const bySlot = new Map<number, PulseTick>();
  let samples = 0, firstTs = Infinity, lastTs = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.ts) || p.ts < start) continue;
    const idx = Math.min(SLOTS - 1, Math.floor((p.ts - start) / TICK_MS));
    const prev = bySlot.get(idx);
    if (!prev || p.ts >= prev.ts) bySlot.set(idx, p);
    samples += 1; firstTs = Math.min(firstTs, p.ts); lastTs = Math.max(lastTs, p.ts);
  }

  const cells: UptimeCell[] = [];
  for (let i = 0; i < SLOTS; i += 1) {
    const ts = start + i * TICK_MS;
    const p = bySlot.get(i);
    if (!p) { cells.push({ ts, total: 0, online: 0, offline: 0, notPainting: 0, unknown: 0, asleep: 0, expected: 0, state: 'none' }); continue; }
    const total = Math.max(0, p.total);
    const online = Math.max(0, Math.min(p.online, total));
    const offline = Math.max(0, p.offline);
    const asleep = hasSchedules ? Math.min(total, countAsleep(perScreen, ts)) : 0;
    const notPainting = Math.max(0, Math.min(p.notPainting, online) - asleep);
    const unknown = Math.max(0, total - online - offline);
    const expected = Math.max(online, total - asleep);
    const state: UptimeCell['state'] =
      total === 0 ? 'none'
      : online < expected ? 'offline'
      : notPainting > 0 ? 'not-painting'
      : asleep >= total ? 'asleep'
      : 'ok';
    cells.push({ ts, total, online, offline, notPainting, unknown, asleep, expected, state });
  }

  let onlineSum = 0, expectedSum = 0, outages = 0, longest = 0, run = 0, offlineMin = 0, inOutage = false;
  for (const c of cells) {
    if (c.state === 'none') continue; // no data: neither extends nor ends an episode
    onlineSum += Math.min(c.online, c.expected);
    expectedSum += c.expected;
    const short = Math.max(0, c.expected - c.online);
    if (short > 0) {
      offlineMin += short * (TICK_MS / 60_000);
      run += 1;
      if (!inOutage) { outages += 1; inOutage = true; }
      longest = Math.max(longest, run);
    } else { run = 0; inOutage = false; }
  }

  const asleepNow = hasSchedules ? Math.min(screens.length, countAsleep(perScreen, nowMs)) : 0;
  const lastKnown = [...cells].reverse().find((c) => c.state !== 'none');
  const offlineNow = live.offline !== undefined ? Math.max(0, live.offline) : lastKnown ? Math.max(0, lastKnown.expected - lastKnown.online) : 0;
  // Live not-painting is netted against screens scheduled dark right now, the
  // same way each slot nets its count against that slot's sleepers.
  const notPaintingNow = live.notPainting !== undefined
    ? Math.max(0, live.notPainting - asleepNow)
    : lastKnown ? lastKnown.notPainting : 0;
  return {
    cells,
    samples,
    ontimePct: expectedSum > 0 ? Math.round((onlineSum / expectedSum) * 1000) / 10 : null,
    denominator: hasSchedules ? 'scheduled' : 'around-the-clock',
    outages,
    longestOutageMin: longest * (TICK_MS / 60_000),
    offlineScreenMinutes: Math.round(offlineMin),
    offlineNow,
    notPaintingNow,
    unknownNow: live.unknown !== undefined ? Math.max(0, live.unknown) : lastKnown ? lastKnown.unknown : 0,
    asleepNow,
    coveragePct: Math.round((Math.min(samples, SLOTS) / SLOTS) * 1000) / 10,
    sleepScreens: perScreen.length,
    spanMs: samples ? lastTs - firstTs : 0,
  };
}
