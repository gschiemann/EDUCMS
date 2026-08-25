/**
 * State machine behind <ApiStatusBanner /> (operator-trust wave).
 *
 * `subscribeApiStatus` (lib/api-client.ts) has fired on every retry/backoff
 * since it was written and had ZERO consumers — during a Railway cold start
 * or a flaky connection the app just felt broken per-click with nothing on
 * screen explaining why. This reducer turns that event stream into the three
 * states a banner can be in. Pure + React-free so it can be unit-tested
 * without mounting the dashboard chrome.
 *
 * The bus emits three statuses:
 *   • `retrying`    — a request hit a network error / retryable 5xx and is
 *                     backing off (1s, 3s, 7s).
 *   • `unreachable` — retries exhausted; that request is dead.
 *   • `ok`          — we REACHED the API (2xx, and also 4xx — a 403 still
 *                     proves connectivity). This is our recovery signal.
 */

export type ApiBannerPhase = 'idle' | 'trouble' | 'recovered';

export interface ApiBannerState {
  readonly phase: ApiBannerPhase;
  /**
   * Bumped on every accepted transition INCLUDING trouble→trouble, so the
   * component's timer effect restarts on each fresh retry instead of letting
   * a stale-timer fire mid-outage. Never rendered.
   */
  readonly nonce: number;
}

export const initialApiBannerState: ApiBannerState = { phase: 'idle', nonce: 0 };

export type ApiBannerAction =
  | { type: 'api-status'; status: 'ok' | 'retrying' | 'unreachable' }
  /** The "Back online" confirmation has been up long enough. */
  | { type: 'recovered-elapsed' }
  /**
   * We've been claiming "reconnecting…" for a while with no further event.
   * Stand down QUIETLY rather than leaving a banner that's now lying — we
   * never saw a success, so we must not claim recovery either.
   */
  | { type: 'trouble-elapsed' };

/** How long "Back online" stays up before it dismisses itself. */
export const RECOVERED_HOLD_MS = 2500;

/** Longest we'll claim "reconnecting…" without hearing anything at all. */
export const TROUBLE_STALE_MS = 20000;

export function apiBannerReducer(
  state: ApiBannerState,
  action: ApiBannerAction,
): ApiBannerState {
  switch (action.type) {
    case 'api-status': {
      if (action.status === 'retrying' || action.status === 'unreachable') {
        return { phase: 'trouble', nonce: state.nonce + 1 };
      }
      // 'ok' — only meaningful as a RECOVERY. From idle it's the normal case
      // (every successful request emits it) and must not re-render the chrome;
      // from 'recovered' it must not restart the auto-dismiss timer. Returning
      // the same object reference makes React bail out of the update.
      if (state.phase === 'trouble') {
        return { phase: 'recovered', nonce: state.nonce + 1 };
      }
      return state;
    }
    case 'recovered-elapsed':
      return state.phase === 'recovered'
        ? { phase: 'idle', nonce: state.nonce + 1 }
        : state;
    case 'trouble-elapsed':
      return state.phase === 'trouble'
        ? { phase: 'idle', nonce: state.nonce + 1 }
        : state;
    default:
      return state;
  }
}
