/**
 * Lightspeed Retail X-Series provider unit tests — proves the verified
 * catalog mapping (X-Series 2.0 `/products` + `/product_categories` → our
 * NormalizedItem/Category) WITHOUT needing a live retailer. Mocks
 * global.fetch with X-Series-shaped payloads and asserts the normalization
 * (decimal dollars → integer cents, category resolve, deleted/inactive →
 * unavailable, per-retailer host, domainPrefix requirement).
 *
 * This is the connector module's contract; the live OAuth flow is exercised
 * separately once a retailer's domain_prefix + credentials exist.
 */
import {
  lightspeedFetchCatalog,
  lightspeedApiBase,
  lightspeedAuthorizeUrl,
  lightspeedEnv,
} from './lightspeed';

describe('lightspeed provider — host + env helpers', () => {
  const origEnv = process.env.LIGHTSPEED_ENV;
  const origClient = process.env.LIGHTSPEED_CLIENT_ID;
  afterEach(() => {
    process.env.LIGHTSPEED_ENV = origEnv;
    process.env.LIGHTSPEED_CLIENT_ID = origClient;
  });

  it('builds the per-retailer host from the domainPrefix', () => {
    expect(lightspeedApiBase({ domainPrefix: 'acme' })).toBe('https://acme.retail.lightspeed.app');
  });

  it('throws if the domainPrefix is missing when building a host', () => {
    expect(() => lightspeedApiBase({})).toThrow(/domainPrefix/i);
    expect(() => lightspeedApiBase({ domainPrefix: '' })).toThrow(/domainPrefix/i);
  });

  it('env is informational only (does not change the host) and defaults to production', () => {
    delete process.env.LIGHTSPEED_ENV;
    expect(lightspeedEnv()).toBe('production');
    process.env.LIGHTSPEED_ENV = 'sandbox';
    expect(lightspeedEnv()).toBe('sandbox');
    // Host is keyed only off the retailer prefix — env never alters it.
    expect(lightspeedApiBase({ domainPrefix: 'acme' })).toBe('https://acme.retail.lightspeed.app');
  });

  it('authorize URL targets the fixed secure host with code flow + state', () => {
    process.env.LIGHTSPEED_CLIENT_ID = 'cid_123';
    const url = new URL(
      lightspeedAuthorizeUrl({ state: 'xyz', redirectUri: 'https://app.test/cb' }),
    );
    expect(url.origin).toBe('https://secure.retail.lightspeed.app');
    expect(url.pathname).toBe('/connect');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid_123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('scope')).toBe('products:read');
  });
});

describe('lightspeedFetchCatalog — normalization', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    (global as any).fetch = realFetch;
    jest.restoreAllMocks();
  });

  function mockJson(payload: any) {
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  }

  it('maps X-Series products+categories to NormalizedItem/Category (dollars→cents, category resolve, deleted/inactive→unavailable)', async () => {
    const fetchMock = jest
      .fn()
      // 1st call → product_categories page (then an empty page stops it)
      .mockResolvedValueOnce(
        mockJson({ data: [{ id: 'cat1', name: 'Beverages' }], version: { min: 1, max: 9 } }),
      )
      .mockResolvedValueOnce(mockJson({ data: [], version: { min: 0, max: 0 } }))
      // 2nd round → products page (then an empty page stops it)
      .mockResolvedValueOnce(
        mockJson({
          data: [
            {
              id: 'p1',
              name: 'Cold Brew',
              price_including_tax: 4.5,
              price_excluding_tax: 4.0,
              product_category: { id: 'cat1', name: 'Beverages' },
              active: true,
              is_active: true,
              deleted_at: null,
              updated_at: '2026-05-01T12:00:00Z',
            },
            {
              id: 'p2',
              name: 'Discontinued Mug',
              price_including_tax: 9.99,
              product_category: { id: 'cat2', name: 'Merch' },
              deleted_at: '2026-04-02T00:00:00Z',
            },
            {
              id: 'p3',
              name: 'Hidden Item',
              price_including_tax: 1.25,
              active: false,
            },
          ],
          version: { min: 10, max: 42 },
        }),
      )
      .mockResolvedValueOnce(mockJson({ data: [], version: { min: 0, max: 0 } }));
    (global as any).fetch = fetchMock;

    const snap = await lightspeedFetchCatalog('tok_abc', { domainPrefix: 'acme' });

    // Categories fetched under the per-retailer host + 2.0 path; products too.
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://acme.retail.lightspeed.app/api/2.0/product_categories',
    );
    const productsCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/api/2.0/products'),
    )!;
    expect(String(productsCall[0])).toContain('https://acme.retail.lightspeed.app/api/2.0/products');
    // Bearer auth.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok_abc');

    expect(snap.categories).toEqual([{ externalId: 'cat1', name: 'Beverages', sortOrder: 0 }]);

    const cb = snap.items.find((i) => i.externalId === 'p1')!;
    expect(cb.name).toBe('Cold Brew');
    expect(cb.priceCents).toBe(450); // 4.50 dollars → 450 cents (tax-inclusive preferred)
    expect(cb.categoryExternalId).toBe('cat1');
    expect(cb.category).toBe('Beverages');
    expect(cb.available).toBe(true);

    const deleted = snap.items.find((i) => i.externalId === 'p2')!;
    expect(deleted.priceCents).toBe(999); // 9.99 → 999
    expect(deleted.available).toBe(false); // deleted_at set → unavailable
    expect(deleted.category).toBe('Merch'); // resolved from inline product_category

    const hidden = snap.items.find((i) => i.externalId === 'p3')!;
    expect(hidden.available).toBe(false); // active:false → unavailable
  });

  it('paginates products via the version cursor (after = previous version.max)', async () => {
    const fetchMock = jest
      .fn()
      // categories: one then empty
      .mockResolvedValueOnce(mockJson({ data: [{ id: 'c', name: 'C' }], version: { min: 1, max: 5 } }))
      .mockResolvedValueOnce(mockJson({ data: [], version: {} }))
      // products page 1 (full-ish), page 2 then empty
      .mockResolvedValueOnce(
        mockJson({ data: [{ id: 'a', name: 'A', price_including_tax: 1 }], version: { min: 1, max: 100 } }),
      )
      .mockResolvedValueOnce(
        mockJson({ data: [{ id: 'b', name: 'B', price_including_tax: 2 }], version: { min: 101, max: 200 } }),
      )
      .mockResolvedValueOnce(mockJson({ data: [], version: {} }));
    (global as any).fetch = fetchMock;

    const snap = await lightspeedFetchCatalog('tok', { domainPrefix: 'shop' });

    const productCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/2.0/products'),
    );
    // First products call has NO after; the second carries after=100 (prev max).
    expect(productCalls[0][0]).not.toContain('after=');
    expect(String(productCalls[1][0])).toContain('after=100');
    expect(snap.items.map((i) => i.externalId).sort()).toEqual(['a', 'b']);
  });

  it('requires a domainPrefix (captured during OAuth) — refuses to guess', async () => {
    (global as any).fetch = jest.fn();
    await expect(lightspeedFetchCatalog('tok_abc', {})).rejects.toThrow(/domainPrefix/i);
    await expect(lightspeedFetchCatalog('tok_abc')).rejects.toThrow(/domainPrefix/i);
  });
});
