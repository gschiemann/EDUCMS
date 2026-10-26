"use client";

/**
 * /[schoolId]/settings/player — PRESERVED URL, now a plain note (2026-10-26).
 *
 * Owner decision 3 of the Settings simplification: "Remove the update window
 * and staged rollout from customers. Updates are managed by VenueOS." The
 * controls that lived here (organization auto-update, update window with an
 * IANA time zone, a "% cohort" canary with "soak hours") moved to the owner
 * console (`/super/player-updates`, `PlayerUpdatesPanel`); the data model is
 * unchanged. Old links, bookmarks and the `/settings/usb` alias still land
 * here and are told — in one sentence — that there is nothing to set, plus
 * the one thing an operator CAN still do: update a single screen now from its
 * own settings in Screens.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MonitorUp, ArrowRight, Download } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { EditorHead } from '@/components/settings/shell/primitives';

export default function ScreenUpdatesNotePage() {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);

  return (
    <SettingsPageFrame
      section="player"
      title={t('settings.shell.sections.player.label')}
      description={t('settings.shell.sections.player.description')}
    >
      <EditorHead
        icon={MonitorUp}
        title={t('settings.cc.player.managedTitle')}
        description={t('settings.cc.player.managedBody')}
      />
      <div className="rounded-[11px] border border-slate-200 bg-slate-50 px-4 py-3.5" data-testid="screen-updates-note">
        <p className="text-[13px] leading-[18px] text-slate-700">{t('settings.cc.player.oneScreenNow')}</p>
        <Link
          href={`/${schoolId}/screens`}
          className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)]"
          style={{ background: 'var(--brand-primary)' }}
        >
          {t('settings.cc.player.openScreens')}
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
      </div>
      {/* The installer download that lived on the old Player & offline page
          stays for customers: it installs, it does not update. Same branded
          address as the Connect-a-screen card's QR code (/download/player). */}
      <p className="mt-4 text-[13px] leading-[18px] text-slate-600" data-testid="screen-updates-apk">
        {t('settings.cc.player.apkBody')}{' '}
        <a href="/download/player" className="inline-flex items-center gap-1 font-medium text-slate-900 underline underline-offset-2">
          <Download className="w-3.5 h-3.5" aria-hidden />
          {t('settings.cc.player.apkLink')}
        </a>
      </p>
      {role === 'SUPER_ADMIN' && (
        <p className="mt-4 text-[12px] text-slate-500">
          <Link href="/super/player-updates" className="font-medium underline underline-offset-2" data-testid="screen-updates-owner-link">
            {t('settings.cc.player.ownerConsoleLink')}
          </Link>
        </p>
      )}
    </SettingsPageFrame>
  );
}
