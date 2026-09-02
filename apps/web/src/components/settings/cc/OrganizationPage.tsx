"use client";

/**
 * Settings Command Center — Organization (§7.2).
 *
 * One job: who this organization IS and what every location starts from.
 *   · Identity — name + address (PATCH /tenants/me, the only fields that
 *     endpoint accepts; there is no Tenant locale/time-zone column, so no
 *     regional block is invented here — see the report's open questions).
 *   · Industry — the vertical switch, extracted from VerticalSwitcherCard.
 *     Same endpoint, same role gate, same cached-user repair + reload; what
 *     is NEW is the confirmation that lists the changes we can actually
 *     prove (§7.2: "require a confirmation that lists known visible
 *     changes. Never silently rewrite saved user content.").
 *   · Organization defaults — the standard LED poster size, mounted as-is
 *     so its behaviour, its role gate and its tests are preserved.
 *
 * Save model (§13.1): no optimistic success. Save awaits the server, then
 * RE-READS `/tenants` before the form goes pristine, so "saved" always means
 * the server said so.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Building2, ArrowRightLeft } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { useTenant } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { localizedVerticalIndustry } from '@/i18n/vertical-copy';
import {
  VERTICALS, VERTICAL_EMERGENCY_TYPES, VERTICAL_TEMPLATE_CATEGORIES,
  isVertical, normalizeVertical, type Vertical,
} from '@cms/api-types';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { LedPosterStandardCard } from '../LedPosterStandardCard';
import { isCcOrgAdmin, useLastChange, useTenantChildren } from '@/hooks/use-settings-cc';
import { SettingsPageFrame } from '../shell/SettingsPageFrame';
import {
  ContextModule, EditorHead, EditorSection, EditorSkeleton, ErrorSummary, PermissionDenied,
} from '../shell/primitives';

interface TenantRow {
  id?: string;
  name?: string;
  address?: string | null;
  vertical?: string;
  parentId?: string | null;
}

export function SettingsOrganizationPage() {
  const t = useTranslations();
  const { locale } = useLocaleSwitch();
  const qc = useQueryClient();
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const canEdit = isCcOrgAdmin(role);
  const copy = useTenantCopy();

  const { data, isLoading, refetch } = useTenant();
  const tenant = data as TenantRow | undefined;
  const serverName = tenant?.name ?? '';
  const serverAddress = tenant?.address ?? '';
  const vertical = normalizeVertical(tenant?.vertical ?? copy.vertical);

  // Local edits. `null` = untouched, so a server refresh underneath the
  // operator never clobbers a field they are typing in.
  const [name, setName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ message: string; fieldId?: string }[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);

  const [pendingVertical, setPendingVertical] = useState<Vertical | null>(null);
  const [verticalBusy, setVerticalBusy] = useState(false);
  const [verticalError, setVerticalError] = useState<string | null>(null);

  const children = useTenantChildren({ enabled: canEdit });
  const lastChange = useLastChange('TENANT_UPDATED', { enabled: canEdit });

  const nameValue = name ?? serverName;
  const addressValue = address ?? serverAddress;
  const dirtyFields = useMemo(() => {
    let n = 0;
    if (name !== null && name.trim() !== serverName) n += 1;
    if (address !== null && address.trim() !== (serverAddress ?? '')) n += 1;
    return n;
  }, [name, address, serverName, serverAddress]);

  const discard = useCallback(() => {
    setName(null);
    setAddress(null);
    setLat(null);
    setLon(null);
    setErrors([]);
  }, []);

  const save = useCallback(async () => {
    if (dirtyFields === 0) return;
    const trimmedName = (name ?? serverName).trim();
    if (!trimmedName) {
      setErrors([{ message: t('settings.cc.organization.nameRequired'), fieldId: 'cc-org-name' }]);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (name !== null && trimmedName !== serverName) body.name = trimmedName;
      if (address !== null && address.trim() !== (serverAddress ?? '')) {
        body.address = address.trim();
        // Coordinates ride along ONLY when this edit session picked a
        // suggestion; a freehand string leaves the server's own null-out to
        // invalidate the stale coords.
        if (lat !== null) body.latitude = lat;
        if (lon !== null) body.longitude = lon;
      }
      await apiFetch('/tenants/me', { method: 'PATCH', body: JSON.stringify(body) });
      // Re-read authoritative state BEFORE the form goes pristine (§13.1).
      await qc.invalidateQueries({ queryKey: ['tenant'] });
      await refetch();
      await qc.invalidateQueries({ queryKey: ['audit'] });
      discard();
    } catch (e) {
      const message = (e as { message?: string })?.message || t('settings.cc.organization.saveFailed');
      setErrors([{ message }]);
      requestAnimationFrame(() => errorRef.current?.focus());
      throw e;
    } finally {
      setSaving(false);
    }
  }, [dirtyFields, name, address, lat, lon, serverName, serverAddress, qc, refetch, discard, t]);

  /**
   * Extracted from VerticalSwitcherCard (2026-05-25 fixes intact): the
   * cached `edu_cms_user` copy carries the OLD vertical, so it is repaired
   * before the reload or the page comes back showing the previous industry.
   */
  const commitVertical = useCallback(async (next: Vertical) => {
    setVerticalBusy(true);
    setVerticalError(null);
    try {
      await apiFetch('/tenants/me', { method: 'PATCH', body: JSON.stringify({ vertical: next }) });
      try {
        const USER_KEY = 'edu_cms_user';
        const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        const ls = typeof localStorage !== 'undefined' ? localStorage : null;
        const raw = ss?.getItem(USER_KEY) || ls?.getItem(USER_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.tenantVertical = next;
          const updated = JSON.stringify(parsed);
          ss?.setItem(USER_KEY, updated);
          if (ls?.getItem(USER_KEY)) ls.setItem(USER_KEY, updated);
        }
        const current = useUIStore.getState().user;
        if (current) useUIStore.setState({ user: { ...current, tenantVertical: next } });
      } catch {
        /* private mode / quota — the reload re-reads from the server anyway */
      }
      window.location.reload();
    } catch (e) {
      setVerticalError((e as { message?: string })?.message || t('settings.cc.organization.industryFailed'));
      setVerticalBusy(false);
      setPendingVertical(null);
    }
  }, [t]);

  const locationCount = children.data?.children.length ?? 0;
  const lastChangeRow = lastChange.data?.items?.[0];

  // MEMOISED ON PURPOSE — see OverviewPage: <SettingsPageFrame> re-registers
  // on prop identity, and registration is a provider setState, so a node
  // rebuilt every render would loop. Declared BEFORE the permission return so
  // the hook order never changes (rules-of-hooks).
  const context = useMemo(() => (
    <>
      <ContextModule
        label={t('settings.cc.organization.appliesTo')}
        title={serverName || '—'}
      >
        {children.isSuccess
          ? t('settings.cc.organization.appliesToBody', { count: locationCount })
          : t('settings.cc.organization.appliesToUnknown')}
      </ContextModule>
      <ContextModule label={t('settings.cc.organization.vocabTitle')} title={localizedVerticalIndustry(locale, vertical)}>
        <span className="block">{t('settings.cc.organization.vocabAccount', { value: copy.orgSingular })}</span>
        <span className="block">{t('settings.cc.organization.vocabTop', { value: copy.groupSingular })}</span>
        <span className="block">
          {t('settings.cc.organization.vocabTemplates', {
            value: VERTICAL_TEMPLATE_CATEGORIES[vertical].slice(0, 3).map((c) => c.label).join(', '),
          })}
        </span>
      </ContextModule>
      <ContextModule label={t('settings.cc.organization.lastChanged')}>
        {lastChangeRow
          ? t('settings.cc.organization.lastChangedBy', {
              who: lastChangeRow.user?.email ?? t('settings.cc.organization.lastChangedSystem'),
              time: new Date(lastChangeRow.createdAt).toLocaleString(locale),
            })
          : t('settings.cc.organization.lastChangedUnknown')}
      </ContextModule>
    </>
    // `t` is deliberately out of the deps — see OverviewPage; `locale` is
    // the dependency that actually changes when the language does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [locale, serverName, children.isSuccess, locationCount, vertical, copy.orgSingular, copy.groupSingular, lastChangeRow]);

  const saveState = useMemo(
    () => ({ dirty: dirtyFields, saving, onSave: save, onDiscard: discard }),
    [dirtyFields, saving, save, discard],
  );

  const searchItems = useMemo(
    () => [
      { label: t('settings.cc.organization.nameLabel'), anchor: 'cc-org-identity' },
      { label: t('settings.cc.organization.addressLabel'), anchor: 'cc-org-identity' },
      { label: t('settings.cc.organization.industryTitle'), anchor: 'cc-org-industry', keywords: ['vertical'] },
      { label: t('settings.cc.organization.defaultsTitle'), anchor: 'cc-org-defaults', keywords: ['led', 'poster'] },
    ],
    // `t` omitted deliberately (see the context memo above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  if (!canEdit) {
    return (
      <SettingsPageFrame
        section="organization"
        title={t('settings.shell.sections.organization.label')}
        description={t('settings.shell.sections.organization.description')}
        scope={{ kind: 'organization', label: serverName }}
      >
        <PermissionDenied sectionLabel={t('settings.shell.sections.organization.label')} />
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame
      section="organization"
      title={t('settings.shell.sections.organization.label')}
      description={t('settings.shell.sections.organization.description')}
      scope={{ kind: 'organization', label: serverName }}
      save={saveState}
      context={context}
      searchItems={searchItems}
    >
      {isLoading && !tenant ? (
        <EditorSkeleton groups={3} />
      ) : (
        <>
          <div ref={errorRef} tabIndex={-1}>
            <ErrorSummary errors={errors} title={t('settings.cc.organization.saveFailed')} />
          </div>

          <EditorHead
            icon={Building2}
            title={serverName || t('settings.shell.sections.organization.label')}
            description={localizedVerticalIndustry(locale, vertical)}
          />

          {/* 1 — Identity ---------------------------------------------- */}
          <EditorSection
            id="cc-org-identity"
            title={t('settings.cc.organization.identityTitle')}
            description={t('settings.cc.organization.identityDesc')}
          >
            <div className="space-y-3.5 max-w-[520px]">
              <div>
                <label htmlFor="cc-org-name" className="block text-[12px] font-medium text-slate-600 mb-1">
                  {t('settings.cc.organization.nameLabel')}
                </label>
                <input
                  id="cc-org-name"
                  type="text"
                  value={nameValue}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-1"
                />
              </div>
              <div>
                <label htmlFor="cc-org-address" className="block text-[12px] font-medium text-slate-600 mb-1">
                  {t('settings.cc.organization.addressLabel')}{' '}
                  <span className="font-normal text-slate-400">{t('settings.cc.organization.addressOptional')}</span>
                </label>
                <AddressAutocomplete
                  id="cc-org-address"
                  value={addressValue}
                  onChange={(v) => {
                    setAddress(v);
                    if (lat !== null || lon !== null) { setLat(null); setLon(null); }
                  }}
                  onPick={(p) => {
                    setAddress(p.displayName);
                    setLat(p.latitude);
                    setLon(p.longitude);
                  }}
                />
                <p className="mt-1 text-[12px] text-slate-500">{t('settings.cc.organization.addressHelp')}</p>
              </div>
            </div>
          </EditorSection>

          {/* 2 — Industry ---------------------------------------------- */}
          <EditorSection
            id="cc-org-industry"
            title={t('settings.cc.organization.industryTitle')}
            description={t('settings.cc.organization.industryDesc')}
          >
            <div className="flex flex-wrap items-end gap-3 max-w-[520px]">
              <div className="min-w-[240px] flex-1">
                <label htmlFor="cc-org-vertical" className="block text-[12px] font-medium text-slate-600 mb-1">
                  {t('settings.cc.organization.industryLabel')}
                </label>
                <select
                  id="cc-org-vertical"
                  value={vertical}
                  disabled={verticalBusy}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (isVertical(next) && next !== vertical) setPendingVertical(next);
                  }}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-1"
                >
                  {/* QSR and RESTAURANT read identically in the picker; the
                      full-service entry stays hidden unless already selected. */}
                  {VERTICALS.filter((v) => v !== 'RESTAURANT' || vertical === 'RESTAURANT').map((v) => (
                    <option key={v} value={v}>{localizedVerticalIndustry(locale, v)}</option>
                  ))}
                </select>
              </div>
            </div>
            {verticalError && (
              <p role="alert" className="mt-2 text-[12px] text-red-700">{verticalError}</p>
            )}
          </EditorSection>

          {/* 3 — Organization defaults --------------------------------- */}
          <EditorSection
            id="cc-org-defaults"
            title={t('settings.cc.organization.defaultsTitle')}
            description={t('settings.cc.organization.defaultsDesc')}
          >
            <LedPosterStandardCard />
          </EditorSection>

          {/* High-impact confirmation (§13.3): names the scope and lists the
              changes we can actually prove, then reloads. */}
          {pendingVertical && (
            <div className="fixed top-0 right-0 bottom-0 left-0 z-[130] grid place-items-center px-4 bg-slate-900/40">
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="cc-vertical-title"
                aria-describedby="cc-vertical-body"
                className="w-full max-w-[460px] rounded-[14px] bg-white border border-slate-200 shadow-2xl p-5"
              >
                <h2 id="cc-vertical-title" className="flex items-center gap-2 text-[15px] font-medium text-slate-900">
                  <ArrowRightLeft className="w-4 h-4 text-slate-500" aria-hidden />
                  {t('settings.cc.organization.industryConfirmTitle', {
                    vertical: localizedVerticalIndustry(locale, pendingVertical),
                  })}
                </h2>
                <div id="cc-vertical-body" className="mt-2 text-[13px] leading-[19px] text-slate-600">
                  <p>{t('settings.cc.organization.industryConfirmBody')}</p>
                  <ul className="mt-2.5 space-y-1.5 list-disc pl-5">
                    <li>
                      {t('settings.cc.organization.industryConfirmTemplates', {
                        list: VERTICAL_TEMPLATE_CATEGORIES[pendingVertical].map((c) => c.label).join(', '),
                      })}
                    </li>
                    <li>
                      {t('settings.cc.organization.industryConfirmAlerts', {
                        list: VERTICAL_EMERGENCY_TYPES[pendingVertical]
                          .map((k) => t(`settings.cc.organization.alertTypes.${k}`))
                          .join(', '),
                      })}
                    </li>
                    <li>{t('settings.cc.organization.industryConfirmContent')}</li>
                    <li>{t('settings.cc.organization.industryConfirmReload')}</li>
                  </ul>
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingVertical(null)}
                    disabled={verticalBusy}
                    className="min-h-[42px] px-3.5 rounded-[10px] border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('settings.common.cancel')}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => commitVertical(pendingVertical)}
                    disabled={verticalBusy}
                    className="min-h-[42px] px-3.5 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)] disabled:opacity-60"
                    style={{ background: 'var(--brand-primary)' }}
                  >
                    {verticalBusy ? t('settings.common.saving') : t('settings.cc.organization.industryConfirmCta')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </SettingsPageFrame>
  );
}
