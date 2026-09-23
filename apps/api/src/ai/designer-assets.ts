/**
 * designer-assets — the logo, photo and palette an AI Designer board may use,
 * CHECKED and copied to our own storage before any prompt sees them.
 *
 * Why (2026-09-22, the Super Taco boards — research:
 * docs/research/2026-09-22-ai-designer-rework/01 + 02):
 *   GPT-6 Sol drew three bad boards because of what the website reader handed
 *   it. The "logo" was the site's apple-touch-icon — a 180×180 crop of a FOOD
 *   PHOTO — which out-scored the real header wordmark. The "hero photo" was a
 *   Wix blurred loading placeholder (151×101 px, 5,200 bytes) sized by the
 *   page's 1805×670 LABEL while the 2.6 MB original sat at the bare media URL.
 *   The palette came from the food photo (brown + pale blue) instead of the
 *   logo's orange and yellow. Nothing was copied to our storage, so boards
 *   hotlinked Wix. And the prompt called all of it "verified".
 *
 * What this module guarantees for every image it returns:
 *   1. It was fetched through `safeFetch` (SSRF-guarded, byte-capped, timed
 *      out) — never a raw fetch of a URL a website chose.
 *   2. Its REAL pixels were decoded with `sharp`: a logo that reads as a
 *      photograph is refused; a photo whose short side is under 800 px (or 60%
 *      of a smaller slot), that is a thin strip, a transparent cutout or a flat
 *      graphic is refused; a file too small to be a real photo is refused.
 *   3. It was downscaled to ~1.25× the slot it fills and copied into OUR
 *      bucket — the URL returned is ours. When the copy fails, the image is
 *      dropped rather than hotlinked.
 *   4. The palette comes from the CHOSEN logo's own pixels, never a photo.
 *
 * Photo preference: operator / POS photos (`priorityPhotos`) → the site's own
 * photos (CDN originals, biggest first) → a Pexels photo at the slot's width
 * (only with a key AND a query) → none. No Pexels key ⇒ exactly the old
 * behaviour: no stock photo.
 *
 * Every dependency is injected (fetch, storage, stock, clock). NEVER throws.
 */

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { safeFetch } from '../branding/safe-fetch';
import {
  isPlaceholderImageUrl,
  pexelsPhotoAtWidth,
} from '../branding/image-url';
import {
  dominantColorsFromRgba,
  extractSvgColors,
  imagePixelStats,
  isChromatic,
  looksPhotographic,
  paletteFromLogoColors,
  type LogoColor,
} from '../branding/logo-colors';
import {
  rankLogoCandidates,
  rankPhotoCandidates,
  previewPaletteHexes,
  type RankedLogoCandidate,
} from './signage-concierge';
import type { StockImageResult } from './stock-image.service';

// ── Slots ─────────────────────────────────────────────────────────────────

/** The Designer's default canvas (apps/web templates page — 3840×2160). */
export const DESIGNER_CANVAS_DEFAULT = { width: 3840, height: 2160 } as const;

/** Nothing we store is bigger than this on its long edge (players are ≤ 4K). */
const MAX_STORED_EDGE = 4096;

export interface AssetSlot {
  width: number;
  height: number;
}

/**
 * The boxes a board's logo and photo can fill. The logo box is a generous
 * header slot (1200×400 on a 4K board — a wide wordmark or a stacked mark
 * both fit); the photo box is the whole canvas (a full-bleed hero is the
 * largest thing a photo can be asked to fill).
 */
export function designerAssetSlots(
  screenWidth?: number,
  screenHeight?: number,
): { logo: AssetSlot; photo: AssetSlot } {
  const w = clampInt(screenWidth, 320, 8192, DESIGNER_CANVAS_DEFAULT.width);
  const h = clampInt(screenHeight, 320, 8192, DESIGNER_CANVAS_DEFAULT.height);
  const long = Math.max(w, h);
  return {
    logo: {
      width: Math.round(long * 0.3125),
      height: Math.round(long * 0.1042),
    },
    photo: { width: w, height: h },
  };
}

/** What we store for a slot: ~1.25× it, never past MAX_STORED_EDGE. */
export function storedBox(slot: AssetSlot): AssetSlot {
  return {
    width: Math.min(MAX_STORED_EDGE, Math.round(slot.width * 1.25)),
    height: Math.min(MAX_STORED_EDGE, Math.round(slot.height * 1.25)),
  };
}

/** A photo's short side must reach 800 px — or 60% of a smaller slot's short side. */
export function minPhotoShortSide(slot: AssetSlot): number {
  return Math.max(
    200,
    Math.min(800, Math.round(0.6 * Math.min(slot.width, slot.height))),
  );
}

// ── Limits ────────────────────────────────────────────────────────────────

const LOGO_RASTER_MAX_BYTES = 6 * 1024 * 1024;
const LOGO_SVG_MAX_BYTES = 1024 * 1024;
const PHOTO_MAX_BYTES = 16 * 1024 * 1024;
const LOGO_TIMEOUT_MS = 6_000;
const PHOTO_TIMEOUT_MS = 8_000;
/**
 * Runs beside the menu read (8 s) after the scrape (≤ 10 s), inside one
 * Concierge request. Super Taco measured ~1.1 MB of logo + 2.6 MB of photo.
 */
const DEFAULT_BUDGET_MS = 12_000;
/** Below this, a "photo" is a thumbnail or a loading placeholder (Super Taco's was 5,200 B). */
export const MIN_PHOTO_BYTES = 12 * 1024;
const MIN_LOGO_WIDTH = 120;
const MIN_LOGO_HEIGHT = 16;
const MAX_LOGO_CANDIDATES = 3;
const MAX_ICON_CANDIDATES = 2;
const MAX_SITE_PHOTO_CANDIDATES = 4;
/** A runner-up real logo is only tried when it scored within 75% of the best one. */
const LOGO_RUNNER_UP_RATIO = 0.75;
/** libvips refuses anything bigger — a decompression-bomb guard for the decode. */
const MAX_INPUT_PIXELS = 100_000_000;

// ── Types ─────────────────────────────────────────────────────────────────

export type DesignerAssetSource = 'site' | 'stock' | 'pos' | 'upload';

export interface CheckedAsset {
  /** OUR storage URL — the only URL a board ever sees. */
  url: string;
  /** Where the bytes came from (diagnostics; never shown to a model). */
  sourceUrl: string;
  source: DesignerAssetSource;
  /** Decoded size of the source, EXIF-oriented (an SVG: its rendered size). */
  width: number;
  height: number;
  /** Size of the copy we stored. */
  storedWidth: number;
  storedHeight: number;
  format: 'png' | 'jpeg';
  /** A real logo, but smaller than 60% of its slot — keep it modest on the board. */
  lowRes?: boolean;
  stockQuery?: string;
  photographer?: string;
}

export interface ResolvedDesignerAssets {
  logo: CheckedAsset | null;
  photo: CheckedAsset | null;
  /** Logo-first brand palette (hex). */
  palette: string[];
  paletteSource: 'logo' | 'logo+page' | 'page' | 'none';
  /** Every candidate that was refused, and why. Diagnostics only. */
  rejected: Array<{ role: 'logo' | 'photo'; url: string; reason: string }>;
}

export interface DesignerAssetStorage {
  /** Public `assets` bucket (raster images only — never SVG). */
  upload(path: string, buffer: Buffer, contentType: string): Promise<string>;
}

export interface DesignerStockSource {
  isConfigured(): boolean;
  search(
    query: string,
    opts?: { orientation?: 'landscape' | 'portrait' },
  ): Promise<StockImageResult | null>;
}

export interface DesignerAssetDeps {
  /** Defaults to `safeFetch` — never plain `fetch`. */
  fetch?: typeof safeFetch;
  /** Where checked images are copied. Absent ⇒ no image is returned at all. */
  storage?: DesignerAssetStorage | null;
  stock?: DesignerStockSource | null;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface DesignerAssetInput {
  tenantId: string;
  /** A BrandingPreview (BrandingScraperService.scrape). */
  preview: any;
  screenWidth?: number;
  screenHeight?: number;
  /** Whole-resolution wall-clock budget. */
  budgetMs?: number;
  /**
   * Photos that outrank the site's own: an operator's upload, a POS item photo.
   * Checked exactly like a site photo.
   */
  priorityPhotos?: Array<{ url: string; source: 'upload' | 'pos' }>;
  /** Pexels query — used only when nothing better yields a usable photo. */
  stockQuery?: string | null;
}

interface Ctx {
  fetchFn: typeof safeFetch;
  storage: DesignerAssetStorage;
  tenantId: string;
  remaining: () => number;
  slots: { logo: AssetSlot; photo: AssetSlot };
  rejected: ResolvedDesignerAssets['rejected'];
  log: (msg: string) => void;
}

// ── Entry point ───────────────────────────────────────────────────────────

/** The result when nothing may be used: no images, the scrape's own palette. */
export function unresolvedDesignerAssets(preview: any): ResolvedDesignerAssets {
  const palette = previewPaletteHexes(preview);
  return {
    logo: null,
    photo: null,
    palette,
    paletteSource: palette.length ? 'page' : 'none',
    rejected: [],
  };
}

/**
 * Pick, check and copy the board's logo + photo; derive the palette from the
 * logo. NEVER throws — any failure yields fewer assets, never a third-party URL.
 */
export async function resolveDesignerAssets(
  input: DesignerAssetInput,
  deps: DesignerAssetDeps = {},
): Promise<ResolvedDesignerAssets> {
  const fallback = unresolvedDesignerAssets(input?.preview);
  const storage = deps.storage;
  // Nowhere to copy an image to ⇒ no image leaves this function. A board must
  // never hotlink a third-party CDN, so there is no point fetching anything.
  if (!storage || typeof storage.upload !== 'function') return fallback;

  const now = deps.now ?? Date.now;
  const deadline = now() + Math.max(1000, input.budgetMs ?? DEFAULT_BUDGET_MS);
  const ctx: Ctx = {
    fetchFn: deps.fetch ?? safeFetch,
    storage,
    tenantId: String(input.tenantId || 'unknown'),
    remaining: () => deadline - now(),
    slots: designerAssetSlots(input.screenWidth, input.screenHeight),
    rejected: [],
    log: deps.log ?? (() => {}),
  };

  try {
    const [logo, photo] = await Promise.all([
      resolveLogo(input.preview, ctx).catch(() => null),
      resolvePhoto(input, deps, ctx).catch(() => null),
    ]);

    let palette = fallback.palette;
    let paletteSource: ResolvedDesignerAssets['paletteSource'] =
      fallback.paletteSource;
    if (logo) {
      const fromLogo = logoPalette(logo.colors);
      if (fromLogo.length) {
        palette = fromLogo;
        paletteSource = 'logo';
      }
    }
    return {
      logo: logo?.asset ?? null,
      photo,
      palette,
      paletteSource,
      rejected: ctx.rejected,
    };
  } catch (e) {
    ctx.log(`designer assets: resolution failed (${errName(e)})`);
    return { ...fallback, rejected: ctx.rejected };
  }
}

/**
 * The logo's own chromatic colors, primary first (most ink), then a second
 * hue ≥ 30° away, then the rest — at most four. `[]` for a monochrome mark,
 * which sends the caller back to the site's colors.
 */
export function logoPalette(colors: LogoColor[]): string[] {
  const chromatic = (colors || []).filter((c) => c && isChromatic(c.hex));
  if (!chromatic.length) return [];
  const choice = paletteFromLogoColors(chromatic, []);
  const ordered = [
    choice?.primary,
    choice?.accent,
    ...chromatic.map((c) => c.hex),
  ]
    .filter(
      (h): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h),
    )
    .map((h) => h.toLowerCase());
  return [...new Set(ordered)].slice(0, 4);
}

// ── Logo ──────────────────────────────────────────────────────────────────

type LogoOutcome = { asset: CheckedAsset; colors: LogoColor[] };

async function resolveLogo(
  preview: any,
  ctx: Ctx,
): Promise<LogoOutcome | null> {
  const ranked = rankLogoCandidates(preview);
  const real = ranked.filter((c) => c.tier === 'real');
  // "A favicon / apple-touch-icon / og / twitter image is never the logo when
  // a real header logo candidate exists": icons are tried ONLY when the scrape
  // found no real mark at all.
  let queue: RankedLogoCandidate[];
  if (real.length) {
    const best = real[0].score;
    queue = real
      .filter(
        (c, i) =>
          i === 0 || best <= 0 || c.score >= best * LOGO_RUNNER_UP_RATIO,
      )
      .slice(0, MAX_LOGO_CANDIDATES);
  } else {
    queue = ranked
      .filter((c) => c.tier === 'icon')
      .slice(0, MAX_ICON_CANDIDATES);
  }
  for (const cand of queue) {
    if (ctx.remaining() < 500) break;
    const out = await checkLogoCandidate(cand, ctx);
    if (out === 'storage-failed') return null;
    if (out && typeof out === 'object') return out;
  }
  return null;
}

type Verdict = LogoOutcome | 'skip' | 'retry' | 'storage-failed';

async function checkLogoCandidate(
  cand: RankedLogoCandidate,
  ctx: Ctx,
): Promise<LogoOutcome | 'storage-failed' | null> {
  if (cand.svgInline) {
    const v = await checkSvgLogo(cand.svgInline, 'inline-svg', ctx);
    return typeof v === 'object' ? v : v === 'storage-failed' ? v : null;
  }
  const urls = uniq([cand.url, ...cand.fallbackUrls]);
  for (const u of urls) {
    if (isPlaceholderImageUrl(u)) {
      reject(ctx, 'logo', u, 'loading placeholder');
      continue;
    }
    const res = await fetchImage(
      ctx,
      'logo',
      u,
      cand.isSvg ? LOGO_SVG_MAX_BYTES : LOGO_RASTER_MAX_BYTES,
      LOGO_TIMEOUT_MS,
    );
    if (!res) continue;
    const v: Verdict = isSvgPayload(res.body, res.contentType, u)
      ? await checkSvgLogo(res.body.toString('utf-8'), u, ctx)
      : await checkRasterLogo(res.body, u, ctx);
    if (v === 'retry') continue;
    if (v === 'skip') return null;
    return v;
  }
  return null;
}

async function checkRasterLogo(
  buf: Buffer,
  url: string,
  ctx: Ctx,
): Promise<Verdict> {
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(buf, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    ({ width, height } = orientedSize(meta));
  } catch {
    reject(ctx, 'logo', url, 'not a decodable image');
    return 'retry';
  }
  if (!width || !height) {
    reject(ctx, 'logo', url, 'not a decodable image');
    return 'retry';
  }
  let sample: { data: Buffer; info: { width: number; height: number } };
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    sample = await sharp(buf, {
      failOn: 'none',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const stats = imagePixelStats(
      sample.data,
      sample.info.width,
      sample.info.height,
    );
    if (looksPhotographic(stats)) {
      // The Super Taco apple-touch-icon: a crop of a food photo is not a logo,
      // whatever the page called it. Its other renditions are the same photo.
      reject(
        ctx,
        'logo',
        url,
        `decodes as a photograph (${stats.buckets} colors)`,
      );
      return 'skip';
    }
    if (width < MIN_LOGO_WIDTH || height < MIN_LOGO_HEIGHT) {
      reject(ctx, 'logo', url, `too small (${width}×${height})`);
      return 'skip';
    }
    const box = storedBox(ctx.slots.logo);
    out = await sharp(buf, {
      failOn: 'none',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: box.width,
        height: box.height,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    reject(ctx, 'logo', url, 'could not be decoded');
    return 'retry';
  }
  const colors = dominantColorsFromRgba(sample.data);
  const stored = await store(ctx, 'logo', out.data, 'png', 'image/png', url);
  if (!stored) return 'storage-failed';
  const lowRes =
    width < 0.6 * ctx.slots.logo.width && height < 0.6 * ctx.slots.logo.height;
  return {
    asset: {
      url: stored,
      sourceUrl: url,
      source: 'site',
      width,
      height,
      storedWidth: out.info.width,
      storedHeight: out.info.height,
      format: 'png',
      ...(lowRes ? { lowRes: true } : {}),
    },
    colors,
  };
}

/**
 * An SVG mark (a `.svg` URL or the page's inline <svg>), rasterised to a PNG
 * that fills the logo box. A PNG carries no script surface and sits in the
 * public assets bucket like every other board image; the librsvg renderer
 * ships inside sharp's prebuilt libvips. An SVG libvips cannot render is not
 * used — the next candidate is tried.
 */
async function checkSvgLogo(
  svg: string,
  sourceUrl: string,
  ctx: Ctx,
): Promise<Verdict> {
  if (!svg || svg.length > LOGO_SVG_MAX_BYTES || !/<svg[\s>]/i.test(svg)) {
    reject(ctx, 'logo', sourceUrl, 'not an SVG document');
    return 'retry';
  }
  const colors = extractSvgColors(svg);
  const box = storedBox(ctx.slots.logo);
  const input = Buffer.from(svg, 'utf-8');
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    const meta = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    const iw = meta.width || box.width;
    const ih = meta.height || box.height;
    // Render at the density that makes the vector FILL the box — a vector
    // has no "original size" worth keeping, only the size it is shown at.
    const scale = Math.min(box.width / iw, box.height / ih);
    const density = Math.max(36, Math.min(2400, Math.round(72 * scale)));
    out = await sharp(input, {
      density,
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .resize({
        width: box.width,
        height: box.height,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    reject(ctx, 'logo', sourceUrl, 'SVG could not be rendered');
    return 'retry';
  }
  if (out.info.width < MIN_LOGO_WIDTH || out.info.height < MIN_LOGO_HEIGHT) {
    reject(
      ctx,
      'logo',
      sourceUrl,
      `SVG renders too small (${out.info.width}×${out.info.height})`,
    );
    return 'skip';
  }
  const stored = await store(
    ctx,
    'logo',
    out.data,
    'png',
    'image/png',
    sourceUrl,
  );
  if (!stored) return 'storage-failed';
  return {
    asset: {
      url: stored,
      sourceUrl,
      source: 'site',
      width: out.info.width,
      height: out.info.height,
      storedWidth: out.info.width,
      storedHeight: out.info.height,
      format: 'png',
    },
    colors,
  };
}

// ── Photo ─────────────────────────────────────────────────────────────────

async function resolvePhoto(
  input: DesignerAssetInput,
  deps: DesignerAssetDeps,
  ctx: Ctx,
): Promise<CheckedAsset | null> {
  const queue: Array<{ urls: string[]; source: DesignerAssetSource }> = [];
  for (const p of input.priorityPhotos || []) {
    if (p && typeof p.url === 'string')
      queue.push({
        urls: [p.url],
        source: p.source === 'pos' ? 'pos' : 'upload',
      });
  }
  for (const c of rankPhotoCandidates(input.preview).slice(
    0,
    MAX_SITE_PHOTO_CANDIDATES,
  )) {
    queue.push({ urls: [c.url, ...c.fallbackUrls], source: 'site' });
  }
  for (const item of queue) {
    if (ctx.remaining() < 800) return null;
    const got = await checkPhotoCandidate(item.urls, item.source, ctx);
    if (got === 'storage-failed') return null;
    if (got) return got;
  }

  // Last resort: a stock photo — only with a Pexels key AND a subject we are
  // confident about. No key ⇒ nothing here runs (the pre-2026-09-22 result).
  const query =
    typeof input.stockQuery === 'string' ? input.stockQuery.trim() : '';
  const stock = deps.stock;
  if (
    !query ||
    !stock ||
    typeof stock.isConfigured !== 'function' ||
    !stock.isConfigured()
  )
    return null;
  if (ctx.remaining() < 1500) return null;
  const landscape = ctx.slots.photo.width >= ctx.slots.photo.height;
  const hit = await stock
    .search(query, { orientation: landscape ? 'landscape' : 'portrait' })
    .catch(() => null);
  // `large2x` is ~1880 px — a 4K board would stretch it 2×. Ask Pexels for
  // the ORIGINAL at the width we will store.
  const sized = hit?.url
    ? pexelsPhotoAtWidth(hit.url, storedBox(ctx.slots.photo).width)
    : null;
  if (!sized) return null;
  const got = await checkPhotoCandidate([sized], 'stock', ctx);
  if (!got || got === 'storage-failed') return null;
  return {
    ...got,
    stockQuery: query,
    ...(hit?.photographer ? { photographer: hit.photographer } : {}),
  };
}

async function checkPhotoCandidate(
  urls: string[],
  source: DesignerAssetSource,
  ctx: Ctx,
): Promise<CheckedAsset | 'storage-failed' | null> {
  const box = storedBox(ctx.slots.photo);
  const minShort = minPhotoShortSide(ctx.slots.photo);
  for (const u of uniq(urls)) {
    if (isPlaceholderImageUrl(u)) {
      reject(ctx, 'photo', u, 'loading placeholder');
      continue;
    }
    const res = await fetchImage(
      ctx,
      'photo',
      u,
      PHOTO_MAX_BYTES,
      PHOTO_TIMEOUT_MS,
    );
    if (!res) continue;
    // Every other address for this image is a smaller rendition of it, so a
    // verdict on the pixels ends the candidate (`return null`); only an
    // unreadable response tries the next address (`continue`).
    if (res.body.length < MIN_PHOTO_BYTES) {
      reject(
        ctx,
        'photo',
        u,
        `tiny file (${res.body.length} bytes) — a thumbnail or placeholder`,
      );
      return null;
    }
    let width = 0;
    let height = 0;
    let hasAlpha = false;
    try {
      const meta = await sharp(res.body, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
      }).metadata();
      ({ width, height } = orientedSize(meta));
      hasAlpha = !!meta.hasAlpha;
    } catch {
      reject(ctx, 'photo', u, 'not a decodable image');
      continue;
    }
    if (!width || !height) {
      reject(ctx, 'photo', u, 'not a decodable image');
      continue;
    }
    if (Math.min(width, height) < minShort) {
      reject(
        ctx,
        'photo',
        u,
        `too small: ${width}×${height} (needs a ${minShort}px short side)`,
      );
      return null;
    }
    const aspect = width / height;
    if (aspect > 3.5 || aspect < 0.28) {
      reject(ctx, 'photo', u, `strip/banner shape (${width}×${height})`);
      return null;
    }
    let out: { data: Buffer; info: { width: number; height: number } };
    try {
      const sample = await sharp(res.body, {
        failOn: 'none',
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const stats = imagePixelStats(
        sample.data,
        sample.info.width,
        sample.info.height,
      );
      if (hasAlpha && stats.transparentShare > 0.1) {
        reject(ctx, 'photo', u, 'transparent cutout / graphic, not a photo');
        return null;
      }
      if (stats.buckets < 24 && stats.top8Share > 0.9) {
        reject(ctx, 'photo', u, 'flat graphic, not a photo');
        return null;
      }
      out = await sharp(res.body, {
        failOn: 'none',
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: box.width,
          height: box.height,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      reject(ctx, 'photo', u, 'could not be decoded');
      continue;
    }
    const stored = await store(ctx, 'photo', out.data, 'jpg', 'image/jpeg', u);
    if (!stored) return 'storage-failed';
    return {
      url: stored,
      sourceUrl: u,
      source,
      width,
      height,
      storedWidth: out.info.width,
      storedHeight: out.info.height,
      format: 'jpeg',
    };
  }
  return null;
}

// ── Stock query ───────────────────────────────────────────────────────────

/**
 * Subjects a stock photo can honestly show for a venue, in priority order.
 * Deliberately short: a Pexels search on a vague phrase returns a vague photo
 * (the 2026-06-29 "sunset on a Domino's board"), so no match ⇒ no stock photo.
 * Schools, clinics and offices are absent on purpose.
 */
const STOCK_SUBJECTS: Array<[RegExp, string]> = [
  [
    /\b(?:tacos?|taquer[ií]as?|burritos?|enchiladas?|quesadillas?|tortas?|menudo|mexican)\b/i,
    'mexican food tacos',
  ],
  [/\bpizz(?:a|as|eria|erias)\b/i, 'pizza'],
  [/\bburgers?\b/i, 'burger and fries'],
  [/\b(?:sushi|ramen|izakaya)\b/i, 'sushi'],
  [/\b(?:bbq|barbecue|smokehouse)\b/i, 'barbecue'],
  [/\b(?:coffee|espresso|caf[eé]s?|roasters?|roastery)\b/i, 'coffee shop'],
  [
    /\b(?:bakery|bakeries|pastr(?:y|ies)|donuts?|doughnuts?|bagels?)\b/i,
    'bakery',
  ],
  [/\b(?:ice cream|gelato|frozen yogurt)\b/i, 'ice cream'],
  [/\bsteak(?:house)?s?\b/i, 'steak dinner'],
  [/\bthai\b/i, 'thai food'],
  [/\b(?:chinese|dim sum|dumplings?)\b/i, 'chinese food'],
  [/\b(?:indian|curry|tandoori)\b/i, 'indian food'],
  [/\b(?:pasta|trattoria|italian)\b/i, 'italian food'],
  [/\b(?:brewery|brewpub|craft beer|taproom)\b/i, 'craft beer'],
  [/\b(?:winery|wine bar|vineyard)\b/i, 'wine'],
  [/\b(?:cocktails?|speakeasy|lounge)\b/i, 'cocktail bar'],
  [/\b(?:gym|fitness|crossfit)\b/i, 'gym'],
  [/\b(?:yoga|pilates)\b/i, 'yoga studio'],
  [/\b(?:salon|barbers?|barbershop)\b/i, 'hair salon'],
  [/\bspa\b/i, 'spa'],
  [/\b(?:hotel|resort)\b/i, 'hotel lobby'],
];

/** A confident Pexels query for the venue the scrape describes, or null. */
export function stockQueryFromPreview(preview: unknown): string | null {
  const p = (preview && typeof preview === 'object' ? preview : {}) as {
    displayName?: unknown;
    description?: unknown;
    tagline?: unknown;
    keyMessages?: unknown;
  };
  const parts: string[] = [];
  for (const v of [p.displayName, p.description, p.tagline]) {
    if (typeof v === 'string') parts.push(v);
  }
  if (Array.isArray(p.keyMessages)) {
    for (const m of p.keyMessages as unknown[])
      if (typeof m === 'string') parts.push(m);
  }
  const text = parts.join(' \n ').slice(0, 3000);
  if (!text.trim()) return null;
  for (const [re, query] of STOCK_SUBJECTS) if (re.test(text)) return query;
  return null;
}

// ── Re-hosting (shared with the stock-photo path) ─────────────────────────

/**
 * Copy image bytes into our public assets bucket under a content hash:
 * `<prefix>/<tenant>/[<name>-]<hash16>.<ext>`. The same bytes always land at
 * the same path (x-upsert), so a repeat is free. Raster only: the assets
 * bucket refuses image/svg+xml by design, and nothing here stores an SVG.
 */
export async function storeImageBuffer(
  storage: DesignerAssetStorage,
  opts: {
    tenantId: string;
    prefix: string;
    name?: string;
    ext: string;
    contentType: string;
  },
  buf: Buffer,
): Promise<string> {
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const tenant =
    String(opts.tenantId || 'unknown')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 64) || 'unknown';
  const file = `${opts.name ? `${opts.name}-` : ''}${hash}.${opts.ext}`;
  return storage.upload(
    `${opts.prefix}/${tenant}/${file}`,
    buf,
    opts.contentType,
  );
}

/**
 * Fetch ONE remote image (SSRF-guarded via `safeFetch`) and copy it, byte for
 * byte, into our bucket. Returns our URL, or undefined on ANY failure (the
 * caller keeps what it had). This is the stock-photo re-host
 * (templates.controller.ts `rehostStockUrl`), generalised: same caps, same
 * checks, same `<prefix>/<tenant>/<hash16>.<ext>` path.
 */
export async function rehostRemoteImage(
  sourceUrl: string,
  opts: {
    tenantId: string;
    prefix: string;
    maxBytes?: number;
    timeoutMs?: number;
  },
  deps: {
    fetch?: typeof safeFetch;
    storage: Pick<DesignerAssetStorage, 'upload'>;
  },
): Promise<string | undefined> {
  try {
    const r = await (deps.fetch ?? safeFetch)(sourceUrl, {
      maxBytes: opts.maxBytes ?? 8 * 1024 * 1024,
      timeoutMs: opts.timeoutMs ?? 8000,
    });
    if (r.status < 200 || r.status >= 300) return undefined;
    const ct = (r.contentType || '').toLowerCase();
    if (!ct.startsWith('image/')) return undefined; // never store a challenge/HTML page
    if (!r.body || !r.body.length) return undefined;
    const ext = ct.includes('png')
      ? 'png'
      : ct.includes('webp')
        ? 'webp'
        : ct.includes('gif')
          ? 'gif'
          : 'jpg';
    return await storeImageBuffer(
      deps.storage,
      {
        tenantId: opts.tenantId,
        prefix: opts.prefix,
        ext,
        contentType: r.contentType || 'image/jpeg',
      },
      r.body,
    );
  } catch {
    return undefined; // best-effort — keep the provider URL on any failure
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function fetchImage(
  ctx: Ctx,
  role: 'logo' | 'photo',
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ body: Buffer; contentType: string } | null> {
  const budget = Math.min(timeoutMs, ctx.remaining());
  if (budget < 300) {
    reject(ctx, role, url, 'out of time');
    return null;
  }
  try {
    const res = await ctx.fetchFn(url, {
      maxBytes,
      timeoutMs: budget,
      accept: 'image/*',
    });
    if (res.status < 200 || res.status >= 300) {
      reject(ctx, role, url, `HTTP ${res.status}`);
      return null;
    }
    if (!res.body || !res.body.length) {
      reject(ctx, role, url, 'empty response');
      return null;
    }
    const ct = String(res.contentType || '').toLowerCase();
    if (/^(?:text\/html|application\/json)/.test(ct)) {
      reject(ctx, role, url, `not an image (${ct.split(';')[0]})`);
      return null;
    }
    return { body: res.body, contentType: ct };
  } catch (e) {
    reject(ctx, role, url, `fetch failed (${errName(e)})`);
    return null;
  }
}

async function store(
  ctx: Ctx,
  kind: 'logo' | 'photo',
  buf: Buffer,
  ext: 'png' | 'jpg',
  contentType: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    const url = await storeImageBuffer(
      ctx.storage,
      {
        tenantId: ctx.tenantId,
        prefix: 'ai-designer',
        name: kind,
        ext,
        contentType,
      },
      buf,
    );
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw new Error('storage returned no URL');
    return url;
  } catch (e) {
    reject(
      ctx,
      kind,
      sourceUrl,
      `could not copy to our storage (${errName(e)})`,
    );
    ctx.log(
      `designer assets: ${kind} copy failed — dropped rather than hotlinked`,
    );
    return null;
  }
}

function isSvgPayload(body: Buffer, contentType: string, url: string): boolean {
  if (/image\/svg/i.test(contentType)) return true;
  if (
    /\.svg(?:[?#]|$)/i.test(url) &&
    !/^image\/(?:png|jpe?g|gif|webp|avif)/i.test(contentType)
  )
    return true;
  const head = body
    .toString('utf-8', 0, Math.min(body.length, 512))
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith('<svg') ||
    (head.startsWith('<?xml') && head.includes('<svg'))
  );
}

function orientedSize(meta: {
  width?: number;
  height?: number;
  orientation?: number;
}): { width: number; height: number } {
  const w = meta.width || 0;
  const h = meta.height || 0;
  return (meta.orientation || 1) >= 5
    ? { width: h, height: w }
    : { width: w, height: h };
}

function reject(
  ctx: Ctx,
  role: 'logo' | 'photo',
  url: string,
  reason: string,
): void {
  if (ctx.rejected.length < 40)
    ctx.rejected.push({ role, url: String(url).slice(0, 300), reason });
}

/** An error's class name for a log line — never its message (which can echo a URL or an address). */
function errName(e: unknown): string {
  return e instanceof Error && e.name ? e.name : 'Error';
}

function uniq(list: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const v of list)
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  return out;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(min, Math.min(max, n));
}
