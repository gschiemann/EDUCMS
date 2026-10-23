import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * REALTIME RECONNECT — the push channel always comes back (player 1.1.51).
 *
 * Field finding 2026-10-22: across the fleet `last_push_connected_at` froze
 * for 6–18 h while HTTP polling stayed fresh and the API saw no new WS
 * attempts. Every re-arm hung off `ws.onclose`; a socket that never reached
 * it (CONNECTING forever behind an edge that accepted TCP and never answered
 * the upgrade) left the page with no push, no SSE, no retry — until a reload.
 *
 * This spec drives the player's `/realtime` socket through a controllable
 * stub (every other WebSocket URL is delegated to the real constructor —
 * credential-lifecycle.spec.ts's harness lesson) and proves, WITHOUT a page
 * reload:
 *   1. a socket that hangs in CONNECTING (no onclose, ever) is abandoned and
 *      redialled, repeatedly, by the supervisor;
 *   2. an outage longer than the longest backoff (30 s) ends in a fresh
 *      AUTH_OK once the server is back;
 *   3. the document is the same one throughout (a boot marker survives).
 *
 * Modeled on credential-lifecycle.spec.ts: every API call intercepted, fake
 * identities only, the fake API base NXDOMAINs if a route is missing.
 */

const FAKE_SCREEN_ID = 'test-screen-00000000rtws';
const FAKE_TENANT_ID = 'test-tenant-00000000rtws';
const FAKE_FINGERPRINT = 'test-fp-realtime-reconnect';
const BOOT_TOKEN = 'boot.stored.token-not-real';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const IMG_URL = 'http://api.invalid/assets/one.png';

function playingManifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'RT Test Tenant',
    orientation: 'LANDSCAPE',
    isEmergency: false,
    playlists: [
      {
        id: 'pl-1',
        name: 'One Image',
        schedule: { daysOfWeek: null, timeStart: null, timeEnd: null, mode: 'replace', pin: 'screen', priority: 0 },
        items: [
          { item_id: 'item-1', asset_id: 'asset-1', asset_hash: null, url: IMG_URL, duration_ms: 60_000, sequence: 0, mime_type: 'image/png', muted: true },
        ],
      },
    ],
  };
}

async function installMocks(page: Page) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(IMG_URL, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'RT Test Screen', deviceToken: BOOT_TOKEN }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => ok(route, playingManifest()));
  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'RT Test Screen', tenantId: FAKE_TENANT_ID }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, (route) => ok(route, { assets: [], setHash: 'empty' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  // SSE ticket / stream: refuse, so the test measures the WS lane alone.
  await page.route('**/api/v1/realtime/**', (route) => route.fulfill({ status: 503, body: '' }));
}

/**
 * The controllable `/realtime` stub. `window.__rt.mode`:
 *   'ok'   → opens, answers AUTH_OK, answers every HEARTBEAT with an ack
 *   'hang' → stays CONNECTING forever and NEVER fires close (the field hole)
 *   'down' → closes at once (code 1006), like a refused connect
 * `window.__rt.attempts` counts constructor calls; `authOks` counts AUTH_OKs
 * delivered; `dropCurrent()` severs the live socket (server-side drop).
 */
async function installControllableWs(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    const rt: any = { mode: 'ok', attempts: 0, authOks: 0, current: null as any, bootMarker: Math.random().toString(36).slice(2) };
    (window as any).__rt = rt;
    rt.dropCurrent = () => { const c = rt.current; if (c && c.readyState === RealWS.OPEN) c.__serverClose(1006, 'dropped'); };
    function Stub(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      rt.attempts += 1;
      const listeners: Record<string, Array<(ev: any) => void>> = {};
      const inst: any = {
        url,
        readyState: RealWS.CONNECTING,
        onopen: null, onmessage: null, onerror: null, onclose: null,
        send(raw: string) {
          if (rt.mode !== 'ok' || inst.readyState !== RealWS.OPEN) return;
          try {
            const m = JSON.parse(raw);
            if (m.event === 'HEARTBEAT') setTimeout(() => emit('message', { data: JSON.stringify({ type: 'HEARTBEAT_ACK', timestamp: Date.now() }) }), 5);
          } catch { /* ignore */ }
        },
        close(code = 1000, reason = '') {
          if (inst.readyState === RealWS.CLOSED) return;
          if (rt.mode === 'hang' && inst.readyState === RealWS.CONNECTING) {
            // The field hole: a close() on a hung handshake never produces onclose.
            inst.readyState = RealWS.CLOSING;
            return;
          }
          inst.readyState = RealWS.CLOSED;
          emit('close', { code, reason });
        },
        __serverClose(code: number, reason: string) { inst.readyState = RealWS.CLOSED; emit('close', { code, reason }); },
        addEventListener(type: string, fn: (ev: any) => void) { (listeners[type] ||= []).push(fn); },
        removeEventListener(type: string, fn: (ev: any) => void) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
      };
      const emit = (type: string, ev: any) => {
        const prop = inst['on' + type];
        if (typeof prop === 'function') prop.call(inst, ev);
        for (const fn of listeners[type] || []) fn(ev);
      };
      rt.current = inst;
      const mode = rt.mode;
      if (mode === 'hang') return inst;
      if (mode === 'down') { setTimeout(() => inst.__serverClose(1006, 'refused'), 5); return inst; }
      setTimeout(() => {
        if (inst.readyState !== RealWS.CONNECTING) return;
        inst.readyState = RealWS.OPEN;
        emit('open', {});
        setTimeout(() => {
          if (inst.readyState !== RealWS.OPEN) return;
          rt.authOks += 1;
          emit('message', { data: JSON.stringify({ type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-' + rt.authOks, timestamp: Date.now() }) });
        }, 10);
      }, 5);
      return inst;
    }
    (Stub as any).CONNECTING = RealWS.CONNECTING;
    (Stub as any).OPEN = RealWS.OPEN;
    (Stub as any).CLOSING = RealWS.CLOSING;
    (Stub as any).CLOSED = RealWS.CLOSED;
    (window as any).WebSocket = Stub;
  });
}

function seedIdentity(page: Page) {
  return page.addInitScript(({ token, fp }) => {
    try { localStorage.setItem('edu_device_fp', fp); localStorage.setItem('edu_device_token', token); } catch { /* unreachable */ }
  }, { token: BOOT_TOKEN, fp: FAKE_FINGERPRINT });
}

const rt = (page: Page) => page.evaluate(() => {
  const r = (window as any).__rt;
  return { mode: r.mode, attempts: r.attempts, authOks: r.authOks, bootMarker: r.bootMarker, state: (window as any).__eduRealtime?.state?.() ?? null };
});

test.describe('realtime reconnect — the push channel always comes back', () => {
  test('a hung handshake is abandoned and redialled; an outage longer than the longest backoff ends in a fresh AUTH_OK, same document', async ({ page }) => {
    test.setTimeout(240_000);
    await installControllableWs(page);
    await seedIdentity(page);
    await installMocks(page);

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await expect(page.locator('img[src*="one.png"]'), 'baseline: content on glass').toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await rt(page)).authOks, { timeout: 30_000, message: 'baseline AUTH_OK never arrived' }).toBeGreaterThanOrEqual(1);
    const base = await rt(page);
    expect(base.state, '__eduRealtime support hook is mounted').not.toBeNull();

    // ── 1. THE FIELD HOLE: the server drops us, and every redial now hangs in CONNECTING.
    await page.evaluate(() => { (window as any).__rt.mode = 'hang'; (window as any).__rt.dropCurrent(); });
    const attemptsAtDrop = base.attempts;
    // The first redial comes from onclose (the old path); the SECOND and THIRD can only come
    // from the supervisor abandoning a hung socket (CONNECTING_MAX_MS = 20 s + backoff).
    await expect
      .poll(async () => (await rt(page)).attempts, { timeout: 120_000, message: 'the supervisor never abandoned a hung CONNECTING socket — the field hole is back' })
      .toBeGreaterThanOrEqual(attemptsAtDrop + 3);
    const stuck = await rt(page);
    expect(stuck.authOks, 'nothing authenticated while hung').toBe(base.authOks);
    expect(stuck.state.abandons, 'the abandons were the supervisor\'s').toBeGreaterThanOrEqual(2);

    // ── 2. A plain outage for longer than the 30 s backoff cap, then the server is back.
    await page.evaluate(() => { (window as any).__rt.mode = 'down'; });
    await page.waitForTimeout(40_000);
    await page.evaluate(() => { (window as any).__rt.mode = 'ok'; });
    await expect
      .poll(async () => (await rt(page)).authOks, { timeout: 60_000, message: 'no fresh AUTH_OK after the outage ended' })
      .toBeGreaterThan(base.authOks);

    // ── 3. Same document throughout: no reload did this for us.
    const after = await rt(page);
    expect(after.bootMarker).toBe(base.bootMarker);
    expect(after.state.authOk).toBe(true);
    expect(after.state.failCount).toBe(0);
    await expect(page.locator('img[src*="one.png"]'), 'content stayed on glass').toBeVisible();
  });
});
