/**
 * Crop to fill, never stretch (2026-10-11, owner decision — mediaFit.ts).
 *
 * Greg's case: a 1080×1668 portrait video on a 1080×1920 panel was drawn
 * `object-fit: fill` and stretched ~15 %. Playlist media that is not the
 * screen's exact shape must now cover the screen, centred, proportions kept.
 *
 * Each case puts a file of the WRONG shape on the glass — a 16:9 clip on a
 * portrait viewport, a 2:3 portrait picture on a landscape viewport — and
 * proves from the rendered DOM (computed style, not source) that the element
 * covers the whole viewport with `object-fit: cover` at the centre. Video is
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

test.describe('playlist media crops to fill — never stretched', () => {
  test('a 16:9 video on a portrait screen (single-element path) is object-fit: cover, centred, full screen', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await bootMockPlayer(page, { tag: 'fit-video', kind: 'video' });
    await expect(page.locator('video').first()).toBeAttached({ timeout: 45_000 });
    await expect.poll(async () => (await fitOf(page, 'video')).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const vids = await fitOf(page, 'video');
    for (const v of vids) {
      expect(v.fit).toBe('cover');
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

  test('the two-deck loop path covers too', async ({ page }) => {
    test.setTimeout(90_000);
    guardPageErrors(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await bootMockPlayer(page, { tag: 'fit-twodeck', kind: 'video', playback: { loopMode: 'twodeck' } });
    await expect(page.locator('[data-loop-deck]').first()).toBeAttached({ timeout: 45_000 });
    const decks = await fitOf(page, '[data-loop-deck]');
    expect(decks.length).toBe(2);
    for (const d of decks) {
      expect(d.fit).toBe('cover');
      expect(d.pos).toBe('50% 50%');
    }
  });

  test('a 2:3 portrait image on a landscape screen is object-fit: cover, centred, full screen', async ({ page }) => {
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
    await expect(img).toHaveCSS('object-fit', 'cover');
    await expect(img).toHaveCSS('object-position', '50% 50%');
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBe(800);
    const box = await img.boundingBox();
    expect(Math.round(box!.width)).toBe(1280);
    expect(Math.round(box!.height)).toBe(720);
  });
});
