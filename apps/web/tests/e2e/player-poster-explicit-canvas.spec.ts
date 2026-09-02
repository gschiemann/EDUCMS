/**
 * LED poster — PAIRED with content: where does the picture land?
 *
 * Field report (Greg, 2026-09-02, NovaStar TB poster, OS 1920×1080 factory):
 *   • dashboard "1 poster" (explicit 320×1080) + OS 1920×1080 → screen BLACK
 *   • dashboard "1 poster" + OS 960×1080 → correct
 *   • dashboard "Off" + OS 1920 → "does not display correctly"
 *   • the PAIRING screen at OS 1920 is perfect.
 * The LED shows the top-left 320×1080 of the OS canvas, so the only thing
 * that matters is: does the rendered content sit inside x<320, y<1080, and
 * is anything painted there at all.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const POSTER_UA =
  'Mozilla/5.0 (Linux; Android 11; rk356x_box Build/RQ2A.210505.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36 EduCmsPlayer/1.1.12 (Android 11)';
const SID = 'test-screen-0000000expl';
const TID = 'test-tenant-0000000expl';
const FP = 'test-fp-poster-explicit';
const TOKEN = 'boot.stored.token-not-real';

function manifest(canvas: { w: number; h: number } | null) {
  return {
    screenId: SID, screenName: 'Poster', tenantId: TID, tenantName: 'Poster Tenant',
    orientation: 'PORTRAIT', isEmergency: false,
    canvasW: canvas?.w ?? null, canvasH: canvas?.h ?? null,
    posterStandard: { w: 320, h: 1080 }, hardwareModel: 'novastar-taurus',
    playlists: [{
      id: 'pl-poster', name: 'Poster playlist',
      template: {
        id: 'tpl-poster', name: 'Poster', screenWidth: 320, screenHeight: 1080, bgColor: '#ff0066',
        zones: [
          { id: 'z-top', name: 'Top', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 50, zIndex: 0, defaultConfig: { text: 'TOP HALF', fontSize: 48, color: '#ffffff' } },
          { id: 'z-bottom', name: 'Bottom', widgetType: 'CLOCK', x: 0, y: 50, width: 100, height: 50, zIndex: 0, defaultConfig: {} },
        ],
      },
      items: [],
    }],
  };
}

async function installMocks(page: Page, canvas: { w: number; h: number } | null, opts: { storedPin?: { w: number; h: number; origin: string } | null } = {}) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.addInitScript(({ token, pin }) => {
    try {
      localStorage.setItem('edu_device_token', token);
      if (!sessionStorage.getItem('pw-fresh')) {
        for (const k of ['edu_canvasW', 'edu_canvasH', 'edu_canvasOrigin', 'edu_posterStandard']) localStorage.removeItem(k);
        if (pin) { localStorage.setItem('edu_canvasW', String(pin.w)); localStorage.setItem('edu_canvasH', String(pin.h)); localStorage.setItem('edu_canvasOrigin', pin.origin); }
        sessionStorage.setItem('pw-fresh', '1');
      }
      (window as any).__pwLoads = ((Number(sessionStorage.getItem('pw-loads')) || 0) + 1);
      sessionStorage.setItem('pw-loads', String((window as any).__pwLoads));
    } catch { /* ignore */ }
  }, { token: TOKEN, pin: opts.storedPin ?? null });
  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: SID, deviceToken: TOKEN, tenantId: TID, tenantName: 'Poster Tenant', status: 'ONLINE' }));
  await page.route(`**/api/v1/screens/${SID}/manifest*`, (route) => ok(route, manifest(canvas)));
  await page.route(`**/api/v1/screens/${SID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${SID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${SID}/render-proof`, (route) => ok(route, { ok: true }, 201));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
  await page.route('**/api/v1/realtime/**', (route) => route.fulfill({ status: 204, body: '' }));
}

async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      const listeners: Record<string, Array<(ev: any) => void>> = {};
      const inst: any = { url, readyState: RealWS.CONNECTING, onopen: null, onmessage: null, onerror: null, onclose: null,
        send() {}, close(code = 1000, reason = '') { inst.readyState = RealWS.CLOSED; emit('close', { code, reason }); },
        addEventListener(t: string, fn: any) { (listeners[t] ||= []).push(fn); },
        removeEventListener(t: string, fn: any) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); } };
      const emit = (t: string, ev: any) => { const p = inst['on' + t]; if (typeof p === 'function') p.call(inst, ev); for (const fn of listeners[t] || []) fn(ev); };
      setTimeout(() => { inst.readyState = RealWS.OPEN; emit('open', {}); setTimeout(() => emit('message', { data: JSON.stringify({ type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-expl', timestamp: Date.now() }) }), 10); }, 5);
      return inst;
    }
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) (StubOrReal as any)[k] = (RealWS as any)[k];
    (window as any).WebSocket = StubOrReal;
  });
}

const probe = (page: Page) => page.evaluate(() => {
  const st = document.documentElement.style;
  const px = (v: string) => parseInt(v.trim().replace('px', ''), 10) || 0;
  const rect = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const zones = Array.from(document.querySelectorAll('[data-zone-id]')).map((z) => ({ id: z.getAttribute('data-zone-id'), rect: rect(z), text: (z as HTMLElement).innerText.slice(0, 30) }));
  const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null;
  const scaler = document.querySelector('[data-template-scaler],[data-edu-scaler]');
  return {
    ledW: px(st.getPropertyValue('--led-w')), ledH: px(st.getPropertyValue('--led-h')),
    htmlW: Math.round(document.documentElement.getBoundingClientRect().width), innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio,
    poster: document.documentElement.getAttribute('data-led-poster'), narrow: document.documentElement.getAttribute('data-led-narrow'),
    storedW: localStorage.getItem('edu_canvasW'), origin: localStorage.getItem('edu_canvasOrigin'), meta, loads: (window as any).__pwLoads,
    bodyBg: getComputedStyle(document.body).backgroundColor, zones, scalerRect: rect(scaler),
    softBlank: !!document.querySelector('[data-edu-soft-blank]'),
  };
});

const CASES: Array<{ name: string; osW: number; canvas: { w: number; h: number } | null; pin?: { w: number; h: number; origin: string } | null }> = [
  { name: '1 poster (320×1080) at OS 1920 — Greg: BLACK', osW: 1920, canvas: { w: 320, h: 1080 } },
  { name: '1 poster (320×1080) at OS 960 — Greg: works', osW: 960, canvas: { w: 320, h: 1080 } },
  { name: 'Off (no canvas) at OS 1920 — Greg: wrong', osW: 1920, canvas: null },
  { name: 'Off at OS 1920 with a STALE server pin left in storage', osW: 1920, canvas: null, pin: { w: 320, h: 1080, origin: 'server' } },
];

test.describe('LED poster paired with content', () => {
  test.use({ userAgent: POSTER_UA, viewport: { width: 1920, height: 1080 } });
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      test.setTimeout(150_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e.message)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
      await installWsStub(page);
      await installMocks(page, c.canvas, { storedPin: c.pin ?? null });
      await page.goto(`/player?fp=${FP}&client=android&w=${c.osW}&h=1080`);
      // (with content in the manifest the page skips the paired banner)
      // Wait for content: a zone in the DOM.
      await expect(page.locator('[data-zone-id="z-top"]')).toBeAttached({ timeout: 60_000 });
      await page.waitForTimeout(4000);
      const p = await probe(page);
      await page.screenshot({ path: `test-results/poster-paired-${c.osW}-${c.canvas ? c.canvas.w : 'off'}${c.pin ? '-stalepin' : ''}.png`, clip: { x: 0, y: 0, width: Math.min(1920, Math.max(320, p.htmlW || 320)), height: 1080 } });
      console.log(`\n=== ${c.name} ===\n` + JSON.stringify({ ...p, errors: errors.slice(0, 6) }, null, 1));
      // The claim under test: every zone lies inside the visible 320×1080 column.
      for (const z of p.zones) {
        expect(z.rect, `zone ${z.id} rect`).not.toBeNull();
        expect(z.rect!.x + z.rect!.w, `zone ${z.id} right edge`).toBeLessThanOrEqual(322);
        expect(z.rect!.w, `zone ${z.id} width`).toBeGreaterThan(0);
      }
      expect(p.loads, 'reload count (a reload loop shows here)').toBeLessThanOrEqual(2);
      expect(p.softBlank, 'no soft blank overlay').toBe(false);
    });
  }
});
