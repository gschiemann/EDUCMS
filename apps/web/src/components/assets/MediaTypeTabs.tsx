"use client";

/**
 * Media Library (2026-11-02 redesign) — filters are not
 * buttons. The media type is an underlined tab row (one quiet line, the
 * active tab carries a 2px brand underline); counts are plain grey numbers.
 * Horizontally scrollable at phone width.
 *
 * 2026-11-02 (pill cleanup): a thin wrapper over the shared `ui/tab-row.tsx`.
 */

import { useTranslations } from 'next-intl';
import { TabRow } from '@/components/ui/tab-row';

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
    <TabRow
      value={value}
      onChange={onChange}
      ariaLabel={t('assetsLibV2.typeTabs')}
      testId="media-type-tabs"
      tabs={keys.map((k) => ({
        key: k,
        label: t(`assetsLib.filter${k.charAt(0).toUpperCase() + k.slice(1)}` as never),
        count: k === 'all' || showCounts ? counts[k] : undefined,
      }))}
    />
  );
}
