'use client';

/**
 * One quiet line about a video's signage transcode (2026-09-23):
 *   queued/running → "Optimizing for screens… 42%"
 *   done           → details only: "1.4 GB → 312 MB (saved 1.1 GB)"
 *   skipped/failed → nothing on a card; an honest sentence in the detail panel
 *
 * Previews carry only active progress. Completed optimization belongs in
 * file details, where savings cannot be mistaken for unfinished progress.
 *
 * 2026-10-05 — THE SCREEN-READY VERDICT (`screen`, from
 * lib/screen-readiness-copy.ts) decides the words whenever it has something to
 * say, because it is what the screens act on: a video that is converting or
 * failed to convert is NOT being handed to any screen.
 *   converting → card "Converting for screens… 42%"; detail "Converting for
 *                screens — it will start playing when the copy is ready · 42%"
 *   failed     → card "Can't play on screens" (a visible warning); detail the
 *                plain reason and what to do (export MP4 / H.264, upload again)
 *   converted  → detail "Converted for screens (was H.265 / HEVC / HDR)."
 * Without `screen` (or with nothing to say) every line below is exactly what
 * it was.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { isOptimizing, savedPercent, type VideoOptimization } from '@/hooks/use-video-optimization';
import {
  convertedFromLabel,
  screenFailedSentence,
  type ScreenReadiness,
} from '@/lib/screen-readiness-copy';

export function VideoOptimizationNote({
  optimization,
  rendition,
  variant,
  fmtSize,
  screen = null,
}: {
  optimization: VideoOptimization | null;
  rendition?: { url?: string; sha256?: string; width?: number; height?: number; size?: number } | null;
  variant: 'card' | 'row' | 'detail';
  fmtSize: (bytes: number | null | undefined) => string;
  /** What the screens make of this video (`screenReadinessOf`). */
  screen?: ScreenReadiness | null;
}) {
  const t = useTranslations('assetsLib');
  const tRoot = useTranslations();
  const o = optimization;

  // ── The screen-ready verdict first: it is what the screens act on. ──
  if (screen?.kind === 'converting') {
    const pct = screen.progress;
    if (variant === 'detail') {
      return (
        <span
          className="flex items-start gap-1.5 text-xs font-semibold text-violet-800"
          data-testid="screen-converting"
          aria-live="polite"
        >
          <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          <span>
            {pct !== null
              ? t('screenReady.convertingDetailPct', { pct })
              : t('screenReady.convertingDetail')}
          </span>
        </span>
      );
    }
    return (
      // items-start: on a narrow card the words wrap, and the mark stays on the first line.
      <span
        className="inline-flex items-start gap-1 text-[11px] font-semibold text-violet-700"
        data-testid="screen-converting"
        aria-live="polite"
        title={t('screenReady.convertingDetail')}
      >
        <Loader2 className="w-3 h-3 mt-px shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        {screen.queued
          ? t('screenReady.convertingQueued')
          : pct !== null
            ? t('screenReady.convertingCardPct', { pct })
            : t('screenReady.convertingCard')}
      </span>
    );
  }
  if (screen?.kind === 'failed') {
    const sentence = screenFailedSentence(tRoot, screen);
    if (variant === 'detail') {
      return (
        <span className="flex items-start gap-1.5 text-xs font-semibold text-rose-800" data-testid="screen-convert-failed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-600" aria-hidden />
          <span>{sentence}</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-start gap-1 text-[11px] font-bold text-rose-700"
        data-testid="screen-cant-play"
        title={sentence}
      >
        <AlertTriangle className="w-3 h-3 mt-px shrink-0" aria-hidden />
        {t('screenReady.failedCard')}
        <span className="sr-only">: {sentence}</span>
      </span>
    );
  }
  const converted =
    variant === 'detail' && screen?.kind === 'converted' ? convertedFromLabel(tRoot, screen) : '';
  const convertedLine = converted ? (
    <span className="flex items-start gap-1.5 text-xs font-semibold text-emerald-800" data-testid="screen-converted">
      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" aria-hidden />
      <span>{t('screenReady.converted', { from: converted })}</span>
    </span>
  ) : null;

  const copyReady = !!rendition && typeof rendition.url === 'string' && rendition.url.startsWith('https://') &&
    typeof rendition.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rendition.sha256) &&
    Number.isFinite(rendition.width) && Number.isFinite(rendition.height) &&
    Number.isFinite(rendition.size) && (rendition.size ?? 0) > 0;
  if (!o && !(variant === 'detail' && copyReady)) return convertedLine;

  if (o && isOptimizing(o)) {
    const pct = o.status === 'running' && typeof o.progress === 'number' ? o.progress : null;
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700"
        data-testid="video-optimizing"
        aria-live="polite"
      >
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
        {o.status === 'queued' ? t('optimizationQueued') : pct !== null ? t('optimizingPct', { pct }) : t('optimizationChecking')}
      </span>
    );
  }

  if (variant !== 'detail') return null;
  const withConverted = (node: ReactNode) =>
    convertedLine ? (
      <span className="block space-y-1.5">
        {convertedLine}
        <span className="block leading-snug">{node}</span>
      </span>
    ) : (
      node
    );
  if (copyReady) {
    const saved = o?.reason !== 'rendition-created' ? savedPercent(o) : null;
    return withConverted(
      <span className="block text-xs font-semibold text-slate-800" data-testid="video-rendition-ready">
        <span className="block">{t('playbackCopyReady', { width: rendition.width!, height: rendition.height!, size: fmtSize(rendition.size) })}</span>
        {saved !== null && o && <span className="block mt-1 font-normal text-slate-600">{t('optimizedDetail', {
          from: fmtSize(o.sourceBytes), to: fmtSize(o.outputBytes),
          saved: fmtSize((o.sourceBytes ?? 0) - (o.outputBytes ?? 0)),
        })}</span>}
      </span>,
    );
  }
  if (!o) return convertedLine;
  if (o.reason === 'rendition-created') {
    return withConverted(<span className="text-xs text-slate-600">{t('playbackCopyChecking')}</span>);
  }
  const saved = savedPercent(o);
  if (saved !== null) {
    return withConverted(
      <span className="text-xs font-semibold text-slate-800" data-testid="video-optimized-detail">
        {t('optimizedDetail', {
          from: fmtSize(o.sourceBytes),
          to: fmtSize(o.outputBytes),
          saved: fmtSize((o.sourceBytes ?? 0) - (o.outputBytes ?? 0)),
        })}
      </span>,
    );
  }
  const reason = o.reason || '';
  const message =
    reason === 'emergency-content'
      ? t('optimizeEmergency')
      : reason === 'already-optimal'
        ? t('optimizeKept')
        : reason === 'not-smaller'
          ? t('optimizeNotSmaller')
          : o.status === 'failed'
            ? t('optimizeFailed')
            : null;
  if (!message) return convertedLine;
  return withConverted(
    <span className="text-xs text-slate-600" data-testid="video-optimization-kept">
      {message}
    </span>,
  );
}
