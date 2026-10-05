'use client';

/**
 * A video that the screens are NOT playing, marked where it is scheduled
 * (2026-10-05, the screen-ready gate).
 *
 * The manifest leaves out a video stamped not screen-ready — still converting
 * (HEVC, HDR, 60 fps, WebM … are converted first) or its conversion failed —
 * so a playlist can hold an item that no screen is showing. The playlist
 * editor must say so, or an operator is surprised that a screen skips it:
 *   converting → "Not playing yet — converting"
 *   failed     → "Can't play on screens"
 * The hover text is the full sentence (what happens next / what to do). It
 * reads `processingMeta.screen` through the same `readScreenStamp` the API's
 * gate uses, so the mark and the screens can never disagree. Renders nothing
 * for a video that plays (ready, converted, or no verdict) and for non-videos.
 */
import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock } from 'lucide-react';
import {
  screenFailedSentence,
  screenReadinessOf,
  type ScreenReadinessAsset,
} from '@/lib/screen-readiness-copy';

const INK = {
  converting: {
    inline: 'bg-violet-50 text-violet-800 border border-violet-200',
    onImage: 'bg-slate-900/75 text-violet-200',
  },
  failed: {
    inline: 'bg-rose-50 text-rose-800 border border-rose-200',
    onImage: 'bg-slate-900/75 text-rose-300',
  },
} as const;

export function ScreenReadinessPill({
  asset,
  variant = 'inline',
  className = '',
}: {
  asset: ScreenReadinessAsset | null | undefined;
  /**
   * `onImage`: a dark chip legible over a thumbnail, with the SHORT words (a
   * picker tile is ~150 px wide on a phone). `inline`: a tinted chip in a row.
   * Either way the full sentence is the hover text and the screen-reader text.
   */
  variant?: 'inline' | 'onImage';
  className?: string;
}) {
  const t = useTranslations();
  const r = screenReadinessOf(asset);
  if (!r || (r.kind !== 'converting' && r.kind !== 'failed')) return null;
  const converting = r.kind === 'converting';
  const short = variant === 'onImage';
  const label = converting
    ? t(short ? 'playlistsPage.screenReady.convertingShort' : 'playlistsPage.screenReady.converting')
    : t(short ? 'playlistsPage.screenReady.cantPlayShort' : 'playlistsPage.screenReady.cantPlay');
  const sentence = converting ? t('assetsLib.screenReady.convertingDetail') : screenFailedSentence(t, r);
  const Icon = converting ? Clock : AlertTriangle;
  return (
    <span
      data-testid="screen-ready-pill"
      data-screen-ready={r.kind}
      title={sentence}
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight ${INK[r.kind][variant]} ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <span className="sr-only">: {sentence}</span>
    </span>
  );
}
