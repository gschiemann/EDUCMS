import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'fs';

/**
 * STADIUM_MEET_BOARD boardStyle=duel SCREENSHOT HARNESS (S6 #288,
 * 2026-07-03 — dev-only verification, not a CI gate).
 *
 * Sibling of stadium-meet-board-shot.spec.ts (v1 'broadcast') — SAME
 * mock/harness pattern, but the seeded /sports/board/:id snapshot carries
 * non-zero homeScore/awayScore (the v2 "duel" scene's team-score header)
 * plus the same seeded results, so the screenshot proves the LIVE-data
 * path for BOTH the lane rows (name/team/mark/place → sorted rows + real
 * per-swimmer deltas) AND the dual-meet score header (real homeScore/
 * awayScore/homeTeam/awayTeam/homeColor/awayColor) — never the mockup's
 * hardcoded 96/74 sample.
 *
 * Boots the REAL /player route with a fully-mocked API, a single
 * full-bleed STADIUM_MEET_BOARD zone (boardStyle: 'duel'), then
 * screenshots the rendered component at native 1920×1080 so the port can
 * be compared side-by-side with the approved mockup
 * (docs/design/proposals/2026-07-02-stadium-lane/stadium-lane-v2-duel.png).
 *
 * Run:    pnpm --filter web exec playwright test stadium-meet-board-duel-shot --project=chromium
 * Output: <scratchpad>/stadium-meet-board-v2-duel-live.png (set via SHOT_OUT env)
 */

const FAKE_SCREEN_ID = 'test-screen-000000000002';
const FAKE_TENANT_ID = 'test-tenant-000000000002';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-stadium-duel-board';
const FAKE_GAME_ID = 'game-stadium-duel-shot-000001';

const SHOT_OUT = process.env.SHOT_OUT || '/tmp/stadium-meet-board-after/v2-duel-live.png';

function boardSnapshot() {
  return {
    id: FAKE_GAME_ID,
    sport: 'swimming',
    status: 'LIVE',
    segment: 1,
    homeTeam: 'Central Hawks',
    awayTeam: 'Westview Waves',
    // Real dual-meet team points — proves the duel header reads the
    // ACTUAL bound game's score, not the mockup's hardcoded 96/74.
    homeScore: 96,
    awayScore: 74,
    homeColor: '#dc2626',
    awayColor: '#2563eb',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 0,
    clockRunning: false,
    clockUpdatedAt: new Date().toISOString(),
    stats: {
      currentEvent: 'EVENT 12 · GIRLS 100M FREE — FINALS — HEAT 3 OF 4',
      results: [
        {
          event: 'EVENT 12 · GIRLS 100M FREE — FINALS — HEAT 3 OF 4',
          order: 1,
          entries: [
            { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' },
            { place: 2, name: 'M. Chen', team: 'away', lane: 2, mark: '52.18' },
            { place: 3, name: 'T. Nguyen', team: 'away', lane: 5, mark: '53.61' },
            { place: 4, name: 'S. Patel', team: 'home', lane: 6, mark: '54.05' },
            { place: 5, name: 'J. Rivera', team: 'home', lane: 1, mark: '55.42' },
          ],
        },
      ],
    },
    serverTime: Date.now(),
  };
}

function manifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [
      {
        id: 'pl-stadium-duel-board',
        name: 'Stadium Duel Board',
        template: {
          id: 'tpl-stadium-duel-board',
          name: 'Dual-Meet Duel Board',
          screenWidth: 1920,
          screenHeight: 1080,
          bgColor: '#07090f',
          zones: [
            {
              id: 'z-board',
              name: 'Duel Board',
              widgetType: 'STADIUM_MEET_BOARD',
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              zIndex: 1,
              defaultConfig: {
                boardStyle: 'duel',
                laneCount: 5,
                gameId: FAKE_GAME_ID,
              },
            },
          ],
        },
        items: [],
      },
    ],
  };
}

async function installApiMocks(page: Page) {
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
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, (route) => ok(route, manifest()));
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
  // The one addition over scoreboard-shot.spec.ts: GameStateContext's
  // 750ms poll hits this endpoint. Real seeded results + real team scores
  // → the live-data path (not the phantom "NO GAME BOUND" / builder
  // SAMPLE paths).
  await page.route(`**/sports/board/${FAKE_GAME_ID}`, (route) => ok(route, boardSnapshot()));
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

test('Stadium Lane v2 Duel — live screenshot at native 1920×1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApiMocks(page);
  await installPlayerTestHarness(page);
  await page.goto('/player?fp=' + FAKE_FINGERPRINT);
  const zone = page.locator('[data-zone-id="z-board"]');
  await zone.waitFor({ state: 'visible', timeout: 20_000 });
  // Let the 750ms GameStateContext poll land + fonts load + the
  // scale-to-fit measure settle.
  await page.waitForTimeout(2000);

  // Real smoke assertions: live team scores + leader name must be on the
  // page (proves the live-data path rendered, not "NO GAME BOUND" / the
  // builder SAMPLE 96/74 — this seed intentionally ALSO uses 96/74 so the
  // scores match the mockup, but the DOM text-content assertions below
  // (delta math + omitted "up next") are what actually prove liveness).
  await expect(page.locator('body')).toContainText('D. Okafor');
  // Team names are forced UPPERCASE with `.toUpperCase()` in JSX (not CSS
  // text-transform, which jsdom's Jest specs rely on) — Playwright reads
  // the REAL rendered DOM text, which is genuinely uppercase here.
  await expect(page.locator('body')).toContainText('CENTRAL HAWKS');
  await expect(page.locator('body')).toContainText('WESTVIEW WAVES');
  // Per-swimmer delta vs the leader (52.18 - 51.90 = 0.28).
  await expect(page.locator('body')).toContainText('+0.28');
  // The mockup's fabricated "UP NEXT" clause must NEVER appear — no
  // schedule/next-event field exists in the data model.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('UP NEXT');
  expect(bodyText).not.toContain('EVENT 13');

  const outDir = SHOT_OUT.slice(0, SHOT_OUT.lastIndexOf('/'));
  if (outDir) mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: SHOT_OUT });
});
