/**
 * A PDF item in the NORMAL manifest, as pictures (2026-10-05, PDF pages on
 * screens). Pure — no Prisma, no Nest — so the manifest's rules can be tested
 * without the 7k-line controller.
 *
 * A playlist item whose asset is a PDF with pages (`processingMeta.pdfPages`,
 * `@cms/api-types` pdf-pages.ts) becomes one IMAGE item per page:
 *   • `item_id` `${item.id}#p${n}` — stable across polls, unique per page, and
 *     never a real PlaylistItem id (a `#` never appears in a uuid);
 *   • the SAME `asset_id`, so anything keyed on the asset still finds it;
 *   • the page frame's own url / hash / size, so precache, readiness gating and
 *     hash verification treat it as the ordinary image it is;
 *   • the item's duration on EVERY page — an operator who set 10 s meant
 *     "10 seconds per page";
 *   • the item's own sequence on every page; the player's sort is stable, so
 *     the pages keep the order they are listed in here.
 * Which frame: the screen's orientation, the 1080 frame on a 1080p screen —
 * the same "is this a 1080p screen" rule `selectVideoFile` uses.
 *
 * The emergency and sports-scoreboard branches never call this: alert media is
 * delivered exactly as it always was.
 */
import {
  PDF_PAGE_MIME,
  pdfFrameKey,
  readPdfPages,
  type PdfFrameKey,
} from '@cms/api-types';

/** The facts about a screen that decide which frame it gets. */
export interface PdfScreenShape {
  orientation: 'landscape' | 'portrait';
  small1080: boolean;
}

/**
 * Landscape or portrait, and 1080p or not.
 *
 * Orientation: an explicit LED canvas wins (it IS the drawing surface);
 * otherwise the orientation the manifest hands the player
 * (`resolveManifestOrientation` — the operator's choice, the chassis, then the
 * panel); for AUTO, the reported resolution; unknown → landscape.
 * 1080p: the reported resolution fits 1920×1080 in either orientation.
 */
export function pdfScreenShape(screen: {
  resolution?: string | null;
  canvasW?: number | null;
  canvasH?: number | null;
  /** `resolveManifestOrientation(...)` for this screen. */
  manifestOrientation: 'LANDSCAPE' | 'PORTRAIT' | 'AUTO';
}): PdfScreenShape {
  const dims = parseResolution(screen.resolution);
  const small1080 = !!dims && Math.max(dims.w, dims.h) <= 1920 && Math.min(dims.w, dims.h) <= 1080;
  const cw = Number(screen.canvasW);
  const ch = Number(screen.canvasH);
  let orientation: 'landscape' | 'portrait';
  if (Number.isFinite(cw) && Number.isFinite(ch) && cw > 0 && ch > 0) {
    orientation = ch > cw ? 'portrait' : 'landscape';
  } else if (screen.manifestOrientation === 'PORTRAIT') {
    orientation = 'portrait';
  } else if (screen.manifestOrientation === 'LANDSCAPE') {
    orientation = 'landscape';
  } else {
    orientation = dims && dims.h > dims.w ? 'portrait' : 'landscape';
  }
  return { orientation, small1080 };
}

/** The manifest item fields a page shares with its playlist item. */
export interface PdfItemSource {
  id: string;
  assetId: string;
  durationMs: number;
  sequenceOrder: number;
  transitionType?: string | null;
  asset: { mimeType?: string | null; processingMeta?: unknown };
}

/** One manifest item per page, or [] when the asset has no ready pages. */
export function pdfPageManifestItems(
  pi: PdfItemSource,
  shape: PdfScreenShape,
  muted: boolean,
): Array<Record<string, unknown>> {
  const pages = readPdfPages(pi.asset.processingMeta);
  if (!pages || pages.state !== 'ready') return [];
  const key: PdfFrameKey = pdfFrameKey(shape.orientation, shape.small1080);
  return pages.pages.map((page) => {
    const frame = page.frames[key];
    return {
      item_id: `${pi.id}#p${page.n}`,
      asset_id: pi.assetId,
      asset_hash: frame.sha256,
      asset_size: frame.size,
      url: frame.url,
      duration_ms: pi.durationMs,
      sequence: pi.sequenceOrder,
      mime_type: PDF_PAGE_MIME,
      transition_type: pi.transitionType ?? null,
      muted,
    };
  });
}

/** Bytes a screen downloads for this PDF item (the frames it is handed). */
export function pdfPageBytes(pi: PdfItemSource, shape: PdfScreenShape): number {
  const pages = readPdfPages(pi.asset.processingMeta);
  if (!pages || pages.state !== 'ready') return 0;
  const key = pdfFrameKey(shape.orientation, shape.small1080);
  return pages.pages.reduce((sum, p) => sum + p.frames[key].size, 0);
}

function parseResolution(resolution: string | null | undefined): { w: number; h: number } | null {
  const m = /^\s*(\d{2,6})\s*[x×X*]\s*(\d{2,6})\s*$/.exec(typeof resolution === 'string' ? resolution : '');
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}
