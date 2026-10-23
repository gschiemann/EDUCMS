/**
 * Realtime (WebSocket) SUPERVISOR — the push channel always comes back
 * (player 1.1.51, field finding 2026-10-22).
 *
 * THE FIELD FAILURE. Across the fleet — field builds AND 1.1.23 units alike —
 * `last_push_connected_at` froze for 6–18 h while HTTP polling, telemetry and
 * render proof stayed fresh, and the API saw essentially no new `[WS] New
 * connection` attempts. The page had simply stopped dialling.
 *
 * WHY. Every re-arm of the WebSocket lived in ONE place: `ws.onclose`. The
 * backoff, the failure count, the SSE escalation and the HTTP-poll tier were
 * all downstream of that single browser event. A socket that never reaches
 * `onclose` — stuck in CONNECTING because an edge accepted the TCP connection
 * and never answered the upgrade (Chromium has no handshake timeout once TCP
 * is up — a deploy overlap, a proxy that holds the request), stuck in CLOSING
 * after our own `close()`, or OPEN but never authenticated — leaves the
 * failure count where it was, no timer armed, SSE never opened, the HTTP poll
 * never started. Forever, until a page reload. The `onclose`-driven ladder
 * worked exactly as designed; the one assumption it rested on did not hold.
 *
 * THE RULE. A separate, cheap tick (every [TICK_MS]) looks at the socket's
 * state with the clock and decides, independently of any browser event:
 *
 *   - no socket and no reconnect timer armed        → dial now
 *   - CONNECTING for longer than [CONNECTING_MAX_MS] → abandon, count a
 *                                                      failure, dial again
 *   - CLOSING for longer than [CLOSING_MAX_MS]       → same
 *   - OPEN but no AUTH_OK after [AUTH_MAX_MS]        → same (rule 5: a TCP
 *                                                      open is not connected)
 *   - OPEN + authenticated, silent for [SILENT_MAX_MS] → same (the
 *                                                      heartbeat's own 60 s
 *                                                      detector lives inside
 *                                                      an interval that can
 *                                                      itself be lost)
 *
 * Every abandon goes through the same failure accounting as a close
 * (`wsAuthPolicy.onConnectionFailure`), so the ≥3-failure SSE / HTTP ladder
 * engages from here too, and the backoff keeps its 1 s → 30 s shape with full
 * jitter. There is no give-up: the supervisor never stops, and it is armed
 * the moment the realtime effect mounts, outside the per-attempt timers.
 *
 * Emergency delivery is never behind this: the manifest poll (the HTTP
 * backstop that carries the live `emergency` field) runs on its own effect
 * and the 5 s HTTP fallback is one of the tiers this supervisor can engage.
 *
 * Pure and framework-free; `page.tsx` feeds it the facts.
 */

export const TICK_MS = 10_000;
export const CONNECTING_MAX_MS = 20_000;
export const CLOSING_MAX_MS = 10_000;
export const AUTH_MAX_MS = 30_000;
export const SILENT_MAX_MS = 75_000;

/** `WebSocket.readyState` values, named so the policy carries no DOM dependency. */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

export interface WsSupervisorFacts {
  /** Current socket's readyState, or null when there is no socket object. */
  readyState: number | null;
  /** Has THIS socket received AUTH_OK? */
  authOk: boolean;
  /** ms since the socket entered its current readyState (connect / open / close call). */
  sinceStateChangeMs: number;
  /** ms since the last message of any kind on this socket (Infinity when none). */
  sinceLastMessageMs: number;
  /** Is a reconnect timer already armed? */
  reconnectArmed: boolean;
}

export type WsSupervisorAction =
  | { action: 'none' }
  /** Nothing is dialling and nothing is scheduled: dial now (no failure counted). */
  | { action: 'dial'; reason: 'idle' }
  /** The current socket is stuck: tear it down, count a failure, dial with backoff. */
  | { action: 'abandon'; reason: 'connecting-stuck' | 'closing-stuck' | 'auth-stuck' | 'silent' };

export function superviseWs(f: WsSupervisorFacts): WsSupervisorAction {
  if (f.readyState === null || f.readyState === WS_CLOSED) {
    return f.reconnectArmed ? { action: 'none' } : { action: 'dial', reason: 'idle' };
  }
  if (f.readyState === WS_CONNECTING) {
    return f.sinceStateChangeMs >= CONNECTING_MAX_MS ? { action: 'abandon', reason: 'connecting-stuck' } : { action: 'none' };
  }
  if (f.readyState === WS_CLOSING) {
    return f.sinceStateChangeMs >= CLOSING_MAX_MS ? { action: 'abandon', reason: 'closing-stuck' } : { action: 'none' };
  }
  // OPEN
  if (!f.authOk) {
    return f.sinceStateChangeMs >= AUTH_MAX_MS ? { action: 'abandon', reason: 'auth-stuck' } : { action: 'none' };
  }
  if (f.sinceLastMessageMs >= SILENT_MAX_MS) return { action: 'abandon', reason: 'silent' };
  return { action: 'none' };
}
