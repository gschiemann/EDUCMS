'use client';

/**
 * "Playback on screens" — the encode grade, on every surface that shows a video.
 *
 * Greg, 2026-09-24, after a 48 MB export stuttered on a kiosk: "why can't we
 * check the file for fps, the codec, and anything else that the signage
 * might not display properly… if the content doesn't meet spec we should at
 * least warn them that they may have issues." Then, on the first cut:
 * "wont play well and may stutter is a stupid thing to put on the preview,
 * just add a small alert icon that you can hover over for more info or click
 * for the details… we should give the info we can get and then show
 * suggested specs if its different than standard."
 *
 * So:
 *   - `VideoEncodeBadge` — an ICON only (amber triangle / red cross), shown
 *     solely when the file grades amber or red. Hover shows the headline and
 *     every reason; on a row it is a button that opens a small details
 *     popover (a phone has no hover); on a tile it is a plain mark and the
 *     tile's own click opens the details. Green, info-only and unknown
 *     render nothing.
 *   - `VideoEncodeCard` — the detail-panel card: the grade, EVERY fact the
 *     probe found (codec, size, frame rate, bitrate, colour, audio,
 *     container, index placement), the warnings and notes as sentences, and
 *     the suggested export ONLY when the file differs from what the
 *     operator's own screens want.
 *
 * The size target is the fleet's largest panel (`useEncodeTarget`), never a
 * fixed 1080p. Nothing here assumes where a file came from.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Tv2, XCircle } from 'lucide-react';
import { useEncodeTarget } from '@/hooks/use-encode-target';
import {
  describeEncodeReason,
  encodeFacts,
  encodeNotes,
  encodeRemuxRecord,
  encodeSuggestions,
  encodeWarnings,
  encodeWarns,
  videoEncodeState,
  type EncodeGradableAsset,
  type VideoEncodeState,
  type VideoEncodeStatus,
} from '@/lib/video-encode-copy';

type Translator = ReturnType<typeof useTranslations>;

/** The headline + every warning, joined — the hover text and the accessible name. */
function badgeTitle(t: Translator, state: VideoEncodeState): string {
  const lines = [t(`assetsLib.encode.${state.status}`), ...encodeWarnings(state.verdict).map((r) => describeEncodeReason(t, r))];
  return lines.join('\n');
}

const MARK_INK: Record<'amber' | 'red', { onImage: string; inline: string }> = {
  amber: { onImage: 'bg-slate-900/75 text-amber-300', inline: 'bg-amber-100 text-amber-800 border border-amber-300' },
  red: { onImage: 'bg-slate-900/75 text-rose-300', inline: 'bg-rose-100 text-rose-800 border border-rose-300' },
};

interface BadgeProps {
  status: VideoEncodeStatus;
  /** Hover text / accessible name: the headline and the reasons. */
  title: string;
  /** `onImage`: a dark round chip, legible over any thumbnail. `inline`: a tinted chip on a white row. */
  variant?: 'onImage' | 'inline';
  className?: string;
}

/** The icon-only mark. Renders nothing unless the grade warns. */
export function VideoEncodeBadge({ status, title, variant = 'inline', className = '' }: BadgeProps) {
  if (!encodeWarns(status)) return null;
  const Icon = status === 'red' ? XCircle : AlertTriangle;
  return (
    <span
      data-testid="video-encode-badge"
      data-encode-status={status}
      title={title}
      role="img"
      aria-label={title}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${MARK_INK[status][variant]} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
    </span>
  );
}

/**
 * The mark, from an asset row: grades it against the fleet's panels and
 * carries every reason as the hover text. `interactive` turns it into a
 * button with a details popover for rows that have no detail panel of their
 * own (a playlist row, the wizard's selected list); on a tile the tile's own
 * click is the way in, so the mark stays a plain image. Renders nothing
 * unless the grade warns.
 */
export function AssetEncodeBadge({
  asset,
  variant,
  interactive = false,
  className,
}: {
  asset: EncodeGradableAsset | null | undefined;
  variant?: BadgeProps['variant'];
  interactive?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  const target = useEncodeTarget();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const state = videoEncodeState(asset, undefined, target);
  if (!encodeWarns(state.status)) return null;
  const title = badgeTitle(t, state);
  if (!interactive) return <VideoEncodeBadge status={state.status} title={title} variant={variant} className={className} />;
  const Icon = state.status === 'red' ? XCircle : AlertTriangle;
  return (
    <span ref={wrapRef} className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        data-testid="video-encode-badge"
        data-encode-status={state.status}
        title={title}
        aria-label={t('assetsLib.encode.detailsAria')}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors ${MARK_INK[state.status][variant ?? 'inline']} hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400`}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          data-testid="video-encode-popover"
          className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        >
          <EncodeVerdictBody t={t} state={state} compact />
        </div>
      )}
    </span>
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
 * The verdict, in words: headline, warnings, notes, and the suggested export
 * ONLY when the file differs from what the screens want. Shared by the card
 * and the popover.
 */
function EncodeVerdictBody({
  t,
  state,
  compact = false,
}: {
  t: Translator;
  state: VideoEncodeState;
  compact?: boolean;
}) {
  const { status, verdict } = state;
  const warnings = encodeWarnings(verdict);
  const notes = encodeNotes(verdict);
  const differs = encodeWarns(status) || notes.length > 0;
  const suggested = encodeSuggestions(t, verdict);
  const indent = compact ? '' : 'pl-[22px]';
  return (
    <>
      <p className={`flex items-start gap-1.5 text-xs font-semibold ${CARD_TONE[status].text}`}>
        <StatusIcon status={status} />
        <span>{t(`assetsLib.encode.${status}`)}</span>
      </p>
      {warnings.length > 0 && (
        <ul className={`mt-1.5 ${indent} space-y-1`} data-testid="video-encode-reasons">
          {warnings.map((r) => (
            <li key={r.code} data-reason={r.code} className="text-[11px] leading-snug text-slate-700">
              {describeEncodeReason(t, r)}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className={`mt-1.5 ${indent} space-y-1`} data-testid="video-encode-notes">
          {notes.map((r) => (
            <li key={r.code} data-reason={r.code} className="text-[11px] leading-snug text-slate-500">
              {describeEncodeReason(t, r)}
            </li>
          ))}
        </ul>
      )}
      {differs && (
        <p className={`mt-2 ${indent} text-[11px] leading-snug text-slate-700`} data-testid="video-encode-suggested">
          {suggested}
        </p>
      )}
    </>
  );
}

/**
 * The detail-panel card. Renders nothing for a non-video, so the caller can
 * mount it unconditionally next to the other metadata tiles.
 */
/** "Sep 24" — the day the index was moved; the operator's own locale. */
function fmtRemuxDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

export function VideoEncodeCard({
  asset,
  now,
  onCheck,
  checking = false,
}: {
  asset: EncodeGradableAsset | null | undefined;
  now?: number;
  /** "Check this file" — runs the probe now for a video that has no facts. Shown only for `unknown`. */
  onCheck?: () => void;
  /** True while that check is in flight: the card reads "Checking…". */
  checking?: boolean;
}) {
  const t = useTranslations();
  const target = useEncodeTarget();
  if (!asset || !(typeof asset.mimeType === 'string' && asset.mimeType.toLowerCase().startsWith('video/'))) return null;
  const graded = videoEncodeState(asset, now, target);
  const state: VideoEncodeState = checking && graded.status === 'unknown' ? { ...graded, status: 'checking' } : graded;
  const facts = encodeFacts(state.facts);
  const remux = encodeRemuxRecord(asset.processingMeta);
  return (
    <section
      data-testid="video-encode-card"
      data-encode-status={state.status}
      aria-live={state.status === 'checking' ? 'polite' : undefined}
      className={`rounded-lg border p-3 ${CARD_TONE[state.status].box}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Tv2 className="w-3 h-3 text-slate-400" aria-hidden />
        <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.encode.title')}</span>
      </div>
      {facts.length > 0 && (
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5" data-testid="video-encode-facts">
          {facts.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400 self-center">{t(`assetsLib.encode.fact.${f.key}`)}</dt>
              <dd className="text-[11px] font-semibold text-slate-800">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <EncodeVerdictBody t={t} state={state} />
      {remux && (
        // The index used to be the warning on this file; say that it was
        // moved, and when, so a green card after an amber one is not a mystery.
        <p className="mt-1.5 pl-[22px] text-[11px] leading-snug text-slate-500" data-testid="video-encode-remuxed">
          {t('assetsLib.encode.remuxed', { date: fmtRemuxDate(remux.at) })}
        </p>
      )}
      {state.status === 'unknown' && onCheck && (
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
