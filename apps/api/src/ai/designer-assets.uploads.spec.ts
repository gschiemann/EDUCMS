/**
 * designer-assets — an operator's UPLOADED logo or photo (2026-09-23).
 *
 * An image uploaded to the Concierge used to become a text summary and nothing
 * else (multer `memoryStorage`, never stored). When the vision read says it is
 * the venue's logo or one of their photos, it now takes the SAME gates as a
 * site image and is copied to OUR bucket under `ai-designer/<tenant>/uploads/`.
 *
 * No network, no Supabase: the bucket is in memory; every image is a real
 * encoding built with sharp (test/supertaco-site.ts), so the gates decode for
 * real.
 */
import sharp from 'sharp';
import {
  rehostUploadedReferenceImage,
  rasterizeUploadForVision,
  type DesignerAssetStorage,
} from './designer-assets';
import {
  photoJpeg,
  photoPng,
  wordmarkPng,
  isOrangeRed,
} from '../../test/supertaco-site';

jest.setTimeout(30_000);

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

/** A two-ink vector wordmark (the Super Taco inks) — what an operator exports from their brand kit. */
const SVG_WORDMARK = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160" viewBox="0 0 600 160">' +
    '<rect x="10" y="30" width="230" height="100" fill="#f76422"/>' +
    '<circle cx="300" cy="80" r="60" fill="#fceb00"/>' +
    '<rect x="370" y="30" width="220" height="100" fill="#f76422"/>' +
    '</svg>',
  'utf-8',
);

const UPLOAD_PATH =
  /^ai-designer\/tenant-u\/uploads\/[0-9a-f]{16}\.(png|jpg)$/;

describe('rehostUploadedReferenceImage — an uploaded LOGO', () => {
  it('copies a PNG wordmark to uploads/ as a PNG and takes the palette from its own inks', async () => {
    const { storage, uploads } = memoryBucket();
    const out = await rehostUploadedReferenceImage(
      {
        tenantId: 'tenant-u',
        buffer: await wordmarkPng(1400, 392),
        mimeType: 'image/png',
        role: 'logo',
        filename: 'super-taco-logo.png',
      },
      { storage },
    );
    expect(out.asset).toMatchObject({
      source: 'upload',
      width: 1400,
      height: 392,
      format: 'png',
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(UPLOAD_PATH);
    expect(uploads[0].path.endsWith('.png')).toBe(true);
    expect(uploads[0].contentType).toBe('image/png');
    // The operator's file name never becomes part of a stored path.
    expect(uploads[0].path).not.toContain('super-taco');
    expect(out.asset!.url).toBe(
      `https://sb.example/storage/v1/object/public/assets/${uploads[0].path}`,
    );
    expect(isOrangeRed(out.palette[0])).toBe(true);
  });

  it('renders an SVG logo to a PNG — an SVG is never stored', async () => {
    const { storage, uploads } = memoryBucket();
    const out = await rehostUploadedReferenceImage(
      {
        tenantId: 'tenant-u',
        buffer: SVG_WORDMARK,
        mimeType: 'image/svg+xml',
        role: 'logo',
        filename: 'logo.svg',
      },
      { storage },
    );
    expect(out.asset?.format).toBe('png');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('image/png');
    expect(uploads[0].path).toMatch(/\/uploads\/[0-9a-f]{16}\.png$/);
    const meta = await sharp(uploads[0].buf).metadata();
    expect(meta.format).toBe('png');
    // Rendered to FILL the logo box (1500×500 stored for a 4K board), not at its 600×160 viewBox.
    expect(meta.width).toBeGreaterThan(1000);
    expect(isOrangeRed(out.palette[0])).toBe(true);
  });

  it('keeps a full-colour logo the vision read called a logo — the scraper-only "photographic" test is skipped', async () => {
    const { storage } = memoryBucket();
    const out = await rehostUploadedReferenceImage(
      {
        tenantId: 'tenant-u',
        buffer: await photoPng(900, 600, 5),
        mimeType: 'image/png',
        role: 'logo',
      },
      { storage },
    );
    expect(out.asset?.source).toBe('upload');
  });

  it('refuses a logo too small to read on a wall, and says why', async () => {
    const { storage, uploads } = memoryBucket();
    const out = await rehostUploadedReferenceImage(
      {
        tenantId: 'tenant-u',
        buffer: await wordmarkPng(100, 28),
        mimeType: 'image/png',
        role: 'logo',
      },
      { storage },
    );
    expect(out.asset).toBeNull();
    expect(uploads).toHaveLength(0);
    expect(out.reason).toMatch(/too small \(100×28\)/);
  });
});

describe('rehostUploadedReferenceImage — an uploaded PHOTO', () => {
  it('copies a real photo to uploads/ as a JPEG sized for the board', async () => {
    const { storage, uploads } = memoryBucket();
    const out = await rehostUploadedReferenceImage(
      {
        tenantId: 'tenant-u',
        buffer: await photoJpeg(1600, 1067, 21),
        mimeType: 'image/jpeg',
        role: 'photo',
      },
      { storage },
    );
    expect(out.asset).toMatchObject({
      source: 'upload',
      width: 1600,
      height: 1067,
      format: 'jpeg',
    });
    expect(out.palette).toEqual([]);
    expect(uploads[0].path).toMatch(UPLOAD_PATH);
    expect(uploads[0].contentType).toBe('image/jpeg');
  });

  it('drops the metadata a phone writes (the copy is in a PUBLIC bucket)', async () => {
    const withExif = await sharp(await photoJpeg(1600, 1067, 22))
      .withExif({ IFD0: { Artist: 'Operator phone', Copyright: 'somewhere private' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const { storage, uploads } = memoryBucket();
    await rehostUploadedReferenceImage(
      { tenantId: 'tenant-u', buffer: withExif, mimeType: 'image/jpeg', role: 'photo' },
      { storage },
    );
    expect((await sharp(uploads[0].buf).metadata()).exif).toBeUndefined();
  });

  it('the size gate follows the canvas: 640×480 is too small for 4K, fine for a 1280×720 board', async () => {
    const small = await photoJpeg(640, 480, 23);
    const at4k = await rehostUploadedReferenceImage(
      { tenantId: 'tenant-u', buffer: small, mimeType: 'image/jpeg', role: 'photo' },
      { storage: memoryBucket().storage },
    );
    expect(at4k.asset).toBeNull();
    expect(at4k.reason).toMatch(/too small: 640×480 \(needs a 800px short side\)/);

    const at720 = await rehostUploadedReferenceImage(
      {
        tenantId: 'tenant-u',
        buffer: small,
        mimeType: 'image/jpeg',
        role: 'photo',
        screenWidth: 1280,
        screenHeight: 720,
      },
      { storage: memoryBucket().storage },
    );
    expect(at720.asset?.source).toBe('upload');
  });

  it('refuses a transparent cut-out as a photo', async () => {
    const cutout = await sharp({
      create: { width: 1200, height: 1400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await photoPng(500, 700, 6), left: 350, top: 350 }])
      .png()
      .toBuffer();
    const out = await rehostUploadedReferenceImage(
      { tenantId: 'tenant-u', buffer: cutout, mimeType: 'image/png', role: 'photo' },
      { storage: memoryBucket().storage },
    );
    expect(out.asset).toBeNull();
    expect(out.reason).toMatch(/transparent cutout/);
  });
});

describe('rehostUploadedReferenceImage — never a URL it could not copy', () => {
  it('storage down: no asset, and the reason says so', async () => {
    const out = await rehostUploadedReferenceImage(
      { tenantId: 'tenant-u', buffer: await photoJpeg(1600, 1067, 24), mimeType: 'image/jpeg', role: 'photo' },
      { storage: memoryBucket({ fail: true }).storage },
    );
    expect(out.asset).toBeNull();
    expect(out.reason).toBe('it could not be copied to our storage');
  });

  it('no storage configured: nothing is decoded or returned', async () => {
    const out = await rehostUploadedReferenceImage(
      { tenantId: 'tenant-u', buffer: await wordmarkPng(1400, 392), mimeType: 'image/png', role: 'logo' },
      { storage: null },
    );
    expect(out).toEqual({ asset: null, palette: [], reason: 'it could not be copied to our storage' });
  });

  it('bytes that are not an image are refused, never stored', async () => {
    const { storage, uploads } = memoryBucket();
    const out = await rehostUploadedReferenceImage(
      { tenantId: 'tenant-u', buffer: Buffer.from('not an image at all'), mimeType: 'image/png', role: 'logo' },
      { storage },
    );
    expect(out.asset).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});

describe('rasterizeUploadForVision — providers read raster images only', () => {
  it('an SVG upload is analysed as a PNG render on white', async () => {
    const out = await rasterizeUploadForVision(SVG_WORDMARK, 'image/svg+xml', 'logo.svg');
    expect(out.mimeType).toBe('image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(false);
  });

  it('a raster upload is handed back untouched', async () => {
    const jpg = await photoJpeg(800, 600, 25);
    const out = await rasterizeUploadForVision(jpg, 'image/jpeg', 'patio.jpg');
    expect(out.buffer).toBe(jpg);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('an SVG it cannot render comes back as it was (the analysis then fails exactly as before)', async () => {
    const broken = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect', 'utf-8');
    const out = await rasterizeUploadForVision(broken, 'image/svg+xml', 'broken.svg');
    expect(out.buffer).toBe(broken);
    expect(out.mimeType).toBe('image/svg+xml');
  });
});
