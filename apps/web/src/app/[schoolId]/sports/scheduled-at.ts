/**
 * scheduled-at — pure client-boundary conversion for the game kickoff
 * field (Inputs-wave SCHED, 2026-08-10).
 *
 * THE TIMEZONE BUG THIS CLOSES: `<input type="datetime-local">` yields a
 * zone-less string ("2026-08-21T19:00"). Both writers used to send that
 * string verbatim, and the API's `parseScheduledAt` is a bare
 * `new Date(value)` — which parses a zone-less string in the SERVER's
 * zone (UTC on Railway). Harmless while scheduledAt was display-only
 * (display re-parses in the browser), but schedule game mode ACTS on it:
 * an auto-push built on the raw string fires a 7pm game at noon.
 *
 * The fix lives at the CLIENT boundary because only the browser knows the
 * operator's zone: parse the zone-less string here (`new Date` interprets
 * it in the BROWSER's zone — the operator typing "7:00 PM" means 7pm at
 * their venue) and send a full ISO string WITH timezone
 * (`.toISOString()`), which every runtime parses identically. The server
 * keeps accepting both forms — old clients and hand-rolled API callers
 * stay legal.
 *
 * PURE (no React, no fetch) so the conversion is unit-testable — the
 * game-list.ts convention.
 */

/** Baked auto-push lead (mirror of the API's AUTO_PUSH_LEAD_MS — the GET
 *  response's `leadMs` is authoritative; this is the render fallback). */
export const DEFAULT_AUTO_PUSH_LEAD_MS = 10 * 60_000;

/**
 * Convert a datetime-local input value (zone-less, browser-zone) to a
 * full ISO-8601 string with timezone. Empty/blank/unparseable → null
 * (the API treats null as "no time set" — same contract as before).
 * An already-zoned string (ISO with Z/offset) passes through normalized.
 */
export function datetimeLocalToIso(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * The moment the armed board goes up — scheduledAt minus the lead —
 * or null when no kickoff is set. `leadMs` should come from the
 * auto-push GET (`leadMs`); falls back to the baked default.
 */
export function autoPushMoment(
  scheduledAt: string | Date | null | undefined,
  leadMs: number = DEFAULT_AUTO_PUSH_LEAD_MS,
): Date | null {
  if (!scheduledAt) return null;
  const t = new Date(scheduledAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t - leadMs);
}
