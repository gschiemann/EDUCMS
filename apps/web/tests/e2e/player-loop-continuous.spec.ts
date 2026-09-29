import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bootMockPlayer } from './helpers/mock-player';
import { continuousGuardKey } from '../../src/app/player/continuousLoopRevision';

async function seedVerifiedVideo(page: Page, fixture = 'loop-clip.mp4') {
    const clip = fs.readFileSync(path.join(__dirname, 'fixtures', fixture));
    const hash = createHash('sha256').update(clip).digest('hex');
    await page.addInitScript(async ({ base64, hash }) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const url = 'http://api.invalid/assets/loop-clip.mp4';
      const cache = await caches.open('edu-player-playlist-v9');
      await cache.put(url, new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } }));
      const meta = await caches.open('edu-player-meta-v9');
      await meta.put('/__edu_meta__/' + encodeURIComponent(url), new Response(hash));
    }, { base64: clip.toString('base64'), hash });
    return hash;
}

test.describe('one-stream continuous video', () => {
  test.use({ serviceWorkers: 'allow' });
  test.skip(({ browserName }) => browserName !== 'chromium', 'H.264/MSE qualification starts on Chromium');
  test('a 250-frame GOP retains the playing frames during eviction and across repeated cycles', async ({ page }) => {
    test.setTimeout(90_000);
    await seedVerifiedVideo(page, 'loop-long-gop.mp4');
    await bootMockPlayer(page, { tag: 'continuous-long-gop', kind: 'video', videoMp4: true,
      videoMp4Fixture: 'loop-long-gop.mp4', playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), { timeout: 65_000 }).toBeGreaterThan(45);
    const state = await page.evaluate(() => {
      const v = document.querySelector('video')!;
      return { backend: v.dataset.loopBackend, paused: v.paused, currentTime: v.currentTime,
        inBuffer: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)])
          .some(([start, end]) => start <= v.currentTime && end > v.currentTime) };
    });
    expect(state).toMatchObject({ backend: 'continuous', paused: false, inBuffer: true });
    const snap = await page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { boundaries: number; fallbacks: number } }).__eduLoopBoundary());
    expect(snap.boundaries).toBeGreaterThanOrEqual(2);
    expect(snap.fallbacks).toBe(0);
  });
  test('one element advances across repeats without seeks or source changes and continues offline', async ({ page, context }) => {
    test.setTimeout(120_000);
    await seedVerifiedVideo(page);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await bootMockPlayer(page, { tag: 'continuous', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.currentTime ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      const w = window as unknown as { __loopCheck: { src: string; seeks: number; loads: number; start: number } };
      w.__loopCheck = { src: v.src, seeks: 0, loads: 0, start: v.currentTime };
      v.addEventListener('seeking', () => w.__loopCheck.seeks++);
      v.addEventListener('loadstart', () => w.__loopCheck.loads++);
    });
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector('video')!;
      return v.currentTime - (window as unknown as { __loopCheck: { start: number } }).__loopCheck.start;
    }), { timeout: 30_000 }).toBeGreaterThan(8);
    const state = await page.evaluate(() => {
      const v = document.querySelector('video')!;
      const c = (window as unknown as { __loopCheck: { src: string; seeks: number; loads: number } }).__loopCheck;
      return { videos: document.querySelectorAll('video').length, srcUnchanged: v.src === c.src,
        seeks: c.seeks, loads: c.loads, loop: v.loop, paused: v.paused,
        bufferedSeconds: v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.buffered.start(0) : 0 };
    });
    expect(state).toMatchObject({ videos: 1, srcUnchanged: true, seeks: 0, loads: 0, loop: false, paused: false });
    expect(state.bufferedSeconds).toBeLessThan(20);
    const snap = await page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { backend: string; boundaries: number; maxSkipMs: number; maxHoldMs: number; fallbacks: number } }).__eduLoopBoundary());
    expect(snap).toMatchObject({ backend: 'continuous', maxSkipMs: 0, fallbacks: 0 });
    expect(snap.boundaries).toBeGreaterThanOrEqual(4); expect(snap.maxHoldMs).toBeLessThan(150);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/continuous-loop.png' });
  });
  test('corrupted fragments fall back once to the original file and retain the per-file block on reload', async ({ page }) => {
    test.setTimeout(120_000);
    const hash = await seedVerifiedVideo(page);
    await bootMockPlayer(page, { tag: 'continuous-corrupt', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)).toBeGreaterThan(1);
    await page.evaluate(async () => {
      const cache = await caches.open('venueos-continuous-loop-v1');
      for (const key of await cache.keys()) {
        if (/\/\d+$/.test(new URL(key.url).pathname)) await cache.put(key, new Response('bad', { headers: { 'content-length': '3' } }));
      }
    });
    await expect(page.locator('video[data-loop-backend="native"]')).toBeAttached({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { fallbacks: number } }).__eduLoopBoundary()?.fallbacks ?? 0)).toBe(1);
    const blockKey = continuousGuardKey(hash, 'edu_loop_twodeck_blocked_until');
    const until = await page.evaluate(key => Number(localStorage.getItem(key)), blockKey);
    expect(until).toBeGreaterThan(Date.now() + 23 * 3600_000);
    await expect.poll(() => page.evaluate(() => !!document.querySelector('video')?.loop && !document.querySelector('video')?.paused)).toBe(true);
    await page.reload();
    await expect(page.locator('video[data-loop-backend="native"]')).toBeAttached({ timeout: 40_000 });
    expect(await page.evaluate(key => Number(localStorage.getItem(key)), blockKey)).toBe(until);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { fallbackReason: string } }).__eduLoopBoundary()?.fallbackReason)).toBe('continuous:blocked');
  });

});
