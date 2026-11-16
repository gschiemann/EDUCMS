import { SsoController, OIDC_BROWSER_COOKIE } from './sso.controller';

/**
 * S9 (launch-readiness): OIDC login state must survive a callback that lands on
 * a DIFFERENT replica than the login redirect. express-session's default
 * MemoryStore is process-local, so the fix mirrors state into Redis keyed by
 * the (unguessable, single-use) state value.
 */

/** A Map-backed stand-in for ioredis with the set/get/del we use. */
function fakeRedisPublisher() {
  const store = new Map<string, string>();
  return {
    store,
    async set(k: string, v: string, _ex: string, _ttl: number) { store.set(k, v); return 'OK'; },
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async del(k: string) { return store.delete(k) ? 1 : 0; },
  };
}

function makeController(publisher: any) {
  let capturedExpected: any = null;
  const sso = {
    buildOidcLoginUrl: jest.fn(async () => ({ url: 'https://idp.example/authorize?x=1', state: 'STATE-123', nonce: 'NONCE-456' })),
    validateOidcCallback: jest.fn(async (_slug: string, _q: any, _base: string, expected: any) => {
      capturedExpected = expected;
      if (!expected?.state || !expected?.nonce) throw new Error('missing state/nonce');
      return { email: 'user@district.org' };
    }),
    completeSsoLogin: jest.fn(async () => ({ access_token: 'jwt-token', user: { tenantSlug: 'springfield' } })),
  };
  const prisma = {} as any;
  const redis = { publisher } as any;
  const ctrl = new SsoController(sso as any, prisma, redis);
  return { ctrl, sso, getExpected: () => capturedExpected };
}

function fakeReq(session: any, cookies: Record<string, string> = {}) {
  return { headers: { host: 'api.example', 'x-forwarded-proto': 'https' }, protocol: 'https', session, cookies } as any;
}
function fakeRes() {
  return { redirect: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn(), status: () => ({ json: () => {} }) } as any;
}
/** The browser-binding cookie a login response set, as the browser would send it back. */
function cookieFrom(res: any): Record<string, string> {
  const call = res.cookie.mock.calls.find((c: any[]) => c[0] === OIDC_BROWSER_COOKIE);
  return call ? { [OIDC_BROWSER_COOKIE]: call[1] } : {};
}

describe('SSO OIDC state is multi-replica safe (S9)', () => {
  it('carries login state via Redis to a callback on a fresh (different-replica) session', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl, sso, getExpected } = makeController(pub);

    // Replica A: login writes state to its session AND to Redis.
    const loginSession: any = {};
    const loginRes = fakeRes();
    await ctrl.oidcLogin('springfield', fakeReq(loginSession), loginRes);
    expect(loginSession.ssoOidcState).toBe('STATE-123');
    expect(pub.store.has('sso:oidc:state:STATE-123')).toBe(true);

    // Replica B: callback with an EMPTY session (MemoryStore didn't replicate).
    // Without the Redis mirror this would fail the state/nonce check.
    const callbackRes = fakeRes();
    await ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}, cookieFrom(loginRes)), callbackRes);

    const expected = getExpected();
    expect(expected.state).toBe('STATE-123');
    expect(expected.nonce).toBe('NONCE-456'); // came from Redis, not the empty session
    expect(sso.completeSsoLogin).toHaveBeenCalled();
    expect(callbackRes.redirect).toHaveBeenCalled();
  });

  it('the Redis state entry is single-use (deleted on first callback → replay finds nothing)', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl } = makeController(pub);

    const loginRes = fakeRes();
    await ctrl.oidcLogin('springfield', fakeReq({}), loginRes);
    expect(pub.store.has('sso:oidc:state:STATE-123')).toBe(true);

    await ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}, cookieFrom(loginRes)), fakeRes());
    // consumed
    expect(pub.store.has('sso:oidc:state:STATE-123')).toBe(false);

    // A replay on a fresh session now has no Redis record AND no session copy →
    // validateOidcCallback throws on missing state/nonce (fail-closed).
    await expect(
      ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}, cookieFrom(loginRes)), fakeRes()),
    ).rejects.toBeTruthy();
  });

  it('falls back to the session copy when Redis is unavailable (single-replica still works)', async () => {
    const { ctrl, getExpected } = makeController(null); // redis.publisher = null

    const session: any = {};
    await ctrl.oidcLogin('springfield', fakeReq(session), fakeRes());
    // No Redis, but the session carries it on the same replica.
    await ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq(session), fakeRes());

    expect(getExpected().state).toBe('STATE-123');
    expect(getExpected().nonce).toBe('NONCE-456');
  });
});

describe('SSO OIDC state is bound to the browser that started sign-in', () => {
  it('login sets a short-lived HttpOnly, SameSite=Lax cookie scoped to the SSO routes, and stores its nonce with the state', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl } = makeController(pub);
    const loginRes = fakeRes();
    await ctrl.oidcLogin('springfield', fakeReq({}), loginRes);

    const call = loginRes.cookie.mock.calls.find((c: any[]) => c[0] === OIDC_BROWSER_COOKIE);
    expect(call).toBeDefined();
    const [, value, opts] = call;
    expect(typeof value).toBe('string');
    expect(value.length).toBeGreaterThanOrEqual(16);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/v1/auth/sso' });
    expect(opts.maxAge).toBeGreaterThan(0);
    expect(opts.maxAge).toBeLessThanOrEqual(10 * 60 * 1000);

    const stored = JSON.parse(pub.store.get('sso:oidc:state:STATE-123')!);
    expect(stored).toMatchObject({ nonce: 'NONCE-456', tenantSlug: 'springfield', browserNonce: value });
  });

  it('the cookie is Secure in production', async () => {
    const saved = process.env.NODE_ENV;
    const savedBase = process.env.PUBLIC_API_BASE_URL;
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_API_BASE_URL = 'https://api.example';
    try {
      const { ctrl } = makeController(fakeRedisPublisher());
      const loginRes = fakeRes();
      await ctrl.oidcLogin('springfield', fakeReq({}), loginRes);
      const call = loginRes.cookie.mock.calls.find((c: any[]) => c[0] === OIDC_BROWSER_COOKIE);
      expect(call[2].secure).toBe(true);
    } finally {
      process.env.NODE_ENV = saved;
      if (savedBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = savedBase;
    }
  });

  it('refuses a callback from a browser that carries no binding cookie', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl, sso } = makeController(pub);
    await ctrl.oidcLogin('springfield', fakeReq({}), fakeRes());

    await expect(
      ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}), fakeRes()),
    ).rejects.toThrow(/different browser/);
    expect(sso.validateOidcCallback).not.toHaveBeenCalled();
    expect(sso.completeSsoLogin).not.toHaveBeenCalled();
  });

  it('refuses a callback whose binding cookie does not match the stored nonce', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl, sso } = makeController(pub);
    await ctrl.oidcLogin('springfield', fakeReq({}), fakeRes());

    await expect(
      ctrl.oidcCallback(
        'springfield',
        { code: 'abc', state: 'STATE-123' } as any,
        fakeReq({}, { [OIDC_BROWSER_COOKIE]: 'some-other-browser-nonce' }),
        fakeRes(),
      ),
    ).rejects.toThrow(/different browser/);
    expect(sso.completeSsoLogin).not.toHaveBeenCalled();
  });

  it('refuses a callback for a different tenant than the one the sign-in started for', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl, sso } = makeController(pub);
    const loginRes = fakeRes();
    await ctrl.oidcLogin('springfield', fakeReq({}), loginRes);

    await expect(
      ctrl.oidcCallback('shelbyville', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}, cookieFrom(loginRes)), fakeRes()),
    ).rejects.toThrow(/different organization/);
    expect(sso.completeSsoLogin).not.toHaveBeenCalled();
  });

  it('refuses a session-fallback callback for a different tenant', async () => {
    const { ctrl, sso } = makeController(null);
    const session: any = {};
    await ctrl.oidcLogin('springfield', fakeReq(session), fakeRes());

    await expect(
      ctrl.oidcCallback('shelbyville', { code: 'abc', state: 'STATE-123' } as any, fakeReq(session), fakeRes()),
    ).rejects.toThrow(/different organization/);
    expect(sso.completeSsoLogin).not.toHaveBeenCalled();
  });

  it('clears the binding cookie at the callback and keeps the existing redirect', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl } = makeController(pub);
    const loginRes = fakeRes();
    await ctrl.oidcLogin('springfield', fakeReq({}), loginRes);
    expect(loginRes.redirect).toHaveBeenCalledWith(302, 'https://idp.example/authorize?x=1');

    const cbRes = fakeRes();
    await ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}, cookieFrom(loginRes)), cbRes);
    expect(cbRes.clearCookie).toHaveBeenCalledWith(OIDC_BROWSER_COOKIE, expect.objectContaining({ path: '/api/v1/auth/sso' }));
    expect(cbRes.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/login/sso-complete#token=jwt-token'));
  });
});
