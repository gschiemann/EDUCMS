import { test, expect } from '@playwright/test';
import { bootMockPlayer } from './helpers/mock-player';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const url = 'http://api.invalid/assets/loop-clip.mp4';
const sha = createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'fixtures', 'loop-clip.mp4'))).digest('hex');

test('after an interrupted renderer, normal video keeps playing through one native decoder', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await bootMockPlayer(page, { tag: 'recovery-conservative', kind: 'video', videoMp4: true,
    playback: { loopMode: 'continuous' }, storage: {
      edu_normal_playback_safety_v1: JSON.stringify({ safeUntil: Date.now() + 60_000, pending: [], failures: [] }),
    } });
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('video[data-loop-backend="continuous"]')).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames), { timeout: 20_000 }).toBeGreaterThan(30);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.loop)).toBe(true);
  expect(errors).toEqual([]);
});

test('a repeatedly interrupted file is set aside with an honest fallback instead of another decoder crash', async ({ page }) => {
  await bootMockPlayer(page, { tag: 'recovery-quarantined', kind: 'video', videoMp4: true,
    playback: { loopMode: 'continuous' }, storage: {
      edu_normal_playback_safety_v1: JSON.stringify({ safeUntil: Date.now() + 60_000, pending: [],
        failures: [{ key: `${url}#${sha}`, count: 2, until: Date.now() + 60_000 }] }),
    } });
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByText(/Content Unavailable/i).first()).toBeVisible({ timeout: 20_000 });
});
