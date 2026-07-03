import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * INSET-SERIALIZATION REGRESSION — Rule #10, variant 3 (2026-07-03).
 *
 * See CLAUDE.md rule #10 (2026-07-03 entry) and
 * apps/web/tools/check-inset-serialization.cjs for the full background.
 * Short version: a React inline `style={{ position:'absolute', top:0,
 * right:0, bottom:0, left:X }}` object (all 4 physical sides, non-uniform,
 * `top` zero-leading) gets re-serialized by the browser's own CSSOM into the
 * `inset` SHORTHAND in the DOM `style` ATTRIBUTE string (`inset: 0px 0px 0px
 * Xpx`). That string's leading `"inset: 0"` collides with the
 * player/layout.tsx Chromium-83 polyfill's `[style*="inset: 0"]` selector,
 * which force-zeroes ALL FOUR sides (!important) — destroying the intended
 * offset. This is INVISIBLE to source-level grep (no file contains the word
 * "inset") and only reproducible by inspecting the real rendered DOM.
 *
 * THIS TEST proves the fix holds in a REAL BROWSER (not just that source no
 * longer matches a detector pattern): it boots the actual /player route with
 * the scorebug-themed TICKER (apps/web/src/components/widgets/themes/
 * scorebug.tsx `ScorebugTicker`, one of the confirmed-and-fixed landmines —
 * was `{ position:'absolute', left:'clamp(60px, 8vw, 140px)', right:0, top:0,
 * bottom:0 }`, now 3 sides + explicit `width`), WITH the real
 * player/layout.tsx polyfill `<style>` block active (it ships in every
 * /player render — this test does not stub it out), and asserts the
 * scrolling-reel element's measured `left` offset is the INTENDED ~60-140px
 * clamp value, not 0 (which is what the old 4-side object would have
 * collapsed to once the polyfill force-zeroed it).
 *
 * Run:
 *   pnpm --filter web exec playwright test inset-serialization-regression --project=chromium
 *   pnpm --filter web exec playwright test inset-serialization-regression --project=webkit
 */

const FAKE_SCREEN_ID = 'test-screen-inset-regress-01';
const FAKE_TENANT_ID = 'test-tenant-inset-regress-01';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-inset-regress';

function manifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [
      {
        id: 'pl-inset-regress',
        name: 'Inset Regression Grid',
        template: {
          id: 'tpl-inset-regress',
          name: 'Inset Regression Grid',
          screenWidth: 1920,
          screenHeight: 1080,
          bgColor: '#0f172a',
          zones: [
            {
              id: 'z-scorebug-ticker',
              name: 'Scorebug ticker (fixed landmine)',
              widgetType: 'TICKER',
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              zIndex: 0,
              defaultConfig: { theme: 'scorebug', messages: ['LIVE: Regression check 1-0'] },
            },
          ],
        },
        items: [],
      },
    ],
  };
}

async function installApiMocks(page: Page, counters: { manifestCalls: number }) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // Broadest catch-alls FIRST (Playwright matches last-registered-wins).
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', deviceToken: FAKE_DEVICE_TOKEN }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, (route) => {
    counters.manifestCalls += 1;
    return ok(route, manifest());
  });
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, (route) =>
    ok(route, { assets: [], setHash: 'empty-fake-hash' }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', tenantId: FAKE_TENANT_ID }),
  );
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/analytics/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/security/**', (route) => route.fulfill({ status: 204, body: '' }));
}

async function installPlayerTestHarness(page: Page) {
  await page.addInitScript(
    ({ deviceToken, fingerprint }) => {
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
      } catch {
        /* ignore */
      }
      const RealWS = window.WebSocket;
      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        if (!url.includes('/realtime')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return new (RealWS as any)(url, protocols);
        }
        const inst: Record<string, unknown> = {
          url,
          readyState: RealWS.CONNECTING,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send() {},
          close() {},
          addEventListener() {},
          removeEventListener() {},
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (typeof inst.onopen === 'function') (inst.onopen as (e: Event) => void).call(null, new Event('open'));
          setTimeout(() => {
            const authOk = {
              type: 'AUTH_OK',
              data: { deviceId: 'fake-device', expiresAt: Date.now() + 3600_000, serverTime: Date.now() },
              idempotencyKey: 'auth-ok-1',
              timestamp: Date.now(),
            };
            if (typeof inst.onmessage === 'function') {
              (inst.onmessage as (e: MessageEvent) => void).call(
                null,
                new MessageEvent('message', { data: JSON.stringify(authOk) }),
              );
            }
          }, 10);
        }, 5);
        return inst;
      }
      (StubWebSocket as unknown as Record<string, number>).CONNECTING = RealWS.CONNECTING;
      (StubWebSocket as unknown as Record<string, number>).OPEN = RealWS.OPEN;
      (StubWebSocket as unknown as Record<string, number>).CLOSING = RealWS.CLOSING;
      (StubWebSocket as unknown as Record<string, number>).CLOSED = RealWS.CLOSED;
      try {
        Object.defineProperty(window, 'WebSocket', { value: StubWebSocket, writable: true, configurable: true });
      } catch {
        (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;
      }
      class StubEventSource {
        url: string;
        readyState = 0;
        onopen: ((e: Event) => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        constructor(url: string) {
          this.url = url;
        }
        addEventListener() {}
        close() {}
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { deviceToken: FAKE_DEVICE_TOKEN, fingerprint: FAKE_FINGERPRINT },
  );
}

test.describe('Inset-serialization regression (Rule #10 variant 3)', () => {
  let counters: { manifestCalls: number };

  test.beforeEach(async ({ page }) => {
    counters = { manifestCalls: 0 };
    await installApiMocks(page, counters);
    await installPlayerTestHarness(page);
  });

  test('scorebug ticker reel keeps its left offset — the player/layout.tsx polyfill does not zero it', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);

    const zone = page.locator('[data-zone-id="z-scorebug-ticker"]');
    await zone.waitFor({ state: 'visible', timeout: 20_000 });

    // Real content proof — the ticker text is on the page, not a blank zone.
    await expect(page.locator('body')).toContainText('Regression check');

    // ── The regression assertion ──────────────────────────────────────
    // Find the "LIVE" pill (fixed-width, left:0) and the scrolling-reel
    // sibling (the one that used to be a 4-side non-uniform object). The
    // reel's box must start AFTER the pill ends — i.e. its measured
    // getBoundingClientRect().left must be >= the pill's width (60-140px
    // clamp), never 0. Pre-fix, the player/layout.tsx polyfill's
    // `[style*="inset: 0"]` selector would have matched the reel's
    // serialized `inset: 0px 0px 0px clamp(60px, 8vw, 140px)` attribute and
    // force-set `left: 0 !important` — collapsing the reel to start at the
    // same x as the pill (fully overlapping it).
    const geometry = await zone.evaluate((zoneEl) => {
      // The ticker root is the zone's single child; the LIVE pill and the
      // reel are its two children in DOM order (see ScorebugTicker JSX).
      const root = zoneEl.querySelector('[style*="overflow: hidden"]') || zoneEl.firstElementChild;
      const children = root ? Array.from(root.children) : [];
      const rects = children.map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const cs = getComputedStyle(el as HTMLElement);
        return { left: r.left, width: r.width, styleLeft: cs.left, styleAttr: (el as HTMLElement).getAttribute('style') };
      });
      const zoneRect = zoneEl.getBoundingClientRect();
      return { zoneLeft: zoneRect.left, children: rects };
    });

    expect(geometry.children.length).toBeGreaterThanOrEqual(2);
    const [pill, reel] = geometry.children;

    // The pill sits flush at the zone's left edge (its own style is
    // left:0/top:0/bottom:0 + explicit width — a SAFE 3-side object, never
    // touched by the polyfill).
    expect(Math.round(pill.left - geometry.zoneLeft)).toBe(0);

    // THE REGRESSION CHECK: the reel must start to the RIGHT of the pill —
    // its left offset (relative to the zone) must be >= 59px (clamp floor,
    // -1px rounding slack) and must NOT be 0 (which is what the polyfill
    // force-zero bug produced pre-fix).
    const reelLeftRelative = reel.left - geometry.zoneLeft;
    expect(reelLeftRelative).toBeGreaterThanOrEqual(59);
    // And it must not be sitting at the raw computed `left` CSS value 0 —
    // double-check the computed style directly too, independent of layout
    // rounding, to pin down the exact failure mode this test targets.
    expect(reel.styleLeft).not.toBe('0px');
  });
});
