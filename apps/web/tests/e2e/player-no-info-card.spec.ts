import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

/**
 * NO INFORMATION CARD — the 2026-10-11 owner decision, pinned.
 *
 * The blue "Screen information" card (Connected / template / zones /
 * resolution / last sync + Sync / Resize / Stop) kept appearing over
 * UNATTENDED content: the whole content canvas was a click / Enter / Space
 * target and Home / i were global shortcuts, so a stray remote press, a
 * CEC bridge, or a visitor's tap put operator chrome on a public screen.
 * Two policy waves (2026-10-10) narrowed WHEN it could open; the owner then
 * removed it outright. Everything it offered already lives on the Back
 * menu (Sync / Exit / Unpair / setup) — except "Resize", which moved there
 * as "Resize LED area".
 *
 * These tests prove, on chromium AND webkit:
 *  1. a tap / click / Enter / Space / Home / i on playing MEDIA and TEMPLATE
 *     content opens NOTHING and does not disturb playback;
 *  2. Back still opens the menu (rule 15: Back always reaches an escape);
 *  3. "Resize LED area" on that menu opens the LED canvas editor from the
 *     remote's keys, and leaving the editor (Back or Cancel) lands back on
 *     the menu with focus parked on that button;
 *  4. a live emergency still takes the screen and locks the remote.
 *
 * Harness rules (CLAUDE.md player rule 14) are honoured by the shared
 * mock-player helper: the realtime stub delegates non-/realtime sockets,
 * mocks key on state, and the content itself proves mount.
 */

test.use({ serviceWorkers: 'block' });

const SLIDES = 'img[data-slide-id]';
const infoCard = (page: Page) => page.getByRole('dialog', { name: 'Screen information' });
const infoPanel = (page: Page) => page.locator('[data-edu-player-info-panel]');
const resume = (page: Page) => page.getByRole('button', { name: /Resume/ });
const resizeLed = (page: Page) => page.getByRole('button', { name: 'Resize LED area' });
const editorWidth = (page: Page) => page.getByRole('spinbutton', { name: 'Canvas width in pixels' });

const pressBack = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));

/** Let any discrete-event render flush before asserting "nothing opened". */
const settle = (page: Page) => page.waitForTimeout(300);

/** Every input that used to open the card, in one go, on the playback root. */
async function strayInputs(page: Page, root: 'media' | 'template') {
  const el = page.locator(`[data-edu-player-root="${root}"]`);
  await el.click({ position: { x: 300, y: 200 } });
  await el.dblclick({ position: { x: 500, y: 300 } });
  await el.tap({ position: { x: 700, y: 400 } }).catch(() => undefined); // no touch context on desktop projects
  await page.mouse.click(640, 360);
  // Focus the root the way the old contract did (tabIndex is gone — this
  // falls back to <body>, which is exactly where a remote's keys land now).
  await page.evaluate((r) => (document.querySelector(`[data-edu-player-root="${r}"]`) as HTMLElement | null)?.focus(), root);
  for (const key of ['Enter', 'Space', 'i', 'I', 'Home']) await page.keyboard.press(key);
  await settle(page);
}

/** The slide the public can see right now (opacity 1, decoded). */
const activeSlide = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll<HTMLImageElement>('img[data-slide-id]'))
    .find(img => getComputedStyle(img).opacity === '1')?.getAttribute('data-slide-id') ?? null);

async function expectNoCard(page: Page) {
  await expect(infoCard(page)).toHaveCount(0);
  await expect(infoPanel(page)).toHaveCount(0);
  await expect(resume(page)).toHaveCount(0);
}

test('media: tap / click / Enter / Space / Home / i open nothing and the slideshow keeps advancing; Back opens the menu', async ({ page }) => {
  test.setTimeout(90_000);
  await bootMockPlayer(page, { tag: 'nocard-media', kind: 'images' });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await expect.poll(() => activeSlide(page), { timeout: 10_000 }).not.toBeNull();

  // The root is a passive container now: no button role, no tab stop.
  const root = page.locator('[data-edu-player-root="media"]');
  await expect(root).not.toHaveAttribute('role', /.+/);
  await expect(root).not.toHaveAttribute('tabindex', /.+/);
  await expect(page.getByRole('button', { name: 'Toggle screen info overlay' })).toHaveCount(0);

  const before = await activeSlide(page);
  await strayInputs(page, 'media');
  await expectNoCard(page);
  // Playback was not disturbed: the slot clock kept running past the input.
  await expect.poll(() => activeSlide(page), { timeout: 10_000 }).not.toBe(before);
  await expectNoCard(page);

  // Rule 15 — Back is the one operator entry point, and it toggles back.
  await pressBack(page);
  await expect(page.getByRole('heading', { name: 'Playback Paused' })).toBeVisible({ timeout: 5_000 });
  await expect(resume(page)).toBeVisible();
  await expect(resizeLed(page)).toBeVisible();
  await expect(infoCard(page)).toHaveCount(0);
  await pressBack(page);
  await expect(resume(page)).toHaveCount(0);
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 10_000 });
});

test('template: tap / click / Enter / Space / Home / i open nothing and the widget stays on the glass; Back opens the menu', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'nocard-template';
  const manifest = playerManifest(playerIds(tag).screenId, 'images');
  Object.assign(manifest.playlists[0], {
    items: [],
    template: {
      id: 'test-nocard-template', name: 'No-card template', bgColor: '#101828',
      screenWidth: 1920, screenHeight: 1080,
      zones: [{ id: 'nocard-text', x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        widgetType: 'TEXT', defaultConfig: { content: 'Public content keeps playing', fontSize: 96, color: 'white' } }],
    },
  });
  await bootMockPlayer(page, { tag, kind: 'images', manifest });
  const root = page.locator('[data-edu-player-root="template"]');
  await expect(root).toBeVisible({ timeout: 30_000 });
  const widget = page.getByText('Public content keeps playing');
  await expect(widget).toBeVisible();
  await expect(root).not.toHaveAttribute('role', /.+/);
  await expect(root).not.toHaveAttribute('tabindex', /.+/);

  await widget.click();
  await strayInputs(page, 'template');
  await expectNoCard(page);
  await expect(widget).toBeVisible();

  await pressBack(page);
  await expect(page.getByRole('heading', { name: 'Playback Paused' })).toBeVisible({ timeout: 5_000 });
  await expect(resizeLed(page)).toBeVisible();
  await expect(infoCard(page)).toHaveCount(0);
  await pressBack(page);
  await expect(resume(page)).toHaveCount(0);
  await expect(widget).toBeVisible({ timeout: 10_000 });
});

test('Back menu: "Resize LED area" opens the canvas editor from the remote; Back and Cancel both return to the menu with focus on the button', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  await bootMockPlayer(page, { tag: 'nocard-resize', kind: 'images' });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await pressBack(page);
  await expect(resume(page)).toBeVisible({ timeout: 5_000 });
  // The menu parks the remote on Resume (autoFocus); the D-pad walks the
  // action row — Tab is the browser's stand-in for that traversal (WebKit
  // skips buttons on a plain Tab, like Safari; Option+Tab walks them all).
  await expect(resume(page)).toBeFocused();
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const focusedIsResize = () => page.evaluate(() => document.activeElement?.hasAttribute('data-edu-resize-led') === true);
  for (let i = 0; i < 6 && !(await focusedIsResize()); i++) await page.keyboard.press(next);
  expect(await focusedIsResize()).toBe(true);
  // Visible highlight: the action-row outline rule paints on :focus.
  expect(await resizeLed(page).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');

  // OK on the remote → the editor, with its first field ready for digits.
  await page.keyboard.press('Enter');
  await expect(editorWidth(page)).toBeVisible();
  await expect(editorWidth(page)).toBeFocused();
  // Typing into the editor is typing — no shortcut, no card, no resume.
  await page.keyboard.type('960');
  await page.keyboard.press('i');
  await page.keyboard.press('Home');
  await settle(page);
  await expect(editorWidth(page)).toBeVisible();
  await expect(infoCard(page)).toHaveCount(0);

  // Back inside the editor leaves the editor, NOT the menu (rule 15).
  await pressBack(page);
  await expect(editorWidth(page)).toHaveCount(0);
  await expect(resume(page)).toBeVisible();
  await expect(resizeLed(page)).toBeFocused();

  // Cancel does the same, with the mouse.
  await resizeLed(page).click();
  await expect(editorWidth(page)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editorWidth(page)).toHaveCount(0);
  await expect(resume(page)).toBeVisible();
  await expect(resizeLed(page)).toBeFocused();

  // Escape from the keyboard is the raw-remote Back: it closes the menu.
  await page.keyboard.press('Escape');
  await expect(resume(page)).toHaveCount(0);
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 10_000 });
  await expectNoCard(page);
});

test('a live emergency still takes the screen: the remote is locked, Back / Home / i open nothing, and the all-clear hands Back its menu again', async ({ page }) => {
  test.setTimeout(120_000);
  const tag = 'nocard-emergency';
  const id = playerIds(tag);
  const manifest = playerManifest(id.screenId, 'images');
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    // Emergency polls add a cache buster; answer that live URL too.
    await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, route => ok(route, manifest));
  } });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  const emergencyLock = () => page.evaluate(() =>
    (window.history.state as { eduBackTrap?: boolean } | null)?.eduBackTrap === true);
  expect(await emergencyLock()).toBe(false);

  Object.assign(manifest, { isEmergency: true, emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL' });
  await expect.poll(emergencyLock, { timeout: 45_000, message: 'the alert never locked the remote' }).toBe(true);
  await strayInputs(page, 'media');
  await pressBack(page);
  await page.keyboard.press('Escape');
  await settle(page);
  await expect(resume(page)).toHaveCount(0);
  await expect(infoCard(page)).toHaveCount(0);
  expect(await emergencyLock()).toBe(true);

  manifest.isEmergency = false;
  await expect.poll(emergencyLock, { timeout: 45_000, message: 'the all-clear never released the remote' }).toBe(false);
  await pressBack(page);
  await expect(resume(page)).toBeVisible({ timeout: 5_000 });
  await expect(infoCard(page)).toHaveCount(0);
});

test('real video keeps decoding through every stray input (no card, no stall)', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This runner has no MP4 decoder; the input contract is covered on WebKit above.');
  test.setTimeout(90_000);
  const tag = 'nocard-video';
  const manifest = playerManifest(playerIds(tag).screenId, 'video', { loopMode: 'native' }, 1, true);
  const url = 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/nocard-video.mp4';
  manifest.playlists[0].items[0].url = url;
  await bootMockPlayer(page, { tag, kind: 'video', videoMp4: true, manifest, videoFixtures: { [url]: 'loop-clip.mp4' } });
  const video = page.locator('video');
  const frames = () => video.evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(frames, { timeout: 30_000 }).toBeGreaterThan(10);
  const before = await frames();
  await strayInputs(page, 'media');
  await expectNoCard(page);
  await expect.poll(frames, { timeout: 15_000 }).toBeGreaterThan(before + 30);
  await expect(video).toHaveJSProperty('paused', false);
  await expectNoCard(page);
});
