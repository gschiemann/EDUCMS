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
