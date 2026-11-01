"use client";

/**
 * The "Custom message" card on the Emergency page (2026-10-26).
 *
 * The Broadcast page is gone from the navigation: "it should not get its own
 * page, add it into the emergency page area as a custom message." This is the
 * card that replaced it. One tap opens the sheet (CustomMessageSheet) where the
 * operator types the words, picks Info or Critical and who gets it, and holds
 * the same 3-second button every emergency control uses.
 *
 * Mounted on /panic (the immersive Emergency page on a phone) and in the
 * desktop Emergency window — the two places the Emergency button leads. The
 * old /<school>/emergency/broadcast URL redirects to /panic?message=1, which
 * opens this sheet straight away (`openFromUrl`), so no bookmark, email or
 * muscle memory breaks.
 *
 * Offered only to people the API would let send: the role or the delegated
 * `canTriggerPanic` flag (`hasPanicAuthority`), never a viewer — a control the
 * server would refuse is not shown.
 *
 * COST. One read for the "N on screens" badge when the card mounts (no timer —
 * the mobile-perf standard forbids new pollers in always-mounted chrome); the
 * sheet polls only while it is open and the tab is visible.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Megaphone } from 'lucide-react';
import { CustomMessageSheet, LIVE_MESSAGES_KEY } from '@/components/emergency/CustomMessageSheet';
import { fetchLiveMessages } from '@/lib/emergency-api';
import { canSendAllClear, hasPanicAuthority, type PanicCapableUser } from '@/lib/emergency-capability';

export interface CustomMessageCardProps {
  token: string | null;
  user: (PanicCapableUser & { tenantId?: string | null }) | null | undefined;
  /** Open the sheet on arrival when the page was reached with `?message=1` (the old Broadcast URL). */
  openFromUrl?: boolean;
  /** One line (icon, title, badge) for a host that is short on height — /panic keeps its six buttons large. */
  compact?: boolean;
  /** Spacing / layout classes from the host. */
  className?: string;
}

export function CustomMessageCard({ token, user, openFromUrl = false, compact = false, className = '' }: CustomMessageCardProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const isViewer = user?.role === 'RESTRICTED_VIEWER';
  const canSend = hasPanicAuthority(user) && !isViewer;
  const canClear = canSendAllClear(user) && !isViewer;
  const tenantId = user?.tenantId ?? '';

  // Arrive straight in the sheet from the old Broadcast URL.
  useEffect(() => {
    if (!openFromUrl || !canSend) return;
    try {
      if (new URLSearchParams(window.location.search).get('message') === '1') setOpen(true);
    } catch { /* no location: stay closed */ }
  }, [openFromUrl, canSend]);

  const liveCount = useQuery({
    queryKey: [LIVE_MESSAGES_KEY, tenantId],
    queryFn: () => fetchLiveMessages(token, tenantId),
    enabled: canSend && !!token && !!tenantId,
    staleTime: 30_000,
    retry: false,
  });
  const live = liveCount.data?.length ?? 0;

  if (!canSend) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="custom-message-card"
        className={`w-full flex items-center rounded-2xl border px-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          compact ? 'py-1 min-h-[48px]' : 'py-2 min-h-[56px]'
        } ${className}`}
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.10)' }}
      >
        <span className={`flex shrink-0 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/10 mr-3 ${compact ? 'h-8 w-8' : 'h-9 w-9'}`}>
          <Megaphone className="w-[18px] h-[18px] text-amber-300" aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-white truncate">{t('emergency.message.cardTitle')}</span>
          {!compact && <span className="block text-xs text-white/60 truncate">{t('emergency.message.cardBody')}</span>}
        </span>
        {live > 0 && (
          <span
            data-testid="custom-message-card-live"
            className="ml-2 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold text-slate-900"
            style={{ background: '#fbbf24' }}
          >
            {t('emergency.message.cardLive', { count: live })}
          </span>
        )}
        <ChevronRight className="w-5 h-5 shrink-0 ml-1 text-white/50" aria-hidden />
      </button>
      <CustomMessageSheet
        open={open}
        onClose={() => setOpen(false)}
        token={token}
        tenantId={tenantId}
        canSend={canSend}
        canClear={canClear}
      />
    </>
  );
}
