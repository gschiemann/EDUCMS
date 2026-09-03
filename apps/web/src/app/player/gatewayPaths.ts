/**
 * P0-1 (2026-09-02) — WHICH PATHS THE SAME-ORIGIN GATEWAY CARRIES.
 *
 * Next middleware rewrites these (and ONLY these) from the web origin to the
 * API origin, so a device whose network cannot reach Railway directly can
 * still run its entire control plane through the origin it demonstrably CAN
 * reach (it just loaded the player from it).
 *
 * SCOPE DISCIPLINE — this is an unauthenticated open proxy in front of the
 * API, so the allowlist is exactly the player control plane and nothing else:
 *   • no dashboard/admin routes (auth, users, tenants, billing, AI, uploads),
 *   • no media/asset bytes (those are Supabase/CDN URLs, already same-origin
 *     independent, and proxying them would put fleet video egress on Vercel),
 *   • no `/proxy/web` (an operator-supplied URL fetcher — proxying a proxy).
 * Everything here is a route the kiosk already calls with a DEVICE credential
 * (or a deliberately public one: register, pairing status, OTA metadata,
 * health), so the gateway grants no reachability the device did not have.
 *
 * WebSocket is deliberately absent: Vercel cannot proxy WS. The player keeps
 * its WS on the direct origin; the SSE + HTTP-polling fallbacks (which DO
 * ride this list) are what keep realtime alive on a gateway device.
 *
 * PURE + unit-tested: the middleware is edge-runtime code that is awkward to
 * test directly, so the decision lives here.
 */

/** Everything the gateway serves lives under this prefix. */
export const GATEWAY_PATH_PREFIX = '/api/v1';

/** Header carrying the real client IP from the gateway to the API. */
export const GATEWAY_CLIENT_IP_HEADER = 'x-venueos-gw-client-ip';
/** Header proving the forwarded IP came from OUR gateway, not a client. */
export const GATEWAY_SECRET_HEADER = 'x-venueos-gw-secret';

/**
 * Path patterns, relative to `/api/v1`. Anchored end-to-end — a prefix match
 * would turn `/screens/register` into `/screens/register/../../admin/users`.
 */
const CONTROL_PLANE_RULES: readonly RegExp[] = [
  // ── Identity / pairing lifecycle ────────────────────────────────────────
  /^\/screens\/register$/,
  /^\/screens\/status\/[^/]+$/,
  /^\/screens\/status\/[^/]+\/(ota-state|crash-report)$/,
  /^\/screens\/unpair\/[^/]+$/,
  // ── Per-screen device plane (manifest is the sole arbiter of lockdown) ──
  // `emergency-rev` (2026-09-02) is the cheap change detector the emergency
  // backstop polls INSTEAD of re-fetching the manifest. It must ride the
  // gateway alongside `manifest` or a gateway-only device silently falls back
  // to full manifest fetches forever — correct, but it is precisely the fleet
  // whose network we least want to spend.
  // `telemetry` (2026-09-02, agent B) replaces the status/cache-status/render-
  // proof timers with one POST per minute — same reason it must ride here.
  /^\/screens\/[^/]+\/(manifest|emergency-rev|telemetry|cache-status|render-proof|emergency-assets|display-capabilities|stream-ticket)$/,
  /^\/screens\/[^/]+\/orientation\/device$/,
  // ── Emergency reconcile (the stranded-alert backstop) ───────────────────
  /^\/emergency\/(messages|status)$/,
  // ── Realtime fallbacks + the sync clock (WS stays direct; see header) ───
  /^\/realtime\/(sse|poll|time)$/,
  // ── OTA metadata + player diagnostics ───────────────────────────────────
  /^\/player\/(update-check|manager-update-check|latest-version-public)$/,
  /^\/player-logs(\/.*)?$/,
  /^\/notifications\/help$/,
  // ── Liveness (the installer's "can this box reach the CMS at all") ──────
  /^\/health(\/[\w-]+)*$/,
  // ── Playback telemetry the player already posts ─────────────────────────
  /^\/analytics\/touch-events$/,
  /^\/templates\/[^/]+\/playback$/,
];

/**
 * Request headers the middleware STRIPS from every `/api/v1` request that
 * enters it — allowlisted or not (GW-01, 2026-09-02).
 *
 *   • the two gateway headers, so a client can never speak them into
 *     existence (the API's constant-time secret compare is the real control;
 *     this is defence in depth), and
 *   • `cookie`, so routing an API call through the WEB origin can never
 *     attach the dashboard's session to it. Every allowlisted route is device-
 *     or public-authenticated and reads no cookie.
 *
 * This list used to be applied BELOW the allowlist early-return in
 * `proxy.ts`, so it covered only the paths the gateway carries while the
 * comment claimed a defence every other `/api/v1` path bypassed.
 */
export const GATEWAY_STRIPPED_REQUEST_HEADERS: readonly string[] = [
  GATEWAY_CLIENT_IP_HEADER,
  GATEWAY_SECRET_HEADER,
  'cookie',
];

/**
 * Remove every header in `GATEWAY_STRIPPED_REQUEST_HEADERS`, in place.
 *
 * Typed against the one method it needs rather than the DOM `Headers` class,
 * so the rule is unit-testable without an edge/fetch runtime — the same reason
 * the path allowlist lives in this module instead of the middleware.
 */
export function stripGatewayRequestHeaders(headers: { delete(name: string): void }): void {
  for (const name of GATEWAY_STRIPPED_REQUEST_HEADERS) headers.delete(name);
}

/**
 * @param pathname a request pathname (no query, no fragment).
 * @returns true when the same-origin gateway may rewrite it to the API.
 */
export function isGatewayControlPlanePath(pathname: unknown): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith(`${GATEWAY_PATH_PREFIX}/`)) return false;
  // Reject any traversal or encoded separator before matching — the anchored
  // patterns below assume a normalized path.
  if (pathname.includes('..') || /%2f/i.test(pathname) || pathname.includes('//')) return false;
  const rest = pathname.slice(GATEWAY_PATH_PREFIX.length);
  return CONTROL_PLANE_RULES.some((re) => re.test(rest));
}

/**
 * The real client IP as seen by the gateway edge.
 *
 * On Vercel, `x-real-ip` (and `x-vercel-forwarded-for`) are set BY the
 * platform from the TCP peer and are not client-forgeable; the LEFTMOST
 * `x-forwarded-for` entry is only used as a last resort, which is why the
 * API-side trust of this value is gated on a shared secret rather than on
 * this function being right.
 *
 * @param get a case-insensitive header getter (`req.headers.get`).
 */
export function gatewayClientIp(get: (name: string) => string | null | undefined): string | null {
  const direct = (get('x-real-ip') || '').trim();
  if (direct) return direct;
  const vercel = (get('x-vercel-forwarded-for') || '').split(',')[0]?.trim();
  if (vercel) return vercel;
  const xff = (get('x-forwarded-for') || '').split(',')[0]?.trim();
  return xff || null;
}
