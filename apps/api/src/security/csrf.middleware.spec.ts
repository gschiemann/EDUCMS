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

  it('exempts the MFA step-up + forced-enrollment endpoints (2026-09-04 lockout fix)', () => {
    // These are pre-session by definition — the caller has no cookie yet.
    // Measured against production before the fix: /auth/login returned
    // mfaRequired (it is exempt) and /required/enroll answered 403
    // CsrfError, so a privileged user was blocked at login AND unable to
    // enroll. Authorization is the short-lived signed mfaToken in the body.
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/challenge')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/enroll')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/verify')).toBe(true);
    // The SESSION-gated MFA routes stay protected — a logged-in user has a
    // cookie to round-trip, so exempting them would be a real regression.
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/enroll')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/verify')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/disable')).toBe(false);
  });

  it('exempts the four PUBLIC passkey routes, and ONLY those (2026-09-21)', () => {
    // Pre-session by definition, called with a bare fetch from the login page.
    // The controller specs never pass through this middleware, so they were
    // all green while a real API answered 403 CsrfError to the first request.
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/challenge/passkey/options')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/challenge/passkey')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/login/options')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/login/verify')).toBe(true);
    // Managing your own passkeys is a SIGNED-IN action: it must stay behind
    // CSRF (it passes on the Bearer bypass, not on an exemption). Exempting
    // these would let a cross-site page add a permanent credential to a
    // cookie-authenticated session.
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/register/options')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/register/verify')).toBe(false);
    expect(isCsrfExempt('PATCH', '/api/v1/auth/passkeys/abc')).toBe(false);
    expect(isCsrfExempt('DELETE', '/api/v1/auth/passkeys/abc')).toBe(false);
    // No prefix match: a look-alike path gets nothing.
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/login/verify/extra')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/login')).toBe(false);
  });

  it('exempts the two FORCED-ENROLLMENT passkey routes (2026-09-21)', () => {
    // Same pre-session class as /auth/mfa/required/{enroll,verify}: the login
    // page calls them with a bare `fetch` while the MFA policy is withholding
    // the session, so there is no CSRF cookie to round-trip and never will be
    // until enrollment completes. Authorization is the signed `mfaToken` in
    // the body. Missing these two would re-create the 2026-09-04 lockout on
    // the lane that exists to spare non-technical operators an authenticator
    // app — and the controller specs cannot catch it, because they call the
    // handlers directly and never pass through this middleware.
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/passkey/options')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/passkey/verify')).toBe(true);
    // The SIGNED-IN way to add a passkey stays behind CSRF. It is the
    // mirror-image action on an account that already has a session, so
    // exempting it would let a cross-site page add a permanent credential.
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/register/options')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/passkeys/register/verify')).toBe(false);
    // Exact match only — no prefix, no sibling.
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/passkey')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/passkey/verify/extra')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/mfa/required/passkey/options/extra')).toBe(false);
  });

  it('exempts the SEC-010 server-to-server session endpoints, and ONLY those two', () => {
    // /refresh and /revoke are called by the WEB ORIGIN'S SERVER (the Next
    // route handlers in apps/web/src/app/api/session/*), never by a browser.
    // They carry no ambient credential at all — the refresh secret is in the
    // BODY — so CSRF's threat model does not reach them. Same argument as
    // /password-reset/complete.
    expect(isCsrfExempt('POST', '/api/v1/auth/session/refresh')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/auth/session/revoke')).toBe(true);
    // /issue is Bearer-authenticated, so it takes the middleware's Bearer
    // bypass at request time and must NOT be on the path allowlist — a path
    // exemption would apply even to a cookie-only caller.
    expect(isCsrfExempt('POST', '/api/v1/auth/session/issue')).toBe(false);
    // Nothing else under /auth/session is exempt by prefix.
    expect(isCsrfExempt('POST', '/api/v1/auth/session')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/auth/session/refresh/extra')).toBe(false);
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

  it('exempts the swim timing-snapshot ingest (Inputs-wave SWIM)', () => {
    // The swim-bridge WebSerial page (or a Node serialport fallback) POSTs
    // decoded CTS scoreboard-serial state machine-to-machine with the
    // game-scoped HMAC feed token — no session cookie, so no CSRF token
    // round-trip is possible. Exempted TOGETHER WITH the first consumer so
    // it can't repeat the /cts-snapshot day-one 403 (fixed 2026-05-28).
    expect(isCsrfExempt('POST', '/api/v1/sports/board/game-1/swim-timing-snapshot')).toBe(true);
    // Sanity — sibling GUARDED sports routes gain nothing from the prefix.
    expect(isCsrfExempt('POST', '/api/v1/sports/board/game-1/swim-timing-snapshot/extra')).toBe(false);
    expect(isCsrfExempt('PATCH', '/api/v1/sports/games/game-1/stats')).toBe(false);
  });

  it('exempts the display capability report but NOT display-control (2026-08-13)', () => {
    // The player reports its DisplayCapabilityProbe verdict from native
    // Kotlin (HttpURLConnection — no cookie jar), authenticated by the device
    // credential in an Authorization header, so no CSRF token round-trip is
    // possible. Exempted TOGETHER WITH the endpoint so it cannot repeat the
    // day-one 403 that broke /cts-snapshot (2026-05-28) and swim-timing.
    expect(isCsrfExempt('POST', '/api/v1/screens/screen-1/display-capabilities')).toBe(true);
    // The OPERATOR action route — which can blank or REBOOT a physical screen
    // — is a dashboard call with an ambient session. That is precisely CSRF's
    // threat model, so it stays gated. This asymmetry is deliberate.
    expect(isCsrfExempt('POST', '/api/v1/screens/screen-1/display-control')).toBe(false);
    // Sibling schedule/recipe CRUD is dashboard-only and stays gated too.
    expect(isCsrfExempt('POST', '/api/v1/display-schedules')).toBe(false);
    expect(isCsrfExempt('PUT', '/api/v1/display-schedules/ds-1')).toBe(false);
    expect(isCsrfExempt('DELETE', '/api/v1/display-schedules/ds-1')).toBe(false);
    expect(isCsrfExempt('PUT', '/api/v1/display-recipes/goodview-ep6n')).toBe(false);
    // Exact-anchored, never a prefix — a future sibling route must be
    // exempted explicitly rather than inheriting it.
    expect(isCsrfExempt('POST', '/api/v1/screens/screen-1/display-capabilities/extra')).toBe(false);
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

  it('passes the swim snapshot POST with no CSRF header in enforce mode (non-exempt routes still 403)', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    // The swim-bridge posts with only x-feed-token — no CSRF cookie, no
    // CSRF header. The exemption must let it reach the controller (where
    // assertFeedAuth is the real gate) instead of 403'ing before auth runs.
    const swimReq = makeReq({ path: '/api/v1/sports/board/game-1/swim-timing-snapshot' });
    const next = jest.fn();
    mw.use(swimReq as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith();
    // Same-shaped request against a non-exempt route is still blocked.
    const guardedReq = makeReq({ path: '/api/v1/playlists' });
    expect(() => mw.use(guardedReq as any, makeRes() as any, jest.fn())).toThrow(ForbiddenException);
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
