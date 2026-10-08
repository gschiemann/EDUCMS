import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bootMockPlayer, playerIds, playerManifest } from './helpers/mock-player';
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
  test('an initial native open retry still adopts continuous after its first real frame', async ({ page }) => {
    test.setTimeout(80_000);
    const hash = await seedVerifiedVideo(page);
    await page.addInitScript(() => {
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
      let first = true;
      HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
        return request.call(this, (now, meta) => {
          if (first) { first = false; setTimeout(() => callback(now, meta), 50_000); }
          else callback(now, meta);
        });
      };
    });
    await bootMockPlayer(page, { tag: 'continuous-start-resume', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 65_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)).toBeGreaterThan(2);
    expect(await page.evaluate(key => localStorage.getItem(key), continuousGuardKey(hash, 'edu_loop_twodeck_blocked_until'))).toBeNull();
    expect(await page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { fallbacks: number } | null }).__eduLoopBoundary()?.fallbacks ?? 0)).toBe(0);
  });
  test('a scoped backend change keeps the same full-quality file without reloading the player', async ({ page }) => {
    test.setTimeout(90_000);
    await seedVerifiedVideo(page);
    const tag = 'continuous-native-comparison';
    const manifest = playerManifest(playerIds(tag).screenId, 'video', { loopMode: 'continuous' }, 1, true);
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await bootMockPlayer(page, { tag, kind: 'video', videoMp4: true, manifest,
      extraRoutes: async p => {
        await p.addInitScript(() => {
          const Real = window.WebSocket;
          window.WebSocket = new Proxy(Real, { construct(target, args) {
            const socket = Reflect.construct(target, args);
            if (String(args[0]).includes('/realtime')) {
              (window as unknown as { __comparisonSocket: WebSocket }).__comparisonSocket = socket;
            }
            return socket;
          } });
        });
      },
    });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), { timeout: 12_000 }).toBeGreaterThan(5);
    const original = { ...manifest.playlists[0].items[0] };
    const navigationCount = navigations;
    manifest.playback = { loopMode: 'native' };
    await page.evaluate(() => {
      const socket = (window as unknown as { __comparisonSocket: WebSocket }).__comparisonSocket;
      socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        type: 'SYNC', signature: 'test-signature', idempotencyKey: 'same-file-native', timestamp: Date.now(), payload: {},
      }) }));
    });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector('video');
      return !!v && v.loop && !v.paused && v.currentTime > 0.25;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as {
      __eduLoopBoundary: () => { backend: string; boundaries: number } | null;
    }).__eduLoopBoundary()?.boundaries ?? 0), { timeout: 12_000 }).toBeGreaterThanOrEqual(2);
    const result = await page.evaluate(() => ({
      videos: document.querySelectorAll('video').length,
      snapshot: (window as unknown as { __eduLoopBoundary: () => unknown }).__eduLoopBoundary(),
    }));
    expect(result.videos).toBe(1);
    expect(result.snapshot).toMatchObject({ backend: 'native', fallbacks: 0 });
    expect(manifest.playlists[0].items[0]).toEqual(original);
    expect(navigations).toBe(navigationCount);
  });
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
    expect(state.bufferedSeconds).toBeLessThan(36);
    const snap = await page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { backend: string; boundaries: number; maxSkipMs: number; maxHoldMs: number; fallbacks: number } }).__eduLoopBoundary());
    expect(snap).toMatchObject({ backend: 'continuous', maxSkipMs: 0, fallbacks: 0 });
    expect(snap.boundaries).toBeGreaterThanOrEqual(4); expect(snap.maxHoldMs).toBeLessThan(150);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/continuous-loop.png' });
  });
  test('an eight-second flash read does not starve the running decoder', async ({ page }) => {
    test.setTimeout(90_000);
    await seedVerifiedVideo(page);
    await bootMockPlayer(page, { tag: 'continuous-slow-flash', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)).toBeGreaterThan(2);
    await page.evaluate(() => {
      const w = window as unknown as { __flashCheck: { delayed: boolean; waits: number; frames: number } };
      w.__flashCheck = { delayed: false, waits: 0, frames: 0 };
      const v = document.querySelector('video')!;
      v.addEventListener('waiting', () => w.__flashCheck.waits++);
      v.addEventListener('stalled', () => w.__flashCheck.waits++);
      const frame = () => { w.__flashCheck.frames++; v.requestVideoFrameCallback(frame); };
      v.requestVideoFrameCallback(frame);
      const match = Cache.prototype.match;
      Cache.prototype.match = async function(...args) {
        const key = String(args[0]);
        if (!w.__flashCheck.delayed && key.includes('/__venueos_loop__/') && /\/\d+$/.test(key)) {
          w.__flashCheck.delayed = true;
          await new Promise(r => setTimeout(r, 8000));
        }
        return match.apply(this, args);
      };
    });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), { timeout: 25_000 }).toBeGreaterThan(15);
    const state = await page.evaluate(() => ({
      ...(window as unknown as { __flashCheck: { delayed: boolean; waits: number; frames: number } }).__flashCheck,
      backend: document.querySelector('video')?.dataset.loopBackend,
    }));
    expect(state).toMatchObject({ delayed: true, waits: 0, backend: 'continuous' });
    expect(state.frames).toBeGreaterThan(100);
  });
  test('initial buffer loading is bounded preparation, not a decoder stall', async ({ page }) => {
    test.setTimeout(100_000);
    await seedVerifiedVideo(page);
    await page.addInitScript(() => {
      const match = Cache.prototype.match;
      let reads = 0;
      Cache.prototype.match = async function(...args) {
        if (String(args[0]).includes('/__venueos_loop__/') && /\/\d+$/.test(String(args[0])) && reads++ < 8) {
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
        return match.apply(this, args);
      };
    });
    await bootMockPlayer(page, { tag: 'continuous-startup-flash', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector('video');
      return v?.dataset.loopBackend === 'continuous' && v.currentTime > 3;
    }), { timeout: 65_000 }).toBe(true);
    const loop = await page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { fallbacks: number } | null }).__eduLoopBoundary());
    expect(loop?.fallbacks ?? 0).toBe(0);
  });
  test('preparation waits for a delayed first compositor frame', async ({ page }) => {
    test.setTimeout(80_000);
    // Deliberately withhold the first compositor observation. A playing event
    // or an advancing clock must not start concurrent fragment preparation.
    await page.addInitScript(() => {
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
      let first = true;
      HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
        return request.call(this, (now, meta) => {
          if (first) { first = false; setTimeout(() => callback(now, meta), 20_000); }
          else callback(now, meta);
        });
      };
    });
    await seedVerifiedVideo(page);
    await bootMockPlayer(page, { tag: 'continuous-slow-open', kind: 'video', videoMp4: true,
      playback: { loopMode: 'continuous' },
    });
    await page.waitForTimeout(16_000);
    expect(await page.locator('video').getAttribute('data-loop-backend')).toBe('preparing-continuous');
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector('video');
      return v?.dataset.loopBackend === 'continuous' && v.currentTime > 3;
    }), { timeout: 60_000 }).toBe(true);
    const loop = await page.evaluate(() => (window as unknown as { __eduLoopBoundary: () => { fallbacks: number } | null }).__eduLoopBoundary());
    expect(loop?.fallbacks ?? 0).toBe(0);
  });
  test('a startup buffer quota reduces headroom while preserving every video sample', async ({ page }) => {
    test.setTimeout(90_000);
    await seedVerifiedVideo(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __quotaTest: { writes: number; refused: boolean } };
      w.__quotaTest = { writes: 0, refused: false };
      const append = SourceBuffer.prototype.appendBuffer;
      SourceBuffer.prototype.appendBuffer = function(data) {
        if (data.byteLength > 1024 && ++w.__quotaTest.writes === 7) {
          w.__quotaTest.refused = true;
          throw new DOMException('Injected MSE memory pressure', 'QuotaExceededError');
        }
        return append.call(this, data);
      };
    });
    await bootMockPlayer(page, { tag: 'continuous-quota', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), { timeout: 20_000 }).toBeGreaterThan(8);
    const state = await page.evaluate(() => {
      const v = document.querySelector('video')!;
      return { refused: (window as unknown as { __quotaTest: { refused: boolean } }).__quotaTest.refused,
        backend: v.dataset.loopBackend, loop: v.loop, paused: v.paused, videos: document.querySelectorAll('video').length,
        snap: (window as unknown as { __eduLoopBoundary: () => { fallbacks: number; maxSkipMs: number; boundaries: number } }).__eduLoopBoundary() };
    });
    expect(state).toMatchObject({ refused: true, backend: 'continuous', loop: false, paused: false, videos: 1 });
    expect(state.snap).toMatchObject({ fallbacks: 0, maxSkipMs: 0 });
    expect(state.snap.boundaries).toBeGreaterThanOrEqual(3);
  });
  test('corrupted fragments fall back once to the original file and retain the per-file block on reload', async ({ page }) => {
    test.setTimeout(120_000);
    const hash = await seedVerifiedVideo(page);
    await bootMockPlayer(page, { tag: 'continuous-corrupt', kind: 'video', videoMp4: true, playback: { loopMode: 'continuous' } });
    await expect(page.locator('video[data-loop-backend="continuous"]')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)).toBeGreaterThan(1);
    await page.evaluate(() => {
      // Delay the replacement source opening to expose the reset interval.
      // The old pipeline has already been disposed at this point.
      const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...src, set(value: string) {
        if ((this as HTMLVideoElement).dataset.loopBackend === 'native') {
          setTimeout(() => src.set!.call(this, value), 2500);
        } else src.set!.call(this, value);
      } });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        if ((this as HTMLVideoElement).dataset.loopBackend === 'native') {
          return new Promise<void>((resolve, reject) => setTimeout(() => play.call(this).then(resolve, reject), 4000));
        }
        return play.call(this);
      };
    });
    await page.evaluate(async () => {
      const cache = await caches.open('venueos-continuous-loop-v1');
      for (const key of await cache.keys()) {
        if (/\/\d+$/.test(new URL(key.url).pathname)) await cache.put(key, new Response('bad', { headers: { 'content-length': '3' } }));
      }
    });
    await expect(page.locator('video[data-loop-backend="native"]')).toBeAttached({ timeout: 30_000 });
    const frame = page.locator('canvas[data-recovery-frame]');
    await expect(frame).toBeVisible();
    expect(await page.evaluate(() => Number(getComputedStyle(document.querySelector('canvas[data-recovery-frame]')!).zIndex) >
      Number(getComputedStyle(document.querySelector('video')!).zIndex))).toBe(true);
    await expect(page.locator('canvas[data-recovery-frame]')).toBeHidden({ timeout: 15_000 });
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
