/**
 * P0-1 (2026-09-02) — DIRECT-FIRST, SAME-ORIGIN-GATEWAY FALLBACK.
 *
 * ── THE FIELD FAILURE ─────────────────────────────────────────────────────
 * The player shell is served from the WEB origin (Vercel, `venue-os.app`) but
 * its ENTIRE control plane — register, pairing status, manifest, emergency
 * reconcile, render proof, SSE — talks to a SEPARATE origin on Railway
 * (`NEXT_PUBLIC_API_URL`). Specific OEM Android WebViews (Android-9 Goodview
 * units) load the shell fine and then cannot reach the Railway origin at all
 * (suspected TLS chain / DNS / transparent proxy). The device sits on
 * "Connecting to your CMS…" forever: the shell proves nothing about the API.
 *
 * ── THE RULE THIS MODULE ENCODES ──────────────────────────────────────────
 * Try the DIRECT origin exactly as before. After N CONSECUTIVE
 * NETWORK-CLASS control-plane failures, move the WHOLE control plane (never
 * just registration — a device that pairs one way and then loses manifests
 * and emergencies is WORSE than one that never paired) to the page origin,
 * which proxies to the API through Next middleware. Persist that choice so
 * the device does not re-suffer the outage every reconnect.
 *
 * A 4xx/5xx from the API is NOT a network-class failure: the API was reached,
 * so switching origin cannot help and would only hide a real server problem
 * behind an extra hop. Only "we could not get a response at all" counts.
 *
 * ── SELF-HEAL ─────────────────────────────────────────────────────────────
 * A persisted fallback is a SUSPICION, not a verdict. On the next boot the
 * player starts on DIRECT again and tries once; if that works the persisted
 * flag is dropped and the device is back on the short path. If it fails, the
 * threshold is 1 (not N) — a device with a known-bad direct path must not
 * burn three backoff cycles before every boot.
 *
 * ── THE WAY BACK, MID-SESSION (2026-11-15, cost audit) ────────────────────
 * Until this date the boot probe was the ONLY way back, and it is a single
 * request made while the box's own network may still be coming up. Measured
 * on 2026-11-08 to 11-14: 27% of all screen traffic was reaching the API
 * through the gateway, on a fleet where the gateway exists for a handful of
 * Android-9 units. Every one of those requests is billed by Vercel on four
 * meters (`docs/COST.md`), and 15.5 M of them in one cycle moved the team up
 * a pricing tier.
 *
 * The push WebSocket ALWAYS dials the direct origin (the gateway cannot
 * carry one). So an authenticated socket is independent proof - TLS, DNS,
 * routing and the device credential, all on the direct origin - that the
 * reason for being on the gateway is over. `onDirectOriginProven` turns that
 * proof into the same probe a boot performs: back to direct with the
 * persisted suspicion still set, so ONE failed direct request returns the
 * control plane to the gateway and one success clears the suspicion.
 *
 * Two brakes keep that from becoming a flap:
 *   • DWELL. No return until the session has been on the gateway for
 *     `MIN_GATEWAY_DWELL_MS`, so the outage that caused the switch has time
 *     to end.
 *   • FAILED-HEAL BUDGET. A return that is followed by a fallback before any
 *     direct request succeeded was wrong about this device (a path that
 *     carries the socket and not HTTP). After
 *     `MAX_FAILED_HEALS_PER_SESSION` of those the gateway is final for the
 *     session, exactly as it was before this change.
 *
 * WHAT THIS DOES NOT TOUCH: when the control plane LEAVES direct (the
 * thresholds above), what counts as a network-class failure, and the rule
 * that an HTTP outcome on the gateway never moves the mode - the test
 * "never flaps back to direct mid-session" still holds for every HTTP
 * outcome. While a return is being proven the push channel is, by
 * construction, authenticated: the alert path is never without both legs.
 *
 * Everything here is PURE (no React, no window, no fetch) so it is
 * exhaustively unit-testable without mounting the 11k-line player page —
 * same pattern as `trustGuards.ts`, `emergencyReconcile.ts` and `sync/`.
 */

export type ApiOriginMode = 'direct' | 'gateway';

/**
 * The control-plane root to use while `mode === 'gateway'`: THE ORIGIN THIS
 * DOCUMENT WAS SERVED FROM, normalized. Its one caller is `getApiRoot()` in
 * `player/page.tsx`, which passes `window.location.origin` — nothing else.
 *
 * ── WHY THIS IS NOT `normalizeApiRoot` (the 2026-09-08 regression) ─────────
 * It used to be. `normalizeApiRoot` is the guard for an OVERRIDE — a `?api=`
 * value or a localStorage leftover, i.e. an API host SOMEONE ELSE chose. It
 * therefore refuses `http:` except against loopback in development (R-01),
 * and it checks the host against an allowlist. Both rules are right for an
 * override and WRONG for the page origin:
 *
 *   • the allowlist can never reject it — `policy.pageOrigin` is one of
 *     `allowedApiHosts`'s own inputs, so the check is a no-op here; and
 *   • the scheme rule can only ever do damage. The document delivering this
 *     code already arrived over that scheme, from that host, and already owns
 *     localStorage (the device token) and everything the screen paints.
 *     Refusing to talk to it "for safety" protects nothing that is not
 *     already lost, and there is no securer origin to fall back TO.
 *
 * WHAT THE OLD SHAPE COST, MEASURED. `getApiRoot()` falls through to the
 * DIRECT root when this returns null. So a player served over plain `http:`
 * flipped `__eduApiOrigin.mode` to 'gateway', logged "switching the control
 * plane to the same-origin gateway", and then sent every subsequent request to
 * the origin it had just declared dead. Captured on the production bundle,
 * 2026-09-08: 14 consecutive post-switch control-plane calls, every one to the
 * direct host, none to the page origin. That is exactly the "never let one
 * signal stand in for another" failure the player rules ban — a mode that says
 * the plane moved while no traffic moved. It reaches every plaintext install:
 * the E2E suite (a real `next build` served at `http://localhost:3000`, which
 * is how it was caught) and any on-prem/LAN player on `http://<lan-ip>`.
 *
 * WHAT IS STILL ENFORCED, and why that is enough:
 *   • http(s) only — `file:`, `data:`, `blob:`, `javascript:`, `ws:` and an
 *     opaque document's literal "null" origin are all refused;
 *   • no embedded credentials (they would be replayed on every call);
 *   • path, query and fragment are dropped, and a trailing `/api/v1` is
 *     stripped, exactly as the override path normalizes.
 * The result is always the ORIGIN of the argument or null — it can never name
 * a different host, so no allowlist is being widened or bypassed.
 */
export function gatewayApiRoot(pageOrigin: string | null | undefined): string | null {
  if (typeof pageOrigin !== 'string') return null;
  const trimmed = pageOrigin.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Relative, garbage, or the literal "null" an opaque document reports.
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  if (url.username || url.password) return null;

  // `window.location.origin` carries no path, but normalize defensively so a
  // future caller cannot smuggle one in: same shape `normalizeApiRoot` emits.
  const path = url.pathname.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** localStorage key holding the "direct is broken on this device" suspicion. */
export const GATEWAY_FALLBACK_STORAGE_KEY = 'edu_api_gateway_fallback';

/** Consecutive network-class failures required to leave the direct origin. */
export const DIRECT_FAILURES_BEFORE_GATEWAY = 3;

/**
 * How long a session stays on the gateway before independent proof of the
 * direct origin may move it back. Long enough for an API restart or a slow
 * minute to be over; short next to the hours a screen used to spend here.
 */
export const MIN_GATEWAY_DWELL_MS = 5 * 60_000;

/**
 * Returns to direct that were followed by a fallback before ANY direct
 * request succeeded. At this many the gateway is final for the session.
 */
export const MAX_FAILED_HEALS_PER_SESSION = 2;

export interface ApiOriginState {
  mode: ApiOriginMode;
  /** Consecutive NETWORK-class failures while on the current mode. */
  networkFailures: number;
  /** A previous session already concluded direct was unreachable here. */
  persistedFallback: boolean;
  /**
   * When this session moved onto the gateway, on the CALLER's monotonic
   * clock. Absent on direct, and on a state built without a clock (the dwell
   * then starts at the first proof).
   */
  gatewaySinceMs?: number;
  /** Back on direct because of independent proof; no direct request has succeeded since. */
  healUnproven?: boolean;
  /** Returns that fell back before any direct success, this session. */
  failedHeals?: number;
}

/**
 * Messages that prove we REACHED the API (it answered with a status code).
 * Checked FIRST so an HTTP error never counts as a transport failure.
 */
const HTTP_STATUS_MESSAGE_RE = /\bHTTP\s+\d{3}\b/i;

/**
 * Transport-level failure signatures across the engines we ship to:
 * Chromium/Android WebView ("Failed to fetch", "net::ERR_*"), WebKit/Safari
 * ("Load failed", "The network connection was lost"), Firefox
 * ("NetworkError when attempting to fetch resource"), plus our own bounded
 * fetch's deadline aborts and TLS/DNS wording.
 */
const NETWORK_MESSAGE_RE =
  /(failed to fetch|networkerror|network error|network request failed|load failed|network connection was lost|connection (refused|reset|closed)|err_[a-z_]+|dns|getaddrinfo|enotfound|econnrefused|econnreset|etimedout|ssl|tls|certificate|handshake|timed out|timeout|aborted|the operation was aborted)/i;

/**
 * Is this rejection "we never got a response", as opposed to "the API said
 * no"? Conservative: anything we cannot positively classify is NOT network.
 */
export function isNetworkClassFailure(err: unknown): boolean {
  if (err == null) return false;
  const name = typeof (err as { name?: unknown }).name === 'string' ? (err as { name: string }).name : '';
  const message =
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : typeof err === 'string'
        ? err
        : '';

  // The API answered — an origin switch cannot help.
  if (HTTP_STATUS_MESSAGE_RE.test(message)) return false;

  // Our bounded-fetch deadline (fetchTimeout.ts) and any AbortSignal timeout.
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  // The universal browser signal for "the request never completed".
  if (name === 'TypeError' || err instanceof TypeError) return true;

  return NETWORK_MESSAGE_RE.test(message);
}

export function initialApiOriginState(persistedFallback: boolean): ApiOriginState {
  // NOTE: mode is ALWAYS 'direct' at boot, even with a persisted fallback —
  // that is the self-heal probe. The persisted flag only lowers the
  // threshold so a still-broken device switches on its first failure.
  return { mode: 'direct', networkFailures: 0, persistedFallback };
}

/** Failures needed to switch, given what previous sessions learned. */
export function failureThreshold(state: ApiOriginState): number {
  return state.persistedFallback ? 1 : DIRECT_FAILURES_BEFORE_GATEWAY;
}

/**
 * Record a control-plane failure. Returns the NEXT state (pure — the caller
 * owns persistence and decides what changed by comparing the two).
 */
export function onControlPlaneFailure(state: ApiOriginState, err: unknown, nowMs?: number): ApiOriginState {
  if (!isNetworkClassFailure(err)) {
    // An HTTP error breaks the "consecutive" run: the transport is fine.
    return state.networkFailures === 0 ? state : { ...state, networkFailures: 0 };
  }
  if (state.mode === 'gateway') {
    // Already on the long path. Keep counting for diagnostics, but there is
    // nowhere further to fall back to - and no HTTP outcome ever moves the
    // mode back (only `onDirectOriginProven` does).
    return { ...state, networkFailures: state.networkFailures + 1 };
  }
  const networkFailures = state.networkFailures + 1;
  if (networkFailures < failureThreshold(state)) {
    return { ...state, networkFailures };
  }
  // A return that never saw a direct success was wrong about this device.
  const failedHeals = (state.failedHeals ?? 0) + (state.healUnproven ? 1 : 0);
  return {
    mode: 'gateway',
    networkFailures: 0,
    persistedFallback: true,
    ...(typeof nowMs === 'number' ? { gatewaySinceMs: nowMs } : {}),
    ...(failedHeals > 0 ? { failedHeals } : {}),
  };
}

/** Record a control-plane success. Direct success clears the suspicion. */
export function onControlPlaneSuccess(state: ApiOriginState): ApiOriginState {
  if (state.mode === 'direct') {
    if (state.networkFailures === 0 && !state.persistedFallback && !state.healUnproven) return state;
    // SELF-HEAL: direct worked, so the device is no longer on the bad path.
    // The failed-heal count is the session's memory and survives; everything
    // else about a past fallback is over.
    return {
      mode: 'direct',
      networkFailures: 0,
      persistedFallback: false,
      ...(state.failedHeals ? { failedHeals: state.failedHeals } : {}),
    };
  }
  if (state.networkFailures === 0) return state;
  return { ...state, networkFailures: 0 };
}

/** A push session is proof of the direct origin only while it is demonstrably alive. */
export const DIRECT_PROOF_FRESH_MS = 30_000;

/**
 * Is the push WebSocket, right now, proof that the DIRECT origin is
 * reachable? It always dials direct, so: open, authenticated (AUTH_OK - a TCP
 * open proves nothing, player rule 5) and heard from within the last
 * `DIRECT_PROOF_FRESH_MS` (the heartbeat answers every 15 s).
 */
export function pushProvesDirect(push: { open: boolean; authOk: boolean; sinceLastMessageMs: number }): boolean {
  return (
    push.open === true &&
    push.authOk === true &&
    Number.isFinite(push.sinceLastMessageMs) &&
    push.sinceLastMessageMs >= 0 &&
    push.sinceLastMessageMs <= DIRECT_PROOF_FRESH_MS
  );
}

/**
 * Independent proof that the DIRECT origin is reachable arrived while the
 * control plane is on the gateway - today, the push WebSocket (which always
 * dials direct) holding an authenticated session.
 *
 * Returns the SAME state object when nothing changes, so the caller can tell
 * a transition by identity. The transition it makes is the boot probe, not a
 * verdict: `persistedFallback` stays set, so the threshold is 1 and the first
 * failed direct request goes straight back to the gateway.
 *
 * @param nowMs the caller's monotonic clock (`performance.now()`), the same
 *   one it passes to `onControlPlaneFailure`.
 */
export function onDirectOriginProven(state: ApiOriginState, nowMs: number): ApiOriginState {
  if (state.mode !== 'gateway') return state;
  if ((state.failedHeals ?? 0) >= MAX_FAILED_HEALS_PER_SESSION) return state;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return state;
  if (typeof state.gatewaySinceMs !== 'number') {
    // Entered the gateway without a clock: start the dwell now.
    return { ...state, gatewaySinceMs: nowMs };
  }
  if (nowMs - state.gatewaySinceMs < MIN_GATEWAY_DWELL_MS) return state;
  return {
    mode: 'direct',
    networkFailures: 0,
    persistedFallback: true,
    healUnproven: true,
    ...(state.failedHeals ? { failedHeals: state.failedHeals } : {}),
  };
}

// ── Persistence (thin, storage injected so it stays testable) ──────────────

type MiniStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readPersistedFallback(storage: MiniStorage | null | undefined): boolean {
  try {
    return storage?.getItem(GATEWAY_FALLBACK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePersistedFallback(storage: MiniStorage | null | undefined, on: boolean): void {
  try {
    if (on) storage?.setItem(GATEWAY_FALLBACK_STORAGE_KEY, '1');
    else storage?.removeItem(GATEWAY_FALLBACK_STORAGE_KEY);
  } catch {
    /* private mode / quota — the in-memory decision still applies this session */
  }
}
