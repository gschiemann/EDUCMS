/**
 * @jest-environment node
 *
 * Panic phones (2026-11-14) — the web origin's `/api/panic/*` handlers, real.
 * The credential lives only in an HttpOnly, Secure, SameSite=Strict cookie on
 * /api/panic; it is never in a response body; only the API's own "dead"
 * decision (or the phone's own turn-off) clears it; there is no all-clear.
 */
import { NextRequest } from 'next/server';
import { POST } from '../[action]/route';

const ORIGIN = 'https://venue-os.app';
const CRED = 'pd1.' + 'A'.repeat(43);
const upstream = jest.fn();
const realFetch = global.fetch;

function req(action: string, opts: { cookie?: boolean; header?: boolean; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: ORIGIN,
    host: 'venue-os.app',
    'x-real-ip': '198.51.100.7',
    'user-agent': 'iPhone',
  };
  if (opts.header !== false) headers['x-venueos-session'] = '1';
  if (opts.cookie !== false) headers.cookie = `venueos_pd=${CRED}`;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest(`${ORIGIN}/api/panic/${action}`, { method: 'POST', headers, body: JSON.stringify(opts.body ?? {}) });
}
const call = (action: string, opts?: Parameters<typeof req>[1]) => POST(req(action, opts), { params: Promise.resolve({ action }) });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;

beforeEach(() => {
  upstream.mockReset();
  global.fetch = upstream as never;
  process.env.SESSION_BFF_SECRET = 'bff-shared-secret-0123456789';
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  delete process.env.SESSION_BFF_SECRET;
});

describe('enroll', () => {
  it('sets the HttpOnly / Secure / SameSite=Strict cookie on /api/panic and its marker; the credential never reaches the page', async () => {
    upstream.mockResolvedValue(json({ credential: CRED, device: { id: 'pd-1', label: 'iPhone · Safari' } }));
    const res = await call('enroll', { cookie: false, bearer: 'fresh.jwt' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enrolled: true, device: { id: 'pd-1', label: 'iPhone · Safari' } });
    expect(JSON.stringify(body)).not.toContain(CRED);
    const pd = cookieOf(res, 'venueos_pd') as string;
    expect(pd).toMatch(new RegExp(`^venueos_pd=${CRED.replace('.', '\\.')}; `));
    expect(pd).toMatch(/Path=\/api\/panic/);
    expect(pd).toMatch(/HttpOnly/i);
    expect(pd).toMatch(/Secure/i);
    expect(pd).toMatch(/SameSite=strict/i);
    const pm = cookieOf(res, 'venueos_pm') as string;
    expect(pm).toMatch(/^venueos_pm=1; /);
    expect(pm).not.toMatch(/HttpOnly/i);
    // Server to server: the bearer, the BFF secret, the phone's real address.
    const [url, init] = upstream.mock.calls[0];
    expect(url).toMatch(/\/panic-device\/enroll$/);
    expect(init.headers.authorization).toBe('Bearer fresh.jwt');
    expect(init.headers['x-venueos-session-bff']).toBe('bff-shared-secret-0123456789');
    expect(init.headers['x-venueos-panic-client-ip']).toBe('198.51.100.7');
  });

  it('a refusal (e.g. stale sign-in) sets nothing and says why', async () => {
    upstream.mockResolvedValue(json({ code: 'PANIC_DEVICE_ENROLL_REFUSED', reason: 'stale-login' }, 403));
    const res = await call('enroll', { cookie: false, bearer: 'old.jwt' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ enrolled: false, reason: 'stale-login' });
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe('the credential’s uses', () => {
  it('status: the credential goes in the BODY to the API; a good answer renews the cookie', async () => {
    upstream.mockResolvedValue(json({ device: { id: 'pd-1' }, user: { id: 'u1' } }));
    const res = await call('status');
    expect(res.status).toBe(200);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({ credential: CRED });
    expect(JSON.stringify(await res.json())).not.toContain(CRED);
    expect(cookieOf(res, 'venueos_pd')).toMatch(/Max-Age=\d{6,}/);
  });

  it('the API’s "dead" decision clears both cookies', async () => {
    upstream.mockResolvedValue(json({ code: 'PANIC_DEVICE_REFUSED', reason: 'revoked' }, 401));
    const res = await call('status');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: 'refused', detail: 'revoked' });
    expect(cookieOf(res, 'venueos_pd')).toMatch(/Max-Age=0/i);
    expect(cookieOf(res, 'venueos_pm')).toMatch(/Max-Age=0/i);
  });

  it.each([
    ['the kill switch', 403, { code: 'PANIC_DEVICE_DISABLED' }, 403],
    ['a missing BFF secret on the API', 403, { code: 'PANIC_DEVICE_UNAVAILABLE' }, 403],
    ['a throttle', 429, { code: 'PANIC_DEVICE_RATE_LIMITED' }, 503],
    ['an API restart', 502, {}, 503],
  ])('%s KEEPS the cookie (could not use it now ≠ it is gone)', async (_l, status, body, expected) => {
    upstream.mockResolvedValue(json(body, status));
    const res = await call('status');
    expect(res.status).toBe(expected);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('trigger: the body is rebuilt key by key — a playlist, a URL, a text are dropped; a bad type is refused', async () => {
    upstream.mockResolvedValue(json({ success: true, overrideId: 'ovr_1' }));
    const res = await call('trigger', {
      body: { type: 'lockdown', isDrill: true, target: { scopeType: 'group', scopeId: 'g1', x: 1 }, playlistId: 'p', mediaUrl: 'https://x', textBlob: 't' },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({
      credential: CRED,
      type: 'lockdown',
      isDrill: true,
      target: { scopeType: 'group', scopeId: 'g1' },
    });
    upstream.mockClear();
    expect((await call('trigger', { body: { type: 'all-clear' } })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('the trigger’s own refusal (403 scope, 409 drill over live) is passed on and the cookie is kept', async () => {
    upstream.mockResolvedValue(json({ code: 'EMERGENCY_DRILL_BLOCKED_BY_LIVE_ALERT', message: 'A live alert is on' }, 409));
    const res = await call('trigger', { body: { type: 'lockdown', isDrill: true } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'EMERGENCY_DRILL_BLOCKED_BY_LIVE_ALERT' });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('no cookie: 401 no-cookie, nothing asked upstream', async () => {
    const res = await call('status', { cookie: false });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: 'no-cookie' });
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('the boundary', () => {
  it.each(['all-clear', 'clear', 'broadcast', 'revoke-all', 'users'])('there is no "%s" route', async (action) => {
    const res = await call(action);
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('without the custom header it is refused before anything is asked upstream (CSRF)', async () => {
    const res = await call('trigger', { header: false, body: { type: 'lockdown' } });
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('end: revokes upstream and clears both cookies even when the API is down', async () => {
    upstream.mockRejectedValue(new TypeError('down'));
    const res = await call('end');
    expect(await res.json()).toEqual({ ended: true });
    expect(cookieOf(res, 'venueos_pd')).toMatch(/Max-Age=0/i);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({ credential: CRED });
    expect(upstream.mock.calls[0][0]).toMatch(/\/panic-device\/revoke$/);
  });
});
