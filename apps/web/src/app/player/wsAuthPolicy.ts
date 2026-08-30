/**
 * WebSocket failure accounting policy (2026-08-30 player reliability
 * program, W1-5 / audit P0-1).
 *
 * THE BUG THIS REPLACES. The player reset `wsFailCountRef` to 0 in
 * `ws.onopen` — i.e. on TCP connect, BEFORE the application-level auth
 * handshake. The gateway answers a bad device token with `AUTH_FAIL` and
 * `close(4001)`, so a screen with a dead credential looped
 * open(reset→0) → AUTH_FAIL → close(+1 → 1) forever: the ≥3-failure
 * WS → SSE → HTTP fallback ladder was unreachable exactly when the
 * credential was the problem. A TCP `open` proves a school firewall let the
 * socket through; only `AUTH_OK` proves the realtime channel WORKS.
 *
 * Policy: the counter is monotonic across failed application handshakes —
 * it resets ONLY on `AUTH_OK`. `AUTH_FAIL` is additionally surfaced so the
 * caller can route it into credential recovery (one controlled re-register)
 * instead of blind reconnects.
 *
 * Pure and framework-free; the page wires it to the socket callbacks.
 */

export interface WsAuthPolicy {
  /** TCP connected. Deliberately does NOT reset the failure count. */
  onTcpOpen(): void;
  /** Application auth succeeded — the only event that resets the count. */
  onAuthOk(): void;
  /** Server rejected the token at the application layer. */
  onAuthFail(): void;
  /** Socket closed or errored (covers both transport and post-AUTH_FAIL closes). */
  onConnectionFailure(): void;
  failCount(): number;
  /** True once failures reach the fallback threshold (default 3). */
  shouldEscalateFallback(): boolean;
  /** True when the most recent failure was an application AUTH_FAIL. */
  lastFailureWasAuth(): boolean;
}

export const WS_FALLBACK_THRESHOLD = 3;

export function createWsAuthPolicy(threshold: number = WS_FALLBACK_THRESHOLD): WsAuthPolicy {
  let fails = 0;
  let authOk = false;
  let lastWasAuth = false;
  // AUTH_FAIL is followed by a server-initiated close(4001); count the pair
  // as ONE failure, not two, so the threshold means "3 rejected connects".
  // Set ONLY by onAuthFail; the matching close consumes it.
  let closeAlreadyCounted = false;

  return {
    onTcpOpen() {
      authOk = false;
      closeAlreadyCounted = false;
      // No reset — see header.
    },
    onAuthOk() {
      authOk = true;
      fails = 0;
      lastWasAuth = false;
    },
    onAuthFail() {
      lastWasAuth = true;
      closeAlreadyCounted = true;
      fails += 1;
    },
    onConnectionFailure() {
      if (closeAlreadyCounted) {
        // The close(4001) that follows an AUTH_FAIL we already counted.
        closeAlreadyCounted = false;
        return;
      }
      // A close after a successful auth is a NEW outage, not part of the
      // handshake-failure streak that authOk already cleared.
      if (!authOk) {
        fails += 1;
      } else {
        authOk = false;
        fails = 1;
        lastWasAuth = false;
      }
    },
    failCount: () => fails,
    shouldEscalateFallback: () => fails >= threshold,
    lastFailureWasAuth: () => lastWasAuth,
  };
}
