/**
 * device-throttle-key.ts — PER-DEVICE throttling for the fleet's own routes.
 *
 * ── THE MEASURED DEFECT (P0-7 load test, 2026-09-04) ─────────────────────
 * The global throttler is `{ ttl: 60_000, limit: 600 }` keyed on the client IP
 * (`app.module.ts`), and @nestjs/throttler v6 keys PER HANDLER
 * (`generateKey` = sha256(`${Class}-${handler}-${name}-${tracker}`)), so the
 * binding constraint is "how many screens may share one public address on the
 * busiest single route". A venue is one NAT address. The busiest route is the
 * emergency-revision poll at 6/min/screen healthy and 12/min degraded.
 *
 * Measured, N screens moved behind ONE address, real player cadences:
 *
 *     50 screens →   400 req/min →   1/475 throttled (0.2 %)
 *     75 screens →   589 req/min →   0/699 throttled (0.0 %)   ← 11 under the cap
 *    100 screens →   906 req/min →  93/1075 throttled (8.7 %)  ← the cliff
 *
 * ~75 screens per building, and ~31 when the push channel is degraded — which
 * is the PERMANENT state of every screen behind a school firewall that blocks
 * WebSockets, and the state of the WHOLE FLEET during a Redis outage, i.e.
 * exactly when an alert most needs to get through. Worse, a throttled screen
 * does not go quiet: `emergencyRev.ts` converts three consecutive 429s into a
 * FULL manifest fetch, so the limiter pushes back on the cheap request and
 * rewards the expensive one.
 *
 * ── THE FIX, AND ITS LIMIT ───────────────────────────────────────────────
 * A shared NAT address is not an identity; a device credential is. Every route
 * in `DEVICE_THROTTLE_ROUTES` below is already device-authenticated (the
 * `verifyDeviceForScreen` inventory in `screens/device-route-inventory.spec.ts`
 * plus the `JwtAuthGuard` + `DeviceIdentityInterceptor` manifest path), so on
 * those routes — AND ONLY THOSE — the throttle key becomes the screen id out
 * of the presented device JWT.
 *
 * Everything else is untouched, deliberately. `/auth/login`, `/screens/pair`,
 * `/screens/register` (anonymous bootstrap), `/signup`, `/password-reset/*`
 * and the public renderer keep their per-IP caps EXACTLY as they were: those
 * caps are brute-force defences, and a brute-force attacker has no device
 * credential to be keyed on. This module can only ever move a key on a route
 * an operator explicitly listed here.
 *
 * ── WHY A CALLER CANNOT ESCAPE THE IP CAP ────────────────────────────────
 * The token is fully VERIFIED (HS256 against `DEVICE_JWT_SECRET`, `kind` must
 * be `device`, `sub` must be a plausible screen id) before its subject becomes
 * a key. A garbage, expired, unsigned or foreign-signed token produces NO key
 * and the request falls back to the per-IP tracker — so "present junk tokens
 * to rotate the throttle key" resolves to the pre-existing per-IP behaviour,
 * not to an escape hatch. The only caller who gets a per-device key is one who
 * already holds a real device credential for a real screen, and that caller is
 * then bounded by `DEVICE_ROUTE_LIMIT` per route per minute.
 *
 * This is NOT an authorization decision and must never be used as one: it does
 * not consult the revocation list, `Screen.status`, the credential epoch or the
 * `unproven` marker. A revoked screen may briefly be throttled per-device and
 * is then refused 401 by the route's real device auth (`device-auth.ts`), which
 * is unchanged. Keying a revoked credential per-device costs nothing: its
 * requests fail anyway, and it is still bounded.
 *
 * COST: one HMAC verify per request on the listed routes, memoised per token
 * string for 60 s, so a screen polling every 5 s pays it about once a minute.
 */

import * as jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import type { ExecutionContext } from '@nestjs/common';
import { requireSecret } from './required-secret';

/**
 * Per-device, per-route ceiling, per 60 s.
 *
 * Sizing, from the measured player cadences (P0-7 §2.3): the busiest route a
 * single screen drives is the revision poll at 6/min healthy, 12/min degraded,
 * with a documented cold-boot burst of 80-150 req/min ACROSS all routes during
 * the first minute after an APK install. 300 on ONE route is ~25× the degraded
 * steady state and ~2× the entire cold-boot burst, so no healthy screen can
 * reach it — while a looping or compromised kiosk is still bounded at 5 req/s
 * on any single route instead of sharing its whole site's 600.
 *
 * It is deliberately LOWER than the 600 an IP gets. A device is a much
 * narrower identity than a building, so the per-identity number should be
 * smaller; the point of the change is that a SITE is no longer capped by the
 * sum of its screens, not that any one screen gets more room.
 */
export const DEVICE_ROUTE_LIMIT = 300;

/** Key prefix, so a device key can never collide with an IP key. */
export const DEVICE_TRACKER_PREFIX = 'dev:';

/**
 * `Controller#handler` pairs whose throttle key may be the DEVICE.
 *
 * Every entry is a route the fleet's own player drives with a device
 * credential in the `Authorization` header. `security/device-throttle-key.spec.ts`
 * asserts (a) every handler named here exists in the source, and (b) the
 * anonymous/brute-force routes are absent — adding `login` here would be
 * caught by the spec, not by an incident.
 *
 * NOT listed, on purpose:
 *   • `ScreensController#register` — the anonymous bootstrap path. It mints a
 *     credential from a fingerprint; keying it on the credential a caller
 *     chooses to present would let an attacker with ONE stolen token create
 *     Screen rows past the 120/min/IP wall that exists to stop exactly that
 *     (screens.controller.ts throttle history v6). The renewing screen pays
 *     the site's IP budget for one request every ten minutes, which is 0.1
 *     req/min/screen — three orders of magnitude below the cap.
 *   • Everything behind an operator session. A dashboard user is a human at an
 *     IP; that is the right identity for them.
 */
export const DEVICE_THROTTLE_ROUTES: readonly string[] = [
  // The three routes that ARE the fleet's steady-state load (P0-7 §5.1:
  // 8 req/min/screen healthy, 19 degraded — all of it these three).
  'ScreensController#getEmergencyRev',
  'ScreensController#getManifest',
  'TelemetryController#report',
  // The rest of the device surface. Lower volume, same identity argument.
  'ScreensController#reportRenderProof',
  'ScreensController#reportCacheStatus',
  'ScreensController#getEmergencyAssets',
  'ScreensController#getMenu',
  'ScreensController#issueStreamTicket',
  'ScreensController#postGameState',
  'ScreensController#setOrientationFromDevice',
  'GpioController#gpioEvent',
  'DisplayController#reportCapabilities',
  'PlayerLogsController#ingestLog',
  // The two OTA checks stay ANONYMOUS routes by necessity (the shipped Kotlin
  // worker sends no Authorization header — OTA-01), so most callers keep the
  // per-IP key exactly as today. A caller that DOES present a device
  // credential — the web player and newer APKs — is keyed on it instead, which
  // is what stops a whole building's synchronized boot from sharing one
  // 120/min bucket on the route every kiosk hits at power-on.
  'PlayerOtaController#updateCheck',
  'PlayerOtaController#managerUpdateCheck',
];

const DEVICE_THROTTLE_ROUTE_SET = new Set(DEVICE_THROTTLE_ROUTES);

/**
 * Is this handler one of the fleet's device routes?
 *
 * Keyed on the CLASS + METHOD the router actually dispatched, not on a URL
 * pattern: a path regex drifts silently when a route is renamed or a new
 * controller claims an overlapping prefix, whereas a handler that stops
 * existing is caught by the spec.
 */
export function isDeviceThrottledRoute(context: ExecutionContext | undefined): boolean {
  if (!context) return false;
  try {
    const cls = context.getClass?.()?.name;
    const handler = context.getHandler?.()?.name;
    if (!cls || !handler) return false;
    return DEVICE_THROTTLE_ROUTE_SET.has(`${cls}#${handler}`);
  } catch {
    return false;
  }
}

// ── Verified-subject memo ────────────────────────────────────────────────
//
// A screen presents the SAME 180-day token on every request. Verifying it
// afresh 8-19 times a minute per screen is pure waste, so the positive result
// is memoised by a hash of the token (never the token itself — this map is
// long-lived process state and a raw bearer credential does not belong in it).
//
// Positives only. A failed verify is already cheap (jsonwebtoken rejects a
// malformed token before any HMAC work), and caching negatives would let a
// flood of unique junk tokens grow the map — the thing the cap below exists
// to prevent.

interface MemoEntry {
  sub: string;
  /** Wall-clock ms after which this entry is re-verified. */
  until: number;
}

const subjectMemo = new Map<string, MemoEntry>();
const MEMO_TTL_MS = 60_000;
const MEMO_MAX_ENTRIES = 20_000;

/** Test hook — drop the memo between cases. */
export function __resetDeviceThrottleMemo(): void {
  subjectMemo.clear();
}

/** A screen id is a cuid-ish opaque token; bound it so it can never be a key bomb. */
function plausibleScreenId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function bearerToken(req: Record<string, any> | undefined): string | null {
  const auth = req?.headers?.authorization;
  if (typeof auth !== 'string') return null;
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  // A JWT is three dot-separated segments. Cheap shape check so a session
  // cookie or an opaque API key never reaches jwt.verify.
  if (!token || token.length > 4096 || token.split('.').length !== 3) return null;
  return token;
}

/**
 * The verified screen id behind this request's device credential, or `null`.
 *
 * Verification is the whole point — see the header. Never returns a subject
 * from an unverified payload.
 */
export function verifiedDeviceSubject(req: Record<string, any> | undefined): string | null {
  const token = bearerToken(req);
  if (!token) return null;

  const now = Date.now();
  const fingerprint = createHash('sha256').update(token).digest('base64url');
  const hit = subjectMemo.get(fingerprint);
  if (hit && hit.until > now) return hit.sub;

  let sub: string | null = null;
  try {
    const secret = requireSecret('DEVICE_JWT_SECRET', {
      devFallback: 'dev_only_device_jwt_secret_CHANGE_ME',
    });
    // Same explicit allowlist device-auth.ts uses (DT-12): jsonwebtoken's
    // default is a library default, not our guarantee.
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
    if (decoded?.kind === 'device' && plausibleScreenId(decoded?.sub)) sub = decoded.sub;
  } catch {
    // Expired, forged, wrong kind, wrong secret — all the same answer: this
    // request has no device identity, so it keeps the per-IP key.
    return null;
  }
  if (!sub) return null;

  // Bounded, and cleared wholesale rather than evicted one-by-one: entries are
  // interchangeable and the map is a pure optimisation, so the cheapest bound
  // is the right one (same shape as device-auth's credential cache).
  if (subjectMemo.size >= MEMO_MAX_ENTRIES) subjectMemo.clear();
  subjectMemo.set(fingerprint, { sub, until: now + MEMO_TTL_MS });
  return sub;
}

/**
 * The throttle tracker for a request, or `null` to keep the per-IP tracker.
 *
 * Returns a key ONLY when BOTH hold: the handler is an explicitly listed
 * device route, and the request carries a cryptographically valid device
 * credential. Either one missing ⇒ `null` ⇒ the caller falls back to the
 * per-IP rule, which is the pre-2026-09-05 behaviour byte for byte.
 */
export function deviceThrottleTracker(
  req: Record<string, any> | undefined,
  context: ExecutionContext | undefined,
): string | null {
  if (!isDeviceThrottledRoute(context)) return null;
  const sub = verifiedDeviceSubject(req);
  return sub ? `${DEVICE_TRACKER_PREFIX}${sub}` : null;
}
