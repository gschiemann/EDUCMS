import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * WIDGET-RENDER WEBKIT SMOKE — P1-12 from the 2026-05-28 Opus-4.8 audit.
 *
 * THE GAP THIS CLOSES
 *
 *   The holiday-bridge canary (tests/cross-browser/holiday-bridge.cjs)
 *   gives us WebKit coverage of 18 *static* holiday HTML templates. The
 *   emergency-path E2E (tests/e2e/emergency-path.spec.ts) runs in the
 *   [chromium, webkit] matrix but only exercises the emergency overlay —
 *   it boots with EMPTY playlists. So the ~170 React widgets dispatched
 *   by WidgetRenderer.tsx — the themed school packs, the sports
 *   scoreboard, the restaurant / retail / fitness / bar verticals,
 *   AnimatedWelcome — have had ZERO WebKit render check. They render
 *   trivially in Chrome-only local dev; Safari (and the Chromium-83
 *   Taurus, which shares WebKit's intolerance for ahead-of-spec CSS) is
 *   exactly where they'd silently collapse.
 *
 *   This is the same class of blind spot that shipped the 2026-05-09
 *   "works in Chrome, dead in Safari" holiday-bridge regression for two
 *   months. CLAUDE.md cross-browser rule #4: "When adding a new test
 *   surface that touches DOM, port the WebKit check pattern." This is
 *   that port, for the React widget surface.
 *
 * WHAT IT DOES
 *
 *   Boots the REAL /player route (the production render path that ships
 *   to wall screens) with a fully-mocked API — modeled on the proven
 *   emergency-path harness. The mocked manifest carries a single template
 *   whose zones are a representative spread of widget families:
 *
 *     - ANIMATED_HALLWAY_SCHEDULE  (themed K-12 schedule)
 *     - ANIMATED_CAFETERIA         (themed K-12 cafeteria menu)
 *     - SCOREBOARD                 (Sprint 13 sports scorebug)
 *     - RESTAURANT_MENU_BOARD      (restaurant vertical)
 *     - RETAIL_PRODUCT_GRID        (retail vertical)
 *     - FITNESS_CLASS_SCHEDULE     (fitness vertical)
 *     - BAR_TAP_LIST               (bar vertical)
 *     - ANIMATED_WELCOME           (the most-iterated flagship widget)
 *
 *   Per widget, in BOTH chromium AND webkit (playwright.config.ts
 *   projects), it asserts:
 *     1. The zone wrapper rendered with non-zero offsetWidth/offsetHeight
 *        (the inset-collapse / scale(0) failure mode shows up as 0×0).
 *     2. The zone has real painted content — a descendant element with
 *        non-zero box (not an empty div).
 *     3. The per-widget WidgetErrorBoundary did NOT trip. On a WebKit-
 *        only crash the boundary renders `null` (blank zone) AND
 *        console.error's '[WidgetErrorBoundary]'. We assert zero such
 *        errors, so a widget that throws only in Safari is caught even
 *        though it doesn't crash the page.
 *     4. No uncaught pageerror fired during the whole render.
 *
 *   A widget that fails any of these in WebKit is a REAL cross-browser
 *   bug to surface — per the brief, report it, do not paper over it.
 *
 * EVERY API call is intercepted (fake host api.invalid via the config).
 * No production traffic. Repo is PUBLIC — no real token/tenant/fingerprint.
 */

// ─── Shared fake identities (mirror emergency-path.spec.ts) ──────────────
const FAKE_SCREEN_ID = 'test-screen-000000000000';
const FAKE_TENANT_ID = 'test-tenant-000000000000';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-widget-render';

// ─── Representative widget spread ────────────────────────────────────────
// One per family the audit flagged as untested in WebKit. Each `id` is the
// zone id we assert against; `type` is the WidgetRenderer dispatch key.
// Zones tile a 1920×1080 canvas in a 4×2 grid so every one has a real,
// non-trivial box to measure (a 0×0 zone would pass a naive size check).
type WidgetCase = { id: string; type: string; label: string; config?: Record<string, unknown> };

const WIDGET_CASES: WidgetCase[] = [
  { id: 'z-hallway',    type: 'ANIMATED_HALLWAY_SCHEDULE', label: 'Themed schedule' },
  { id: 'z-cafeteria',  type: 'ANIMATED_CAFETERIA',        label: 'Themed cafeteria' },
  { id: 'z-scoreboard', type: 'SCOREBOARD',                label: 'Sports scorebug' },
  { id: 'z-restaurant', type: 'RESTAURANT_MENU_BOARD',     label: 'Restaurant menu board' },
  { id: 'z-retail',     type: 'RETAIL_PRODUCT_GRID',       label: 'Retail product grid' },
  { id: 'z-fitness',    type: 'FITNESS_CLASS_SCHEDULE',    label: 'Fitness class schedule' },
  { id: 'z-bar',        type: 'BAR_TAP_LIST',              label: 'Bar tap list' },
  { id: 'z-welcome',    type: 'ANIMATED_WELCOME',          label: 'AnimatedWelcome (flagship)' },

  // ── §15-4 additions (2026-05-30): 17 new widget families (Bulletin ×4,
  // Scrapbook ×4, Storybook ×4, HS pack ×12, MS pack ×16) had ZERO WebKit
  // smoke. Each family uses dangerouslySetInnerHTML for CSS keyframes / SVG
  // — one malformed CSS string kills the widget silently in Safari (the
  // 2026-05-09 class of bug). One landscape representative per family is
  // enough to catch that class of failure; the portrait variants share the
  // same dangerouslySetInnerHTML block so a landscape pass de-risks the
  // portrait too. DO NOT batch-remove; each entry is a real canary.
  { id: 'z-bulletin',   type: 'BULLETIN_HALLWAY',          label: 'Bulletin board (hallway, rep for ×4 Bulletin themes)' },
  { id: 'z-scrapbook',  type: 'SCRAPBOOK_HALLWAY',         label: 'Scrapbook (hallway, rep for ×4 Scrapbook themes)' },
  { id: 'z-storybook',  type: 'STORYBOOK_HALLWAY',         label: 'Storybook (hallway, rep for ×4 Storybook themes)' },
  { id: 'z-hs-varsity', type: 'HS_VARSITY',                label: 'HS Varsity (rep for HS pack ×12 landscape types)' },
  { id: 'z-ms-arcade',  type: 'MS_ARCADE',                 label: 'MS Arcade (rep for MS pack ×16 landscape types)' },
];

// Build the zones array: 4-column grid, each cell 25%×50%. The §15-4
// additions bring the total to 13 cases (4 rows); rows beyond the first two
// extend below the 1080-canvas floor but offsetWidth/offsetHeight still
// resolve correctly — the test measures DOM layout, not viewport intersection.
function buildZones() {
  return WIDGET_CASES.map((w, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    return {
      id: w.id,
      name: w.label,
      widgetType: w.type,
      x: col * 25,
      y: row * 50,
      width: 25,
      height: 50,
      zIndex: 0,
      defaultConfig: w.config ?? {},
    };
  });
}

// A manifest whose single playlist is a template carrying our widget grid.
// Matches the shape the player consumes at page.tsx ~L2870 / ~L5011
// (playlists[].template.zones[]).
function widgetGridManifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [
      {
        id: 'pl-widget-grid',
        name: 'Widget Smoke Grid',
        template: {
          id: 'tpl-widget-grid',
          name: 'Widget Smoke Grid',
          screenWidth: 1920,
          screenHeight: 1080,
          bgColor: '#0f172a',
          zones: buildZones(),
        },
        items: [],
      },
    ],
  };
}

// ─── API mock layer (slimmed from emergency-path.spec.ts) ────────────────
async function installApiMocks(page: Page, counters: { manifestCalls: number }) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // ── Route ordering note ──────────────────────────────────────────────
  // Playwright matches routes in REVERSE registration order (last-wins).
  // So the BROAD catch-alls MUST be registered FIRST and the SPECIFIC
  // endpoints LAST, or a catch-all shadows the manifest route and the
  // player boots into a 204-everything void (never fetches the manifest).
  //
  // Broadest first: the fake-host catch-all, then the /api/v1/** widget-
  // data catch-all. Specific endpoints registered after these win.
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  // Third-party IP-geolocation (ipapi.co) that location-aware widgets ping on
  // render. Stub it with a fixed US payload so (a) the widget renders with real
  // data and (b) WebKit-under-CI never throws a CORS "access control" pageerror
  // for an external host (the intermittent Cross-Browser red, 2026-05-31).
  await page.route(/ipapi\.co\/.*/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ city: 'Springfield', region: 'Illinois', region_code: 'IL', country_code: 'US', latitude: 39.8, longitude: -89.6, timezone: 'America/Chicago' }),
    }),
  );
  // Widget data feeds (weather, lunch menu, etc.) — return empty so the
  // themed widgets fall back to their built-in sample content (the §19
  // documented behavior) instead of looping on a failed fetch.
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', deviceToken: FAKE_DEVICE_TOKEN }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, (route) => {
    counters.manifestCalls += 1;
    return ok(route, widgetGridManifest());
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

// Seed pairing state + console capture + a selective WS/SSE stub so the
// player boots straight into 'playing' without the pairing splash or a WS
// reconnect storm. (Mirrors emergency-path's harness; trimmed to what the
// render path needs — no __pushWs since we don't inject WS messages here.)
async function installPlayerTestHarness(page: Page) {
  await page.addInitScript(
    ({ deviceToken, fingerprint }) => {
      const w = window as unknown as Record<string, unknown>;
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
      } catch {
        /* ignore */
      }

      // Capture console.error so we can detect a WidgetErrorBoundary trip
      // (it console.error's '[WidgetErrorBoundary]' even in quiet mode).
      const consoleLog: Array<{ level: string; msg: string }> = [];
      w.__consoleLog = consoleLog;
      const wrap = (level: string, orig: (...a: unknown[]) => void) =>
        function (...args: unknown[]) {
          try {
            consoleLog.push({ level, msg: args.map((a) => String(a)).join(' ') });
          } catch {
            /* ignore */
          }
          return orig.apply(console, args);
        };
      console.error = wrap('error', console.error.bind(console));
      console.warn = wrap('warn', console.warn.bind(console));

      // Selective WS stub — DELEGATE non-realtime URLs to the real
      // WebSocket (Next HMR socket must stay live or the page never boots);
      // stub only the player's /realtime endpoint so it auto-AUTH_OKs and
      // never enters reconnect backoff.
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
          close() {
            (this as { readyState: number }).readyState = RealWS.CLOSED;
          },
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

      // SSE fallback — never-opens no-op so it can't race the WS stub.
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

/** Count WidgetErrorBoundary trips captured on the page console. */
async function countBoundaryTrips(page: Page) {
  return page.evaluate(() => {
    const log = (window as unknown as { __consoleLog?: Array<{ msg: string }> }).__consoleLog || [];
    return log.filter((e) => /\[WidgetErrorBoundary\]/.test(e.msg)).map((e) => e.msg);
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────
test.describe('Widget render — WebKit + Chromium smoke (P1-12)', () => {
  let counters: { manifestCalls: number };
  const pageErrors: string[] = [];

  // The e2e webServer runs `pnpm dev` (Next dev), so /player is COMPILED on
  // the first request. Under CI load that cold compile can blow past the
  // per-test boot budget → intermittent "Player never fetched the manifest —
  // boot got stuck" failures (flaked twice 2026-06-02, again 2026-07-09 on a
  // commit that didn't touch the player; green on no-change re-run each time).
  //
  // 2026-07-09 — hardened from fail-soft to BLOCKING-with-retries. The
  // fail-soft version silently swallowed a warm-up failure, so under heavy
  // runner load EVERY test retry re-ate the cold compile inside its own 30s
  // manifest budget → 3× red in BOTH engines. Now: up to 3 warm-up attempts
  // × 90s each; if all fail we throw HERE with an honest infra message
  // instead of letting the timed test fail with a misleading render one.
  // 2026-08-03 — the retries were not actually retrying. A SINGLE page was
  // created outside the loop and reused for all three attempts. When the first
  // attempt died in a way that takes the page with it — `Target page, context
  // or browser has been closed`, an aborted navigation, a renderer OOM under a
  // loaded runner — attempts 2 and 3 replayed against a DEAD handle and threw
  // instantly. So the advertised 3 × 90 s budget silently collapsed to one
  // shot, and the job failed in ~30 s rather than using its 270 s.
  //
  // That is why this looked like a code regression on 2026-08-03: it went
  // red on the security merge, green on the next commit, red on the one after,
  // green again — alternating across commits that never touched widget
  // rendering. Same signature as the 2026-06-02 and 2026-07-09 flakes noted
  // above; those were also "green on a no-change re-run".
  //
  // Fix: a FRESH page per attempt, and treat page creation itself as part of
  // the attempt. Now a crashed renderer costs one attempt instead of all three.
  test.beforeAll(async ({ browser }) => {
    let warmed = false;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3 && !warmed; attempt++) {
      let warm: import('@playwright/test').Page | null = null;
      try {
        warm = await browser.newPage();
        await warm.goto('http://localhost:3000/player?fp=warmup', {
          waitUntil: 'domcontentloaded',
          timeout: 90_000,
        });
        await warm.waitForTimeout(1500);
        warmed = true;
      } catch (err) {
        lastErr = err;
        // eslint-disable-next-line no-console
        console.warn(`[widget-render] warm-up attempt ${attempt}/3 failed: ${String(err).slice(0, 160)}`);
      } finally {
        // Never let a failed close mask the real warm-up error.
        if (warm) await warm.close().catch(() => {});
      }
    }
    if (!warmed) {
      throw new Error(
        `Player route warm-up failed after 3 attempts — dev server never served /player (infra/compile, not a render bug): ${String(lastErr).slice(0, 300)}`,
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    counters = { manifestCalls: 0 };
    pageErrors.length = 0;
    page.on('pageerror', (err) => {
      // Pre-existing KioskSplash inline-<style> hydration mismatch is
      // unrelated to widget rendering — don't fail the suite on it.
      if (/Hydration failed/.test(err.message)) return;
      // Third-party network calls a widget fires on render (IP geolocation
      // like ipapi.co, weather, etc.) get rejected by WebKit-under-CI with a
      // CORS "access control" error. Those are EXTERNAL-network flakes, not
      // OUR cross-browser render bugs — and they reddened CI intermittently
      // (audit §15 follow-up, 2026-05-31). Ignore them; we stub ipapi.co in
      // installApiMocks so location widgets still render with data.
      if (/access control checks|ipapi\.co|Load failed|Failed to fetch|ERR_NETWORK|NetworkError/i.test(err.message)) return;
      pageErrors.push(err.message);
    });
    await installApiMocks(page, counters);
    await installPlayerTestHarness(page);
  });

  test('all representative widgets render with non-zero box + no errors', async ({ page }, testInfo) => {
    // Boot-heavy test against a dev server (compile-on-first-request). Give it
    // real headroom beyond the 20s default so a cold/contended CI run can't
    // flake on slow boot — the route is pre-warmed in beforeAll, the 2 CI
    // retries are the final backstop.
    test.setTimeout(120_000);
    await page.goto('/player?fp=' + FAKE_FINGERPRINT, { waitUntil: 'domcontentloaded' });

    // Wait for the manifest to land (player reached connecting→playing).
    // 60s (not 30s): even with the blocking warm-up, a contended CI runner
    // can stall the dev server's request handling — the poll budget is the
    // last line before a misleading red on the load-bearing player gate.
    await expect
      .poll(() => counters.manifestCalls, {
        message: 'Player never fetched the manifest — boot got stuck',
        timeout: 60_000,
      })
      .toBeGreaterThanOrEqual(1);

    // Wait for the template scene to mount — the first zone wrapper appears
    // once the player enters the template render branch.
    const firstZone = page.locator(`[data-zone-id="${WIDGET_CASES[0].id}"]`);
    await expect(firstZone, 'template scene never mounted (no zone wrappers)').toBeVisible({ timeout: 10_000 });

    // Give themed widgets a beat to run their mount effects (clock tick,
    // scale-to-fit measure, sample-data population) before measuring.
    await page.waitForTimeout(800);

    const failures: string[] = [];

    for (const wc of WIDGET_CASES) {
      const zoneSel = `[data-zone-id="${wc.id}"]`;
      const zone = page.locator(zoneSel);

      // (1) Zone wrapper present + non-zero box. The inset-collapse /
      // transform:scale(0) failure mode renders here as 0×0.
      const box = await zone.evaluate((el) => ({
        offW: (el as HTMLElement).offsetWidth,
        offH: (el as HTMLElement).offsetHeight,
        childCount: el.childElementCount,
      })).catch(() => null);

      if (!box) {
        failures.push(`[${wc.type}] zone ${wc.id} not found in DOM`);
        continue;
      }
      if (box.offW < 2 || box.offH < 2) {
        failures.push(`[${wc.type}] zone collapsed to ${box.offW}×${box.offH} (inset/scale(0) class bug)`);
        continue;
      }

      // (2) Real painted content — a descendant with a non-zero box, not
      // just the wrapper. An error-boundary'd (blanked) widget leaves the
      // <style> chunk maybe, but no laid-out widget content.
      const painted = await zone.evaluate((el) => {
        const kids = el.querySelectorAll('*');
        for (const k of Array.from(kids)) {
          if (k.tagName === 'STYLE' || k.tagName === 'SCRIPT') continue;
          const r = (k as HTMLElement).getBoundingClientRect();
          if (r.width > 4 && r.height > 4) return true;
        }
        return false;
      });
      if (!painted) {
        failures.push(`[${wc.type}] zone ${wc.id} has NO painted content (likely error-boundary blanked it in ${testInfo.project.name})`);
      }
    }

    // (3) WidgetErrorBoundary trips — a widget that threw only in this
    // engine. Caught even though quiet-mode renders null (no page crash).
    const boundaryTrips = await countBoundaryTrips(page);
    if (boundaryTrips.length > 0) {
      failures.push(`WidgetErrorBoundary tripped ${boundaryTrips.length}× in ${testInfo.project.name}: ${boundaryTrips.slice(0, 3).join(' || ')}`);
    }

    // (4) No uncaught pageerror during the whole render.
    if (pageErrors.length > 0) {
      failures.push(`Uncaught pageerror(s) in ${testInfo.project.name}: ${pageErrors.slice(0, 3).join(' || ')}`);
    }

    expect(
      failures,
      `Widget render failures in ${testInfo.project.name} (each is a real cross-browser bug):\n  - ${failures.join('\n  - ')}`,
    ).toEqual([]);
  });
});
