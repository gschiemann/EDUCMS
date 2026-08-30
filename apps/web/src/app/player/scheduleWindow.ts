/**
 * Schedule-window evaluation + edge detection (2026-08-30 deep audit,
 * findings B-P0-1 / B-P0-2 / B-P0-3).
 *
 * THE HISTORY, HONESTLY. Playlist-level daysOfWeek/timeStart/timeEnd have
 * existed in the product for months — and were NEVER enforced on the glass:
 * the manifest's per-item payload never carried the fields, so the player's
 * per-item gate always returned "playable". The 2026-08-30 ranked-winner
 * change started consulting `pl.schedule` windows for winner selection —
 * i.e. it silently switched enforcement on for the whole fleet — with two
 * latching bugs the adversarial audit caught before they shipped further:
 *
 *   1. The inline compare had no overnight wrap: a 22:00–06:00 window was
 *      NEVER open (23:00 fails `>` end; 02:00 fails `<` start). Every bar,
 *      gym and hotel board with a night window → permanently dark.
 *   2. Windows were only evaluated on a 200 — and the steady state is 304,
 *      because window bounds are constants inside the ETag-hashed payload.
 *      06:59 and 07:00 serve byte-identical 304s, so a verdict, once
 *      applied, LATCHED: blank at boot-outside-window stayed blank all
 *      day; blank at window-close never came back.
 *
 * This module is the deliberate version: a pure, wrap-aware evaluator
 * (unit-tested for every window shape) plus a WINDOW SIGNATURE the reconcile
 * loop diffs before each poll — when the local verdict for the last-applied
 * manifest changes (a window edge crossed), the caller drops its ETag so the
 * next poll is a full 200 and selection re-runs. Cost: one full manifest
 * body per screen per window edge (typically ≤2/day), not per poll.
 *
 * DAY SEMANTICS FOR WRAPPING WINDOWS: the START day owns the whole window.
 * A `Fri 22:00–06:00` schedule covers Friday 22:00 → Saturday 06:00 (the
 * operator scheduled "Friday night", and Friday night ends Saturday
 * morning). Concretely: a time inside the pre-midnight half must match
 * TODAY in daysOfWeek; a time inside the post-midnight half must match
 * YESTERDAY.
 */

export interface WindowFields {
  daysOfWeek?: string | null; // "Mon,Tue,Wed" — day-name substrings
  timeStart?: string | null;  // "HH:MM"
  timeEnd?: string | null;    // "HH:MM"
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function dayMatches(daysOfWeek: string, dayIndex: number): boolean {
  return daysOfWeek.includes(DAY_NAMES[((dayIndex % 7) + 7) % 7]);
}

/**
 * Is this schedule's window open at `now` (local time — signage windows are
 * wall-clock local by definition)?
 */
export function isWindowOpen(sched: WindowFields | null | undefined, now: Date): boolean {
  if (!sched) return true;
  const daysOfWeek = sched.daysOfWeek ? String(sched.daysOfWeek) : null;
  const start = sched.timeStart || null;
  const end = sched.timeEnd || null;
  if (!daysOfWeek && !start && !end) return true;

  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = now.getDay();

  const wraps = !!(start && end && end < start);
  if (!wraps) {
    // Simple same-day window (or open-ended one side).
    if (daysOfWeek && !dayMatches(daysOfWeek, today)) return false;
    if (start && hhmm < start) return false;
    if (end && hhmm > end) return false;
    return true;
  }

  // Overnight wrap: open when at/after start (the pre-midnight half, owned
  // by TODAY) or at/before end (the post-midnight half, owned by YESTERDAY).
  if (hhmm >= (start as string)) {
    return daysOfWeek ? dayMatches(daysOfWeek, today) : true;
  }
  if (hhmm <= (end as string)) {
    return daysOfWeek ? dayMatches(daysOfWeek, today - 1) : true;
  }
  return false;
}

/**
 * One character per playlist: '1' open / '0' closed, in manifest order.
 * The reconcile loop compares this against the signature computed when the
 * manifest was APPLIED; a difference means a window edge was crossed and
 * the cached 304 identity is no longer the truth on the glass.
 */
export function windowSignature(
  playlists: Array<{ schedule?: WindowFields | null }> | null | undefined,
  now: Date,
): string {
  if (!Array.isArray(playlists) || playlists.length === 0) return '';
  return playlists.map((pl) => (isWindowOpen(pl?.schedule ?? null, now) ? '1' : '0')).join('');
}
