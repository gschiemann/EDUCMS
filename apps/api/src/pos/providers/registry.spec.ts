/**
 * POS connector registry — contract + Square-regression tests (2026-06-02).
 *
 * The keystone that made Clover / Shopify / Lightspeed self-serve rewrote
 * the SHARED connect+sync path that Square's live pilot depends on. These
 * tests lock the two things that path relies on:
 *
 *   1. Square's behaviour is UNCHANGED — its authorize URL still points at
 *      Square's OAuth host with the same params (the registry only changed
 *      HOW we call it, not WHAT it produces).
 *   2. Every provider id in @cms/api-types resolves to a connector with the
 *      exact contract flags pos.service + pos-oauth.controller branch on
 *      (envPrefix, callbackStoreIdParam, needsStoreIdAtAuthorize, refreshable)
 *      — and the store-id normalization maps each provider's native id
 *      (merchantId / domainPrefix / shop) onto the generic `storeId`.
 *
 * No network: authorize URLs are pure string builders; exchangeCode is
 * exercised with a mocked fetch.
 */
import { POS_CONNECTORS, getConnector } from './registry';

describe('POS connector registry — resolution', () => {
  it('resolves every DIRECT OAuth provider id from @cms/api-types', () => {
    // These are the exact ids stored on a PosProviderConnection row.
    expect(getConnector('square')).toBeTruthy();
    expect(getConnector('clover')).toBeTruthy();
    expect(getConnector('lightspeed-retail')).toBeTruthy();
    expect(getConnector('shopify-pos')).toBeTruthy();
  });

  it('returns null for providers without an OAuth connector', () => {
    expect(getConnector('custom-webhook')).toBeNull();
    expect(getConnector('aloha-ncr')).toBeNull();
    expect(getConnector('definitely-not-a-provider')).toBeNull();
  });
});

describe('POS connector registry — connect-flow contract', () => {
  it('square: storeId is on the token (no callback param), refreshable', () => {
    const c = POS_CONNECTORS.square;
    expect(c.envPrefix).toBe('SQUARE');
    expect(c.callbackStoreIdParam).toBeNull();
    expect(c.needsStoreIdAtAuthorize).toBe(false);
    expect(c.refreshable).toBe(true);
  });

  it('clover: merchant_id on the callback query, refreshable', () => {
    const c = POS_CONNECTORS.clover;
    expect(c.envPrefix).toBe('CLOVER');
    expect(c.callbackStoreIdParam).toBe('merchant_id');
    expect(c.needsStoreIdAtAuthorize).toBe(false);
    expect(c.refreshable).toBe(true);
  });

  it('lightspeed-retail: domain_prefix on the callback query, refreshable', () => {
    const c = POS_CONNECTORS['lightspeed-retail'];
    expect(c.envPrefix).toBe('LIGHTSPEED');
    expect(c.callbackStoreIdParam).toBe('domain_prefix');
    expect(c.needsStoreIdAtAuthorize).toBe(false);
    expect(c.refreshable).toBe(true);
  });

  it('shopify-pos: shop known at authorize, NOT refreshable (offline token)', () => {
    const c = POS_CONNECTORS['shopify-pos'];
    expect(c.envPrefix).toBe('SHOPIFY');
    expect(c.callbackStoreIdParam).toBe('shop');
    expect(c.needsStoreIdAtAuthorize).toBe(true);
    expect(c.refreshable).toBe(false);
  });
});

describe('Square authorize URL — regression (behaviour unchanged through the registry)', () => {
  const orig = { id: process.env.SQUARE_CLIENT_ID, env: process.env.SQUARE_ENV };
  beforeEach(() => { process.env.SQUARE_CLIENT_ID = 'sq-client-123'; delete process.env.SQUARE_ENV; });
  afterEach(() => {
    if (orig.id === undefined) delete process.env.SQUARE_CLIENT_ID; else process.env.SQUARE_CLIENT_ID = orig.id;
    if (orig.env === undefined) delete process.env.SQUARE_ENV; else process.env.SQUARE_ENV = orig.env;
  });

  it('still points at Square OAuth with client_id, state, redirect_uri + default scopes', () => {
    const url = POS_CONNECTORS.square.authorizeUrl({
      state: 'nonce-abc',
      redirectUri: 'https://api.example.com/api/v1/pos/oauth/square/callback',
    });
    expect(url).toContain('connect.squareupsandbox.com/oauth2/authorize');
    expect(url).toContain('client_id=sq-client-123');
    expect(url).toContain('state=nonce-abc');
    // redirect_uri is URL-encoded in the query string.
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('square%2Fcallback');
    // Square's `+`-separated scopes (not %2B) — the historical quirk.
    expect(url).toContain('scope=MERCHANT_PROFILE_READ+ITEMS_READ+INVENTORY_READ');
  });
});

describe('Shopify authorize URL — per-shop host (storeId carried from authorize)', () => {
  const orig = process.env.SHOPIFY_CLIENT_ID;
  beforeEach(() => { process.env.SHOPIFY_CLIENT_ID = 'shop-client-1'; });
  afterEach(() => { if (orig === undefined) delete process.env.SHOPIFY_CLIENT_ID; else process.env.SHOPIFY_CLIENT_ID = orig; });

  it('builds the authorize URL on the supplied shop domain', () => {
    const url = POS_CONNECTORS['shopify-pos'].authorizeUrl({
      state: 'nonce-xyz',
      redirectUri: 'https://api.example.com/api/v1/pos/oauth/shopify-pos/callback',
      storeId: 'acme.myshopify.com',
    });
    expect(url).toContain('acme.myshopify.com');
    expect(url).toContain('/admin/oauth/authorize');
    expect(url).toContain('client_id=shop-client-1');
    expect(url).toContain('state=nonce-xyz');
  });
});

describe('store-id normalization — provider native id → generic storeId', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

  it('clover exchangeCode threads merchantId → token.storeId', async () => {
    process.env.CLOVER_CLIENT_ID = 'cl-id';
    process.env.CLOVER_CLIENT_SECRET = 'cl-secret';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok', refresh_token: 'ref', access_token_expiration: 0 }),
      text: async () => '',
    });
    const token = await POS_CONNECTORS.clover.exchangeCode({
      code: 'auth-code',
      redirectUri: 'https://api.example.com/api/v1/pos/oauth/clover/callback',
      storeId: 'MERCHANT-42',
    });
    expect(token.accessToken).toBe('tok');
    expect(token.refreshToken).toBe('ref');
    // The generic storeId the connection row + fetchCatalog rely on.
    expect(token.storeId).toBe('MERCHANT-42');
  });
});
