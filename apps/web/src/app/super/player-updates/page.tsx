'use client';

/**
 * /super/player-updates — screen software updates, VenueOS-managed
 * (2026-10-26, owner decision 3 of the Settings simplification: "Updates are
 * managed by VenueOS. Move those controls to the owner console").
 *
 * The same controls customers used to see at Settings → Player & offline —
 * organization auto-update, update window, staged rollout, promote — with the
 * same endpoints and data model (`/tenants/me/*`). They act on the
 * organization this session is signed in to, which is said at the top: the
 * owner console adds no new way into a customer's organization (support
 * access still decides that).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MonitorUp } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useTenant } from '@/hooks/use-api';
import { SettingsShellProvider } from '@/components/settings/shell/SettingsShellContext';
import { PlayerUpdatesPanel } from '@/components/settings/player/PlayerUpdatesPanel';

export default function PlayerUpdatesPage() {
  const t = useTranslations('businessConsole');
  const user = useAppStore((s) => s.user);
  const slug = useAppStore((s) => s.activeTenant) || user?.tenantSlug || user?.tenantId || '';
  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? slug;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-8" data-testid="super-player-updates">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
          <MonitorUp className="h-6 w-6 text-indigo-600" aria-hidden />
          {t('playerUpdatesTitle')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('playerUpdatesBody')}</p>
        {slug ? (
          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
            <strong className="font-semibold">{t('appliesTo', { name: tenantName })}</strong>
            <span className="mt-0.5 block text-xs text-indigo-800/80">
              {t('appliesToHint')}{' '}
              <Link href="/super/customers" className="font-medium underline underline-offset-2">
                {t('customers')}
              </Link>
            </span>
          </div>
        ) : null}
      </header>
      {slug ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
          <SettingsShellProvider>
            <PlayerUpdatesPanel schoolId={slug} />
          </SettingsShellProvider>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{t('noOrganization')}</p>
      )}
    </div>
  );
}
