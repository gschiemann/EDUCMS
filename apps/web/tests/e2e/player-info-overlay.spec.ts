import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

const info = (page: Page) => page.getByRole('dialog', { name: 'Screen information' });

test('a live emergency retires open information and keeps controls locked through the idle deadline', async ({ page }) => {
  await page.clock.install();
  const tag = 'info-emergency';
  const manifest = playerManifest(playerIds(tag).screenId, 'images');
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    // Emergency polls intentionally add a cache buster; answer that live URL too.
    await p.route(`**/api/v1/screens/${playerIds(tag).screenId}/manifest*`, route => ok(route, manifest));
  } });
  await expect(page.locator('[data-edu-player-root="media"]')).toBeVisible();
  await page.keyboard.press('i');
  await expect(info(page)).toBeVisible();
  const emergencyLock = () => page.evaluate(() =>
    (window.history.state as { eduBackTrap?: boolean } | null)?.eduBackTrap === true);
  Object.assign(manifest, { isEmergency: true, emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL' });
  await page.clock.fastForward(15_000);
  await expect.poll(emergencyLock).toBe(true);
  await expect(info(page)).toHaveCount(0);
  await page.keyboard.press('i');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));
  await page.clock.fastForward(35_000);
  expect(await emergencyLock()).toBe(true);
  await expect(info(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resume/ })).toHaveCount(0);
  manifest.isEmergency = false;
  await expect.poll(async () => {
    await page.clock.fastForward(10_000);
    return emergencyLock();
  }).toBe(false);
  await page.keyboard.press('i');
  await expect(info(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(info(page)).toHaveCount(0);
});

for (const kind of ['media', 'template'] as const) {
  test(`${kind}: unattended info expires, intentional interaction renews it, held keys cannot reopen it`, async ({ page }) => {
    await page.clock.install();
    const tag = `info-${kind}`;
    const manifest = playerManifest(playerIds(tag).screenId, 'images');
    for (const item of manifest.playlists[0].items) item.url =
      `https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/${item.asset_id}.png`;
    if (kind === 'template') Object.assign(manifest.playlists[0], {
      items: [],
      template: { id: 'test-info-template', name: 'Info timeout template', bgColor: '#101828',
        screenWidth: 1920, screenHeight: 1080,
        zones: [{ id: 'info-text', x: 0, y: 0, width: 100, height: 100, zIndex: 1,
          widgetType: 'TEXT', defaultConfig: { content: 'Public content keeps playing', fontSize: 96, color: 'white' } }] },
    });
    await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
      await p.route('**/storage/v1/object/public/assets/*.png', route => route.fulfill({
        contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
      }));
    } });
    const root = page.locator(`[data-edu-player-root="${kind}"]`);
    await expect(root).toBeVisible();
    await expect(info(page)).toHaveCount(0);
    await root.focus();
    await page.keyboard.press(kind === 'template' ? 'Enter' : 'Space');
    await expect(info(page)).toBeVisible();
    await page.clock.fastForward(20_000);
    // Selecting text inside the card is interaction, never another canvas toggle.
    await info(page).getByText(kind === 'template' ? 'Template' : 'Playlist', { exact: true }).click();
    await expect(info(page)).toBeVisible();
    await page.clock.fastForward(20_000);
    await expect(info(page)).toBeVisible();
    await page.clock.fastForward(11_000);
    await expect(info(page)).toHaveCount(0);
    await expect(root).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', repeat: true, bubbles: true })));
    await expect(info(page)).toHaveCount(0);
    await root.dispatchEvent('keydown', { key: 'Enter', repeat: true, bubbles: true });
    await expect(info(page)).toHaveCount(0);
    await page.keyboard.press('i');
    await expect(info(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));
    await expect(info(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Resume/ })).toHaveCount(0);

    // The deliberate Stop/Resume lifecycle is not a transient information card.
    await page.keyboard.press('i');
    await info(page).getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
    await page.clock.fastForward(31_000);
    await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
    await page.getByRole('button', { name: /Resume/ }).click();
    await expect(info(page)).toHaveCount(0);
  });
}

test('an open canvas editor survives info expiry; returning to content closes only information', async ({ page }) => {
  await page.clock.install();
  await bootMockPlayer(page, { tag: 'info-editor', kind: 'images' });
  await expect(page.locator('[data-edu-player-root="media"]')).toBeVisible();
  await page.keyboard.press('i');
  await info(page).getByRole('button', { name: 'Resize for LED' }).click();
  const width = page.getByRole('spinbutton', { name: 'Canvas width in pixels' });
  await expect(width).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(width).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(info(page)).toBeVisible();
  await info(page).getByRole('button', { name: 'Return to content' }).click();
  await expect(info(page)).toHaveCount(0);
});

test('real video continues decoding before, during, and after unattended information dismissal', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'This runner has no MP4 decoder; info lifecycle is covered on WebKit above.');
  const tag = 'info-video';
  const manifest = playerManifest(playerIds(tag).screenId, 'video', { loopMode: 'native' }, 1, true);
  const url = 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/info-video.mp4';
  manifest.playlists[0].items[0].url = url;
  await bootMockPlayer(page, { tag, kind: 'video', videoMp4: true, manifest,
    videoFixtures: { [url]: 'loop-clip.mp4' } });
  const video = page.locator('video');
  const frames = () => video.evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(frames).toBeGreaterThan(10);
  const before = await frames();
  await page.keyboard.press('i');
  await expect(info(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('information-open.png') });
  await expect(info(page)).toHaveCount(0, { timeout: 35_000 });
  await expect.poll(frames).toBeGreaterThan(before + 300);
  await expect(page.getByRole('button', { name: /Resume/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('content-after-dismissal.png') });
});
