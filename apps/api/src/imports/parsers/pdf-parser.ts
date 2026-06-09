/**
 * PDF parser — the BEST-EFFORT editable Import 2.0 path.
 *
 * Uses pdfjs-dist's LEGACY build (`pdfjs-dist/legacy/build/pdf.mjs`),
 * which runs headless in Node with no canvas / DOM. We call
 * `page.getTextContent()` to pull every text item with its position
 * (the affine `transform` matrix), font height, and string, then group
 * runs that sit on the same baseline into one editable TEXT zone.
 *
 * Each page → one ParsedPage. The controller additionally keeps the
 * original PDF as a full-bleed background (zIndex 0) UNDER the editable
 * text so the visual fidelity is preserved while the text is editable
 * on top — see imports.controller for that composition.
 *
 * Loaded via a dynamic import() because pdfjs-dist ships ESM and the
 * API is CommonJS; a static `import` would force the whole module
 * graph to ESM. The dynamic import is wrapped so a missing/broken
 * pdfjs install degrades to the legacy single-image template rather
 * than crashing the endpoint.
 */

import type { ParsedDocument, ParsedPage, ParsedZone } from './types';
import { clamp, ptToPx } from './units';

const MAX_PDF_PAGES = 40;
const MAX_ZONES_PER_PAGE = 80;
const MAX_TEXT_LEN = 5000;

/**
 * Lazily import the pdfjs legacy build. Returns null (caller falls
 * back) if the dependency can't be loaded for any reason.
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
function sanitizeText(raw: string): string {
  return String(raw).replace(CONTROL_CHARS, '').slice(0, MAX_TEXT_LEN);
}

interface RawItem {
  str: string;
  /** x in px (top-left origin). */
  xPx: number;
  /** y in px (top-left origin, baseline). */
  yPx: number;
  /** approximate glyph height in px. */
  hPx: number;
  /** approximate advance width in px. */
  wPx: number;
}

/**
 * Group text items into line-blocks: items whose baseline y is within
 * half a line-height of each other and that are horizontally adjacent
 * become one TEXT zone. Returns zones in reading order.
 */
function groupItemsIntoZones(
  items: RawItem[],
  canvasW: number,
  canvasH: number,
): ParsedZone[] {
  if (items.length === 0) return [];

  // Sort top-to-bottom, then left-to-right.
  const sorted = [...items].sort((a, b) => a.yPx - b.yPx || a.xPx - b.xPx);

  // Bucket into lines by baseline proximity.
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

  const zones: ParsedZone[] = [];
  for (const line of lines) {
    if (zones.length >= MAX_ZONES_PER_PAGE) break;
    const parts = line.sort((a, b) => a.xPx - b.xPx);
    // Join with single spaces, collapsing runs that already include them.
    const text = sanitizeText(
      parts
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' '),
    ).trim();
    if (!text) continue;

    const minX = Math.min(...parts.map((p) => p.xPx));
    const maxX = Math.max(...parts.map((p) => p.xPx + p.wPx));
    const h = Math.max(...parts.map((p) => p.hPx));
    // Baseline → top of the box: subtract ~0.8×height so the glyphs sit
    // inside the zone instead of hanging below the top edge.
    const topY = Math.min(...parts.map((p) => p.yPx - p.hPx * 0.85));

    const xPct = clamp((minX / canvasW) * 100, 0, 100);
    const yPct = clamp((topY / canvasH) * 100, 0, 100);
    // Give the box a little vertical breathing room (1.5× glyph height)
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
 * Parse a PDF buffer into a ParsedDocument (one ParsedPage per page,
 * text-only zones). Throws on a non-PDF / encrypted / corrupt file so
 * the controller falls back to the legacy single-image template.
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
  const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);

  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const canvasW = Math.round(viewport.width);
      const canvasH = Math.round(viewport.height);

      const textContent = await page.getTextContent();
      const items: RawItem[] = [];
      for (const item of textContent.items as any[]) {
        const str = typeof item?.str === 'string' ? item.str : '';
        if (!str.trim()) continue;
        const tr = item.transform as number[]; // [a,b,c,d,e,f]
        if (!Array.isArray(tr) || tr.length < 6) continue;
        const eX = tr[4];
        const fY = tr[5];
        if (!Number.isFinite(eX) || !Number.isFinite(fY)) continue;
        // pdfjs item.height/width are already in user-space px at
        // scale=1; fall back to the matrix scale if absent.
        const hPx =
          Number.isFinite(item.height) && item.height > 0
            ? item.height
            : ptToPx(Math.abs(tr[3]) || 12);
        const wPx =
          Number.isFinite(item.width) && item.width > 0
            ? item.width
            : str.length * hPx * 0.5;
        // PDF origin is bottom-left; flip y to a top-left origin.
        const yTop = canvasH - fY;
        items.push({ str, xPx: eX, yPx: yTop, hPx, wPx });
      }

      const zones = groupItemsIntoZones(items, canvasW, canvasH);
      pages.push({
        label: `Page ${i}`,
        screenWidth: canvasW || 1920,
        screenHeight: canvasH || 1080,
        zones,
      });

      // Free per-page resources promptly on large decks (best-effort —
      // the API surface varies across pdfjs minor versions).
      try {
        if (typeof page.cleanup === 'function') page.cleanup();
      } catch {
        /* ignore */
      }
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

  return { pages, media: [] };
}

export { MAX_PDF_PAGES, MAX_ZONES_PER_PAGE };
