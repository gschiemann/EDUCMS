'use client';

/**
 * The customer's always-visible truth about VenueOS support access (2026-10-11).
 *
 * Renders NOTHING unless VenueOS currently has access to this organisation
 * (a grant the customer approved, gave, or the audited break-glass path) or
 * is asking for it. Mounted in the dashboard chrome for every role: the
 * banner is information for the whole organisation; only the organisation's
 * admins get the "End now" / "Review" actions. Never shown to a SUPER_ADMIN
 * — that side lives in the customer console.
 *
 * Mobile-perf: one read on mount, refetch on focus, no timers. The chrome
 * stays cheap — no blur, no decoration.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { appConfirm } from '@/components/ui/app-dialog';
import { useAppStore } from '@/lib/store';
import { useEndSupport, useMySupportAccess } from '@/hooks/use-support-access';
import { formatWhen } from '@/lib/support-access';

export function SupportAccessBanner() {
  const t = useTranslations('supportAccess.banner');
  const locale = useLocale();
  const user = useAppStore((s) => s.user);
  const activeTenant = useAppStore((s) => s.activeTenant);
  const isCustomer = !!user && user.role !== 'SUPER_ADMIN';
  const { data } = useMySupportAccess(isCustomer);
  const end = useEndSupport();
  const [error, setError] = useState<string | null>(null);

  if (!isCustomer || !data) return null;
  const active = data.active ?? null;
  const pending = (Array.isArray(data.pending) ? data.pending : [])[0] ?? null;
  if (!active && !pending) return null;
  const settingsHref = `/${activeTenant ?? user.tenantId}/settings/support-access`;

  const endNow = async () => {
    if (!active) return;
    setError(null);
    const ok = await appConfirm({ title: t('endConfirmTitle'), message: t('endConfirmBody'), confirmLabel: t('endNow') });
    if (!ok) return;
    try {
      await end.mutateAsync({ grantId: active.id });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('endFailed'));
    }
  };

  const breakGlass = active?.kind === 'BREAK_GLASS';
  const Icon = breakGlass ? ShieldAlert : ShieldCheck;
  return (
    <div
      role="status"
      data-testid="support-access-banner"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm border-b ${
        breakGlass ? 'bg-rose-50 border-rose-200 text-rose-900' : active ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        {active
          ? breakGlass
            ? t('breakGlass', { until: formatWhen(active.expiresAt, locale) })
            : t('active', { until: formatWhen(active.expiresAt, locale) })
          : t('pending', { by: pending?.requestedByEmail ?? 'VenueOS' })}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Link href={settingsHref} className="underline underline-offset-2 font-semibold min-h-8 inline-flex items-center">
          {active ? t('details') : t('review')}
        </Link>
        {active && data.canDecide && (
          <button
            type="button"
            onClick={endNow}
            disabled={end.isPending}
            className="inline-flex items-center gap-1 min-h-8 px-2.5 rounded-md bg-white/80 border border-current/30 font-semibold disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" aria-hidden /> {t('endNow')}
          </button>
        )}
      </span>
      {error && <span role="alert" className="basis-full text-rose-700">{error}</span>}
    </div>
  );
}
