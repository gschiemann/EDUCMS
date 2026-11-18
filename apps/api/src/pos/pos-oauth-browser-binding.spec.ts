/**
 * POS OAuth — the public callback is bound to the browser that started the
 * flow: /authorize sets a short-lived HttpOnly nonce cookie and stores the
 * nonce with the state; /callback refuses unless they match.
 */
jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return { ...actual, safeFetchPost: jest.fn() };
});

import { PosOAuthController } from './pos-oauth.controller';
import { safeFetchPost } from '../branding/safe-fetch';
import { PosStoreAlreadyConnectedError } from './pos.service';

const mockedPost = safeFetchPost as jest.MockedFunction<typeof safeFetchPost>;
const COOKIE = 'venueos_pos_oauth';

function makeRes() {
  const res: any = { cookies: {} as Record<string, { value: string; opts: any }>, cleared: [] as string[] };
  res.redirect = jest.fn((url: string) => {
    res.location = url;
    return res;
  });
  res.cookie = jest.fn((name: string, value: string, opts: any) => {
    res.cookies[name] = { value, opts };
    return res;
  });
  res.clearCookie = jest.fn((name: string) => {
    res.cleared.push(name);
    return res;
  });
  return res;
}

const baseReq: any = { protocol: 'https', headers: { host: 'api.test' } };

/** Minimal Redis double: SET + MULTI(GET, DEL). */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    publisher: {
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
      multi() {
        const ops: Array<() => unknown> = [];
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
    },
  };
}

describe('POS OAuth browser binding', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_API_BASE', 'NODE_ENV'];
  let svc: any;

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.SHOPIFY_CLIENT_ID = 'cid';
    process.env.SHOPIFY_CLIENT_SECRET = 'platform-secret';
    delete process.env.SHOPIFY_API_BASE;
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({ status: 200, body: JSON.stringify({ access_token: 'tok', scope: 'read_products' }) } as any);
    svc = {
      upsertConnection: jest.fn().mockResolvedValue({ id: 'conn' }),
      syncConnection: jest.fn().mockResolvedValue(undefined),
    };
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function start(redis: any = { publisher: null }) {
    const controller = new PosOAuthController({} as any, svc, {} as any, redis);
    const authRes = makeRes();
    const authReq: any = { ...baseReq, user: { tenantId: 't1', id: 'u1' }, session: {} };
    const { url } = await controller.authorize(authReq, 'shopify-pos', 'a.myshopify.com', authRes);
    const state = new URL(url).searchParams.get('state')!;
    return { controller, authRes, authReq, state, nonce: authRes.cookies[COOKIE]?.value as string };
  }

  it('authorize sets an HttpOnly, path-scoped, short-lived nonce cookie', async () => {
    const { authRes, nonce } = await start();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const opts = authRes.cookies[COOKIE].opts;
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe('/api/v1/pos/oauth');
    expect(opts.maxAge).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(['lax', 'none']).toContain(opts.sameSite);
  });

  it('production cookie is Secure', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_API_BASE_URL = 'https://api.test';
    try {
      const { authRes } = await start();
      expect(authRes.cookies[COOKIE].opts.secure).toBe(true);
    } finally {
      delete process.env.PUBLIC_API_BASE_URL;
    }
  });

  it('a callback from the same browser (matching cookie) connects', async () => {
    const { controller, state, nonce } = await start();
    const res = makeRes();
    await controller.callback({ ...baseReq, cookies: { [COOKIE]: nonce } } as any, res, 'shopify-pos', {
      code: 'c',
      state,
      shop: 'a.myshopify.com',
    });
    expect(res.location).toContain('status=ok');
    expect(svc.upsertConnection).toHaveBeenCalledTimes(1);
    expect(res.cleared).toContain(COOKIE);
  });

  it('a callback from a browser with no nonce is refused before any token exchange', async () => {
    const { controller, state } = await start();
    const res = makeRes();
    await controller.callback({ ...baseReq } as any, res, 'shopify-pos', { code: 'c', state, shop: 'a.myshopify.com' });
    expect(res.location).toContain('status=error');
    expect(res.location).toContain('browser-mismatch');
    expect(mockedPost).not.toHaveBeenCalled();
    expect(svc.upsertConnection).not.toHaveBeenCalled();
  });

  it('a callback carrying a different nonce is refused (Redis path too)', async () => {
    const redis = fakeRedis();
    const { controller, state } = await start(redis);
    const res = makeRes();
    await controller.callback({ ...baseReq, cookies: { [COOKIE]: 'someone-elses-nonce' } } as any, res, 'shopify-pos', {
      code: 'c',
      state,
      shop: 'a.myshopify.com',
    });
    expect(res.location).toContain('browser-mismatch');
    expect(svc.upsertConnection).not.toHaveBeenCalled();
  });

  it('a store already connected to another tenant is reported clearly', async () => {
    const { controller, state, nonce } = await start();
    svc.upsertConnection.mockRejectedValueOnce(new PosStoreAlreadyConnectedError('Shopify'));
    const res = makeRes();
    await controller.callback({ ...baseReq, cookies: { [COOKIE]: nonce } } as any, res, 'shopify-pos', {
      code: 'c',
      state,
      shop: 'a.myshopify.com',
    });
    expect(res.location).toContain('status=error');
    expect(res.location).toContain('reason=store-already-connected-to-another-organization');
  });

  it('the express-session copy is accepted when the cookie was not stored', async () => {
    const { controller, state, authReq } = await start();
    const res = makeRes();
    await controller.callback({ ...baseReq, session: authReq.session } as any, res, 'shopify-pos', {
      code: 'c',
      state,
      shop: 'a.myshopify.com',
    });
    expect(res.location).toContain('status=ok');
    expect(authReq.session.posOAuthNonce).toBeUndefined();
  });
});
