/**
 * What an image REALLY is, read from its header bytes.
 *
 * WHY BYTES AND NOT A DECODER. Two callers need an image's true pixel size
 * before anything else happens to it: the floor-plan upload (a client-supplied
 * `widthPx` is what every screen pin is clamped against, so a lie there moves
 * or refuses pins) and design import (a page's pixel size becomes a template's
 * canvas). Both are handed a stranger's file. Decoding it to ask is the
 * expensive, attackable answer — a compressed 2 MB PNG can expand to gigabytes
 * — while the size is sitting in the first few dozen bytes uncompressed. So
 * this reads the header and never allocates a pixel.
 *
 * WHY IT LIVES HERE. The dimension probe was written inside
 * `floor-plans.controller.ts` (2026-05-03, emergency-BUG-008) and design import
 * needed the same thing in 2026-09-16 (re-audit R7: a PNG was staged, labelled
 * `image/webp`, and given a 1920×1080 canvas it did not have). Two copies of a
 * byte parser is two places to fix a format bug, so the parser moved here
 * unchanged and both callers import it.
 *
 * The PNG / JPEG / WebP bodies below are a VERBATIM port of that shipped
 * function — same offsets, same bounds, same `null` on anything it cannot read
 * confidently. Orientation is the one addition, and it is additive: it is
 * reported alongside the stored size and never alters it.
 */

/** Formats this reader understands. Anything else answers `null`. */
export type ImageHeaderFormat = 'png' | 'jpeg' | 'webp';

export interface ImageHeader {
  format: ImageHeaderFormat;
  /**
   * Pixel size exactly as STORED in the file, before any EXIF orientation is
   * applied. This is what a decoder reads off the raster.
   */
  storedWidthPx: number;
  storedHeightPx: number;
  /**
   * EXIF orientation tag, 1-8. `1` whenever the file carries no readable EXIF
   * orientation — which is every PNG and WebP, and most JPEGs.
   */
  orientation: number;
  /**
   * Pixel size as a BROWSER DRAWS IT. Identical to the stored size except for
   * orientations 5-8, which rotate a quarter turn and therefore swap the axes.
   *
   * This is the size that belongs on a template canvas, because the image is
   * shown in an `<img>` and every engine we ship to — Safari, Chromium, Gecko,
   * Android System WebView — applies EXIF orientation there by default. A
   * portrait phone photo whose header says 4032×3024 is drawn 3024×4032, and a
   * canvas built from the stored numbers would be landscape for a portrait
   * picture.
   */
  widthPx: number;
  heightPx: number;
}

/**
 * Read format, size and orientation from an image's header.
 *
 * Returns `null` when the bytes are not one of the three formats, or are one of
 * them but not readable with confidence. A caller decides what `null` means:
 * the floor-plan upload keeps the client's number and logs, design import
 * refuses the file. Neither guesses.
 */
export function probeImageHeader(buf: Buffer): ImageHeader | null {
  const dims = probeImageDimensions(buf);
  if (!dims) return null;
  const format = imageFormatOf(buf);
  if (!format) return null;

  const orientation = format === 'jpeg' ? readJpegOrientation(buf) : 1;
  // 5-8 are the quarter-turn orientations: the drawn image is the stored one
  // rotated 90°, so its width is the stored height and vice versa.
  const quarterTurn = orientation >= 5 && orientation <= 8;
  return {
    format,
    storedWidthPx: dims.width,
    storedHeightPx: dims.height,
    orientation,
    widthPx: quarterTurn ? dims.height : dims.width,
    heightPx: quarterTurn ? dims.width : dims.height,
  };
}

/** Which of the three, from the signature alone. */
function imageFormatOf(buf: Buffer): ImageHeaderFormat | null {
  if (!buf || buf.length < 12) return null;
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp';
  return null;
}

/**
 * 2026-05-03 BUG FIX (cycle 4 emergency-BUG-008) — server-side image
 * dimension probe. Previously widthPx + heightPx came from the client's
 * form data with zero verification. A malicious client could submit
 * dimensions that didn't match the actual image, breaking the
 * screen-position calibration math (Screen.floorX/floorY are clamped
 * against plan.widthPx/heightPx — a lie there means a screen pin can
 * be placed off-image or refused entry to a legitimate location).
 *
 * We don't have an image-size dependency in apps/api/package.json, so
 * we parse the header bytes ourselves. ALLOWED_FLOOR_PLAN_MIMES is
 * exactly { png, jpeg, webp } so we only need to handle those three.
 *
 * Returns null when we cannot confidently determine dimensions — the
 * caller logs a warning rather than rejecting (we don't want to block
 * a legitimate upload over an exotic-but-valid PNG variant).
 *
 * Returns the STORED size. EXIF orientation is deliberately not applied here,
 * because this function's shipped contract is "what the raster measures" and
 * the floor-plan call site compares it against a client's own reading of the
 * same raster. Callers that need the DRAWN size use `probeImageHeader`.
 */
export function probeImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!buf || buf.length < 24) return null;
  // Defensive: Buffer-only methods (`readUInt32BE`, `readUInt16BE`,
  // `readUInt16LE`, `.slice(...).toString('ascii')`) don't exist on
  // raw Uint8Array. Multer on Railway has historically handed off
  // file.buffer as Uint8Array. Caller normalizes via toSafeBuffer
  // first, but belt-and-suspenders: if a raw Uint8Array slips in,
  // bail to null instead of throwing a `<fn> is not a function`
  // TypeError that escapes the controller as a 500.
  if (typeof (buf as any).readUInt32BE !== 'function') return null;

  // PNG: 8-byte signature, then IHDR chunk where bytes 16..19 = width,
  // 20..23 = height (big-endian).
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
    return null;
  }

  // JPEG: starts with FF D8. Walk the marker segments looking for an
  // SOF marker (C0..CF except C4/C8/CC which aren't frame markers) —
  // the next 5 bytes are precision (1) + height (2) + width (2), big-
  // endian. Bound the walk so a malformed file can't loop forever.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    const max = Math.min(buf.length, 1024 * 1024); // 1MB header window is plenty
    while (offset < max - 9) {
      if (buf[offset] !== 0xff) return null; // misaligned
      // Skip padding 0xFF bytes.
      while (offset < max && buf[offset] === 0xff) offset++;
      const marker = buf[offset];
      offset++;
      // SOI/EOI/RST markers have no length payload.
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > max) return null;
      const segLen = buf.readUInt16BE(offset);
      // SOF markers (Start of Frame) carry the dimensions we want.
      const isSof =
        (marker >= 0xc0 && marker <= 0xcf) &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (offset + 2 + 5 > max) return null;
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      if (segLen < 2) return null;
      offset += segLen;
    }
    return null;
  }

  // WEBP: 'RIFF' .... 'WEBP' then VP8/VP8L/VP8X chunk.
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    // Chunk header at offset 12: 4-byte type, 4-byte size, then payload.
    if (buf.length < 30) return null;
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8 ') {
      // Lossy: payload starts at 20. Spec: skip 6 bytes, then 2 bytes
      // width LE (lower 14 bits), 2 bytes height LE (lower 14 bits).
      if (buf.length < 30) return null;
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    if (chunk === 'VP8L') {
      // Lossless: payload starts at 20. First byte is signature 0x2f,
      // then 4 bytes carry (width-1) low 14 bits and (height-1) next
      // 14 bits, little-endian.
      if (buf[20] !== 0x2f || buf.length < 25) return null;
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    if (chunk === 'VP8X') {
      // Extended: at offset 24, 3 bytes (width-1) LE, 3 bytes
      // (height-1) LE.
      if (buf.length < 30) return null;
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    return null;
  }

  return null;
}

/** How far into a JPEG we will look for its EXIF block. */
const JPEG_EXIF_SCAN_BYTES = 256 * 1024;
/** TIFF IFD entries we will walk. A real IFD0 has a handful. */
const MAX_IFD_ENTRIES = 256;

/**
 * The EXIF orientation of a JPEG, or 1.
 *
 * Every step is bounded and every failure answers 1 rather than throwing:
 * orientation is a refinement, and a file whose EXIF we cannot read is still a
 * perfectly good picture that should import at its stored size.
 *
 * Walks the APP1 segment to the TIFF header, reads IFD0, and returns tag
 * 0x0112. Nothing is decoded and no offset is followed outside the buffer.
 */
export function readJpegOrientation(buf: Buffer): number {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  if (typeof (buf as any).readUInt16BE !== 'function') return 1;

  let offset = 2;
  const max = Math.min(buf.length, JPEG_EXIF_SCAN_BYTES);
  while (offset < max - 4) {
    if (buf[offset] !== 0xff) return 1; // misaligned; stop rather than hunt
    while (offset < max && buf[offset] === 0xff) offset++;
    const marker = buf[offset];
    offset++;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    // Start of scan: pixel data from here on, and EXIF never follows it.
    if (marker === 0xda) return 1;
    if (offset + 2 > max) return 1;
    const segLen = buf.readUInt16BE(offset);
    if (segLen < 2) return 1;
    if (marker === 0xe1 && offset + segLen <= buf.length) {
      // APP1. "Exif\0\0" then a TIFF header.
      const start = offset + 2;
      if (
        start + 6 <= buf.length &&
        buf[start] === 0x45 && buf[start + 1] === 0x78 &&
        buf[start + 2] === 0x69 && buf[start + 3] === 0x66 &&
        buf[start + 4] === 0x00 && buf[start + 5] === 0x00
      ) {
        return readTiffOrientation(buf, start + 6, offset + segLen);
      }
    }
    offset += segLen;
  }
  return 1;
}

/** Read tag 0x0112 out of IFD0 of the TIFF block at `tiffStart`. */
function readTiffOrientation(buf: Buffer, tiffStart: number, blockEnd: number): number {
  const end = Math.min(blockEnd, buf.length);
  if (tiffStart + 8 > end) return 1;
  const le = buf[tiffStart] === 0x49 && buf[tiffStart + 1] === 0x49;
  const be = buf[tiffStart] === 0x4d && buf[tiffStart + 1] === 0x4d;
  if (!le && !be) return 1;
  const u16 = (at: number) => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at: number) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));

  if (u16(tiffStart + 2) !== 42) return 1; // the TIFF magic
  const ifdOffset = u32(tiffStart + 4);
  const ifd = tiffStart + ifdOffset;
  // An offset is relative to the TIFF header and may be anything on disk, so
  // it is checked against this block rather than trusted.
  if (ifd < tiffStart || ifd + 2 > end) return 1;

  const count = Math.min(u16(ifd), MAX_IFD_ENTRIES);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) !== 0x0112) continue;
    // SHORT (type 3), one value, stored inline in the value field.
    if (u16(entry + 2) !== 3) return 1;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}
