/**
 * SocialOAuthController — the CSRF nonce and the public callback.
 *
 * The callback is the one endpoint here with no auth guard, so everything we
 * trust about the caller has to come from the server-side state record. These
 * tests pin exactly that:
 *
 *   • a replayed `state` is REFUSED (read-and-delete is single-use);
 *   • a nonce minted for one provider cannot be used at the other's callback;
 *   • the tenant/user written to the connection come from the STATE, never
 *     from the query string — a callback carrying `?tenantId=victim` changes
 *     nothing;
 *   • authorize 503s with a named env var when the deploy has no Meta keys;
 *   • one Facebook login creates ONE CONNECTION PER PAGE.
 *
 * The in-memory fallback path is exercised by passing a RedisService with no
 * publisher; the Redis path is exercised with a fake ioredis MULTI.
 */
import { SocialOAuthController } from './social-oauth.controller';
import { SocialService } from './social.service';

interface Row {
  [k: string]: any;
}

function makePrisma() {
  const connections: Row[] = [];
  const auditLogs: Row[] = [];
  let seq = 0;
  const matches = (row: Row, where: Row) =>
    Object.entries(where || {}).every(([k, v]) => row[k] === v);
  const socialProviderConnection = {
    findFirst: async ({ where }: any) =>
      connections.find((r) => matches(r, where)) || null,
    findMany: async ({ where }: any = {}) =>
      connections.filter((r) => matches(r, where || {})),
    create: async ({ data }: any) => {
      const row = { id: `conn-${++seq}`, createdAt: new Date(), ...data };
      connections.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = connections.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };
  const socialPost = {
    upsert: async () => ({}),
    findMany: async () => [],
  };
  const auditLog = {
    create: async ({ data }: any) => {
      auditLogs.push(data);
      return data;
    },
  };
  return {
    client: {
      socialProviderConnection,
      socialPost,
      auditLog,
      $transaction: async (fn: any) =>
        fn({ socialProviderConnection, socialPost, auditLog }),
    },
    _state: { connections, auditLogs },
  };
}

/** A RedisService with no publisher → the controller uses its in-process Map. */
const NO_REDIS = {} as any;

/** A RedisService whose publisher behaves like ioredis for SET/MULTI(GET,DEL). */
function fakeRedis() {
  const store = new Map<string, string>();
  const publisher = {
    set: async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    },
    multi() {
      const ops: Array<() => any> = [];
      const chain: any = {
        get(k: string) {
          ops.push(() => store.get(k) ?? null);
          return chain;
        },
        del(k: string) {
          ops.push(() => (store.delete(k) ? 1 : 0));
          return chain;
        },
        exec: async () => ops.map((fn) => [null, fn()]),
      };
      return chain;
    },
  };
  return { service: { publisher } as any, store };
}

function res() {
  const out: any = { redirectedTo: '' };
  out.redirect = (url: string) => {
    out.redirectedTo = url;
    return out;
  };
  return out;
}

const REQ = { protocol: 'https', headers: { host: 'api.example.com' } } as any;

const OLD_ENV = { ...process.env };
beforeEach(() => {
  process.env.INSTAGRAM_APP_ID = 'ig-id';
  process.env.INSTAGRAM_APP_SECRET = 'ig-secret';
  process.env.META_APP_ID = 'fb-id';
  process.env.META_APP_SECRET = 'fb-secret';
  process.env.DEVICE_SECRET_KEY = 'b'.repeat(64);
  process.env.WEB_PUBLIC_URL = 'https://app.example.com';
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

function reply(status: number, body: unknown) {
  return { status, text: async () => JSON.stringify(body) };
}

function build(redis: any = NO_REDIS) {
  const prisma = makePrisma();
  const svc = new SocialService(prisma as any);
  const ctl = new SocialOAuthController(svc, redis);
  return { prisma, svc, ctl };
}

/** Drive authorize and pull the `state` back out of the URL it returns. */
async function authorizeAndGetState(
  ctl: SocialOAuthController,
  provider: 'instagram' | 'facebook',
  user = { tenantId: 'tenant-a', id: 'user-1' },
) {
  const { url } = await ctl.authorize({ ...REQ, user }, provider);
  return { url, state: new URL(url).searchParams.get('state')! };
}

describe('authorize', () => {
  it('503s with the NAMED missing env var when the deploy has no keys', async () => {
    delete process.env.INSTAGRAM_APP_ID;
    delete process.env.INSTAGRAM_APP_SECRET;
    const { ctl } = build();
    expect.assertions(3);
    try {
      await ctl.authorize(
        { ...REQ, user: { tenantId: 't', id: 'u' } },
        'instagram',
      );
    } catch (err: any) {
      expect(err.getStatus()).toBe(503);
      expect(err.getResponse().code).toBe('SOCIAL_OAUTH_NOT_CONFIGURED');
      expect(err.getResponse().missing).toEqual([
        'INSTAGRAM_APP_ID',
        'INSTAGRAM_APP_SECRET',
      ]);
    }
  });

  it('400s on an unknown provider rather than building a URL for it', async () => {
    const { ctl } = build();
    await expect(
      ctl.authorize({ user: { tenantId: 't', id: 'u' } }, 'tiktok'),
    ).rejects.toMatchObject({ response: { code: 'SOCIAL_PROVIDER_UNKNOWN' } });
  });

  it('mints a long random state and puts the callback URL in the redirect_uri', async () => {
    const { ctl } = build();
    const { url, state } = await authorizeAndGetState(ctl, 'instagram');
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/api/v1/integrations/social/oauth/instagram/callback',
    );
  });

  it('never mints the same state twice', async () => {
    const { ctl } = build();
    const a = await authorizeAndGetState(ctl, 'instagram');
    const b = await authorizeAndGetState(ctl, 'instagram');
    expect(a.state).not.toBe(b.state);
  });
});

describe('callback — CSRF state', () => {
  function mockInstagramHandshake(svc: SocialService) {
    svc.fetchImpl = async (url: string) => {
      if (url.includes('api.instagram.com/oauth/access_token')) {
        return reply(200, { access_token: 'short', user_id: '178414' });
      }
      if (url.includes('graph.instagram.com/access_token')) {
        return reply(200, { access_token: 'long', expires_in: 5184000 });
      }
      if (
        url.includes('/me?') ||
        url.includes('/me&') ||
        /\/me$/.test(new URL(url).pathname)
      ) {
        return reply(200, { id: '178414', username: 'sunnyside' });
      }
      return reply(200, { data: [] });
    };
  }

  it('accepts a fresh nonce and creates the connection from the STATE, not the query', async () => {
    const { ctl, svc, prisma } = build();
    mockInstagramHandshake(svc);
    const { state } = await authorizeAndGetState(ctl, 'instagram');
    const r = res();
    await ctl.callback(REQ, r, 'instagram', {
      code: 'CODE',
      state,
      // A forged tenant on the public callback must change nothing.
      tenantId: 'tenant-victim',
    } as any);
    expect(r.redirectedTo).toContain('social=connected');
    expect(prisma._state.connections).toHaveLength(1);
    expect(prisma._state.connections[0].tenantId).toBe('tenant-a');
    expect(prisma._state.connections[0].createdByUserId).toBe('user-1');
    expect(prisma._state.connections[0].displayName).toBe('@sunnyside');
  });

  it('REFUSES a replayed nonce — the second callback creates nothing', async () => {
    const { ctl, svc, prisma } = build();
    mockInstagramHandshake(svc);
    const { state } = await authorizeAndGetState(ctl, 'instagram');

    const first = res();
    await ctl.callback(REQ, first, 'instagram', { code: 'CODE', state } as any);
    expect(first.redirectedTo).toContain('social=connected');
    expect(prisma._state.connections).toHaveLength(1);

    const replay = res();
    await ctl.callback(REQ, replay, 'instagram', {
      code: 'CODE',
      state,
    } as any);
    expect(replay.redirectedTo).toContain('reason=expired-state-token');
    expect(prisma._state.connections).toHaveLength(1); // still ONE
  });

  it('REFUSES a replayed nonce on the Redis path too (MULTI GET+DEL is single-use)', async () => {
    const redis = fakeRedis();
    const { ctl, svc, prisma } = build(redis.service);
    mockInstagramHandshake(svc);
    const { state } = await authorizeAndGetState(ctl, 'instagram');
    expect(redis.store.size).toBe(1);

    await ctl.callback(REQ, res(), 'instagram', { code: 'CODE', state } as any);
    expect(redis.store.size).toBe(0); // consumed

    const replay = res();
    await ctl.callback(REQ, replay, 'instagram', {
      code: 'CODE',
      state,
    } as any);
    expect(replay.redirectedTo).toContain('reason=expired-state-token');
    expect(prisma._state.connections).toHaveLength(1);
  });

  it('refuses a nonce that was never issued', async () => {
    const { ctl } = build();
    const r = res();
    await ctl.callback(REQ, r, 'instagram', {
      code: 'CODE',
      state: 'made-up',
    } as any);
    expect(r.redirectedTo).toContain('reason=expired-state-token');
  });

  it('refuses an Instagram nonce presented at the Facebook callback', async () => {
    const { ctl } = build();
    const { state } = await authorizeAndGetState(ctl, 'instagram');
    const r = res();
    await ctl.callback(REQ, r, 'facebook', { code: 'CODE', state } as any);
    expect(r.redirectedTo).toContain('reason=provider-mismatch');
  });

  it('refuses a callback with no code', async () => {
    const { ctl } = build();
    const { state } = await authorizeAndGetState(ctl, 'instagram');
    const r = res();
    await ctl.callback(REQ, r, 'instagram', { state } as any);
    expect(r.redirectedTo).toContain('reason=missing-code-or-state');
  });

  it('reflects an unknown provider as the literal "unknown", never as the raw segment', async () => {
    const { ctl } = build();
    const r = res();
    await ctl.callback(REQ, r, '../../evil', { code: 'C', state: 'S' } as any);
    expect(r.redirectedTo).toBe(
      'https://app.example.com/connect/unknown/done?status=error&social=error&reason=unknown-provider',
    );
  });

  it('sends the operator back with an error (never a 500) when the exchange fails', async () => {
    const { ctl, svc, prisma } = build();
    svc.fetchImpl = async () =>
      reply(400, { error: { type: 'OAuthException', code: 100 } });
    const { state } = await authorizeAndGetState(ctl, 'instagram');
    const r = res();
    await ctl.callback(REQ, r, 'instagram', { code: 'BAD', state } as any);
    expect(r.redirectedTo).toContain('reason=connect-failed');
    expect(prisma._state.connections).toHaveLength(0);
  });
});

describe('callback — Facebook Pages', () => {
  it('creates ONE connection per administered Page, each with its own token', async () => {
    const { ctl, svc, prisma } = build();
    svc.fetchImpl = async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/oauth/access_token')) {
        return reply(200, {
          access_token:
            u.searchParams.get('grant_type') === 'fb_exchange_token'
              ? 'long'
              : 'short',
        });
      }
      if (u.pathname.endsWith('/me/accounts')) {
        return reply(200, {
          data: [
            { id: '111', name: 'Sunnyside Cafe', access_token: 'page-tok-1' },
            { id: '333', name: 'Second Location', access_token: 'page-tok-3' },
          ],
        });
      }
      return reply(200, { data: [] });
    };
    const { state } = await authorizeAndGetState(ctl, 'facebook');
    const r = res();
    await ctl.callback(REQ, r, 'facebook', { code: 'CODE', state } as any);

    expect(r.redirectedTo).toContain('social=connected');
    expect(r.redirectedTo).toContain('accounts=2');
    expect(prisma._state.connections).toHaveLength(2);
    expect(
      prisma._state.connections.map((c: Row) => c.accountId).sort(),
    ).toEqual(['111', '333']);
    // Facebook Page tokens do not expire — so the refresh path must be off.
    for (const c of prisma._state.connections) expect(c.expiresAt).toBeNull();
  });

  it('tells the operator honestly when the login administers no Pages', async () => {
    const { ctl, svc, prisma } = build();
    svc.fetchImpl = async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/oauth/access_token'))
        return reply(200, { access_token: 'tok' });
      return reply(200, { data: [] });
    };
    const { state } = await authorizeAndGetState(ctl, 'facebook');
    const r = res();
    await ctl.callback(REQ, r, 'facebook', { code: 'CODE', state } as any);
    expect(r.redirectedTo).toContain('reason=no-pages-found');
    expect(prisma._state.connections).toHaveLength(0);
  });
});
