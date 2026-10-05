'use client';

/**
 * One quiet line about a PDF's pages (2026-10-05, PDF pages on screens).
 *
 * Screens are handed a PDF as one picture per page, made on our side after the
 * upload. The Media Library says where that stands, in the words of
 * `lib/pdf-pages-copy.ts` (which reads the record exactly as the manifest does):
 *   preparing → "Preparing pages… 7 of 12" (screens skip it until then)
 *   ready     → "12 pages" · capped: "Showing the first 60 of 214 pages"
 *   failed    → "This PDF can't be shown on screens: <reason>". A PDF from
 *               before pages existed is still handed to screens as the PDF (no
 *               Android player can draw it), so it is marked the same way.
 * Renders nothing for anything that is not a PDF with a pages record.
 */
import { useTranslations } from 'next-intl';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { pdfFailedSentence, pdfPagesStatusOf, type PdfPagesAsset } from '@/lib/pdf-pages-copy';

export function PdfPagesNote({
  asset,
  variant,
}: {
  asset: PdfPagesAsset | null | undefined;
  variant: 'card' | 'row' | 'detail';
}) {
  const t = useTranslations();
  const s = pdfPagesStatusOf(asset);
  if (!s) return null;
  const small = variant !== 'detail';

  if (s.kind === 'preparing') {
    const words = s.count
      ? t('assetsLib.pdfPages.preparing', { done: s.done, count: s.count })
      : t('assetsLib.pdfPages.preparingUnknown');
    return (
      <span
        className={`inline-flex items-start gap-1 font-semibold text-violet-700 ${small ? 'text-[11px]' : 'text-xs'}`}
        data-testid="pdf-pages-preparing"
        aria-live="polite"
        title={t('assetsLib.pdfPages.preparingDetail')}
      >
        <Loader2 className="w-3 h-3 mt-px shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        <span>{variant === 'detail' ? `${words} — ${t('assetsLib.pdfPages.preparingDetail')}` : words}</span>
      </span>
    );
  }

  if (s.kind === 'failed') {
    // A PDF from before pages existed is still handed to screens as the PDF —
    // which an Android player cannot draw — so it is marked the same way; the
    // details add that desktop players may still show it.
    const sentence = s.legacy
      ? `${pdfFailedSentence(t, s.reason)} ${t('assetsLib.pdfPages.legacyFailed')}`
      : pdfFailedSentence(t, s.reason);
    return (
      <span
        className={`inline-flex items-start gap-1 font-semibold text-rose-700 ${small ? 'text-[11px]' : 'text-xs'}`}
        data-testid="pdf-pages-failed"
        title={sentence}
      >
        <AlertTriangle className="w-3 h-3 mt-px shrink-0" aria-hidden />
        <span>{variant === 'detail' ? sentence : t('assetsLib.pdfPages.failedShort')}</span>
        {variant !== 'detail' && <span className="sr-only">: {sentence}</span>}
      </span>
    );
  }

  const words = s.truncated
    ? t('assetsLib.pdfPages.truncated', { pages: s.pages, count: s.count })
    : t('assetsLib.pdfPages.ready', { pages: s.pages });
  return (
    <span
      className={`inline-flex items-start gap-1 ${s.truncated ? 'text-amber-800 font-semibold' : 'text-slate-500'} ${small ? 'text-[11px]' : 'text-xs'}`}
      data-testid="pdf-pages-ready"
    >
      <FileText className="w-3 h-3 mt-px shrink-0" aria-hidden />
      <span>{variant === 'detail' ? `${words} — ${t('assetsLib.pdfPages.readyDetail')}` : words}</span>
    </span>
  );
}
