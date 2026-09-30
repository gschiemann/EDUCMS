import { test, expect } from '@playwright/test';
import { bootMockPlayer, playerIds, playerManifest } from './helpers/mock-player';

const colors = ['red', 'green', 'blue'];
function playlist(tag: string) {
  const manifest = playerManifest(playerIds(tag).screenId, 'video', undefined, 3, true);
  manifest.playlists[0].items = colors.map((color, index) => ({
    item_id: `video-${color}`, asset_id: `asset-${color}`,
    url: `http://api.invalid/assets/playlist-${color}.mp4`, mime_type: 'video/mp4',
    sequence: index, duration_ms: 2000, muted: true,
    transition_type: ['FADE', 'SLIDE_LEFT', 'SLIDE_UP'][index],
  }));
  return manifest;
}
const videoFixtures = Object.fromEntries(colors.map(color => [`**/assets/playlist-${color}.mp4`, `playlist-${color}.mp4`]));

test('three MP4 files hand off through two persistent decks over multiple laps, with legacy transitions ignored', async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  await bootMockPlayer(page, { tag: 'three-video-handoff', kind: 'video', manifest: playlist('three-video-handoff'), videoFixtures });
  const player = page.locator('[data-playlist-handoff="decoded-frame"]');
  await expect(player).toBeAttached({ timeout: 35_000 });
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-playlist-deck][style*="z-index: 1"]')?.videoWidth ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window as unknown as { handoffProof: { changes: string[]; violations: string[]; frames: number } };
    w.handoffProof = { changes: [], violations: [], frames: 0 };
    const nodes = [...document.querySelectorAll<HTMLVideoElement>('[data-playlist-deck]')];
    const sample = () => {
      const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-playlist-deck]')];
      const shown = videos.filter(v => v.style.zIndex === '1');
      const proof = w.handoffProof;
      proof.frames++;
      if (videos.length !== 2 || videos.some(v => !nodes.includes(v))) proof.violations.push('surface replaced or third decoder');
      if (shown.length !== 1) proof.violations.push('missing outgoing picture');
      for (const v of shown) {
        const css = getComputedStyle(v);
        if (v.videoWidth <= 0 || v.readyState < 2 || css.opacity !== '1' || css.transitionDuration !== '0s') proof.violations.push('unready or animated picture');
        const id = (v.dataset.playlistItem || '').split(':').at(-1) || '';
        if (proof.changes.at(-1) !== id) proof.changes.push(id);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { handoffProof: { changes: string[] } }).handoffProof.changes.length), { timeout: 35_000, intervals: [250] }).toBeGreaterThanOrEqual(7);
  const proof = await page.evaluate(() => (window as unknown as { handoffProof: { changes: string[]; violations: string[]; frames: number } }).handoffProof);
  expect(proof.violations).toEqual([]);
  expect(proof.frames).toBeGreaterThan(100);
  expect(new Set(proof.changes)).toEqual(new Set(colors.map(color => `video-${color}`)));
  await expect(player).not.toHaveAttribute('data-playlist-handoff-fallback', /.+/);
  await page.screenshot({ path: testInfo.outputPath('playlist-decoded-frame-handoff.png') });
});

test('a failing standby releases the second decoder and the remaining playlist keeps playing', async ({ page }) => {
  test.setTimeout(65_000);
  const fixtures = { ...videoFixtures };
  delete fixtures['**/assets/playlist-green.mp4'];
  const manifest = playlist('handoff-fallback');
  manifest.playlists[0].items[1].url = 'http://api.invalid/assets/missing-video.mp4';
  await bootMockPlayer(page, { tag: 'handoff-fallback', kind: 'video', manifest, videoFixtures: fixtures });
  const player = page.locator('[data-playlist-handoff="decoded-frame"]');
  await expect(player).toBeAttached({ timeout: 35_000 });
  await expect(player).toHaveAttribute('data-playlist-handoff-fallback', 'standby-error', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-playlist-deck][style*="z-index: 1"]')?.dataset.playlistItem?.split(':').at(-1)), { timeout: 20_000, intervals: [200] }).toBe('video-blue');
  await expect(page.locator('[data-playlist-deck][src]')).toHaveCount(1);
  const a = await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-playlist-deck][src]')?.currentTime ?? -1);
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-playlist-deck][src]')?.currentTime ?? -1);
  expect(b).toBeGreaterThan(a);
});
