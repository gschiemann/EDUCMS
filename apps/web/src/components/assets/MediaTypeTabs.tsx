"use client";

/**
 * Media Library DESIGN MOCK-UP (`?design=v2`, 2026-11-02) — filters are not
 * buttons. The media type is an underlined tab row (one quiet line, the
 * active tab carries a 2px brand underline); counts are plain grey numbers.
 * Horizontally scrollable at phone width.
 */

import { useTranslations } from 'next-intl';

export type MediaTypeKey = 'all' | 'images' | 'videos' | 'audio' | 'urls' | 'documents';

export function MediaTypeTabs({
  value,
  onChange,
  counts,
  showCounts,
}: {
  value: MediaTypeKey;
  onChange: (v: MediaTypeKey) => void;
  counts: Record<MediaTypeKey, number>;
  /** Truth rule: per-type counts only when the whole library is loaded (All always). */
  showCounts: boolean;
}) {
  const t = useTranslations();
  const keys: MediaTypeKey[] = ['all', 'images', 'videos', 'audio', 'urls', 'documents'];
  return (
    <div
      role="tablist"
      aria-label={t('assetsLibV2.typeTabs')}
      data-testid="media-type-tabs"
      className="flex items-stretch gap-5 overflow-x-auto h-full -mb-px [scrollbar-width:none]"
    >
      {keys.map((k) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(k)}
            className={`shrink-0 min-h-11 flex items-center gap-1.5 border-b-2 px-0.5 text-[13px] transition-colors ${
              active
                ? 'border-indigo-600 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            {t(`assetsLib.filter${k.charAt(0).toUpperCase() + k.slice(1)}` as never)}
            {(k === 'all' || showCounts) && (
              <span className={`text-xs tabular-nums ${active ? 'text-slate-500' : 'text-slate-400'}`}>{counts[k]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
