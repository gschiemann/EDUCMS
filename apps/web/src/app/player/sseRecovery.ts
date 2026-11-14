/**
 * SSE TIER RECOVERY (2026-11-14) — what the player does when its EventSource
 * reports an error.
 *
 * ── THE FIELD FAILURE ─────────────────────────────────────────────────────
 * Houston Free Standing Kiosk, 2026-11-13. Its WebSocket dropped at 18:46 UTC
 * and the player opened the SSE middle tier through the same-origin gateway.
 * The stream ran its full 15 minutes and closed at 19:01:25. EventSource then
 * did what EventSource always does: it reconnected to THE SAME URL — whose
 * `?ticket=` is a 60-second stream ticket (SDE-02 / DT-08). The API refused it
 * (`[SSE] ticket rejected: ticket_expired`, 401) at 19:01:28. That was the
 * second error, and the old handler's rule was "two errors without an onopen
 * → give up on SSE for the rest of the session". The screen had no push
 * channel at all until its nightly reload at 09:06 UTC the next day: 14 hours.
 *
 * The API side wrote down the requirement when tickets shipped
 * (`apps/api/src/realtime/sse.controller.ts`): "on `es.onerror`, CLOSE the
 * EventSource before retrying — its built-in auto-reconnect replays the same
 * (by then expired) ticket URL forever." The player minted tickets but never
 * implemented the close.
 *
 * ── THE RULE THIS MODULE ENCODES ──────────────────────────────────────────
 *   • EVERY error closes the EventSource. The browser's own reconnect can only
 *     replay a URL whose ticket has expired, so it is never allowed to run.
 *   • EVERY error schedules a re-open through `tryOpenSse`, which mints a
 *     FRESH ticket. A routine 15-minute stream rotation is therefore one error
 *     followed by one successful open — the counter resets on `onopen`.
 *   • From the second consecutive error the 5 s HTTP poll is armed as the
 *     floor, exactly as before. What changed: the SSE tier is never abandoned
 *     for the session. Re-opens back off exponentially (equal jitter, so one
 *     site's screens do not re-mint in lockstep) to a 5-minute ceiling.
 *
 * Pure (no DOM, no timers) so it is unit-tested without mounting the player,
 * the same pattern as `wsSupervisor.ts` and `apiOrigin.ts`.
 */

/** First re-open delay ceiling; the delay doubles per consecutive failure. */
export const SSE_RETRY_BASE_MS = 2_000;
/** Longest wait between two re-open attempts. */
export const SSE_RETRY_MAX_MS = 5 * 60_000;
/** Consecutive failures (no `onopen` between) that arm the HTTP poll floor. */
export const SSE_FAILURES_BEFORE_HTTP_POLL = 2;

export interface SseErrorDecision {
  /** Always true: the EventSource is closed so it cannot replay an expired ticket. */
  close: true;
  /** Arm the 5 s HTTP poll floor (the call site makes this idempotent). */
  engageHttpPoll: boolean;
  /** Re-open with a freshly minted ticket after this many milliseconds. */
  retryInMs: number;
}

/**
 * @param failCount consecutive SSE errors INCLUDING this one (≥ 1); reset to 0
 *                  by a successful `onopen` or by the WebSocket's AUTH_OK.
 * @param rand      injectable for tests; defaults to `Math.random`.
 */
export function onSseError(failCount: number, rand: () => number = Math.random): SseErrorDecision {
  const n = Number.isFinite(failCount) && failCount >= 1 ? Math.floor(failCount) : 1;
  // 2 ** 30 already exceeds the ceiling; clamping the exponent keeps the
  // arithmetic finite for any counter value.
  const ceiling = Math.min(SSE_RETRY_MAX_MS, SSE_RETRY_BASE_MS * 2 ** Math.min(n - 1, 30));
  const r = Math.min(1, Math.max(0, rand()));
  const retryInMs = Math.round(ceiling / 2 + r * (ceiling / 2));
  return { close: true, engageHttpPoll: n >= SSE_FAILURES_BEFORE_HTTP_POLL, retryInMs };
}
