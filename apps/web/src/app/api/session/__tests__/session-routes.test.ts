/**
 * @jest-environment node
 *
 * The session routes themselves (2026-11-10) — until now only their helpers
 * were tested, and the mobile e2e mocks `/api/session/refresh`, so nothing
 * exercised what these handlers do with the cookie.
 *
 * Proves: the HttpOnly cookie and its companion marker are always set and
 * cleared TOGETHER; only the API's own decision (401 / 403) clears them — a
 * throttle, a restart or an unreadable answer keeps the cookie and answers
 * 503; a browser with no cookie is told so and its marker is cleared; and the
 * refresh token never appears in a response body.
 */
import { NextRequest } from 'next/server';
import { POST as adopt } from '../adopt/route';
import { POST as refresh } from '../refresh/route';
import { POST as end } from '../end/route';

const ORIGIN = 'https://venue-os.app';
const upstream = jest.fn();
const realFetch = global.fetch;

function req(path: string, opts: { cookie?: string; bearer?: string; header?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN, host: 'venue-os.app' };
  if (opts.header !== false) headers['x-venueos-session'] = '1';
  if (opts.cookie) headers.cookie = `venueos_rt=${opts.cookie}`;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest(`${ORIGIN}${path}`, { method: 'POST', headers, body: '{}' });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cookies = (res: Response) => res.headers.getSetCookie();
const cookieOf = (res: Response, name: string) => cookies(res).find((c) => c.startsWith(`${name}=`)) ?? null;
const expiry = () => new Date(Date.now() + 10 * 24 * 3600_000).toISOString();

beforeEach(() => {
  upstream.mockReset();
  global.fetch = upstream as never;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('POST /api/session/adopt', () => {
  it('sets the HttpOnly cookie AND the readable marker together, same lifetime, and logs the outcome without the token', async () => {
    upstream.mockResolvedValue(json({ refresh_token: 'rt-secret-1', expires_at: expiry() }));
    const res = await adopt(req('/api/session/adopt', { bearer: 'access.jwt' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: true });
    const rt = cookieOf(res, 'venueos_rt') as string;
    const rm = cookieOf(res, 'venueos_rm') as string;
    expect(rt).toMatch(/^venueos_rt=rt-secret-1; /);
    expect(rt).toMatch(/Path=\/api\/session/);
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/Secure/i);
    expect(rt).toMatch(/SameSite=lax/i);
    expect(rm).toMatch(/^venueos_rm=1; /);
    expect(rm).toMatch(/Path=\/(;|$)/);
    expect(rm).not.toMatch(/HttpOnly/i);
    const age = (c: string) => Number(/Max-Age=(\d+)/i.exec(c)?.[1]);
    expect(age(rt)).toBe(age(rm));
    expect(age(rt)).toBeGreaterThan(9 * 24 * 3600);
    const logged = (console.info as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[session] adopt outcome=adopted');
    expect(logged).not.toContain('rt-secret-1');
    expect(logged).not.toContain('access.jwt');
  });

  it('a refusal or an unreachable API sets NO cookie at all (never a marker without a credential)', async () => {
    upstream.mockResolvedValue(json({ code: 'SESSION_NOT_REMEMBERED' }, 403));
    let res = await adopt(req('/api/session/adopt', { bearer: 'a' }));
    expect(await res.json()).toEqual({ adopted: false });
    expect(cookies(res)).toEqual([]);
    upstream.mockRejectedValue(new TypeError('down'));
    res = await adopt(req('/api/session/adopt', { bearer: 'a' }));
    expect(res.status).toBe(503);
    expect(cookies(res)).toEqual([]);
  });

  it('without the custom header it is refused before anything is asked upstream', async () => {
    const res = await adopt(req('/api/session/adopt', { bearer: 'a', header: false }));
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('POST /api/session/refresh', () => {
  it('success: rotates BOTH cookies and keeps the refresh token out of the body', async () => {
    upstream.mockResolvedValue(json({ access_token: 'new.access', refresh_token: 'rt-secret-2', expires_at: expiry(), user: { id: 'u1' } }));
    const res = await refresh(req('/api/session/refresh', { cookie: 'rt-old' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ refreshed: true, access_token: 'new.access', user: { id: 'u1' } });
    expect(JSON.stringify(body)).not.toContain('rt-secret-2');
    expect(cookieOf(res, 'venueos_rt')).toMatch(/^venueos_rt=rt-secret-2; /);
    expect(cookieOf(res, 'venueos_rm')).toMatch(/^venueos_rm=1; /);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({ refresh_token: 'rt-old' });
  });

  it('no cookie in this browser: 401 no-cookie, nothing asked upstream, the marker is cleared so the page stops asking', async () => {
    const res = await refresh(req('/api/session/refresh'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ refreshed: false, reason: 'no-cookie' });
    expect(upstream).not.toHaveBeenCalled();
    expect(cookieOf(res, 'venueos_rm')).toMatch(/Max-Age=0/i);
  });

  it.each([401, 403])('the API’s decision (%i) clears both cookies', async (status) => {
    upstream.mockResolvedValue(json({}, status));
    const res = await refresh(req('/api/session/refresh', { cookie: 'rt-old' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ refreshed: false, reason: 'rejected' });
    expect(cookieOf(res, 'venueos_rt')).toMatch(/^venueos_rt=; .*Max-Age=0/i);
    expect(cookieOf(res, 'venueos_rm')).toMatch(/^venueos_rm=; .*Max-Age=0/i);
  });

  it.each([429, 500, 502, 503, 504])('a %i is "could not find out": 503, and the cookie is KEPT', async (status) => {
    upstream.mockResolvedValue(json({}, status));
    const res = await refresh(req('/api/session/refresh', { cookie: 'rt-old' }));
    expect(res.status).toBe(503);
    expect((await res.json()).refreshed).toBe(false);
    expect(cookies(res)).toEqual([]);
  });

  it('an unreachable API or an unreadable 200 keeps the cookie too', async () => {
    upstream.mockRejectedValue(new TypeError('down'));
    let res = await refresh(req('/api/session/refresh', { cookie: 'rt-old' }));
    expect(res.status).toBe(503);
    expect(cookies(res)).toEqual([]);
    upstream.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
    res = await refresh(req('/api/session/refresh', { cookie: 'rt-old' }));
    expect(res.status).toBe(503);
    expect(cookies(res)).toEqual([]);
  });
});

describe('POST /api/session/end', () => {
  it('clears both cookies even when the upstream revoke fails', async () => {
    upstream.mockRejectedValue(new TypeError('down'));
    const res = await end(req('/api/session/end', { cookie: 'rt-old' }));
    expect(await res.json()).toEqual({ ended: true });
    expect(cookieOf(res, 'venueos_rt')).toMatch(/Max-Age=0/i);
    expect(cookieOf(res, 'venueos_rm')).toMatch(/Max-Age=0/i);
  });
});
