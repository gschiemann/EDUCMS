import { NextResponse, type NextRequest } from 'next/server';
import {
  GATEWAY_CLIENT_IP_HEADER,
  GATEWAY_SECRET_HEADER,
  gatewayClientIp,
  isGatewayControlPlanePath,
} from '@/app/player/gatewayPaths';

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

/** Only `/api/v1/*` ever enters this middleware — keep the edge cost at 0 for everything else. */
export const config = {
  matcher: '/api/v1/:path*',
};

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

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search, origin } = req.nextUrl;
  if (!isGatewayControlPlanePath(pathname)) return NextResponse.next();

  const target = apiOrigin();
  // No API origin configured, or the API IS this origin (single-origin
  // deploys / local dev): nothing to rewrite, and rewriting would self-loop.
  if (!target || target === origin) return NextResponse.next();

  const headers = new Headers(req.headers);
  // A client must never be able to speak these into existence.
  headers.delete(GATEWAY_CLIENT_IP_HEADER);
  headers.delete(GATEWAY_SECRET_HEADER);
  // ⚠️ NO AMBIENT AUTHORITY THROUGH THE GATEWAY. Today these calls are
  // CROSS-origin, so the browser attaches no cookies. Routing them through
  // this origin would suddenly attach the WEB origin's cookies (a dashboard
  // session, if the same browser has one) to an API request. Dropping the
  // header keeps the gateway byte-identical to the direct path: device
  // `Authorization: Bearer` only. The whole allowlist is device- or
  // public-authenticated; none of it reads a cookie.
  headers.delete('cookie');

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
