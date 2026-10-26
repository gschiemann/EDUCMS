"use client";

/**
 * The Settings home (`/[schoolId]/settings`) — Phase 1 simplification,
 * 2026-10-26. Replaces the Overview page, the desktop redirect to it and the
 * phone-only index: one page, every breakpoint.
 *
 *   Settings                                   (organization name)
 *   [ Search settings — try “logo” or “invite”                    ⌘K ]
 *   Needs attention   (at most three lines, each with its fix button)
 *   Organization · Emergency · Team · Connections · Plan & billing · Advanced
 *   More: Activity (who changed what) · My account
 *
 * Data budget (mobile-perf standard): the tenant the dashboard already has,
 * the emergency readiness report (60 s stale, never polled) and the billing
 * summary the trial bar already loads (10 min stale) — so opening Settings
 * costs at most ONE new request. Both reads are admin-only, matching the
 * server; an Editor or Viewer never reaches here (they are sent to My
 * account, owner decision 1).
 */
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  History,
  Loader2,
  Search,
  UserRound,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useTenant } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useEmergencyReadiness } from '@/hooks/use-settings-cc';
import { useBillingSummary } from '@/components/billing/billing-summary';
import { useSettingsShell } from '../shell/SettingsShellContext';
import { areaHref, canSeeSettings, visibleAreas, type SettingsAreaDefinition } from '../shell/registry';
import {
  billingStatus,
  emergencyStatus,
  homeAttention,
  type AreaStatusLine,
  type HomeReadiness,
} from './home-attention';

const TONE: Record<AreaStatusLine['tone'], { chip: string; dot: string }> = {
  good: { chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  warn: { chip: 'bg-amber-50 text-amber-900 border-amber-200', dot: 'bg-amber-500' },
  bad: { chip: 'bg-red-50 text-red-800 border-red-200', dot: 'bg-red-600' },
  muted: { chip: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
};

export function SettingsHome() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const admin = canSeeSettings(role);
  const { vertical } = useTenantCopy();
  const { setPaletteOpen } = useSettingsShell();

  // Editors and Viewers do not see Settings (owner decision 1): everything
  // they can change is in My account.
  useEffect(() => {
    if (role && !admin && schoolId) router.replace(`/${schoolId}/account`);
  }, [role, admin, schoolId, router]);

  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';
  const readiness = useEmergencyReadiness({ enabled: admin });
  const billing = useBillingSummary(admin);

  const readinessReport = readiness.data as HomeReadiness | undefined;
  const attention = useMemo(
    () => homeAttention(readinessReport, billing.data),
    [readinessReport, billing.data],
  );

  if (!admin) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-[13px] text-slate-500" role="status">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3 text-slate-400" aria-hidden />
        {role ? t('settings.shell.home.notAdmin') : t('settings.common.loadingEllipsis')}
      </div>
    );
  }

  const areas = visibleAreas(role, vertical);
  const statusFor = (area: SettingsAreaDefinition): AreaStatusLine | null => {
    if (area.id === 'emergency') return emergencyStatus(readinessReport, readiness.isLoading);
    if (area.id === 'billing') return billingStatus(billing.data);
    return null;
  };

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 py-5 md:px-6 md:py-8" data-testid="settings-home">
      <header className="mb-5 md:mb-6">
        <h1 className="text-[26px] leading-[32px] md:text-[30px] md:leading-[36px] font-semibold tracking-[-.03em] text-slate-900">
          {t('nav.settings')}
        </h1>
        <p className="mt-1 text-[13px] leading-[18px] text-slate-500 flex flex-wrap items-center gap-x-1.5">
          {tenantName && (
            <>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <Building2 className="w-3.5 h-3.5" aria-hidden />
                {tenantName}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>{t('settings.shell.home.subtitle')}</span>
        </p>
      </header>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        data-testid="settings-home-search"
        className="w-full flex items-center gap-3 min-h-[52px] px-4 rounded-2xl border border-slate-200 bg-white text-left text-[14px] text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,.04)] hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      >
        <Search className="w-[18px] h-[18px] shrink-0 text-slate-400" aria-hidden />
        <span className="flex-1 truncate">{t('settings.shell.palettePlaceholder')}</span>
        <kbd className="hidden md:inline text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">⌘K</kbd>
      </button>

      {attention.length > 0 && (
        <section aria-labelledby="settings-home-attention" className="mt-6">
          <h2 id="settings-home-attention" className="mb-2 text-[12px] font-semibold tracking-[.06em] uppercase text-slate-500">
            {t('settings.shell.home.attentionTitle')}
          </h2>
          <ul className="grid gap-2 list-none m-0 p-0" data-testid="settings-home-attention">
            {attention.map((line) => {
              const Icon = line.severity === 'error' ? XCircle : AlertTriangle;
              return (
                <li
                  key={line.id}
                  data-testid={`settings-attention-${line.id}`}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3',
                    line.severity === 'error' ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/70',
                  )}
                >
                  <Icon
                    className={cn('w-[18px] h-[18px] shrink-0', line.severity === 'error' ? 'text-red-600' : 'text-amber-600')}
                    aria-hidden
                  />
                  <p className="flex-1 min-w-[180px] text-[13px] leading-[18px] text-slate-800">
                    {t(`settings.shell.home.attention.${line.messageKey}`, line.values)}
                  </p>
                  <Link
                    href={`/${schoolId}/${line.href}`}
                    className="shrink-0 inline-flex items-center min-h-[40px] px-3.5 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                    style={{ background: 'var(--brand-primary)' }}
                  >
                    {t(`settings.shell.home.attention.${line.actionKey}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label={t('settings.shell.home.areasLabel')} className="mt-6">
        <ul className="grid gap-3 sm:grid-cols-2 list-none m-0 p-0">
          {areas.map((area) => {
            const status = statusFor(area);
            const Icon = area.icon;
            return (
              <li key={area.id}>
                <Link
                  href={areaHref(schoolId, area, role, vertical)}
                  data-testid={`settings-home-area-${area.id}`}
                  className="group h-full flex items-start gap-3.5 min-h-[92px] rounded-2xl border border-slate-200 bg-white p-4 md:p-5 transition-[border-color,box-shadow] hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                >
                  <span
                    className="w-11 h-11 shrink-0 grid place-items-center rounded-xl"
                    style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}
                  >
                    <Icon className="w-5 h-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="text-[15px] leading-[20px] font-semibold text-slate-900">
                        {t(`settings.shell.areas.${area.id}.label`)}
                      </strong>
                      {status && (
                        <span
                          className={cn('inline-flex items-center gap-1.5 min-h-[22px] px-2 rounded-full border text-[11px] font-medium', TONE[status.tone].chip)}
                          data-testid={`settings-home-status-${area.id}`}
                        >
                          <span className={cn('w-1.5 h-1.5 rounded-full', TONE[status.tone].dot)} aria-hidden />
                          {t(`settings.shell.home.status.${status.key}`, status.values)}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-[13px] leading-[18px] text-slate-500">
                      {t(`settings.shell.areas.${area.id}.description`)}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="settings-home-more" className="mt-7">
        <h2 id="settings-home-more" className="mb-2 text-[12px] font-semibold tracking-[.06em] uppercase text-slate-500">
          {t('settings.shell.home.moreTitle')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 list-none m-0 p-0">
          {/* Activity (owner decision 4): the audit log stays out of the
              sidebar; this is its one clear link. Admin-only, like the API. */}
          <MoreLink
            href={`/${schoolId}/audit`}
            icon={History}
            title={t('settings.shell.home.activityTitle')}
            body={t('settings.shell.home.activityBody')}
            testId="settings-home-activity"
          />
          <MoreLink
            href={`/${schoolId}/account`}
            icon={UserRound}
            title={t('settings.shell.home.accountTitle')}
            body={t('settings.shell.home.accountBody')}
            testId="settings-home-account"
          />
        </ul>
      </section>
    </div>
  );
}

function MoreLink({
  href,
  icon: Icon,
  title,
  body,
  testId,
}: {
  href: string;
  icon: typeof History;
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <li>
      <Link
        href={href}
        data-testid={testId}
        className="group h-full flex items-center gap-3.5 min-h-[72px] rounded-2xl border border-slate-200 bg-white px-4 py-3.5 transition-[border-color,box-shadow] hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      >
        <span className="w-10 h-10 shrink-0 grid place-items-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="w-[18px] h-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[14px] leading-[19px] font-semibold text-slate-900">{title}</strong>
          <span className="block mt-0.5 text-[12px] leading-[17px] text-slate-500">{body}</span>
        </span>
        <ChevronRight className="w-4 h-4 shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" aria-hidden />
      </Link>
    </li>
  );
}
