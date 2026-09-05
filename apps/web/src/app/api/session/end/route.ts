import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  bffForwardHeaders,
  serverApiBase,
  verifySameOriginRequest,
} from '@/lib/session-bff';

/**
 * SEC-010 — POST /api/session/end
 *
 * Sign-out for the durable half. Clears the cookie in THIS browser and tells
 * the API to revoke the whole family, so a copy of the cookie taken off a
 * shared machine is dead too.
 *
 * The cookie is cleared even when the upstream revoke fails: a logout that
 * leaves a live credential in the browser it was clicked in is the worse of
 * the two failures. The upstream call is still made first so a reachable API
 * always gets the revoke.
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const gate = verifySameOriginRequest(req.headers);
  if (!gate.ok) {
    return NextResponse.json({ error: 'forbidden', reason: gate.reason }, { status: 403 });
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    try {
      await fetch(`${serverApiBase()}/auth/session/revoke`, {
        method: 'POST',
        headers: bffForwardHeaders(),
        body: JSON.stringify({ refresh_token: cookie }),
      });
    } catch {
      /* best-effort — the cookie is cleared below regardless */
    }
  }

  const res = NextResponse.json({ ended: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge: 0,
  });
  return res;
}
