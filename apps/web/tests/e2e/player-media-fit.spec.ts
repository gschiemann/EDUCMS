/**
 * Show full playlist media without stretching (2026-10-13, mediaFit.ts).
 *
 * Greg's case: the previous cover policy cropped the edges of a
 * 1080×1668 portrait video on a 1080×1920 panel. Playlist media now uses
 * `object-fit: contain`, so every source pixel remains visible.
 *
 * Each case puts a file of the WRONG shape on the glass — a 16:9 clip on a
 * portrait viewport, a 2:3 portrait picture on a landscape viewport — and
 * proves from the rendered DOM (computed style, not source) that the element
 * spans the viewport with `object-fit: contain` at the centre. Video is
 * checked on the single-element path and on the two-deck loop path.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
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
      return { fit: cs.objectFit, pos: cs.objectPosition, w: Math.round(r.width), h: Math.round(r.height) };
    });
  }, selector);
}

function guardPageErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
  });
}

test.describe('playlist media shows whole frame by default', () => {
  test('near-matching portrait art keeps all four edge markers', async ({ page }, testInfo) => {
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    const url = 'http://api.invalid/assets/whole-frame-1080x1668.svg';
    const m = playerManifest(playerIds('fit-near').screenId, 'images');
    m.playlists[0].items = [{ item_id: 'near', asset_id: 'near-art', url,
      duration_ms: 60000, sequence: 0, mime_type: 'image/svg+xml', muted: true,
      media_w: 1080, media_h: 1668, transition_type: 'NONE' }] as unknown as typeof m.playlists[0]['items'];
    const art = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1668" viewBox="0 0 1080 1668">' +
      '<rect width="1080" height="1668" fill="#dde9f2"/><rect x="4" y="4" width="1072" height="1660" fill="none" stroke="#123e68" stroke-width="8"/>' +
      '<g font-family="sans-serif" font-size="58" font-weight="bold" fill="#123e68">' +
      '<text x="16" y="72">TOP LEFT</text><text x="1064" y="72" text-anchor="end">TOP RIGHT</text>' +
      '<text x="16" y="1642">BOTTOM LEFT</text><text x="1064" y="1642" text-anchor="end">BOTTOM RIGHT</text>' +
      '<text x="540" y="840" text-anchor="middle">WHOLE FRAME</text></g></svg>';
    await bootMockPlayer(page, { tag: 'fit-near', kind: 'images', manifest: m,
      extraRoutes: async p => { await p.route(url, route => route.fulfill({ status: 200,
        contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: art })); } });
    const image = page.locator('img[data-slide-id]');
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect.poll(() => image.evaluate(el => {
      const im = el as HTMLImageElement;
      return im.naturalWidth / im.naturalHeight;
    })).toBeCloseTo(1080 / 1668, 5);
    await page.screenshot({ path: testInfo.outputPath('whole-near-match.png') });
  });
  test('a 16:9 video on a portrait screen (single-element path) is object-fit: contain, centred, full screen', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await bootMockPlayer(page, { tag: 'fit-video', kind: 'video' });
    await expect(page.locator('video').first()).toBeAttached({ timeout: 45_000 });
    await expect.poll(async () => (await fitOf(page, 'video')).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const vids = await fitOf(page, 'video');
    for (const v of vids) {
      expect(v.fit).toBe('contain');
      expect(v.pos).toBe('50% 50%');
      expect(v.w).toBe(540);
      expect(v.h).toBe(960);
    }
    // The clip really is the wrong shape for this screen (otherwise fill == cover proves nothing).
    const shape = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement;
      return { w: v.videoWidth, h: v.videoHeight };
    });
    if (shape.w && shape.h) expect(shape.w / shape.h).toBeGreaterThan(1.5);
  });

  test('the two-deck loop path contains too', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await bootMockPlayer(page, { tag: 'fit-twodeck', kind: 'video', playback: { loopMode: 'twodeck' } });
    await expect(page.locator('[data-loop-deck]').first()).toBeAttached({ timeout: 45_000 });
    const decks = await fitOf(page, '[data-loop-deck]');
    expect(decks.length).toBe(2);
    for (const d of decks) {
      expect(d.fit).toBe('contain');
      expect(d.pos).toBe('50% 50%');
    }
  });

  test('a 2:3 portrait image on a landscape screen is object-fit: contain, centred, full screen', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const tag = 'fit-image';
    const m = playerManifest(playerIds(tag).screenId, 'images');
    m.playlists[0].items = [{
      item_id: 'item-portrait',
      asset_id: 'asset-portrait',
      url: PORTRAIT_PNG,
      duration_ms: 10_000,
      sequence: 0,
      mime_type: 'image/png',
      transition_type: 'NONE',
      muted: true,
    }] as unknown as typeof m.playlists[0]['items'];
    const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'editor-portrait.png'));
    await bootMockPlayer(page, {
      tag, kind: 'images', manifest: m,
      extraRoutes: async (p) => {
        await p.route(PORTRAIT_PNG, (route) => route.fulfill({
          status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: png,
        }));
      },
    });
    const img = page.locator('img[data-slide-id]');
    await expect(img).toHaveCount(1, { timeout: 45_000 });
    await expect(img).toHaveCSS('object-fit', 'contain');
    await expect(img).toHaveCSS('object-position', '50% 50%');
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBe(800);
    const box = await img.boundingBox();
    expect(Math.round(box!.width)).toBe(1280);
    expect(Math.round(box!.height)).toBe(720);
  });
});
