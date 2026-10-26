import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

/**
 * UNPAIR CONFIRMATION — remote-operable, and never outlives its menu.
 *
 * The field find (2026-10-26, a Goodview 24" on site): Back opened the
 * Screen options menu; the owner pressed Unpair by accident and got the
 * DASHBOARD's confirm dialog. The remote could not reach its buttons, and the
 * APK's Back — delivered as `edu-show-stop-overlay`, never as a key the dialog
 * listened to — closed the menu UNDERNEATH it: content resumed with "Unpair
 * this screen?" drawn over it until the app was restarted.
 *
 * Driven with keyboard events only (the remote's arrows / OK / Back) on
 * chromium AND webkit, these tests prove:
 *  1. focus lands on "Keep paired", visibly, and the arrows move it;
 *  2. every kind of Back (the APK's event, a raw Escape, a GoBack key) closes
 *     ONLY the question — the menu stays up, the remote is parked back on
 *     "Unpair device", and the menu still works;
 *  3. resuming playback leaves no question on the glass, and the next Back
 *     opens a clean menu;
 *  4. OK on "Keep paired" cancels; OK on "Unpair" calls the unpair path;
 *  5. an alert closes the question and owns the glass (an alert always wins);
 *  6. the idle card's two askers (Unpair, Auto-Play's notice) follow the same
 *     rules.
 *
 * Harness (CLAUDE.md player rule 14) through the shared mock-player helper:
 * the realtime stub delegates non-/realtime sockets, mocks key on STATE (the
 * unpair calls are counted, never expected to arrive N times for a reason
 * other than an answer), and the content — or the paired card — only appears
 * after the mount effects ran, so it is the hydration gate before any key.
 */

test.use({ serviceWorkers: 'block' });

const SLIDES = 'img[data-slide-id]';
const paused = (page: Page) => page.getByRole('heading', { name: 'Playback Paused' });
const resume = (page: Page) => page.getByRole('button', { name: /Resume/ });
const question = (page: Page) => page.getByRole('alertdialog', { name: 'Unpair this screen?' });
const anyQuestion = (page: Page) => page.locator('[data-edu-remote-dialog]');
// Scoped to the dialog: the idle card's own "Unpair" button sits behind the scrim.
const keepPaired = (page: Page) => question(page).getByRole('button', { name: 'Keep paired' });
const unpairAnswer = (page: Page) => question(page).getByRole('button', { name: 'Unpair', exact: true });
const unpairLink = (page: Page) => page.getByRole('button', { name: 'Unpair device' });
/** Whichever emergency layer paints this alert (overlay, fallback, media, pending). */
const alertOnGlass = (page: Page) => page.locator('[data-edu-emergency-root], [data-edu-emergency-pending]').first();

/** The APK's Back: MainActivity → evaluateJavascript("…'edu-show-stop-overlay'…"). */
const apkBack = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));
/** An OEM remote whose Back arrives as a raw `GoBack` key (no Playwright key name for it). */
const goBackKey = (page: Page) =>
  page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true, cancelable: true }));
  });
/**
 * Two frames between Back presses. The page re-registers its Back listener in
 * an effect after every menu toggle; a person never presses twice inside two
 * frames, a test can (see player-remote-escape.spec.ts `settle`).
 */
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

/**
 * Player rule 14: never send a key before the page's listeners are attached.
 * `data-edu-booted` is stamped by a mount effect declared AFTER the Back
 * listener's effect, so its presence proves the listener is live (SSR text,
 * which paints first, cannot).
 */
const waitForMount = (page: Page) => expect(page.locator('html[data-edu-booted="1"]')).toHaveCount(1, { timeout: 30_000 });

/** Walk the remote's focus with Tab — the browser's stand-in for D-pad traversal
 *  (WebKit skips buttons on a plain Tab, like Safari; Option+Tab walks them).
 *  `target` is an attribute the control carries, or its exact visible text. */
async function walkTo(page: Page, browserName: string, target: { attr: string } | { text: string }, back = false) {
  const step = `${browserName === 'webkit' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`;
  const there = () =>
    page.evaluate((t) => {
      const el = document.activeElement;
      if (!el) return false;
      return 'attr' in t ? el.hasAttribute(t.attr) : (el.textContent || '').trim() === t.text;
    }, target);
  for (let i = 0; i < 12 && !(await there()); i++) await page.keyboard.press(step);
  expect(await there(), `remote focus never reached ${JSON.stringify(target)}`).toBe(true);
}

type UnpairCall = { url: string; method: string; bearer: boolean };

/** Boot the slideshow, record every unpair request, open the Back menu with the raw remote Back. */
async function bootToMenu(page: Page, tag: string, opts: { emergencyManifest?: boolean; storage?: Record<string, string> } = {}) {
  const id = playerIds(tag);
  const manifest = playerManifest(id.screenId, 'images');
  const unpairCalls: UnpairCall[] = [];
  await bootMockPlayer(page, {
    tag,
    kind: 'images',
    manifest,
    storage: opts.storage,
    extraRoutes: async (p) => {
      if (opts.emergencyManifest) {
        // Alert polls add a cache buster; answer the live URL from the same object.
        await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, (route) => ok(route, manifest));
      }
      await p.route('**/api/v1/screens/unpair/**', (route) => {
        const req = route.request();
        unpairCalls.push({ url: req.url(), method: req.method(), bearer: /^Bearer\s+\S+/.test(req.headers()['authorization'] || '') });
        return ok(route, { ok: true });
      });
    },
  });
  // Hydration gate: mounted (listeners live), and the slides exist — they
  // only render after the mount effects registered the screen and applied
  // the manifest.
  await waitForMount(page);
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(paused(page)).toBeVisible({ timeout: 5_000 });
  await expect(resume(page)).toBeFocused();
  return { id, manifest, unpairCalls };
}

/** From the menu: walk to "Unpair device" (it must SHOW focus), press OK, see the question. */
async function askUnpair(page: Page, browserName: string) {
  await walkTo(page, browserName, { attr: 'data-edu-unpair' });
  await expect(unpairLink(page)).toBeFocused();
  // The link below the action row now shows the remote where it is.
  expect(await unpairLink(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(question(page)).toBeVisible();
}

test('1. focus parks on "Keep paired"; arrows move it; every Back closes ONLY the question and the menu still works', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const { unpairCalls } = await bootToMenu(page, 'unpair-back');
  await askUnpair(page, browserName);

  // ── 1. The remote is parked on the SAFE answer, visibly. ──
  await expect(keepPaired(page)).toBeFocused();
  await expect(keepPaired(page)).toHaveAttribute('data-remote-parked', 'true');
  expect(await keepPaired(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await expect(question(page)).toContainText('needs a new pairing code from the dashboard');
  await page.screenshot({ path: test.info().outputPath('unpair-question-keep-paired.png'), animations: 'disabled' });

  // Arrows move between the two answers — and nothing behind it moves.
  await page.keyboard.press('ArrowRight');
  await expect(unpairAnswer(page)).toBeFocused();
  await expect(unpairAnswer(page)).toHaveAttribute('data-remote-parked', 'true');
  await expect(keepPaired(page)).not.toHaveAttribute('data-remote-parked', 'true');
  await page.screenshot({ path: test.info().outputPath('unpair-question-unpair-parked.png'), animations: 'disabled' });
  await page.keyboard.press('ArrowLeft');
  await expect(keepPaired(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(unpairAnswer(page)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(keepPaired(page)).toBeFocused();

  // ── 2a. The APK's Back — THE FIELD PATH — even while parked on Unpair. ──
  await page.keyboard.press('ArrowRight');
  await apkBack(page);
  await expect(question(page)).toHaveCount(0);
  await expect(paused(page)).toBeVisible();
  await expect(unpairLink(page)).toBeFocused();

  // ── 2b. A raw remote's Escape. ──
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(keepPaired(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question(page)).toHaveCount(0);
  await expect(paused(page)).toBeVisible();
  await expect(unpairLink(page)).toBeFocused();

  // ── 2c. An OEM remote's GoBack key. ──
  await settle(page);
  await page.keyboard.press('Enter');
  await expect(keepPaired(page)).toBeFocused();
  await goBackKey(page);
  await expect(question(page)).toHaveCount(0);
  await expect(paused(page)).toBeVisible();
  await expect(unpairLink(page)).toBeFocused();

  // The menu still works: walk back to Resume and press OK.
  await walkTo(page, browserName, { text: 'Resume' }, true);
  await page.keyboard.press('Enter');
  await expect(paused(page)).toHaveCount(0);
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 10_000 });
  await expect(anyQuestion(page)).toHaveCount(0);
  expect(unpairCalls).toEqual([]);
});

test('2. resuming playback leaves no question on the glass, and the next Back opens a clean menu', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const { unpairCalls } = await bootToMenu(page, 'unpair-resume');
  await askUnpair(page, browserName);
  await page.keyboard.press('ArrowRight'); // parked on Unpair: resuming must still never unpair

  // The owner's exact sequence: Back, then Back again. The first press closes
  // the question (the old dialog ignored it); the second closes the menu.
  await apkBack(page);
  await expect(question(page)).toHaveCount(0);
  await expect(paused(page)).toBeVisible();
  await settle(page);
  await apkBack(page);
  await expect(paused(page)).toHaveCount(0);
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 10_000 });

  // Content is playing and stays clean — the bug was a question that STAYED.
  await page.waitForTimeout(1_500);
  await expect(anyQuestion(page)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('unpair-resumed-clean.png'), animations: 'disabled' });

  // The next Back is a fresh menu: no ghost question, remote on Resume.
  await settle(page);
  await apkBack(page);
  await expect(paused(page)).toBeVisible();
  await expect(resume(page)).toBeFocused();
  await expect(anyQuestion(page)).toHaveCount(0);
  expect(unpairCalls).toEqual([]);
});

test('3. OK on "Keep paired" cancels; ArrowRight + OK on "Unpair" calls the unpair path', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const { id, unpairCalls } = await bootToMenu(page, 'unpair-confirm');
  await askUnpair(page, browserName);

  // A reflex OK lands on the safe answer.
  await expect(keepPaired(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(question(page)).toHaveCount(0);
  await expect(paused(page)).toBeVisible();
  await expect(unpairLink(page)).toBeFocused();
  await page.waitForTimeout(500);
  expect(unpairCalls).toEqual([]);

  // Deliberately: OK on the link, Right, OK.
  await page.keyboard.press('Enter');
  await expect(keepPaired(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(unpairAnswer(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(question(page)).toHaveCount(0);
  await expect.poll(() => unpairCalls.length, { timeout: 10_000, message: 'confirming never reached the unpair path' }).toBe(1);
  expect(unpairCalls[0].method).toBe('POST');
  expect(unpairCalls[0].url).toContain(`/api/v1/screens/unpair/${encodeURIComponent(id.fingerprint)}`);
  expect(unpairCalls[0].bearer).toBe(true);
});

test('4. an alert closes the question and owns the glass; after the all-clear Back opens a clean menu', async ({ page, browserName }) => {
  test.setTimeout(150_000);
  const { manifest, unpairCalls } = await bootToMenu(page, 'unpair-alert', { emergencyManifest: true });
  await askUnpair(page, browserName);
  await page.keyboard.press('ArrowRight'); // parked on Unpair: an alert must never confirm it

  // The alert arrives the way the server sends it: the manifest says so and a
  // signed OVERRIDE asks the player to reconcile now.
  Object.assign(manifest, { isEmergency: true, emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL' });
  await page.evaluate(() => {
    (window as unknown as { __eduTestRealtime: { deliver(m: unknown): void } }).__eduTestRealtime.deliver({
      type: 'OVERRIDE',
      timestamp: Date.now(),
      eventId: 'unpair-confirm-alert-1',
      signature: 'fake-sig-for-test',
      payload: { overrideId: 'or-unpair-confirm-1', severity: 'CRITICAL', textBlob: '', expiresAt: 0 },
    });
  });
  await expect(alertOnGlass(page)).toBeVisible({ timeout: 15_000 });
  await expect(anyQuestion(page)).toHaveCount(0);
  await expect(paused(page)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('unpair-alert-wins.png'), animations: 'disabled' });

  // The remote is locked during the alert: Back and OK change nothing.
  await apkBack(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await expect(anyQuestion(page)).toHaveCount(0);
  await expect(alertOnGlass(page)).toBeVisible();
  expect(unpairCalls).toEqual([]);

  // All-clear: the question does not come back; Back opens a clean menu.
  manifest.isEmergency = false;
  await page.evaluate(() => {
    (window as unknown as { __eduTestRealtime: { deliver(m: unknown): void } }).__eduTestRealtime.deliver({
      type: 'ALL_CLEAR',
      timestamp: Date.now(),
      eventId: 'unpair-confirm-clear-1',
      signature: 'fake-sig-for-test',
      payload: {},
    });
  });
  await expect(page.locator('[data-edu-emergency-root], [data-edu-emergency-pending]')).toHaveCount(0, { timeout: 15_000 });
  await expect(anyQuestion(page)).toHaveCount(0);
  await settle(page);
  await apkBack(page);
  await expect(paused(page)).toBeVisible({ timeout: 5_000 });
  await expect(anyQuestion(page)).toHaveCount(0);
  expect(unpairCalls).toEqual([]);
});

test('5. the idle card: Auto-Play\'s notice and Unpair are remote questions too, and Back closes only them', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const tag = 'unpair-idle';
  const id = playerIds(tag);
  const manifest = playerManifest(id.screenId, 'images');
  manifest.playlists = [];
  const unpairCalls: string[] = [];
  await bootMockPlayer(page, {
    tag,
    kind: 'images',
    manifest,
    extraRoutes: async (p) => {
      await p.route('**/api/v1/screens/unpair/**', (route) => { unpairCalls.push(route.request().url()); return ok(route, { ok: true }); });
    },
  });
  // Hydration gate: mounted (listeners live), and the paired card exists only
  // after register + manifest ran.
  await waitForMount(page);
  await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 30_000 });
  const autoPlay = page.getByRole('button', { name: 'Auto-Play' });
  await expect(autoPlay).toBeFocused();

  // Auto-Play → a one-answer notice, parked on OK; Back closes it and NOT the card.
  await page.keyboard.press('Enter');
  const notice = page.getByRole('alertdialog', { name: 'Nothing to play yet' });
  await expect(notice).toBeVisible();
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('idle-nothing-to-play.png'), animations: 'disabled' });
  await page.keyboard.press('ArrowRight'); // nowhere to go
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(notice).toHaveCount(0);
  await expect(paused(page)).toHaveCount(0); // Back did not also open the menu
  await expect(autoPlay).toBeFocused();
  // …and OK closes it too.
  await page.keyboard.press('Enter');
  await expect(notice).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);
  await expect(autoPlay).toBeFocused();

  // The idle row's Unpair: same question, same rules.
  await walkTo(page, browserName, { attr: 'data-edu-unpair' }, true);
  await page.keyboard.press('Enter');
  await expect(question(page)).toBeVisible();
  await expect(keepPaired(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(unpairAnswer(page)).toBeFocused();
  await apkBack(page);
  await expect(question(page)).toHaveCount(0);
  await expect(paused(page)).toHaveCount(0);
  await expect(page.locator('[data-edu-unpair]')).toBeFocused();
  // With nothing asked, Back is the menu toggle again.
  await settle(page);
  await apkBack(page);
  await expect(paused(page)).toBeVisible({ timeout: 5_000 });
  await expect(anyQuestion(page)).toHaveCount(0);
  expect(unpairCalls).toEqual([]);
});

// 6. Read from across the room, on the glass it ships to: a 1920×1080 panel
// (the Goodview 24" class — no canvas pin, so the operator glass scales ×1.5)
// and a single 320×1080 LED poster on a 1920 frame buffer. The whole card and
// both answers must be on the canvas, unclipped, with big type.
test.describe('6. the question fits real glass', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  for (const glass of [
    { name: '1920×1080 panel', tag: 'unpair-fit-1080', storage: {} as Record<string, string>, minTitlePx: 40 },
    { name: '320×1080 LED poster', tag: 'unpair-fit-poster', storage: { edu_canvasW: '320', edu_canvasH: '1080' }, minTitlePx: 20 },
  ]) {
    test(glass.name, async ({ page, browserName }) => {
      test.setTimeout(120_000);
      await bootToMenu(page, glass.tag, { storage: glass.storage });
      await askUnpair(page, browserName);
      await expect(keepPaired(page)).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(unpairAnswer(page)).toHaveAttribute('data-remote-parked', 'true');

      const canvas = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          w: parseFloat(cs.getPropertyValue('--led-w')) || window.innerWidth,
          h: parseFloat(cs.getPropertyValue('--led-h')) || window.innerHeight,
        };
      });
      const card = await question(page).boundingBox();
      expect(card).not.toBeNull();
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.y).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(canvas.w + 1);
      expect(card!.y + card!.height).toBeLessThanOrEqual(canvas.h + 1);
      for (const answer of [keepPaired(page), unpairAnswer(page)]) {
        const b = await answer.boundingBox();
        expect(b).not.toBeNull();
        // Inside the card (the card clips) — the scaled-up parked one included.
        expect(b!.x).toBeGreaterThanOrEqual(card!.x - 1);
        expect(b!.x + b!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
        expect(b!.y + b!.height).toBeLessThanOrEqual(card!.y + card!.height + 1);
      }
      const titlePx = await question(page).getByRole('heading').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(titlePx).toBeGreaterThanOrEqual(glass.minTitlePx);
      await page.screenshot({ path: test.info().outputPath(`fit-${glass.tag}.png`), animations: 'disabled' });
    });
  }
});
