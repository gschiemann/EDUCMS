/**
 * MediaOptimizationService.optimizeImageForUpload — what sharp made of the input
 * (2026-10-05, the upload content check).
 *
 *   1. It REPORTS: the format sharp recognised, and what it threw when it threw.
 *      Before this a non-picture under a picture name was only logged and kept.
 *   2. `convertNonScreenFormats` (the media-library upload only): a format no
 *      screen draws (SVG, AVIF, TIFF … under a JPEG / PNG / WebP name) is replaced
 *      by sharp's own re-encode even when that is bigger. Without the option —
 *      every other caller, including the multipart path panic content uses —
 *      nothing changes.
 *   3. Formats screens DO draw (a GIF named .png included) are untouched by the
 *      option: animation handling is exactly as it was.
 */
import sharp from 'sharp';
import {
  adoptsReencode,
  MediaOptimizationService,
} from './media-optimization.service';

const svc = new MediaOptimizationService();
const PNG_MAGIC = '89504e470d0a1a0a';

/** A tiny SVG that rasterises to a big PNG — the case where the re-encode is "not smaller". */
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">' +
    '<rect width="1600" height="900" fill="#225588"/><circle cx="800" cy="450" r="300" fill="#ffcc00"/></svg>',
);

describe('optimizeImageForUpload reports what sharp made of the input', () => {
  it('a real JPEG: its format, no failure', async () => {
    const jpg = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#225588' },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const out = await svc.optimizeImageForUpload(jpg, 'image/jpeg', '.jpg');
    expect(out.sourceFormat).toBe('jpeg');
    expect(out.decodeFailure ?? null).toBeNull();
  });

  it('text under a picture name: no format, and the failure sharp threw (the original is kept, as before)', async () => {
    const text = Buffer.from('this is not a picture\n');
    const out = await svc.optimizeImageForUpload(text, 'image/jpeg', '.jpg');
    expect(out.optimized).toBe(false);
    expect(out.buffer).toBe(text);
    expect(out.sourceFormat).toBeNull();
    expect(out.decodeFailure).toMatch(/unsupported image format/i);
  });
});

describe('convertNonScreenFormats', () => {
  it('an SVG under a .png name: kept as uploaded by default (as before) …', async () => {
    const out = await svc.optimizeImageForUpload(svg, 'image/png', '.png');
    expect(out.sourceFormat).toBe('svg');
    expect(out.optimized).toBe(false);
    expect(adoptsReencode(out, svg.length)).toBe(false);
  });

  it('… and replaced by a real PNG with the option, although the PNG is bigger', async () => {
    const out = await svc.optimizeImageForUpload(
      svg,
      'image/png',
      '.png',
      undefined,
      undefined,
      { convertNonScreenFormats: true },
    );
    expect(out.optimized).toBe(true);
    expect(out.convertedForScreens).toBe(true);
    expect(out.finalBytes).toBeGreaterThan(svg.length);
    expect(out.buffer.subarray(0, 8).toString('hex')).toBe(PNG_MAGIC);
    expect(out.mimeType).toBe('image/png');
    expect(adoptsReencode(out, svg.length)).toBe(true);
    expect(out.processedDimensions).toEqual({ w: 1600, h: 900 });
  });

  it('an AVIF under a .jpg name (black on a Chromium-83 LED controller) becomes a real JPEG with the option', async () => {
    const avif = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#225588' },
    })
      .avif()
      .toBuffer();
    const plain = await svc.optimizeImageForUpload(avif, 'image/jpeg', '.jpg');
    expect(plain.sourceFormat).toBe('heif');
    expect(plain.sourceCompression).toBe('av1');
    const out = await svc.optimizeImageForUpload(
      avif,
      'image/jpeg',
      '.jpg',
      undefined,
      undefined,
      { convertNonScreenFormats: true },
    );
    expect(adoptsReencode(out, avif.length)).toBe(true);
    expect((await sharp(out.buffer).metadata()).format).toBe('jpeg');
  });

  it('a GIF under a .png name is a format screens draw: the option changes nothing about it', async () => {
    const frames = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#225588' },
    })
      .gif()
      .toBuffer();
    const a = await svc.optimizeImageForUpload(frames, 'image/png', '.png');
    const b = await svc.optimizeImageForUpload(
      frames,
      'image/png',
      '.png',
      undefined,
      undefined,
      { convertNonScreenFormats: true },
    );
    expect(b.sourceFormat).toBe('gif');
    expect(b.convertedForScreens).toBeUndefined();
    expect([b.optimized, b.finalBytes]).toEqual([a.optimized, a.finalBytes]);
  });

  it('a real PNG that does not shrink is still kept as uploaded with the option', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#000' },
    })
      .png({ palette: true, compressionLevel: 9 })
      .toBuffer();
    const out = await svc.optimizeImageForUpload(
      png,
      'image/png',
      '.png',
      undefined,
      undefined,
      { convertNonScreenFormats: true },
    );
    if (!out.optimized) {
      expect(out.buffer).toBe(png);
      expect(adoptsReencode(out, png.length)).toBe(false);
    } else {
      expect(out.finalBytes).toBeLessThan(png.length);
    }
    expect(out.convertedForScreens).toBeUndefined();
  });
});
