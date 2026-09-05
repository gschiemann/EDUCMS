import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  bffForwardHeaders,
  cookieMaxAgeFor,
  serverApiBase,
  verifySameOriginRequest,
} from '@/lib/session-bff';

/**
 * SEC-010 — POST /api/session/refresh
 *
 * The only way a remembered session comes back to life. Called in exactly
 * two situations, both ON DEMAND — never on a timer (CLAUDE.md mobile
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
 */
export const runtime = 'nodejs';

function clearedCookieResponse(req: NextRequest, status: number, payload: unknown) {
  const res = NextResponse.json(payload, { status });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge: 0,
  });
  return res;
}

export async function POST(req: NextRequest) {
  const gate = verifySameOriginRequest(req.headers);
  if (!gate.ok) {
    return NextResponse.json({ error: 'forbidden', reason: gate.reason }, { status: 403 });
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    // No durable credential in this browser. Not an error — it is the normal
    // answer for a plain (non-remembered) session.
    return NextResponse.json({ refreshed: false, reason: 'no-cookie' }, { status: 401 });
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
    return NextResponse.json({ refreshed: false, reason: 'api-unreachable' }, { status: 503 });
  }

  if (upstream.status === 503) {
    // The API could not reach its revocation store and refused to guess.
    // Same rule as above — retryable, so the cookie stays.
    return NextResponse.json({ refreshed: false, reason: 'retry' }, { status: 503 });
  }

  if (!upstream.ok) {
    // 401/403 from the API is a DECISION: expired, revoked, replayed, or
    // policy-blocked. The cookie is dead; stop sending it.
    return clearedCookieResponse(req, 401, { refreshed: false, reason: 'rejected' });
  }

  const body = (await upstream.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_at?: string; user?: unknown }
    | null;
  if (!body?.access_token || !body?.refresh_token) {
    return clearedCookieResponse(req, 502, { refreshed: false, reason: 'malformed' });
  }

  const maxAge = cookieMaxAgeFor(body.expires_at);
  const res = NextResponse.json({
    refreshed: true,
    access_token: body.access_token,
    user: body.user ?? null,
  });
  // The rotated token replaces the spent one. `refresh_token` is deliberately
  // absent from the JSON body above — it goes into the cookie and nowhere
  // else, which is the entire point of this route existing.
  res.cookies.set(SESSION_COOKIE_NAME, body.refresh_token, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge: Math.max(maxAge, 1),
  });
  return res;
}
