import { SsoController } from './sso.controller';

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

function fakeReq(session: any) {
  return { headers: { host: 'api.example', 'x-forwarded-proto': 'https' }, protocol: 'https', session } as any;
}
function fakeRes() {
  return { redirect: jest.fn(), status: () => ({ json: () => {} }) } as any;
}

describe('SSO OIDC state is multi-replica safe (S9)', () => {
  it('carries login state via Redis to a callback on a fresh (different-replica) session', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl, sso, getExpected } = makeController(pub);

    // Replica A: login writes state to its session AND to Redis.
    const loginSession: any = {};
    await ctrl.oidcLogin('springfield', fakeReq(loginSession), fakeRes());
    expect(loginSession.ssoOidcState).toBe('STATE-123');
    expect(pub.store.has('sso:oidc:state:STATE-123')).toBe(true);

    // Replica B: callback with an EMPTY session (MemoryStore didn't replicate).
    // Without the Redis mirror this would fail the state/nonce check.
    const callbackRes = fakeRes();
    await ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}), callbackRes);

    const expected = getExpected();
    expect(expected.state).toBe('STATE-123');
    expect(expected.nonce).toBe('NONCE-456'); // came from Redis, not the empty session
    expect(sso.completeSsoLogin).toHaveBeenCalled();
    expect(callbackRes.redirect).toHaveBeenCalled();
  });

  it('the Redis state entry is single-use (deleted on first callback → replay finds nothing)', async () => {
    const pub = fakeRedisPublisher();
    const { ctrl } = makeController(pub);

    await ctrl.oidcLogin('springfield', fakeReq({}), fakeRes());
    expect(pub.store.has('sso:oidc:state:STATE-123')).toBe(true);

    await ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}), fakeRes());
    // consumed
    expect(pub.store.has('sso:oidc:state:STATE-123')).toBe(false);

    // A replay on a fresh session now has no Redis record AND no session copy →
    // validateOidcCallback throws on missing state/nonce (fail-closed).
    await expect(
      ctrl.oidcCallback('springfield', { code: 'abc', state: 'STATE-123' } as any, fakeReq({}), fakeRes()),
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
