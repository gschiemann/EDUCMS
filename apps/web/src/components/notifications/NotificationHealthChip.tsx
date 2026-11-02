"use client";

import { useTranslations } from 'next-intl';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
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
const TONE: Record<string, StatusTone> = {
  offline: 'danger',
  'back-online': 'success',
  resting: 'brand',
  dormant: 'neutral',
  removed: 'neutral',
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
    <span data-state={h.state} className="mt-1 inline-flex">
      <StatusPill
        tone={TONE[h.state] ?? 'neutral'}
        data-testid="notification-health"
        icon={<span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      >
        {label}
      </StatusPill>
    </span>
  );
}
