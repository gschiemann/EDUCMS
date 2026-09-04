// Next 16 file convention: `proxy.ts` exporting `proxy` (the former
// `middleware.ts` is deprecated — build warns and a future major drops it).
import { NextResponse, type NextRequest } from 'next/server';
import {
  GATEWAY_CLIENT_IP_HEADER,
  GATEWAY_SECRET_HEADER,
  gatewayClientIp,
  isGatewayControlPlanePath,
  stripGatewayRequestHeaders,
} from '@/app/player/gatewayPaths';
import {
  LEGACY_POLYFILL_RESPONSE_HEADER,
  injectLegacyCss,
  injectLegacyPolyfills,
  needsLegacyCss,
  needsLegacyPolyfills,
} from '@/app/player/legacyPolyfills';
import { CSP_NONCE_HEADER, mintCspNonce } from '@/lib/csp-nonce';
import { scriptSrcCsp } from '@/lib/csp-script-policy';

/**
 * P0-1 (2026-09-02) — SAME-ORIGIN CONTROL-PLANE GATEWAY.
 *
 * The player shell loads from THIS origin; its control plane lives on the API
 * origin (`NEXT_PUBLIC_API_URL`). Some OEM Android WebViews reach the first
 * and not the second, and sit on "Connecting to your CMS…" forever. This
 * middleware makes `https://<web-origin>/api/v1/<control-plane path>` reach
 * the API, so the player can fall back to an origin it has already PROVEN it
 * can reach (see `apiOrigin.ts` for when it does).
 *
 * SCOPE: `gatewayPaths.ts` owns the allowlist (unit-tested). Anything else
 * under `/api/v1` falls through to Next's own routing (i.e. 404) — this is
 * deliberately NOT a general-purpose proxy of the API.
 *
 * GW-01 (2026-09-02) — THAT SENTENCE IS NOW TRUE. `apps/web/vercel.json` used
 * to blanket-rewrite `/api/v1/:path*` → Railway (commit f23fde88), and Vercel
 * applies its rewrites AFTER middleware returns `NextResponse.next()`. So the
 * WHOLE API — every route this allowlist was written to exclude, `/auth/login`
 * and `/devices/pair` and `/proxy/web` included — was reachable at
 * `https://<web-origin>/api/v1/...`, with the ATTACKER choosing the path.
 * Two consequences on that non-allowlisted path: those requests arrived with
 * Vercel's egress in `X-Forwarded-For` and NO gateway secret, so every per-IP
 * brute-force cap collapsed onto one attacker-selectable key; and an
 * authenticated actor could launder `AuditLog.ipAddress` — including the
 * record of who fired a district-wide lockdown — into a Vercel address.
 * The blanket rewrite is deleted; the three relative `/api/v1` callers it was
 * carrying (the fitness stick launcher, the fitness ad banner's fallback, the
 * CTS ribbon's last-resort root) now address the API origin directly.
 *
 * ── THE CLIENT-IP TRAP THIS MUST NOT SPRING ───────────────────────────────
 * With this hop in place the API sees Vercel's egress address, not the
 * device. `apps/api/src/security/client-ip.ts` picks the throttle key AND the
 * forensic `ipAddress` (AuditLog / RequestLog / Screen — including who fired
 * a district-wide lockdown) by counting from the right of `X-Forwarded-For`.
 * Left alone, EVERY gateway device would collapse onto one throttle key,
 * defeating every per-IP brute-force cap, and every audit row would name a
 * Vercel IP.
 *
 * So we forward the real client IP explicitly, alongside a shared secret the
 * API verifies with `timingSafeEqual`. The API trusts the forwarded IP ONLY
 * on a secret match; with a wrong or missing secret it falls back to its
 * normal right-counted rule and NEVER to a client-supplied value. Both
 * headers are STRIPPED from the inbound request first, so a client cannot
 * pre-set them (the secret would still have to match, but defence in depth).
 *
 * WebSocket is not proxied (Vercel cannot); the player keeps WS direct and
 * relies on the SSE/HTTP-poll fallbacks, which do ride this gateway.
 */

/**
 * `/api/v1/*` (the gateway), the player document, and — since SEC-010 — every
 * DASHBOARD DOCUMENT, which needs a per-request CSP nonce.
 *
 * `/player` costs one UA regex for every modern browser and does real work
 * only for a WebView older than Chrome 71 (see `legacyPlayerDocument`).
 *
 * The third pattern is a negative lookahead rather than a list of dashboard
 * routes, because "every HTML document this app renders" is the actual rule
 * and an allowlist would silently miss each new route. What it excludes, and
 * why each exclusion is load-bearing:
 *   api/                  route handlers return JSON; also keeps this pattern
 *                         from double-matching the gateway entry above.
 *   _next/                build assets — a script policy on a JS chunk is a
 *                         no-op, and the nonce would defeat their caching.
 *   player, player/       its own branch above, its own (report-only) policy,
 *                         and the Chromium-83 Taurus floor. Never nonce it.
 *   templates/, holiday-templates/, celebrations/, demo/
 *                         the ~320 static board documents under `public/`.
 *                         They are served straight off the CDN with no Next
 *                         render, so there is no inline script to nonce and a
 *                         nonce policy would block every script they carry.
 *   anything with a file extension
 *                         icons, manifests, `sw.js`, `favicon.ico`, images.
 *                         Cheap to skip and none of them execute our scripts.
 *
 * This matcher and the exclusion list in `next.config.ts`'s report-only entry
 * describe the SAME route set on purpose: the enforced `script-src` covers
 * exactly the surface the report-only policy has been observing.
 */
export const config = {
  matcher: [
    '/api/v1/:path*',
    '/player',
    '/((?!api/|_next/|player$|player/|templates/|holiday-templates/|celebrations/|demo/|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};

/**
 * Marks the proxy's own fetch of `/player` so the inner request is served
 * untouched instead of recursing. A client that sets it merely opts out of
 * the polyfill for its own document — nothing to gain.
 */
const LEGACY_INNER_HEADER = 'x-venueos-legacy-inner';

/**
 * P0 (2026-09-02) — CHROME-66 WEBVIEWS NEVER RAN A LINE OF THE PLAYER.
 *
 * Proven in real Chromium 68: every chunk throws `globalThis is not defined`
 * (Chrome 71 API) and the Android-9 Goodview LCDs sit on the static
 * "Connecting to your CMS…" forever. Next emits its async chunk tags at the
 * top of `<head>`, ahead of anything a layout can render, so the ONLY place
 * a polyfill is guaranteed to run first is as the first child of `<head>` —
 * which only the response body can provide. For a legacy UA this re-fetches
 * the same document from this origin and returns it with the polyfill
 * injected (`legacyPolyfills.ts`). Every other UA never enters this path.
 * Any failure falls through to the untouched document — never a worse
 * outcome than before.
 */
async function legacyPlayerDocument(req: NextRequest): Promise<NextResponse> {
  const ua = req.headers.get('user-agent');
  const wantsPolyfills = needsLegacyPolyfills(ua);
  const wantsCss = needsLegacyCss(ua);
  if (!wantsPolyfills && !wantsCss) return NextResponse.next();
  if (req.headers.get(LEGACY_INNER_HEADER)) return NextResponse.next();
  try {
    const headers = new Headers(req.headers);
    headers.set(LEGACY_INNER_HEADER, '1');
    const upstream = await fetch(req.nextUrl.toString(), { headers, redirect: 'manual' });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.includes('text/html')) return NextResponse.next();
    const html = await upstream.text();
    const out = new Headers(upstream.headers);
    // The body is re-encoded by this response; the upstream framing is stale.
    out.delete('content-length');
    out.delete('content-encoding');
    out.delete('transfer-encoding');
    out.set(LEGACY_POLYFILL_RESPONSE_HEADER, '1');
    let body = html;
    if (wantsPolyfills) body = injectLegacyPolyfills(body);
    if (wantsCss) body = injectLegacyCss(body);
    return new NextResponse(body, { status: upstream.status, headers: out });
  } catch {
    return NextResponse.next();
  }
}

/** The API origin, derived from the build env — never hardcoded. */
function apiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Strip everything a client must never be able to speak into existence, and
 * everything that must not ride an API call made through this origin.
 *
 * GW-01: this used to live BELOW the allowlist early-return, so it only ever
 * covered the paths the gateway carries — while the comment claimed a defence
 * that every other `/api/v1` path bypassed. It now runs for EVERY `/api/v1`
 * request that enters this middleware, before any branch. The API's
 * constant-time `gatewaySecretMatches` remains the real control (a forged
 * header pair was never exploitable without the secret); this is defence in
 * depth, and it is what makes the sentence above true rather than aspirational.
 */
function scrubbedRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers(req.headers);
  // WHICH headers is the rule; it lives in `gatewayPaths.ts` beside the path
  // allowlist so it is unit-testable without an edge runtime.
  stripGatewayRequestHeaders(headers);
  return headers;
}

/**
 * SEC-010 (2026-09-04) — per-request CSP nonce for dashboard documents.
 *
 * The nonce goes on the REQUEST as a `Content-Security-Policy` header: that is
 * Next's supported mechanism, and it is what makes Next stamp `nonce` on its
 * own inline bootstrap and flight scripts (`self.__next_f.push(…)`). Without
 * it an enforcing `script-src` would kill hydration on the first paint. The
 * same policy then goes on the RESPONSE, where the browser enforces it.
 *
 * `scriptSrcCsp()` returns `null` when `CSP_SCRIPT_SRC_ENFORCE` is set to
 * `off`; that path adds NO header at all, so the deploy is byte-identical to
 * the pre-SEC-010 behaviour rather than some half-applied middle state.
 *
 * COST, stated plainly: this makes every dashboard document render dynamically
 * (a per-request nonce cannot be cached) and adds one middleware invocation
 * per document request. That is the price of the directive; there is no
 * nonce-based CSP without it. It does NOT touch `/_next/` chunks, static board
 * HTML, or any asset — see the matcher.
 */
function dashboardDocument(req: NextRequest): NextResponse {
  const nonce = mintCspNonce();
  const csp = scriptSrcCsp({ nonce });
  if (!csp) return NextResponse.next();

  const headers = new Headers(req.headers);
  headers.set(CSP_NONCE_HEADER, nonce);
  headers.set('Content-Security-Policy', csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, search, origin } = req.nextUrl;
  if (pathname === '/player') return legacyPlayerDocument(req);

  // Everything that is not the gateway's `/api/v1` surface is a dashboard
  // document (the matcher already excluded assets, the player and the static
  // board HTML), so it takes the nonce path and nothing else.
  if (!pathname.startsWith('/api/v1')) return dashboardDocument(req);

  // Scrub FIRST — before the allowlist decision, so a non-allowlisted
  // `/api/v1` request cannot carry the gateway headers (or a web-origin
  // cookie) anywhere, no matter what handles it downstream.
  const headers = scrubbedRequestHeaders(req);
  if (!isGatewayControlPlanePath(pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  const target = apiOrigin();
  // No API origin configured, or the API IS this origin (single-origin
  // deploys / local dev): nothing to rewrite, and rewriting would self-loop.
  if (!target || target === origin) return NextResponse.next({ request: { headers } });

  const secret = process.env.GATEWAY_SHARED_SECRET;
  const ip = gatewayClientIp((n) => req.headers.get(n));
  if (secret && ip) {
    headers.set(GATEWAY_CLIENT_IP_HEADER, ip);
    headers.set(GATEWAY_SECRET_HEADER, secret);
  }
  // The API is a different host; a stale `host` header confuses its routing
  // and any absolute URL it builds.
  headers.set('host', new URL(target).host);

  return NextResponse.rewrite(new URL(`${pathname}${search}`, target), {
    request: { headers },
  });
}
