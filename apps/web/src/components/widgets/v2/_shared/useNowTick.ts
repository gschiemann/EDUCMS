'use client';

/**
 * useNowTick — a clock that is still true an hour after the board booted.
 *
 * WHY (audit finding W02, 2026-09-12). A widget that renders
 * `new Date().toLocaleTimeString()` inline is not showing the time; it is
 * showing the time of its LAST RENDER. A dashboard re-renders constantly so
 * nobody noticed — but a wall panel mounts once and then sits there, and
 * `withMeasuredHeight` only re-renders it on a resize that never comes. The
 * departures board, the door sign and the now-serving queue all froze at
 * whatever minute the screen finished booting, and went on presenting that
 * stale minute as the current time.
 *
 * The cadence is the DISPLAY's resolution, not a guess: a widget showing
 * hh:mm ticks every 30s (so it is never more than half a minute stale), one
 * showing seconds ticks every second. Pass `enabled: false` for a gallery
 * thumbnail or a frozen preview — there, one reading at render IS the truth
 * and a timer would just burn a frame budget.
 */

import { useEffect, useState } from 'react';

export function useNowTick(intervalMs = 30_000, enabled = true): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
