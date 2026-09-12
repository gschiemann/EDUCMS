/**
 * TIME TRUTH — the arithmetic behind every "NOW", "Updated …" and
 * "Free for …" a widget is allowed to put on a wall.
 *
 * WHY THIS EXISTS (audit finding W02, 2026-09-12). Four widgets printed a
 * time claim nothing backed:
 *
 *   • the bell schedule picked its "NOW" period with `floor(currentHour - 8)`
 *     — the index of the hour since 08:00, not the period whose CONFIGURED
 *     times contain the clock. A school whose first bell is 07:15 had the
 *     wrong period lit all day; on a Saturday it lit one anyway.
 *   • a meeting-room door sign said "Free for 32 min" as a string constant.
 *   • a wait-times board said "Updated <render time>", so numbers typed a
 *     week ago read as if a feed had just confirmed them.
 *   • a parking board said "Updated 30s ago" as a string constant.
 *
 * This is the same defect the emergency system already has a rule against
 * (CLAUDE.md, player rule 10: copy states what the evidence proves). A
 * lobby screen that says nothing is honest; one that says "NOW" beside the
 * wrong period is not.
 *
 * THE RULES THESE FUNCTIONS ENCODE
 *   1. A current slot comes from CONFIGURED times against a real clock. When
 *      no configured window contains the clock, there is NO current slot —
 *      `activeWindowIndex` returns -1 and the caller shows no badge.
 *   2. A window with no provable end is not a window. `end` may be omitted
 *      and inherited from the next window's start; the LAST window with no
 *      end can never be "now", because nothing says when it stops.
 *   3. A freshness claim needs a RECORDED time — a saved `updatedAt`, or the
 *      moment a fetch actually succeeded. Render time is not evidence, and a
 *      recorded time in the future is not evidence either. No evidence means
 *      no label, never a fabricated one.
 *
 * Pure module: no React, no DOM, no network — so the edge cases (DST, an
 * unknown timezone, a midnight wrap) are unit-testable without a browser.
 */

import { parseTimeToMinutes } from './format-time';

/** What a clock reads right now, in whatever zone the widget is configured for. */
export interface ClockReading {
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
  /** Day of week in that zone: 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Monday–Friday. A bell schedule is a school-DAY artifact: highlighting
 *  "Period 3 · NOW" at 10am on a Sunday is a claim about the building being
 *  in session that the configured times alone cannot support. Suppressing
 *  the badge on a weekend is the conservative direction — it under-claims. */
export const SCHOOL_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Read the wall clock — in `timeZone` when one is configured, otherwise on
 * the device clock.
 *
 * Goes through `Intl` rather than `Date#getHours` so a configured zone is
 * actually honoured AND so DST is handled by the platform's tz database
 * instead of a hand-rolled offset. An unknown or malformed zone throws
 * `RangeError` inside `Intl`; that must never take a board down, so it falls
 * back to the device clock — the same reading the widget had before anyone
 * typed a zone.
 */
export function readClock(now: Date, timeZone?: string | null): ClockReading {
  const zone = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : undefined;
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
        timeZone: zone,
      }).formatToParts(now);
      const hour = Number(parts.find((p) => p.type === 'hour')?.value);
      const minute = Number(parts.find((p) => p.type === 'minute')?.value);
      const weekday = WEEKDAY_INDEX[String(parts.find((p) => p.type === 'weekday')?.value)];
      if (Number.isFinite(hour) && Number.isFinite(minute) && weekday != null) {
        // h23 gives 00–23, so a midnight reading is 0 and never 24.
        return { minutes: (hour % 24) * 60 + minute, weekday };
      }
    } catch {
      // Unknown timezone — fall through to the device clock.
    }
  }
  return { minutes: now.getHours() * 60 + now.getMinutes(), weekday: now.getDay() };
}

/**
 * `Intl` formatting that cannot take a board down. A malformed `timeZone`
 * throws `RangeError`, and an uncaught throw inside a widget unmounts the
 * whole React root — so an unusable zone degrades to the device clock, which
 * is the reading the screen had before anyone configured one.
 */
export function formatInZone(
  now: Date,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
): string {
  const zone = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : undefined;
  if (zone) {
    try {
      return new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(now);
    } catch {
      // Unknown timezone — fall through to the device clock.
    }
  }
  return new Intl.DateTimeFormat('en-US', options).format(now);
}

/** One configured slot: a bell period, a booking, an opening window. */
export interface TimeWindow {
  start?: string | null;
  end?: string | null;
}

/**
 * Index of the window that CONTAINS `nowMinutes`, or -1 when none does.
 *
 * `end` is optional and inherited from the next window's start, which is how
 * a bell schedule is usually typed ("Period 1: 8:00, Period 2: 8:55"). The
 * last window with no end stays unmatched on purpose: nothing in the config
 * says when it stops, so nothing can prove it is running.
 *
 * A window whose end does not come after its start is skipped rather than
 * guessed at (a typo, or a slot crossing midnight — either way the evidence
 * is ambiguous, and under-claiming is the safe direction).
 */
export function activeWindowIndex(windows: readonly TimeWindow[], nowMinutes: number): number {
  const starts = windows.map((w) => parseTimeToMinutes(w?.start));
  for (let i = 0; i < windows.length; i++) {
    const start = starts[i];
    if (start == null) continue;
    let end = parseTimeToMinutes(windows[i]?.end);
    if (end == null) {
      // Inherit the next PARSEABLE start as this window's end.
      for (let j = i + 1; j < windows.length; j++) {
        if (starts[j] != null) { end = starts[j]; break; }
      }
    }
    if (end == null || end <= start) continue;
    if (nowMinutes >= start && nowMinutes < end) return i;
  }
  return -1;
}

/**
 * Index of the first window that STARTS strictly after `nowMinutes`, or -1.
 * This is what "free until the next booking" is allowed to be computed from.
 * Windows are read in config order and not re-sorted — the operator's own
 * ordering is the only ordering we can attest to.
 */
export function nextWindowIndex(windows: readonly TimeWindow[], nowMinutes: number): number {
  for (let i = 0; i < windows.length; i++) {
    const start = parseTimeToMinutes(windows[i]?.start);
    if (start != null && start > nowMinutes) return i;
  }
  return -1;
}

/**
 * Coerce whatever the config/API handed us into a real instant, or null.
 * Accepts an ISO string, epoch milliseconds, or a Date. Anything else —
 * including the empty string and NaN — is NOT evidence and yields null.
 */
export function readRecordedTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  return null;
}

/**
 * "just now" / "12m ago" / "3h ago" / "2d ago" for a time something was
 * actually recorded at — or null when there is nothing to claim.
 *
 * Returns null for a recorded time in the FUTURE: a board cannot have been
 * updated later than now, so that reading is a broken clock or a bad field,
 * and silence beats printing "in 4 hours" under the word "Updated".
 */
export function freshnessLabel(recorded: Date | null, now: Date): string | null {
  if (!recorded) return null;
  const diffMs = now.getTime() - recorded.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Read a freshness claim straight off a widget config. `updatedAt` is the
 * canonical key; `lastUpdated` is accepted because imported/seeded content
 * uses it. Nothing else counts — and when neither is present the caller
 * renders NO timestamp, per rule 3 above.
 */
export function configFreshness(
  config: { updatedAt?: unknown; lastUpdated?: unknown } | null | undefined,
  now: Date,
): string | null {
  if (!config) return null;
  return freshnessLabel(readRecordedTime(config.updatedAt ?? config.lastUpdated), now);
}
