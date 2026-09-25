'use client';

/**
 * One quiet line about a video's signage transcode (2026-09-23):
 *   queued/running → "Optimizing for screens… 42%"
 *   done           → details only: "1.4 GB → 312 MB (saved 1.1 GB)"
 *   skipped/failed → nothing on a card; an honest sentence in the detail panel
 *
 * Previews carry only active progress. Completed optimization belongs in
 * file details, where savings cannot be mistaken for unfinished progress.
 */
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { isOptimizing, savedPercent, type VideoOptimization } from '@/hooks/use-video-optimization';

export function VideoOptimizationNote({
  optimization,
  rendition,
  variant,
  fmtSize,
}: {
  optimization: VideoOptimization | null;
  rendition?: { url?: string; sha256?: string; width?: number; height?: number; size?: number } | null;
  variant: 'card' | 'row' | 'detail';
  fmtSize: (bytes: number | null | undefined) => string;
}) {
  const t = useTranslations('assetsLib');
  const o = optimization;
  const copyReady = !!rendition && typeof rendition.url === 'string' && rendition.url.startsWith('https://') &&
    typeof rendition.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rendition.sha256) &&
    Number.isFinite(rendition.width) && Number.isFinite(rendition.height) &&
    Number.isFinite(rendition.size) && (rendition.size ?? 0) > 0;
  if (!o && !(variant === 'detail' && copyReady)) return null;

  if (o && isOptimizing(o)) {
    const pct = o.status === 'running' && typeof o.progress === 'number' ? o.progress : null;
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700"
        data-testid="video-optimizing"
        aria-live="polite"
      >
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
        {pct !== null ? t('optimizingPct', { pct }) : t('optimizing')}
      </span>
    );
  }

  if (variant !== 'detail') return null;
  if (copyReady) {
    const saved = o?.reason !== 'rendition-created' ? savedPercent(o) : null;
    return (
      <span className="block text-xs font-semibold text-slate-800" data-testid="video-rendition-ready">
        <span className="block">{t('playbackCopyReady', { width: rendition.width!, height: rendition.height!, size: fmtSize(rendition.size) })}</span>
        {saved !== null && o && <span className="block mt-1 font-normal text-slate-600">{t('optimizedDetail', {
          from: fmtSize(o.sourceBytes), to: fmtSize(o.outputBytes),
          saved: fmtSize((o.sourceBytes ?? 0) - (o.outputBytes ?? 0)),
        })}</span>}
      </span>
    );
  }
  if (!o) return null;
  if (o.reason === 'rendition-created') {
    return <span className="text-xs text-slate-600">{t('playbackCopyChecking')}</span>;
  }
  const saved = savedPercent(o);
  if (saved !== null) {
    return (
      <span className="text-xs font-semibold text-slate-800" data-testid="video-optimized-detail">
        {t('optimizedDetail', {
          from: fmtSize(o.sourceBytes),
          to: fmtSize(o.outputBytes),
          saved: fmtSize((o.sourceBytes ?? 0) - (o.outputBytes ?? 0)),
        })}
      </span>
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
  if (!message) return null;
  return (
    <span className="text-xs text-slate-600" data-testid="video-optimization-kept">
      {message}
    </span>
  );
}
