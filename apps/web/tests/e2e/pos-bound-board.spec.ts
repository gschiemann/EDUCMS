import { test, expect, type Page, type Route, type FrameLocator } from '@playwright/test';
import { keptPosZoneConfig } from '../fixtures/kept-pos-board';

/**
 * POS-BOUND AI BOARD ON THE PLAYER — POS-A (2026-09-23), chromium + webkit.
 *
 * Greg: "…ensures the template is created with perfect integrations into those
 * systems." A kept POS-bound AI board used to show the prices it was generated
 * with, forever — nothing applied the live menu to it. This boots the REAL
 * /player route (production build, every API call intercepted — the harness of
 * widget-render.spec.ts) with ONE template: the exact zone `create-designer`
 * saves for a POS-bound AI board, its HTML cut from the PRODUCER (the fixture
 * through the API's own sanitize → bind → keep re-bind → edit shim → fit
 * engine). The screen's menu comes from a stateful mock of
 * GET /screens/:id/menu (the device endpoint), and a change in the "POS"
 * reaches the glass on the next 30-second menu poll with no republish, exactly
 * as on a wall — Chromium jumps to that poll with the page clock; WebKit waits
 * for the real one (see nextPoll), so its two change tests take ~31 s each.
 *
 * Asserted INSIDE the board (the sandboxed srcdoc frame), in both engines:
 *   • a price change repaints, and a later change repaints again on the next poll
 *   • a renamed item repaints its name and still fits its card
 *   • sold out → "Sold out", the row greyed, the price at full strength, the name struck
 *   • removed from the menu → "Not available", the name kept
 *   • no menu (the endpoint fails) → the saved snapshot
 *   • never a literal {{pos.item:…}} token on the glass
 */

const FAKE_SCREEN_ID = 'test-screen-000000000000';
const FAKE_TENANT_ID = 'test-tenant-000000000000';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-pos-bound';

const KEPT_ZONE_CONFIG = keptPosZoneConfig({
  // A token an older builder saved on a board field: it must resolve, and with
  // no menu it must fall back to the board's own words — never show itself.
  textOverrides: { 'header.series': '{{pos.item:birria.name}}' },
});

function manifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [
      {
        id: 'pl-pos-bound',
        name: 'POS-bound AI board',
        template: {
          id: 'tpl-pos-bound',
          name: 'Super Taco — AI board',
          screenWidth: 3840,
          screenHeight: 2160,
          bgColor: '#000000',
          zones: [{ id: 'z-board', name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 0, defaultConfig: KEPT_ZONE_CONFIG }],
        },
        items: [],
      },
    ],
  };
}

type DeviceItem = { externalId: string; name: string; priceCents: number; category?: string; description?: string; available: boolean };
type MenuState = { status: 200; items: DeviceItem[] } | { status: 500 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function installApiMocks(page: Page, state: { menu: MenuState; menuCalls: string[]; manifestCalls: number }) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  // Broad catch-alls FIRST (Playwright matches the last registered route first).
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, headers: CORS, body: '' }));
  await page.route(/ipapi\.co\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 204, headers: CORS, body: '' }));
  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', deviceToken: FAKE_DEVICE_TOKEN }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, (route) => {
    state.manifestCalls += 1;
    return ok(route, manifest());
  });
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, (route) => ok(route, { assets: [], setHash: 'empty-fake-hash' }));
  await page.route(/\/api\/v1\/screens\/status\//, (route) => ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', tenantId: FAKE_TENANT_ID }));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  // THE SCREEN'S MENU — the device endpoint, answered from test state.
  await page.route(new RegExp(`/api/v1/screens/${FAKE_SCREEN_ID}/menu`), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    state.menuCalls.push(route.request().url());
    const m = state.menu;
    if (m.status === 500) return route.fulfill({ status: 500, headers: CORS, body: 'upstream down' });
    return ok(route, { screenId: FAKE_SCREEN_ID, tenantId: FAKE_TENANT_ID, sourceConfigured: true, categories: [], items: m.items });
  });
}

async function installPlayerTestHarness(page: Page) {
  await page.addInitScript(
    ({ deviceToken, fingerprint, screenId }) => {
      const w = window as unknown as Record<string, unknown>;
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
      } catch { /* ignore */ }
      // device-menu.ts resolves the screen id from the URL, the cached
      // manifest, or this hook — the hook makes the FIRST menu fetch
      // deterministic (the manifest cache is written by the player later).
      w.__VENUEOS_SCREEN_ID__ = screenId;
      const RealWS = window.WebSocket;
      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!url.includes('/realtime')) return new (RealWS as any)(url, protocols);
        const inst: Record<string, unknown> = {
          url, readyState: RealWS.CONNECTING, onopen: null, onmessage: null, onerror: null, onclose: null,
          send() {}, close() { (this as { readyState: number }).readyState = RealWS.CLOSED; },
          addEventListener() {}, removeEventListener() {},
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (typeof inst.onopen === 'function') (inst.onopen as (e: Event) => void).call(null, new Event('open'));
          setTimeout(() => {
            const authOk = { type: 'AUTH_OK', data: { deviceId: 'fake-device', expiresAt: Date.now() + 3600_000, serverTime: Date.now() }, idempotencyKey: 'auth-ok-1', timestamp: Date.now() };
            if (typeof inst.onmessage === 'function') (inst.onmessage as (e: MessageEvent) => void).call(null, new MessageEvent('message', { data: JSON.stringify(authOk) }));
          }, 10);
        }, 5);
        return inst;
      }
      (StubWebSocket as unknown as Record<string, number>).CONNECTING = RealWS.CONNECTING;
      (StubWebSocket as unknown as Record<string, number>).OPEN = RealWS.OPEN;
      (StubWebSocket as unknown as Record<string, number>).CLOSING = RealWS.CLOSING;
      (StubWebSocket as unknown as Record<string, number>).CLOSED = RealWS.CLOSED;
      try { Object.defineProperty(window, 'WebSocket', { value: StubWebSocket, writable: true, configurable: true }); } catch { (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket; }
      class StubEventSource {
        url: string; readyState = 0;
        onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: Event) => void) | null = null;
        constructor(url: string) { this.url = url; }
        addEventListener() {} close() {}
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { deviceToken: FAKE_DEVICE_TOKEN, fingerprint: FAKE_FINGERPRINT, screenId: FAKE_SCREEN_ID },
  );
}

const LIVE_ITEMS: DeviceItem[] = [
  { externalId: 'birria', name: '3 Birria Tacos', priceCents: 1650, category: 'Tacos', available: true },
  { externalId: 'asada', name: 'Asada Super Burrito', priceCents: 1799, category: 'Burritos', available: true },
  { externalId: 'horchata', name: 'Horchata', priceCents: 350, category: 'Drinks', available: true },
];

/**
 * The next 30-s menu poll. Chromium: the page clock jumps straight to it. WebKit:
 * Playwright cannot install its clock inside a sandboxed about:srcdoc frame
 * (the board), and `fastForward` then throws — so WebKit waits for the REAL
 * poll, and every assertion after a state change allows for it (POLL_WAIT).
 */
const POLL_WAIT = 45_000;
async function nextPoll(page: Page, browserName: string): Promise<void> {
  if (browserName !== 'webkit') await page.clock.fastForward(31_000);
}

async function bootPlayer(page: Page, browserName: string, state: { menu: MenuState; menuCalls: string[]; manifestCalls: number }): Promise<FrameLocator> {
  await installApiMocks(page, state);
  await installPlayerTestHarness(page);
  if (browserName !== 'webkit') await page.clock.install();
  await page.goto('/player?fp=' + FAKE_FINGERPRINT, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => state.manifestCalls, { message: 'player never fetched the manifest', timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const board = page.frameLocator('iframe[title="AI-designed signage board"]');
  await expect(board.locator('[data-field="item.0.name"]')).toBeAttached({ timeout: 30_000 });
  return board;
}

const field = (board: FrameLocator, key: string) => board.locator(`[data-field="${key}"]`).first();

test.describe('a kept POS-bound AI board on the player', () => {
  test.setTimeout(150_000);

  test('prices repaint from the live menu — and follow a change on the next poll, with no republish', async ({ page, browserName }) => {
    const state = { menu: { status: 200, items: LIVE_ITEMS } as MenuState, menuCalls: [] as string[], manifestCalls: 0 };
    const board = await bootPlayer(page, browserName, state);
    await expect(field(board, 'item.0.price')).toHaveText('$16.50', { timeout: 20_000 });
    await expect(field(board, 'item.1.price')).toHaveText('$17.99');
    await expect(field(board, 'item.2.price')).toHaveText('$3.50');
    // The device endpoint, for THIS screen, with sold-out items included.
    expect(state.menuCalls[0]).toMatch(new RegExp(`/api/v1/screens/${FAKE_SCREEN_ID}/menu\\?`));
    expect(state.menuCalls[0]).toContain('includeUnavailable=1');
    expect(state.menuCalls[0]).toContain('connectionId=conn-toast');
    // The old token on a board field resolves to the live name — never itself.
    await expect(field(board, 'header.series')).toHaveText('3 Birria Tacos');

    // The POS changes a price and renames an item. Next poll (30 s) → the glass.
    state.menu = {
      status: 200,
      items: [
        { ...LIVE_ITEMS[0], priceCents: 1725, name: '3 Birria Tacos with Consomé, Onion, Cilantro & Lime' },
        LIVE_ITEMS[1],
        LIVE_ITEMS[2],
      ],
    };
    const calls = state.menuCalls.length;
    await nextPoll(page, browserName);
    await expect.poll(() => state.menuCalls.length, { timeout: POLL_WAIT }).toBeGreaterThan(calls);
    await expect(field(board, 'item.0.price')).toHaveText('$17.25', { timeout: POLL_WAIT });
    await expect(field(board, 'item.0.name')).toHaveText('3 Birria Tacos with Consomé, Onion, Cilantro & Lime');

    // The long new name was re-fitted into its card — it does not run past it.
    const fit = await field(board, 'item.0.name').evaluate((el) => {
      const card = el.closest('[data-menu-row]') as HTMLElement;
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const rects = Array.from(rg.getClientRects()).filter((r) => r.width > 1 || r.height > 1);
      const right = Math.max(...rects.map((r) => r.right));
      const left = Math.min(...rects.map((r) => r.left));
      const c = card.getBoundingClientRect();
      return { overflowRight: right - c.right, overflowLeft: c.left - left };
    });
    expect(fit.overflowRight).toBeLessThanOrEqual(2);
    expect(fit.overflowLeft).toBeLessThanOrEqual(2);
    expect(await board.locator('body').innerText()).not.toContain('{{pos.item');
  });

  test('sold out → "Sold out", the row greyed, the price at full strength, the name struck', async ({ page, browserName }) => {
    const state = {
      menu: { status: 200, items: [LIVE_ITEMS[0], LIVE_ITEMS[1], { ...LIVE_ITEMS[2], available: false }] } as MenuState,
      menuCalls: [] as string[],
      manifestCalls: 0,
    };
    const board = await bootPlayer(page, browserName, state);
    await expect(field(board, 'item.2.price')).toHaveText('Sold out', { timeout: 20_000 });
    await expect(board.locator('[data-menu-row="2"]')).toHaveAttribute('data-vos-lm', 'soldout');
    const looks = await board.locator('[data-menu-row="2"]').evaluate((row) => {
      const name = row.querySelector('[data-field="item.2.name"]') as HTMLElement;
      const price = row.querySelector('[data-field="item.2.price"]') as HTMLElement;
      return {
        nameOpacity: getComputedStyle(name).opacity,
        nameDecoration: getComputedStyle(name).textDecorationLine,
        priceOpacity: getComputedStyle(price).opacity,
      };
    });
    expect(Number(looks.nameOpacity)).toBeCloseTo(0.4, 2);
    expect(looks.nameDecoration).toContain('line-through');
    expect(Number(looks.priceOpacity)).toBe(1);
    // Its neighbours are untouched.
    await expect(board.locator('[data-menu-row="0"]')).not.toHaveAttribute('data-vos-lm', /.*/);

    // Back in stock on the next poll → the grey comes off, the price comes back.
    state.menu = { status: 200, items: LIVE_ITEMS };
    await nextPoll(page, browserName);
    await expect(field(board, 'item.2.price')).toHaveText('$3.50', { timeout: POLL_WAIT });
    await expect(board.locator('[data-menu-row="2"]')).not.toHaveAttribute('data-vos-lm', /.*/);
  });

  test('an item removed from the menu → "Not available", its name kept', async ({ page, browserName }) => {
    const state = { menu: { status: 200, items: [LIVE_ITEMS[0], LIVE_ITEMS[2]] } as MenuState, menuCalls: [] as string[], manifestCalls: 0 };
    const board = await bootPlayer(page, browserName, state);
    await expect(field(board, 'item.1.price')).toHaveText('Not available', { timeout: 20_000 });
    await expect(field(board, 'item.1.name')).toHaveText('Asada Super Burrito');
    await expect(board.locator('[data-menu-row="1"]')).toHaveAttribute('data-vos-lm', 'missing');
    await expect(field(board, 'item.0.price')).toHaveText('$16.50');
  });

  test('no menu (the endpoint fails) → the saved snapshot, never a token', async ({ page, browserName }) => {
    const state = { menu: { status: 500 } as MenuState, menuCalls: [] as string[], manifestCalls: 0 };
    const board = await bootPlayer(page, browserName, state);
    await expect.poll(() => state.menuCalls.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(field(board, 'item.0.price')).toHaveText('$15.25');
    await expect(field(board, 'item.1.price')).toHaveText('$17.50');
    await expect(field(board, 'item.2.price')).toHaveText('$3.25');
    await expect(field(board, 'header.series')).not.toContainText('pos.item');
    expect(await board.locator('body').innerText()).not.toContain('{{pos.item');
    await expect(board.locator('[data-vos-lm]')).toHaveCount(0);
  });
});
