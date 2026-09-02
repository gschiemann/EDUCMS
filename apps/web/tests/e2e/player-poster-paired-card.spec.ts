/** Visual check: the PAIRED-no-schedule card on a 320×1080 poster at OS 1920 (post-fix). */
import { test, expect, type Page, type Route } from '@playwright/test';
const POSTER_UA = 'Mozilla/5.0 (Linux; Android 11; rk356x_box Build/RQ2A.210505.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36 EduCmsPlayer/1.1.12 (Android 11)';
const SID = 'test-screen-000000paired', TID = 'test-tenant-000000paired', FP = 'test-fp-poster-paired', TOKEN = 'boot.stored.token-not-real';
async function mocks(page: Page) {
  const ok = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.addInitScript(({ token }) => { try { localStorage.setItem('edu_device_token', token); for (const k of ['edu_canvasW','edu_canvasH','edu_canvasOrigin','edu_posterStandard']) localStorage.removeItem(k); } catch {} }, { token: TOKEN });
  await page.route('**/api/v1/screens/register', (r) => ok(r, { paired: true, screenId: SID, deviceToken: TOKEN, tenantId: TID, tenantName: 'Poster Tenant', status: 'ONLINE' }));
  await page.route(`**/api/v1/screens/${SID}/manifest*`, (r) => ok(r, { screenId: SID, screenName: 'LED Poster 2', tenantId: TID, tenantName: 'Poster Tenant', orientation: 'PORTRAIT', isEmergency: false, canvasW: 320, canvasH: 1080, posterStandard: { w: 320, h: 1080 }, hardwareModel: 'novastar-taurus', playlists: [] }));
  await page.route(`**/api/v1/screens/${SID}/status`, (r) => ok(r, { ok: true }));
  await page.route(`**/api/v1/screens/${SID}/cache-status`, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${SID}/render-proof`, (r) => ok(r, { ok: true }, 201));
  await page.route('**/api/v1/emergency/**', (r) => ok(r, { active: [] }));
  await page.route('**/api/v1/notifications/**', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (r) => ok(r, { version: '1.1.13', versionCode: 10113 }));
  await page.route('**/api/v1/player/update-check', (r) => ok(r, { available: true, version: '1.1.13' }));
  await page.route('**/api/v1/realtime/**', (r) => r.fulfill({ status: 204, body: '' }));
}
test.use({ userAgent: POSTER_UA, viewport: { width: 1920, height: 1080 } });
test('paired card at OS 1920 on a 320×1080 poster', async ({ page }) => {
  test.setTimeout(120_000);
  await mocks(page);
  await page.goto(`/player?fp=${FP}&client=android&w=1920&h=1080&v=1.1.12&vc=10112`);
  await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const m = await page.evaluate(() => {
    const px = (v: string) => parseInt(v, 10) || 0; const st = document.documentElement.style;
    const h = document.querySelector('h1,h2,h3');
    const big = Array.from(document.querySelectorAll('body *')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 322; }).length;
    return { ledW: px(st.getPropertyValue('--led-w')), htmlW: Math.round(document.documentElement.getBoundingClientRect().width), headingPx: h ? getComputedStyle(h).fontSize : null, elementsPastColumn: big, splashK: getComputedStyle(document.documentElement).getPropertyValue('--splash-k') };
  });
  console.log('PAIRED-CARD ' + JSON.stringify(m));
  await page.screenshot({ path: 'test-results/poster-paired-card-1920.png', clip: { x: 0, y: 0, width: 320, height: 1080 } });
  expect(m.htmlW).toBe(320);
});
