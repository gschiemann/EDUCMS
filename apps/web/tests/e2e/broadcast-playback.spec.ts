import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, playerManifest, playerIds, ok } from './helpers/mock-player';

async function push(page: Page, type: string, payload: unknown = {}) {
  await page.evaluate(({ type, payload }) => {
    const socket = (window as unknown as { __eduTestRealtime: { deliver(message: unknown): void } }).__eduTestRealtime;
    socket.deliver({ type, timestamp: Date.now(), signature: 'test-signature', eventId: `${type}-${Date.now()}`, payload });
  }, { type, payload });
}

test('banner arrival, resize and clear preserve the running video and its clock', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const tag = 'broadcast-continuity';
  const manifest = playerManifest(playerIds(tag).screenId, 'video', { loopMode: 'native' }, 1, true, 'loop-long-gop.mp4');
  let message: Record<string, unknown> | null = null;
  let delayingClear = false;
  await bootMockPlayer(page, { tag, kind: 'video', videoMp4: true, videoMp4Fixture: 'loop-long-gop.mp4', manifest,
    extraRoutes: async p => {
      await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: message ? [message] : [] }));
      await p.route(`**/api/v1/screens/${playerIds(tag).screenId}/manifest`, async r => {
        if (delayingClear) await new Promise(resolve => setTimeout(resolve, 1000));
        return ok(r, manifest);
      });
    },
  });
  await expect.poll(() => page.evaluate(() => {
    const video = document.querySelector('video');
    return !!video && !video.paused && video.currentTime > 1;
  }), { timeout: 120000 }).toBe(true);
  await page.evaluate(() => {
    const w = window as unknown as { __bannerVideo: HTMLVideoElement; __bannerEvents: string[]; __bannerStartTime: number };
    w.__bannerVideo = document.querySelector('video')!;
    w.__bannerEvents = [];
    w.__bannerStartTime = w.__bannerVideo.currentTime;
    for (const event of ['pause', 'emptied', 'loadstart', 'seeking']) w.__bannerVideo.addEventListener(event, () => w.__bannerEvents.push(event));
  });
  message = { messageId: 'banner-one', id: 'banner-one', type: 'TEXT_BROADCAST', severity: 'WARN', text: 'Please use the north entrance.', textBlob: 'Please use the north entrance.', mediaUrls: [], audioUrl: null, expiresAt: null, createdAt: new Date().toISOString() };
  await push(page, 'TEXT_BROADCAST', message);
  const banner = page.locator('[data-edu-emergency-root="banner"]');
  const root = page.locator('[data-edu-player-root="media"]');
  await expect(banner).toBeVisible();
  await expect.poll(async () => {
    const a = await banner.boundingBox(); const b = await root.boundingBox();
    return !!a && !!b && b.y >= a.y + a.height - 1 && b.y + b.height <= 721;
  }).toBe(true);
  await expect(page.locator('[data-edu-emergency-transition]')).toHaveCount(0);
  await page.waitForTimeout(600);
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { __bannerVideo: HTMLVideoElement; __bannerStartTime: number };
    return document.querySelector('video') === w.__bannerVideo && !w.__bannerVideo.paused && w.__bannerVideo.currentTime > w.__bannerStartTime + 0.5;
  })).toBe(true);
  if (process.env.BROADCAST_SHOTS) await page.screenshot({ path: `${process.env.BROADCAST_SHOTS}/player-banner-${test.info().project.name}.png` });
  message = null;
  delayingClear = true;
  await push(page, 'ALL_CLEAR_MESSAGE');
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => Math.round((await root.boundingBox())?.height || 0)).toBe(720);
  await expect(page.locator('[data-edu-emergency-transition]')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const w = window as unknown as { __bannerVideo: HTMLVideoElement; __bannerEvents: string[] };
    return { sameVideo: document.querySelector('video') === w.__bannerVideo, paused: w.__bannerVideo.paused, events: w.__bannerEvents };
  })).toEqual({ sameVideo: true, paused: false, events: [] });
});

test('an animated webpage keeps the same iframe document and viewport under a banner', async ({ page }) => {
  test.setTimeout(120000);
  const tag = 'broadcast-iframe';
  const manifest = playerManifest(playerIds(tag).screenId, 'website');
  let loads = 0;
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route('**/api/v1/proxy/web*', r => {
      loads++;
      return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="background:#1e293b;color:white"><h1>Playing content</h1><script>window.probe={started:performance.now(),width:innerWidth,height:innerHeight};</script></body></html>' });
    });
    await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: [] }));
  } });
  const frame = page.frames().find(f => f.url().includes('/proxy/web'));
  await expect.poll(() => page.frames().some(f => f.url().includes('/proxy/web'))).toBe(true);
  const content = frame || page.frames().find(f => f.url().includes('/proxy/web'))!;
  await expect(content.getByRole('heading', { name: 'Playing content' })).toBeVisible();
  const before = await content.evaluate(() => ({ time: performance.now(), width: innerWidth, height: innerHeight }));
  const initialLoads = loads;
  await push(page, 'TEXT_BROADCAST', { messageId: 'iframe-banner', severity: 'INFO', text: 'A routine announcement.' });
  await expect(page.locator('[data-edu-emergency-root="banner"]')).toBeVisible();
  await push(page, 'ALL_CLEAR_MESSAGE');
  await expect(page.locator('[data-edu-emergency-root="banner"]')).toHaveCount(0);
  expect(content.isDetached()).toBe(false);
  const after = await content.evaluate(() => ({ time: performance.now(), width: innerWidth, height: innerHeight }));
  expect(after.time).toBeGreaterThan(before.time);
  expect({ width: after.width, height: after.height }).toEqual({ width: before.width, height: before.height });
  expect(loads).toBe(initialLoads);
});
