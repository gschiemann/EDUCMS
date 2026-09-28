/**
 * logo-image — the Brookfield "B" regression (2026-09-28).
 *
 * Greg picked Brookfield Residential's "B" mark in the branding wizard and the
 * app kept showing something else. The "B" is the site's favicon.ico — served
 * as `image/vnd.microsoft.icon`, a spelling the branding-logos bucket does not
 * allow — so the upload was refused and the route quietly stored a different
 * candidate. These tests use the REAL favicon bytes (fetched from the site the
 * day it failed) and decode them against an independent reference: Python's
 * PIL produced the pixel hash below.
 */
import { createHash } from 'crypto';
import sharp from 'sharp';
import {
  decodeIcoDib,
  icoToPng,
  isIco,
  normalizeLogoImage,
  sniffLogoImageKind,
} from './logo-image';

/** The REAL https://www.brookfieldresidential.com/favicon.ico — 4,286 bytes:
 *  a 22-byte header + one 4,264-byte 32×32 32-bit DIB frame. Cut from the
 *  producer, not hand-built. */
const BROOKFIELD_FAVICON = Buffer.from(
  'AAABAAEAICAAAAEAIACoEAAAFgAAACgAAAAgAAAAQAAAAAEAIAAAAAAAABAAAMMOAADDDgAAAAAAAAAAAAAAAAAATioAAE4qAEVO' +
  'KgC6TioAvE4qALtOKgC7TioAu04qALtOKgC7TioAu04qALtOKgC7TioAu04qALxOKgC5TyoArk4qAKdOKgChTioAlk8pAIBPKgBh' +
  'TSoAN0olAA5LJgADqakAAEgvAABLLQAASy0AAAAAAAAAAAAAAAAAAAAAAABOKgAATioAVE4qAOROKgDmTioA5U4qAOVOKgDlTioA' +
  '5U4qAOVOKgDlTioA5U4qAOVOKgDlTioA5U4qAOROKgDgTioA3U4qANtOKgDXTioAzk4qAMJOKgCyTioAl08rAGFPLAAhZRkAAEor' +
  'AABJLAAASisAAAAAAAAAAAAAAAAAAE4qAABOKgBeTioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9O' +
  'KgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD8TioAyk4qAIJNKgA4RiwABDQwAABFLAAAAAAAAAAAAAAAAAAA' +
  'TioAAE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA' +
  '/04qAP9OKgD/TioA/04qAP9OKgD+TioA8U4qAJ9MKgApTCsABUwqAABPKQAAAAAAAAAAAABOKgAATioAXU4qAP5OKgD/TioA/04q' +
  'AP9OKgD/TioA/04qAP9OKgD+TioA/k4qAP5OKgD+TioA/k4qAP5OKgD+TioA/k4qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9O' +
  'KgD/TioA4k4qAJVOKgAXTioAAE8pAAAAAAAAAAAAAE4qAABOKgBdTioA/k4qAP9OKgD/TioA/04qAP9OKgD/TioA5U4qAMROKgCt' +
  'TioArU4qAK1OKgCtTioArk4qALFOKwC/TioA2U4qAPZOKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD+TioA008pAENQKAAKTykA' +
  'AAAAAAAAAAAATioAAE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04qAP5OKgDFTioAe00rAEdNKwBGTSsAR00rAEdNKwBHTysAS04r' +
  'AFlOKwByTioAnE4qANlOKgD3TioA/04qAP9OKgD/TioA/04qAP9OKgDsTioAd04pAB9OKgAAAAAAAAAAAABOKgAATioAXU4qAP5O' +
  'KgD/TioA/04qAP9OKgD/TioA/k4qAK9NKgBJTSoAAU0xAABNKwABTSsAAU0rAAFPKwABTCsAAUEkAABPKQAaTikAiU4qAN9OKgD/' +
  'TioA/04qAP9OKgD/TioA/04qAPJNKgCjTSoANE0qAAAAAAAAAAAAAE4qAABOKgBdTioA/k4qAP9OKgD/TioA/04qAP9OKgD+TioA' +
  'r00qAEhNJgAATSoAAE0rAABNKwAATSsAAE8rAABPKwAATCoAAE0qAAhNKgA4TioAu04qAP9OKgD/TioA/04qAP9OKgD/TioA9k8p' +
  'AL1PKQBATykAAAAAAAAAAAAATioAAE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04qAP5OKgCvTSoASU0qAAFNKgAAAAAAAAAAAAAA' +
  'AAAAAAAAAFUrAABQLQAAUC8AA08tABtOKgCtTioA/04qAP9OKgD/TioA/04qAP9OKgD2TikAwU4pAEJOKQAAAAAAAAAAAABOKgAA' +
  'TioAXU4qAP5OKgD/TioA/04qAP9OKgD/TioA/k4qAK9NKgBJTSoAAU0qAAAAAAAAAAAAAFUcAABVHAAAWw8AAFApAABRLAADUCsA' +
  'KE4qALROKgD/TioA/04qAP9OKgD/TioA/04qAPNOKQCrTikAOE4pAAAAAAAAAAAAAE4qAABOKgBdTioA/k4qAP9OKgD/TioA/04q' +
  'AP9OKgD+TioAr00qAEhQKgAATioAAE4qAABOKgAATioAAE4qAABGPAAAVSAAAk4pABdOKQBfTioAzE4qAP9OKgD/TioA/04qAP9O' +
  'KgD/TioA6U4pAHxOKQAiTikAAAAAAAAAAAAATioAAE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04qAP5OKgCvTSoASk4qAAJPKgAB' +
  'TioAAU4qAAFOKgABTioAAVcYAARQJwAeTykAXk4qAMVOKgD0TioA/04qAP9OKgD/TioA/04qAP1OKwDRUCoAOlUpAAZRKgAAAAAA' +
  'AAAAAABOKgAATioAXU4qAP5OKgD/TioA/04qAP9OKgD/TioA/04qAN5OKwC0TioAl04qAJZOKgCWTioAlk4qAJZOKgCWTisAnU4q' +
  'AK5OKgDLTioA9E4qAP9OKgD/TioA/04qAP9OKgD/TioAzU4rAGxQLAAUQyoAAFotAAAAAAAAAAAAAE4qAABOKgBdTioA/k4qAP9O' +
  'KgD/TioA/04qAP9OKgD/TioA/k4qAP1OKgD9TioA/U4qAP1OKgD9TioA/U4qAP1OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD1' +
  'TioA3E4qALROKgBsTywAG08tAANRLAAAVSsAAAAAAAAAAAAATioAAE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA' +
  '/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD8TioA7k4qAMpOKwCETioANk0kAAhOKgAASyAAAE8s' +
  'AAAAAAAAAAAAAAAAAABOKgAATioAXU4qAP5OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9O' +
  'KgD/TioA/04qAP9OKgD/TioA/04qAOdOKgC1TSkAb0wpACdKJwAIUhYAAE8sAABPKgAATywAAAAAAAAAAAAAAAAAAE4qAABOKgBd' +
  'TioA/k4qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA' +
  '9E4qAN5OKgC+TisAkk0rAD9MKgAIUi8AAE8sAABRLgAAAAAAAAAAAAAAAAAATioAAE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04q' +
  'AP9OKgDqTioAz04qAL1OKgC8TioAvE4qALxOKgC+TioAxE4qAM9OKgDkTioA+04qAP9OKgD/TioA/04qAP9OKwDzTioApE4qAEVS' +
  'MAAFY0YAAFMxAAAAAAAAAAAAAAAAAABOKgAATioAXU4qAP5OKgD/TioA/04qAP9OKgD/TioA/k4qAMFOKgBzTykAPE8pADtPKQA8' +
  'TioAPE0sAEBPKwBNTioAZU0qAJROKwDQTioA904qAP9OKgD/TioA/04qAP9OKgD5TioAo1AsACNQLQAEUCwAAAAAAAAAAAAAAAAA' +
  'AE4qAABOKgBdTioA/k4qAP9OKgD/TioA/04qAP9OKgD+TioAsk0qAE9PKQAJTykACE8pAAhOKgAITSwACU8rAAtNKgAOTSkAGk4q' +
  'AE5OKgDaTioA/04qAP9OKgD/TioA/04qAP9OKgDUTysAc08rABFPKwAAAAAAAAAAAAAAAAAATioAAE4qAF1OKgD+TioA/04qAP9O' +
  'KgD/TioA/04qAP5OKgCuTSoAR1AoAABPKQAATykAAE4qAABNLAAATysAAE4qAABOLAAATygAH08pALJOKgDyTioA/04qAP9OKgD/' +
  'TioA/04qAO5OKwCoTisAGk4rAAAAAAAAAAAAAAAAAABOKgAATioAXU4qAP5OKgD/TioA/04qAP9OKgD/TioA/k4qAK9NKgBJTSoA' +
  'AU0qAAAAAAAAAAAAAFUAAABVAAAASkkAAE4pAABOKQAWTikAok4qAOtOKgD/TioA/04qAP9OKgD/TioA+04rAMVOKwAeTisAAAAA' +
  'AAAAAAAAAAAAAE4qAABOKgBdTioA/k4qAP9OKgD/TioA/04qAP9OKgD+TioAr00qAEhQKgAATioAAE4qAABOKgAATioAAE4qAABN' +
  'MwAARDgAAE4qACZNKgC2TioA804qAP9OKgD/TioA/04qAP9OKgD/TioAzU4qACBOKgAAAAAAAAAAAAAAAAAATioAAE4qAF1OKgD+' +
  'TioA/04qAP9OKgD/TioA/04qAP5OKgCvTSoASU4qAAJPKgABTioAAU4qAAFOKgABTioAAZ4AAABQJgAcTykAaE4qAOFOKgD/TioA' +
  '/04qAP9OKgD/TioA/04qAPpOKwDCTisAHk4rAAAAAAAAAAAAAAAAAABOKgAATioAXU4qAP5OKgD/TioA/04qAP9OKgD/TioA/00q' +
  'ANpNKgCsTioAi04qAItOKgCLTioAi04qAItOKgCLTioAk04qAKlOKgDOTioA+E4qAP9OKgD/TioA/04qAP9OKgD/TioA6U4qAJ5O' +
  'KwAYTioAAAAAAAAAAAAAAAAAAE4qAABOKgBdTioA/k4qAP9OKgD/TioA/04qAP9OKgD/TioA+04qAPVOKgDxTioA8U4qAPFOKgDx' +
  'TioA8U4qAPFOKgD5TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgDNTioAXk4qAA5OKgAAAAAAAAAAAAAAAAAATioA' +
  'AE4qAF1OKgD+TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04q' +
  'AP9OKgD/TioA/04qAP9OKgD/TioA9U4qAJtNJwAaTSYAA00nAAAAAAAAAAAAAAAAAABOKgAATioAXU4qAP5OKgD/TioA/04qAP9O' +
  'KgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04rAPtOKwCn' +
  'TioAQ00nAARBAgAATSYAAAAAAAAAAAAAAAAAAE4qAABOKgBfTioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA' +
  '/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04qAP9OKgD/TioA/04rAPlOKwDTTisAkE4rAEJOKgAOTSYAAE4pAABNJwAAAAAAAAAA' +
  'AAAAAAAATioAAE4qAEpOKgDKTioAzE4qAMtOKgDLTioAy04qAMtOKgDLTioAy04qAMtOKgDLTioAy04qAMtOKgDLTioAy04qAMdO' +
  'KgDCTioAu04qALBOKwClTisAkU4rAGlPKgAqUCkAB04qAABOKgAATioAAAAAAAAAAAAAAAAAAAAAAABNKwAATSsALE0rAHdNKwB4' +
  'TSsAeE0rAHhNKwB4TSsAeE0rAHhNKwB4TSsAeE0rAHhNKwB4TSsAeE0rAHhNKwB4TisAbk4rAGBNKwBPTCkAMksoABVKJQAFTisA' +
  'AU8rAABPKgAATyoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAB4AAAAOAAAADgAAAAYAAAAGAAAABgAAAAYAAAAGAAAABgAeAAYAG' +
  'AAGAAAABgAAAAYAAAAGAAAABgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AGAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOA' +
  'AAADgAAAB4AAAB8=',
  'base64',
);

/** sha256 of the 32×32 RGBA pixels, decoded by PIL (an independent decoder). */
const BROOKFIELD_RGBA_SHA256 = '92179fe81d9f8e0154f655c02a8e9bcfa83a45a6e9a40cacf77635ad015f3e70';

/** A hand-rolled 8-bit PALETTE icon (no alpha channel — transparency comes
 *  from the AND mask), the shape a 2000s .ico has. 8×8, a red square on a
 *  transparent ground. */
function paletteIco8(): Buffer {
  const w = 8;
  const h = 8;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8); // colour rows + mask rows
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(8, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(2, 32); // two palette entries
  const palette = Buffer.from([0, 0, 0, 0, /* index 1 (BGRA): */ 0x2a, 0x1e, 0xc8, 0]);
  const stride = 8; // 8 px × 8 bit, already a multiple of 4
  const xor = Buffer.alloc(stride * h);
  const mask = Buffer.alloc(4 * h, 0xff); // every pixel transparent…
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      xor[(h - 1 - y) * stride + x] = 1; // bottom-up rows
      mask[(h - 1 - y) * 4] &= ~(1 << (7 - x)); // …except the square
    }
  }
  const dib = Buffer.concat([header, palette, xor, mask]);
  const dir = Buffer.alloc(22);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  dir[6] = w;
  dir[7] = h;
  dir.writeUInt16LE(1, 10);
  dir.writeUInt16LE(8, 12);
  dir.writeUInt32LE(dib.length, 14);
  dir.writeUInt32LE(22, 18);
  return Buffer.concat([dir, dib]);
}

/** An .ico whose only frame is an embedded PNG (how modern tools write 256 px). */
async function pngInIco(edge: number): Promise<Buffer> {
  const png = await sharp({
    create: { width: edge, height: edge, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const dir = Buffer.alloc(22);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  dir[6] = edge >= 256 ? 0 : edge;
  dir[7] = edge >= 256 ? 0 : edge;
  dir.writeUInt16LE(1, 10);
  dir.writeUInt16LE(32, 12);
  dir.writeUInt32LE(png.length, 14);
  dir.writeUInt32LE(22, 18);
  return Buffer.concat([dir, png]);
}

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

describe('the real Brookfield favicon', () => {
  it('is what we think it is', () => {
    expect(BROOKFIELD_FAVICON.length).toBe(4286);
    expect(isIco(BROOKFIELD_FAVICON)).toBe(true);
    expect(sniffLogoImageKind(BROOKFIELD_FAVICON)).toBe('ico');
  });

  it('decodes to exactly the pixels an independent decoder (PIL) produces', () => {
    const raw = decodeIcoDib(BROOKFIELD_FAVICON.subarray(22), 32, 32);
    expect(raw).not.toBeNull();
    expect(raw!.width).toBe(32);
    expect(createHash('sha256').update(raw!.rgba).digest('hex')).toBe(BROOKFIELD_RGBA_SHA256);
  });

  it('becomes a PNG of the navy B on a transparent ground, upscaled smoothly', async () => {
    const png = await icoToPng(BROOKFIELD_FAVICON);
    expect(png).not.toBeNull();
    expect(sniffLogoImageKind(png!)).toBe('png');
    const meta = await sharp(png!).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    // Top-left corner: transparent. Middle of the B's stem: Brookfield navy.
    expect((await pixel(png!, 0, 0))[3]).toBe(0);
    const [r, g, b, a] = await pixel(png!, 64, 128);
    expect([r, g, b, a]).toEqual([0, 42, 78, 255]);
  });

  it('normalizeLogoImage turns it into an allowed type even though the server said image/vnd.microsoft.icon', async () => {
    const out = await normalizeLogoImage(BROOKFIELD_FAVICON, 'image/vnd.microsoft.icon');
    expect(out.contentType).toBe('image/png');
    expect(out.ext).toBe('png');
    expect(sniffLogoImageKind(out.body)).toBe('png');
  });
});

describe('other icon shapes', () => {
  it('an 8-bit palette icon takes its transparency from the AND mask', async () => {
    const ico = paletteIco8();
    const raw = decodeIcoDib(ico.subarray(22), 8, 8);
    expect(raw).not.toBeNull();
    const at = (x: number, y: number) => Array.from(raw!.rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
    expect(at(0, 0)[3]).toBe(0); // ground: transparent
    expect(at(3, 3)).toEqual([0xc8, 0x1e, 0x2a, 255]); // the square: palette entry 1
    const png = await icoToPng(ico);
    expect(png).not.toBeNull();
  });

  it('a PNG-in-ICO frame passes through and is upscaled when small', async () => {
    const small = await icoToPng(await pngInIco(48));
    expect((await sharp(small!).metadata()).width).toBe(256);
    const big = await icoToPng(await pngInIco(256));
    expect((await sharp(big!).metadata()).width).toBe(256);
  });

  it('never invents a logo from junk: a truncated or corrupt icon is null', async () => {
    expect(await icoToPng(BROOKFIELD_FAVICON.subarray(0, 100))).toBeNull();
    const corrupt = Buffer.from(BROOKFIELD_FAVICON);
    corrupt.writeUInt16LE(7, 22 + 14); // bits-per-pixel 7 does not exist
    expect(await icoToPng(corrupt)).toBeNull();
    expect(await icoToPng(Buffer.from('not an icon at all, just text'))).toBeNull();
  });
});

describe('normalizeLogoImage — the bucket only ever sees types it allows', () => {
  it('trusts the bytes, not the header: a JPEG labelled image/jpg is image/jpeg', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    const out = await normalizeLogoImage(jpeg, 'image/jpg');
    expect(out).toMatchObject({ contentType: 'image/jpeg', ext: 'jpg' });
  });

  it('keeps an SVG as an SVG', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');
    const out = await normalizeLogoImage(svg, 'text/plain');
    expect(out).toMatchObject({ contentType: 'image/svg+xml', ext: 'svg' });
    expect(out.body).toBe(svg);
  });

  it('re-encodes a format the bucket cannot store (TIFF) as PNG', async () => {
    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abcdef' } }).tiff().toBuffer();
    const out = await normalizeLogoImage(tiff, 'image/tiff');
    expect(out).toMatchObject({ contentType: 'image/png', ext: 'png' });
  });

  it('refuses an HTML error page a CDN labelled image/png', async () => {
    await expect(normalizeLogoImage(Buffer.from('<html><body>Access denied</body></html>'), 'image/png')).rejects.toThrow(
      /not an image we can use/,
    );
  });
});
