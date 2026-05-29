import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'fs';

/**
 * SCOREBOARD SCREENSHOT HARNESS (dev-only verification, not a CI gate).
 *
 * Boots the REAL /player route with a fully-mocked API (modeled on
 * widget-render.spec.ts) carrying a single full-bleed scoreboard zone,
 * then screenshots the rendered component at native 1920×1080 so the
 * React port can be compared side-by-side with the approved mockup
 * (scratch/design/scoreboards/{hs,college,pro}.png).
 *
 * Run one tier:  TIER=hs pnpm --filter web exec playwright test scoreboard-shot --project=chromium
 * Output:        /tmp/scoreboard-after/<tier>.png
 */

const FAKE_SCREEN_ID = 'test-screen-000000000000';
const FAKE_TENANT_ID = 'test-tenant-000000000000';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-scoreboard';

const TIER = (process.env.TIER || 'hs').toLowerCase();
const WIDGET_TYPE =
  TIER === 'pro' ? 'SCOREBOARD_PRO' : TIER === 'college' ? 'SCOREBOARD_COLLEGE' : 'SCOREBOARD_HS';

function manifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [
      {
        id: 'pl-scoreboard',
        name: 'Scoreboard',
        template: {
          id: 'tpl-scoreboard',
          name: 'Scoreboard',
          screenWidth: 1920,
          screenHeight: 1080,
          bgColor: '#000000',
          zones: [
            {
              id: 'z-board',
              name: 'Scoreboard',
              widgetType: WIDGET_TYPE,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              zIndex: 1,
              // The gallery "Scoreboard" preset dispatches via the variant
              // registry (cfg.variant), NOT a bare widgetType. 'scoreboard-main'
              // → MainScoreboardWidget — the real component the gallery renders.
              defaultConfig: { variant: 'scoreboard-main', tier: TIER, gameId: '' },
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
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', tenantId: FAKE_TENANT_ID }),
  );
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
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
          url, readyState: RealWS.CONNECTING, onopen: null, onmessage: null, onerror: null, onclose: null,
          send() {}, close() {}, addEventListener() {}, removeEventListener() {},
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (typeof inst.onopen === 'function') (inst.onopen as (e: Event) => void).call(null, new Event('open'));
          setTimeout(() => {
            const authOk = { type: 'AUTH_OK', data: { deviceId: 'fake', expiresAt: Date.now() + 3600_000, serverTime: Date.now() }, idempotencyKey: 'a1', timestamp: Date.now() };
            if (typeof inst.onmessage === 'function') (inst.onmessage as (e: MessageEvent) => void).call(null, new MessageEvent('message', { data: JSON.stringify(authOk) }));
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
      class StubEventSource { url: string; readyState = 0; onopen = null; onmessage = null; onerror = null; constructor(url: string) { this.url = url; } addEventListener() {} close() {} }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { deviceToken: FAKE_DEVICE_TOKEN, fingerprint: FAKE_FINGERPRINT },
  );
}

test(`scoreboard ${TIER} — screenshot at native 1920×1080`, async ({ page }) => {
  const counters = { manifestCalls: 0 };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApiMocks(page, counters);
  await installPlayerTestHarness(page);
  await page.goto('/player?fp=' + FAKE_FINGERPRINT);
  const zone = page.locator('[data-zone-id="z-board"]');
  await zone.waitFor({ state: 'visible', timeout: 20_000 });
  // let fonts load + the scale-to-fit measure settle
  await page.waitForTimeout(1500);

  // Real smoke assertion: the scoreboard scene must paint a non-zero box
  // with real content (the scale(0) / empty-render failure shows as 0×0).
  const painted = await zone.evaluate((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (const k of Array.from(el.querySelectorAll('*'))) {
      if (k.tagName === 'STYLE' || k.tagName === 'SCRIPT') continue;
      const kr = (k as HTMLElement).getBoundingClientRect();
      if (kr.width > 100 && kr.height > 100) return true;
    }
    return false;
  });
  expect(painted, `scoreboard ${TIER} rendered empty / 0×0`).toBe(true);

  mkdirSync('/tmp/scoreboard-after', { recursive: true });
  await page.screenshot({ path: `/tmp/scoreboard-after/${TIER}.png` });
});
