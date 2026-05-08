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
  cfg: { clockTime?: string; clockCaption?: string },
  now: Date,
  defaultClockTime: string,
  defaultClockCap: string,
): { time: string; caption: string } {
  // Time: HH:MM (24h) — most HS widgets render this in a stat-row
  // tile where the colon is the dominant typography. Localized
  // formatting respects the operator's browser locale.
  const liveTime = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  // Caption: weekday + period hint. Period hint is intentionally
  // generic ("Morning" / "Afternoon") because we don't have a bell
  // schedule wired in this hook. If/when bell schedule lands as live
  // data, replace this fallback with the actual period name.
  const dayName = now.toLocaleDateString(undefined, { weekday: 'long' });
  const hour = now.getHours();
  const period = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const liveCaption = `${dayName} · ${period}`;

  return {
    time: isPlaceholderClock(cfg.clockTime, defaultClockTime) ? liveTime : (cfg.clockTime || liveTime),
    caption: isPlaceholderClock(cfg.clockCaption, defaultClockCap) ? liveCaption : (cfg.clockCaption || liveCaption),
  };
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
  cfg: { clockDate?: string },
  now: Date,
  defaultClockDate: string,
  formatLive: (d: Date) => string,
): string {
  const liveDate = formatLive(now);
  if (!cfg.clockDate || cfg.clockDate.trim() === defaultClockDate.trim()) return liveDate;
  return cfg.clockDate;
}
