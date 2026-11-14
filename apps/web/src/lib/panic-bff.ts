/**
 * Panic phones (2026-11-14) — the web origin's half of the credential.
 *
 * The credential lives ONLY in `venueos_pd`: HttpOnly (page script can never
 * read it, so an XSS cannot carry it away), Secure, SameSite=Strict (no other
 * site can make the browser send it), scoped to `/api/panic` (it never rides
 * a page load or any other route). The browser sends it to our own route
 * handlers; they put it in a request BODY to the API, server to server, with
 * SESSION_BFF_SECRET. It never appears in any response body.
 *
 * `venueos_pm=1` is the readable companion, set and cleared with it: NOT a
 * credential, only "this phone may be ready", so a cold start knows the
 * status check is worth a round trip — same pattern as `venueos_rm`.
 *
 * Lifetime: the credential does not expire on the server. Browsers cap a
 * cookie at about 400 days, so every successful status check re-sets both
 * cookies — a phone that opens the panic app once a year stays ready.
 */
import { bffForwardHeaders } from './session-bff';
import { gatewayClientIp } from '@/app/player/gatewayPaths';

import { PANIC_COOKIE_NAME, PANIC_MARKER_COOKIE_NAME } from './panic-bff-names';

export { PANIC_COOKIE_NAME, PANIC_MARKER_COOKIE_NAME };
export const PANIC_COOKIE_PATH = '/api/panic';
/** ~400 days, the browsers' own ceiling. */
export const PANIC_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;
/** The API reads this only after SESSION_BFF_SECRET matched (panic-device.controller.ts). */
export const PANIC_CLIENT_IP_HEADER = 'x-venueos-panic-client-ip';

interface CookieJar {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
}

export function setPanicCookies(jar: CookieJar, secure: boolean, credential: string): void {
  const maxAge = PANIC_COOKIE_MAX_AGE_SEC;
  jar.set(PANIC_COOKIE_NAME, credential, { httpOnly: true, secure, sameSite: 'strict', path: PANIC_COOKIE_PATH, maxAge });
  jar.set(PANIC_MARKER_COOKIE_NAME, '1', { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge });
}

export function clearPanicCookies(jar: CookieJar, secure: boolean): void {
  jar.set(PANIC_COOKIE_NAME, '', { httpOnly: true, secure, sameSite: 'strict', path: PANIC_COOKIE_PATH, maxAge: 0 });
  jar.set(PANIC_MARKER_COOKIE_NAME, '', { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: 0 });
}

/**
 * Headers for the hop to the API: the BFF secret (bffForwardHeaders) and the
 * phone's REAL address as this origin saw it (Vercel's `x-real-ip`), so the
 * API can rate-limit per school instead of per Vercel egress address.
 */
export function panicForwardHeaders(get: (name: string) => string | null): Record<string, string> {
  const headers = bffForwardHeaders();
  const ip = gatewayClientIp(get);
  if (ip) headers[PANIC_CLIENT_IP_HEADER] = ip;
  const ua = get('user-agent');
  if (ua) headers['user-agent'] = ua.slice(0, 512);
  return headers;
}

/** The API codes that mean "this credential is dead": clear it. Everything else keeps it. */
export function isPanicRefusal(status: number, body: unknown): boolean {
  return status === 401 && (body as { code?: unknown } | null)?.code === 'PANIC_DEVICE_REFUSED';
}

/** One log line per outcome — the outcome word and the upstream status, never a credential. */
export function logPanicOutcome(action: string, outcome: string, upstreamStatus?: number): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[panic] ${action} outcome=${outcome}${typeof upstreamStatus === 'number' ? ` upstream=${upstreamStatus}` : ''}`);
  } catch {
    /* logging never fails a request */
  }
}
