/**
 * Two panes, ONE origin, ONE localStorage — the double-sided display, in a browser.
 *
 * A DH43's back side is a second WebView in the same Android process on the same
 * origin as the front, so the two share a single `localStorage`. This spec puts
 * two real player documents in one browser context (which shares storage exactly
 * the same way) and lets each mint its own credential.
 *
 * Without the isolation script in player/layout.tsx the back's mint overwrites
 * `edu_device_token`, the front picks it up, and both panes collapse onto one
 * Screen row. Jest proves the script in jsdom; this proves it in the actual
 * document, ahead of the actual pre-paint canvas script, against the actual
 * player boot.
 */
import { test, expect, type BrowserContext, type Route } from '@playwright/test';

const FRONT_FP = 'test-fp-dh43-front';
const BACK_FP = `${FRONT_FP}::face1`;
const FRONT = { sid: 'test-screen-0000000front', token: 'front.minted.token-not-real' };
const BACK = { sid: 'test-screen-00000000back', token: 'back.minted.token-not-real' };

async function mocks(ctx: BrowserContext) {
  const ok = (r: Route, body: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/api/v1/screens/register', (r) => {
    const isBack = (r.request().postData() || '').includes('::face1');
    const who = isBack ? BACK : FRONT;
    return ok(r, { paired: true, screenId: who.sid, deviceToken: who.token, tenantId: 't', tenantName: 'DH43 Tenant', status: 'ONLINE' });
  });
  for (const who of [FRONT, BACK]) {
    await ctx.route(`**/api/v1/screens/${who.sid}/manifest*`, (r) =>
      ok(r, { screenId: who.sid, screenName: who === FRONT ? 'DH43' : 'DH43 — Back', tenantId: 't', tenantName: 'DH43 Tenant', orientation: 'LANDSCAPE', isEmergency: false, playlists: [] }));
    await ctx.route(`**/api/v1/screens/${who.sid}/**`, (r) => ok(r, { ok: true }));
  }
  await ctx.route('**/api/v1/emergency/**', (r) => ok(r, { active: [] }));
  await ctx.route('**/api/v1/notifications/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route('**/api/v1/player/**', (r) => ok(r, { available: false }));
  await ctx.route('**/api/v1/realtime/**', (r) => r.fulfill({ status: 204, body: '' }));
}

test('front and back each keep their own credential in one shared localStorage', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await mocks(ctx);

  // ── the FRONT: an ordinary screen. Nothing about it may change. ──
  const front = await ctx.newPage();
  await front.goto(`/player?fp=${FRONT_FP}`);
  await expect(front.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 120_000 });
  expect(await front.evaluate(() => (window as unknown as { __eduFaceStorage?: number }).__eduFaceStorage)).toBeUndefined();
  await expect.poll(() => front.evaluate(() => localStorage.getItem('edu_device_token'))).toBe(FRONT.token);

  // ── the BACK: same origin, same storage, second document. ──
  const back = await ctx.newPage();
  await back.goto(`/player?face=1&fp=${encodeURIComponent(BACK_FP)}`);
  await expect(back.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 120_000 });
  expect(await back.evaluate(() => (window as unknown as { __eduFaceStorage?: number }).__eduFaceStorage)).toBe(1);
  // Through ITS OWN eyes the back holds its own token…
  await expect.poll(() => back.evaluate(() => localStorage.getItem('edu_device_token'))).toBe(BACK.token);

  // ── the truth, read from the front's un-shimmed view of the SHARED store ──
  const shared = await front.evaluate(() => {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (/device_token|device_fp/.test(k)) out[k] = localStorage.getItem(k);
    }
    return out;
  });
  console.log('FACE-STORAGE ' + JSON.stringify(shared));
  // …and the front's credential was never touched.
  expect(shared['edu_device_token']).toBe(FRONT.token);
  expect(shared['edu_device_token__face1']).toBe(BACK.token);
  expect(shared['edu_device_fp__face1']).toBe(BACK_FP);
  expect(shared['edu_device_fp']).not.toBe(BACK_FP);

  // The front keeps running on its own credential after the back has booted.
  await front.reload();
  await expect(front.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 120_000 });
  expect(await front.evaluate(() => localStorage.getItem('edu_device_token'))).toBe(FRONT.token);
  await ctx.close();
});

test('a malformed face param never runs the player against the shared store', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  await mocks(ctx);
  const page = await ctx.newPage();
  let registered = false;
  page.on('request', (r) => { if (r.url().includes('/screens/register')) registered = true; });
  await page.goto(`/player?face=9&fp=${FRONT_FP}`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => (window as unknown as { __eduFaceStorage?: number }).__eduFaceStorage).catch(() => -1)).toBe(-1);
  expect(registered).toBe(false);
  await ctx.close();
});
