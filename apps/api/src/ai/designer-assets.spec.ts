/**
 * designer-assets — the AI Designer's logo, photo and palette are CHECKED
 * (real pixels, through safeFetch) and copied to OUR storage before any prompt
 * sees them (2026-09-22, the Super Taco boards).
 *
 * Every fetch and every upload is injected: no network, no Supabase. Images
 * are real encodings built with sharp (test/supertaco-site.ts), so the decode
 * gates run for real.
 */
const safeFetchMock = jest.fn();
jest.mock('../branding/safe-fetch', () => ({
  ...jest.requireActual<object>('../branding/safe-fetch'),
  safeFetch: (...args: unknown[]): unknown => safeFetchMock(...args),
}));

import sharp from 'sharp';
import {
  resolveDesignerAssets,
  designerAssetSlots,
  storedBox,
  minPhotoShortSide,
  logoPalette,
  stockQueryFromPreview,
  rehostRemoteImage,
  unresolvedDesignerAssets,
  MIN_PHOTO_BYTES,
  type DesignerAssetStorage,
  type DesignerStockSource,
} from './designer-assets';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import type { safeFetch } from '../branding/safe-fetch';
import type { StockImageResult } from './stock-image.service';
import {
  photoJpeg,
  photoPng,
  wordmarkPng,
  blurPlaceholderJpeg,
  supertacoSite,
  isOrangeRed,
  SUPERTACO_URL,
  SUPERTACO_LOGO_ORIGINAL,
  SUPERTACO_HERO_ORIGINAL,
  SUPERTACO_MEDIA,
} from '../../test/supertaco-site';

// Real encodes + decodes of megapixel images are CPU-bound (~0.1 s per test
// locally); a slow CI runner gets room rather than a flake.
jest.setTimeout(30_000);

type Route = { body: Buffer; contentType: string; status?: number };
type FetchFn = typeof safeFetch;

/** A safeFetch stand-in over a fixed URL → response map. Unknown URLs throw. */
function router(routes: Record<string, Route>): {
  fetch: FetchFn;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch = (url: string) => {
    calls.push(url);
    const hit = routes[url];
    if (!hit) return Promise.reject(new Error(`no route for ${url}`));
    return Promise.resolve({
      status: hit.status ?? 200,
      body: hit.body,
      contentType: hit.contentType,
      finalUrl: url,
    });
  };
  return { fetch, calls };
}

/** An in-memory bucket that answers like SupabaseStorageService.upload. */
function memoryBucket(opts: { fail?: boolean } = {}) {
  const uploads: Array<{ path: string; contentType: string; buf: Buffer }> = [];
  const storage: DesignerAssetStorage = {
    upload: (path: string, buf: Buffer, contentType: string) => {
      if (opts.fail) return Promise.reject(new Error('storage down'));
      uploads.push({ path, contentType, buf });
      return Promise.resolve(
        `https://sb.example/storage/v1/object/public/assets/${path}`,
      );
    },
  };
  return { storage, uploads };
}

/** A Pexels stand-in that records every search it is asked for. */
function stockSource(configured: boolean, hit: StockImageResult | null = null) {
  const searches: Array<[string, unknown]> = [];
  const source: DesignerStockSource = {
    isConfigured: () => configured,
    search: (query, opts) => {
      searches.push([query, opts]);
      return Promise.resolve(hit);
    },
  };
  return { source, searches };
}

const noStock = stockSource(false).source;

const LOGO = 'https://acme.example/img/acme-logo.png';
const HERO = 'https://acme.example/img/patio.jpg';

function preview(over: Record<string, unknown> = {}) {
  return {
    displayName: 'Acme Tacos',
    palette: { primary: '#123456', accent: '#654321' },
    paletteSource: 'page',
    colors: [{ hex: '#116dff' }],
    logos: [{ url: LOGO, kind: 'img-logo', score: 90, headerMark: true }],
    heroImages: [
      { url: HERO, kind: 'large-img', width: 1600, height: 1000, score: 70 },
    ],
    ...over,
  };
}

describe('slots — what "the slot" means for a 4K board', () => {
  it('logo box 1200×400, photo box = the canvas, stored at ~1.25× (never past 4096)', () => {
    const s = designerAssetSlots();
    expect(s.logo).toEqual({ width: 1200, height: 400 });
    expect(s.photo).toEqual({ width: 3840, height: 2160 });
    expect(storedBox(s.logo)).toEqual({ width: 1500, height: 500 });
    expect(storedBox(s.photo)).toEqual({ width: 4096, height: 2700 });
  });

  it('a photo needs an 800 px short side — or 60% of a smaller slot', () => {
    expect(minPhotoShortSide({ width: 3840, height: 2160 })).toBe(800);
    expect(minPhotoShortSide({ width: 600, height: 400 })).toBe(240);
    expect(minPhotoShortSide({ width: 100, height: 100 })).toBe(200);
  });
});

describe('photo — the decoded-size gate', () => {
  it('ACCEPTS a real 1200×800 photo, downscaled and copied to OUR bucket', async () => {
    const { fetch, calls } = router({
      [LOGO]: { body: await wordmarkPng(1400, 392), contentType: 'image/png' },
      [HERO]: {
        body: await photoJpeg(1200, 800, 3),
        contentType: 'image/jpeg',
      },
    });
    const { storage, uploads } = memoryBucket();
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview() },
      { fetch, storage, stock: noStock },
    );

    expect(out.photo).toMatchObject({
      source: 'site',
      sourceUrl: HERO,
      width: 1200,
      height: 800,
      format: 'jpeg',
    });
    expect(out.photo!.url).toMatch(
      /^https:\/\/sb\.example\/.*\/ai-designer\/t1\/photo-[0-9a-f]{16}\.jpg$/,
    );
    const up = uploads.find((u) => u.path.includes('/photo-'))!;
    expect(up.contentType).toBe('image/jpeg');
    const stored = await sharp(up.buf).metadata();
    expect(stored.format).toBe('jpeg');
    expect(stored.width).toBeLessThanOrEqual(4096);
    expect(calls).toContain(HERO);
  });

  it('REJECTS a photo whose real pixels are too small (600×400), whatever the page labelled it', async () => {
    const { fetch } = router({
      [HERO]: { body: await photoJpeg(600, 400, 3), contentType: 'image/jpeg' },
    });
    const { storage, uploads } = memoryBucket();
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview({ logos: [] }) },
      { fetch, storage, stock: noStock },
    );
    expect(out.photo).toBeNull();
    expect(uploads).toHaveLength(0);
    const refusal = out.rejected.find((r) => r.url === HERO);
    expect(refusal?.role).toBe('photo');
    expect(refusal?.reason).toMatch(/too small: 600×400/);
  });

  it('REJECTS a tiny file — a thumbnail or loading placeholder (the 5,200-byte Wix blur)', async () => {
    const blur = await blurPlaceholderJpeg();
    expect(blur.length).toBeLessThan(MIN_PHOTO_BYTES);
    const { fetch } = router({
      [HERO]: { body: blur, contentType: 'image/jpeg' },
    });
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview({ logos: [] }) },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.photo).toBeNull();
    expect(out.rejected[0].reason).toMatch(/tiny file/);
  });

  it('never FETCHES a placeholder URL the CDN cannot turn back into an original', async () => {
    const lqip = 'https://cdn.example.com/lqip/patio.jpg';
    const { fetch, calls } = router({});
    await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          logos: [],
          heroImages: [
            { url: lqip, kind: 'large-img', width: 1805, height: 670 },
          ],
        }),
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(calls).not.toContain(lqip);
  });

  it('fetches the Wix ORIGINAL behind a blur_2 placeholder — never the placeholder itself', async () => {
    const blurUrl =
      'https://static.wixstatic.com/media/abc_123~mv2.jpg/v1/fill/w_151,h_101,al_c,q_80,blur_2,enc_avif/abc_123~mv2.jpg';
    const original = 'https://static.wixstatic.com/media/abc_123~mv2.jpg';
    const { fetch, calls } = router({
      [original]: {
        body: await photoJpeg(1200, 800, 9),
        contentType: 'image/jpeg',
      },
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          logos: [],
          heroImages: [
            {
              url: blurUrl,
              kind: 'large-img',
              width: 1805,
              height: 670,
              naturalWidth: 6000,
              naturalHeight: 4000,
              placeholder: true,
            },
          ],
        }),
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.photo?.sourceUrl).toBe(original);
    expect(calls.some((u) => /blur_\d/.test(u))).toBe(false);
  });

  it('rejects a thin strip and a transparent cutout — neither is a photo', async () => {
    const strip = await photoJpeg(3000, 800, 4); // 3.75:1
    const cutoutBuf = await sharp({
      create: {
        width: 900,
        height: 1300,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: await photoPng(500, 700, 6), left: 200, top: 300 }])
      .png()
      .toBuffer();
    const STRIP = 'https://acme.example/img/strip.jpg';
    const CUT = 'https://acme.example/img/cutout.png';
    const { fetch } = router({
      [STRIP]: { body: strip, contentType: 'image/jpeg' },
      [CUT]: { body: cutoutBuf, contentType: 'image/png' },
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          logos: [],
          heroImages: [
            { url: STRIP, kind: 'large-img', width: 3000, height: 800 },
            { url: CUT, kind: 'large-img', width: 900, height: 1300 },
          ],
        }),
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.photo).toBeNull();
    const reasons = out.rejected.map((r) => r.reason).join(' | ');
    expect(reasons).toMatch(/strip\/banner shape/);
    expect(reasons).toMatch(/transparent cutout/);
  });
});

describe('logo — checked, never a photo, palette from its own pixels', () => {
  it('copies the real wordmark as a PNG and takes the palette from ITS inks (not the page)', async () => {
    const { fetch } = router({
      [LOGO]: { body: await wordmarkPng(1400, 392), contentType: 'image/png' },
    });
    const { storage, uploads } = memoryBucket();
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview({ heroImages: [] }) },
      { fetch, storage, stock: noStock },
    );
    expect(out.logo).toMatchObject({
      source: 'site',
      sourceUrl: LOGO,
      width: 1400,
      height: 392,
      format: 'png',
    });
    expect(out.logo!.lowRes).toBeUndefined();
    expect(out.logo!.url).toMatch(/\/ai-designer\/t1\/logo-[0-9a-f]{16}\.png$/);
    const up = uploads.find((u) => u.path.includes('/logo-'))!;
    expect(up.contentType).toBe('image/png');
    const meta = await sharp(up.buf).metadata();
    expect(meta.hasAlpha).toBe(true); // transparency survives the copy
    expect(out.paletteSource).toBe('logo');
    expect(isOrangeRed(out.palette[0])).toBe(true);
    expect(out.palette).not.toContain('#116dff');
    expect(out.palette).not.toContain('#123456');
  });

  it('flags a small real logo lowRes instead of dropping it', async () => {
    const { fetch } = router({
      [LOGO]: { body: await wordmarkPng(500, 140), contentType: 'image/png' },
    });
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview({ heroImages: [] }) },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.logo?.lowRes).toBe(true);
  });

  it('REFUSES a "logo" whose pixels are a photograph — and never takes colors from it', async () => {
    const { fetch } = router({
      [LOGO]: { body: await photoPng(512, 512, 5), contentType: 'image/png' },
    });
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview({ heroImages: [] }) },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.logo).toBeNull();
    expect(out.rejected[0].reason).toMatch(/decodes as a photograph/);
    // The scrape's own (page) palette, untouched by the photo.
    expect(out.paletteSource).toBe('page');
    expect(out.palette[0]).toBe('#123456');
  });

  it('never TRIES a touch icon while a real logo candidate exists — even when the real one fails', async () => {
    const ICON = 'https://acme.example/apple-touch-icon.png';
    const { fetch, calls } = router({
      [ICON]: { body: await wordmarkPng(180, 180), contentType: 'image/png' },
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          heroImages: [],
          logos: [
            { url: ICON, kind: 'apple-touch', score: 85 },
            { url: LOGO, kind: 'img-logo', score: 60, headerMark: true }, // 404s below
          ],
        }),
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(calls).toContain(LOGO);
    expect(calls).not.toContain(ICON);
    expect(out.logo).toBeNull();
  });

  it('falls back to a site icon only when the site has no real logo at all', async () => {
    const ICON = 'https://acme.example/apple-touch-icon.png';
    const { fetch } = router({
      [ICON]: { body: await wordmarkPng(512, 512), contentType: 'image/png' },
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          heroImages: [],
          logos: [{ url: ICON, kind: 'apple-touch', score: 85 }],
        }),
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.logo?.sourceUrl).toBe(ICON);
  });

  it('does not reach for a far-lower runner-up (an award badge) when the best logo fails', async () => {
    const BADGE = 'https://acme.example/img/partner.png';
    const { fetch, calls } = router({
      [BADGE]: { body: await wordmarkPng(400, 200), contentType: 'image/png' },
    });
    await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          heroImages: [],
          logos: [
            { url: LOGO, kind: 'img-logo', score: 109, headerMark: true },
            { url: BADGE, kind: 'img-logo', score: 64, headerMark: true },
          ],
        }),
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(calls).not.toContain(BADGE);
  });

  it('keeps an INLINE SVG logo eligible — rendered to a PNG in our bucket', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" width="300" height="80">' +
      '<rect x="0" y="10" width="200" height="60" fill="#e8112d"/><circle cx="250" cy="40" r="30" fill="#0b6efd"/></svg>';
    const { fetch, calls } = router({});
    const { storage, uploads } = memoryBucket();
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({
          heroImages: [],
          logos: [
            {
              url: '',
              kind: 'svg-inline',
              headerMark: true,
              svgInline: svg,
              isSvg: true,
              score: 95,
            },
          ],
        }),
      },
      { fetch, storage, stock: noStock },
    );
    expect(calls).toHaveLength(0);
    expect(out.logo).toMatchObject({
      source: 'site',
      sourceUrl: 'inline-svg',
      format: 'png',
    });
    expect(out.logo!.width).toBe(1500); // fills the 1500×500 box at a 3.75:1 aspect
    expect(uploads[0].contentType).toBe('image/png');
    expect(out.palette).toEqual(expect.arrayContaining(['#e8112d', '#0b6efd']));
  });
});

describe('never hotlink', () => {
  it('drops the logo AND the photo when the copy to our storage fails', async () => {
    const { fetch } = router({
      [LOGO]: { body: await wordmarkPng(1400, 392), contentType: 'image/png' },
      [HERO]: {
        body: await photoJpeg(1200, 800, 3),
        contentType: 'image/jpeg',
      },
    });
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview() },
      { fetch, storage: memoryBucket({ fail: true }).storage, stock: noStock },
    );
    expect(out.logo).toBeNull();
    expect(out.photo).toBeNull();
    expect(out.rejected.map((r) => r.reason).join(' ')).toMatch(
      /could not copy to our storage/,
    );
  });

  it('with no storage at all, fetches NOTHING and returns the scrape palette', async () => {
    const { fetch, calls } = router({});
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview() },
      { fetch, storage: null },
    );
    expect(calls).toHaveLength(0);
    expect(out).toEqual(unresolvedDesignerAssets(preview()));
    expect(out.logo).toBeNull();
    expect(out.photo).toBeNull();
  });
});

describe('the budget is a HARD deadline', () => {
  it('a host that never answers costs its image, not the request', async () => {
    // safeFetch's own timeout is a socket-IDLE timer and its DNS lookup has
    // none: a stalled fetch must still end at the budget.
    const neverAnswers = (() =>
      new Promise<never>(() => undefined)) as unknown as FetchFn;
    const started = Date.now();
    const out = await resolveDesignerAssets(
      { tenantId: 't1', preview: preview(), budgetMs: 1200 },
      { fetch: neverAnswers, storage: memoryBucket().storage, stock: noStock },
    );
    expect(Date.now() - started).toBeLessThan(4000);
    expect(out.logo).toBeNull();
    expect(out.photo).toBeNull();
    expect(out.rejected.map((r) => r.reason)).toContain(
      'fetch failed (TimeoutError)',
    );
  });
});

describe('photo preference — upload / POS, then the site, then Pexels (only with a key)', () => {
  it('a priority (POS) photo outranks the site photo', async () => {
    const POS = 'https://pos.example/items/tacos.jpg';
    const { fetch, calls } = router({
      [POS]: {
        body: await photoJpeg(1200, 900, 12),
        contentType: 'image/jpeg',
      },
      [HERO]: {
        body: await photoJpeg(1200, 800, 3),
        contentType: 'image/jpeg',
      },
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({ logos: [] }),
        priorityPhotos: [{ url: POS, source: 'pos' }],
      },
      { fetch, storage: memoryBucket().storage, stock: noStock },
    );
    expect(out.photo).toMatchObject({ source: 'pos', sourceUrl: POS });
    expect(calls).not.toContain(HERO);
  });

  it('NO Pexels key → no stock search, no photo: exactly the old behaviour', async () => {
    const stock = stockSource(false, {
      url: 'https://images.pexels.com/photos/1/p.jpeg',
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({ logos: [], heroImages: [] }),
        stockQuery: 'mexican food tacos',
      },
      {
        fetch: router({}).fetch,
        storage: memoryBucket().storage,
        stock: stock.source,
      },
    );
    expect(stock.searches).toHaveLength(0);
    expect(out.photo).toBeNull();
  });

  it('with a key, asks Pexels for the ORIGINAL at the stored width (not large2x) and labels it stock', async () => {
    const large2x =
      'https://images.pexels.com/photos/2092507/pexels-photo-2092507.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';
    const atWidth =
      'https://images.pexels.com/photos/2092507/pexels-photo-2092507.jpeg?auto=compress&cs=tinysrgb&w=4096';
    const { fetch, calls } = router({
      [atWidth]: {
        body: await photoJpeg(1200, 800, 21),
        contentType: 'image/jpeg',
      },
    });
    const stock = stockSource(true, { url: large2x, photographer: 'Jane Doe' });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({ logos: [], heroImages: [] }),
        stockQuery: 'mexican food tacos',
      },
      { fetch, storage: memoryBucket().storage, stock: stock.source },
    );
    expect(stock.searches).toEqual([
      ['mexican food tacos', { orientation: 'landscape' }],
    ]);
    expect(calls).toEqual([atWidth]);
    expect(out.photo).toMatchObject({
      source: 'stock',
      stockQuery: 'mexican food tacos',
      photographer: 'Jane Doe',
    });
    expect(out.photo!.url).toMatch(/^https:\/\/sb\.example\//); // re-hosted: the designer strips pexels.com
  });

  it('a usable site photo means Pexels is never asked', async () => {
    const stock = stockSource(true, {
      url: 'https://images.pexels.com/photos/1/p.jpeg',
    });
    const { fetch } = router({
      [HERO]: {
        body: await photoJpeg(1200, 800, 3),
        contentType: 'image/jpeg',
      },
    });
    const out = await resolveDesignerAssets(
      {
        tenantId: 't1',
        preview: preview({ logos: [] }),
        stockQuery: 'mexican food tacos',
      },
      { fetch, storage: memoryBucket().storage, stock: stock.source },
    );
    expect(stock.searches).toHaveLength(0);
    expect(out.photo?.source).toBe('site');
  });

  it('stockQueryFromPreview only answers for a subject it is confident about', () => {
    expect(
      stockQueryFromPreview({
        displayName: 'Super Taco',
        description:
          'Super Taco is a family chain of restaurants serving traditional style food like menudo in sacramento, tacos, enchiladas, tortas, etc.',
      }),
    ).toBe('mexican food tacos');
    expect(stockQueryFromPreview({ displayName: "Tony's Pizzeria" })).toBe(
      'pizza',
    );
    expect(
      stockQueryFromPreview({
        displayName: 'Lincoln Elementary',
        description: 'Home of the Lions',
      }),
    ).toBeNull();
    expect(stockQueryFromPreview({})).toBeNull();
  });
});

describe('logoPalette', () => {
  it('orders primary (most ink) then a distinct accent, and is [] for a monochrome mark', () => {
    expect(
      logoPalette([
        { hex: '#f76422', count: 90, share: 0.9 },
        { hex: '#fceb00', count: 10, share: 0.1 },
      ]),
    ).toEqual(['#f76422', '#fceb00']);
    expect(logoPalette([{ hex: '#000000', count: 5, share: 1 }])).toEqual([]);
    expect(logoPalette([])).toEqual([]);
  });
});

describe('rehostRemoteImage — the stock-photo re-host, generalised', () => {
  const SRC = 'https://images.pexels.com/photos/1/p.jpeg?w=940';
  it('stores the bytes unchanged at <prefix>/<tenant>/<hash16>.<ext> (the ai-stock path it always used)', async () => {
    const body = await photoJpeg(400, 300, 1);
    const { fetch } = router({ [SRC]: { body, contentType: 'image/jpeg' } });
    const { storage, uploads } = memoryBucket();
    const url = await rehostRemoteImage(
      SRC,
      { tenantId: 't1', prefix: 'ai-stock' },
      { fetch, storage },
    );
    expect(url).toMatch(/\/ai-stock\/t1\/[0-9a-f]{16}\.jpg$/);
    expect(uploads[0].buf.equals(body)).toBe(true);
  });

  it('refuses a non-image, a non-2xx and a failed fetch (the caller keeps its URL)', async () => {
    const { storage, uploads } = memoryBucket();
    const html = router({
      [SRC]: {
        body: Buffer.from('<html>blocked</html>'),
        contentType: 'text/html',
      },
    });
    expect(
      await rehostRemoteImage(
        SRC,
        { tenantId: 't1', prefix: 'ai-stock' },
        { fetch: html.fetch, storage },
      ),
    ).toBeUndefined();
    const err = router({
      [SRC]: {
        body: await photoJpeg(10, 10, 1),
        contentType: 'image/jpeg',
        status: 404,
      },
    });
    expect(
      await rehostRemoteImage(
        SRC,
        { tenantId: 't1', prefix: 'ai-stock' },
        { fetch: err.fetch, storage },
      ),
    ).toBeUndefined();
    expect(
      await rehostRemoteImage(
        SRC,
        { tenantId: 't1', prefix: 'ai-stock' },
        { fetch: router({}).fetch, storage },
      ),
    ).toBeUndefined();
    expect(uploads).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// supertacomex.com, end to end: the REAL scraper over the committed page,
// then the resolver — what the Concierge reference now hands the Designer.
// ───────────────────────────────────────────────────────────────────────────
describe('supertacomex.com — scrape → check → copy', () => {
  let out: Awaited<ReturnType<typeof resolveDesignerAssets>>;
  let calls: string[];
  let uploads: ReturnType<typeof memoryBucket>['uploads'];

  beforeAll(async () => {
    const site = await supertacoSite();
    safeFetchMock.mockImplementation(site.fetch);
    const preview = await new BrandingScraperService().scrape(
      SUPERTACO_URL,
      8000,
    );
    const scrapeCalls = site.calls.length;
    const bucket = memoryBucket();
    uploads = bucket.uploads;
    out = await resolveDesignerAssets(
      {
        tenantId: 'tenant-super-taco',
        preview,
        stockQuery: stockQueryFromPreview(preview),
      },
      { fetch: site.fetch as FetchFn, storage: bucket.storage, stock: noStock },
    );
    calls = site.calls.slice(scrapeCalls); // what the RESOLVER fetched
  });

  afterAll(() => safeFetchMock.mockReset());

  it('picks super_taco_logo_(1).png — its ORIGINAL — not the touch icon, not the award badge', () => {
    expect(out.logo?.sourceUrl).toBe(SUPERTACO_LOGO_ORIGINAL);
    expect(calls.some((u) => u.includes(SUPERTACO_MEDIA.foodPhotoIcon))).toBe(
      false,
    );
    expect(calls.some((u) => u.includes(SUPERTACO_MEDIA.awardBadge))).toBe(
      false,
    );
  });

  it('picks the hero ORIGINAL — never a blur_ placeholder — at its real size', () => {
    expect(out.photo?.sourceUrl).toBe(SUPERTACO_HERO_ORIGINAL);
    expect(out.photo).toMatchObject({
      source: 'site',
      width: 1200,
      height: 800,
    });
    expect(calls.some((u) => /blur_\d/.test(u))).toBe(false);
  });

  it("takes an orange-red palette from the logo's own pixels", () => {
    expect(out.paletteSource).toBe('logo');
    expect(isOrangeRed(out.palette[0])).toBe(true);
  });

  it('re-hosts both — the board never hotlinks static.wixstatic.com', () => {
    expect(out.logo!.url).toMatch(
      /^https:\/\/sb\.example\/.*\/ai-designer\/tenant-super-taco\/logo-/,
    );
    expect(out.photo!.url).toMatch(
      /^https:\/\/sb\.example\/.*\/ai-designer\/tenant-super-taco\/photo-/,
    );
    expect(uploads.map((u) => u.contentType).sort()).toEqual([
      'image/jpeg',
      'image/png',
    ]);
  });
});
