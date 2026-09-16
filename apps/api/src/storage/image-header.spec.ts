/**
 * The header reader, against bytes rather than a mock.
 *
 * Every fixture here is a real header — a real PNG IHDR, a real JPEG marker
 * chain with a real TIFF IFD, all three WebP chunk layouts — because a parser
 * tested against its own idea of the format proves nothing. The dimension half
 * is a verbatim port of the shipped floor-plan probe, so these cases are also
 * the regression net for that move.
 */
import { probeImageDimensions, probeImageHeader, readJpegOrientation } from './image-header';

/** A real PNG signature + IHDR. Nothing after it is needed to read the size. */
function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** An APP1 EXIF block carrying exactly one tag: orientation. */
function exifApp1(orientation: number, endian: 'II' | 'MM' = 'II'): Buffer {
  const le = endian === 'II';
  const tiff = Buffer.alloc(26);
  tiff.write(endian, 0, 'ascii');
  const u16 = (v: number, at: number) => (le ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const u32 = (v: number, at: number) => (le ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  u16(42, 2);          // TIFF magic
  u32(8, 4);           // IFD0 starts right after the 8-byte header
  u16(1, 8);           // one entry
  u16(0x0112, 10);     // tag: Orientation
  u16(3, 12);          // type: SHORT
  u32(1, 14);          // count: 1
  u16(orientation, 18); // value, stored inline
  u32(0, 22);          // no next IFD

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** A JPEG: SOI, an optional EXIF block, a real SOF0, then a stub scan. */
function jpeg(width: number, height: number, app1?: Buffer): Buffer {
  const sof = Buffer.alloc(13);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);   // 8 + 3 × one component
  sof.writeUInt8(8, 4);       // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(1, 9);       // component count
  const scan = Buffer.alloc(20);
  scan.writeUInt16BE(0xffda, 0);
  scan.writeUInt16BE(8, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1 ?? Buffer.alloc(0),
    sof,
    scan,
  ]);
}

function riff(chunk: string, body: Buffer): Buffer {
  const buf = Buffer.alloc(Math.max(32, 20 + body.length));
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write(chunk, 12, 'ascii');
  buf.writeUInt32LE(body.length, 16);
  body.copy(buf, 20);
  return buf;
}

/** Lossy WebP: 3-byte frame tag, 3-byte sync code, then 14-bit w/h. */
function webpLossy(width: number, height: number): Buffer {
  const body = Buffer.alloc(12);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(body, 3);
  body.writeUInt16LE(width & 0x3fff, 6);
  body.writeUInt16LE(height & 0x3fff, 8);
  return riff('VP8 ', body);
}

/** Lossless WebP: 0x2f signature, then 14 bits of (w-1) and 14 of (h-1). */
function webpLossless(width: number, height: number): Buffer {
  const w = width - 1;
  const h = height - 1;
  const body = Buffer.from([
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
    0, 0, 0, 0, 0, 0, 0,
  ]);
  return riff('VP8L', body);
}

/** Extended WebP: 4 reserved bytes, then 24-bit (w-1) and (h-1). */
function webpExtended(width: number, height: number): Buffer {
  const w = width - 1;
  const h = height - 1;
  const body = Buffer.from([
    0, 0, 0, 0,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
    0, 0,
  ]);
  return riff('VP8X', body);
}

describe('probeImageDimensions — the shipped floor-plan probe, unchanged', () => {
  it('reads a PNG IHDR', () => {
    expect(probeImageDimensions(png(2000, 1400))).toEqual({ width: 2000, height: 1400 });
  });

  it('reads a JPEG SOF, walking past an EXIF block on the way', () => {
    expect(probeImageDimensions(jpeg(1024, 768, exifApp1(1)))).toEqual({ width: 1024, height: 768 });
  });

  it('reads all three WebP chunk layouts', () => {
    expect(probeImageDimensions(webpLossy(640, 480))).toEqual({ width: 640, height: 480 });
    expect(probeImageDimensions(webpLossless(300, 200))).toEqual({ width: 300, height: 200 });
    expect(probeImageDimensions(webpExtended(4000, 2500))).toEqual({ width: 4000, height: 2500 });
  });

  it('answers null rather than guessing', () => {
    expect(probeImageDimensions(Buffer.alloc(0))).toBeNull();
    expect(probeImageDimensions(Buffer.from('not an image at all, honestly'))).toBeNull();
    // A PNG signature with a zero-sized IHDR is not a usable answer.
    expect(probeImageDimensions(png(0, 0))).toBeNull();
    // Truncated below the minimum header window.
    expect(probeImageDimensions(png(100, 100).subarray(0, 20))).toBeNull();
  });

  it('bails on a raw Uint8Array instead of throwing a 500', () => {
    // Multer on Railway has handed off `file.buffer` as a Uint8Array; the
    // Buffer-only read methods would throw a TypeError out of the controller.
    const raw = new Uint8Array(png(10, 10));
    expect(probeImageDimensions(raw as unknown as Buffer)).toBeNull();
  });
});

describe('probeImageHeader — format, stored size and orientation', () => {
  it('names the format', () => {
    expect(probeImageHeader(png(10, 20))?.format).toBe('png');
    expect(probeImageHeader(jpeg(10, 20))?.format).toBe('jpeg');
    expect(probeImageHeader(webpLossy(10, 20))?.format).toBe('webp');
  });

  it('reports orientation 1 for a format that cannot carry one', () => {
    expect(probeImageHeader(png(10, 20))).toMatchObject({
      orientation: 1, widthPx: 10, heightPx: 20, storedWidthPx: 10, storedHeightPx: 20,
    });
  });

  it('a JPEG with no EXIF is drawn exactly as stored', () => {
    expect(probeImageHeader(jpeg(4032, 3024))).toMatchObject({
      orientation: 1, widthPx: 4032, heightPx: 3024,
    });
  });

  it.each([1, 2, 3, 4])('leaves the axes alone for orientation %i', (o) => {
    expect(probeImageHeader(jpeg(4032, 3024, exifApp1(o)))).toMatchObject({
      orientation: o, storedWidthPx: 4032, storedHeightPx: 3024, widthPx: 4032, heightPx: 3024,
    });
  });

  it.each([5, 6, 7, 8])('swaps the axes for the quarter-turn orientation %i', (o) => {
    // THE CASE THAT MATTERS: a phone photo stored 4032×3024 with orientation 6
    // is DRAWN 3024×4032. A canvas built from the stored numbers would be
    // landscape for a portrait picture.
    expect(probeImageHeader(jpeg(4032, 3024, exifApp1(o)))).toMatchObject({
      orientation: o, storedWidthPx: 4032, storedHeightPx: 3024, widthPx: 3024, heightPx: 4032,
    });
  });

  it('reads a big-endian (MM) TIFF block too', () => {
    expect(probeImageHeader(jpeg(4032, 3024, exifApp1(6, 'MM')))).toMatchObject({
      orientation: 6, widthPx: 3024, heightPx: 4032,
    });
  });

  it('is null for anything it cannot read', () => {
    expect(probeImageHeader(Buffer.from('%PDF-1.7 a pdf is not an image'))).toBeNull();
  });
});

describe('readJpegOrientation — bounded, and never throws', () => {
  it('is 1 when the tag is absent', () => {
    expect(readJpegOrientation(jpeg(10, 10))).toBe(1);
  });

  it('is 1 for an out-of-range value rather than passing it through', () => {
    expect(readJpegOrientation(jpeg(10, 10, exifApp1(99)))).toBe(1);
  });

  it('is 1 for something that is not a JPEG', () => {
    expect(readJpegOrientation(png(10, 10))).toBe(1);
    expect(readJpegOrientation(Buffer.alloc(0))).toBe(1);
  });

  it('survives a truncated EXIF block', () => {
    const full = jpeg(10, 10, exifApp1(6));
    for (let cut = 2; cut < full.length; cut += 3) {
      expect(() => readJpegOrientation(full.subarray(0, cut))).not.toThrow();
    }
  });

  it('survives a hostile IFD claiming an enormous entry count', () => {
    const j = jpeg(10, 10, exifApp1(6));
    // The entry count sits 2 bytes into IFD0. Blow it up; the walk is capped
    // and every entry offset is bounds-checked against the block.
    const ifdCountAt = j.indexOf(Buffer.from('Exif\0\0', 'latin1')) + 6 + 8;
    j.writeUInt16LE(0xffff, ifdCountAt);
    expect(() => readJpegOrientation(j)).not.toThrow();
  });
});
