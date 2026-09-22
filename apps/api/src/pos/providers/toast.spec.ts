import { normalizeToastMenus, parseToastCredentials, toastFetchCatalog, toastMenusChanged } from './toast';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const SHARED = '44444444-4444-4444-8444-444444444444';
const credentials = {
  clientId: 'client-id', clientSecret: 'secret-value', apiBaseUrl: 'https://ws-api.toasttab.com',
  restaurants: [{ guid: A, name: 'Calvine' }, { guid: B, name: 'Laguna Blvd' }],
};

function menu(price: number, include = true) {
  return { menus: [{ name: 'All Day', menuGroups: [{ guid: 'tacos', name: 'Tacos', menuItems: include ? [
    { guid: ITEM, multiLocationId: SHARED, name: '3 Birria Tacos', price, pricingStrategy: 'BASE_PRICE',
      visibility: ['POS'], image: 'https://images.toasttab.com/birria.jpg' },
    { guid: 'open-price', name: 'Market special', price: null, pricingStrategy: 'OPEN_PRICE', visibility: ['POS'] },
  ] : [] }] }] };
}

describe('Toast machine-client Menus V2 connector', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('rejects non-Toast hosts before credentials can be sent', () => {
    expect(() => parseToastCredentials({ ...credentials, apiBaseUrl: 'https://evil.example' })).toThrow(/toasttab.com/);
    expect(() => parseToastCredentials({ ...credentials, apiBaseUrl: 'http://ws-api.toasttab.com' })).toThrow(/HTTPS/);
  });

  it('normalizes resolved dollar prices to cents and omits open prices', () => {
    const result = normalizeToastMenus(menu(14.5), A);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ externalId: SHARED, priceCents: 1450, category: 'Tacos',
      imageUrl: 'https://images.toasttab.com/birria.jpg', locationPrices: [{ externalLocationId: A, priceCents: 1450 }] });
  });

  it('authenticates once and merges store-specific prices and availability', async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ token: { accessToken: 'token-123' } }))
      .mockResolvedValueOnce(response(menu(14.5)))
      .mockResolvedValueOnce(response(menu(15.25)));
    global.fetch = fetchMock as typeof fetch;
    const result = await toastFetchCatalog(credentials);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ws-api.toasttab.com/authentication/v1/authentication/login');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ clientId: 'client-id', clientSecret: 'secret-value', userAccessType: 'TOAST_MACHINE_CLIENT' });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer token-123', 'Toast-Restaurant-External-ID': A });
    expect(result.items[0].locationPrices).toEqual([
      { externalLocationId: A, priceCents: 1450, available: true },
      { externalLocationId: B, priceCents: 1525, available: true },
    ]);
  });

  it('marks an item missing from another restaurant unavailable there', async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ token: { accessToken: 'token-123' } }))
      .mockResolvedValueOnce(response(menu(14.5)))
      .mockResolvedValueOnce(response(menu(0, false))) as typeof fetch;
    const result = await toastFetchCatalog(credentials);
    expect(result.items[0].locationPrices).toContainEqual({ externalLocationId: B, available: false });
  });

  it('pairs same-named products across stores when Toast omits multiLocationId', async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const first = menu(14.5); const second = menu(15.25);
    delete (first.menus[0].menuGroups[0].menuItems[0] as any).multiLocationId;
    delete (second.menus[0].menuGroups[0].menuItems[0] as any).multiLocationId;
    second.menus[0].menuGroups[0].menuItems[0].guid = '55555555-5555-4555-8555-555555555555';
    global.fetch = jest.fn().mockResolvedValueOnce(response({ token: { accessToken: 'token-123' } }))
      .mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response(second)) as typeof fetch;
    const result = await toastFetchCatalog(credentials);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].locationPrices).toHaveLength(2);
  });

  it('checks each restaurant metadata and skips a full menu fetch when publication is unchanged', async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ token: { accessToken: 'token-123' } }))
      .mockResolvedValueOnce(response({ lastUpdated: '2026-09-21T10:00:00Z' }))
      .mockResolvedValueOnce(response({ lastUpdated: '2026-09-21T11:00:00Z' }));
    global.fetch = fetchMock as typeof fetch;
    expect(await toastMenusChanged(credentials, new Date('2026-09-21T12:00:00Z'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('https://ws-api.toasttab.com/menus/v2/metadata');
    expect(fetchMock.mock.calls[2][1].headers['Toast-Restaurant-External-ID']).toBe(B);
  });

  it('triggers a catalog refresh when one restaurant publishes a newer menu', async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ token: { accessToken: 'token-123' } }))
      .mockResolvedValueOnce(response({ lastUpdated: '2026-09-21T13:00:00Z' }));
    global.fetch = fetchMock as typeof fetch;
    expect(await toastMenusChanged(credentials, new Date('2026-09-21T12:00:00Z'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await toastMenusChanged(credentials, null)).toBe(true);
  });

  it('covers a publication that overlaps the end of a multi-store sync', async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ token: { accessToken: 'token-123' } }))
      .mockResolvedValueOnce(response({ lastUpdated: '2026-09-21T12:00:00Z' })) as typeof fetch;
    expect(await toastMenusChanged(credentials, new Date('2026-09-21T12:00:30Z'))).toBe(true);
  });
});
