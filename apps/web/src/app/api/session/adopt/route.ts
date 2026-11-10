import { NextResponse, type NextRequest } from 'next/server';
import {
  bffForwardHeaders,
  cookieMaxAgeFor,
  logSessionOutcome,
  serverApiBase,
  setSessionCookies,
  verifySameOriginRequest,
} from '@/lib/session-bff';

/**
 * SEC-010 — POST /api/session/adopt
 *
 * "The operator ticked Keep me signed in; give this browser a durable
 * credential it cannot read."
 *
 * The page sends the access token it JUST received (which page JavaScript
 * already holds — that is not the secret we are protecting). This handler
 * trades it, server-side, for an opaque refresh token and parks that in an
 * HttpOnly cookie. The refresh token never enters the browser's JS heap.
 *
 * Deliberately one call that works for EVERY way a session is minted —
 * password login, MFA challenge, forced-enrollment verify, SSO landing — so
 * the storage model cannot drift per entry point. It asks nothing about how
 * the caller authenticated; the API decides, from the token's own `rm`
 * claim, whether this session opted into staying signed in.
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const gate = verifySameOriginRequest(req.headers);
  if (!gate.ok) {
    logSessionOutcome('adopt', `forbidden-${gate.reason}`);
    return NextResponse.json({ error: 'forbidden', reason: gate.reason }, { status: 403 });
  }

  const auth = req.headers.get('authorization');
  if (!auth || !/^Bearer\s+\S+/i.test(auth)) {
    logSessionOutcome('adopt', 'no-bearer');
    return NextResponse.json({ error: 'no-bearer' }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${serverApiBase()}/auth/session/issue`, {
      method: 'POST',
      headers: { ...bffForwardHeaders(), authorization: auth },
      body: '{}',
    });
  } catch {
    // The API is unreachable. The caller keeps its normal (short) session —
    // "keep me signed in" degrades to "signed in", never to "signed out".
    logSessionOutcome('adopt', 'api-unreachable');
    return NextResponse.json({ adopted: false, reason: 'api-unreachable' }, { status: 503 });
  }

  if (!upstream.ok) {
    logSessionOutcome('adopt', 'refused', upstream.status);
    return NextResponse.json({ adopted: false }, { status: upstream.status === 403 ? 200 : 502 });
  }

  const body = (await upstream.json().catch(() => null)) as
    | { refresh_token?: string; expires_at?: string }
    | null;
  if (!body?.refresh_token) {
    logSessionOutcome('adopt', 'malformed', upstream.status);
    return NextResponse.json({ adopted: false }, { status: 502 });
  }

  const maxAge = cookieMaxAgeFor(body.expires_at);
  if (maxAge <= 0) {
    logSessionOutcome('adopt', 'already-expired', upstream.status);
    return NextResponse.json({ adopted: false }, { status: 200 });
  }

  const res = NextResponse.json({ adopted: true });
  // `secure` on anything but plain-HTTP localhost. A Secure cookie is
  // silently dropped over http://, which would make local dev look like a
  // broken feature rather than a deliberate downgrade.
  setSessionCookies(res.cookies, req.nextUrl.protocol === 'https:', body.refresh_token, maxAge);
  logSessionOutcome('adopt', 'adopted', upstream.status);
  return res;
}
