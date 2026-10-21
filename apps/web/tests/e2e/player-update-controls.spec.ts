import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds } from './helpers/mock-player';

const TARGET = '1.1.47-field.1';
const SLIDES = 'img[src*="slide-"]';

type NativeMessage = { method: string; args: unknown[] };
type TestWindow = Window & {
  EduCmsNativeChannel: { postMessage: (message: string) => void };
  __updateCalls: NativeMessage[];
  __updateDocument: string;
  __eduRenderProof?: () => { sig?: string };
};

async function bootUpdatePlayer(page: Page, options: {
  state: string;
  message: string;
  stable: string | null;
  legacy?: boolean;
  video?: boolean;
}) {
  const id = playerIds('update-controls');
  let reports = 0;
  const response = {
    ok: true, paired: true, screenId: id.screenId,
    // No forceUpdatePending: only the native worker knows about this attempt.
    ota: { state: options.state, message: options.message, at: '2026-01-01T02:00:00Z' },
  };
  await bootMockPlayer(page, {
    tag: 'update-controls', identity: id, kind: options.video ? 'video' : 'images', videoMp4: !!options.video,
    nativeMethods: options.legacy ? ['checkForUpdates'] : ['checkForUpdates', 'checkForUpdatesUserInitiated'],
    extraRoutes: async p => {
      // The APK supplies this URL parameter before loading the web player.
      await p.addInitScript(() => {
        const url = new URL(location.href);
        url.searchParams.set('v', '1.1.45-field.1');
        history.replaceState(null, '', url);
      });
      await p.route('**/api/v1/player/latest-version-public', r => ok(r, options.stable ? { versionName: options.stable } : {}));
      await p.route(`**/api/v1/screens/${id.screenId}/telemetry`, r => {
        reports += 1;
        return ok(r, response);
      });
      await p.route(/\/api\/v1\/screens\/status\//, r => ok(r, response));
    },
  });
  await expect(page.locator(options.video ? 'video' : SLIDES)).toHaveCount(options.video ? 1 : 3);
  await expect.poll(() => reports).toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    w.__updateCalls = [];
    w.__updateDocument = 'content-still-playing';
    w.EduCmsNativeChannel.postMessage = raw => w.__updateCalls.push(JSON.parse(raw));
  });
}

async function updateCalls(page: Page) {
  return page.evaluate(() => (window as unknown as TestWindow).__updateCalls.filter(m => m.method.startsWith('checkForUpdates')));
}

async function expectQuietPlayback(page: Page) {
  await expect(page.getByRole('button', { name: /^(Install|Check for updates)/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__eduRenderProof?.().sig ?? '')).toMatch(/^pl:/);
  const visibleSlide = () => page.locator(SLIDES).evaluateAll(images => images.find(img => getComputedStyle(img).opacity === '1')?.getAttribute('src'));
  const first = await visibleSlide();
  expect(first).toBeTruthy();
  await expect.poll(visibleSlide).not.toBe(first);
  expect(await updateCalls(page)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__updateDocument)).toBe('content-still-playing');
}

for (const scenario of [
  { state: 'NEEDS_TAP', stable: '1.1.29', title: 'older public stable', heading: 'Update needs a tap on this screen', message: `Android needs a tap to install v${TARGET}.` },
  { state: 'NEEDS_TAP', stable: '1.1.29', legacy: true, title: 'legacy APK fallback', heading: 'Update needs a tap on this screen', message: `Android needs a tap to install v${TARGET}.` },
  { state: 'NEEDS_TAP', stable: null, title: 'unavailable public stable', heading: 'Update needs a tap on this screen', message: `Android needs a tap to install v${TARGET}.` },
  { state: 'NEEDS_TAP', stable: '1.1.29', portrait: true, title: 'portrait display', heading: 'Update needs a tap on this screen', message: `Android needs a tap to install v${TARGET}.` },
  { state: 'FAILED_ABORTED', stable: '1.1.29', title: 'failed native install', heading: 'Update issue', message: `Install of v${TARGET} was cancelled on this screen.` },
]) {
  test(`native-only ${scenario.title} stays quiet until Back, then offers the reported target`, async ({ page }, info) => {
    if ('portrait' in scenario) await page.setViewportSize({ width: 1080, height: 1920 });
    await bootUpdatePlayer(page, scenario);
    await expectQuietPlayback(page);
    await page.keyboard.press('Escape');
    await expect(page.getByText(scenario.heading, { exact: true })).toBeVisible();
    const status = scenario.state === 'NEEDS_TAP'
      ? `Android needs someone to confirm the update v${TARGET}. Press Install now, then tap Install.`
      : scenario.message;
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    const install = page.getByRole('button', { name: `Install v${TARGET}`, exact: true });
    await expect(install).toBeVisible();
    await expect(install).toBeFocused();
    const bounds = await install.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await install.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('update-target-menu.png'), animations: 'disabled' });
    await install.click();
    expect(await updateCalls(page)).toEqual([{ method: 'legacy' in scenario ? 'checkForUpdates' : 'checkForUpdatesUserInitiated', args: [] }]);
    await expect(page.getByText(/Update signal sent .*waiting for kiosk to report progress/)).toBeVisible();
    // The old NEEDS_TAP answer cannot masquerade as the new attempt's status.
    await expect(install).toHaveCount(0);
  });
}

test('Back keeps the existing controls without an extra update button', async ({ page }, info) => {
  await bootUpdatePlayer(page, { state: 'UP_TO_DATE', message: 'No newer public release offered.', stable: '1.1.29' });
  await expectQuietPlayback(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Install|Check for updates)/ })).toHaveCount(0);
  expect(await updateCalls(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('existing-back-controls.png'), animations: 'disabled' });
});

test('a native-only pending update never covers or restarts playing video', async ({ page }) => {
  await bootUpdatePlayer(page, { state: 'NEEDS_TAP', message: `Tap to install v${TARGET}.`, stable: '1.1.29', video: true });
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  const before = await video.evaluate(v => (v as HTMLVideoElement).currentTime);
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(before + 0.2);
  await expect(page.getByRole('button', { name: /^(Install|Check for updates)/ })).toHaveCount(0);
  await expect(page.getByText('Update needs a tap on this screen', { exact: true })).toHaveCount(0);
  expect(await updateCalls(page)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__updateDocument)).toBe('content-still-playing');
});
