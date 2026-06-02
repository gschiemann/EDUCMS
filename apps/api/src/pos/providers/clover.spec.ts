/**
 * Clover provider unit tests — proves the verified catalog mapping
 * (Clover v3 `/items` + `/categories` → our NormalizedItem/Category)
 * WITHOUT needing a live sandbox. Mocks global.fetch with Clover-shaped
 * payloads and asserts the normalization (price in cents, category
 * backfill, hidden → unavailable, merchantId requirement).
 *
 * This is the connector module's contract; the live OAuth flow is
 * exercised separately once sandbox credentials exist.
 */
import { cloverFetchCatalog, cloverApiBase, cloverAccountBase } from './clover';

describe('clover provider — environments', () => {
  const orig = process.env.CLOVER_ENV;
  afterEach(() => { process.env.CLOVER_ENV = orig; });

  it('uses sandbox hosts by default, prod hosts when CLOVER_ENV=production', () => {
    delete process.env.CLOVER_ENV;
    expect(cloverApiBase()).toBe('https://apisandbox.dev.clover.com');
    expect(cloverAccountBase()).toBe('https://sandbox.dev.clover.com');
    process.env.CLOVER_ENV = 'production';
    expect(cloverApiBase()).toBe('https://api.clover.com');
    expect(cloverAccountBase()).toBe('https://www.clover.com');
  });
});

describe('cloverFetchCatalog — normalization', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

  function mockJson(payload: any) {
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  }

  it('maps Clover items+categories to NormalizedItem/Category (cents, category backfill, hidden→unavailable)', async () => {
    const fetchMock = jest.fn()
      // 1st call → categories
      .mockResolvedValueOnce(mockJson({ elements: [{ id: 'cat1', name: 'Pizzas', sortOrder: 1 }] }))
      // 2nd call → items (with expanded categories)
      .mockResolvedValueOnce(mockJson({ elements: [
        { id: 'i1', name: 'Margherita', price: 1299, hidden: false, modifiedTime: 1700000000000, categories: { elements: [{ id: 'cat1', name: 'Pizzas' }] } },
        { id: 'i2', name: 'Back-of-house only', price: 500, hidden: true, categories: { elements: [] } },
      ] }));
    (global as any).fetch = fetchMock;

    const snap = await cloverFetchCatalog('tok_abc', { merchantId: 'M123' });

    // Two REST calls: categories then items, both under the merchant path.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v3/merchants/M123/categories');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/v3/merchants/M123/items');
    expect(String(fetchMock.mock.calls[1][0])).toContain('expand=categories');
    // Bearer auth.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok_abc');

    expect(snap.categories).toEqual([{ externalId: 'cat1', name: 'Pizzas', sortOrder: 1 }]);

    const m = snap.items.find((i) => i.externalId === 'i1')!;
    expect(m.name).toBe('Margherita');
    expect(m.priceCents).toBe(1299);           // cents passthrough
    expect(m.categoryExternalId).toBe('cat1');
    expect(m.category).toBe('Pizzas');          // name resolved from category
    expect(m.available).toBe(true);

    const hidden = snap.items.find((i) => i.externalId === 'i2')!;
    expect(hidden.available).toBe(false);       // hidden item → unavailable
  });

  it('requires a merchantId (captured during OAuth) — refuses to guess', async () => {
    (global as any).fetch = jest.fn();
    await expect(cloverFetchCatalog('tok_abc', {})).rejects.toThrow(/merchantId/i);
    await expect(cloverFetchCatalog('tok_abc')).rejects.toThrow(/merchantId/i);
  });
});
