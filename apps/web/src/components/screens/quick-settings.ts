/**
 * quick-settings.ts — the pure rules behind the simplified screen
 * "Settings" tab (2026-11-01).
 *
 * The owner's brief: the tab was "crazy overwhelming for any end user".
 * Everything a screen cannot do used to be drawn anyway — greyed rows,
 * orange warnings, "needs adb" — each at the same weight as the controls
 * people actually use. The rules are now:
 *
 *  1. TOP: only the most-used controls — Sleep / Awake, Volume, Brightness,
 *     the on/off schedule as ONE line, and Restart.
 *  2. A control this screen cannot do is NOT RENDERED. Never greyed, never a
 *     "not possible on this unit" row.
 *  3. Setup is one line ("Setup complete" / "3 things need setup").
 *  4. Everything else sits under Advanced, closed by default.
 *
 * No React in here: the visibility rules are unit-tested without mounting
 * the drawer (`__tests__/quick-settings.test.ts`).
 */

import type { ResolvedDisplayControls } from './display-capabilities';

export interface QuickControls {
  /** Sleep / Awake — universal (the soft blank needs no hardware). */
  sleepAwake: boolean;
  volume: boolean;
  brightness: boolean;
  /** The restart button. Only where the unit can actually restart. */
  restart: boolean;
  /** The one-line on/off schedule. Dead on a browser player, so hidden there. */
  schedule: boolean;
}

/**
 * Which top-of-tab controls exist for this screen.
 *
 * A browser player with nothing reported keeps ONLY Sleep / Awake — the soft
 * blank is drawn by the player page itself — because every other control
 * needs the native bridge and would fail 100% of the time.
 */
export function resolveQuickControls(
  caps: Pick<ResolvedDisplayControls, 'reported' | 'volume' | 'brightness' | 'reboot'>,
  opts: { browserPlayer?: boolean } = {},
): QuickControls {
  if (opts.browserPlayer && !caps.reported) {
    return { sleepAwake: true, volume: false, brightness: false, restart: false, schedule: false };
  }
  return {
    sleepAwake: true,
    // On a screen that has never reported, volume has no recovery direction
    // at all (the API refuses it), so `caps.volume.available` is already false.
    volume: caps.volume.available,
    brightness: caps.brightness.available,
    restart: caps.reboot.available,
    schedule: true,
  };
}

// ─── The on/off schedule as one line ─────────────────────────────────────

export interface ScheduleLike {
  onTime?: string | null;
  offTime?: string | null;
  isActive?: boolean | null;
}

export type ScheduleLine =
  | { kind: 'none' }
  | { kind: 'paused' }
  | { kind: 'window'; offAt: string; onAt: string; more: number };

/** "HH:MM" (or "HH:MM:SS") -> a clock label in the reader's language; null if unreadable. */
export function formatClock(hhmm: string | null | undefined, locale: string): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: min === 0 ? undefined : '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, 0, 1, h, min)));
  } catch {
    return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
}

/**
 * Reduce the saved schedules to the single line the tab shows. The first
 * active window leads ("Off 6 PM – on 7 AM"); any others are a "+N more".
 * Schedules that are all paused say so, because a paused schedule is not
 * "no schedule".
 */
export function summarizeScheduleLine(
  schedules: readonly ScheduleLike[] | null | undefined,
  locale: string,
): ScheduleLine {
  const list = Array.isArray(schedules) ? schedules : [];
  if (list.length === 0) return { kind: 'none' };
  const active = list.filter((s) => s?.isActive !== false);
  if (active.length === 0) return { kind: 'paused' };
  for (let i = 0; i < active.length; i++) {
    const offAt = formatClock(active[i].offTime, locale);
    const onAt = formatClock(active[i].onTime, locale);
    if (offAt && onAt) return { kind: 'window', offAt, onAt, more: active.length - 1 };
  }
  return { kind: 'none' };
}

// ─── Which schedule actually applies (screen's own, else its group's) ────

export type AppliedScheduleSource = 'screen' | 'group' | 'none';

export interface AppliedSchedule {
  source: AppliedScheduleSource;
  line: ScheduleLine;
}

/**
 * Mirrors the API's manifest rule (display-manifest.ts): only ACTIVE rows
 * count, and any active screen-level row wins outright over the group's.
 * Paused-only rows read "paused" (not "none") so the line never lies.
 */
export function resolveAppliedSchedule(
  screenRows: readonly ScheduleLike[] | null | undefined,
  groupRows: readonly ScheduleLike[] | null | undefined,
  locale: string,
): AppliedSchedule {
  const own = summarizeScheduleLine(screenRows, locale);
  if (own.kind === 'window') return { source: 'screen', line: own };
  const inherited = summarizeScheduleLine(groupRows, locale);
  if (inherited.kind === 'window') return { source: 'group', line: inherited };
  if (own.kind === 'paused') return { source: 'screen', line: own };
  if (inherited.kind === 'paused') return { source: 'group', line: inherited };
  return { source: 'none', line: { kind: 'none' } };
}
