/**
 * status-poll-throttle.ts — the PER-FINGERPRINT admission floor for
 * `GET /api/v1/screens/status/:deviceFingerprint`.
 *
 * ── WHY A THIRD SCHEME DOES NOT EXIST HERE ──────────────────────────────
 * There are already two, and this file composes with both rather than
 * replacing either:
 *
 *   • The global per-IP throttler (`ClientIpThrottlerGuard`, 600/min/handler
 *     keyed on the real client address). Untouched. It is the flood wall for
 *     anonymous callers and it stays exactly as it was — tightening it is a
 *     fleet risk, because a venue is ONE NAT address and a synchronised
 *     building boot puts every screen's pairing poll behind it.
 *   • The per-DEVICE key (`security/device-throttle-key.ts`, P0-7). This route
 *     is listed there, so a caller that presents a cryptographically valid
 *     device credential is keyed on the SCREEN instead of on the building.
 *
 * Neither of those bounds the thing this route is uniquely exposed to: an
 * unbounded number of requests aimed at ONE screen's row. The fingerprint is
 * in the path, it is not a secret (the dashboard renders one with a copy
 * button, `GET /screens` carries it, it shows up in support tickets and OTA
 * logs), and every request costs a `Screen.findUnique`. So the floor below is
 * keyed on exactly that: the fingerprint the caller named.
 *
 * ── THE CAP, AND WHY IT IS NOT TIGHTER ──────────────────────────────────
 * The steady-state cadence of a PAIRED screen really is 30-45 s (two web
 * timers) plus the native `HeartbeatService` at 60 s / 5 min, i.e. ~5 req/min,
 * and a tight cap would be fine for it.
 *
 * The binding constraint is the UNPAIRED screen: `createPairingLoop` in the
 * web player polls this exact route every **3 seconds** while the pairing
 * splash is up (`apps/web/src/app/player/page.tsx`), which is 20 req/min on
 * its own, and the legacy status tick and the WS-effect copy run alongside it.
 * A cap sized for the paired cadence would 429 the pairing flow — the one
 * thing on this route that has no alternative path. 60/min is ~2.5x the
 * measured unpaired worst case and ~12x the paired one.
 *
 * ── THE BYPASS, AND ITS LIMIT ───────────────────────────────────────────
 * A fingerprint-keyed counter is, by construction, something a stranger can
 * consume on a screen's behalf: knowing the fingerprint is enough to spend the
 * budget and 429 the real screen. So a caller holding a cryptographically
 * valid device credential skips the floor entirely and is bounded by the
 * per-device key instead (`DEVICE_ROUTE_LIMIT`, 300/min/screen). That check is
 * an HMAC verify memoised for 60 s per token — no database, no Redis.
 *
 * It is NOT an authorization decision and must never be used as one. It does
 * not consult the revocation list, `Screen.status`, the credential epoch or the
 * `unproven` marker, and it does not check that the token names the screen in
 * the path. A caller who presents a valid token for a DIFFERENT screen can
 * therefore skip this floor — and is then bounded at 300/min on the credential
 * they presented, which is an identity an operator can revoke. The real
 * admission decision for this route is `verifyDeviceForScreen`, in the handler,
 * and it is unchanged by anything here.
 */

import { verifiedDeviceSubject } from '../security/device-throttle-key';

/** Rolling window length. */
export const STATUS_POLL_WINDOW_MS = 60_000;

/**
 * Requests per window per fingerprint, for a caller with no verified device
 * credential. See the header for the sizing — the 3 s unpaired pairing poll is
 * what sets it, not the 30-45 s paired heartbeat.
 */
export const STATUS_POLL_MAX_PER_WINDOW = 60;

/**
 * Bound on distinct fingerprints tracked at once. Cleared wholesale rather
 * than evicted one-by-one: entries are interchangeable and a cleared map only
 * ever grants a fresh window, never a longer one (same shape as the memo in
 * `device-throttle-key.ts`).
 */
const MAX_TRACKED_FINGERPRINTS = 50_000;

interface PollWindow {
  count: number;
  /** Wall-clock ms at which this window expires. */
  resetAt: number;
}

const windows = new Map<string, PollWindow>();

/** Test hook — drop every window between cases. */
export function __resetStatusPollThrottle(): void {
  windows.clear();
}

/** Test hook — how many polls this fingerprint has spent in the live window. */
export function __statusPollCount(fingerprint: string): number {
  const w = windows.get(fingerprint);
  if (!w || w.resetAt <= Date.now()) return 0;
  return w.count;
}

/**
 * May this poll proceed? `false` ⇒ the caller gets 429 and the handler does
 * ZERO database work.
 *
 * @param fingerprint the path parameter, i.e. the row this request targets.
 * @param req         the express request, for the device-credential bypass.
 */
export function acceptStatusPoll(fingerprint: string, req?: unknown): boolean {
  // A real credential buys the per-device bucket instead of this one. See the
  // header: this is a throttling key, never an authorization decision.
  if (verifiedDeviceSubject(req as Record<string, any> | undefined)) return true;

  const now = Date.now();
  const existing = windows.get(fingerprint);
  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_FINGERPRINTS) windows.clear();
    windows.set(fingerprint, { count: 1, resetAt: now + STATUS_POLL_WINDOW_MS });
    return true;
  }
  if (existing.count >= STATUS_POLL_MAX_PER_WINDOW) return false;
  existing.count += 1;
  return true;
}
