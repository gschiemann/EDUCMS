/**
 * What did the operator actually upload?
 *
 * The import route used to decide that from the browser's `Content-Type` and
 * the filename, which are both client-supplied. Three concrete problems came
 * out of that, all of them verified:
 *
 *   • Some browsers send `application/octet-stream` for a drag-dropped .pptx,
 *     so the route accepts it and hands that generic type straight to storage,
 *     whose allowlist does not include it. The upload then fails with a
 *     storage error for what is actually a perfectly good deck.
 *   • Legacy binary .ppt is accepted on its extension, is not a ZIP, fails the
 *     parse, and used to fall through to a "successful" import whose IMAGE
 *     zone pointed at the .ppt file — an `<img src="deck.ppt">` that renders
 *     nothing.
 *   • Nothing checked that a file claiming to be a PDF contained a PDF.
 *
 * So: decide the format from the BYTES, and let the server pick the MIME it
 * stores. Filename and declared type become hints for the error message, never
 * inputs to the decision. This is the "one capability contract" the import
 * audit asked for, in one place that the route, the converter and the storage
 * bucket can all agree on.
 *
 * Deliberately NOT a general-purpose file-type library: it recognises exactly
 * the formats import supports, and everything else is a typed rejection with
 * something the operator can act on.
 */

/** A format design import can actually convert. */
export type ImportFormat = 'pdf' | 'pptx' | 'png' | 'jpeg' | 'webp';

/** The server-chosen MIME for each supported format. */
export const MIME_FOR_FORMAT: Record<ImportFormat, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Canonical extension per format, for the staged object key. */
export const EXT_FOR_FORMAT: Record<ImportFormat, string> = {
  pdf: '.pdf', pptx: '.pptx', png: '.png', jpeg: '.jpg', webp: '.webp',
};

export type SniffResult =
  | { ok: true; format: ImportFormat; mime: string; ext: string }
  | { ok: false; code: SniffFailureCode; message: string };

export type SniffFailureCode =
  /** Recognised, but a format we deliberately do not accept. */
  | 'IMPORTS_LEGACY_PPT'
  | 'IMPORTS_OFFICE_NOT_PRESENTATION'
  | 'IMPORTS_ZIP_NOT_PPTX'
  /** Not recognised at all. */
  | 'IMPORTS_UNSUPPORTED_FORMAT'
  | 'IMPORTS_EMPTY_FILE';

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

/** ASCII needle search, bounded so a 50MB upload cannot turn this into a scan. */
function containsAscii(buf: Buffer, needle: string, searchBytes: number): boolean {
  return buf.subarray(0, Math.min(buf.length, searchBytes)).includes(needle, 0, 'latin1');
}

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];           // "PK\x03\x04"
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];           // empty archive
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];
/** OLE2 compound-file header — legacy .ppt/.doc/.xls all start with it. */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * How far into the archive we look for the OOXML part names. A .pptx writes
 * `[Content_Types].xml` first and keeps its central directory at the END, so a
 * large deck's directory is far past any fixed prefix — we search the head for
 * the local file headers and the tail for the central directory.
 */
const OOXML_SCAN_BYTES = 64 * 1024;

function looksLikePptx(buf: Buffer): 'pptx' | 'other-ooxml' | 'plain-zip' {
  const head = buf.subarray(0, Math.min(buf.length, OOXML_SCAN_BYTES));
  const tail = buf.subarray(Math.max(0, buf.length - OOXML_SCAN_BYTES));
  const hasPart = (needle: string) =>
    head.includes(needle, 0, 'latin1') || tail.includes(needle, 0, 'latin1');

  // ZIP stores entry names uncompressed in both the local headers and the
  // central directory, so this needs no inflation and cannot be a zip bomb.
  if (hasPart('ppt/presentation.xml')) return 'pptx';
  if (hasPart('word/document.xml') || hasPart('xl/workbook.xml')) return 'other-ooxml';
  return 'plain-zip';
}

/**
 * Decide the format from the bytes.
 *
 * `declaredName` is used ONLY to make the rejection message specific; it never
 * changes the outcome. Pass the whole buffer — the function reads a bounded
 * prefix and suffix, never the middle.
 */
export function sniffImportFormat(buf: Buffer, declaredName?: string): SniffResult {
  if (!buf || buf.length === 0) {
    return {
      ok: false,
      code: 'IMPORTS_EMPTY_FILE',
      message: 'That file is empty. Choose a file with content and try again.',
    };
  }

  // A PDF header is allowed a little slack: some producers emit junk before
  // `%PDF-`, and every reader tolerates it, so refusing would reject files that
  // work everywhere else.
  if (containsAscii(buf, '%PDF-', 1024)) {
    return { ok: true, format: 'pdf', mime: MIME_FOR_FORMAT.pdf, ext: EXT_FOR_FORMAT.pdf };
  }

  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, format: 'png', mime: MIME_FOR_FORMAT.png, ext: EXT_FOR_FORMAT.png };
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { ok: true, format: 'jpeg', mime: MIME_FOR_FORMAT.jpeg, ext: EXT_FOR_FORMAT.jpeg };
  }
  // RIFF....WEBP — the four size bytes in between are not part of the check.
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ok: true, format: 'webp', mime: MIME_FOR_FORMAT.webp, ext: EXT_FOR_FORMAT.webp };
  }

  if (startsWith(buf, OLE2)) {
    // Legacy binary Office. We cannot convert it and never could; the honest
    // answer names the one-click fix rather than failing three steps later.
    return {
      ok: false,
      code: 'IMPORTS_LEGACY_PPT',
      message:
        'That is an older PowerPoint file (.ppt), which we cannot read. ' +
        'Open it in PowerPoint and use File → Save a Copy as .pptx, or export it to PDF.',
    };
  }

  if (startsWith(buf, ZIP_LOCAL) || startsWith(buf, ZIP_EMPTY) || startsWith(buf, ZIP_SPANNED)) {
    const kind = looksLikePptx(buf);
    if (kind === 'pptx') {
      return { ok: true, format: 'pptx', mime: MIME_FOR_FORMAT.pptx, ext: EXT_FOR_FORMAT.pptx };
    }
    if (kind === 'other-ooxml') {
      return {
        ok: false,
        code: 'IMPORTS_OFFICE_NOT_PRESENTATION',
        message:
          'That looks like a Word or Excel file. Design import takes presentations, PDFs and images — ' +
          'export it to PDF and import that instead.',
      };
    }
    return {
      ok: false,
      code: 'IMPORTS_ZIP_NOT_PPTX',
      message:
        'That is a zip archive, not a presentation. Import the presentation, PDF or image itself.',
    };
  }

  const named = declaredName ? ` (“${declaredName.slice(0, 60)}”)` : '';
  return {
    ok: false,
    code: 'IMPORTS_UNSUPPORTED_FORMAT',
    message:
      `We could not read that file${named}. Design import accepts PowerPoint (.pptx), PDF, ` +
      'PNG, JPG and WEBP.',
  };
}
