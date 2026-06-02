/**
 * Shopify provider unit tests — proves the verified catalog mapping
 * (Shopify REST `/products.json` products+variants → our NormalizedItem/
 * Category) WITHOUT needing a live store. Mocks global.fetch with
 * Shopify-shaped payloads and asserts the normalization (dollar string →
 * integer cents, product_type → category, status/inventory → availability,
 * variant naming, shop requirement).
 *
 * This is the connector module's contract; the live OAuth flow is
 * exercised separately once a dev store + app credentials exist.
 */
import {
  shopifyFetchCatalog,
  shopifyAuthorizeUrl,
  shopifyApiVersion,
  shopifyHost,
  parseNextPageInfo,
} from './shopify';

describe('shopify provider — host + authorize URL', () => {
  const orig = process.env.SHOPIFY_CLIENT_ID;
  afterEach(() => { process.env.SHOPIFY_CLIENT_ID = orig; });

  it('normalizes the shop value to a canonical {shop}.myshopify.com host', () => {
    expect(shopifyHost('acme')).toBe('acme.myshopify.com');
    expect(shopifyHost('acme.myshopify.com')).toBe('acme.myshopify.com');
    expect(shopifyHost('https://acme.myshopify.com/')).toBe('acme.myshopify.com');
    expect(shopifyHost('ACME')).toBe('acme.myshopify.com');
    expect(shopifyHost('')).toBe('');
  });

  it('pins a stable REST Admin API version', () => {
    expect(shopifyApiVersion()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('builds the per-store authorize URL with comma-separated scope + state', () => {
    process.env.SHOPIFY_CLIENT_ID = 'client_abc';
    const url = shopifyAuthorizeUrl({
      state: 'nonce123',
      redirectUri: 'https://app.venueos.com/cb',
      shop: 'acme',
    });
    const u = new URL(url);
    expect(u.origin).toBe('https://acme.myshopify.com');
    expect(u.pathname).toBe('/admin/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('client_abc');
    expect(u.searchParams.get('scope')).toBe('read_products'); // default scope
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.venueos.com/cb');
    expect(u.searchParams.get('state')).toBe('nonce123');
  });

  it('throws if no shop is supplied to authorize', () => {
    expect(() => shopifyAuthorizeUrl({ state: 's', redirectUri: 'r', shop: '' }))
      .toThrow(/shop/i);
  });
});

describe('parseNextPageInfo — Link-header cursor extraction', () => {
  it('extracts page_info from a rel="next" Link header', () => {
    const link =
      '<https://acme.myshopify.com/admin/api/2026-01/products.json?page_info=NEXTCURSOR&limit=250>; rel="next"';
    expect(parseNextPageInfo(link)).toBe('NEXTCURSOR');
  });

  it('ignores rel="previous" and returns undefined when no next exists', () => {
    const link =
      '<https://acme.myshopify.com/admin/api/2026-01/products.json?page_info=PREVCURSOR&limit=250>; rel="previous"';
    expect(parseNextPageInfo(link)).toBeUndefined();
    expect(parseNextPageInfo(null)).toBeUndefined();
    expect(parseNextPageInfo('')).toBeUndefined();
  });

  it('picks next when both previous and next are present', () => {
    const link = [
      '<https://acme.myshopify.com/admin/api/2026-01/products.json?page_info=PREV&limit=250>; rel="previous"',
      '<https://acme.myshopify.com/admin/api/2026-01/products.json?page_info=NEXT&limit=250>; rel="next"',
    ].join(', ');
    expect(parseNextPageInfo(link)).toBe('NEXT');
  });
});

describe('shopifyFetchCatalog — normalization', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

  function mockProductsResponse(payload: any, linkHeader?: string) {
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'link' ? (linkHeader || null) : null) },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  }

  it('maps products+variants to NormalizedItem (dollar→cents, product_type→category, status/inventory→availability, variant naming)', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(mockProductsResponse({
      products: [
        {
          id: 111,
          title: 'Team Hoodie',
          product_type: 'Apparel',
          status: 'active',
          body_html: 'Cozy',
          updated_at: '2026-01-02T00:00:00Z',
          variants: [
            { id: 1, title: 'Small', price: '49.99', inventory_management: 'shopify', inventory_quantity: 5 },
            { id: 2, title: 'Large', price: '49.99', inventory_management: 'shopify', inventory_quantity: 0, inventory_policy: 'deny' },
          ],
        },
        {
          id: 222,
          title: 'Gift Card',
          product_type: '',                    // no category
          status: 'active',
          variants: [
            { id: 3, title: 'Default Title', price: '25.00', inventory_management: null },
          ],
        },
        {
          id: 333,
          title: 'Discontinued Mug',
          product_type: 'Drinkware',
          status: 'archived',                  // whole product unavailable
          variants: [
            { id: 4, title: 'Default Title', price: '12.50', inventory_management: 'shopify', inventory_quantity: 10 },
          ],
        },
      ],
    }));
    (global as any).fetch = fetchMock;

    const snap = await shopifyFetchCatalog('shpat_tok', { shop: 'acme' });

    // One REST call to the versioned products path on the shop host with Shopify auth header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('https://acme.myshopify.com/admin/api/');
    expect(calledUrl).toContain('/products.json');
    expect(calledUrl).toContain('limit=250');
    expect(fetchMock.mock.calls[0][1].headers['X-Shopify-Access-Token']).toBe('shpat_tok');

    // Dollar string → integer cents.
    const small = snap.items.find((i) => i.externalId === '111:1')!;
    expect(small.name).toBe('Team Hoodie / Small');     // "Product / Variant"
    expect(small.priceCents).toBe(4999);                // 49.99 → 4999 cents
    expect(small.categoryExternalId).toBe('Apparel');
    expect(small.category).toBe('Apparel');
    expect(small.available).toBe(true);                 // active + in stock

    // Tracked, zero stock, deny oversell → unavailable.
    const large = snap.items.find((i) => i.externalId === '111:2')!;
    expect(large.available).toBe(false);

    // Single "Default Title" variant → name is just the product title; untracked → available.
    const gift = snap.items.find((i) => i.externalId === '222:3')!;
    expect(gift.name).toBe('Gift Card');
    expect(gift.priceCents).toBe(2500);                 // 25.00 → 2500
    expect(gift.categoryExternalId).toBeUndefined();    // empty product_type → no category
    expect(gift.available).toBe(true);

    // Archived product → unavailable even with stock on hand.
    const mug = snap.items.find((i) => i.externalId === '333:4')!;
    expect(mug.priceCents).toBe(1250);                  // 12.50 → 1250
    expect(mug.available).toBe(false);

    // Categories synthesized from distinct non-empty product_type values.
    expect(snap.categories).toEqual([
      { externalId: 'Apparel', name: 'Apparel', sortOrder: 0 },
      { externalId: 'Drinkware', name: 'Drinkware', sortOrder: 1 },
    ]);
  });

  it('follows the Link-header page_info cursor across pages', async () => {
    const fetchMock = jest.fn()
      // page 1 → has a next cursor in the Link header
      .mockResolvedValueOnce(mockProductsResponse(
        { products: [{ id: 1, title: 'A', product_type: 'X', status: 'active', variants: [{ id: 10, title: 'Default Title', price: '1.00' }] }] },
        '<https://acme.myshopify.com/admin/api/2026-01/products.json?page_info=CURSOR2&limit=250>; rel="next"',
      ))
      // page 2 → no Link header → pagination stops
      .mockResolvedValueOnce(mockProductsResponse(
        { products: [{ id: 2, title: 'B', product_type: 'X', status: 'active', variants: [{ id: 20, title: 'Default Title', price: '2.00' }] }] },
      ));
    (global as any).fetch = fetchMock;

    const snap = await shopifyFetchCatalog('shpat_tok', { shop: 'acme.myshopify.com' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call carries the page_info token from page 1's Link header.
    expect(String(fetchMock.mock.calls[1][0])).toContain('page_info=CURSOR2');
    expect(snap.items.map((i) => i.name).sort()).toEqual(['A', 'B']);
  });

  it('requires a shop domain (captured during OAuth) — refuses to guess', async () => {
    (global as any).fetch = jest.fn();
    await expect(shopifyFetchCatalog('shpat_tok', {})).rejects.toThrow(/shop/i);
    await expect(shopifyFetchCatalog('shpat_tok')).rejects.toThrow(/shop/i);
  });
});
