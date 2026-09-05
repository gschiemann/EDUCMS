/**
 * SEC-010 (2026-09-05) — shared contract for the dashboard's session
 * backend-for-frontend (`apps/web/src/app/api/session/*`).
 *
 * ── WHY A BFF AT ALL ─────────────────────────────────────────────────────
 * The audit finding: "the remembered bearer remains JS-readable for up to 30
 * days." Fixing it means the DURABLE credential must live somewhere page
 * JavaScript cannot reach — an `HttpOnly` cookie.
 *
 * And that cookie CANNOT be set by the API. The web app is `venue-os.app`;
 * the API is a Railway host. A cookie the API sets is cross-site, needs
 * `SameSite=None`, and Safari's ITP blocks cross-site cookies outright. This
 * repo already pays for that: `csrf.middleware.ts` grew a Bearer bypass
 * precisely BECAUSE "the `csrf-token` cookie is third-party and gets dropped
 * by Safari ITP / Chrome third-party-cookie phaseout." A refresh cookie set
 * the same way would be dropped the same way — a design that only works in
 * Chrome, which CLAUDE.md forbids.
 *
 * So the cookie is FIRST-PARTY, set by the web origin's own Node route
 * handlers, which hold the secret and talk to the API server-to-server.
 *
 * ── CSRF ─────────────────────────────────────────────────────────────────
 * A cookie-authenticated POST is CSRF-relevant by definition, so these
 * routes carry three independent defences and this module is where two of
 * them live (the third is `SameSite=Lax` on the cookie, which already
 * withholds it from every cross-site POST):
 *
 *   1. a custom request header. An HTML form — the only cross-site POST that
 *      needs no CORS preflight — cannot set one. A `fetch` that sets one
 *      triggers a preflight these routes never answer.
 *   2. an `Origin` check against the request's own `Host`.
 *
 * Both are pure functions here so they can be unit-tested without a Next
 * runtime; `session-bff.test.ts` proves the "cookie but no header" case is
 * refused, which is the acceptance test for this finding.
 */

/** First-party, HttpOnly, narrow-path. Never read by page JavaScript. */
export const SESSION_COOKIE_NAME = 'venueos_rt';

/** Scope the cookie to the BFF routes only — it never rides a page load, so
 *  it never lands in an access log for a document request. */
export const SESSION_COOKIE_PATH = '/api/session';

/** The custom header a cross-site HTML form provably cannot set. */
export const SESSION_REQUEST_HEADER = 'x-venueos-session';
export const SESSION_REQUEST_HEADER_VALUE = '1';

/** Header the API uses to prove the caller is this server, not a browser. */
export const SESSION_BFF_SECRET_HEADER = 'x-venueos-session-bff';

/** 30 days — the same ceiling `rememberMe` has always had. */
export const SESSION_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export type OriginVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing-header' | 'cross-origin' };

/**
 * The CSRF gate for every BFF route.
 *
 * `headers` is anything with a case-insensitive `get(name)` — a `Headers`, a
 * `NextRequest.headers`, or a plain lookup in a test.
 */
export function verifySameOriginRequest(headers: {
  get(name: string): string | null;
}): OriginVerdict {
  if (headers.get(SESSION_REQUEST_HEADER) !== SESSION_REQUEST_HEADER_VALUE) {
    return { ok: false, reason: 'missing-header' };
  }

  const origin = headers.get('origin');
  if (origin) {
    const host = headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      return { ok: false, reason: 'cross-origin' };
    }
    // `Host` is what the browser addressed; on Vercel it is the public host.
    // An `Origin` that does not name it is, by definition, someone else.
    if (!host || originHost !== host) return { ok: false, reason: 'cross-origin' };
    return { ok: true };
  }

  // No `Origin`. Every browser sends one on a cross-site POST, so its absence
  // is not itself an attack signal — but if the browser told us the fetch
  // metadata, honour it.
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return { ok: false, reason: 'cross-origin' };
  }
  return { ok: true };
}

/** Server-side API base. `API_URL` lets a deploy point the BFF at an internal
 *  address; otherwise the same public base the browser uses. */
export function serverApiBase(): string {
  const raw =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8080/api/v1';
  return raw.replace(/\/$/, '');
}

/** Headers for the server-to-server hop. The shared secret is optional on
 *  purpose (see `session.controller.ts`): unset is a no-op, never a lockout. */
export function bffForwardHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.SESSION_BFF_SECRET;
  if (typeof secret === 'string' && secret.length >= 16) {
    headers[SESSION_BFF_SECRET_HEADER] = secret;
  }
  return headers;
}

/** Seconds of cookie life for an ISO expiry the API returned, clamped to the
 *  30-day ceiling and floored at 0 (an already-dead cookie is never set). */
export function cookieMaxAgeFor(expiresAtIso: string | null | undefined): number {
  if (!expiresAtIso) return SESSION_COOKIE_MAX_AGE_SEC;
  const ms = Date.parse(expiresAtIso);
  if (!Number.isFinite(ms)) return SESSION_COOKIE_MAX_AGE_SEC;
  const secs = Math.floor((ms - Date.now()) / 1000);
  if (secs <= 0) return 0;
  return Math.min(secs, SESSION_COOKIE_MAX_AGE_SEC);
}
