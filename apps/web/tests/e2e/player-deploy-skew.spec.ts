/* eslint-disable @typescript-eslint/no-explicit-any -- realtime WebSocket stub, same shape as player-chromium83-shim.spec.ts */
import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * DEPLOY SKEW — "client JS never started" (2026-10-27 field incident).
 *
 * After several website deploys and a rollback, player screens loaded the
 * player document but a `/_next/static` chunk it named was a 404 (another
 * deployment's file, or a 404 pinned by the HTTP cache), so the app never
 * booted: black glass, no registration, no remote. The inline recovery in
 * the player layout (skewRecovery.ts) must turn that into ONE cache-busted
 * reload and a booted player — and must never become a reload loop.
 *
 *   1. the first chunk request 404s → the page recovers BY ITSELF within the
 *      bound: one `_v` reload, `data-edu-booted`, a pairing code on glass;
 *   2. negative control: no failure → no reload at all;
 *   3. negative control: the chunk 404s FOREVER → exactly one reload, then
 *      the backoff holds (no loop), and the page is honestly not booted.
 */

const FAKE_SCREEN_ID = 'test-screen-0000000skew1';
const PAIRING_CODE = 'SKW123';
const BOUND_MS = 45_000;

async function installMocks(page: Page) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: false, screenId: FAKE_SCREEN_ID, pairingCode: PAIRING_CODE }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/pairing-status*`, (route) => ok(route, { paired: false }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/**`, (route) => ok(route, { ok: true }));
  await page.route('**/api/v1/emergency/**', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/**', (route) => ok(route, {}));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
  // No realtime socket in this harness: delegate everything else (HMR etc).
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      const inst: any = { url, readyState: RealWS.CONNECTING, onopen: null, onmessage: null, onerror: null, onclose: null,
        send() { /* swallow */ }, close() { inst.readyState = RealWS.CLOSED; }, addEventListener() { /* noop */ }, removeEventListener() { /* noop */ } };
      return inst;
    }
    (StubOrReal as any).CONNECTING = RealWS.CONNECTING; (StubOrReal as any).OPEN = RealWS.OPEN;
    (StubOrReal as any).CLOSING = RealWS.CLOSING; (StubOrReal as any).CLOSED = RealWS.CLOSED;
    (window as any).WebSocket = StubOrReal;
  });
}

/**
 * Count top-level DOCUMENT requests (each real load, incl. reloads). Not
 * `framenavigated`: that also fires for the router's / back trap's in-page
 * history writes, which are not loads.
 */
function countDocuments(page: Page) {
  const docs: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'document' && r.frame() === page.mainFrame()) docs.push(r.url());
  });
  return docs;
}

/** 404 the first `times` build-script requests (Infinity = forever). */
async function failBuildScripts(page: Page, times: number) {
  let failed = 0;
  let victim: string | null = null;
  await page.route('**/_next/static/**/*.js', (route) => {
    const path = new URL(route.request().url()).pathname;
    // Always fail the SAME chunk, so "forever" really means that file is gone.
    if (failed < times && (victim === null || victim === path)) {
      victim = path;
      failed++;
      return route.fulfill({ status: 404, body: '', headers: { 'cache-control': 'public,max-age=31536000,immutable' } });
    }
    return route.continue();
  });
  return () => failed;
}

const booted = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-edu-booted'));

test.describe('deploy skew — a missing chunk never leaves the player dead', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the first chunk request 404s → the page recovers by itself into the player within the bound', async ({ page }) => {
    test.setTimeout(120_000);
    await installMocks(page);
    const failed = await failBuildScripts(page, 1);
    const docs = countDocuments(page);
    const t0 = Date.now();
    await page.goto('/player?fp=test-fp-skew&client=android&w=1920&h=1080');
    await expect.poll(() => booted(page), { timeout: BOUND_MS }).toBe('1');
    await expect(page.locator('.kiosk-code-row')).toBeVisible({ timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(BOUND_MS + 15_000);
    expect(failed()).toBe(1);
    // Exactly one clean reload, carrying the cache-buster and every APK parameter.
    expect(docs.length).toBe(2);
    const u = new URL(page.url());
    expect(u.searchParams.get('_v')).toMatch(/^\d+$/);
    expect(u.searchParams.get('client')).toBe('android');
    expect(u.searchParams.get('fp')).toBe('test-fp-skew');
    // A successful boot clears the backoff ladder.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('edu_skew_recover')), { timeout: 5_000 }).toBeNull();
  });

  test('NEGATIVE CONTROL: nothing fails → no reload', async ({ page }) => {
    test.setTimeout(120_000);
    await installMocks(page);
    const docs = countDocuments(page);
    await page.goto('/player?fp=test-fp-skew-ok&client=android&w=1920&h=1080');
    await expect.poll(() => booted(page), { timeout: BOUND_MS }).toBe('1');
    await page.waitForTimeout(3_000);
    expect(docs.length).toBe(1);
    expect(new URL(page.url()).searchParams.get('_v')).toBeNull();
  });

  test('NEGATIVE CONTROL: the chunk is gone for good → one reload, then the backoff holds (no loop)', async ({ page }) => {
    test.setTimeout(120_000);
    await installMocks(page);
    await failBuildScripts(page, Infinity);
    const docs = countDocuments(page);
    await page.goto('/player?fp=test-fp-skew-dead&client=android&w=1920&h=1080');
    await expect.poll(() => docs.length, { timeout: BOUND_MS }).toBe(2);
    // Well past every fast-path and backstop deadline: still exactly one reload.
    await page.waitForTimeout(35_000);
    expect(docs.length).toBe(2);
    expect(await booted(page)).not.toBe('1');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('edu_skew_recover'))) || '{}')).toMatchObject({ n: 1 });
  });
});
