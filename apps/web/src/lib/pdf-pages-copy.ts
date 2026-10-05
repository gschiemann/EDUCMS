/**
 * "What do the screens show for this PDF?" — the dashboard's reading of
 * `processingMeta.pdfPages` (2026-10-05, PDF pages on screens).
 *
 * The record is read with `readPdfPages` from `@cms/api-types` — the SAME
 * function the API's normal manifest uses (`pdfDelivery`), so what the library
 * says is exactly what the screens are handed:
 *
 *   preparing — the pages are being made; screens skip the PDF until they
 *               exist ("Preparing pages… 7 of 12");
 *   ready     — screens show one picture per page ("12 pages"); a capped
 *               document says how many it is NOT showing ("showing the first 60
 *               of 214 pages");
 *   failed    — no pages could be made ("This PDF can't be shown on screens:
 *               <reason>"). A new PDF is on no screen; one from before pages
 *               existed is still handed over as the PDF, which only a desktop
 *               browser can draw — so it is marked the same way;
 *   null      — not a PDF, or a PDF from before pages existed: nothing to add.
 */
import { pdfPlaySeconds, readPdfPages, isPdfAsset } from '@cms/api-types';

export type PdfFailureReason = 'password' | 'unreadable' | 'tooLarge' | 'other';

export type PdfPagesStatus =
  | { kind: 'preparing'; done: number; count: number | null }
  | { kind: 'ready'; pages: number; count: number; truncated: boolean }
  | { kind: 'failed'; reason: PdfFailureReason; legacy: boolean };

/** The slice of an asset row this module reads. */
export interface PdfPagesAsset {
  mimeType?: string | null;
  processingMeta?: unknown;
}

export function pdfFailureReason(error: string | null | undefined): PdfFailureReason {
  if (error === 'pdf-password-protected') return 'password';
  if (error === 'pdf-unreadable' || error === 'pdf-empty' || error === 'page-render-failed' || error === 'invalid-record') {
    return 'unreadable';
  }
  if (error === 'pdf-too-large' || error === 'raster-budget-exceeded') return 'tooLarge';
  return 'other';
}

export function pdfPagesStatusOf(asset: PdfPagesAsset | null | undefined): PdfPagesStatus | null {
  if (!isPdfAsset(asset)) return null;
  const r = readPdfPages(asset?.processingMeta);
  if (!r) return null;
  if (r.state === 'pending') return { kind: 'preparing', done: r.done, count: r.count };
  if (r.state === 'ready') {
    const count = r.count ?? r.pages.length;
    return { kind: 'ready', pages: r.pages.length, count, truncated: count > r.pages.length };
  }
  return { kind: 'failed', reason: pdfFailureReason(r.error), legacy: r.legacy };
}

/** Is the library still waiting for this PDF's pages? (drives its 5 s poll) */
export const PDF_PAGES_POLL_WINDOW_MS = 20 * 60 * 1000;
export function pdfPagesMayStillLand(asset: PdfPagesAsset | null | undefined, now: number = Date.now()): boolean {
  if (!isPdfAsset(asset)) return false;
  const r = readPdfPages(asset?.processingMeta);
  if (!r || r.state !== 'pending') return false;
  const at = r.updatedAt ? new Date(r.updatedAt).getTime() : NaN;
  // A record nobody has written for a long while is not going to land in the
  // next five seconds; the server's sweep picks it up — stop polling for it.
  return Number.isFinite(at) && now - at < PDF_PAGES_POLL_WINDOW_MS;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The plain sentence for a PDF that cannot be shown, translated. */
export function pdfFailedSentence(t: Translate, reason: PdfFailureReason): string {
  return t('assetsLib.pdfPages.failed', { reason: t(`assetsLib.pdfPages.reason.${reason}`) });
}

/** "2 min" / "45 s" / "1 h 5 min" — how long a PDF item runs on a screen. */
export function fmtPlayTime(t: Translate, seconds: number): string {
  if (seconds < 60) return t('assetsLib.pdfPages.seconds', { n: seconds });
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return t('assetsLib.pdfPages.minutes', { n: Math.max(1, m) });
  return t('assetsLib.pdfPages.hoursMinutes', { h, m });
}

/**
 * The playlist editor's line for a PDF item: "12 pages · 10 s each = 2 min",
 * or what is happening instead. Null for anything that is not a PDF with a
 * pages record.
 */
export function pdfItemLine(t: Translate, asset: PdfPagesAsset | null | undefined, durationMs: number): string | null {
  const s = pdfPagesStatusOf(asset);
  if (!s) return null;
  if (s.kind === 'preparing') {
    return s.count
      ? t('assetsLib.pdfPages.preparing', { done: s.done, count: s.count })
      : t('assetsLib.pdfPages.preparingUnknown');
  }
  if (s.kind === 'failed') return t('assetsLib.pdfPages.failedShort');
  const each = Math.max(1, Math.round((durationMs || 10_000) / 1000));
  return t('assetsLib.pdfPages.itemLine', {
    pages: s.pages,
    each,
    total: fmtPlayTime(t, pdfPlaySeconds(s.pages, durationMs || 10_000)),
  });
}
