'use client';

/**
 * "2 videos in this playlist may not play smoothly on your screens."
 *
 * The publish-time half of the encode warning (Greg, 2026-09-24: "we want the
 * user to have the best experience when publishing and if the content doesn't
 * meet spec we should at least warn them"). The Media Library flags a file on
 * upload; this banner sits above a playlist's Content list so the same fact is
 * in front of the operator at the moment they are about to put the file on a
 * wall. It names each file and its first reason, and says what to export
 * instead. Nothing flagged → renders nothing.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { useEncodeTarget } from '@/hooks/use-encode-target';
import {
  describeEncodeReason,
  encodeSuggestions,
  encodeWarnings,
  encodeWarns,
  videoEncodeState,
  type EncodeGradableAsset,
} from '@/lib/video-encode-copy';

export interface EncodeBannerItem {
  id: string;
  asset?: (EncodeGradableAsset & { originalName?: string | null; fileUrl?: string | null }) | null;
}

/** How many flagged files the banner lists by name before "+ N more". */
const MAX_LISTED = 5;

function itemName(item: EncodeBannerItem): string {
  const a = item.asset;
  if (!a) return '';
  if (a.originalName) return a.originalName;
  const url = a.fileUrl || '';
  try {
    return decodeURIComponent(url.split('/').pop() || '');
  } catch {
    return url.split('/').pop() || '';
  }
}

export function PlaylistEncodeBanner({ items }: { items: EncodeBannerItem[] }) {
  const t = useTranslations();
  const target = useEncodeTarget();
  const flagged = useMemo(
    () =>
      items
        .map((item) => ({ item, state: videoEncodeState(item.asset, undefined, target) }))
        .filter(({ state }) => encodeWarns(state.status)),
    [items, target],
  );
  if (flagged.length === 0) return null;
  const automaticOnly = flagged.every(({ state }) =>
    encodeWarnings(state.verdict).every((reason) => reason.code === 'resolution' || reason.code === 'fast-start'));
  const needsSmallerCopy = flagged.some(({ state }) => encodeWarnings(state.verdict).some((reason) => reason.code === 'resolution'));
  const worst = flagged.some(({ state }) => state.status === 'red') ? 'red' : 'amber';
  const tone = automaticOnly ? 'bg-indigo-50 border-indigo-200 text-indigo-950' :
    worst === 'red'
      ? 'bg-rose-50 border-rose-200 text-rose-900'
      : 'bg-amber-50 border-amber-200 text-amber-900';
  const iconTone = automaticOnly ? 'text-indigo-600' : worst === 'red' ? 'text-rose-600' : 'text-amber-600';
  const listed = flagged.slice(0, MAX_LISTED);
  const more = flagged.length - listed.length;
  return (
    <div
      role="status"
      data-testid="playlist-encode-banner"
      data-encode-status={automaticOnly ? 'info' : worst}
      className={`mb-3 rounded-xl border px-3 py-2.5 ${tone}`}
    >
      <p className="flex items-start gap-2 text-xs font-semibold">
        <AlertTriangle className={`w-4 h-4 shrink-0 mt-px ${iconTone}`} aria-hidden />
        <span>{t(automaticOnly ? needsSmallerCopy ? 'playlistsPage.encodeAutoPrepare' : 'playlistsPage.encodeFastStart' : 'playlistsPage.encodeBanner', { count: flagged.length })}</span>
      </p>
      <details className="mt-1 pl-6 text-[11px] text-slate-700">
        <summary className="cursor-pointer font-semibold text-indigo-700">{t('assetsLib.encode.technicalDetails')}</summary>
      <ul className="mt-1.5 space-y-0.5">
        {listed.map(({ item, state }) => {
          const warnings = encodeWarnings(state.verdict);
          const first = warnings[0];
          const suggestion = encodeSuggestions(t, state.verdict);
          return (
            <li key={item.id} className="text-[11px] leading-snug text-slate-700" title={warnings.map((r) => describeEncodeReason(t, r)).join(' · ')}>
              <div className="truncate">
                <span className="font-semibold text-slate-800">{itemName(item)}</span>
                {first && <span> — {describeEncodeReason(t, first)}</span>}
              </div>
              {suggestion && <div className="pl-2 text-slate-600">{suggestion}</div>}
            </li>
          );
        })}
        {more > 0 && <li className="text-[11px] text-slate-500">+{more}</li>}
      </ul>
      </details>
    </div>
  );
}
