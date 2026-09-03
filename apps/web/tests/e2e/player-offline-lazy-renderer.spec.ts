import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * COLD OFFLINE BOOT AFTER THE RENDERER SPLIT (P0-3, 2026-09-02).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * /player used to reach `POST /screens/register` only after downloading the
 * entire widget catalog (33 chunks / 6.63 MB, one of them 3.53 MB of pure
 * widget registry). The renderer now loads from a dynamic import AFTER
 * registration succeeds and the first manifest is applied.
 *
 * That split is only safe because `sw-player.js` pins `/_next/static/**`
 * cache-first at runtime AND — since this wave — its shell prune KEEPS
 * runtime-captured entries. The service worker's own header carried a
 * STEP-3 GUARD warning that prune-to-parsed-set "will evict the lazy chunks
 * it just captured" the day the player starts lazy-importing. Today is that
 * day, and this spec is the proof the guard was discharged, not ignored:
 *
 *   boot ONLINE → template renders (⇒ the lazy chunk loaded)
 *   → every /_next/static script the page is running on is in the shell tier
 *   → an idle PRECACHE_SHELL refresh runs and KEEPS them (the guard: before
 *     this wave the prune deleted anything absent from the route HTML, which
 *     is exactly what a lazy chunk is)
 *   → go OFFLINE (network dead, every API route aborted) and reload
 *   → the document boots from cache AND the renderer chunk is still served,
 *     proven by fetching it from the offline page.
 *
 * ⚠ HONEST SCOPE. This spec deliberately does NOT assert that the TEMPLATE
 * re-renders on a cold offline boot, because today it cannot — and that is a
 * PRE-EXISTING gap this wave did not create and did not fix: the web player
 * has no persisted `screenId` (it is only ever set from
 * `POST /screens/register` / `/screens/status` responses — page.tsx), so
 * with no network there is no screen id, so `fetchContent` never runs, so
 * the `readCachedManifest()` fallback inside it is never reached. The
 * service worker's shell tier lets the page EXECUTE offline; making it also
 * SHOW content offline needs a persisted screen id and is its own change.
 * Asserting it here would either fail forever or quietly be written to pass
 * against a mock that is not offline at all.
 *
 * Harness rules (per CLAUDE.md player rule 14, and copied from
 * player-canvas-geometry.spec.ts): never replace `window.WebSocket`
 * wholesale — delegate non-`/realtime` URLs, because Next dev's HMR uses it
 * and a dead stub stalls the whole page boot silently.
 */

const FAKE_SCREEN_ID = 'test-screen-000000offline';
const FAKE_TENANT_ID = 'test-tenant-000000offline';
const FAKE_FINGERPRINT = 'test-fp-offline-lazy-renderer';
const BOOT_TOKEN = 'boot.stored.token-not-real';
/** Rendered by the TEXT widget — visible ONLY if the lazy renderer ran. */
const PROOF_TEXT = 'OFFLINE RENDER PROOF';
/**
 * Zone rendering a widget from a SEPARATELY-CHUNKED family (P1-1, 2026-09-03).
 * Painting it proves a per-family chunk loaded, not just the renderer island.
 */
const FAMILY_ZONE_ID = 'z-family';

function templatePlaylist() {
  return [{
    id: 'pl-offline',
    name: 'Offline proof',
    template: {
      id: 'tpl-offline',
      name: 'Offline proof',
      bgColor: '#101828',
      screenWidth: 1920,
      screenHeight: 1080,
      zones: [{
        id: 'z-proof',
        x: 0, y: 0, width: 100, height: 50, zIndex: 1,
        widgetType: 'TEXT',
        defaultConfig: {
          sizeMode: 'absolute',
          content: PROOF_TEXT,
          fontSize: 96,
          fontWeight: 800,
          color: 'white',
          alignment: 'center',
          lineHeight: 1.15,
        },
      }, {
        // P1-1 (2026-09-03) — a FAMILY widget, not just a renderer-island one.
        // TEXT is implemented inside WidgetRenderer itself, so on its own it
        // proves the island loaded but says nothing about the per-family
        // chunks this wave introduced. ANIMATED_WELCOME lives in its own
        // module behind a `lazyWidget` proxy, so this zone only paints if a
        // SECOND, separately-fetched chunk arrived — and it drags that chunk
        // into the same offline assertions below (cached → survives the
        // prune → served with the network down).
        id: FAMILY_ZONE_ID,
        x: 0, y: 50, width: 100, height: 50, zIndex: 1,
        widgetType: 'ANIMATED_WELCOME',
        defaultConfig: {},
      }],
    },
    items: [],
  }];
}

const ok = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installMocks(page: Page) {
  await page.addInitScript(({ token }) => {
    try { localStorage.setItem('edu_device_token', token); } catch { /* ignore */ }
  }, { token: BOOT_TOKEN });

  await page.route('**/api/v1/screens/register', (route) => ok(route, {
    screenId: FAKE_SCREEN_ID, deviceToken: BOOT_TOKEN, paired: true,
    tenantId: FAKE_TENANT_ID, tenantName: 'Offline Tenant', status: 'ONLINE',
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => ok(route, {
    screenId: FAKE_SCREEN_ID,
    screenName: 'Offline Screen',
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Offline Tenant',
    orientation: 'LANDSCAPE',
    isEmergency: false,
    playlists: templatePlaylist(),
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) => ok(route, { ok: true }, 201));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
}

/** Delegating WS stub — only `/realtime` is stubbed; HMR keeps the real one. */
async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      const listeners: Record<string, Array<(ev: any) => void>> = {};
      const inst: any = {
        url, readyState: RealWS.CONNECTING,
        onopen: null, onmessage: null, onerror: null, onclose: null,
        send() { /* swallow */ },
        close(code = 1000, reason = '') { inst.readyState = RealWS.CLOSED; emit('close', { code, reason }); },
        addEventListener(type: string, fn: (ev: any) => void) { (listeners[type] ||= []).push(fn); },
        removeEventListener(type: string, fn: (ev: any) => void) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
      };
      const emit = (type: string, ev: any) => {
        const prop = inst['on' + type];
        if (typeof prop === 'function') prop.call(inst, ev);
        for (const fn of listeners[type] || []) fn(ev);
      };
      setTimeout(() => {
        inst.readyState = RealWS.OPEN; emit('open', {});
        setTimeout(() => emit('message', { data: JSON.stringify({
          type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-offline', timestamp: Date.now(),
        }) }), 10);
      }, 5);
      return inst;
    }
    (StubOrReal as any).CONNECTING = RealWS.CONNECTING;
    (StubOrReal as any).OPEN = RealWS.OPEN;
    (StubOrReal as any).CLOSING = RealWS.CLOSING;
    (StubOrReal as any).CLOSED = RealWS.CLOSED;
    (window as any).WebSocket = StubOrReal;
  });
}

/** The `/_next/static/**` pathnames currently held by the player shell tier. */
const shellPaths = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const out: string[] = [];
    const names = await caches.keys();
    for (const name of names.filter((n) => n.indexOf('edu-player-shell-') === 0)) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const p = new URL(req.url).pathname;
        if (p.indexOf('/_next/static/') === 0) out.push(p);
      }
    }
    return out;
  });

/**
 * Dev-server-only chunks. Next's HMR client is injected by `next dev` and
 * ships in no production build; it is fetched outside the app's own module
 * graph and is not part of what a kiosk runs. Excluding it keeps the
 * assertion about PLAYER code.
 */
const isDevOnlyChunk = (p: string) =>
  p.indexOf('hmr-client') !== -1 || p.indexOf('_browser_dev_') !== -1;

/** Ask the SW for an idle shell refresh and wait for its ack. */
const refreshShell = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const sw = navigator.serviceWorker.controller;
        if (!sw) return resolve(false);
        const done = (ev: MessageEvent) => {
          if (ev.data && ev.data.type === 'PRECACHE_SHELL_DONE') {
            navigator.serviceWorker.removeEventListener('message', done);
            resolve(true);
          }
        };
        navigator.serviceWorker.addEventListener('message', done);
        sw.postMessage({ type: 'PRECACHE_SHELL' });
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('message', done);
          resolve(false);
        }, 30_000);
      }),
  );

// This is the one player spec that NEEDS a live service worker: the whole
// assertion is "the SW served the renderer chunk while the network was
// down." The suite-wide `serviceWorkers: 'block'` would make it vacuous.
test.use({ serviceWorkers: 'allow' });

test.describe('lazy renderer survives a cold offline boot', () => {
  test('boot online → renderer chunk pinned → survives the shell prune → served offline', async ({ page, context, browserName }) => {
    test.setTimeout(180_000);

    // Record which JS the page pulls, and WHEN, relative to registration.
    // Chunks requested after `POST /screens/register` are — by construction
    // of the split — the renderer graph and nothing else.
    const beforeRegister: string[] = [];
    const afterRegister: string[] = [];
    const registered = { yet: false };
    page.on('request', (r) => {
      const u = r.url();
      if (u.indexOf('/api/v1/screens/register') !== -1) { registered.yet = true; return; }
      if (u.indexOf('/_next/static/') === -1 || !/\.js(\?|$)/.test(u)) return;
      let p = '';
      try { p = new URL(u).pathname; } catch { return; }
      if (isDevOnlyChunk(p)) return;
      (registered.yet ? afterRegister : beforeRegister).push(p);
    });

    await installWsStub(page);
    await installMocks(page);

    // ── 1. ONLINE BOOT ───────────────────────────────────────────────────
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android`);
    // The text only exists once the lazily-imported renderer resolved and
    // the TEXT widget mounted — this assertion IS the "the split works"
    // check as well as the setup for the offline half.
    await expect(page.getByText(PROOF_TEXT).first()).toBeVisible({ timeout: 90_000 });

    // ── 1b. A PER-FAMILY CHUNK LOADED TOO (P1-1) ─────────────────────────
    // TEXT is implemented inside WidgetRenderer, so the assertion above only
    // covers the renderer island. ANIMATED_WELCOME is a `lazyWidget` proxy
    // over its own module: its zone stays EMPTY until a second chunk lands,
    // so painted content here is the family split working — and it puts that
    // chunk into the `afterRegister` set every later step asserts on.
    await expect
      .poll(
        async () =>
          page.locator(`[data-zone-id="${FAMILY_ZONE_ID}"] *`).evaluateAll((els) =>
            els.some((el) => {
              if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return false;
              const r = (el as HTMLElement).getBoundingClientRect();
              return r.width > 4 && r.height > 4;
            }),
          ),
        { message: 'lazily-chunked widget family never painted', timeout: 60_000 },
      )
      .toBe(true);

    // ── 2. THE SPLIT ITSELF ──────────────────────────────────────────────
    // At least one player chunk was fetched only AFTER registration fired.
    // If this is ever empty the renderer is back on the pairing path and the
    // rest of this spec is meaningless.
    expect(afterRegister.length).toBeGreaterThan(0);
    // Every one of those late chunks must land in the shell tier — they are
    // exactly the entries the route-HTML parse cannot see. Two mechanisms
    // put them there: the SW's runtime capture (once it controls the client)
    // and the page's own idle PRECACHE_SHELL, which now declares the scripts
    // it is running on. The poll window covers that 8 s idle timer.
    const scripts = Array.from(new Set(afterRegister));
    await expect
      .poll(async () => {
        const cached = new Set(await shellPaths(page));
        return scripts.filter((s) => !cached.has(s));
      }, { timeout: 90_000 })
      .toEqual([]);

    // ── 3. THE STEP-3 GUARD ──────────────────────────────────────────────
    // Run a shell refresh that declares NO `extra` — the pure
    // route-HTML-parse shape. Its prune used to delete every entry absent
    // from that parse, i.e. precisely the lazy chunk we just proved is
    // cached. It must keep in-use runtime entries now.
    expect(await refreshShell(page)).toBe(true);
    const survived = new Set(await shellPaths(page));
    expect(scripts.filter((s) => !survived.has(s))).toEqual([]);

    // ── 4. THE BYTES ARE ON DISK ─────────────────────────────────────────
    // Engine-neutral proof that the renderer chunk can be served with no
    // network: read it straight out of Cache Storage and check it is a real,
    // non-empty response body, not just a key.
    const cachedBodies = await page.evaluate(async (paths: string[]) => {
      const out: Array<{ path: string; ok: boolean; bytes: number }> = [];
      for (const p of paths) {
        try {
          const r = await caches.match(p);
          const text = r ? await r.text() : '';
          out.push({ path: p, ok: !!r && r.ok, bytes: text.length });
        } catch (e) {
          out.push({ path: p, ok: false, bytes: 0 });
        }
      }
      return out;
    }, scripts);
    expect(cachedBodies.filter((r) => !r.ok || r.bytes === 0)).toEqual([]);

    // ── 5. OFFLINE, FOR REAL (chromium) ──────────────────────────────────
    // Kill the API mocks too: `route.fulfill` answers locally and would make
    // "offline" a fiction. With the network down and every API call aborted,
    // the ONLY thing that can serve this page is the service worker.
    //
    // CHROMIUM ONLY, and NOT because the player differs: Playwright's WebKit
    // does not keep service-worker interception alive under
    // `context.setOffline(true)` — every SW-routed fetch fails with a
    // network error, and a navigation throws "WebKit encountered an internal
    // error". That is a harness limitation. WebKit still runs steps 1-4
    // above, which cover the whole surface this wave changed (the split, the
    // shell capture, the prune, the cached bytes); only the offline
    // EMULATION is chromium-scoped. Written down rather than silently
    // dropped, per CLAUDE.md's absence-claim discipline.
    if (browserName !== 'chromium') return;

    await page.unroute('**/api/v1/screens/register');
    await page.unroute(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`);
    await page.route('**/api/v1/**', (route) => route.abort());
    await context.setOffline(true);

    const offlineStatuses = await page.evaluate(async (paths: string[]) => {
      const out: Array<{ path: string; ok: boolean; status: number }> = [];
      for (const p of paths) {
        try {
          const r = await fetch(p, { cache: 'no-store' });
          out.push({ path: p, ok: r.ok, status: r.status });
        } catch (e) {
          out.push({ path: p, ok: false, status: 0 });
        }
      }
      return out;
    }, scripts);
    expect(offlineStatuses.filter((r) => !r.ok)).toEqual([]);

    // ── 6. AND THE DOCUMENT ITSELF BOOTS OFFLINE ─────────────────────────
    {
      await page.reload();
      // The document came out of the shell tier: the player's own React app
      // booted — not the browser's dead "no internet" page, and not the SW's
      // last-resort "Waiting for network…" stub (which would mean the
      // document was never cached).
      await expect(page.locator('.kiosk-brand-name, [data-edu-player-root]').first())
        .toBeAttached({ timeout: 90_000 });
      await expect(page.getByText('Waiting for network')).toHaveCount(0);
    }
  });

});
