/**
 * V-1 (launch security re-audit, 2026-10-11) — the POS OAuth callback must
 * never let its (public, unauthenticated) query override the store host that
 * was validated and bound to the signed state at /authorize, and the provider
 * modules must refuse any store value that is not the vendor's own host —
 * because that host receives our PLATFORM client secret.
 */
jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return { ...actual, safeFetchPost: jest.fn() };
});

import { PosOAuthController } from './pos-oauth.controller';
import { safeFetchPost } from '../branding/safe-fetch';
import { shopifyHost } from './providers/shopify';
import { lightspeedApiBase } from './providers/lightspeed';
import { isAllowedVendorTokenHost } from './providers/vendor-post';

const mockedPost = safeFetchPost as jest.MockedFunction<typeof safeFetchPost>;

function makeRes() {
  const res: any = {};
  res.redirect = jest.fn((url: string) => {
    res.location = url;
    return res;
  });
  return res;
}

const req: any = { protocol: 'https', headers: { host: 'api.test' } };

describe('V-1 POS OAuth callback store host', () => {
  const realFetch = global.fetch;
  let fetchSpy: jest.Mock;
  let controller: PosOAuthController;
  let svc: any;
  const envKeys = ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'LIGHTSPEED_CLIENT_ID', 'LIGHTSPEED_CLIENT_SECRET', 'SHOPIFY_API_BASE', 'LIGHTSPEED_API_BASE'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.SHOPIFY_CLIENT_ID = 'cid';
    process.env.SHOPIFY_CLIENT_SECRET = 'platform-secret';
    process.env.LIGHTSPEED_CLIENT_ID = 'cid';
    process.env.LIGHTSPEED_CLIENT_SECRET = 'platform-secret';
    delete process.env.SHOPIFY_API_BASE;
    delete process.env.LIGHTSPEED_API_BASE;
    fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({ status: 200, body: JSON.stringify({ access_token: 'tok', scope: 'read_products' }) });
    svc = {
      upsertConnection: jest.fn().mockResolvedValue({ id: 'conn' }),
      syncConnection: jest.fn().mockResolvedValue(undefined),
    };
    controller = new PosOAuthController({} as any, svc, {} as any, { publisher: null } as any);
  });

  afterEach(() => {
    (global as any).fetch = realFetch;
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function callback(provider: string, storeIdAtAuthorize: string | undefined, query: Record<string, string>) {
    await (controller as any).putState('st', { tenantId: 't1', userId: 'u1', provider, storeId: storeIdAtAuthorize });
    const res = makeRes();
    await controller.callback(req, res, provider, { code: 'c', state: 'st', ...query });
    return res;
  }

  it.each([
    'evil.example',
    'a.myshopify.com.evil.example',
    'a.myshopify.com@evil.example',
    'b.myshopify.com',
  ])('Shopify: shop=%s on the callback cannot override the state-bound shop', async (shop) => {
    const res = await callback('shopify-pos', 'a.myshopify.com', { shop });
    expect(res.location).toContain('status=error');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(svc.upsertConnection).not.toHaveBeenCalled();
  });

  it('Shopify: the matching shop echoed back proceeds, and the token POST goes to the bound host via the SSRF-safe POST', async () => {
    const res = await callback('shopify-pos', 'a.myshopify.com', { shop: 'a.myshopify.com' });
    expect(res.location).toContain('status=ok');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(String(mockedPost.mock.calls[0][0])).toBe('https://a.myshopify.com/admin/oauth/access_token');
  });

  it.each(['evil.example/x?', 'evil.example', 'a@b', 'a:443', 'a#b'])(
    'Lightspeed: domain_prefix=%s is refused before any request',
    async (prefix) => {
      const res = await callback('lightspeed-retail', undefined, { domain_prefix: prefix });
      expect(res.location).toContain('status=error');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockedPost).not.toHaveBeenCalled();
    },
  );

  it('Lightspeed: a single-label prefix proceeds through the SSRF-safe POST to the vendor host', async () => {
    mockedPost.mockResolvedValue({ status: 200, body: JSON.stringify({ access_token: 'tok', domain_prefix: 'acme' }) });
    const res = await callback('lightspeed-retail', undefined, { domain_prefix: 'acme' });
    expect(res.location).toContain('status=ok');
    expect(String(mockedPost.mock.calls[0][0])).toBe('https://acme.retail.lightspeed.app/api/1.0/token');
  });
});

describe('V-1 provider host validators (point of use)', () => {
  it.each(['a.b', 'a/b', 'a?b', 'a#b', 'a@b', 'a:443', 'evil.example', 'a.myshopify.com.evil.example', 'a.myshopify.com@evil.example'])(
    'shopifyHost refuses %s',
    (v) => {
      expect(() => shopifyHost(v)).toThrow();
    },
  );

  it.each(['a.b', 'a/b', 'a?b', 'a#b', 'a@b', 'a:443', 'evil.example/x?'])('lightspeedApiBase refuses %s', (v) => {
    expect(() => lightspeedApiBase({ domainPrefix: v })).toThrow();
  });

  it('vendor allowlist accepts only the vendor hosts', () => {
    expect(isAllowedVendorTokenHost('acme.myshopify.com')).toBe(true);
    expect(isAllowedVendorTokenHost('acme.retail.lightspeed.app')).toBe(true);
    expect(isAllowedVendorTokenHost('evil.example')).toBe(false);
    expect(isAllowedVendorTokenHost('acme.myshopify.com.evil.example')).toBe(false);
  });
});
