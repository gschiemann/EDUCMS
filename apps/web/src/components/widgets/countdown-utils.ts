/**
 * Countdown helpers shared across themed Countdown variants.
 *
 * Two modes:
 *   - 'date'      → single one-off date (existing behavior; uses config.targetDate)
 *   - 'recurring' → list of periods with weekday + start time. The widget
 *                   computes the NEXT upcoming period and counts down to it.
 *
 * Recurring period shape:
 *   { label: 'Lunch A', daysOfWeek: [1,2,3,4,5], startTime: '11:30' }
 *
 *   daysOfWeek: 0=Sun, 1=Mon, ... 6=Sat
 *   startTime:  'HH:MM' 24-hour
 */

export interface RecurringPeriod {
  label: string;
  daysOfWeek: number[];
  startTime: string; // 'HH:MM'
}

export interface CountdownConfig {
  mode?: 'date' | 'recurring';
  label?: string;
  // date mode
  targetDate?: string;
  // recurring mode
  periods?: RecurringPeriod[];
  prefix?: string; // e.g. "Next lunch in"
}

export interface CountdownTarget {
  /** When the countdown lands (Date) */
  target: Date;
  /** Human label for what we're counting down to */
  label: string;
  /** Optional prefix like "Next lunch in" */
  prefix?: string;
}

/**
 * Resolve the active target for a countdown config.
 * Returns null only if recurring mode has no valid periods at all.
 */
export function resolveCountdownTarget(config: CountdownConfig, now: Date = new Date()): CountdownTarget | null {
  const mode = config.mode || 'date';

  if (mode === 'date') {
    const target = config.targetDate
      ? new Date(config.targetDate.includes('T') ? config.targetDate : config.targetDate + 'T00:00:00')
      : new Date(now.getTime() + 12 * 86400000);
    return {
      target,
      label: config.label || 'Countdown',
    };
  }

  // recurring mode
  const periods = (config.periods || []).filter(p => p && p.startTime && (p.daysOfWeek?.length ?? 0) > 0);
  if (periods.length === 0) {
    // Fall back to a friendly "configure me" target so the widget still renders
    return {
      target: new Date(now.getTime() + 60 * 60_000),
      label: 'Configure periods',
      prefix: config.prefix || 'Next in',
    };
  }

  // Build candidate Date objects for the next 8 days, pick the soonest > now
  let best: { date: Date; period: RecurringPeriod } | null = null;
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    const dow = day.getDay();
    for (const p of periods) {
      if (!p.daysOfWeek.includes(dow)) continue;
      const [hh, mm] = p.startTime.split(':').map(n => parseInt(n, 10));
      const candidate = new Date(day);
      candidate.setHours(hh || 0, mm || 0, 0, 0);
      if (candidate.getTime() <= now.getTime()) continue;
      if (!best || candidate.getTime() < best.date.getTime()) {
        best = { date: candidate, period: p };
      }
    }
    if (best) break; // found something in/after this day; soonest already wins
  }

  if (!best) {
    return {
      target: new Date(now.getTime() + 60 * 60_000),
      label: 'No upcoming period',
      prefix: config.prefix || 'Next in',
    };
  }

  return {
    target: best.date,
    label: best.period.label,
    prefix: config.prefix || 'Next ' + best.period.label.toLowerCase() + ' in',
  };
}

/**
 * Format a millisecond diff as "1d 4h 23m" or "23m 12s" depending on size.
 * Used by every countdown variant for a consistent look.
 */
export function formatCountdownDiff(diffMs: number): { primary: string; secondary?: string; days: number; hours: number; mins: number; secs: number } {
  const total = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days >= 1) return { primary: `${days}d`, secondary: `${hours}h ${mins}m`, days, hours, mins, secs };
  if (hours >= 1) return { primary: `${hours}h`, secondary: `${mins}m`, days, hours, mins, secs };
  if (mins >= 1) return { primary: `${mins}m`, secondary: `${secs}s`, days, hours, mins, secs };
  return { primary: `${secs}s`, days, hours, mins, secs };
}

// Day-of-week label helpers (M T W Th F S Su)
export const DOW_SHORT = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];
export const DOW_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Calendar-day difference between target and now, in the user's LOCAL
 * timezone. Used by single-number countdown variants where the
 * operator's mental model is "May 4 → May 12 = 8 days" and not
 * "from this exact moment to target midnight = 7.something days,
 * floor to 7."
 *
 * 2026-05-04 — operator: "i set al of these to may 12th as the date,
 * thats 8 days away, wtf bro" + "its still 8 days until midnight
 * really" + "make sure it accounts for the users time zone".
 *
 * TIMEZONE BEHAVIOR (deliberate):
 *   The editor's <input type="date"> returns a wall-clock date string
 *   like "2026-05-12" with NO timezone info. We save it as
 *   "2026-05-12T00:00:00" (also no TZ). When new Date(...) parses
 *   that string it interprets it as midnight in whatever timezone
 *   the running JavaScript engine is in (the browser's local TZ).
 *
 *   getFullYear() / getMonth() / getDate() on a Date return the
 *   LOCAL year/month/day components. So when calendarDaysUntil runs:
 *     - In the editor (admin's browser): "today" = admin's local
 *       calendar date. target = May 12 in admin's local TZ.
 *       diff = correctly counted in admin's TZ.
 *     - On the player (kiosk at the school): "today" = school's
 *       local calendar date. target parses as May 12 in school's
 *       local TZ.
 *
 *   This is the right semantic for digital signage: "field trip on
 *   May 12 at 3pm" means "when the school's wall clock says 3pm
 *   May 12." The countdown ticks against the screen's own clock.
 *   Cross-TZ multi-tenant edge case (admin in EST scheduling for a
 *   PST screen) is intentionally interpreted as same-wall-clock.
 *
 * Multi-unit cluster widgets (DAYS HRS MIN SEC) use precise floor
 * math because their breakdown has to add up exactly.
 */
export function calendarDaysUntil(target: Date, now: Date = new Date()): number {
  // Zero out time component on both sides using LOCAL midnight.
  // new Date(y,m,d) constructs a local-time date at 00:00:00.000.
  // getFullYear/getMonth/getDate return components in the host's
  // local timezone — this is the load-bearing piece that makes the
  // function timezone-correct for both the editor and the player.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diff = Math.round((targetDay.getTime() - today.getTime()) / 86400000);
  return Math.max(0, diff);
}
