"use client";

/**
 * Settings Command Center — Overview (§7.1).
 *
 * Answers one question: "is this organization configured, and is anything
 * blocking operations?" It is a READ surface — every control it offers is a
 * link into the category that owns the fix.
 *
 * Data (§19.4 — no fan-out): the `/tenants` payload the shell already loads,
 * plus THREE role-gated category reads, none of which poll:
 *   1. GET /emergency/readiness  — the composed, server-side readiness check
 *      we already own. Its items carry the observed state AND the one-line
 *      fix, so the attention list is quoting the server, not inferring.
 *   2. GET /license/me           — seats, status, expiry (the billing blocker).
 *   3. GET /audit?limit=25       — the recent-settings-change window.
 * A CONTRIBUTOR / RESTRICTED_VIEWER fires NONE of them: they are gated on the
 * role the server itself requires, so a viewer sees an honest "administrators
 * only" line instead of three requests that can only 403.
 *
 * §11: no invented statuses. Nothing here turns green off a local form save,
 * "not ready" is only ever what the server computed, and a check that FAILED
 * is reported as unknown — never as healthy.
 *
 * Deliberately NOT here (§7.1): fleet status. Screens online / stale content
 * belong to Dashboard and Screens.
 */
import { useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Gauge, AlertTriangle, XCircle, ChevronRight, History, Loader2, RefreshCw,
} from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useTenant, useLicense } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { localizedVerticalIndustry } from '@/i18n/vertical-copy';
import { normalizeVertical } from '@cms/api-types';
import {
  CC_AUDIT_WINDOW,
  CC_SETTINGS_ACTIONS,
  isCcAdmin,
  useEmergencyReadiness,
  useRecentSettingsChanges,
} from '@/hooks/use-settings-cc';
import { SettingsPageFrame } from '../shell/SettingsPageFrame';
import { useSettingsShellActions, type SettingsSectionStatus } from '../shell/SettingsShellContext';
import {
  ContextModule, EditorHead, EditorSection, EditorSkeleton, ScopePath, StatusPill,
} from '../shell/primitives';
import {
  SETTINGS_SECTIONS, settingsHref, visibleSections,
  type SettingsSectionId,
} from '../shell/registry';

/**
 * How much a blocked category hurts day-to-day operation. Severity sorts
 * first; this breaks the tie (§7.1 "sorted by severity and operational
 * impact"). Life-safety leads, then the surfaces that stop content reaching
 * a screen, then account administration.
 */
const IMPACT_RANK: Record<SettingsSectionId, number> = {
  emergency: 0,
  player: 1,
  integrations: 2,
  billing: 3,
  people: 4,
  brand: 5,
  locations: 6,
  organization: 7,
  developer: 8,
  security: 9,
  overview: 10,
};

interface AttentionItem {
  id: string;
  severity: 'error' | 'attention';
  section: SettingsSectionId;
  title: string;
  detail: string;
}

/** Days out from expiry at which a license starts asking for attention. */
const LICENSE_EXPIRY_WARN_DAYS = 30;

export function SettingsOverviewPage() {
  const t = useTranslations();
  const { locale } = useLocaleSwitch();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const admin = isCcAdmin(role);
  const copy = useTenantCopy();
  const { navigate, setSectionStatus } = useSettingsShellActions();

  const { data: tenant, isLoading: tenantLoading } = useTenant();
  const tenantRow = tenant as { name?: string; parentId?: string | null; vertical?: string } | undefined;
  const tenantName = tenantRow?.name ?? '';
  const vertical = normalizeVertical(tenantRow?.vertical ?? copy.vertical);
  const industry = localizedVerticalIndustry(locale, vertical);

  const readiness = useEmergencyReadiness({ enabled: admin });
  const license = useLicense();
  const audit = useRecentSettingsChanges({ enabled: admin });

  // ── Attention items, each backed by a real server answer ──────────
  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    // Emergency: quote the server's own readiness items verbatim.
    for (const item of readiness.data?.items ?? []) {
      if (item.status === 'ok') continue;
      items.push({
        id: `emergency-${item.key}`,
        severity: item.status === 'missing' ? 'error' : 'attention',
        section: 'emergency',
        title: item.label,
        detail: [item.detail, item.fixHint].filter(Boolean).join(' '),
      });
    }

    // Billing: seats, status and expiry are the license facts that block
    // pairing a screen or keeping one paired.
    const lic = license.data;
    if (lic) {
      if (lic.atLimit) {
        items.push({
          id: 'license-at-limit',
          severity: 'error',
          section: 'billing',
          title: t('settings.cc.overview.licenseAtLimit'),
          detail: t('settings.cc.overview.licenseAtLimitDetail', { used: lic.seatsUsed, limit: lic.seatLimit }),
        });
      }
      if (lic.status && lic.status !== 'ACTIVE') {
        items.push({
          id: 'license-status',
          severity: 'error',
          section: 'billing',
          title: t('settings.cc.overview.licenseStatus', { status: lic.status }),
          detail: t('settings.cc.overview.licenseStatusDetail'),
        });
      }
      if (lic.expiresAt) {
        const days = Math.ceil((new Date(lic.expiresAt).getTime() - Date.now()) / 86_400_000);
        if (days <= LICENSE_EXPIRY_WARN_DAYS) {
          items.push({
            id: 'license-expiring',
            severity: days <= 0 ? 'error' : 'attention',
            section: 'billing',
            title: t('settings.cc.overview.licenseExpiring', { date: formatDate(lic.expiresAt, locale) }),
            detail: t('settings.cc.overview.licenseExpiringDetail'),
          });
        }
      }
    }

    return items.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return IMPACT_RANK[a.section] - IMPACT_RANK[b.section];
    });
  }, [readiness.data, license.data, t, locale]);

  // ── Index dots (§6.4: at most one indicator per section) ──────────
  // Only for sections we can PROVE something about. Cleared on unmount so a
  // dot never outlives the evidence behind it.
  const statusBySection = useMemo(() => {
    const map = new Map<SettingsSectionId, SettingsSectionStatus>();
    for (const item of attention) {
      const current = map.get(item.section);
      if (current === 'error') continue;
      map.set(item.section, item.severity === 'error' ? 'error' : 'attention');
    }
    return map;
  }, [attention]);

  useEffect(() => {
    const touched: SettingsSectionId[] = [];
    for (const [section, status] of statusBySection) {
      touched.push(section);
      setSectionStatus(section, status);
    }
    return () => {
      for (const section of touched) setSectionStatus(section, null);
    };
  }, [statusBySection, setSectionStatus]);

  const shortcuts = visibleSections(role).filter((s) => s.id !== 'overview');

  const readinessBusy = readiness.isLoading || readiness.isFetching;
  const verdict = readiness.data?.verdict;

  const settingsChanges = useMemo(() => {
    const rows = audit.data?.items ?? [];
    return rows.filter((r) => !!CC_SETTINGS_ACTIONS[r.action]).slice(0, 5);
  }, [audit.data]);

  // MEMOISED ON PURPOSE. <SettingsPageFrame> re-registers whenever any prop
  // identity changes, and registration is a setState on the provider — so a
  // context node rebuilt every render would re-register, re-render, rebuild,
  // forever. Same reason `save` and `searchItems` are memoised on the pages
  // that pass them.
  const context = useMemo(() => (
    <>
      <ContextModule label={t('settings.cc.overview.scopeOrgTitle')} title={tenantName || '—'}>
        {industry}
        <ScopePath
          from={tenantRow?.parentId ? t('settings.cc.overview.hierarchyChild') : t('settings.cc.overview.hierarchyPrimary')}
          to={copy.orgPlural}
        />
      </ContextModule>
      {admin && readiness.data && (
        <ContextModule label={t('settings.cc.overview.readinessTitle')}>
          {t('settings.cc.overview.computedAt', { time: formatDateTime(readiness.data.computedAt, locale) })}
        </ContextModule>
      )}
      {admin && (
        <ContextModule label={t('settings.cc.overview.changesTitle')}>
          <a
            href={`/${schoolId}/audit`}
            className="inline-flex items-center gap-1 underline underline-offset-2"
            style={{ color: 'var(--brand-primary)' }}
          >
            {t('settings.cc.overview.changesViewAll')}
          </a>
        </ContextModule>
      )}
    </>
    // `t` is intentionally NOT a dependency: next-intl memoises the
    // translator per locale, so `locale` already covers a language change,
    // and depending on the function identity would re-register on every
    // render — the loop this memo exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [tenantName, industry, tenantRow?.parentId, copy.orgPlural, admin, readiness.data, locale, schoolId]);

  return (
    <SettingsPageFrame
      section="overview"
      title={t('settings.shell.sections.overview.label')}
      description={t('settings.shell.sections.overview.description')}
      scope={{ kind: 'organization', label: tenantName }}
      context={context}
    >
      {tenantLoading && !tenantRow ? (
        <EditorSkeleton groups={3} />
      ) : (
        <>
          <EditorHead
            icon={Gauge}
            title={tenantName || t('settings.shell.sections.overview.label')}
            description={
              <>
                {industry}
                {' · '}
                {tenantRow?.parentId
                  ? t('settings.cc.overview.hierarchyChild')
                  : t('settings.cc.overview.hierarchyPrimary')}
              </>
            }
          />

          {/* 1 — Configuration readiness ------------------------------- */}
          <EditorSection
            id="cc-readiness"
            title={t('settings.cc.overview.readinessTitle')}
            description={t('settings.cc.overview.readinessDesc')}
            action={
              admin ? (
                <button
                  type="button"
                  onClick={() => readiness.refetch()}
                  disabled={readinessBusy}
                  className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${readinessBusy ? 'animate-spin' : ''}`} aria-hidden />
                  {t('settings.cc.overview.readinessRetry')}
                </button>
              ) : undefined
            }
          >
            {!admin ? (
              <p className="text-[13px] text-slate-500">{t('settings.cc.overview.readinessAdminOnly')}</p>
            ) : readiness.isLoading ? (
              <p className="flex items-center gap-2 text-[13px] text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                {t('settings.cc.overview.readinessChecking')}
              </p>
            ) : readiness.isError || !readiness.data ? (
              // The check failing IS information — report it as unknown, never
              // as healthy (§11 "Unknown": authoritative status is missing).
              <div className="flex items-start gap-2.5">
                <StatusPill kind="unknown" />
                <p className="text-[13px] text-slate-600">{t('settings.cc.overview.readinessFailed')}</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                {/* OFF is its own calm state (2026-09-24): the capability is
                    not on, so there is no verdict to grade and no "0 of 0
                    checks" to print. */}
                <StatusPill
                  kind={
                    verdict === 'READY' ? 'ready'
                      : verdict === 'DISABLED' ? 'notConfigured'
                        : verdict === 'NOT_CONFIGURED' ? 'blocked'
                          : 'attention'
                  }
                  label={
                    verdict === 'READY'
                      ? t('settings.cc.overview.verdictReady')
                      : verdict === 'DISABLED'
                        ? t('settings.cc.overview.verdictOff')
                        : verdict === 'NOT_CONFIGURED'
                          ? t('settings.cc.overview.verdictNotConfigured')
                          : t('settings.cc.overview.verdictAttention')
                  }
                />
                <span className="text-[13px] text-slate-600">
                  {verdict === 'DISABLED'
                    ? t('settings.cc.overview.readinessOff')
                    : t('settings.cc.overview.readinessChecksPassed', {
                        passed: readiness.data.items.filter((i) => i.status === 'ok').length,
                        total: readiness.data.items.length,
                      })}
                </span>
              </div>
            )}
          </EditorSection>

          {/* 2 — Needs attention --------------------------------------- */}
          <EditorSection
            id="cc-attention"
            title={t('settings.cc.overview.attentionTitle')}
            description={t('settings.cc.overview.attentionDesc')}
          >
            {attention.length === 0 ? (
              <p className="text-[13px] text-slate-500">
                {admin ? t('settings.cc.overview.attentionNone') : t('settings.cc.overview.readinessAdminOnly')}
              </p>
            ) : (
              <ul className="space-y-2">
                {attention.map((item) => {
                  const def = SETTINGS_SECTIONS.find((s) => s.id === item.section);
                  const Icon = item.severity === 'error' ? XCircle : AlertTriangle;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => navigate(settingsHref(schoolId, item.section))}
                        className="w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-[11px] border border-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                      >
                        <Icon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${item.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="block text-[13px] font-medium text-slate-900">{item.title}</strong>
                          <span className="block mt-0.5 text-[12px] leading-[17px] text-slate-500">{item.detail}</span>
                          {def && (
                            <span className="block mt-1 text-[12px] font-medium" style={{ color: 'var(--brand-primary)' }}>
                              {t('settings.cc.overview.attentionOpen', {
                                section: t(`settings.shell.sections.${def.labelKey}.label`),
                              })}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </EditorSection>

          {/* 3 — Recent settings changes ------------------------------- */}
          <EditorSection
            id="cc-changes"
            title={t('settings.cc.overview.changesTitle')}
            description={t('settings.cc.overview.changesDesc')}
          >
            {!admin ? (
              <p className="text-[13px] text-slate-500">{t('settings.cc.overview.changesAdminOnly')}</p>
            ) : audit.isLoading ? (
              <p className="flex items-center gap-2 text-[13px] text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                {t('settings.common.loadingEllipsis')}
              </p>
            ) : audit.isError ? (
              <p className="text-[13px] text-slate-500">{t('settings.cc.overview.changesUnavailable')}</p>
            ) : settingsChanges.length === 0 ? (
              <p className="text-[13px] text-slate-500">
                {t('settings.cc.overview.changesNone', { count: CC_AUDIT_WINDOW })}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {settingsChanges.map((row) => (
                  <li key={row.id} className="flex items-start gap-2.5 text-[12px] leading-[17px]">
                    <History className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <strong className="font-medium text-slate-900">{row.action}</strong>
                      <span className="text-slate-500">
                        {' · '}
                        {row.user?.email ?? t('settings.cc.overview.changesSystemActor')}
                        {' · '}
                        {formatDateTime(row.createdAt, locale)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </EditorSection>

          {/* 4 — Shortcuts --------------------------------------------- */}
          <EditorSection
            id="cc-shortcuts"
            title={t('settings.cc.overview.shortcutsTitle')}
            description={t('settings.cc.overview.shortcutsDesc')}
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              {shortcuts.map((section) => {
                const Icon = section.icon;
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => navigate(settingsHref(schoolId, section))}
                      className="w-full flex items-center gap-2.5 text-left min-h-[44px] px-3 rounded-[11px] border border-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                    >
                      <Icon className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                      <span className="text-[13px] font-medium text-slate-800 truncate">
                        {t(`settings.shell.sections.${section.labelKey}.label`)}
                      </span>
                      {statusBySection.get(section.id) === 'error' ? (
                        <XCircle className="w-3.5 h-3.5 ml-auto text-red-600 shrink-0" aria-hidden />
                      ) : statusBySection.get(section.id) === 'attention' ? (
                        <AlertTriangle className="w-3.5 h-3.5 ml-auto text-amber-600 shrink-0" aria-hidden />
                      ) : (
                        <ChevronRight className="w-4 h-4 ml-auto text-slate-400 shrink-0" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </EditorSection>
        </>
      )}
    </SettingsPageFrame>
  );
}

/** Locale-aware date, defensive about a malformed server string. */
function formatDate(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatDateTime(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
