"use client";

/**
 * Shared live-clock + helpers for the HS template pack.
 *
 * 2026-05-07 — pre-demo audit (docs/research/HS_TEMPLATES_AUDIT_2026_05_07.md)
 * found that all 16 HS widgets had a hardcoded clockTime ("7:53") that
 * never updated. The customer's HS-district demo would show a wall of
 * frozen-clock signage.
 *
 * Each HS widget config exposes two clock fields:
 *   - clockTime       (e.g. "7:53")     — operator override
 *   - clockCaption    (e.g. "Tuesday")  — operator override
 *
 * Hook contract:
 *   useHsLiveClock(isLive) returns the current Date, polled every 30s
 *   when isLive is true. Frozen at component-mount time when isLive is
 *   false (gallery thumbnails, preview modals).
 *
 * Helper contract:
 *   resolveHsClock(c, now) returns the strings to render:
 *     {
 *       time:    operator override OR derived from `now`
 *       caption: operator override OR derived from `now`
 *     }
 *   This way an operator who explicitly sets clockTime="9:30" for a
 *   printed marketing screenshot keeps that fixed value; an operator
 *   who leaves the default "7:53" (or any pure-numeric pattern that
 *   matches the placeholder) gets the live time instead.
 *
 * Why this hook lives in the hs/ folder rather than a shared utils
 * file: scope. It's only consumed by HS widgets; pulling it into the
 * top-level utilities would create import-graph noise for components
 * that don't care.
 */

import { useEffect, useState } from 'react';

/** Same 30s cadence as AnimatedWelcomeWidget — minute-resolution clocks
 *  don't need sub-30s ticks. Saves a re-render every second × 16
 *  widgets on a demo wall. */
const TICK_MS = 30_000;

/**
 * Live-poll clock. Returns the current Date. When isLive is false
 * (thumbnail / preview), the Date freezes at mount and never ticks —
 * matches AnimatedWelcomeWidget's gallery-thumbnail optimization.
 */
export function useHsLiveClock(isLive: boolean = true): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    if (!isLive) return;
    // Re-render every TICK_MS. State-based rather than DOM mutation so
    // multiple widget instances on a page (gallery thumb + preview
    // modal) don't fight over a shared DOM id — same reason
    // AnimatedWelcomeWidget uses state.
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, [isLive]);
  return now;
}

/**
 * Detect whether a clockTime override looks like a placeholder (e.g.
 * the widget's DEFAULT clockTime constant). If so, the live clock wins.
 * If the operator explicitly typed a different time, that override
 * wins. Heuristic: any value matching a HH:MM or H:MM pattern is
 * considered a placeholder UNLESS it differs from the widget's own
 * default — in which case it's an operator override.
 *
 * NOTE: callers pass the widget's DEFAULT clockTime as `defaultValue`
 * so we can compare. Without that comparison we can't distinguish
 * "operator wants 7:53 frozen" from "this is the demo placeholder."
 */
function isPlaceholderClock(value: string | undefined, defaultValue: string): boolean {
  if (!value) return true;
  return value.trim() === defaultValue.trim();
}

/**
 * Resolve the visible clock + caption from a config + the current
 * Date.
 *
 * Operator can ALWAYS override by setting clockTime / clockCaption to
 * any non-default value. Defaults derive from `now`.
 *
 * @param cfg                Widget config (must include clockTime + clockCaption)
 * @param now                Current Date from useHsLiveClock()
 * @param defaultClockTime   The widget's DEFAULT clockTime constant
 *                           (used to detect placeholder vs override)
 * @param defaultClockCap    Same for clockCaption
 */
export function resolveHsClock(
  cfg: { clockTime?: string; clockCaption?: string; clockTimezone?: string },
  now: Date,
  defaultClockTime: string,
  defaultClockCap: string,
): { time: string; caption: string } {
  // 2026-05-07 — operator-selected timezone (US zones — see the
  // SelectField in PropertiesPanel). Empty / undefined → browser tz.
  // Both time AND caption use the same timezone so the day-of-week
  // matches the displayed clock.
  const tz = cfg.clockTimezone || undefined;
  // Time: HH:MM in the selected (or browser) timezone.
  const liveTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  });
  // Caption: weekday + period hint, also in the selected tz so a
  // California-set California display reads "Morning" until 12 PT,
  // not "Afternoon" because the server happens to be Eastern.
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  // Get the HOUR in the selected timezone for the period hint.
  // toLocaleString with hour12:false gives 0-23.
  const hourStr = now.toLocaleString('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: tz,
  });
  const hour = parseInt(hourStr, 10) || 0;
  const period = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const liveCaption = `${dayName} · ${period}`;

  return {
    time: isPlaceholderClock(cfg.clockTime, defaultClockTime) ? liveTime : (cfg.clockTime || liveTime),
    caption: isPlaceholderClock(cfg.clockCaption, defaultClockCap) ? liveCaption : (cfg.clockCaption || liveCaption),
  };
}

/**
 * Pick a `now` Date in a specific timezone for caller-provided
 * formatters. Use this when a widget's date format is hand-built
 * (e.g. `${weekday} · ${month} ${day}`) rather than via toLocaleDateString.
 *
 * Returns a Date whose UTC fields read out the selected timezone's
 * local wall-clock — handy for `.getDate()` / `.getMonth()` etc.
 * Empty tz → returns the original Date (browser local time).
 */
export function nowInTimezone(now: Date, tz: string | undefined): Date {
  if (!tz) return now;
  // Trick: format the date into the target tz, then re-parse as if
  // those numbers were UTC. Result: get*() methods give the local
  // wall-clock in the selected timezone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const y = parseInt(parts.year, 10);
  const m = parseInt(parts.month, 10) - 1;
  const d = parseInt(parts.day, 10);
  let h = parseInt(parts.hour, 10);
  const mn = parseInt(parts.minute, 10);
  const s = parseInt(parts.second, 10);
  // 'en-US' with hour12:false uses 0-23 except midnight reads as '24' — normalize.
  if (h === 24) h = 0;
  return new Date(Date.UTC(y, m, d, h, mn, s));
}

/**
 * Resolve the visible date string from a config + the current Date.
 *
 * Each HS template formats its date region differently — Blueprint
 * uses "2026-04-21", Gallery uses "Tuesday, April 21", Transit uses
 * "TUE · APR 21". Pass the widget's own `formatLive(now)` so the live
 * date matches the template's typography exactly.
 *
 * Operator override wins when their value differs from the widget's
 * default placeholder string. Empty / matches-default → live date.
 *
 * @param cfg                Widget config (must include clockDate)
 * @param now                Current Date from useHsLiveClock()
 * @param defaultClockDate   Widget's DEFAULT clockDate constant (placeholder detection)
 * @param formatLive         (now) => string — formats `now` to match the template's style
 */
export function resolveHsDate(
  cfg: { clockDate?: string; clockTimezone?: string },
  now: Date,
  defaultClockDate: string,
  formatLive: (d: Date) => string,
): string {
  // Use the wall-clock Date in the operator-selected timezone so
  // formatLive's `.getDate()` / `.toLocaleDateString()` calls all
  // produce the right local date.
  const tzDate = nowInTimezone(now, cfg.clockTimezone);
  const liveDate = formatLive(tzDate);
  if (!cfg.clockDate || cfg.clockDate.trim() === defaultClockDate.trim()) return liveDate;
  return cfg.clockDate;
}

/**
 * Common US-timezone options for the editor SelectField. The empty
 * string at the top means "(use browser default)" and is the default
 * value — most operators in the US are running their browser in
 * their own timezone already, so this Just Works without a setting.
 *
 * Why hardcoded rather than dynamic: lobby displays mostly serve
 * one school in one timezone. A dropdown of the 6 common US zones
 * is faster than typing "America/Los_Angeles" by hand. Add more
 * zones here when international deployments come online.
 */
export const US_TIMEZONE_OPTIONS: ReadonlyArray<[string, string]> = [
  ['', '(Auto — use browser timezone)'],
  ['America/New_York', 'Eastern (ET)'],
  ['America/Chicago', 'Central (CT)'],
  ['America/Denver', 'Mountain (MT)'],
  ['America/Phoenix', 'Mountain – Arizona (no DST)'],
  ['America/Los_Angeles', 'Pacific (PT)'],
  ['America/Anchorage', 'Alaska (AKT)'],
  ['Pacific/Honolulu', 'Hawaii (HT)'],
];
