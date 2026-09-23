/**
 * designer-assets — the POS's own photo of each menu item on a POS-bound board
 * (2026-09-23, the Codex-parity wave).
 *
 * The Super Taco boards carry a photo per card; an AI board carried at most
 * one hero, and `MenuItem.imageUrl` never reached it. rehostItemPhotos checks
 * and copies up to 12 of them, four at a time, under ONE shared 8 s budget; a
 * photo that fails any gate is simply absent. attachPlanPhotos puts OUR copies
 * on the plan rows.
 *
 * No network, no Supabase: every fetch and upload is injected, and every image
 * is a real encoding built with sharp (test/supertaco-site.ts), so the decode
 * gates run for real. safeFetch itself is replaced with a thrower, so a code
 * path that ignored the injected fetch would fail loudly instead of reaching
 * the network.
 */
jest.mock('../branding/safe-fetch', () => ({
  ...jest.requireActual<object>('../branding/safe-fetch'),
  safeFetch: () => {
    throw new Error('the real safeFetch must not be reached from this spec');
  },
}));

import sharp from 'sharp';
import {
  rehostItemPhotos,
  designerItemPhotoSlot,
  storedBox,
  MAX_ITEM_PHOTOS,
  ITEM_PHOTO_BUDGET_MS,
  type DesignerAssetStorage,
} from './designer-assets';
import { attachPlanPhotos } from './designer-pos-binding';
import type { BindingPlan } from './menu-binding';
import type { safeFetch } from '../branding/safe-fetch';
import { photoJpeg, wordmarkPng } from '../../test/supertaco-site';

jest.setTimeout(30_000);

type FetchFn = typeof safeFetch;
type Reply = { status?: number; body: Buffer; contentType: string };

const POS = (name: string) => `https://images.toasttab.com/${name}.jpg`;
const ITEM_PATH = /^ai-designer\/t1\/item-[0-9a-f]{16}\.jpg$/;

function memoryBucket(opts: { fail?: boolean; delayMs?: (path: string) => number } = {}) {
  const uploads: Array<{ path: string; contentType: string; buf: Buffer }> = [];
  const storage: DesignerAssetStorage = {
    upload: async (path: string, buf: Buffer, contentType: string) => {
      const d = opts.delayMs?.(path) ?? 0;
      if (d) await new Promise((r) => setTimeout(r, d));
      if (opts.fail) throw new Error('storage down');
      uploads.push({ path, contentType, buf });
      return `https://sb.example/storage/v1/object/public/assets/${path}`;
    },
  };
  return { storage, uploads };
}

/**
 * A fetch double: `reply(url)` answers each URL (a Promise that never settles
 * = a stalled download). Counts calls, per-URL calls and the most requests
 * ever in flight at once.
 */
function fetcher(reply: (url: string) => Reply | Promise<Reply>, opts: { delayMs?: number } = {}) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = (async (url: string) => {
    calls.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const r = await reply(url);
      return { status: r.status ?? 200, body: r.body, contentType: r.contentType, finalUrl: url };
    } finally {
      inFlight -= 1;
    }
  }) as unknown as FetchFn;
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

const jpeg = (body: Buffer): Reply => ({ body, contentType: 'image/jpeg' });

describe('rehostItemPhotos — the card-sized copy', () => {
  it('copies a POS photo to ai-designer/<tenant>/item-<hash16>.jpg at ~1.25x a menu card frame', async () => {
    const photo = await photoJpeg(1600, 1067, 41);
    const { storage, uploads } = memoryBucket();
    const f = fetcher(() => jpeg(photo));
    const res = await rehostItemPhotos([{ n: 0, url: POS('birria') }], { tenantId: 't1', screenWidth: 1920, screenHeight: 1080 }, { storage, fetch: f.fetch });
    expect(res.attempted).toEqual([0]);
    expect(res.timedOut).toBe(false);
    const got = res.photos.get(0)!;
    expect(got).toMatchObject({ source: 'pos', sourceUrl: POS('birria'), width: 1600, height: 1067, format: 'jpeg' });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(ITEM_PATH);
    expect(uploads[0].contentType).toBe('image/jpeg');
    expect(got.url).toBe(`https://sb.example/storage/v1/object/public/assets/${uploads[0].path}`);
    // A 1080p card frame is 480x320, stored at ~1.25x (600x400) — never the 1600-px original.
    expect(designerItemPhotoSlot(1920, 1080)).toEqual({ width: 480, height: 320 });
    expect(storedBox(designerItemPhotoSlot(1920, 1080))).toEqual({ width: 600, height: 400 });
    const meta = await sharp(uploads[0].buf).metadata();
    expect(meta.width).toBeLessThanOrEqual(600);
    expect(meta.height).toBeLessThanOrEqual(400);
    // The POS's own URL is never what a board gets.
    expect(got.url).not.toContain('toasttab');
  });

  it('a photo that fails a gate leaves only ITS row photo-less', async () => {
    const good = await photoJpeg(1200, 800, 42);
    const banner = await wordmarkPng(1400, 392); // a wordmark strip, not a photo
    const small = await photoJpeg(300, 150, 43); // short side under the card frame's floor
    const { storage } = memoryBucket();
    const f = fetcher((url) => {
      if (url === POS('good')) return jpeg(good);
      if (url === POS('missing')) return { status: 404, body: Buffer.from('not found'), contentType: 'text/plain' };
      if (url === POS('page')) return { body: Buffer.from('<html>login</html>'), contentType: 'text/html' };
      if (url === POS('banner')) return { body: banner, contentType: 'image/png' };
      if (url === POS('small')) return jpeg(small);
      return { body: Buffer.alloc(900, 1), contentType: 'image/jpeg' }; // a 900-byte "photo"
    });
    const res = await rehostItemPhotos(
      ['good', 'missing', 'page', 'banner', 'small', 'tiny'].map((name, n) => ({ n, url: POS(name) })),
      { tenantId: 't1', screenWidth: 1920, screenHeight: 1080 },
      { storage, fetch: f.fetch },
    );
    expect([...res.photos.keys()]).toEqual([0]);
    expect(res.attempted).toEqual([0, 1, 2, 3, 4, 5]);
    const reasons = res.rejected.map((r) => r.reason).join(' | ');
    expect(reasons).toMatch(/HTTP 404/);
    expect(reasons).toMatch(/not an image \(text\/html\)/);
    expect(reasons).toMatch(/strip\/banner shape \(1400×392\)/);
    expect(reasons).toMatch(/too small: 300×150/);
    expect(reasons).toMatch(/tiny file \(900 bytes\)/);
  });
});

describe('rehostItemPhotos — at most 12, four at a time, one shared budget', () => {
  it(`never tries more than ${MAX_ITEM_PHOTOS} photos, and never more than 4 at once`, async () => {
    const photo = await photoJpeg(1200, 800, 44);
    const { storage, uploads } = memoryBucket();
    const f = fetcher(() => jpeg(photo), { delayMs: 25 });
    const items = Array.from({ length: 15 }, (_v, n) => ({ n, url: POS(`dish-${n}`) }));
    const res = await rehostItemPhotos(items, { tenantId: 't1', screenWidth: 1920, screenHeight: 1080 }, { storage, fetch: f.fetch });
    expect(f.calls).toHaveLength(12);
    expect(f.calls).toEqual(items.slice(0, 12).map((i) => i.url));
    expect(res.attempted).toEqual(items.slice(0, 12).map((i) => i.n));
    expect(res.photos.size).toBe(12);
    expect(f.maxInFlight()).toBe(4);
    // One photo, byte-identical copies: one content-hashed object, upserted each time.
    expect(new Set(uploads.map((u) => u.path)).size).toBe(1);
  });

  it('the same POS photo on two rows is fetched and stored once, and both rows show it', async () => {
    const shared = await photoJpeg(1200, 800, 45);
    const other = await photoJpeg(1200, 800, 46);
    const { storage, uploads } = memoryBucket();
    const f = fetcher((url) => jpeg(url === POS('shared') ? shared : other));
    const res = await rehostItemPhotos(
      [{ n: 0, url: POS('shared') }, { n: 1, url: POS('shared') }, { n: 2, url: POS('other') }],
      { tenantId: 't1' },
      { storage, fetch: f.fetch },
    );
    expect(f.calls.filter((u) => u === POS('shared'))).toHaveLength(1);
    expect(uploads).toHaveLength(2);
    expect(res.photos.get(0)!.url).toBe(res.photos.get(1)!.url);
    expect(res.photos.get(2)!.url).not.toBe(res.photos.get(0)!.url);
  });

  it('ONE budget for all of them: a stalled download costs its own row, never the batch', async () => {
    const photo = await photoJpeg(1200, 800, 47);
    const { storage } = memoryBucket();
    const never = new Promise<Reply>(() => undefined);
    const f = fetcher((url) => (url.includes('stall') ? never : jpeg(photo)));
    const started = Date.now();
    const res = await rehostItemPhotos(
      [{ n: 0, url: POS('a') }, { n: 1, url: POS('b') }, { n: 2, url: POS('stall-1') }, { n: 3, url: POS('stall-2') }, { n: 4, url: POS('c') }, { n: 5, url: POS('d') }],
      // (a photo is only STARTED with >= 800 ms of the budget left)
      { tenantId: 't1', budgetMs: 1_500 },
      { storage, fetch: f.fetch },
    );
    const elapsed = Date.now() - started;
    expect([...res.photos.keys()].sort()).toEqual([0, 1, 4, 5]);
    expect(elapsed).toBeLessThan(1_500 + 1_500);
    expect(ITEM_PHOTO_BUDGET_MS).toBe(8_000);
  });

  it('a photo still being copied when the budget ends never reaches the result — not even later', async () => {
    const photo = await photoJpeg(1200, 800, 48);
    const late = await photoJpeg(1200, 800, 49);
    let slowPath = '';
    const { storage, uploads } = memoryBucket({
      delayMs: (path) => (path === slowPath ? 2_500 : 0),
    });
    const f = fetcher((url) => jpeg(url === POS('late') ? late : photo));
    // Learn where the late photo lands (content-hashed), then make exactly that upload slow.
    const probe = memoryBucket();
    await rehostItemPhotos([{ n: 0, url: POS('late') }], { tenantId: 't1' }, { storage: probe.storage, fetch: f.fetch });
    slowPath = probe.uploads[0].path;

    const res = await rehostItemPhotos(
      [{ n: 0, url: POS('fast') }, { n: 1, url: POS('late') }],
      { tenantId: 't1', budgetMs: 1_500 },
      { storage, fetch: f.fetch },
    );
    expect(res.timedOut).toBe(true);
    expect([...res.photos.keys()]).toEqual([0]);
    await new Promise((r) => setTimeout(r, 1_500)); // the slow copy finishes after the cut…
    expect(uploads.map((u) => u.path)).toContain(slowPath);
    expect(res.photos.has(1)).toBe(false); // …and the answer already given does not change.
  });

  it('our storage down: no photo at all, and the pool stops instead of fetching the rest', async () => {
    const photo = await photoJpeg(1200, 800, 50);
    const { storage } = memoryBucket({ fail: true });
    const f = fetcher(() => jpeg(photo), { delayMs: 10 });
    const res = await rehostItemPhotos(
      Array.from({ length: 12 }, (_v, n) => ({ n, url: POS(`dish-${n}`) })),
      { tenantId: 't1' },
      { storage, fetch: f.fetch },
    );
    expect(res.photos.size).toBe(0);
    expect(f.calls.length).toBeLessThanOrEqual(4); // only the first wave was ever in flight
    expect(res.rejected.some((r) => /could not copy to our storage/.test(r.reason))).toBe(true);
  });

  it('only https POS URLs are tried; no storage means nothing is fetched at all', async () => {
    const photo = await photoJpeg(1200, 800, 51);
    const { storage } = memoryBucket();
    const f = fetcher(() => jpeg(photo));
    const res = await rehostItemPhotos(
      [{ n: 0, url: 'http://images.toasttab.com/plain.jpg' }, { n: 1, url: 'data:image/jpeg;base64,AAAA' }, { n: 2, url: POS('ok') }],
      { tenantId: 't1' },
      { storage, fetch: f.fetch },
    );
    expect(f.calls).toEqual([POS('ok')]);
    expect([...res.photos.keys()]).toEqual([2]);

    const none = fetcher(() => jpeg(photo));
    const out = await rehostItemPhotos([{ n: 0, url: POS('ok') }], { tenantId: 't1' }, { storage: null, fetch: none.fetch });
    expect(out.photos.size).toBe(0);
    expect(none.calls).toEqual([]);
  });
});

describe('attachPlanPhotos — our copies onto the plan rows', () => {
  const plan = (): BindingPlan => ({
    providerId: 'toast',
    providerName: 'Toast',
    connectionId: 'conn-1',
    items: [
      { n: 0, externalId: 'a', name: 'Birria', priceCents: 1450, priceText: '$14.50', section: 'Tacos', sourceImageUrl: POS('birria') },
      { n: 1, externalId: 'b', name: 'Fish', priceCents: 450, priceText: '$4.50', section: 'Tacos' },
      { n: 2, externalId: 'c', name: 'Asada', priceCents: 1750, priceText: '$17.50', section: 'Burritos', sourceImageUrl: POS('broken') },
    ],
  });

  it('each row gets OUR copy of its own photo, or nothing — and the plan is marked as the whole truth', async () => {
    const photo = await photoJpeg(1200, 800, 52);
    const { storage } = memoryBucket();
    const f = fetcher((url) => (url === POS('birria') ? jpeg(photo) : { status: 500, body: Buffer.from('x'), contentType: 'text/plain' }));
    const p = plan();
    await attachPlanPhotos(p, { tenantId: 't1', canvas: { width: 3840, height: 2160 } }, { storage, fetch: f.fetch });
    expect(p.itemPhotos).toBe(true);
    expect(p.items[0].imageUrl).toMatch(/^https:\/\/sb\.example\/.*\/ai-designer\/t1\/item-[0-9a-f]{16}\.jpg$/);
    expect(p.items[1].imageUrl).toBeUndefined();
    expect(p.items[2].imageUrl).toBeUndefined(); // its fetch failed: no photo, never a stand-in
    expect(f.calls).toEqual([POS('birria'), POS('broken')]);
  });

  it('with no storage: itemPhotos is still true (so the binder strips borrowed photos), no row has one, nothing is fetched', async () => {
    const f = fetcher(() => {
      throw new Error('must not fetch');
    });
    const p = plan();
    await attachPlanPhotos(p, { tenantId: 't1', canvas: { width: 1920, height: 1080 } }, null);
    expect(p.itemPhotos).toBe(true);
    expect(p.items.map((i) => i.imageUrl)).toEqual([undefined, undefined, undefined]);
    await attachPlanPhotos(plan(), { tenantId: 't1', canvas: { width: 1920, height: 1080 } }, { storage: null, fetch: f.fetch });
    expect(f.calls).toEqual([]);
  });
});
