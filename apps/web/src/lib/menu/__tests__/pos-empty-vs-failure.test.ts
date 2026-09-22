/**
 * AN EMPTY MENU IS DATA. A FAILED FETCH IS NOT.
 *
 * ── THE BUG (2026-09-11, audit finding W05) ───────────────────────────
 * Four independent layers collapsed "the POS answered, and the category is
 * empty" into the same value as "the POS could not be reached", and every one
 * of them then fell back to the last known good list:
 *
 *   device-menu.ts          `return mapped.length > 0 ? mapped : null`
 *   use-pos-menu-items.ts   `if (next && next.length > 0) setItems(next)`
 *   MenuBoardWidget.tsx     `posItems && posItems.length > 0 ? pos : static`
 *   WidgetRenderer.tsx      `if (liveMenu.length === 0) return`  (never posted)
 *
 * Net effect on a real counter: 86 the last item in a category, or empty it for
 * the day, and the board keeps showing yesterday's items — WITH THEIR PRICES —
 * until someone notices. A customer can order a thing that does not exist at a
 * price that is not current.
 *
 * ── THE CONTRACT THIS PINS ────────────────────────────────────────────
 *   null  → failure / not configured. Keep the last good list; on a first load,
 *           fall back to the operator's static items.
 *   []    → success, and the category really is empty. CLEAR the board.
 *   [...] → success. Show these.
 *
 * The distinction has to hold at every layer, because any single layer that
 * re-collapses it reinstates the bug on its own — which is exactly how this one
 * survived: fixing one or two of the four would have looked like a fix and
 * changed nothing on the glass.
 */
import { fetchDeviceMenu, menuSourceConfigured } from '../device-menu';

/**
 * The PLAYER path — the one that is actually on a wall.
 *
 * It only runs when a screen id AND a device token resolve, which in jsdom
 * means seeding localStorage. Without this block the suite exercises only the
 * dashboard-preview branch: a first version of this file did exactly that, and
 * re-introducing the bug in the player branch left every test GREEN. A test
 * that cannot fail on the code path that matters is decoration.
 */
describe('fetchDeviceMenu — PLAYER path (device-authed)', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    localStorage.setItem('edu_device_token', 'tok_test');
    localStorage.setItem('edu_manifest_cache_v1', JSON.stringify({ m: { screenId: 'scr_test' } }));
  });
  afterEach(() => { global.fetch = realFetch; localStorage.clear(); jest.restoreAllMocks(); });

  const withBody = (body: unknown, ok = true, status = 200) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok, status, json: async () => body,
    }) as unknown as typeof fetch;
    // The fallback must never be consulted on this path; if it is, fail loudly.
    return fetchDeviceMenu({}, async () => { throw new Error('session fallback must not run'); });
  };

  it('a 200 with an EMPTY list returns [] — the category is empty, not unreachable', async () => {
    await expect(withBody([])).resolves.toEqual([]);
  });

  it('distinguishes an unconfigured screen from a configured but empty menu', async () => {
    expect(menuSourceConfigured(await withBody({ sourceConfigured: false, items: [] }))).toBe(false);
    expect(menuSourceConfigured(await withBody({ sourceConfigured: true, items: [] }))).toBe(true);
  });

  it('a 200 with items returns them', async () => {
    const out = await withBody([{ name: 'Fries', price: '2.00' }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
  });

  it('passes Toast item identity, category, and product photo to the screen', async () => {
    const out = await withBody([{ externalId: 'toast-item-1', name: 'Birria Tacos', category: 'Tacos', priceCents: 1450, imageUrl: 'https://images.toasttab.com/birria.jpg' }]);
    expect(out?.[0]).toMatchObject({ externalId: 'toast-item-1', category: 'Tacos', name: 'Birria Tacos', price: '$14.50', imageUrl: 'https://images.toasttab.com/birria.jpg' });
  });

  it('a 200 with an empty { items: [] } envelope also returns []', async () => {
    await expect(withBody({ items: [] })).resolves.toEqual([]);
  });

  it('a non-404 error status returns null so the board keeps its last good list', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    await expect(
      fetchDeviceMenu({}, async () => { throw new Error('session fallback must not run'); }),
    ).resolves.toBeNull();
  });

  it('a network throw returns null', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(
      fetchDeviceMenu({}, async () => { throw new Error('session fallback must not run'); }),
    ).resolves.toBeNull();
  });
});

describe('fetchDeviceMenu — empty success is not failure', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  /** The dashboard-preview path (no player screen id / device token in jsdom). */
  const viaSession = (rows: unknown) =>
    fetchDeviceMenu({}, async () => rows as never);

  it('returns an ARRAY for a successful empty category, never null', async () => {
    await expect(viaSession([])).resolves.toEqual([]);
  });

  it('returns null when the response is not a list at all (malformed / failed)', async () => {
    await expect(viaSession(null)).resolves.toBeNull();
    await expect(viaSession({ error: 'boom' })).resolves.toBeNull();
  });

  it('returns null when the fetch throws — the caller must keep its last good list', async () => {
    await expect(
      fetchDeviceMenu({}, async () => { throw new Error('network down'); }),
    ).resolves.toBeNull();
  });

  it('maps a populated list', async () => {
    const out = await viaSession([{ name: 'Cheese Pizza', price: '3.50' }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
  });

  it('distinguishes empty from failure by IDENTITY, not by length', () => {
    // The regression in one line: every collapsed layer asked "is it long?"
    // when the question was "did it answer?". Anything that treats [] and null
    // alike is the bug, whatever it looks like.
    const empty: unknown[] | null = [];
    const failed: unknown[] | null = null;
    expect(Array.isArray(empty)).toBe(true);
    expect(Array.isArray(failed)).toBe(false);
    // The old test, which passed while the board lied:
    expect(Boolean(empty && empty.length > 0)).toBe(Boolean(failed && (failed as unknown[]).length > 0));
  });
});

/**
 * THE URL ITSELF (2026-09-12). Everything above mocked `fetch` and never
 * looked at what was requested — and the request was wrong in production:
 * `NEXT_PUBLIC_API_URL` ends in `/api/v1` and the player path appended a
 * second `/api/v1`, so every kiosk 404'd and fell back to static items. A
 * test that mocks the transport must still pin the address.
 */
describe('fetchDeviceMenu — PLAYER path requests the right address', () => {
  const realFetch = global.fetch; const realEnv = process.env.NEXT_PUBLIC_API_URL;
  beforeEach(() => {
    localStorage.setItem('edu_device_token', 'tok_test');
    localStorage.setItem('edu_manifest_cache_v1', JSON.stringify({ m: { screenId: 'scr_test' } }));
  });
  afterEach(() => { global.fetch = realFetch; process.env.NEXT_PUBLIC_API_URL = realEnv; localStorage.clear(); jest.restoreAllMocks(); });

  it('does not double the /api/v1 prefix when NEXT_PUBLIC_API_URL already carries it (the documented shape)', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test/api/v1';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchDeviceMenu({}, async () => { throw new Error('session fallback must not run'); });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe('https://api.example.test/api/v1/screens/scr_test/menu');
    expect(url).not.toContain('/api/v1/api/v1');
  });

  it('still works when the root is a bare origin', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchDeviceMenu({}, async () => { throw new Error('session fallback must not run'); });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.test/api/v1/screens/scr_test/menu');
  });
});
