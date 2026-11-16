/**
 * Browser binding for OAuth connect flows whose callback is public (POS,
 * social). Same shape as the Clever flow (`integrations/clever/
 * clever.controller.ts` + `clever-oauth-state.ts`):
 *
 *   authorize  mint a random nonce, store it WITH the server-side state
 *              record, and hand it to the browser as a short-lived HttpOnly
 *              cookie scoped to the callback path (plus an express-session
 *              copy for a browser that refuses the cookie write);
 *   callback   read the nonce from the cookie (or the session copy), clear
 *              both, and refuse unless it equals the nonce stored with the
 *              state.
 *
 * The state alone only proves WE minted it; the nonce proves the browser
 * finishing the flow is the browser that started it.
 *
 * Cookie attributes follow the Clever cookie and the API's session cookie:
 * HttpOnly always; in production `Secure; SameSite=None`, because the
 * dashboard (Vercel) and this API (Railway) are different sites and the
 * authorize call is a cross-site XHR — a `Lax` cookie set from that response
 * is discarded by the browser. Development is same-site, so `Lax` there.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/** Matches the 10-minute state TTL of the POS and social flows. */
export const OAUTH_BINDING_MAX_AGE_MS = 10 * 60 * 1000;

export interface OAuthBindingSpec {
  /** Cookie name, e.g. `venueos_pos_oauth`. */
  cookie: string;
  /** Cookie path — the callback's path prefix. */
  path: string;
  /** express-session key for the fallback copy. */
  sessionKey: string;
}

export function mintBindingNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function bindingCookieOptions(path: string): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  path: string;
} {
  const prod = process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure: prod, sameSite: prod ? 'none' : 'lax', path };
}

type WithSession = Request & { session?: Record<string, unknown>; cookies?: Record<string, unknown> };

/** Called from `authorize`. */
export function setBrowserBinding(req: Request, res: Response, spec: OAuthBindingSpec, nonce: string): void {
  res.cookie(spec.cookie, nonce, { ...bindingCookieOptions(spec.path), maxAge: OAUTH_BINDING_MAX_AGE_MS });
  const session = (req as WithSession).session;
  if (session) session[spec.sessionKey] = nonce;
}

/**
 * Called first thing in `callback`: returns the nonce this browser carries
 * (cookie, else session copy) and clears both, so a nonce is never left
 * behind whatever the outcome.
 */
export function takeBrowserBinding(req: Request, res: Response, spec: OAuthBindingSpec): string | null {
  const r = req as WithSession;
  const fromCookie = r.cookies?.[spec.cookie];
  const session = r.session;
  const fromSession = session?.[spec.sessionKey];
  if (session) delete session[spec.sessionKey];
  if (typeof (res as Partial<Response>).clearCookie === 'function') {
    res.clearCookie(spec.cookie, bindingCookieOptions(spec.path));
  }
  if (typeof fromCookie === 'string' && fromCookie) return fromCookie;
  return typeof fromSession === 'string' && fromSession ? fromSession : null;
}

/** Constant-time comparison; false when either side is missing. */
export function bindingMatches(expected: string | null | undefined, actual: string | null | undefined): boolean {
  if (typeof expected !== 'string' || typeof actual !== 'string' || !expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
