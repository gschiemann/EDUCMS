import { test, expect, type Page, type Route, type FrameLocator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
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
 *   • a SIBLING frame on the same screen (a WEBPAGE zone showing a third-party
 *     page) cannot spoof the board's words or prices — only the parent's posts
 *     land (2026-09-23, EDUCMS-SHIM-V7 + VOS-LIVE-MENU check `e.source`)
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

/** The same zone as a board kept BEFORE EDUCMS-SHIM-V7 has it: the last V6 ever baked, byte for byte. */
const LAST_V6 = (JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/educms-shim-v6-bodies.json'), 'utf8'),
) as { bodies: Array<{ body: string }> }).bodies.slice(-1)[0].body;
const KEPT_BEFORE_V7_CONFIG = {
  ...KEPT_ZONE_CONFIG,
  html: String(KEPT_ZONE_CONFIG.html).replace(/<script>\/\*EDUCMS-SHIM-V\d+\*\/[\s\S]*?<\/script>/, () => `<script>${LAST_V6}</script>`),
};

function manifest(extraZones: unknown[] = [], boardConfig: Record<string, unknown> = KEPT_ZONE_CONFIG) {
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
          zones: [{ id: 'z-board', name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 0, defaultConfig: boardConfig }, ...extraZones],
        },
        items: [],
      },
    ],
  };
}

type DeviceItem = { externalId: string; name: string; priceCents: number; category?: string; description?: string; available: boolean };
type MenuState = { status: 200; items: DeviceItem[] } | { status: 500 };
type PlayerState = {
  menu: MenuState;
  menuCalls: string[];
  manifestCalls: number;
  extraZones?: unknown[];
  boardConfig?: Record<string, unknown>;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function installApiMocks(page: Page, state: PlayerState) {
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
    return ok(route, manifest(state.extraZones, state.boardConfig));
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
 * The page a WEBPAGE zone shows, standing in for ANY third-party page: the
 * player frames it through /proxy/web with `allow-scripts`, so its own JS runs
 * right next to the board. Every 150 ms it posts a spoof to every OTHER frame
 * of the player — an unbound field's words, an image, a sold-out row with a
 * one-cent price, and edit mode — then tells the player page (its parent) how
 * many frames it reached, so the test can prove the spoof really went out.
 */
const SPOOF = 'SPOOFED BY A SIBLING';
const ATTACKER_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><p>Third-party specials</p><script>
(function(){
  var OVERRIDES={type:'educms-overrides',
    text:{'menu.title':'${SPOOF}'},
    img:{'rail.image':'https://evil.example/spoof.png'},
    pos:{v:1,rows:[{slot:'item.0',row:'0',s:'soldout',t:{name:'${SPOOF}',price:'$0.01'}}],fields:[]}};
  function run(){var reached=0;try{for(var i=0;i<parent.frames.length;i++){var f=parent.frames[i];if(f===window)continue;
    try{f.postMessage(OVERRIDES,'*');f.postMessage({type:'educms-edit-mode',on:true},'*');reached++;}catch(e){}}
    parent.postMessage({type:'e2e-sibling-spoofed',reached:reached},'*');}catch(e){}}
  run();setInterval(run,150);
})();
</script></body></html>`;

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

async function bootPlayer(
  page: Page,
  browserName: string,
  state: PlayerState,
  // Extra routes, registered AFTER the catch-alls so they win (last registered is matched first).
  extraRoutes?: (page: Page) => Promise<void>,
): Promise<FrameLocator> {
  await installApiMocks(page, state);
  if (extraRoutes) await extraRoutes(page);
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

  // THE HOLE (2026-09-23). Every frame on a player page can reach every other
  // one through `parent.frames[i]`, and both board runtimes — the baked edit
  // shim and VOS-LIVE-MENU — applied `educms-overrides` from ANY sender. The
  // one legitimate sender is the board's parent (the player's own
  // ExternalHtmlWidget), so since EDUCMS-SHIM-V7 that is the only one heard —
  // on a board kept today AND on one saved with V6 (swapped to V7 at render).
  for (const variant of [
    { name: 'a board kept today', config: KEPT_ZONE_CONFIG },
    { name: 'a board kept before V7', config: KEPT_BEFORE_V7_CONFIG },
  ]) test(`a sibling frame on the same screen cannot spoof ${variant.name} — the parent’s posts still land`, async ({ page, browserName }) => {
    const state: PlayerState = {
      menu: { status: 200, items: LIVE_ITEMS },
      menuCalls: [],
      manifestCalls: 0,
      boardConfig: variant.config,
      extraZones: [{
        id: 'z-web', name: 'third-party page', widgetType: 'WEBPAGE',
        x: 70, y: 0, width: 30, height: 30, zIndex: 1,
        defaultConfig: { url: 'https://third-party.example/specials' },
      }],
    };
    const proxied: string[] = [];
    // What the third-party page reports to the player page (its parent).
    await page.addInitScript(() => {
      const w = window as unknown as { __spoofReports: number[] };
      w.__spoofReports = [];
      window.addEventListener('message', (e) => {
        const d = e.data as { type?: string; reached?: number } | null;
        if (d && d.type === 'e2e-sibling-spoofed') w.__spoofReports.push(Number(d.reached) || 0);
      });
    });
    const board = await bootPlayer(page, browserName, state, async (p) => {
      await p.route(/\/api\/v1\/proxy\/web\?/, (route) => {
        proxied.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: ATTACKER_PAGE });
      });
    });

    // The parent's post landed: live prices, and the old token resolved.
    await expect(field(board, 'item.0.price')).toHaveText('$16.50', { timeout: 20_000 });
    await expect(field(board, 'header.series')).toHaveText('3 Birria Tacos');
    // What runs in the frame is V7 either way (a saved V6 is swapped at render).
    const saved = String(variant.config.html).match(/\/\*(EDUCMS-SHIM-V\d+)\*\//)?.[1];
    expect(saved).toBe(variant.config === KEPT_ZONE_CONFIG ? 'EDUCMS-SHIM-V7' : 'EDUCMS-SHIM-V6');
    expect(await board.locator('script').evaluateAll((els) =>
      els.map((e) => (e.textContent || '').slice(0, 18)).filter((s) => s.indexOf('/*EDUCMS-SHIM-') === 0),
    )).toEqual(['/*EDUCMS-SHIM-V7*/']);

    // The sibling is really there and really spoofing — it reached another frame…
    await expect.poll(
      () => page.evaluate(() => Math.max(0, ...(window as unknown as { __spoofReports: number[] }).__spoofReports)),
      { message: 'the third-party page never ran', timeout: 20_000 },
    ).toBeGreaterThanOrEqual(1);
    expect(proxied[0]).toContain(encodeURIComponent('https://third-party.example/specials'));
    // …and its messages ARRIVE in the board's window, from a source that is not the board's parent.
    await field(board, 'menu.title').evaluate(() => {
      const w = window as unknown as { __rx: Array<{ fromParent: boolean; type: string }> };
      w.__rx = [];
      window.addEventListener('message', (e) => {
        const d = e.data as { type?: string } | null;
        w.__rx.push({ fromParent: e.source === window.parent, type: String(d && d.type) });
      });
    });
    await expect.poll(
      () => field(board, 'menu.title').evaluate(() =>
        (window as unknown as { __rx: Array<{ fromParent: boolean; type: string }> }).__rx
          .filter((m) => !m.fromParent && m.type === 'educms-overrides').length),
      { message: 'no spoof ever reached the board window', timeout: 10_000 },
    ).toBeGreaterThan(3);

    // Under a sustained spoof the glass stays the parent's, sample after sample:
    // its own words, the live price, no sold-out grey, no foreign image, no edit mode.
    const read = () => board.locator('body').evaluate(() => {
      const q = (k: string) => (document.querySelector(`[data-field="${k}"]`)?.textContent || '').trim();
      const rail = document.querySelector('[data-imgslot="rail.image"]') as HTMLElement | null;
      const title = document.querySelector('[data-field="menu.title"]') as HTMLElement | null;
      return {
        title: q('menu.title'),
        name0: q('item.0.name'),
        price0: q('item.0.price'),
        row0: document.querySelector('[data-menu-row="0"]')?.getAttribute('data-vos-lm') ?? null,
        rail: rail ? `${rail.getAttribute('data-img') || ''}|${rail.style.backgroundImage}` : '',
        cursor: title ? title.style.cursor : '',
      };
    });
    const ownTitle = (await read()).title;
    expect(ownTitle).toBeTruthy();
    expect(ownTitle).not.toContain(SPOOF);
    for (let i = 0; i < 8; i++) {
      expect(await read()).toEqual({
        title: ownTitle,
        name0: '3 Birria Tacos',
        price0: '$16.50',
        row0: null,
        rail: expect.not.stringContaining('evil.example'),
        cursor: '',
      });
      await page.waitForTimeout(150);
    }

    // And the parent is still heard while the spoof runs: a POS price change
    // reaches the glass on the next menu poll.
    state.menu = { status: 200, items: [{ ...LIVE_ITEMS[0], priceCents: 1725 }, LIVE_ITEMS[1], LIVE_ITEMS[2]] };
    const calls = state.menuCalls.length;
    await nextPoll(page, browserName);
    await expect.poll(() => state.menuCalls.length, { timeout: POLL_WAIT }).toBeGreaterThan(calls);
    await expect(field(board, 'item.0.price')).toHaveText('$17.25', { timeout: POLL_WAIT });
    expect((await read()).title).toBe(ownTitle);
    expect(await board.locator('body').innerText()).not.toContain(SPOOF);
  });
});
