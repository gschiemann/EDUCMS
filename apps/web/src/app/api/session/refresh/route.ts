import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  bffForwardHeaders,
  clearSessionCookies,
  cookieMaxAgeFor,
  logSessionOutcome,
  serverApiBase,
  setSessionCookies,
  verifySameOriginRequest,
} from '@/lib/session-bff';

/**
 * SEC-010 — POST /api/session/refresh
 *
 * The only way a remembered session comes back to life. Called in exactly
 * two situations, both ON DEMAND — never on a timer (apps/web/CLAUDE.md mobile
 * performance standard: a backgrounded phone must not run pollers):
 *
 *   1. cold start with the remember marker set and no in-tab access token
 *      (the operator reopened the PWA this morning);
 *   2. a 401 on a real request — single-flight refresh, retry once.
 *
 * Rotation happens upstream: the API hands back a NEW refresh token and
 * invalidates the one we just spent. If the one we sent had ALREADY been
 * spent, that is a replay, the API revokes the whole family, and we clear the
 * cookie here so the browser stops presenting a dead credential.
 *
 * WHAT CLEARS THE COOKIE (2026-11-10): only the API's own DECISION — a 401 or
 * a 403. Everything else (429 from the throttle, 500/502/504 while a deploy
 * overlaps, an unreadable body) is "could not find out", answered 503 with
 * the cookie KEPT, so a blip never signs a remembered operator out for good.
 * Before this, any non-503 failure cleared it.
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const gate = verifySameOriginRequest(req.headers);
  if (!gate.ok) {
    logSessionOutcome('refresh', `forbidden-${gate.reason}`);
    return NextResponse.json({ error: 'forbidden', reason: gate.reason }, { status: 403 });
  }
  const secure = req.nextUrl.protocol === 'https:';

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    // No durable credential in this browser. Not an error — it is the normal
    // answer for a plain (non-remembered) session. The companion marker is
    // cleared so the page stops asking.
    logSessionOutcome('refresh', 'no-cookie');
    const res = NextResponse.json({ refreshed: false, reason: 'no-cookie' }, { status: 401 });
    clearSessionCookies(res.cookies, secure);
    return res;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${serverApiBase()}/auth/session/refresh`, {
      method: 'POST',
      headers: bffForwardHeaders(),
      body: JSON.stringify({ refresh_token: cookie }),
    });
  } catch {
    // API unreachable. KEEP the cookie: a network blip must not sign the
    // operator out of a session the server still considers valid.
    logSessionOutcome('refresh', 'api-unreachable');
    return NextResponse.json({ refreshed: false, reason: 'api-unreachable' }, { status: 503 });
  }

  if (upstream.status === 401 || upstream.status === 403) {
    // The API's DECISION: expired, revoked, replayed, or policy-blocked. The
    // cookie is dead; stop sending it.
    logSessionOutcome('refresh', 'rejected', upstream.status);
    const res = NextResponse.json({ refreshed: false, reason: 'rejected' }, { status: 401 });
    clearSessionCookies(res.cookies, secure);
    return res;
  }

  if (!upstream.ok) {
    // Not a decision — the API could not answer (throttled, restarting, its
    // revocation store unreachable). Retryable, so the cookie stays.
    logSessionOutcome('refresh', 'retry', upstream.status);
    return NextResponse.json({ refreshed: false, reason: 'retry' }, { status: 503 });
  }

  const body = (await upstream.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_at?: string; user?: unknown }
    | null;
  if (!body?.access_token || !body?.refresh_token) {
    // A 200 we cannot read. The API may or may not have rotated; the cookie in
    // the jar is the only credential this browser has, so it stays and the
    // next attempt finds out.
    logSessionOutcome('refresh', 'malformed', upstream.status);
    return NextResponse.json({ refreshed: false, reason: 'malformed' }, { status: 503 });
  }

  const res = NextResponse.json({
    refreshed: true,
    access_token: body.access_token,
    user: body.user ?? null,
  });
  // The rotated token replaces the spent one. `refresh_token` is deliberately
  // absent from the JSON body above — it goes into the cookie and nowhere
  // else, which is the entire point of this route existing.
  setSessionCookies(res.cookies, secure, body.refresh_token, cookieMaxAgeFor(body.expires_at));
  logSessionOutcome('refresh', 'refreshed', upstream.status);
  return res;
}
