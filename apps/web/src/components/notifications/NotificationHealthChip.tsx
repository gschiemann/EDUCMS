"use client";

import { useTranslations } from 'next-intl';
import type { InboxNotification } from './notificationInbox';

/**
 * Where a screen-offline (or site-wide drop) notification stands NOW
 * (2026-10-24): "Still offline", "Back online", "Off on schedule", "Not seen in
 * 30+ days", "Screen removed". The owner's bell counted 11 offline rows for one
 * screen, ten of them outages that ended weeks earlier; the API now lists one
 * row per screen and says what that screen is doing, and this chip shows it.
 *
 * Sits BESIDE the localized title and body (`useNotificationText`), never in
 * place of them.
 */
const TONE: Record<string, string> = {
  offline: 'bg-rose-50 text-rose-700 border-rose-100',
  'back-online': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  resting: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  dormant: 'bg-slate-100 text-slate-600 border-slate-200',
  removed: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function NotificationHealthChip({ n }: { n: InboxNotification }) {
  const t = useTranslations('notifications.health');
  const tReason = useTranslations('dashboard.attention.reason');
  const h = n.health;
  if (!h) return null;
  const site = n.kind === 'INFRA_EVENT';
  let label: string;
  if (site) label = h.state === 'offline' ? t('siteOffline') : t('siteBackOnline');
  else if (h.state === 'resting' && h.reason) label = (tReason as unknown as (key: string) => string)(h.reason);
  else label = (t as unknown as (key: string) => string)(h.state);
  return (
    <span
      data-testid="notification-health"
      data-state={h.state}
      className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE[h.state] ?? TONE.dormant}`}
    >
      <span
        aria-hidden
        className={`w-1.5 h-1.5 rounded-full ${h.state === 'offline' ? 'bg-rose-500' : h.state === 'back-online' ? 'bg-emerald-500' : h.state === 'resting' ? 'bg-indigo-400' : 'bg-slate-400'}`}
      />
      {label}
    </span>
  );
}
