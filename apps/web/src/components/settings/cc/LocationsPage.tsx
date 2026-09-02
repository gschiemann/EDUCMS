"use client";

/**
 * Settings Command Center — Locations (§7.3).
 *
 * Organization STRUCTURE, not screen monitoring: who exists under the
 * primary account, what each one is called, and how to open it. Screen
 * health stays on Dashboard/Screens (§7.3), so no status lives here — only
 * the counts `GET /tenants/children` already returns.
 *
 * Extracted from DistrictSchoolsCard with its behaviour intact:
 *   · DISTRICT_ADMIN / SUPER_ADMIN only — the same gate the server puts on
 *     /tenants/children, /tenants/children (POST) and /tenants/:id/archive.
 *     Any other role gets the permission page, not an empty list.
 *   · Two-tap remove (2026-08-30 launch fix) → POST /tenants/:id/archive,
 *     a reversible soft delete that preserves screens and users.
 *   · Opening a location goes through useTenantSwitch, never a bare link —
 *     a bare <Link> changes the URL without re-issuing the JWT, which is
 *     what made a child render the parent's branding (2026-05-11).
 *   · The slug is derived from the name silently; there is no slug field.
 *
 * Vertical-aware copy comes from useTenantCopy, which unifies every
 * vertical to Location / Primary (operator decision 2026-06-01) — so this
 * page never says "school" to a gym.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  MapPin, Home, Plus, Loader2, MonitorPlay, Users, ExternalLink, Trash2, AlertTriangle, Pencil,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { useTenant } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { getVerticalSample, normalizeVertical } from '@cms/api-types';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { isCcOrgAdmin, useTenantChildren } from '@/hooks/use-settings-cc';
import { SettingsPageFrame } from '../shell/SettingsPageFrame';
import { useSettingsShellActions } from '../shell/SettingsShellContext';
import {
  ContextModule, ContextAction, EditorHead, EditorSection, EditorSkeleton, ErrorSummary,
  PermissionDenied, ScopePath, SectionAction,
} from '../shell/primitives';
import { settingsHref } from '../shell/registry';

export function SettingsLocationsPage() {
  const t = useTranslations();
  const { locale } = useLocaleSwitch();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const canManage = isCcOrgAdmin(role);
  const copy = useTenantCopy();
  const { navigate } = useSettingsShellActions();

  const { data: tenantData, isLoading: tenantLoading } = useTenant();
  const tenant = tenantData as { name?: string; address?: string | null; vertical?: string } | undefined;
  const primaryName = tenant?.name ?? '';
  const sample = getVerticalSample(normalizeVertical(tenant?.vertical ?? copy.vertical));

  const children = useTenantChildren({ enabled: canManage });
  const { switchToTenant, switchingId, error: switchError } = useTenantSwitch();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const lastAutoSlug = useRef('');
  const [slug, setSlug] = useState('');

  const rows = useMemo(() => children.data?.children ?? [], [children.data]);

  const onNameChange = useCallback((v: string) => {
    setName(v);
    const auto = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    setSlug((prev) => (!prev || prev === lastAutoSlug.current ? auto : prev));
    lastAutoSlug.current = auto;
  }, []);

  const resetForm = useCallback(() => {
    setAdding(false);
    setName('');
    setSlug('');
    setAddress('');
    setLat(null);
    setLon(null);
    setFormError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setFormError(t('settings.cc.locations.nameRequired'));
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch('/tenants/children', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          address: address.trim() || undefined,
          latitude: lat ?? undefined,
          longitude: lon ?? undefined,
        }),
      });
      resetForm();
      await children.refetch();
    } catch (e) {
      setFormError((e as { message?: string })?.message || t('settings.cc.locations.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [name, slug, address, lat, lon, resetForm, children, t]);

  const removeChild = useCallback(async (id: string) => {
    setRemoveError(null);
    setRemovingId(id);
    try {
      await apiFetch(`/tenants/${id}/archive`, { method: 'POST' });
      setConfirmRemoveId(null);
      await children.refetch();
    } catch (e) {
      setRemoveError((e as { message?: string })?.message || t('settings.cc.locations.removeFailed'));
    } finally {
      setRemovingId(null);
    }
  }, [children, t]);

  const total = rows.length + 1; // the primary account is itself a location

  // MEMOISED ON PURPOSE — see OverviewPage. Declared before the permission
  // return so the hook order is identical on every render.
  const context = useMemo(() => (
    <>
      <ContextModule
        label={t('settings.cc.locations.countLabel')}
        title={children.isSuccess ? t('settings.cc.locations.countValue', { count: total }) : '—'}
      >
        {children.isError ? t('settings.cc.locations.loadFailed') : t('settings.cc.locations.countHelp')}
      </ContextModule>
      <ContextModule label={t('settings.cc.locations.scopeLabel')} title={primaryName || '—'}>
        <ScopePath from={copy.groupSingular} to={t('settings.cc.locations.allLocations')} />
      </ContextModule>
      <ContextModule label={t('settings.cc.locations.screensLabel')}>
        {t('settings.cc.locations.screensHelp')}
        <ContextAction href={`/${schoolId}/screens`}>{t('settings.cc.locations.manageScreens')}</ContextAction>
      </ContextModule>
    </>
    // `t` is deliberately out of the deps — see OverviewPage; `locale` is
    // the dependency that actually changes when the language does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [locale, children.isSuccess, children.isError, total, primaryName, copy.groupSingular, schoolId]);

  if (!canManage) {
    return (
      <SettingsPageFrame
        section="locations"
        title={t('settings.shell.sections.locations.label')}
        description={t('settings.shell.sections.locations.description')}
        scope={{ kind: 'organization', label: primaryName }}
      >
        <PermissionDenied
          sectionLabel={t('settings.shell.sections.locations.label')}
          grantedBy={t('settings.cc.locations.requiresPrimaryAdmin')}
        />
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame
      section="locations"
      title={t('settings.shell.sections.locations.label')}
      description={t('settings.shell.sections.locations.description')}
      scope={{ kind: 'organization', label: primaryName }}
      context={context}
    >
      {tenantLoading && children.isLoading ? (
        <EditorSkeleton groups={2} />
      ) : (
        <>
          <EditorHead
            icon={MapPin}
            title={t('settings.cc.locations.listTitle')}
            description={t('settings.cc.locations.listDesc')}
          />

          <EditorSection
            id="cc-locations-list"
            title={t('settings.cc.locations.structureTitle')}
            description={t('settings.cc.locations.structureDesc')}
            action={
              !adding ? (
                <SectionAction onClick={() => { setAdding(true); setFormError(null); }}>
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  {t('settings.cc.locations.add')}
                </SectionAction>
              ) : undefined
            }
          >
            {adding && (
              <div className="mb-3 rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                <ErrorSummary
                  errors={formError ? [{ message: formError }] : []}
                  title={t('settings.cc.locations.createFailed')}
                />
                <div>
                  <label htmlFor="cc-loc-name" className="block text-[12px] font-medium text-slate-600 mb-1">
                    {t('settings.cc.locations.nameLabel')}
                  </label>
                  <input
                    id="cc-loc-name"
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder={sample.exampleName}
                    className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-1"
                  />
                </div>
                <div>
                  <label htmlFor="cc-loc-address" className="block text-[12px] font-medium text-slate-600 mb-1">
                    {t('settings.cc.locations.addressLabel')}{' '}
                    <span className="font-normal text-slate-400">{t('settings.cc.locations.addressOptional')}</span>
                  </label>
                  <AddressAutocomplete
                    id="cc-loc-address"
                    value={address}
                    onChange={(v) => {
                      setAddress(v);
                      if (lat !== null || lon !== null) { setLat(null); setLon(null); }
                    }}
                    onPick={(p) => { setAddress(p.displayName); setLat(p.latitude); setLon(p.longitude); }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={submitting}
                    className="min-h-[38px] px-3 rounded-[9px] border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-white"
                  >
                    {t('settings.common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || !name.trim()}
                    className="min-h-[38px] px-3 rounded-[9px] text-[13px] font-medium text-[var(--brand-primary-ink)] disabled:opacity-60 inline-flex items-center gap-1.5"
                    style={{ background: 'var(--brand-primary)' }}
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
                    {t('settings.cc.locations.create')}
                  </button>
                </div>
              </div>
            )}

            {switchError && (
              <p role="alert" className="mb-2 text-[12px] text-red-700">{switchError}</p>
            )}
            {removeError && (
              <p role="alert" className="mb-2 text-[12px] text-red-700">{removeError}</p>
            )}
            {children.isError && (
              <p role="alert" className="mb-2 text-[12px] text-red-700">{t('settings.cc.locations.loadFailed')}</p>
            )}

            <ul className="space-y-2">
              {/* The primary account is always the first location. Its name and
                  address are edited in Organization — one job per editor — so
                  this row links there rather than owning a second form. */}
              <li className="flex items-center gap-3 min-h-[56px] px-3 py-2 rounded-[11px] border border-slate-200 bg-slate-50/60">
                <Home className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] font-medium text-slate-900 truncate">
                    {primaryName || '—'}
                    <span className="ml-2 align-middle text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                      {t('settings.cc.locations.primaryBadge')}
                    </span>
                  </strong>
                  <span className="block text-[12px] text-slate-500 truncate">
                    {tenant?.address || t('settings.cc.locations.noAddress')}
                  </span>
                </span>
                <span className="text-[12px] text-slate-500 shrink-0 hidden sm:inline">
                  {t('settings.cc.locations.youAreHere')}
                </span>
                <button
                  type="button"
                  onClick={() => navigate(settingsHref(schoolId, 'organization'))}
                  className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-[9px] border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-white"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden />
                  {t('settings.cc.locations.editPrimary')}
                </button>
              </li>

              {rows.map((row) => {
                const isSwitching = switchingId === row.id;
                const isConfirming = confirmRemoveId === row.id;
                const isRemoving = removingId === row.id;
                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-2 min-h-[56px] px-3 py-2 rounded-[11px] border border-slate-200 hover:bg-slate-50"
                  >
                    <button
                      type="button"
                      onClick={() => switchToTenant({ id: row.id, slug: row.slug })}
                      disabled={!!switchingId || isRemoving}
                      className="flex-1 min-w-0 flex items-center justify-between gap-4 text-left disabled:opacity-60 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-[9px]"
                    >
                      <span className="min-w-0">
                        <strong className="block text-[13px] font-medium text-slate-900 truncate">{row.name}</strong>
                        <span className="block text-[12px] text-slate-500 font-mono truncate">/{row.slug}</span>
                      </span>
                      <span className="flex items-center gap-3 text-[12px] text-slate-500 shrink-0">
                        <span className="inline-flex items-center gap-1">
                          <MonitorPlay className="w-3.5 h-3.5" aria-hidden />
                          {row._count.screens}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" aria-hidden />
                          {row._count.users}
                        </span>
                        {isSwitching ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                        ) : (
                          <ExternalLink className="w-4 h-4 text-slate-400" aria-hidden />
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => (isConfirming ? removeChild(row.id) : (setConfirmRemoveId(row.id), setRemoveError(null)))}
                      onBlur={() => { if (isConfirming && !isRemoving) setConfirmRemoveId(null); }}
                      disabled={isRemoving || !!switchingId}
                      aria-label={t('settings.cc.locations.removeLabel', { name: row.name })}
                      className={
                        isConfirming
                          ? 'shrink-0 inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-[9px] bg-red-600 text-white text-[12px] font-medium hover:bg-red-700'
                          : 'shrink-0 grid place-items-center w-9 h-9 rounded-[9px] text-slate-400 hover:text-red-600 hover:bg-red-50'
                      }
                    >
                      {isRemoving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      ) : isConfirming ? (
                        t('settings.cc.locations.removeConfirm')
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {children.isSuccess && rows.length === 0 && (
              <p className="mt-3 text-[12px] text-slate-500">{t('settings.cc.locations.empty')}</p>
            )}

            <p className="mt-3 flex items-start gap-2 text-[12px] leading-[17px] text-slate-500">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" aria-hidden />
              {t('settings.cc.locations.archiveNote')}
            </p>
          </EditorSection>
        </>
      )}
    </SettingsPageFrame>
  );
}
