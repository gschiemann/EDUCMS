/**
 * softSchedule.ts — the web player's SOFT on/off schedule (2026-09-02).
 *
 * ============================================================
 * WHY THIS EXISTS
 * ============================================================
 *
 * The blank/power split (2026-08-25, `96846f68`) routes every screen's
 * on/off windows into ONE of two manifest arrays: `display.schedules` (hard
 * panel power, only for a panel whose blank mechanism is PROVEN — today that
 * is `vendor-recipe` alone) or `display.softSchedules` (the same black
 * overlay the manual Blank/Wake pair draws, for every other panel). The
 * server half shipped that night. The consumer half of `softSchedules` was
 * "left for the APK" — and never written. So on a fleet where NO panel is
 * proven, every schedule an operator saved resolved to `schedules: []` on
 * the device and `softSchedules: [...]` that nothing read. The screens were
 * safe (the split's whole point) and the schedule did nothing at all.
 *
 * This module is the missing consumer. It needs no APK release: the overlay
 * it drives is the page's own `<div>`, the one `dispatchDisplayControl`
 * already draws for a soft BLANK, so it works on every model the fleet
 * runs — including a browser player with no bridge.
 *
 * Pure by design (no React, no DOM, no network, no clock reads except the
 * `nowMs` the caller passes), like `displayControl.ts` and the sync math.
 * The page owns the timer and the sink.
 *
 * ============================================================
 * THE RULES
 * ============================================================
 *
 * 1. EDGE-TRIGGERED, NOT LEVEL-TRIGGERED. The runner applies a transition
 *    when the DESIRED state changes, and re-applies the level only when the
 *    WINDOWS change (a fresh install, i.e. boot or an operator edit). It
 *    never re-asserts "off" on every tick. That is what lets an operator's
 *    manual Wake during an off window stick until the next boundary — the
 *    late-event case — instead of being undone thirty seconds later. Same
 *    semantics as the AlarmManager path on the device: one alarm per
 *    boundary, nothing in between.
 *
 * 2. THE MIDNIGHT-CROSSING RULE is the device's, verbatim
 *    (`DisplayScheduleMath.kt`): the ON window runs `[onTime, offTime)`;
 *    when `offTime <= onTime` it crosses midnight and `daysOfWeek` names the
 *    day it STARTS on. `onTime == offTime` is dropped at parse time — read
 *    as zero-length it blanks a wall-mounted screen forever, read as 24 h it
 *    never blanks; neither is safe to assume from a typo.
 *
 * 3. THE SCREEN'S TIMEZONE, NEVER THE DEVICE'S. Boxes ship on the factory's
 *    zone. An unknown zone id falls back to UTC, as on the device — the
 *    wrong hour in a predictable zone beats the wrong hour in a hidden one.
 *    Day arithmetic goes through local wall-clock components, not
 *    `+ 86_400_000`, so a DST day lands on the right minute.
 *
 * 4. "NO WINDOWS" IS NOT "BLANK IT". No schedules → the runner has no
 *    opinion. And when the windows go from some to none (the operator
 *    deleted the schedule) the runner RELEASES a blank it owns, so deleting
 *    a schedule turns the screen back on.
 *
 * 5. EMERGENCY PUNCHES THROUGH. The runner never draws over a displayed
 *    alert: an off edge that lands during an alert is deferred (the runner's
 *    own record of what it applied is not advanced), so it fires on the
 *    first tick after all-clear. The page's own effect already tears the
 *    overlay down when an alert paints; that is the second guarantee and it
 *    is independent of this one.
 *
 * 6. AN ABSENT BLOCK CHANGES NOTHING. The emergency manifest branch and
 *    older cached payloads omit `display`. The caller must not call
 *    `install` for those — `parseSoftSchedules(undefined)` returns `null`
 *    for exactly that reason, and `install(null)` is a no-op.
 *
 * 7. SESSION-ONLY, deliberately. Like the manual soft blank, a reload fails
 *    BRIGHT for the frames until the next manifest lands — and then the
 *    install re-applies the level, so a screen that reboots at 02:00 goes
 *    dark again within one manifest poll. The safe direction to fail.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SoftWindow {
  id: string;
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: ReadonlySet<number>;
  /** Minutes past local midnight, 0..1439. */
  onMinute: number;
  /** Minutes past local midnight, 0..1439. */
  offMinute: number;
  /** IANA zone id — THE SCREEN'S, never the device default. */
  timezone: string;
}

export interface SoftTransition {
  atMs: number;
  on: boolean;
}

const MINUTES_PER_DAY = 24 * 60;

// ─────────────────────────────────────────────────────────────────────
// Parsing — the manifest `display` block → windows
// ─────────────────────────────────────────────────────────────────────

/**
 * "HH:mm" (tolerates "H:mm" and "HH:mm:ss") → minutes past midnight, or
 * null. A malformed time DROPS the row rather than guessing.
 */
export function parseHHmm(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 8) return null;
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (parts.length === 3) {
    const sec = Number(parts[2]);
    if (sec < 0 || sec > 59) return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** One manifest row → a window, or null when the row is unusable. */
export function parseSoftWindow(row: unknown): SoftWindow | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (r.isActive === false) return null;
  const onMinute = parseHHmm(r.onTime);
  const offMinute = parseHHmm(r.offTime);
  if (onMinute === null || offMinute === null) return null;
  // Rule 2 — a zero-length window is a typo, not an instruction.
  if (onMinute === offMinute) return null;
  if (!Array.isArray(r.daysOfWeek)) return null;
  const days = new Set<number>();
  for (const d of r.daysOfWeek) {
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6) days.add(d);
  }
  if (days.size === 0) return null;
  const timezone = typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone.trim() : 'UTC';
  const id = typeof r.id === 'string' && r.id ? r.id : `${onMinute}-${offMinute}-${timezone}`;
  return { id, daysOfWeek: days, onMinute, offMinute, timezone };
}

/**
 * The manifest `display` block → soft windows.
 *
 * Returns `null` when the block itself is absent (rule 6 — the caller must
 * then leave the runner alone), and an EMPTY array when the block is present
 * but carries no usable soft windows (rule 4 — release anything we hold).
 *
 * Only `softSchedules` is read here. `schedules` is the HARD array and is
 * the APK's to arm (`installDisplayConfig`); a window the server routed
 * hard must never ALSO be drawn soft, or the panel's real power-off would
 * be doubled by a black div that outlives the power-on.
 */
export function parseSoftSchedules(block: unknown): SoftWindow[] | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const raw = (block as Record<string, unknown>).softSchedules;
  if (!Array.isArray(raw)) return [];
  const out: SoftWindow[] = [];
  for (const row of raw) {
    const w = parseSoftWindow(row);
    if (w) out.push(w);
  }
  return out;
}

/** Stable fingerprint so an unchanged block on every poll installs nothing. */
export function softWindowsFingerprint(windows: readonly SoftWindow[]): string {
  return windows
    .map(
      (w) =>
        `${w.id}|${[...w.daysOfWeek].sort((a, b) => a - b).join(',')}|${w.onMinute}|${w.offMinute}|${w.timezone}`,
    )
    .sort()
    .join(';');
}

// ─────────────────────────────────────────────────────────────────────
// Timezone math — Intl only (Chromium 83 / Android WebView safe)
// ─────────────────────────────────────────────────────────────────────

interface LocalParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
}

const DOW_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

/**
 * Resolve a zone id to a formatter, or null when the runtime does not know
 * the zone. Cached: `Intl.DateTimeFormat` construction is the expensive
 * part, and a tick evaluates the same zone every 30 s.
 */
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const key = zone.trim() || 'UTC';
  const cached = formatterCache.get(key);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      // `hourCycle` is Chrome 73+; `hour12:false` alone can render midnight
      // as "24" on some engines, which the normaliser below also handles.
      hourCycle: 'h23',
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    fmt = null;
  }
  formatterCache.set(key, fmt);
  return fmt;
}

/**
 * Rule 3 — an unknown zone falls back to UTC, never to the device zone.
 * Exported for the test that pins it.
 */
export function resolveZone(zone: string): string {
  return formatterFor(zone) ? zone.trim() || 'UTC' : 'UTC';
}

/** Wall-clock components of `ms` in `zone`. */
export function localPartsOf(zone: string, ms: number): LocalParts {
  const fmt = formatterFor(zone) ?? (formatterFor('UTC') as Intl.DateTimeFormat);
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    dow: DOW_INDEX[get('weekday')] ?? new Date(ms).getUTCDay(),
  };
}

/**
 * The instant at which `zone`'s wall clock reads (y, m, d, minuteOfDay).
 *
 * Two-pass offset correction: guess the instant as if the wall clock were
 * UTC, measure the zone's offset AT that guess, correct, and measure once
 * more so a guess that straddles a DST change converges. On a spring-
 * forward gap (02:30 does not exist) this lands on the instant the clock
 * reads 03:30, i.e. the same minute count past midnight — the window still
 * opens and closes once, which is all a schedule needs.
 */
export function zonedInstant(zone: string, y: number, m: number, d: number, minuteOfDay: number): number {
  const wall = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localPartsOf(zone, guess);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const offset = asUtc - guess; // zone minus UTC, at `guess`
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/**
 * The instant of `minuteOfDay` on the local day `dayOffset` days from the
 * local day containing `baseMs`. Day arithmetic is done on the calendar
 * date, so a 23-hour DST day does not shift the result by an hour.
 */
function instantOnDay(zone: string, baseMs: number, dayOffset: number, minuteOfDay: number): number | null {
  if (minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) return null;
  const p = localPartsOf(zone, baseMs);
  // Date.UTC normalises an out-of-range day (e.g. the 32nd) onto the next
  // month, which is exactly the calendar roll we want.
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, 12, 0, 0, 0));
  return zonedInstant(zone, shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), minuteOfDay);
}

function windowEnd(zone: string, baseMs: number, dayOffset: number, w: SoftWindow): number {
  const extraDay = w.offMinute <= w.onMinute ? 1 : 0;
  return instantOnDay(zone, baseMs, dayOffset + extraDay, w.offMinute) ?? Number.MAX_SAFE_INTEGER;
}

// ─────────────────────────────────────────────────────────────────────
// Window math — ported from DisplayScheduleMath.kt
// ─────────────────────────────────────────────────────────────────────

/** True when `w`'s ON window contains `atMs`. */
export function covers(w: SoftWindow, atMs: number): boolean {
  const zone = resolveZone(w.timezone);
  // A window that crosses midnight and started YESTERDAY can still be
  // running now, so always look one day back.
  for (let dayOffset = -1; dayOffset <= 0; dayOffset++) {
    const start = instantOnDay(zone, atMs, dayOffset, w.onMinute);
    if (start === null) continue;
    if (!w.daysOfWeek.has(localPartsOf(zone, start).dow)) continue;
    const end = windowEnd(zone, atMs, dayOffset, w);
    if (atMs >= start && atMs < end) return true;
  }
  return false;
}

/**
 * What state should the screen be in at `atMs`?
 *   true  — at least one window's ON range contains this instant
 *   false — windows exist but none covers it → blank
 *   null  — no windows: the schedule layer has no opinion (rule 4)
 */
export function desiredOnAt(windows: readonly SoftWindow[], atMs: number): boolean | null {
  if (windows.length === 0) return null;
  return windows.some((w) => covers(w, atMs));
}

/**
 * The earliest boundary strictly after `afterMs` within `horizonDays`, and
 * the state from then on. A superset of real state changes (overlapping
 * windows produce boundaries that change nothing) — deliberately, because
 * a superset can never MISS a transition, and re-applying a state is
 * idempotent. Used for diagnostics and the test that pins the math; the
 * runner itself evaluates the level on every tick, which is simpler and
 * cannot drift if a tick is late.
 */
export function nextTransitionAfter(
  windows: readonly SoftWindow[],
  afterMs: number,
  horizonDays = 8,
): SoftTransition | null {
  if (windows.length === 0) return null;
  let best: number | null = null;
  for (const w of windows) {
    const zone = resolveZone(w.timezone);
    for (let dayOffset = -1; dayOffset <= horizonDays; dayOffset++) {
      const start = instantOnDay(zone, afterMs, dayOffset, w.onMinute);
      if (start === null) continue;
      if (!w.daysOfWeek.has(localPartsOf(zone, start).dow)) continue;
      const end = windowEnd(zone, afterMs, dayOffset, w);
      for (const candidate of [start, end]) {
        if (candidate > afterMs && (best === null || candidate < best)) best = candidate;
      }
    }
  }
  if (best === null) return null;
  const on = desiredOnAt(windows, best);
  return on === null ? null : { atMs: best, on };
}

// ─────────────────────────────────────────────────────────────────────
// The runner — owns "what did I last apply", drives the sink
// ─────────────────────────────────────────────────────────────────────

/**
 * The two capabilities the page lends this module. Deliberately a subset of
 * `SoftBlankSink` so the page can pass that object straight in.
 */
export interface SoftScheduleSink {
  set: (on: boolean) => void;
  emergencyDisplayed: () => boolean;
}

export type SoftScheduleTick =
  /** Applied a transition to the sink. */
  | { status: 'applied'; on: boolean }
  /** The desired state is what we last applied — nothing to do. */
  | { status: 'steady'; on: boolean | null }
  /** A blank was due but an alert is on the glass — deferred (rule 5). */
  | { status: 'deferred' }
  /** No windows installed. */
  | { status: 'idle' };

export class SoftScheduleRunner {
  private windows: SoftWindow[] = [];
  private fingerprint = '';
  /**
   * The state THIS RUNNER last pushed to the sink. `null` = never applied.
   * Not "what the glass shows": a manual Wake or an emergency can change
   * the glass without telling us, and that is by design (rule 1).
   */
  private lastApplied: boolean | null = null;

  constructor(private readonly sink: SoftScheduleSink) {}

  /** Windows currently installed — for diagnostics and tests. */
  get installed(): readonly SoftWindow[] {
    return this.windows;
  }

  /** What this runner last applied (null = nothing yet). */
  get applied(): boolean | null {
    return this.lastApplied;
  }

  /**
   * Install the windows parsed from a manifest, if they changed, then apply
   * the current LEVEL once (rule 1 — a fresh install is the one moment the
   * level is re-asserted, so a box that reboots at 02:00 goes dark again).
   *
   * `null` means the block was absent (rule 6): nothing changes.
   * Returns true when the windows actually changed.
   */
  install(windows: readonly SoftWindow[] | null, nowMs: number): boolean {
    if (windows === null) return false;
    const fp = softWindowsFingerprint(windows);
    if (fp === this.fingerprint) return false;
    this.fingerprint = fp;
    this.windows = [...windows];
    if (this.windows.length === 0) {
      // Rule 4 — the schedule was deleted. Release a blank WE drew; never
      // touch one we did not (an operator's manual Blank stays).
      if (this.lastApplied === false) this.sink.set(true);
      this.lastApplied = null;
      return true;
    }
    // Force a level re-apply on the next tick by forgetting the old one.
    this.lastApplied = null;
    this.tick(nowMs);
    return true;
  }

  /** Evaluate the level at `nowMs` and apply it only if it moved. */
  tick(nowMs: number): SoftScheduleTick {
    if (this.windows.length === 0) return { status: 'idle' };
    const desired = desiredOnAt(this.windows, nowMs);
    if (desired === null) return { status: 'idle' };
    if (desired === this.lastApplied) return { status: 'steady', on: desired };
    if (!desired && this.sink.emergencyDisplayed()) {
      // Rule 5 — never draw over an alert. `lastApplied` is left alone so
      // this fires on the first tick after all-clear.
      return { status: 'deferred' };
    }
    this.sink.set(desired);
    this.lastApplied = desired;
    return { status: 'applied', on: desired };
  }
}

/** Tick cadence the page uses. A minute-resolution schedule needs no better. */
export const SOFT_SCHEDULE_TICK_MS = 30_000;
