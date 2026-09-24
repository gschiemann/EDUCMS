'use client';

/**
 * "Playback on screens" — the encode grade, on every surface that shows a video.
 *
 * Greg, 2026-09-24, after a 48 MB Canva export stuttered on a kiosk: "why
 * can't we check the file for fps, the codec, and anything else that the
 * signage might not display properly… if the content doesn't meet spec we
 * should at least warn them that they may have issues."
 *
 * Two pieces:
 *   - `VideoEncodeBadge` — a small pill that appears ONLY when the file
 *     grades amber or red. It sits on the Media Library tile, in the list
 *     row, on a playlist row and on a picker tile. Green and unknown render
 *     nothing: the tile stays quiet unless there is something to act on (§11).
 *   - `VideoEncodeCard` — the full verdict for the Media Library detail
 *     panel: grade, every reason as a sentence, and the export settings that
 *     fix it (with the Canva path spelled out, since that is where the
 *     first bad file came from).
 *
 * The grade comes from `@cms/api-types` via `lib/video-encode-copy` — this
 * file only renders it.
 */
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Tv2, XCircle } from 'lucide-react';
import {
  describeEncodeReason,
  encodeFactsLine,
  encodeWarns,
  videoEncodeState,
  type EncodeGradableAsset,
  type VideoEncodeStatus,
} from '@/lib/video-encode-copy';

interface BadgeProps {
  status: VideoEncodeStatus;
  /** The pill's text (a short label — `assetsLib.encode.badge*` or `playlistsPage.encodeRow*`). */
  label: string;
  /** Full reasons, for the tooltip / accessible name. */
  title?: string;
  /**
   * `onImage`: a dark scrim + tinted ink, legible over any thumbnail (the
   * same treatment as the tile's type badge). `inline`: a tinted chip on a
   * white row. `iconOnly` hides the text below `md` for a crowded row.
   */
  variant?: 'onImage' | 'inline';
  iconOnlyOnMobile?: boolean;
  className?: string;
}

const BADGE_INK: Record<'amber' | 'red', { onImage: string; inline: string }> = {
  amber: { onImage: 'bg-slate-900/75 text-amber-200', inline: 'bg-amber-100 text-amber-900 border border-amber-300' },
  red: { onImage: 'bg-slate-900/75 text-rose-200', inline: 'bg-rose-100 text-rose-900 border border-rose-300' },
};

export function VideoEncodeBadge({ status, label, title, variant = 'inline', iconOnlyOnMobile = false, className = '' }: BadgeProps) {
  if (!encodeWarns(status)) return null;
  const Icon = status === 'red' ? XCircle : AlertTriangle;
  return (
    <span
      data-testid="video-encode-badge"
      data-encode-status={status}
      title={title || label}
      aria-label={title ? `${label}. ${title}` : label}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black leading-none whitespace-nowrap ${BADGE_INK[status][variant]} ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className={iconOnlyOnMobile ? 'hidden md:inline' : undefined}>{label}</span>
    </span>
  );
}

/**
 * The badge, from an asset row: grades it, picks the label set and carries
 * every reason as the title. `labels: 'tile'` → "May stutter" / "Won't play
 * well" (Media Library tiles, pickers); `'row'` → the "… on screens" form
 * for a playlist row. Renders nothing unless the grade warns.
 */
export function AssetEncodeBadge({
  asset,
  labels = 'tile',
  variant,
  iconOnlyOnMobile,
  className,
}: {
  asset: EncodeGradableAsset | null | undefined;
  labels?: 'tile' | 'row';
  variant?: BadgeProps['variant'];
  iconOnlyOnMobile?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  const state = videoEncodeState(asset);
  if (!encodeWarns(state.status)) return null;
  const label =
    labels === 'row'
      ? t(state.status === 'red' ? 'playlistsPage.encodeRowRed' : 'playlistsPage.encodeRowAmber')
      : t(state.status === 'red' ? 'assetsLib.encode.badgeRed' : 'assetsLib.encode.badgeAmber');
  const title = state.verdict.reasons.map((r) => describeEncodeReason(t, r)).join(' · ');
  return (
    <VideoEncodeBadge
      status={state.status}
      label={label}
      title={title}
      variant={variant}
      iconOnlyOnMobile={iconOnlyOnMobile}
      className={className}
    />
  );
}

const CARD_TONE: Record<VideoEncodeStatus, { box: string; text: string }> = {
  green: { box: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-900' },
  amber: { box: 'bg-amber-50 border-amber-200', text: 'text-amber-900' },
  red: { box: 'bg-rose-50 border-rose-200', text: 'text-rose-900' },
  checking: { box: 'bg-slate-50 border-slate-200', text: 'text-slate-700' },
  unknown: { box: 'bg-slate-50 border-slate-200', text: 'text-slate-700' },
};

function StatusIcon({ status }: { status: VideoEncodeStatus }) {
  const cls = 'w-4 h-4 shrink-0';
  switch (status) {
    case 'green':
      return <CheckCircle2 className={`${cls} text-emerald-600`} aria-hidden />;
    case 'amber':
      return <AlertTriangle className={`${cls} text-amber-600`} aria-hidden />;
    case 'red':
      return <XCircle className={`${cls} text-rose-600`} aria-hidden />;
    case 'checking':
      return <Loader2 className={`${cls} text-slate-500 animate-spin motion-reduce:animate-none`} aria-hidden />;
    default:
      return <HelpCircle className={`${cls} text-slate-400`} aria-hidden />;
  }
}

/**
 * The detail-panel card. Renders nothing for a non-video, so the caller can
 * mount it unconditionally next to the other metadata tiles.
 */
export function VideoEncodeCard({
  asset,
  now,
  onCheck,
  checking = false,
}: {
  asset: EncodeGradableAsset | null | undefined;
  now?: number;
  /**
   * "Check this file" — runs the probe now for a video that has no facts
   * (an upload from before the probe existed). Shown only for `unknown`.
   */
  onCheck?: () => void;
  /** True while that check is in flight: the card reads "Checking…". */
  checking?: boolean;
}) {
  const t = useTranslations();
  if (!asset || !(typeof asset.mimeType === 'string' && asset.mimeType.toLowerCase().startsWith('video/'))) return null;
  const graded = videoEncodeState(asset, now);
  const status: VideoEncodeStatus = checking && graded.status === 'unknown' ? 'checking' : graded.status;
  const { verdict, facts } = graded;
  const tone = CARD_TONE[status];
  const factsLine = status === 'green' ? encodeFactsLine(facts) : '';
  return (
    <section
      data-testid="video-encode-card"
      data-encode-status={status}
      aria-live={status === 'checking' ? 'polite' : undefined}
      className={`rounded-lg border p-3 ${tone.box}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Tv2 className="w-3 h-3 text-slate-400" aria-hidden />
        <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.encode.title')}</span>
      </div>
      <p className={`flex items-start gap-1.5 text-xs font-semibold ${tone.text}`}>
        <StatusIcon status={status} />
        <span>{t(`assetsLib.encode.${status}`)}</span>
      </p>
      {factsLine && <p className="mt-1 pl-[22px] text-[11px] text-emerald-800/80">{factsLine}</p>}
      {verdict.reasons.length > 0 && (
        <ul className="mt-2 pl-[22px] space-y-1" data-testid="video-encode-reasons">
          {verdict.reasons.map((r) => (
            <li key={r.code} data-reason={r.code} className="text-[11px] leading-snug text-slate-700">
              {describeEncodeReason(t, r)}
            </li>
          ))}
        </ul>
      )}
      {encodeWarns(status) && (
        <div className="mt-2 pl-[22px] space-y-1">
          <p className="text-[11px] leading-snug text-slate-700">{t('assetsLib.encode.recommendation')}</p>
          <p className="text-[11px] leading-snug text-slate-500">{t('assetsLib.encode.canvaHint')}</p>
        </div>
      )}
      {status === 'unknown' && onCheck && (
        <div className="mt-2 pl-[22px]">
          <button
            type="button"
            onClick={onCheck}
            className="min-h-11 sm:min-h-0 px-3 py-2 sm:py-1.5 rounded-lg bg-white border border-slate-300 hover:border-indigo-400 hover:text-indigo-700 text-[11px] font-bold text-slate-700 transition-colors"
          >
            {t('assetsLib.encode.checkNow')}
          </button>
        </div>
      )}
    </section>
  );
}
