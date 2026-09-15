/**
 * PDF parser — the BEST-EFFORT editable Import 2.0 path.
 *
 * Uses pdfjs-dist's LEGACY build (`pdfjs-dist/legacy/build/pdf.mjs`),
 * which runs headless in Node with no canvas / DOM. We call
 * `page.getTextContent()` to pull every text item with its position
 * (the affine `transform` matrix), font height, and string, then group
 * runs into editable TEXT zones by BOTH baseline proximity AND
 * horizontal adjacency.
 *
 * Each SOURCE page → one ParsedPage, whether or not it yielded a zone.
 *
 * Loaded via a dynamic import() because pdfjs-dist ships ESM and the
 * API is CommonJS; a static `import` would force the whole module
 * graph to ESM. The dynamic import is wrapped so a missing/broken
 * pdfjs install throws a clear error rather than crashing oddly.
 *
 * ── What the 2026-09-15 audit found here, and what changed ───────────
 *
 *  1. The doc-block above promised grouping "by baseline AND horizontal
 *     adjacency", but the code only tested baselines — so two columns
 *     sharing a baseline merged into one zone reading "Left column Right
 *     column". The adjacency test the comment described is now real.
 *  2. Device coordinates were approximated as `y = pageHeight - f`,
 *     which ignores the page's `/Rotate` and any crop box that does not
 *     start at (0,0). Positions now compose the item transform with the
 *     VIEWPORT transform, which carries both.
 *  3. A 3-page PDF whose middle page is artwork-only produced 2 pages
 *     and nothing said so; a 41-page PDF silently became 40. Every
 *     source page now gets a `ParsedPage` with a disposition, and the
 *     true page count rides on the document.
 */

import {
  type ParsedDocument,
  type ParsedPage,
  type ParsedZone,
  MAX_ACCOUNTED_PAGES,
  WarningSink,
  gradeDisposition,
} from './types';
import { clamp, matrixMultiply, matrixScale, ptToPx } from './units';

const MAX_PDF_PAGES = 40;
const MAX_ZONES_PER_PAGE = 80;
const MAX_TEXT_LEN = 5000;

/**
 * How far apart two runs on the same baseline must sit before we treat
 * them as SEPARATE text blocks, as a multiple of the taller run's glyph
 * height.
 *
 * A word space in ordinary body text is ~0.25em and justified tracking
 * rarely exceeds ~0.5em, while a column gutter is an em or more. 0.75em
 * sits above the one and below the other. The absolute floor keeps a
 * 6px footnote from splitting on a normal space.
 */
const COLUMN_GAP_EM = 0.75;
const COLUMN_GAP_FLOOR_PX = 4;

/** Below this gap we do not insert a space when joining two runs. */
const WORD_GAP_EM = 0.18;

/**
 * Lazily import the pdfjs legacy build. Returns null (caller throws)
 * if the dependency can't be loaded for any reason.
 */
async function loadPdfjs(): Promise<any> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs;
  } catch {
    try {
      // Older layouts expose the build at the package root.
      const pdfjs = await import('pdfjs-dist');
      return pdfjs;
    } catch {
      return null;
    }
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

function sanitizeText(raw: string): { text: string; truncated: boolean } {
  const cleaned = String(raw).replace(CONTROL_CHARS, '');
  return cleaned.length > MAX_TEXT_LEN
    ? { text: cleaned.slice(0, MAX_TEXT_LEN), truncated: true }
    : { text: cleaned, truncated: false };
}

interface RawItem {
  str: string;
  /** Left edge in DEVICE px (top-left origin, rotation + crop applied). */
  xPx: number;
  /** Baseline y in DEVICE px (top-left origin). */
  yPx: number;
  /** Glyph height in device px. */
  hPx: number;
  /** Advance width along the device x axis (absolute). */
  wPx: number;
  /** True when the run is whitespace only — a word-boundary marker. */
  blank: boolean;
  /** True when the run is not axis-aligned (rotated text object). */
  rotated: boolean;
}

/**
 * Group text items into blocks: items whose baseline y is within half a
 * line-height of each other AND which are horizontally adjacent become
 * one TEXT zone. Returns zones in reading order.
 *
 * The horizontal test is the fix for the audit's "Left column Right
 * column" merge. Without it, a two-column page — the most ordinary
 * layout a school hands us — collapses each row into one zone whose text
 * reads across the gutter.
 */
export function groupItemsIntoZones(
  items: RawItem[],
  canvasW: number,
  canvasH: number,
  onWarning?: (
    code: 'ZONES_TRUNCATED' | 'TEXT_TRUNCATED' | 'TEXT_ROTATED',
  ) => void,
): ParsedZone[] {
  if (items.length === 0) return [];

  // Sort top-to-bottom, then left-to-right.
  const sorted = [...items].sort((a, b) => a.yPx - b.yPx || a.xPx - b.xPx);

  // 1. Bucket into lines by baseline proximity.
  const lines: RawItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const refY = last[0].yPx;
      const tol = Math.max(last[0].hPx, it.hPx) * 0.6;
      if (Math.abs(it.yPx - refY) <= tol) {
        last.push(it);
        continue;
      }
    }
    lines.push([it]);
  }

  // 2. Split each line into horizontally-adjacent blocks.
  //
  // ⚠️ THE TRAP, measured on pdf.js 5: between two columns it emits an
  // explicit WHITESPACE run whose `width` spans the whole gutter (346pt
  // in the audit's own fixture) and whose `height` is 0. If that run is
  // treated as occupied space, the columns are touching and no gap test
  // can ever see the gutter — which is exactly why the previous
  // "adjacency" comment described a check the code could not have made
  // work. So the gap is measured CONTENT edge to CONTENT edge, and a
  // blank run only records that a word boundary exists.
  const blocks: RawItem[][] = [];
  for (const line of lines) {
    const parts = [...line].sort((a, b) => a.xPx - b.xPx);
    let current: RawItem[] = [];
    let lastContentRight = Number.NEGATIVE_INFINITY;
    let lastContentH = 0;
    for (const part of parts) {
      if (part.blank) {
        // Carries no glyphs: it is the gap, not a thing in the gap.
        if (current.length) current.push(part);
        continue;
      }
      if (
        current.length === 0 ||
        lastContentRight === Number.NEGATIVE_INFINITY
      ) {
        current.push(part);
        lastContentRight = part.xPx + part.wPx;
        lastContentH = part.hPx;
        continue;
      }
      const gap = part.xPx - lastContentRight;
      const threshold = Math.max(
        Math.max(part.hPx, lastContentH) * COLUMN_GAP_EM,
        COLUMN_GAP_FLOOR_PX,
      );
      if (gap > threshold) {
        blocks.push(current);
        current = [part];
      } else {
        current.push(part);
      }
      lastContentRight = Math.max(lastContentRight, part.xPx + part.wPx);
      lastContentH = part.hPx;
    }
    if (current.length) blocks.push(current);
  }

  // 3. Emit a zone per block, in reading order.
  blocks.sort((a, b) => a[0].yPx - b[0].yPx || a[0].xPx - b[0].xPx);

  const zones: ParsedZone[] = [];
  for (const block of blocks) {
    if (zones.length >= MAX_ZONES_PER_PAGE) {
      onWarning?.('ZONES_TRUNCATED');
      break;
    }
    const parts = block;

    // Join with a space only where the source has one — either an
    // explicit whitespace run or a real gap. Always spacing every run
    // turns "Wel"+"come" (a kerning split) into "Wel come".
    let joined = '';
    let prevRight = Number.NEGATIVE_INFINITY;
    let prevH = 0;
    for (const p of parts) {
      if (p.blank) {
        if (joined && !/\s$/.test(joined)) joined += ' ';
        prevRight = Math.max(prevRight, p.xPx + p.wPx);
        continue;
      }
      if (joined) {
        const gap = p.xPx - prevRight;
        const wordGap = Math.max(p.hPx, prevH) * WORD_GAP_EM;
        if (gap > wordGap && !/\s$/.test(joined)) joined += ' ';
      }
      joined += p.str;
      prevRight = p.xPx + p.wPx;
      prevH = p.hPx;
    }

    const sanitized = sanitizeText(joined.replace(/[ \t]+/g, ' '));
    if (sanitized.truncated) onWarning?.('TEXT_TRUNCATED');
    const text = sanitized.text.trim();
    if (!text) continue;
    if (parts.some((p) => p.rotated)) onWarning?.('TEXT_ROTATED');

    // Geometry comes from the runs that actually carry glyphs. A blank
    // run's box is meaningless (pdf.js reports height 0 and a width that
    // spans whatever gap it is filling) and would inflate both the zone
    // and its font size.
    const inked = parts.filter((p) => !p.blank);
    if (inked.length === 0) continue;
    const minX = Math.min(...inked.map((p) => p.xPx));
    const maxX = Math.max(...inked.map((p) => p.xPx + p.wPx));
    const h = Math.max(...inked.map((p) => p.hPx));
    // Baseline → top of the box: subtract ~0.85×height so the glyphs sit
    // inside the zone instead of hanging below the top edge.
    const topY = Math.min(...inked.map((p) => p.yPx - p.hPx * 0.85));

    const xPct = clamp((minX / canvasW) * 100, 0, 100);
    const yPct = clamp((topY / canvasH) * 100, 0, 100);
    // Give the box a little vertical breathing room (1.6× glyph height)
    // and never let it spill past the canvas edges.
    let wPct = clamp(((maxX - minX) / canvasW) * 100, 0.5, 100);
    let hPct = clamp(((h * 1.6) / canvasH) * 100, 0.5, 100);
    if (xPct + wPct > 100) wPct = 100 - xPct;
    if (yPct + hPct > 100) hPct = 100 - yPct;
    if (wPct <= 0.01 || hPct <= 0.01) continue;

    const round = (v: number) => Math.round(v * 10000) / 10000;
    zones.push({
      name: text.slice(0, 40),
      widgetType: 'TEXT',
      x: round(xPct),
      y: round(yPct),
      width: round(wPct),
      height: round(hPct),
      // Text sits ABOVE the page background image (zIndex 0).
      zIndex: zones.length + 1,
      defaultConfig: {
        content: text,
        // h is already a px glyph height; clamp to the same legible range.
        fontSize: Math.round(clamp(h, 8, 800)),
        alignment: 'left',
        // Transparent background so the page image shows through around
        // the glyphs — the operator can set a fill later if they want.
        bgColor: 'transparent',
      },
    });
  }
  return zones;
}

/**
 * Convert one pdf.js text item into a DEVICE-space RawItem.
 *
 * `viewportTransform` is `page.getViewport({scale:1}).transform`, which
 * already encodes the page rotation AND the crop-box origin; composing
 * it with the item's own text matrix is what makes a rotated or cropped
 * page land in the right place. Exported for unit tests — it is pure.
 */
export function toDeviceItem(
  item: {
    str?: unknown;
    width?: unknown;
    height?: unknown;
    transform?: unknown;
  },
  viewportTransform: ReadonlyArray<number>,
): RawItem | null {
  const str = typeof item?.str === 'string' ? item.str : '';
  if (!str.length) return null;
  const tr = item.transform as number[];
  if (!Array.isArray(tr) || tr.length < 6) return null;
  if (!tr.every((n) => Number.isFinite(n))) return null;

  const m = matrixMultiply(viewportTransform, tr);
  const x = m[4];
  const y = m[5];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // `item.width` / `item.height` are lengths in PDF USER space. The
  // viewport is a rotation plus a uniform scale, so one user unit is
  // `vScale` device px whichever way the page is turned.
  const vScale = matrixScale(viewportTransform[0], viewportTransform[1]) || 1;
  // Unit run direction in device space, from the composed matrix.
  const runLen = matrixScale(m[0], m[1]) || 1;
  const ux = m[0] / runLen;
  const uy = m[1] / runLen;

  const blank = !str.trim();
  // A blank run has no glyph height to speak of — pdf.js reports 0 —
  // and giving it the font-size fallback would let it dominate the
  // line-bucketing tolerance and the zone's font size.
  const hUser = blank
    ? Math.max(0, Number(item.height) || 0)
    : Number.isFinite(item.height) && (item.height as number) > 0
      ? (item.height as number)
      : ptToPx(Math.abs(tr[3]) || 12);
  const wUser =
    Number.isFinite(item.width) && (item.width as number) > 0
      ? (item.width as number)
      : str.length * hUser * 0.5;

  // Advance along the device x axis. The y component of the advance is
  // deliberately unused: the zone model is an axis-aligned box, and a
  // run whose advance has a y component is flagged `rotated` below
  // rather than described by a slanted rectangle we cannot express.
  const advX = wUser * vScale * ux;

  // Rotated WITHIN the page: after the viewport (which already absorbs
  // /Rotate) the run should still read along the device x axis. A run
  // that does not is a rotated text object, and an axis-aligned box is
  // only an approximation of where it sits.
  const rotated = !blank && Math.abs(uy) > 0.05;

  // Take the left edge and an absolute width, so a right-to-left device
  // direction still yields a sane rectangle.
  const left = advX < 0 ? x + advX : x;
  const width = Math.abs(advX) || Math.abs(wUser * vScale);

  return {
    str,
    xPx: left,
    yPx: y,
    hPx: hUser * vScale,
    wPx: width,
    blank,
    rotated,
  };
}

/**
 * Parse a PDF buffer into a ParsedDocument — one ParsedPage per SOURCE
 * page, including pages that yielded no text and pages the cap
 * excluded. Throws on a non-PDF / encrypted / corrupt file so the caller
 * can reject the upload rather than pretend it converted.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdfjs = await loadPdfjs();
  if (!pdfjs?.getDocument) {
    throw new Error('pdfjs-dist unavailable');
  }

  // Copy into a fresh Uint8Array — pdfjs transfers/neuters the buffer
  // it's handed, and the controller still needs the original bytes for
  // the Asset upload + hash.
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    // Headless safety: no eval, no external font/cmap fetches, no
    // worker (we're in Node). These keep parsing self-contained and
    // avoid the "fake worker" warnings spamming logs.
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
  });

  const doc = await loadingTask.promise;
  const pages: ParsedPage[] = [];
  const warn = new WarningSink();
  const sourcePageCount = Number(doc.numPages) || 0;
  const convertible = Math.min(sourcePageCount, MAX_PDF_PAGES);

  try {
    for (let i = 1; i <= sourcePageCount; i++) {
      if (pages.length >= MAX_ACCOUNTED_PAGES) break;

      if (i > convertible) {
        pages.push({
          sourcePage: i,
          label: `Page ${i}`,
          // Geometry of an unread page is unknown; mirror page 1 when we
          // have it so a caller rendering a placeholder gets the right
          // aspect, and fall back to 1080p otherwise.
          screenWidth: pages[0]?.screenWidth ?? 1920,
          screenHeight: pages[0]?.screenHeight ?? 1080,
          zones: [],
          disposition: 'excluded-by-limit',
          warnings: [],
        });
        continue;
      }

      const pageWarn = new WarningSink(40);
      let canvasW = 0;
      let canvasH = 0;
      let zones: ParsedZone[] = [];
      let page: any = null;

      try {
        page = await doc.getPage(i);
        // The viewport applies /Rotate and the crop box; its `transform`
        // maps PDF user space → device space with a top-left origin.
        const viewport = page.getViewport({ scale: 1 });
        canvasW = Math.round(viewport.width);
        canvasH = Math.round(viewport.height);
        const vt: number[] = Array.isArray(viewport.transform)
          ? viewport.transform
          : [1, 0, 0, -1, 0, canvasH];

        const textContent = await page.getTextContent();
        const items: RawItem[] = [];
        for (const item of textContent.items as any[]) {
          const converted = toDeviceItem(item, vt);
          if (converted) items.push(converted);
        }

        zones = groupItemsIntoZones(
          items,
          canvasW || 1,
          canvasH || 1,
          (code) => {
            if (code === 'ZONES_TRUNCATED') {
              pageWarn.add(
                'ZONES_TRUNCATED',
                `Page ${i} has more than ${MAX_ZONES_PER_PAGE} text blocks; the rest were not imported.`,
                i,
              );
            } else if (code === 'TEXT_TRUNCATED') {
              pageWarn.add(
                'TEXT_TRUNCATED',
                `A text block on page ${i} was longer than ${MAX_TEXT_LEN} characters and was cut short.`,
                i,
              );
            } else {
              pageWarn.add(
                'TEXT_ROTATED',
                `Rotated text on page ${i} was imported into an upright box.`,
                i,
              );
            }
          },
        );
      } catch {
        pageWarn.add(
          'PAGE_UNREADABLE',
          `Page ${i} could not be read and was not imported.`,
          i,
        );
      } finally {
        // Free per-page resources promptly on large decks (best-effort —
        // the API surface varies across pdfjs minor versions).
        try {
          if (page && typeof page.cleanup === 'function') page.cleanup();
        } catch {
          /* ignore */
        }
      }

      if (zones.length === 0 && !pageWarn.length) {
        pageWarn.add(
          'PAGE_EMPTY',
          `Page ${i} has no extractable text (it may be artwork or a scan).`,
          i,
        );
      }

      const warnings = pageWarn.list();
      pages.push({
        sourcePage: i,
        label: `Page ${i}`,
        screenWidth: canvasW || 1920,
        screenHeight: canvasH || 1080,
        zones,
        disposition: gradeDisposition(zones.length, warnings),
        warnings,
      });
    }
  } finally {
    // Always release the document + worker. In pdfjs 6 the teardown
    // lives on the loadingTask (`destroy()`); the document proxy exposes
    // `cleanup()`, not `destroy()`. Call whichever exists so we don't
    // leak the worker (and don't throw on a version that lacks one).
    try {
      if (typeof loadingTask?.destroy === 'function') {
        await loadingTask.destroy();
      } else if (typeof doc?.destroy === 'function') {
        await doc.destroy();
      } else if (typeof doc?.cleanup === 'function') {
        doc.cleanup();
      }
    } catch {
      /* ignore teardown errors */
    }
  }

  if (sourcePageCount > MAX_PDF_PAGES) {
    warn.add(
      'PAGES_TRUNCATED',
      `This PDF has ${sourcePageCount} pages; only the first ${MAX_PDF_PAGES} were converted.`,
    );
  }
  if (sourcePageCount > MAX_ACCOUNTED_PAGES) {
    warn.add(
      'PAGES_TRUNCATED',
      `Only the first ${MAX_ACCOUNTED_PAGES} pages are listed individually.`,
    );
  }

  return { pages, media: [], sourcePageCount, warnings: warn.list() };
}

export {
  MAX_PDF_PAGES,
  MAX_ZONES_PER_PAGE,
  MAX_TEXT_LEN,
  COLUMN_GAP_EM,
  COLUMN_GAP_FLOOR_PX,
};
export type { RawItem };
