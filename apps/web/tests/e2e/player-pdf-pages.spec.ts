/**
 * A PDF on a screen is its pages, one picture at a time (2026-10-05, media
 * beta test M2-02 / L3).
 *
 * The API renders a PDF's pages once and the normal manifest hands a screen
 * one IMAGE item per page — ids `${playlistItem}#p<n>`, the same asset id,
 * each page's own url / hash, the item's duration on every page — so the
 * player needs no PDF support at all. This boots the fully mocked player with
 * exactly that manifest shape (a 3-page PDF between two ordinary images) and
 * proves, in a real browser, that the three pages are three different pictures
 * shown in turn: the `#p` ids break nothing in the player's ordering,
 * readiness gating or rotation. No PDF and no `<iframe>` ever reaches the page.
 */
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { bootMockPlayer, playerIds, playerManifest } from './helpers/mock-player';

/** Three distinguishable 2×2 PNGs (served under .webp names, as page frames are). */
const PAGE_PNG = [
  // red, green, blue — 2×2, made with sharp
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4Iyd3R06OAUIBACGmBGH6Pla+AAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWOQW2Ajt8CGAUIBABruA+mkkT2fAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWOQs7kkZ3OJAUIBAB4OBLF73a3FAAAAAElFTkSuQmCC',
].map((b64) => Buffer.from(b64, 'base64'));

const BASE = 'http://api.invalid/storage/v1/object/public/assets/test-tenant/pdf-pages/asset-pdf/k1/';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function pdfPagesManifest(tag: string) {
  const { screenId } = playerIds(tag);
  const m = playerManifest(screenId, 'images');
  const [intro, , outro] = m.playlists[0].items;
  const pages = PAGE_PNG.map((png, i) => ({
    item_id: 'item-pdf#p' + (i + 1),
    asset_id: 'asset-pdf',
    asset_hash: sha(png),
    asset_size: png.length,
    url: `${BASE}p${i + 1}-landscape.webp`,
    duration_ms: 1_200,
    sequence: 1,
    mime_type: 'image/webp',
    transition_type: 'NONE',
    muted: true,
  }));
  m.playlists[0] = {
    ...m.playlists[0],
    name: 'Menu PDF',
    items: [intro, ...pages, { ...outro, sequence: 2 }] as typeof m.playlists[0]['items'],
  };
  return m;
}

/** The src of the slide currently on glass (opacity 1) — only once it has actually decoded. */
async function activeSrc(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const on = Array.from(document.querySelectorAll<HTMLImageElement>('img[data-slide-id]')).find(
      (img) => getComputedStyle(img).opacity === '1' && img.complete && img.naturalWidth > 0,
    );
    return on ? on.getAttribute('src') : null;
  });
}

test('a 3-page PDF item plays as three different pictures, in turn — no PDF, no iframe', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('pageerror', (err) => {
    if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
  });
  const pdfRequests: string[] = [];
  page.on('request', (req) => {
    if (/\.pdf(\?|$)/i.test(req.url())) pdfRequests.push(req.url());
  });

  await bootMockPlayer(page, {
    tag: 'pdf-pages',
    kind: 'images',
    manifest: pdfPagesManifest('pdf-pages'),
    extraRoutes: async (p) => {
      await p.route(/\/pdf-pages\/asset-pdf\/k1\/p(\d)-landscape\.webp/, (route) => {
        const n = Number(/p(\d)-landscape/.exec(route.request().url())![1]);
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: PAGE_PNG[n - 1],
        });
      });
    },
  });

  // Every page is its own slide, keyed by its `#p` item id.
  await expect(page.locator('img[data-slide-id*="item-pdf#p"]')).toHaveCount(3, { timeout: 30_000 });
  const ids = await page.locator('img[data-slide-id*="item-pdf#p"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-slide-id')),
  );
  expect(ids.map((id) => /#p\d$/.exec(String(id))?.[0])).toEqual(['#p1', '#p2', '#p3']);

  // Watch the glass: each page comes up on its own, in page order.
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const src = await activeSrc(page);
        const m = src && /p(\d)-landscape\.webp/.exec(src);
        if (m && seen[seen.length - 1] !== m[1]) seen.push(m[1]);
        return ['1', '2', '3'].every((n) => seen.includes(n));
      },
      { timeout: 45_000, intervals: [150], message: `pages seen on glass: ${JSON.stringify(seen)}` },
    )
    .toBe(true);
  const firstLap = seen.slice(0, 3);
  expect(firstLap).toEqual(['1', '2', '3']);

  expect(await page.locator('iframe').count()).toBe(0);
  expect(pdfRequests).toEqual([]);
});
