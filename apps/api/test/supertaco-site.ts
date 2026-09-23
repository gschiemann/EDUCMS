/**
 * supertacomex.com, served offline — the page and the images the AI Designer's
 * website reader fetches from it (2026-09-22).
 *
 * The HTML is the committed, trimmed copy of the real homepage
 * (fixtures/supertacomex/home.trimmed.html). The IMAGES are synthetic stand-ins
 * that reproduce what matters about each real file — never copies of the
 * business's artwork:
 *
 *   media id                                     real file                          stand-in
 *   2143c7_98d24e31… (favicon / touch icon)      a FOOD PHOTO (3936×2624 PNG)       textured, brown-biased photo
 *   2143c7_17cd6dcd… BOSLogo19_edited.png        "Best of Sacramento" award badge   flat black / white / red badge
 *   e44cfe_5ca48242… super_taco_logo_(1).png     orange-red + yellow wordmark       flat #f76422 + #fceb00 on transparent
 *   2143c7_2b2a73a7… hero                        6000×4000 JPEG, 2.6 MB             1600×1067 textured JPEG
 *   2143c7_2b2a73a7… …/blur_2,…                  151×101 blur placeholder, 5,200 B  151×101 JPEG, a few KB
 *   2143c7_6d388627… og:image                    the wordmark again, 2500×1330 fit  flat wordmark
 *
 * Measured on the real files (read-only GETs of the public CDN, 2026-09-22):
 * the touch icon's 96-px sample spans ~650 color buckets with <2% flat
 * neighbours; the logo spans 5 buckets, 76% transparent; the badge ~80 buckets,
 * 77% of pixels in its top 8. The stand-ins sit on the same sides of every
 * threshold (see logo-colors.ts `looksPhotographic`).
 *
 * No network: `supertacoSite().fetch` is a drop-in for `safeFetch`, and every
 * URL it does not know throws — exactly how an unreachable host behaves.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

export const SUPERTACO_URL = 'https://www.supertacomex.com/';

export const SUPERTACO_HOME_HTML = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'supertacomex', 'home.trimmed.html'),
  'utf-8',
);

const WIX = 'https://static.wixstatic.com/media/';

export const SUPERTACO_MEDIA = {
  foodPhotoIcon: '2143c7_98d24e31d27c4980ba9fa137369320d1',
  awardBadge: '2143c7_17cd6dcd74fb4fbb884b3d9d76a6cc1f',
  logo: 'e44cfe_5ca482429a8a469b88bdaa5554a0f5ba',
  hero: '2143c7_2b2a73a7bef0418bb4b7d98a1152d93d',
  og: '2143c7_6d388627216a4e1b9b9424e0a79df018',
} as const;

/** The header logo's ORIGINAL upload — the bare media URL behind every rendition. */
export const SUPERTACO_LOGO_ORIGINAL = `${WIX}${SUPERTACO_MEDIA.logo}~mv2.png`;
/** The hero photo's ORIGINAL upload. */
export const SUPERTACO_HERO_ORIGINAL = `${WIX}${SUPERTACO_MEDIA.hero}~mv2.jpg`;

export const LOGO_ORANGE = { r: 0xf7, g: 0x64, b: 0x22 };
export const LOGO_YELLOW = { r: 0xfc, g: 0xeb, b: 0x00 };

/** Deterministic PRNG (mulberry32) — the stand-ins are identical every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * A photograph-like RGB buffer: broad colour fields (sine blobs) plus grain, so
 * it keeps hundreds of colours and almost no flat neighbours even when it is
 * downsampled — the way a real food photo does.
 */
export function photoPixels(
  width: number,
  height: number,
  seed: number,
  base = { r: 153, g: 103, b: 56 },
): Buffer {
  const rand = rng(seed);
  const buf = Buffer.alloc(width * height * 3);
  const fx = [1 + rand() * 3, 1 + rand() * 3, 1 + rand() * 3];
  const fy = [1 + rand() * 3, 1 + rand() * 3, 1 + rand() * 3];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const i = (y * width + x) * 3;
      const field = (k: number) =>
        55 * Math.sin(2 * Math.PI * (fx[k] * u + fy[k] * v) + k);
      buf[i] = clamp(base.r + field(0) + (rand() - 0.5) * 70);
      buf[i + 1] = clamp(base.g + field(1) + (rand() - 0.5) * 70);
      buf[i + 2] = clamp(base.b + field(2) + (rand() - 0.5) * 70);
    }
  }
  return buf;
}

export async function photoJpeg(
  width: number,
  height: number,
  seed: number,
  quality = 82,
): Promise<Buffer> {
  return sharp(photoPixels(width, height, seed), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality })
    .toBuffer();
}

export async function photoPng(
  width: number,
  height: number,
  seed: number,
): Promise<Buffer> {
  return sharp(photoPixels(width, height, seed), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}

/**
 * A flat two-ink wordmark on transparency: orange "letters" either side of a
 * yellow "sun", the proportions of super_taco_logo_(1).png.
 */
export async function wordmarkPng(
  width: number,
  height: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(width * height * 4); // transparent
  const put = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: { r: number; g: number; b: number },
  ) => {
    for (
      let y = Math.max(0, Math.floor(y0));
      y < Math.min(height, Math.ceil(y1));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(x0));
        x < Math.min(width, Math.ceil(x1));
        x++
      ) {
        const i = (y * width + x) * 4;
        buf[i] = c.r;
        buf[i + 1] = c.g;
        buf[i + 2] = c.b;
        buf[i + 3] = 255;
      }
    }
  };
  const letterW = width * 0.06;
  const gap = width * 0.025;
  // Five "letters" on the left, four on the right, a sun in the middle.
  for (let k = 0; k < 5; k++) {
    const x0 = width * 0.02 + k * (letterW + gap);
    put(x0, height * 0.18, x0 + letterW, height * 0.62, LOGO_ORANGE);
  }
  for (let k = 0; k < 4; k++) {
    const x0 = width * 0.6 + k * (letterW + gap);
    put(x0, height * 0.18, x0 + letterW, height * 0.62, LOGO_ORANGE);
  }
  put(width * 0.43, height * 0.05, width * 0.56, height * 0.72, LOGO_YELLOW);
  // The tagline row ("MEXICAN RESTAURANTS").
  put(width * 0.06, height * 0.74, width * 0.94, height * 0.9, LOGO_ORANGE);
  return sharp(buf, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** A flat award badge: black card, white "Best of" bars, a red band. */
export async function awardBadgePng(
  width: number,
  height: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let c = { r: 16, g: 16, b: 16 };
      if (
        y > height * 0.12 &&
        y < height * 0.45 &&
        x > width * 0.1 &&
        x < width * 0.85
      )
        c = { r: 255, g: 255, b: 255 };
      if (y > height * 0.62 && y < height * 0.85) c = { r: 232, g: 0, b: 5 };
      buf[i] = c.r;
      buf[i + 1] = c.g;
      buf[i + 2] = c.b;
      buf[i + 3] = 255;
    }
  }
  return sharp(buf, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** A blurred loading placeholder: a tiny, smooth JPEG of a few KB. */
export async function blurPlaceholderJpeg(
  width = 151,
  height = 101,
): Promise<Buffer> {
  return sharp(photoPixels(width, height, 7), {
    raw: { width, height, channels: 3 },
  })
    .blur(4)
    .jpeg({ quality: 60 })
    .toBuffer();
}

export interface FetchedResponse {
  status: number;
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

export interface SupertacoSite {
  /** Drop-in for `safeFetch(url, opts)`. */
  fetch: (url: string, opts?: unknown) => Promise<FetchedResponse>;
  /** Every URL requested, in order. */
  calls: string[];
}

/** Build the offline site. Images are rendered once per call (≈ tens of ms). */
export async function supertacoSite(
  overrides: Record<string, () => Promise<FetchedResponse>> = {},
): Promise<SupertacoSite> {
  const heroOriginal = await photoJpeg(1600, 1067, 11);
  const heroBlur = await blurPlaceholderJpeg();
  const iconPhotoSmall = await photoPng(180, 180, 5);
  const iconPhotoLarge = await photoPng(900, 600, 5);
  const calls: string[] = [];

  const ok = (
    url: string,
    body: Buffer,
    contentType: string,
  ): FetchedResponse => ({
    status: 200,
    body,
    contentType,
    finalUrl: url,
  });
  const sizeOf = (url: string): { w: number; h: number } | null => {
    const m = /[/,]w_(\d+),h_(\d+)/.exec(url);
    return m ? { w: parseInt(m[1], 10), h: parseInt(m[2], 10) } : null;
  };

  const fetch = async (url: string): Promise<FetchedResponse> => {
    calls.push(url);
    if (overrides[url]) return overrides[url]();
    if (url === SUPERTACO_URL)
      return ok(
        url,
        Buffer.from(SUPERTACO_HOME_HTML, 'utf-8'),
        'text/html; charset=utf-8',
      );
    const decoded = decodeURIComponent(url);
    const rendition = /\/v1\//.test(decoded);
    const size = sizeOf(decoded);
    if (decoded.includes(SUPERTACO_MEDIA.hero)) {
      if (!rendition) return ok(url, heroOriginal, 'image/jpeg');
      if (/blur_\d/.test(decoded)) return ok(url, heroBlur, 'image/jpeg');
    }
    if (decoded.includes(SUPERTACO_MEDIA.logo)) {
      const s = rendition && size ? size : { w: 1400, h: 392 };
      return ok(url, await wordmarkPng(s.w, s.h), 'image/png');
    }
    if (decoded.includes(SUPERTACO_MEDIA.og))
      return ok(url, await wordmarkPng(1200, 267), 'image/png');
    if (decoded.includes(SUPERTACO_MEDIA.awardBadge)) {
      const s = size ?? { w: 394, h: 196 };
      return ok(url, await awardBadgePng(s.w, s.h), 'image/png');
    }
    if (decoded.includes(SUPERTACO_MEDIA.foodPhotoIcon)) {
      return ok(url, rendition ? iconPhotoSmall : iconPhotoLarge, 'image/png');
    }
    throw new Error(`no route for ${url}`);
  };
  return { fetch, calls };
}

/** Hue (0-360), saturation and lightness (0-100) of a #rrggbb. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 0 };
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

/** The logo's family: a saturated orange-red (not the food photo's brown, not Wix blue). */
export function isOrangeRed(hex: string): boolean {
  const { h, s, l } = hsl(hex);
  return (h <= 40 || h >= 345) && s >= 60 && l >= 25 && l <= 75;
}
