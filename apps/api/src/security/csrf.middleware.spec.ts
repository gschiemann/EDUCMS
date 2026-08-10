import { ForbiddenException } from '@nestjs/common';
import { CsrfMiddleware, CSRF_COOKIE_NAME, isCsrfExempt, mintCsrfToken } from './csrf.middleware';

type MockReq = {
  method: string;
  path: string;
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

type MockRes = {
  cookie: jest.Mock;
};

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method: 'POST',
    path: '/api/v1/playlists',
    cookies: {},
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function makeRes(): MockRes {
  return { cookie: jest.fn() };
}

describe('isCsrfExempt', () => {
  it('exempts safe methods', () => {
    expect(isCsrfExempt('GET', '/api/v1/playlists')).toBe(true);
    expect(isCsrfExempt('HEAD', '/api/v1/playlists')).toBe(true);
    expect(isCsrfExempt('OPTIONS', '/api/v1/playlists')).toBe(true);
  });

  it('exempts login, health, and the csrf mint endpoint', () => {
    expect(isCsrfExempt('POST', '/api/v1/auth/login')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/health')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/health/ready')).toBe(true);
    expect(isCsrfExempt('GET', '/api/v1/security/csrf')).toBe(true);
  });

  it('does not exempt other mutations', () => {
    expect(isCsrfExempt('POST', '/api/v1/emergency/trigger')).toBe(false);
    expect(isCsrfExempt('PUT', '/api/v1/playlists/1')).toBe(false);
    expect(isCsrfExempt('DELETE', '/api/v1/playlists/1')).toBe(false);
  });

  it('exempts the touch builder request-help endpoint', () => {
    // Phase D1 — public endpoint kiosks (no CSRF cookie) call when a
    // visitor taps a help button. Hardened via screenId resolution +
    // rate limit + dedupe instead of CSRF.
    expect(isCsrfExempt('POST', '/api/v1/notifications/help')).toBe(true);
    // Sanity — the OTHER notifications endpoints are still gated.
    expect(isCsrfExempt('POST', '/api/v1/notifications/abc/read')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/notifications/read-all')).toBe(false);
  });

  it('exempts the public sponsor impression beacon (Audit 37-infra R-2)', () => {
    // Stadium board / ribbon / scorebug fire this cross-origin from the
    // kiosk WebView with no CSRF cookie. Hardened via per-game rate limit +
    // server-side tenant-match instead of CSRF.
    expect(isCsrfExempt('POST', '/api/v1/sports/sponsors/sp-123/impression')).toBe(true);
    // The CTS celebration-fired forensic write — same machine-to-machine
    // argument as /feed and /cts-snapshot.
    expect(isCsrfExempt('POST', '/api/v1/sports/board/game-1/cts-cue-fired')).toBe(true);
    // Sanity — the GUARDED sponsor CRUD routes are NOT exempt.
    expect(isCsrfExempt('POST', '/api/v1/sports/sponsors')).toBe(false);
    expect(isCsrfExempt('DELETE', '/api/v1/sports/sponsors/sp-123')).toBe(false);
  });

  it('exempts EXACTLY the scorekeeper console action allowlist (Phase-2 SHARE)', () => {
    // The /console/<token> pad mutates with NO session — auth is the
    // game-scoped console HMAC capability token in the path
    // (sports-console-token.ts), so CSRF's ambient-cookie model doesn't
    // apply. The exemption enumerates the SportsConsoleController
    // allowlist verb-for-verb — never a blanket prefix.
    const tok = 'game-1.0.1754000000.86400.0123456789abcdef0123456789abcdef';
    expect(isCsrfExempt('PATCH', `/api/v1/sports/console/${tok}/score`)).toBe(true);
    expect(isCsrfExempt('PATCH', `/api/v1/sports/console/${tok}/clock`)).toBe(true);
    expect(isCsrfExempt('PATCH', `/api/v1/sports/console/${tok}/segment`)).toBe(true);
    expect(isCsrfExempt('POST', `/api/v1/sports/console/${tok}/timeout`)).toBe(true);
    expect(isCsrfExempt('POST', `/api/v1/sports/console/${tok}/cue`)).toBe(true);
    // Sanity — a path outside the enumerated allowlist gains NOTHING from
    // the console prefix (a future route must be exempted explicitly)…
    expect(isCsrfExempt('POST', `/api/v1/sports/console/${tok}/status`)).toBe(false);
    expect(isCsrfExempt('POST', `/api/v1/sports/console/${tok}/roster`)).toBe(false);
    expect(isCsrfExempt('DELETE', `/api/v1/sports/console/${tok}`)).toBe(false);
    // …and the AUTHED mint/revoke endpoints stay fully CSRF-gated.
    expect(isCsrfExempt('POST', '/api/v1/sports/games/game-1/console-share')).toBe(false);
    expect(isCsrfExempt('DELETE', '/api/v1/sports/games/game-1/console-share')).toBe(false);
  });

  it('exempts POS inbound webhooks (Square HMAC + custom-webhook secret) — final-beta P0', () => {
    // External POS systems POST machine-to-machine with no session; each
    // receiver self-authenticates (Square HMAC sig / X-Webhook-Secret).
    // These were never exempted → every POST 403'd before its own auth ran.
    expect(isCsrfExempt('POST', '/api/v1/pos/webhook/square')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/pos/webhook/custom-webhook')).toBe(true);
    // Sanity — the GUARDED POS routes (OAuth start/callback, sync, settings)
    // are NOT exempt; only the /webhook/<provider> receivers are.
    expect(isCsrfExempt('POST', '/api/v1/pos/sync')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/pos/connect')).toBe(false);
  });
});

describe('CsrfMiddleware', () => {
  const originalEnforce = process.env.CSRF_ENFORCE;

  afterEach(() => {
    process.env.CSRF_ENFORCE = originalEnforce;
  });

  it('issues a cookie when no token is present', () => {
    process.env.CSRF_ENFORCE = 'false';
    const mw = new CsrfMiddleware();
    const req = makeReq({ method: 'GET', path: '/api/v1/playlists' });
    const res = makeRes();
    const next = jest.fn();

    mw.use(req as any, res as any, next);

    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ path: '/', httpOnly: false }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('passes safe methods without validating', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const req = makeReq({ method: 'GET', cookies: { [CSRF_COOKIE_NAME]: 'existing' } });
    const res = makeRes();
    const next = jest.fn();

    mw.use(req as any, res as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks mutation with missing header when enforcing', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const token = 'abc';
    const req = makeReq({ cookies: { [CSRF_COOKIE_NAME]: token }, headers: {} });
    const res = makeRes();

    expect(() => mw.use(req as any, res as any, jest.fn())).toThrow(ForbiddenException);
  });

  it('blocks mutation with mismatched header when enforcing', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const req = makeReq({
      cookies: { [CSRF_COOKIE_NAME]: 'aaa' },
      headers: { 'x-csrf-token': 'bbb' },
    });
    expect(() => mw.use(req as any, makeRes() as any, jest.fn())).toThrow(ForbiddenException);
  });

  it('allows mutation when cookie matches header', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const token = mintCsrfToken();
    const req = makeReq({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { 'x-csrf-token': token },
    });
    const next = jest.fn();

    mw.use(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('does not block when CSRF_ENFORCE is off (warn mode)', () => {
    process.env.CSRF_ENFORCE = 'false';
    const mw = new CsrfMiddleware();
    const req = makeReq({ cookies: { [CSRF_COOKIE_NAME]: 'aaa' }, headers: {} });
    const next = jest.fn();

    mw.use(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalled();
  });
});
