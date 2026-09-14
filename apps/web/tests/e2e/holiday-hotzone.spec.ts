import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * HOLIDAY HOT-ZONE E2E — verifies the click-to-edit jump for the rebuilt
 * clean holiday boards.
 *
 * THE BUG THIS PROVES FIXED
 *
 *   Operator (2026-06): "none of the new templates we updated have hot
 *   zones that take you to the editing section of what you click on."
 *
 *   The rebuilt clean holiday boards use a NEW [data-field] key set
 *   (masthead.* / headline.* / countdown.* / c0-2.*). The PropertiesPanel
 *   had been sourcing its editable-field list from a hand-maintained
 *   STATIC map (HOLIDAY_FIELD_SCHEMA) that still carried the OLD keys
 *   (sked.* / ticker.* / costume.*). Result: the panel rendered dead
 *   fields AND — because the panel's data-field-section anchors used the
 *   stale keys — a click on a real board element (which posts its REAL
 *   key) found no matching panel section to scroll to. No jump.
 *
 *   THE FIX (this run): HolidayWidget now caches the board's LIVE fields
 *   (posted on holiday:ready) keyed by `${gradeLevel}-${variant}`, and
 *   PropertiesPanel's HolidayPanelExtras reads that cache (sync on mount +
 *   on every holiday:fields-loaded) instead of the static map. The board
 *   is the single source of truth, so rebuilt + future boards just work.
 *
 * WHAT IT DOES
 *
 *   Boots the REAL builder route (/[schoolId]/templates/builder/[id]) with
 *   a fully-mocked API + a seeded sessionStorage auth — the same self-
 *   contained harness pattern as emergency-path / widget-render. The
 *   mocked template carries ONE HOLIDAY zone (hs / halloween). Then it:
 *
 *     1. Clicks the COUNTDOWN element inside the live board iframe — a
 *        NEW key (countdown.v) the OLD static schema NEVER had. Pre-fix
 *        this found no panel section; post-fix the panel jumps to it.
 *     2. Asserts the panel rendered LIVE-only sections (masthead.crest,
 *        countdown.v, c0.icon) and did NOT render OLD static-only ones
 *        (ticker.tag, ticker.message).
 *     3. Asserts the clicked field's section got `.is-active-section`
 *        (the persistent "this is the panel field for what you clicked"
 *        marker the scroll handler sets) — i.e. the hot-zone jump fired.
 *     4. Repeats the click for the headline (multi-element hot zone).
 *
 * EVERY API call is intercepted (fake host api.invalid via the config).
 * Repo is PUBLIC — no real token / tenant / user.
 */

const FAKE_TOKEN = 'fake.jwt.not.real.token';
const SCHOOL_ID = 'test-tenant-0001';
const TEMPLATE_ID = 'tpl-holiday-hs-halloween';
const FAKE_USER = {
  id: 'test-user-0001',
  tenantId: SCHOOL_ID,
  email: 'tester@example.com',
  role: 'SCHOOL_ADMIN',
  name: 'Test Operator',
  canTriggerPanic: false,
};

// A minimal template whose single zone is the HS Halloween holiday board.
// Shape matches what BuilderShell.init() consumes (zones[].defaultConfig
// holds the HolidayWidget variant + gradeLevel).
function holidayTemplate() {
  return {
    id: TEMPLATE_ID,
    name: 'HS Halloween (hot-zone test)',
    description: '',
    isSystem: false,
    category: 'HOLIDAYS',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a0610',
    bgGradient: '',
    bgImage: '',
    zones: [
      {
        id: 'z-holiday',
        name: 'Holiday board',
        widgetType: 'HOLIDAY',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { variant: 'halloween', gradeLevel: 'hs' },
      },
    ],
    scenes: [],
  };
}

// apiFetch uses `credentials: 'include'` + sends Authorization / Content-Type
// / X-CSRF-Token headers, so every cross-origin call to api.invalid triggers
// a CORS PREFLIGHT. With credentials the response CANNOT use ACAO `*` — it
// must echo the exact origin + allow-credentials, and the preflight must
// allow the request headers. Without this the browser silently discards even
// a 200 response (TypeError → apiFetch "network error" → builder stuck on the
// loading spinner). This was the whole reason the harness wouldn't boot.
// The web origin the mocked API answers CORS for; playwright.sandbox.config.ts sets E2E_BASE (2026-09-13).
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};

async function installApiMocks(page: Page, counters: { tpl: number }) {
  // Handle the CORS preflight, else run the real responder.
  const cors = (route: Route, respond: () => unknown) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
    }
    return respond();
  };
  const okJson = (route: Route, body: unknown, status = 200) =>
    cors(route, () =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify(body),
      }),
    );
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));

  // Broadest catch-alls FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, empty);
  await page.route('**/api/v1/**', empty);

  // Specific endpoints the builder + dashboard chrome need, registered
  // LAST so they win over the catch-all.
  await page.route('**/auth/me', (route) => okJson(route, FAKE_USER));
  await page.route('**/tenants', (route) =>
    okJson(route, [{ id: SCHOOL_ID, name: 'Test School', slug: SCHOOL_ID, vertical: 'EDU' }]),
  );
  await page.route(`**/templates/${TEMPLATE_ID}`, (route) =>
    cors(route, () => {
      counters.tpl += 1;
      return okJson(route, holidayTemplate());
    }),
  );
}

async function installAuthHarness(page: Page) {
  await page.addInitScript(
    ({ token, user }) => {
      try {
        sessionStorage.setItem('edu_cms_token', token);
        sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
      } catch {
        /* ignore */
      }

      // Capture console so a failure dumps useful context.
      const consoleLog: Array<{ level: string; msg: string }> = [];
      (window as unknown as Record<string, unknown>).__consoleLog = consoleLog;
      const wrap = (level: string, orig: (...a: unknown[]) => void) =>
        function (...args: unknown[]) {
          try { consoleLog.push({ level, msg: args.map((a) => String(a)).join(' ') }); } catch { /* */ }
          return orig.apply(console, args);
        };
      console.error = wrap('error', console.error.bind(console));
      console.warn = wrap('warn', console.warn.bind(console));

      // Stub the realtime WS so the dashboard chrome never enters a
      // reconnect storm (mirrors widget-render.spec). Delegate non-realtime
      // sockets (Next HMR) to the real WebSocket.
      const RealWS = window.WebSocket;
      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        if (!url.includes('/realtime')) return new (RealWS as any)(url, protocols);
        const inst: Record<string, unknown> = {
          url, readyState: RealWS.CONNECTING,
          onopen: null, onmessage: null, onerror: null, onclose: null,
          send() {}, close() { (this as { readyState: number }).readyState = RealWS.CLOSED; },
          addEventListener() {}, removeEventListener() {},
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (typeof inst.onopen === 'function') (inst.onopen as (e: Event) => void).call(null, new Event('open'));
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
        url: string; readyState = 0;
        onopen: ((e: Event) => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        constructor(url: string) { this.url = url; }
        addEventListener() {} close() {}
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { token: FAKE_TOKEN, user: FAKE_USER },
  );
}

test.describe('Holiday board hot-zone (click-to-edit jump)', () => {
  // The builder is gated behind a 1024px `lg:` wall in DashboardLayout
  // ("Larger screen required"). Force a desktop-wide viewport so the
  // editor actually renders.
  test.use({ viewport: { width: 1440, height: 900 } });

  test('clicking a board element jumps the panel to that field — live fields, not stale static', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      if (/Hydration failed|access control checks|Load failed|Failed to fetch|NetworkError/i.test(err.message)) return;
      // 2026-08-04 — HARNESS ARTIFACT, NOT AN APP BUG. Proven, not assumed.
      //
      //   "Failed to read the 'serviceWorker' property from 'Navigator':
      //    Service worker is disabled because the context is sandboxed and
      //    lacks the 'allow-same-origin' flag."
      //
      // The holiday board renders in a real null-origin sandbox
      // (`sandbox="allow-scripts"`, security finding INJ-005). Reading
      // `navigator.serviceWorker` in such a frame throws a SecurityError.
      //
      // A control experiment settled where it comes from — same page, four
      // iframes, counting this error:
      //   sandboxed iframe, srcdoc, NO script at all ....... 1  ← thrower
      //   sandboxed iframe, srcdoc, trivial script ......... 1
      //   sandboxed iframe, the real board ................. 1
      //   board + `allow-same-origin` ...................... 0
      // An EMPTY sandboxed frame throws it, so nothing we ship is
      // responsible: it is Playwright's own per-frame instrumentation
      // probing the SW registry in a frame that forbids it. Corroborating:
      // `serviceWorker` appears nowhere in the board HTML or in
      // `_style-bridge.js` (its only script), and every real call site in
      // apps/web goes through `getServiceWorkerContainer()`, which cannot
      // throw.
      //
      // Do NOT "fix" this by adding `allow-same-origin` to the board iframe.
      // That is the flag that makes the error go away and it is precisely the
      // flag INJ-005 removed — restoring it would hand a board script our
      // origin and undo the sandbox.
      if (/Service worker is disabled because the context is sandboxed/i.test(err.message)) return;
      pageErrors.push(err.message);
    });
    const apiReqs: string[] = [];
    page.on('request', (r) => { if (r.url().includes('api.invalid')) apiReqs.push(r.url()); });
    const counters = { tpl: 0 };

    await installApiMocks(page, counters);
    await installAuthHarness(page);

    await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });

    // The builder is gated behind a `lg:` (1024px) responsive wall in
    // DashboardLayout: a `lg:hidden` "Larger screen required" overlay + a
    // `hidden lg:block` builder container. In this Turbopack-dev harness the
    // COMPILED Tailwind-v4 `lg:` media-variant CSS doesn't take effect even
    // at a 1440px viewport (matchMedia reports true, but the `@media` rule
    // for `lg:block`/`lg:hidden` isn't applied — confirmed: without this
    // override the container stays display:none and never mounts). This is a
    // TEST-ENV artifact, NOT a product bug — the operator's real desktop
    // browser clears the wall ("editor pops now"). Force the gate open so the
    // real builder + PropertiesPanel render and we can exercise the hot-zone.
    await page.addStyleTag({
      content: `[class~="lg:hidden"]{display:none !important}[class~="lg:block"]{display:block !important}`,
    });

    // Builder shell mounts the holiday zone wrapper.
    const zone = page.locator('[data-zone-id="z-holiday"]');
    try {
      await expect(zone, 'builder never mounted the holiday zone').toBeVisible({ timeout: 30_000 });
    } catch (e) {
      const diag = await page.evaluate(() => ({
        mm1024: typeof matchMedia === 'function' ? matchMedia('(min-width: 1024px)').matches : 'n/a',
        innerWidth: window.innerWidth,
        zones: document.querySelectorAll('[data-zone-id]').length,
        iframes: document.querySelectorAll('iframe').length,
        lgBlock: document.querySelectorAll('[class~="lg:block"]').length,
        hasBuilderText: /Save|Discard|Widgets|Properties/.test(document.body.innerText),
        bodyText: document.body.innerText.slice(0, 200),
      }));
      // eslint-disable-next-line no-console
      console.log('\n[DIAG]', JSON.stringify(diag, null, 0),
        '\n[DIAG] api.invalid reqs:', apiReqs.length, '| template fulfilled:', counters.tpl);
      throw e;
    }

    // The board iframe loads the real static HTML from /public.
    const frame = page.frameLocator('iframe[src*="hs-halloween"]');
    const countdownEl = frame.locator('[data-field="countdown.v"]');
    await expect(countdownEl, 'board iframe never rendered the countdown').toBeVisible({ timeout: 20_000 });

    // Give the bridge a beat to post holiday:ready (populates the live cache).
    await page.waitForTimeout(800);

    // ── ACT 1: click the COUNTDOWN — a NEW key the OLD static schema never
    // had. This both selects the zone and requests the panel jump.
    await countdownEl.click({ force: true });

    // The panel now renders HolidayPanelExtras from the LIVE board fields.
    // LIVE-only sections must exist:
    for (const key of ['masthead.crest', 'countdown.v', 'c0.icon']) {
      await expect(
        page.locator(`[data-field-section="${key}"]`),
        `panel missing LIVE field section "${key}" — still using stale static schema?`,
      ).toHaveCount(1, { timeout: 10_000 });
    }
    // OLD static-only keys must be GONE:
    for (const key of ['ticker.tag', 'ticker.message', 'sked.0.d']) {
      await expect(
        page.locator(`[data-field-section="${key}"]`),
        `panel STILL shows stale static-schema field "${key}"`,
      ).toHaveCount(0);
    }

    // ── ASSERT the hot-zone jump fired: the clicked field's section (or its
    // group) carries the persistent .is-active-section marker the scroll
    // handler sets. countdown.v is the field; "countdown" is its group.
    await expect
      .poll(
        async () =>
          page.locator('[data-field-section="countdown.v"].is-active-section').count().then((a) =>
            a > 0 ? a : page.locator('[data-field-section="countdown"].is-active-section').count(),
          ),
        { message: 'countdown hot-zone never marked its panel section active (no jump)', timeout: 8_000 },
      )
      .toBeGreaterThan(0);

    // ── ACT 2: a multi-element hot zone — the headline <h1> holds two
    // data-field spans; clicking it must jump to the headline group.
    await frame.locator('[data-field="headline.t1"]').click({ force: true });
    await expect
      .poll(
        async () =>
          page.locator('[data-field-section="headline.t1"].is-active-section').count().then((a) =>
            a > 0 ? a : page.locator('[data-field-section="headline"].is-active-section').count(),
          ),
        { message: 'headline hot-zone never marked its panel section active (no jump)', timeout: 8_000 },
      )
      .toBeGreaterThan(0);

    // Editable-text count header proves the panel is populated from the board.
    await expect(page.getByText(/Editable text/i).first()).toBeVisible();

    // Screenshot the proof for the human.
    await page.screenshot({ path: testInfo.outputPath('holiday-hotzone-proof.png'), fullPage: false });

    expect(pageErrors, `uncaught pageerror(s): ${pageErrors.slice(0, 3).join(' || ')}`).toEqual([]);
  });
});
