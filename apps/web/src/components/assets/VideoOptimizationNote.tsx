'use client';

/**
 * One quiet line about a video's signage transcode (2026-09-23):
 *   queued/running → "Optimizing for screens… 42%"
 *   done           → "Optimized −78%"  (card/row) · "1.4 GB → 312 MB (saved 1.1 GB)" (detail)
 *   skipped/failed → nothing on a card; an honest sentence in the detail panel
 *
 * The media library's §11 rule holds: tiles only carry what changes what the
 * operator can do or know at a glance — so a finished job that saved nothing
 * says nothing on the card.
 */
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { isOptimizing, savedPercent, type VideoOptimization } from '@/hooks/use-video-optimization';

export function VideoOptimizationNote({
  optimization,
  variant,
  fmtSize,
}: {
  optimization: VideoOptimization | null;
  variant: 'card' | 'row' | 'detail';
  fmtSize: (bytes: number | null | undefined) => string;
}) {
  const t = useTranslations('assetsLib');
  const o = optimization;
  if (!o) return null;

  if (isOptimizing(o)) {
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

  const saved = savedPercent(o);
  if (variant !== 'detail') {
    if (saved === null) return null;
    return (
      <span className="inline-flex text-[10px] font-bold text-emerald-700" data-testid="video-optimized">
        {t('optimizedChip', { pct: saved })}
      </span>
    );
  }

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
