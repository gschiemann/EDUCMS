/**
 * The operator/diagnostic card must FIT the glass — no cut-off middle.
 *
 * Greg, 2026-09-19, photo of a TC32 (1920×1080 Android LCD) sitting on
 * "Playback Paused":
 *   "all 1920x1080 screens are cutting the resolution on the paired splash screen"
 *
 * THE MECHANISM. `--splash-k` scales every element of this card. A panel with
 * no LED canvas pin gets a 1.5 FLOOR (2026-09-02, the G24 "12 px labels on a
 * TV" fix), and the value is derived from the LONG edge only — 1.5 is the size
 * for a 2880×1620 panel. On 1080 px of height the header and footer grow so
 * much that the middle section (Storage & Cache, Activity) — which the
 * 2026-05-04 layout deliberately makes `overflow-y: auto` so the buttons can
 * never be pushed off — is left a thin slice and SCROLLS. A wall-mounted TV
 * cannot scroll, so on glass that reads as the card being cut off.
 *
 * This spec reproduces the TC32's exact inputs — APK URL params w=1920&h=1080
 * (so `--led-w` is set but `data-led-cfg` is "0"), an LCD user agent, a real
 * playlist, then the remote's Back → Paused — and measures the scroll body.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const LCD_UA =
  'Mozilla/5.0 (Linux; Android 11; TC32 Build/RKQ1.210503.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36 EduCmsPlayer/1.1.16 (Android 11)';
const SID = 'test-screen-00000splashfit';
const TID = 'test-tenant-00000splashfit';
const FP = 'test-fp-lcd-splash-fit';
const TOKEN = 'boot.stored.token-not-real';

function manifest() {
  return {
    screenId: SID,
    screenName: 'TC32',
    tenantId: TID,
    tenantName: 'Splash Fit Tenant',
    orientation: 'LANDSCAPE',
    isEmergency: false,
    playlists: [{
      id: 'pl-frog-1920',
      name: 'Frog 1920',
      template: {
        id: 'tpl-frog-1920', name: 'Frog 1920', screenWidth: 1920, screenHeight: 1080, bgColor: '#0f766e',
        zones: [
          { id: 'z-a', name: 'Headline', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 60, zIndex: 0, defaultConfig: { content: 'Frog 1920', fontSize: 96, color: '#ffffff' } },
          { id: 'z-b', name: 'Clock', widgetType: 'CLOCK', x: 0, y: 60, width: 100, height: 40, zIndex: 0, defaultConfig: {} },
        ],
      },
      items: [],
    }],
  };
}

async function installMocks(page: Page) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.addInitScript(({ token }) => {
    try {
      localStorage.setItem('edu_device_token', token);
      for (const k of ['edu_canvasW', 'edu_canvasH', 'edu_canvasOrigin', 'edu_posterStandard']) localStorage.removeItem(k);
    } catch { /* ignore */ }
  }, { token: TOKEN });
  await page.route('**/api/v1/screens/register', (r) =>
    ok(r, { paired: true, screenId: SID, deviceToken: TOKEN, tenantId: TID, tenantName: 'Splash Fit Tenant', status: 'ONLINE' }));
  await page.route(`**/api/v1/screens/${SID}/manifest*`, (r) => ok(r, manifest()));
  await page.route(`**/api/v1/screens/${SID}/status`, (r) => ok(r, { ok: true }));
  await page.route(`**/api/v1/screens/${SID}/cache-status`, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${SID}/render-proof`, (r) => ok(r, { ok: true }, 201));
  await page.route('**/api/v1/emergency/**', (r) => ok(r, { active: [] }));
  await page.route('**/api/v1/notifications/**', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (r) => ok(r, { versionName: '1.1.16', versionCode: 10116 }));
  await page.route('**/api/v1/player/update-check', (r) => ok(r, { available: false }));
  await page.route('**/api/v1/realtime/**', (r) => r.fulfill({ status: 204, body: '' }));
}

/** What the glass actually shows: the scale, and whether the middle is cut. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('.edu-diag-scale') as HTMLElement | null;
    const body = (card?.querySelector('[data-splash-body]')
      || card?.querySelector('.overflow-y-auto')) as HTMLElement | null;
    const resume = Array.from(document.querySelectorAll('button'))
      .find((b) => /Resume/.test(b.textContent || '')) as HTMLElement | undefined;
    const h = window.innerHeight;
    return {
      viewport: `${window.innerWidth}x${h}`,
      splashK: getComputedStyle(document.documentElement).getPropertyValue('--splash-k').trim(),
      ledCfg: document.documentElement.getAttribute('data-led-cfg'),
      // How much of the middle section is hidden behind its own scrollbar.
      bodyOverflowPx: body ? body.scrollHeight - body.clientHeight : null,
      bodyClientH: body ? body.clientHeight : null,
      bodyScrollH: body ? body.scrollHeight : null,
      cardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
      resumeBottom: resume ? Math.round(resume.getBoundingClientRect().bottom) : null,
      headingPx: getComputedStyle(document.querySelector('h1') as Element).fontSize,
    };
  });
}

test.use({ userAgent: LCD_UA, viewport: { width: 1920, height: 1080 } });

test('Paused card on a 1920×1080 LCD fits the glass — nothing hidden behind a scroll', async ({ page }) => {
  test.setTimeout(180_000);
  await installMocks(page);
  await page.goto(`/player?fp=${FP}&client=android&w=1920&h=1080&v=1.1.16&vc=10116`);

  // Content playing = mount effects have run (the Back listener is attached).
  // The playback surface's own info toggle is the marker — it renders only
  // once a playlist is on screen, whatever the widgets inside it say.
  await expect(page.getByRole('button', { name: 'Toggle screen info overlay' })).toBeVisible({ timeout: 90_000 });

  // The remote's Back key.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));
  await expect(page.getByRole('heading', { name: 'Playback Paused' })).toBeVisible({ timeout: 10_000 });
  // Let the storage / activity cards fill in and the fit settle.
  await page.waitForTimeout(3000);

  const m = await measure(page);
  console.log('SPLASH-FIT ' + JSON.stringify(m));
  await page.screenshot({ path: 'test-results/splash-fit-1920x1080-paused.png' });

  // Nothing in the middle may be hidden: a TV cannot scroll. Measured 3 s
  // after the fit, so every CSS transition has landed — a fit that only held
  // mid-transition would fail here.
  expect(m.bodyOverflowPx).not.toBeNull();
  expect(m.bodyOverflowPx as number).toBeLessThanOrEqual(1);
  // The actions stay on the glass.
  expect(m.resumeBottom as number).toBeLessThanOrEqual(1080);
  // The document-level scale is untouched — the corner chips and the
  // Screen-options dialog still get the 1.5 the 2026-09-02 fix gave them.
  expect(Number(m.splashK)).toBe(1.5);

  // THE FIT IS TIGHT, NOT JUST SAFE. The first cut of this passed everything
  // above while choosing 1.2 where 1.25 fit — transition lag polluted its
  // measurements. So: the card's own override is below the base, never below
  // the design size, and ONE STEP LARGER really does overflow.
  const tight = await page.evaluate(() => {
    const body = document.querySelector('[data-splash-body]') as HTMLElement;
    const scope = body.closest('.edu-paired-view') as HTMLElement;
    const chosen = parseFloat(scope.style.getPropertyValue('--splash-k'));
    scope.setAttribute('data-splash-fitting', '');
    scope.style.setProperty('--splash-k', String(Math.round((chosen + 0.05) * 100) / 100));
    const overAtNextStep = body.scrollHeight - body.clientHeight;
    scope.style.setProperty('--splash-k', String(chosen));
    const overAtChosen = body.scrollHeight - body.clientHeight;
    scope.removeAttribute('data-splash-fitting');
    return { chosen, overAtNextStep, overAtChosen };
  });
  console.log('SPLASH-FIT-TIGHT ' + JSON.stringify(tight));
  expect(tight.chosen).toBeGreaterThanOrEqual(1);
  expect(tight.chosen).toBeLessThan(1.5);
  expect(tight.overAtChosen).toBeLessThanOrEqual(1);
  expect(tight.overAtNextStep).toBeGreaterThan(1);
});

test('a panel with room to spare keeps its scale exactly — portrait 1080×1920', async ({ browser }) => {
  // The veto must not touch a card that already fits. A portrait LCD has the
  // same 1.5 base (long edge 1920) and 1920 px of height to put it in.
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ userAgent: LCD_UA, viewport: { width: 1080, height: 1920 } });
  const page = await ctx.newPage();
  await installMocks(page);
  await page.goto(`/player?fp=${FP}-portrait&client=android&w=1080&h=1920&v=1.1.16&vc=10116`);
  await expect(page.getByRole('button', { name: 'Toggle screen info overlay' })).toBeVisible({ timeout: 90_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));
  await expect(page.getByRole('heading', { name: 'Playback Paused' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const body = document.querySelector('[data-splash-body]') as HTMLElement;
    const scope = body.closest('.edu-paired-view') as HTMLElement;
    return {
      base: getComputedStyle(document.documentElement).getPropertyValue('--splash-k').trim(),
      override: scope.style.getPropertyValue('--splash-k'),
      over: body.scrollHeight - body.clientHeight,
    };
  });
  console.log('SPLASH-FIT-PORTRAIT ' + JSON.stringify(r));
  expect(r.base).toBe('1.5');
  expect(r.override).toBe('');       // no write at all
  expect(r.over).toBeLessThanOrEqual(1);
  await ctx.close();
});
