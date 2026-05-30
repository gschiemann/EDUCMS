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

// Override config to PROVE editability — if the screenshot shows LIONS 88
// (green) vs BEARS 80 (purple) + RIVALRY NIGHT + orange accent, then the
// operator's Properties-panel edits actually drive the render (not just
// the bound-game/sample path). Set EDIT=0 to see the live sample instead.
const EDIT_OVERRIDES = process.env.EDIT === '0' ? {} : {
  bannerText: 'RIVALRY NIGHT',
  homeName: 'LIONS', awayName: 'BEARS',
  homeScore: 88, awayScore: 80,
  homeColor: '#16a34a', awayColor: '#7c3aed', accentColor: '#f59e0b',
};

// ELEMENTS=1 — stress grid of composed scoreboard ELEMENT widgets in small
// zones with visible colored backgrounds + deliberately LONG/BIG values, so
// the screenshot proves each element auto-fits its zone (the "numbers too big
// they don't fit" fix). If any value spills past its colored zone box, the
// fit is broken for that widget.
const ELEMENT_SPECS: Array<[string, Record<string, unknown>, string]> = [
  ['sb-team-name-home', { team: 'home', teamName: 'GOLDEN BEARS' }, '#1e3a8a'],
  ['sb-team-name-away', { team: 'away', teamName: 'WARRIORS' }, '#7f1d1d'],
  ['sb-team-abbr-home', { team: 'home', teamName: 'BEARS' }, '#1e3a8a'],
  ['score-home', { team: 'home', placeholder: '188' }, '#7c2d12'],
  ['score-away', { team: 'away', placeholder: '7' }, '#7c2d12'],
  ['game-clock', { placeholder: '88:88.9' }, '#065f46'],
  ['game-segment', { placeholder: 'OVERTIME 2' }, '#581c87'],
  ['sb-down-distance', {}, '#334155'],
  ['sb-shot-clock', {}, '#334155'],
  ['sb-fouls-home', { team: 'home' }, '#334155'],
  ['sb-timeouts-home', { team: 'home' }, '#334155'],
  ['sb-possession-arrow', {}, '#334155'],
  ['sb-set-scores', {}, '#334155'],
  ['sb-penalty-home', { team: 'home' }, '#334155'],
  ['sb-bonus-home', { team: 'home' }, '#334155'],
  ['sb-status', {}, '#334155'],
  ['sb-team-record-home', { team: 'home' }, '#334155'],
  ['sb-count', {}, '#334155'],
  ['sb-bases', {}, '#334155'],
  ['sb-power-play', { team: 'home' }, '#334155'],
  ['sb-riding-time', {}, '#334155'],
  ['sb-sponsor', {}, '#1f2937'],
  ['sb-weight-class', {}, '#334155'],
  ['sb-pitch-speed', {}, '#334155'],
];
const ELEMENT_ZONES = ELEMENT_SPECS.map(([variant, extra, bg], i) => {
  const cols = 6;
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    id: `el-${i}`,
    name: variant,
    widgetType: 'SCOREBOARD',
    x: 1.2 + col * 16.4,
    y: 2 + row * 24.3,
    width: 15,
    height: 21,
    zIndex: 1,
    defaultConfig: { variant, color: '#ffffff', bgColor: bg, ...extra },
  };
});

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
          zones: process.env.NAMEFIT === '1'
            ? [
                // DEBUG (NAMEFIT=1): does the team-name element auto-shrink?
                // Narrow blue box — "GOLDEN BEARS" at max 90px MUST shrink to
                // fit ~384px. If FitText works the text stays inside the box;
                // if broken it overflows.
                { id: 'z-name-narrow', name: 'Name narrow', widgetType: 'SCOREBOARD', x: 6, y: 40, width: 20, height: 16, zIndex: 1,
                  defaultConfig: { variant: 'sb-team-name-home', team: 'home', teamName: 'GOLDEN BEARS', fontSize: 90, color: '#ffffff', bgColor: '#1e3a8a' } },
                { id: 'z-name-wide', name: 'Name wide', widgetType: 'SCOREBOARD', x: 32, y: 40, width: 58, height: 16, zIndex: 1,
                  defaultConfig: { variant: 'sb-team-name-home', team: 'home', teamName: 'GOLDEN BEARS', fontSize: 90, color: '#ffffff', bgColor: '#7c3aed' } },
              ]
            : process.env.ELEMENTS === '1'
            ? ELEMENT_ZONES
            : [
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
                  defaultConfig: { variant: 'scoreboard-main', tier: TIER, gameId: '', ...EDIT_OVERRIDES },
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
  const zone = page.locator(`[data-zone-id="${process.env.NAMEFIT === '1' ? 'z-name-narrow' : process.env.ELEMENTS === '1' ? 'el-0' : 'z-board'}"]`);
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
  await page.screenshot({ path: `/tmp/scoreboard-after/${process.env.ELEMENTS === '1' ? 'elements' : TIER}.png` });

  if (process.env.NAMEFIT === '1') {
    const dbg = await page.evaluate(() => {
      const z = document.querySelector('[data-zone-id="z-name-narrow"]') as HTMLElement | null;
      if (!z) return { found: false };
      const zr = z.getBoundingClientRect();
      // walk descendants, find the text-bearing span + its nearest sized wrapper
      const spans = Array.from(z.querySelectorAll('span,div')).map((el) => {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { tag: e.tagName, text: (e.textContent || '').slice(0, 20), w: Math.round(r.width), h: Math.round(r.height), sw: e.scrollWidth, fs: cs.fontSize, ws: cs.whiteSpace };
      });
      return { found: true, zone: { w: Math.round(zr.width), h: Math.round(zr.height) }, spans };
    });
    // eslint-disable-next-line no-console
    console.log('FITDEBUG ' + JSON.stringify(dbg));
  }
});
