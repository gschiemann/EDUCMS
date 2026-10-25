"use client";

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, History } from 'lucide-react';
import type { ActivityItem } from '@cms/api-types';
import { activityLines, type ActivityTranslate } from '@/lib/activity/activityFeed';
import { relativeAgeParts } from '@/components/notifications/notificationInbox';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { LOCALE_HTML_LANG } from '@/i18n/config';
import { ActivityIconChip } from './ActivityIcon';

/**
 * "Recent activity" on Home (2026-10-24) — what people did, in sentences.
 *
 * Owner, from his phone: "These alerts don't seem like user activity … just
 * alerts that make sense to an end user." The card used to title-case raw
 * audit action names ("Field Build Window Expire · field_build_window"). It
 * now reads the API's customer-activity allowlist (`GET /audit/recent`) and
 * says what happened — "You published “Lobby loop” to 3 screens" — grouping a
 * sitting (a publish wizard, an upload batch) into one line
 * (`@/lib/activity/activityFeed`).
 *
 * Presentational: data, loading and error state are props, so the page and
 * tests own the fetch.
 */
export interface RecentActivityCardProps {
  items: ActivityItem[] | undefined;
  isPending?: boolean;
  isError?: boolean;
  /** The signed-in person — their own rows read "You". */
  viewerId?: string | null;
  /** The full Activity page. */
  viewAllHref: string;
  /** How many lines to show (after grouping). */
  limit?: number;
}

/** "6m ago" for the last week, then a short date — a line from last month says when, not "34d ago". */
export function useActivityTime() {
  const tAge = useTranslations('notifications.age');
  const { locale } = useLocaleSwitch();
  const lang = LOCALE_HTML_LANG[locale] ?? 'en';
  return useCallback(
    (iso: string, now: number = Date.now()) => {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return { short: '', full: '' };
      let full = '';
      try {
        full = new Date(ms).toLocaleString(lang, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch {
        full = new Date(ms).toISOString();
      }
      const p = relativeAgeParts(iso, now);
      if (p && (p.unit !== 'days' || p.count < 7)) {
        return { short: p.unit === 'justNow' ? tAge('justNow') : tAge(p.unit, { count: p.count }), full };
      }
      let short = '';
      try {
        short = new Date(ms).toLocaleDateString(lang, { month: 'short', day: 'numeric' });
      } catch {
        short = full;
      }
      return { short, full };
    },
    [tAge, lang],
  );
}

export function RecentActivityCard({
  items, isPending, isError, viewerId, viewAllHref, limit = 6,
}: RecentActivityCardProps) {
  const t = useTranslations('activityFeed');
  const tPage = useTranslations('activityPage');
  const time = useActivityTime();
  const lines = useMemo(
    () => activityLines(items, { t: t as unknown as ActivityTranslate, viewerId }).slice(0, limit),
    [items, t, viewerId, limit],
  );

  return (
    <section
      id="recent-activity"
      data-testid="recent-activity"
      aria-labelledby="recent-activity-title"
      className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <History className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
          <h2 id="recent-activity-title" className="text-sm font-bold text-slate-800 truncate">{t('title')}</h2>
        </div>
        <Link
          href={viewAllHref}
          className="dash-link shrink-0 inline-flex items-center gap-1 min-h-[44px] -my-2 text-[12px] font-semibold"
        >
          {t('viewAll')} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </Link>
      </div>

      {isPending && !items ? (
        <ul aria-hidden className="divide-y divide-slate-100 animate-pulse">
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-4 sm:px-5 py-3 flex items-start gap-3">
              <span className="w-8 h-8 rounded-full bg-slate-100 shrink-0" />
              <span className="flex-1 space-y-2 pt-1">
                <span className="block h-3 w-4/5 rounded bg-slate-100" />
                <span className="block h-2.5 w-1/4 rounded bg-slate-100" />
              </span>
            </li>
          ))}
        </ul>
      ) : lines.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <History className="w-7 h-7 text-slate-300 mx-auto mb-2" aria-hidden />
          <p className="text-[13px] leading-snug text-slate-500 max-w-xs mx-auto">{isError && !items ? tPage('loadError') : t('empty')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100" data-testid="recent-activity-list">
          {lines.map((line) => {
            const when = time(line.at);
            return (
              <li key={line.key} className="px-4 sm:px-5 py-3 flex items-start gap-3" data-category={line.category}>
                <ActivityIconChip icon={line.icon} tone={line.tone} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] leading-snug font-semibold text-slate-800 line-clamp-2">{line.text}</span>
                  <time dateTime={line.at} title={when.full} className="mt-0.5 block text-[11.5px] text-slate-400">
                    {when.short}
                  </time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
