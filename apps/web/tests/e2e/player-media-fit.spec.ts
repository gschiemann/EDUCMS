/**
 * Normal full-screen playlist media fills the viewport with no cropped edges
 * or letterboxing. Cover the real bitmap edge case, a mismatched video on both
 * playback paths, and a portrait bitmap on a landscape screen.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
const { PNG } = require('pngjs') as { PNG: { sync: { read(data: Buffer): { width: number; height: number; data: Buffer } } } };
import { bootMockPlayer, playerIds, playerManifest } from './helpers/mock-player';

const PORTRAIT_PNG = 'http://api.invalid/assets/portrait-800x1200.png';

async function fitOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    return els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { fit: cs.objectFit, pos: cs.objectPosition, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  }, selector);
}

function guardPageErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
  });
}

test.describe('normal full-screen playlist media fills the viewport', () => {
  test('near-portrait bitmap keeps all four colored corner markers at the screen edges', async ({ page }, testInfo) => {
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    const url = 'http://api.invalid/assets/full-frame-corners-1080x1668.png';
    const m = playerManifest(playerIds('fit-near').screenId, 'images');
    m.playlists[0].items = [{ item_id: 'near', asset_id: 'near-art', url,
      duration_ms: 60000, sequence: 0, mime_type: 'image/png', muted: true,
      media_w: 1080, media_h: 1668, transition_type: 'NONE' }] as unknown as typeof m.playlists[0]['items'];
    const bitmap = fs.readFileSync(path.join(__dirname, '../fixtures/full-frame-corners-1080x1668.png'));
    await bootMockPlayer(page, { tag: 'fit-near', kind: 'images', manifest: m,
      extraRoutes: async p => { await p.route(url, route => route.fulfill({ status: 200,
        contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: bitmap })); } });

    const image = page.locator('img[data-slide-id]');
    await expect(image).toHaveCSS('object-fit', 'fill');
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1080);
    expect(await image.boundingBox()).toMatchObject({ x: 0, y: 0, width: 540, height: 960 });

    const shot = PNG.sync.read(await page.screenshot({ path: testInfo.outputPath('fill-four-corner-proof.png') }));
    const pixel = (x: number, y: number) => {
      // Normalize device-pixel screenshots (WebKit DPR 2) to CSS coordinates.
      const sx = Math.round(x * shot.width / 540);
      const sy = Math.round(y * shot.height / 960);
      const i = (sy * shot.width + sx) * 4;
      return [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
    };
    expect(pixel(6, 6)).toEqual([225, 29, 72]);
    expect(pixel(533, 6)).toEqual([22, 163, 74]);
    expect(pixel(6, 953)).toEqual([37, 99, 235]);
    expect(pixel(533, 953)).toEqual([250, 204, 21]);
  });

  test('16:9 video fills portrait viewport on the single-element path', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await bootMockPlayer(page, { tag: 'fit-video-fill', kind: 'video' });
    await expect(page.locator('video').first()).toBeAttached({ timeout: 45_000 });
    await expect.poll(async () => (await fitOf(page, 'video')).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.locator('video').first().evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    for (const v of await fitOf(page, 'video')) {
      expect(v.fit).toBe('fill');
      expect(v.pos).toBe('50% 50%');
      expect(v.w).toBe(540);
      expect(v.h).toBe(960);
    }
    const shape = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement;
      return { w: v.videoWidth, h: v.videoHeight };
    });
    expect(shape.w / shape.h).toBeGreaterThan(1.5);

  });

  test('16:9 video fills portrait viewport on the two-deck path', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await bootMockPlayer(page, { tag: 'fit-twodeck-fill', kind: 'video', playback: { loopMode: 'twodeck' } });
    await expect(page.locator('[data-loop-deck]').first()).toBeAttached({ timeout: 45_000 });
    const decks = await fitOf(page, '[data-loop-deck]');
    expect(decks.length).toBe(2);
    for (const d of decks) {
      expect(d.fit).toBe('fill');
      expect(d.pos).toBe('50% 50%');
      expect(d.w).toBe(540);
      expect(d.h).toBe(960);
    }
  });

  test('portrait bitmap fills a landscape viewport edge to edge', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const m = playerManifest(playerIds('fit-landscape').screenId, 'images');
    m.playlists[0].items = [{ item_id: 'portrait', asset_id: 'portrait-art', url: PORTRAIT_PNG,
      duration_ms: 60000, sequence: 0, mime_type: 'image/png', muted: true,
      media_w: 1080, media_h: 1668, transition_type: 'NONE' }] as unknown as typeof m.playlists[0]['items'];
    const png = fs.readFileSync(path.join(__dirname, '../fixtures/full-frame-corners-1080x1668.png'));
    await bootMockPlayer(page, { tag: 'fit-landscape', kind: 'images', manifest: m,
      extraRoutes: async p => { await p.route(PORTRAIT_PNG, route => route.fulfill({ status: 200,
        contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: png })); } });
    const image = page.locator('img[data-slide-id]');
    await expect(image).toHaveCount(1, { timeout: 45_000 });
    await expect(image).toHaveCSS('object-fit', 'fill');
    await expect(image).toHaveCSS('object-position', '50% 50%');
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBe(1080);
    expect(await image.boundingBox()).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
    const shot = PNG.sync.read(await page.screenshot({ path: testInfo.outputPath('fill-landscape-four-corner-proof.png') }));
    const pixel = (x: number, y: number) => {
      const sx = Math.round(x * shot.width / 1280);
      const sy = Math.round(y * shot.height / 720);
      const i = (sy * shot.width + sx) * 4;
      return [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
    };
    expect(pixel(6, 6)).toEqual([225, 29, 72]);
    expect(pixel(1273, 6)).toEqual([22, 163, 74]);
    expect(pixel(6, 713)).toEqual([37, 99, 235]);
    expect(pixel(1273, 713)).toEqual([250, 204, 21]);
  });
});
