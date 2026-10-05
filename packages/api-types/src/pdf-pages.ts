/**
 * PDF pages — `Asset.processingMeta.pdfPages`, the ONE record of a PDF's pages
 * as pictures a screen can show (2026-10-05, media beta test M2-02 / L3).
 *
 * WHY. A PDF in a playlist used to reach the player as the PDF itself, drawn in
 * an `<iframe>`: on desktop Chrome that is the browser's own viewer (toolbar,
 * thumbnails, download and print buttons, page 1 only); on our real players —
 * Android System WebView, which has no PDF viewer — it is nothing at all. So
 * the API renders every page ONCE, at upload, and the manifest hands screens
 * the pages as ordinary images. The player needs no PDF support.
 *
 * FRAMES, NOT PAGES. The player draws every picture edge to edge
 * (`object-fit: fill`), so a Letter page delivered at its own shape would be
 * stretched across a 16:9 panel. Each page is therefore stored already composed
 * into screen canvases — the page whole, centred, on black:
 *   landscape       3840×2160    landscape-1080  1920×1080
 *   portrait        2160×3840    portrait-1080   1080×1920
 * and a screen gets the frame of its own orientation, the 1080 one when it is a
 * 1080p screen (the same rule as an image's or a video's 1080p copy).
 *
 * WHO READS IT. The API writes it (`storage/pdf-pages`) and reads it in the
 * NORMAL manifest branch only (`pdfDelivery`); the dashboard reads it for the
 * Media Library and the playlist editor. Shared so the two can never disagree
 * about which PDFs are on screens.
 *
 * ── Shape (version 1) ─────────────────────────────────────────────────────
 *   { version: 1, state: 'pending', count?, done?, legacy?, updatedAt }
 *       pages are being made; `done` of `count` so far
 *   { version: 1, state: 'ready', count, base, pages: [...], truncatedAt?, legacy?, updatedAt }
 *       every page in `pages` has all four frames; `truncatedAt` = the page cap
 *       when the document has more pages than were made
 *   { version: 1, state: 'failed', error, count?, legacy?, updatedAt }
 *       no pages could be made; `error` is a stable reason code
 *   absent
 *       a PDF from before pages existed (or with pages switched off): delivered
 *       exactly as before, as the PDF.
 *
 * File URLs are not repeated per file: every page file of one rendering sits
 * under `base`, named `p<n>-<frame>.webp` (thumbnail `p<n>-thumb.webp`), and a
 * page stores only each frame's SHA-256 and size. A 60-page PDF is read by
 * every manifest rebuild that includes it, so the record is kept small.
 */

export const PDF_PAGES_VERSION = 1 as const;

/** The four screen canvases every page is composed into. */
export const PDF_PAGE_FRAMES = [
  { key: 'landscape', width: 3840, height: 2160 },
  { key: 'landscape-1080', width: 1920, height: 1080 },
  { key: 'portrait', width: 2160, height: 3840 },
  { key: 'portrait-1080', width: 1080, height: 1920 },
] as const;

export type PdfFrameKey = (typeof PDF_PAGE_FRAMES)[number]['key'];

/** Every page file is a WebP — what the rasterizer encodes. */
export const PDF_PAGE_MIME = 'image/webp' as const;

/** How many pages are made by default before the rest are listed as not shown. */
export const PDF_PAGES_DEFAULT_CAP = 60;

/** The object name of one page file under `base`. */
export function pdfPageFileName(n: number, frame: PdfFrameKey | 'thumb'): string {
  return `p${n}-${frame}.webp`;
}

/** One frame as stored: what the player verifies against. */
export interface PdfFrameFactsJson {
  sha256: string;
  size: number;
}

/** One page as stored. `w`/`h` are the page's own painted size (its shape). */
export interface PdfPageJson {
  n: number;
  w: number;
  h: number;
  frames: Record<PdfFrameKey, PdfFrameFactsJson>;
}

/** The JSON written into `processingMeta.pdfPages`. */
export interface PdfPagesJson {
  version: typeof PDF_PAGES_VERSION;
  state: 'pending' | 'ready' | 'failed';
  count?: number;
  done?: number;
  base?: string;
  pages?: PdfPageJson[];
  truncatedAt?: number;
  error?: string;
  /** This PDF predates page rendering: a failure keeps it on screens as the PDF. */
  legacy?: true;
  updatedAt: string;
}

/** One frame as a reader sees it: a complete file description. */
export interface PdfFrameFile {
  url: string;
  sha256: string;
  size: number;
  width: number;
  height: number;
}

export interface PdfPage {
  n: number;
  width: number;
  height: number;
  frames: Record<PdfFrameKey, PdfFrameFile>;
  thumbUrl: string;
}

export interface PdfPages {
  state: 'pending' | 'ready' | 'failed';
  /** Pages in the source document, once known. */
  count: number | null;
  /** Pages made so far (pending), or made (ready). */
  done: number;
  /** Ready: every page with all four frames. Empty otherwise. */
  pages: PdfPage[];
  /** The cap, when the document has more pages than were made. */
  truncatedAt: number | null;
  /** Failed: a stable reason code. */
  error: string | null;
  legacy: boolean;
  updatedAt: string | null;
}

/** Stable reasons a PDF's pages could not be made. */
export type PdfPagesError =
  | 'pdf-password-protected'
  | 'pdf-unreadable'
  | 'pdf-empty'
  | 'pdf-too-large'
  | 'page-render-failed'
  | 'raster-budget-exceeded'
  | 'storage-failed'
  | 'invalid-record'
  | string;

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Read `processingMeta.pdfPages`. Null when there is none, or one this version
 * does not understand — i.e. "no pages", which every caller treats exactly as
 * before pages existed.
 *
 * A `ready` record is all-or-nothing: if ANY page lacks a frame, a hash or a
 * size, or the base is not an https URL, it reads as `failed` with
 * `invalid-record` — a half-written record must never make a screen's URL,
 * hash and size disagree.
 */
export function readPdfPages(meta: unknown): PdfPages | null {
  if (!isRecord(meta)) return null;
  const r = meta.pdfPages;
  if (!isRecord(r) || r.version !== PDF_PAGES_VERSION) return null;
  if (r.state !== 'pending' && r.state !== 'ready' && r.state !== 'failed') return null;
  const count = positiveInt(r.count);
  const legacy = r.legacy === true;
  const updatedAt = typeof r.updatedAt === 'string' ? r.updatedAt : null;
  const base: PdfPages = {
    state: r.state,
    count,
    done: 0,
    pages: [],
    truncatedAt: null,
    error: null,
    legacy,
    updatedAt,
  };
  if (r.state === 'pending') {
    return { ...base, done: Math.min(positiveInt(r.done) ?? 0, count ?? Number.MAX_SAFE_INTEGER) };
  }
  if (r.state === 'failed') {
    return { ...base, error: typeof r.error === 'string' && r.error ? r.error.slice(0, 80) : 'failed' };
  }
  const invalid: PdfPages = { ...base, state: 'failed', error: 'invalid-record' };
  const root = typeof r.base === 'string' ? r.base : '';
  if (!/^https:\/\/[^\s]+\/$/.test(root) || !Array.isArray(r.pages) || r.pages.length === 0) return invalid;
  const pages: PdfPage[] = [];
  const seen = new Set<number>();
  for (const raw of r.pages) {
    if (!isRecord(raw)) return invalid;
    const n = positiveInt(raw.n);
    const w = positiveInt(raw.w);
    const h = positiveInt(raw.h);
    if (!n || !w || !h || seen.has(n) || !isRecord(raw.frames)) return invalid;
    seen.add(n);
    const frames = {} as Record<PdfFrameKey, PdfFrameFile>;
    for (const spec of PDF_PAGE_FRAMES) {
      const f = raw.frames[spec.key];
      if (!isRecord(f) || typeof f.sha256 !== 'string' || !SHA256.test(f.sha256)) return invalid;
      const size = positiveInt(f.size);
      if (!size) return invalid;
      frames[spec.key] = {
        url: root + pdfPageFileName(n, spec.key),
        sha256: f.sha256,
        size,
        width: spec.width,
        height: spec.height,
      };
    }
    pages.push({ n, width: w, height: h, frames, thumbUrl: root + pdfPageFileName(n, 'thumb') });
  }
  pages.sort((a, b) => a.n - b.n);
  const truncatedAt = positiveInt(r.truncatedAt);
  return {
    ...base,
    count: count ?? pages.length,
    done: pages.length,
    pages,
    truncatedAt: truncatedAt && (count ?? 0) > pages.length ? truncatedAt : null,
  };
}

/** The slice of an asset row these decisions read. */
export interface PdfAsset {
  mimeType?: string | null;
  processingMeta?: unknown;
}

export function isPdfAsset(asset: PdfAsset | null | undefined): boolean {
  const m = (asset?.mimeType || '').toLowerCase();
  return m === 'application/pdf' || m === 'application/x-pdf';
}

/**
 * How the NORMAL manifest delivers this asset (never consulted by the
 * emergency or sports branches):
 *   'not-pdf'      — not a PDF: nothing here applies
 *   'as-uploaded'  — no pages record (a PDF from before pages, or pages
 *                    switched off), or a LEGACY PDF whose pages could not be
 *                    made: delivered exactly as before, as the PDF
 *   'pages'        — one image item per page
 *   'withhold'     — pages are still being made, or a new PDF's pages could not
 *                    be made: left out, like a video that is not ready
 */
export function pdfDelivery(asset: PdfAsset | null | undefined): 'not-pdf' | 'as-uploaded' | 'pages' | 'withhold' {
  if (!isPdfAsset(asset)) return 'not-pdf';
  const pages = readPdfPages(asset?.processingMeta);
  if (!pages) return 'as-uploaded';
  if (pages.state === 'ready') return 'pages';
  if (pages.state === 'failed' && pages.legacy) return 'as-uploaded';
  return 'withhold';
}

/** The frame a screen of this shape and size shows. */
export function pdfFrameKey(orientation: 'landscape' | 'portrait', small1080: boolean): PdfFrameKey {
  if (orientation === 'portrait') return small1080 ? 'portrait-1080' : 'portrait';
  return small1080 ? 'landscape-1080' : 'landscape';
}

/** Total seconds a PDF item plays: every page gets the item's duration. */
export function pdfPlaySeconds(pageCount: number, perPageMs: number): number {
  if (!(pageCount > 0) || !(perPageMs > 0)) return 0;
  return Math.round((pageCount * perPageMs) / 1000);
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
