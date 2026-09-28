/**
 * refreshAckReport — tell the server "I did it" the moment the page is back,
 * instead of waiting for the routine telemetry post to carry the confirmation.
 *
 * Why this exists (2026-09-28, Greg: "i would have thought a resync checks and
 * reports back right away"): a resync reloads the screen within seconds. The
 * durable-REFRESH ack (player rule 6 — the exact `refreshRequestedAt` VALUE the
 * page acted on, persisted BEFORE it reloads) was only ever reported inside the
 * ~60 s telemetry post, and the server accepts one of those per 30 s per screen.
 * A reloaded page posts first thing; if its pre-reload post was under 30 s old
 * the server 429s it — ack included — and the next try is a minute later. Real
 * numbers: reload at +8 s, confirmation at +72 s, and the dashboard called the
 * screen "Content behind" throughout.
 *
 * The page now posts the ack to `POST /screens/:id/refresh-ack` (its own accept
 * spacing, so the telemetry floor cannot starve it) as soon as it holds a device
 * credential. The telemetry post keeps carrying the same value, so the two paths
 * are idempotent and either one alone is enough.
 *
 * Pure, so the decision and the schedule are unit-tested without the player page.
 */

/** localStorage key: the last ack VALUE the server has answered for. */
export const LS_REFRESH_ACK_REPORTED = 'edu_refresh_ack_reported';

/**
 * The ack value to report now, or null when there is nothing to say: no
 * command was ever acted on, or this exact value already reached the server.
 */
export function refreshAckToReport(acked: number | null, reported: number | null): number | null {
  if (acked === null || !Number.isFinite(acked)) return null;
  return acked === reported ? null : acked;
}

/**
 * Delay before attempt N (0-based), or null once the ladder is spent. The first
 * try waits for boot to mint the device credential; the rest ride out a slow
 * network or a credential still being exchanged. Past ~45 s the telemetry post
 * — which carries the same value — takes over, exactly as before.
 */
export const REFRESH_ACK_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000, 10_000, 30_000];

export function refreshAckDelayMs(attempt: number): number | null {
  return attempt >= 0 && attempt < REFRESH_ACK_RETRY_DELAYS_MS.length
    ? REFRESH_ACK_RETRY_DELAYS_MS[attempt]
    : null;
}

export function readReportedRefreshAck(): number | null {
  try {
    const v = localStorage.getItem(LS_REFRESH_ACK_REPORTED);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markRefreshAckReported(value: number): void {
  try {
    localStorage.setItem(LS_REFRESH_ACK_REPORTED, String(value));
  } catch {
    /* unreadable storage: the telemetry post still carries it */
  }
}
