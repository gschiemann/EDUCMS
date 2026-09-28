/**
 * logo-image — turn whatever image a website (or an operator) hands us into
 * bytes the `branding-logos` bucket will accept and every browser can draw.
 *
 * Why this file exists (2026-09-28, Greg's Brookfield Residential demo):
 *   He picked Brookfield's "B" mark in the branding wizard and the app kept
 *   showing something else. The "B" is the site's `favicon.ico` — a 32×32 icon
 *   Vercel serves as `image/vnd.microsoft.icon`. The bucket's allow-list has
 *   `image/x-icon` but not that spelling, so Storage refused the upload; the
 *   adopt route then quietly stored a different candidate (the wordmark). Even
 *   had it landed, the sidebar refuses to draw `.ico` files (a blurry-favicon
 *   guard), so the operator's pick could never have shown.
 *
 * The fix is to stop trusting a server's Content-Type and to never store an
 * `.ico` at all: decide the format from the BYTES, and convert icons to PNG.
 *
 *   - `sniffLogoImageKind` — the format, from magic bytes.
 *   - `icoToPng`           — the largest frame of an .ico as a PNG (PNG-in-ICO
 *                            passes through; 1/4/8/24/32-bit DIB frames are
 *                            decoded), upscaled with Lanczos so a 32 px mark
 *                            does not get stretched blocky by the browser.
 *   - `normalizeLogoImage` — bytes → `{ body, contentType, ext }`, always one
 *                            of the bucket's allowed types, or a clear throw.
 *
 * Pure apart from `sharp` (already an API dependency); no network, no storage.
 */
import sharp from 'sharp';

export type LogoImageKind =
  | 'svg'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'ico'
  | 'unknown';

export interface NormalizedLogoImage {
  body: Buffer;
  /** Always a type the branding-logos bucket allows. */
  contentType: string;
  ext: string;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(b: Buffer): boolean {
  return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);
}

/** An `.ico` (type 1). A `.cur` (type 2) is a cursor, never a logo. */
export function isIco(b: Buffer): boolean {
  return b.length >= 22 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;
}

/** What the bytes ARE — never what a server said they were. */
export function sniffLogoImageKind(b: Buffer): LogoImageKind {
  if (!b || b.length < 4) return 'unknown';
  if (isPng(b)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (isIco(b)) return 'ico';
  const head = b.toString('utf8', 0, Math.min(b.length, 512)).trim().toLowerCase();
  if (head.startsWith('<?xml') || head.includes('<svg')) return 'svg';
  return 'unknown';
}

const PASS_THROUGH: Record<
  Exclude<LogoImageKind, 'ico' | 'unknown'>,
  { contentType: string; ext: string }
> = {
  svg: { contentType: 'image/svg+xml', ext: 'svg' },
  png: { contentType: 'image/png', ext: 'png' },
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  gif: { contentType: 'image/gif', ext: 'gif' },
  webp: { contentType: 'image/webp', ext: 'webp' },
  bmp: { contentType: 'image/bmp', ext: 'bmp' },
};

/**
 * Bytes → something the logo bucket accepts and a browser draws.
 * Throws with an operator-readable reason when the bytes are not a usable image.
 */
export async function normalizeLogoImage(
  buf: Buffer,
  declaredContentType?: string | null,
): Promise<NormalizedLogoImage> {
  const kind = sniffLogoImageKind(buf);
  if (kind === 'ico') {
    const png = await icoToPng(buf);
    if (!png) throw new Error('that icon file could not be read');
    return { body: png, contentType: 'image/png', ext: 'png' };
  }
  if (kind !== 'unknown') return { body: buf, ...PASS_THROUGH[kind] };
  // A format sharp can read but the bucket cannot store (AVIF, TIFF, HEIC…):
  // re-encode as PNG. Anything else — an HTML error page a CDN labelled
  // `image/*` — is refused rather than stored as the "logo".
  try {
    const png = await sharp(buf, { failOn: 'none' }).png().toBuffer();
    return { body: png, contentType: 'image/png', ext: 'png' };
  } catch {
    throw new Error(
      `that file is not an image we can use (${declaredContentType || 'unknown type'})`,
    );
  }
}

// ─── ICO → PNG ────────────────────────────────────────────────────────────

interface IcoFrame {
  width: number;
  height: number;
  bpp: number;
  offset: number;
  size: number;
}

function readIcoFrames(buf: Buffer): IcoFrame[] {
  const count = buf.readUInt16LE(4);
  if (count < 1 || count > 64 || buf.length < 6 + count * 16) return [];
  const frames: IcoFrame[] = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    if (size < 8 || offset + size > buf.length) continue;
    frames.push({
      // 0 means 256 in the directory.
      width: buf[e] || 256,
      height: buf[e + 1] || 256,
      bpp: buf.readUInt16LE(e + 6),
      offset,
      size,
    });
  }
  // Largest first, then deepest colour — the frame a browser would pick.
  return frames.sort(
    (a, b) => b.width * b.height - a.width * a.height || b.bpp - a.bpp,
  );
}

interface RawImage {
  width: number;
  height: number;
  /** width × height × 4, straight (non-premultiplied) RGBA, top row first. */
  rgba: Buffer;
}

/**
 * Decode one BMP/DIB icon frame: 1, 4, 8, 24 or 32 bits per pixel, with the
 * AND (transparency) mask that an ICO stacks under the colour rows. Returns
 * null for anything unexpected — the caller then tries the next frame.
 */
export function decodeIcoDib(d: Buffer, w: number, h: number): RawImage | null {
  if (d.length < 40) return null;
  const headerSize = d.readUInt32LE(0);
  if (headerSize < 40 || headerSize > d.length) return null;
  const dibWidth = d.readInt32LE(4);
  const dibHeight = d.readInt32LE(8);
  const planes = d.readUInt16LE(12);
  const bpp = d.readUInt16LE(14);
  const compression = d.readUInt32LE(16);
  const colorsUsed = d.readUInt32LE(32);

  if (dibWidth !== w || planes !== 1) return null;
  if (![1, 4, 8, 24, 32].includes(bpp)) return null;
  // BI_RGB, or BI_BITFIELDS on 32-bit (the standard BGRA layout).
  if (compression !== 0 && !(compression === 3 && bpp === 32)) return null;
  const topDown = dibHeight < 0;
  const stored = Math.abs(dibHeight);
  // An ICO's DIB height covers the colour rows AND the mask (2×); a few
  // writers store the plain height.
  const hasMaskRows = stored === h * 2;
  if (!hasMaskRows && stored !== h) return null;

  let off = headerSize;
  if (compression === 3 && headerSize === 40) off += 12; // three colour masks follow
  let palette: Array<[number, number, number]> | null = null;
  if (bpp <= 8) {
    const n = colorsUsed || 1 << bpp;
    if (n > 1 << bpp || off + n * 4 > d.length) return null;
    palette = [];
    for (let i = 0; i < n; i++) {
      palette.push([d[off + i * 4 + 2], d[off + i * 4 + 1], d[off + i * 4]]);
    }
    off += n * 4;
  }
  const stride = (((w * bpp + 31) >> 5) << 2);
  if (off + stride * h > d.length) return null;
  const maskStride = (((w + 31) >> 5) << 2);
  const maskOff = off + stride * h;
  const haveMask = hasMaskRows && maskOff + maskStride * h <= d.length;

  const out = Buffer.alloc(w * h * 4);
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const srcRow = topDown ? y : h - 1 - y;
    const row = off + srcRow * stride;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (bpp === 32) {
        const p = row + x * 4;
        b = d[p];
        g = d[p + 1];
        r = d[p + 2];
        a = d[p + 3];
        if (a) anyAlpha = true;
      } else if (bpp === 24) {
        const p = row + x * 3;
        b = d[p];
        g = d[p + 1];
        r = d[p + 2];
      } else {
        let idx: number;
        if (bpp === 8) idx = d[row + x];
        else if (bpp === 4) idx = x & 1 ? d[row + (x >> 1)] & 0x0f : d[row + (x >> 1)] >> 4;
        else idx = (d[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        const pe = palette![idx];
        if (pe) [r, g, b] = pe;
      }
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  // 32-bit frames with real alpha carry their own transparency; everything
  // else (and 32-bit frames whose alpha is all zero) uses the AND mask,
  // where a set bit means transparent.
  if (bpp !== 32 || !anyAlpha) {
    for (let y = 0; y < h; y++) {
      const maskRow = maskOff + (topDown ? y : h - 1 - y) * maskStride;
      for (let x = 0; x < w; x++) {
        const transparent = haveMask && ((d[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;
        out[(y * w + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * The best frame of an .ico as a PNG, or null when nothing in it decodes.
 * Frames narrower than `minEdge` are upscaled with Lanczos so the mark is
 * smooth rather than blocky wherever the app draws it larger than the icon.
 */
export async function icoToPng(
  buf: Buffer,
  opts: { minEdge?: number } = {},
): Promise<Buffer | null> {
  if (!isIco(buf)) return null;
  const minEdge = opts.minEdge ?? 256;
  for (const f of readIcoFrames(buf)) {
    const data = buf.subarray(f.offset, f.offset + f.size);
    try {
      let img: sharp.Sharp;
      let width: number;
      if (isPng(data)) {
        img = sharp(data, { failOn: 'none' });
        width = (await img.metadata()).width || f.width;
      } else {
        const raw = decodeIcoDib(data, f.width, f.height);
        if (!raw) continue;
        width = raw.width;
        img = sharp(raw.rgba, { raw: { width: raw.width, height: raw.height, channels: 4 } });
      }
      if (width < minEdge) {
        img = img.resize(minEdge, minEdge, {
          fit: 'contain',
          kernel: 'lanczos3',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      }
      return await img.png().toBuffer();
    } catch {
      // A frame we could not decode — try the next one.
    }
  }
  return null;
}
