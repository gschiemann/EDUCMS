"use client";

/**
 * /[schoolId]/settings/branding — Brand & appearance (Settings Command
 * Center §7.4).
 *
 * Structure, order, copy tone and measurements come from the approved
 * prototype: scratch/design/settings-page/venueos-settings-command-center-v2.html
 * (type lifted to the production floor in handoff §17).
 *
 * The shell owns breadcrumb / H1 / purpose / Discard / Save / index /
 * context rail / dirty guard / ⌘K palette. This page owns data,
 * mutations, validation and its own error summary.
 *
 * Honesty notes (§3, §9.4, §11) — every one of these is load-bearing:
 *  - There is NO parent→child brand inheritance in the API. `/branding/me`
 *    reads the caller's own tenant row and never falls back to a parent, so
 *    the copy says the brand does not cascade and the badge stays
 *    "Organization default" — we do not invent an inheritance model.
 *  - Semantic colors (success / warn / danger) are fixed constants in the
 *    server's derivePalette; this page never sends them.
 *  - There is no logo-only delete on the API (DELETE /branding/me wipes the
 *    row), so the destructive action is labelled "Remove brand" and its
 *    confirmation names the real impact.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Palette, Sparkles, CircleDashed, Loader2, ImageOff, Trash2, Wand2 } from 'lucide-react';

import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import {
  useTenant,
  useTenantBranding,
  useInvalidateTenantBranding,
  useApplyBrandToTemplates,
  useAuditLog,
} from '@/hooks/use-api';
import { BrandingWizard, type BrandingPreview } from '@/components/branding/BrandingWizard';
import { BrandingSettingsCard } from '@/components/settings/BrandingSettingsCard';
import { pushBrandingPreview } from '@/components/branding/BrandStyleInjector';
import { derivePaletteClient } from '@/components/branding/palette-client';
import { brandDefaultPalette, type BrandPalette, type TenantBranding } from '@/lib/branding';
import { getClientBrand } from '@/lib/brand';
import {
  SettingsPageFrame,
  EditorHead,
  EditorSection,
  SectionAction,
  InheritanceBadge,
  ContextModule,
  ContextAction,
  ScopePath,
  ChoiceRow,
  ErrorSummary,
  EditorSkeleton,
  type SettingsSearchItem,
} from '@/components/settings/shell';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const EDIT_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];
const ERROR_SUMMARY_ID = 'brand-error-summary';

/** The prototype's five swatches. The tenant's own primary is appended live. */
const SWATCHES: readonly { hex: string; labelKey: string }[] = [
  { hex: '#3D20DF', labelKey: 'swatchPurple' },
  { hex: '#7037D9', labelKey: 'swatchViolet' },
  { hex: '#243657', labelKey: 'swatchNavy' },
  { hex: '#087B70', labelKey: 'swatchTeal' },
  { hex: '#BD7C09', labelKey: 'swatchGold' },
];

function initialsFor(name: string | null | undefined): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** File extension → display format. Returns null when the URL says nothing. */
function formatFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.split('?')[0].split('#')[0].match(/\.([a-z0-9]{2,5})$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === 'jpeg') return 'JPG';
  if (['png', 'jpg', 'svg', 'webp', 'gif', 'avif'].includes(ext)) return ext.toUpperCase();
  return null;
}

function fileNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const last = url.split('?')[0].split('#')[0].split('/').pop();
  return last ? decodeURIComponent(last) : null;
}

export default function SettingsBrandingPage() {
  const t = useTranslations();
  const tenantCopy = useTenantCopy();
  const role = useUIStore((s) => (s.user as { role?: string } | undefined)?.role);
  const canEdit = !!role && EDIT_ROLES.includes(role);
  const isOrgAdmin = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN';

  const { data: tenant } = useTenant();
  const { data: branding, isLoading, refetch } = useTenantBranding();
  const invalidateBranding = useInvalidateTenantBranding();
  const applyBrand = useApplyBrandToTemplates();

  const orgName =
    (branding?.displayName as string | undefined) ||
    ((tenant as { name?: string } | undefined)?.name ?? '') ||
    tenantCopy.defaultBrandName;

  // ── Counts for the rail. Both are real reads; anything we cannot get is
  // omitted rather than guessed (§11).
  const { data: childrenData } = useQuery<{ children?: unknown[] }>({
    queryKey: ['tenants', 'children'],
    queryFn: () => apiFetch('/tenants/children'),
    enabled: isOrgAdmin,
    staleTime: 60_000,
  });
  const locationCount = Array.isArray(childrenData?.children) ? childrenData!.children!.length : null;
  // Same query key the fleet uses, but this observer never polls — a settings
  // page must not add a background timer (mobile perf standard).
  const { data: screens } = useQuery<unknown[]>({
    queryKey: ['screens'],
    queryFn: () => apiFetch('/screens'),
    staleTime: 60_000,
  });
  const screenCount = Array.isArray(screens) ? screens.length : null;

  // ── Baseline (server) values ──────────────────────────────────
  const vendorPalette = useMemo(() => brandDefaultPalette(getClientBrand().colors), []);
  const serverPrimary = (branding?.palette?.primary as string | undefined) || null;
  const basePrimary = (serverPrimary || vendorPalette.primary).toUpperCase();
  const baseAppearance: 'branded' | 'neutral' = branding?.appearanceMode === 'neutral' ? 'neutral' : 'branded';
  const serverAccent = (branding?.palette?.accent as string | undefined) || undefined;

  // ── Local, unsaved edits ──────────────────────────────────────
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [hexText, setHexText] = useState<string | null>(null);
  const [appearanceDraft, setAppearanceDraft] = useState<'branded' | 'neutral' | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ message: string; fieldId?: string }[]>([]);
  const [logoEditorOpen, setLogoEditorOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [logoDims, setLogoDims] = useState<{ w: number; h: number } | null>(null);

  const effColor = (colorDraft ?? basePrimary).toUpperCase();
  const effAppearance = appearanceDraft ?? baseAppearance;
  const colorChanged = colorDraft !== null && colorDraft.toUpperCase() !== basePrimary;
  const appearanceChanged = appearanceDraft !== null && appearanceDraft !== baseAppearance;
  const changeCount = (colorChanged ? 1 : 0) + (appearanceChanged ? 1 : 0);
  const hexInvalid = hexText !== null && !HEX_RE.test(hexText.trim());

  /** Full local palette for the preview — same math the server runs on save. */
  const previewPalette = useMemo<BrandPalette>(() => {
    try {
      return derivePaletteClient(effColor, serverAccent) as unknown as BrandPalette;
    } catch {
      return (branding?.palette || vendorPalette) as BrandPalette;
    }
  }, [effColor, serverAccent, branding?.palette, vendorPalette]);

  /** The chrome colors the app will actually paint — neutral keeps the vendor's. */
  const chromeColor = effAppearance === 'neutral' ? vendorPalette.primary : effColor;
  const chromeColorDeep =
    (effAppearance === 'neutral' ? vendorPalette.primaryHover : previewPalette.primaryHover) || chromeColor;

  // ── Live preview (local only; publish happens on Save, §7.4) ──
  const brandingRef = useRef<TenantBranding | null | undefined>(branding);
  brandingRef.current = branding;
  const previewingRef = useRef(false);

  const restoreServerPaint = useCallback(() => {
    if (!previewingRef.current) return;
    previewingRef.current = false;
    const row = brandingRef.current;
    pushBrandingPreview(row ? { ...row } : { palette: vendorPalette, appearanceMode: 'branded' });
  }, [vendorPalette]);

  useEffect(() => {
    if (!changeCount) return;
    previewingRef.current = true;
    pushBrandingPreview({
      ...(branding || {}),
      palette: { ...(branding?.palette || {}), ...previewPalette },
      appearanceMode: effAppearance,
    });
  }, [changeCount, previewPalette, effAppearance, branding]);

  // Leaving the page with unsaved edits must not leave the app painted in a
  // color nobody saved.
  useEffect(() => () => restoreServerPaint(), [restoreServerPaint]);

  // ── Logo facts. Dimensions are MEASURED, never assumed. ───────
  const logoUrl = (branding?.logoUrl as string | undefined) || null;
  useEffect(() => {
    setLogoDims(null);
    if (!logoUrl || typeof window === 'undefined') return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setLogoDims({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = logoUrl;
    return () => { cancelled = true; };
  }, [logoUrl]);

  // ── Last brand change, from the real audit log (admin-only route) ──
  const auditArgs = { limit: 1, enabled: canEdit } as const;
  const adoptManual = useAuditLog({ ...auditArgs, action: 'ADOPT_BRANDING_MANUAL' });
  const adoptScrape = useAuditLog({ ...auditArgs, action: 'ADOPT_BRANDING' });
  const appearanceLog = useAuditLog({ ...auditArgs, action: 'BRANDING_APPEARANCE_MODE_CHANGED' });
  const lastChange = useMemo(() => {
    const rows = [adoptManual.data?.items?.[0], adoptScrape.data?.items?.[0], appearanceLog.data?.items?.[0]]
      .filter(Boolean) as { createdAt: string; action: string; user?: { email?: string } }[];
    if (!rows.length) return null;
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }, [adoptManual.data, adoptScrape.data, appearanceLog.data]);

  // ── The wizard keeps owning scan / logo pick / adopt (§3 non-goals) ──
  const wizardInitial = useMemo<BrandingPreview | null>(() => {
    if (!branding) return null;
    const b = branding as TenantBranding & { confidenceScores?: BrandingPreview['confidence'] };
    return {
      sourceUrl: b.sourceUrl || '',
      finalUrl: b.sourceUrl || '',
      displayName: b.displayName,
      tagline: b.tagline,
      // Never prefill svgInline from the stored (sanitized) value — the adopt
      // endpoint rejects it. URL-only keeps the existing Supabase logo.
      logos: b.logoUrl ? [{ url: b.logoUrl, kind: 'icon', score: 100 }] : [],
      favicon: b.faviconUrl,
      ogImage: b.ogImageUrl,
      colors: [],
      palette: b.palette,
      fonts: {
        heading: b.fontHeading ? { family: b.fontHeading, googleFont: b.fontHeading, score: 1 } : null,
        body: b.fontBody ? { family: b.fontBody, googleFont: b.fontBody, score: 1 } : null,
        all: [],
      },
      fontsCssUrl: b.fontHeadingUrl || b.fontBodyUrl || null,
      heroImages: b.heroImages || [],
      confidence: b.confidenceScores || { logo: 1, palette: 1, fonts: 1, displayName: 1, overall: 1 },
      warnings: [],
      scrapedAt: b.scrapedAt || new Date().toISOString(),
      durationMs: 0,
    } as BrandingPreview;
  }, [branding]);

  // ── Save (§6.2, §13.1): await the server, re-read, then confirm ──
  const resetDrafts = useCallback(() => {
    setColorDraft(null);
    setHexText(null);
    setAppearanceDraft(null);
    setErrors([]);
  }, []);

  const onDiscard = useCallback(() => {
    resetDrafts();
    restoreServerPaint();
  }, [resetDrafts, restoreServerPaint]);

  const onSave = useCallback(async () => {
    if (!changeCount || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      if (colorChanged) {
        // The palette lives server-side: /me/manual re-derives every shade
        // from primaryHex exactly as the wizard's manual adopt does. Identity
        // fields are echoed back so this narrow edit cannot blank them.
        await apiFetch('/branding/me/manual', {
          method: 'POST',
          body: JSON.stringify({
            displayName: (branding?.displayName as string | undefined) ?? undefined,
            tagline: (branding?.tagline as string | undefined) ?? undefined,
            primaryHex: effColor,
            accentHex: serverAccent,
            logoBackground: (branding?.palette as BrandPalette | undefined)?.logoBackground,
            ...(appearanceChanged ? { appearanceMode: effAppearance } : {}),
          }),
        });
      } else if (appearanceChanged) {
        await apiFetch('/branding/me/appearance', {
          method: 'POST',
          body: JSON.stringify({ appearanceMode: effAppearance }),
        });
      }
      // No optimistic success — re-read the authoritative row first. The
      // server may have nudged the hex for contrast; the re-read is what the
      // operator ends up looking at.
      invalidateBranding();
      await refetch();
      previewingRef.current = false;
      resetDrafts();
      toast.success(t('settings.cc.brand.saved'));
    } catch (e) {
      const message = (e as Error)?.message || t('settings.cc.brand.saveFailedGeneric');
      setErrors([{ message }]);
    } finally {
      setSaving(false);
    }
  }, [
    changeCount, saving, colorChanged, appearanceChanged, effColor, effAppearance,
    serverAccent, branding, invalidateBranding, refetch, resetDrafts, t,
  ]);

  // Move focus to the error summary after a failed submit (§15).
  useEffect(() => {
    if (!errors.length) return;
    document.getElementById(ERROR_SUMMARY_ID)?.focus();
  }, [errors]);

  const onRemoveBrand = useCallback(async () => {
    setRemoving(true);
    setErrors([]);
    try {
      await apiFetch('/branding/me', { method: 'DELETE' });
      invalidateBranding();
      await refetch();
      previewingRef.current = false;
      resetDrafts();
      setConfirmRemove(false);
      pushBrandingPreview({ palette: vendorPalette, appearanceMode: 'branded' });
    } catch (e) {
      setErrors([{ message: (e as Error)?.message || t('settings.cc.brand.removeFailed') }]);
    } finally {
      setRemoving(false);
    }
  }, [invalidateBranding, refetch, resetDrafts, t, vendorPalette]);

  const onApplyToTemplates = useCallback(async () => {
    setApplyMessage(null);
    try {
      const res = await applyBrand.mutateAsync({ mode: 'fill-blanks' });
      setApplyMessage(t('settings.cc.brand.applyDone', { count: res.count, zones: res.zonesPatched }));
    } catch (e) {
      setApplyMessage(t('settings.cc.brand.applyFailed', { message: (e as Error)?.message || '' }));
    }
  }, [applyBrand, t]);

  // ── Shell contract ────────────────────────────────────────────
  const searchItems = useMemo<readonly SettingsSearchItem[]>(
    () => [
      { label: t('settings.cc.brand.searchLogo'), anchor: 'brand-identity', keywords: ['logo', 'image', 'mark', 'icon'] },
      { label: t('settings.cc.brand.searchPrimaryColor'), anchor: 'brand-color', keywords: ['color', 'colour', 'palette', 'primary'] },
      { label: t('settings.cc.brand.searchHexValue'), anchor: 'brand-color', keywords: ['hex', '#'] },
      { label: t('settings.cc.brand.searchAppearance'), anchor: 'brand-appearance', keywords: ['appearance', 'chrome', 'neutral', 'theme'] },
      { label: t('settings.cc.brand.searchApplyTemplates'), anchor: 'brand-templates', keywords: ['templates', 'apply', 'rebrand'] },
    ],
    [t],
  );

  const previewInitials = initialsFor(orgName);
  const contextRail = useMemo(
    () => (
      <>
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium text-slate-900">{t('settings.cc.brand.previewTitle')}</h3>
            <span className="text-[12px] font-medium text-slate-500">
              {changeCount ? t('settings.cc.brand.previewUnsaved') : t('settings.cc.brand.previewSaved')}
            </span>
          </div>
          <div
            className="mt-2.5 overflow-hidden rounded-[13px] border border-slate-200 bg-white shadow-[0_12px_28px_rgba(20,27,55,.09)]"
            aria-label={t('settings.cc.brand.previewLabel')}
            role="img"
          >
            <div className="h-[34px] flex items-center gap-2 px-2.5 text-white" style={{ background: chromeColor }}>
              <span className="w-5 h-5 grid place-items-center rounded-md bg-white/20 text-[9px] font-medium">{previewInitials}</span>
              <strong className="text-[11px] font-medium truncate">{orgName}</strong>
            </div>
            <div className="p-2.5">
              <div
                className="h-[50px] p-2.5 rounded-[9px] text-white"
                style={{ background: `linear-gradient(135deg, ${chromeColor}, ${chromeColorDeep})` }}
              >
                <strong className="block text-[11px] font-medium">{t('nav.dashboard')}</strong>
                <span className="block mt-0.5 text-[10px] opacity-80">
                  {[
                    locationCount !== null ? t('settings.cc.brand.countLocations', { count: locationCount }) : null,
                    screenCount !== null ? t('settings.cc.brand.countScreens', { count: screenCount }) : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="grid gap-1.5 mt-2.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[25px] flex items-center gap-1.5 px-2 rounded-[7px] bg-slate-100">
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: chromeColor }} />
                    <span className="h-1 flex-1 rounded-full bg-slate-300" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {effAppearance === 'neutral' && (
            <p className="mt-2 text-[12px] leading-[17px] text-slate-500">{t('settings.cc.brand.previewNeutralNote')}</p>
          )}
        </div>

        <ContextModule
          label={t('settings.cc.brand.appliesToLabel')}
          title={orgName}
          action={<ContextAction onClick={() => { setUsageOpen(true); document.getElementById('brand-identity')?.scrollIntoView({ block: 'start' }); }}>{t('settings.cc.brand.previewSurfaces')}</ContextAction>}
        >
          {[
            locationCount !== null ? t('settings.cc.brand.countLocations', { count: locationCount }) : null,
            screenCount !== null ? t('settings.cc.brand.countScreens', { count: screenCount }) : null,
          ].filter(Boolean).join(' · ')}
        </ContextModule>

        <ContextModule label={t('settings.cc.brand.inheritanceLabel')}>
          <ScopePath from={t('settings.cc.brand.scopeFrom')} to={t('settings.cc.brand.scopeTo')} />
          <p className="mt-1.5">{t('settings.cc.brand.inheritanceNote')}</p>
        </ContextModule>

        {canEdit ? (
          <ContextModule
            label={t('settings.cc.brand.lastChangedLabel')}
            title={lastChange ? `${lastChange.user?.email ?? ''} · ${new Date(lastChange.createdAt).toLocaleDateString()}`.replace(/^ · /, '') : undefined}
          >
            {lastChange ? lastChange.action : t('settings.cc.brand.lastChangedNone')}
          </ContextModule>
        ) : null}
      </>
    ),
    [t, changeCount, chromeColor, chromeColorDeep, previewInitials, orgName, locationCount, screenCount, effAppearance, canEdit, lastChange],
  );

  const saveState = useMemo(
    () => ({ dirty: changeCount, saving, onSave, onDiscard }),
    [changeCount, saving, onSave, onDiscard],
  );

  const logoFormat = formatFromUrl(logoUrl);
  const logoName = fileNameFromUrl(logoUrl);

  return (
    <SettingsPageFrame
      section="brand"
      title={t('settings.shell.sections.brand.label')}
      description={t('settings.shell.sections.brand.description')}
      scope={{ kind: 'organization', label: orgName }}
      save={canEdit ? saveState : undefined}
      context={contextRail}
      searchItems={searchItems}
    >
      {isLoading ? (
        <EditorSkeleton groups={4} />
      ) : (
        <>
          <ErrorSummary id={ERROR_SUMMARY_ID} title={t('settings.cc.brand.saveFailedTitle')} errors={errors} />

          <EditorHead
            icon={Palette}
            title={t('settings.cc.brand.editorTitle')}
            description={
              locationCount && locationCount > 0
                ? t('settings.cc.brand.appliesWithLocations', { org: orgName })
                : t('settings.cc.brand.appliesOrgOnly')
            }
            badge={<InheritanceBadge state="default" />}
          />

          {!canEdit && (
            <p className="mb-4 rounded-[11px] border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-600">
              {t('settings.cc.brand.readOnly')}
            </p>
          )}

          {/* ── Identity ─────────────────────────────────────── */}
          <EditorSection
            id="brand-identity"
            title={t('settings.cc.brand.identityTitle')}
            description={t('settings.cc.brand.identityDesc')}
            action={
              <SectionAction onClick={() => setUsageOpen((v) => !v)}>
                {usageOpen ? t('settings.cc.brand.hideUsage') : t('settings.cc.brand.viewUsage')}
              </SectionAction>
            }
          >
            <div className="grid grid-cols-1 min-[700px]:grid-cols-[84px_minmax(0,1fr)] gap-3.5 items-center">
              <span
                className="w-[84px] h-[84px] grid place-items-center rounded-[18px] overflow-hidden text-white text-[20px] font-medium shadow-[0_10px_24px_rgba(15,23,42,.18)]"
                style={{ background: `linear-gradient(135deg, ${chromeColor}, ${chromeColorDeep})` }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={t('settings.cc.brand.logoAlt', { org: orgName })} className="w-full h-full object-contain p-2 bg-white/95" />
                ) : (
                  <span aria-hidden>{previewInitials}</span>
                )}
              </span>
              <div className="min-w-0">
                <strong className="block text-[13px] font-medium text-slate-900 truncate">
                  {logoName ?? t('settings.cc.brand.logoNone')}
                </strong>
                <span className="block mt-1 text-[12px] leading-[17px] text-slate-500">
                  {logoUrl
                    ? [
                        logoFormat ? t('settings.cc.brand.logoFormat', { format: logoFormat }) : null,
                        logoDims ? t('settings.cc.brand.logoDimensions', { width: logoDims.w, height: logoDims.h }) : null,
                      ].filter(Boolean).join(' · ')
                    : t('settings.cc.brand.logoNoneHelp')}
                </span>
                <span className="block mt-1 text-[12px] leading-[17px] text-slate-400">{t('settings.cc.brand.logoConstraints')}</span>
                {canEdit && (
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <button
                      type="button"
                      onClick={() => setLogoEditorOpen((v) => !v)}
                      aria-expanded={logoEditorOpen}
                      aria-controls="brand-logo-editor"
                      className="min-h-[36px] px-3 rounded-lg text-[13px] font-medium text-[var(--brand-primary-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                      style={{ background: 'var(--brand-primary)' }}
                    >
                      {logoEditorOpen ? t('settings.cc.brand.closeLogoEditor') : t('settings.cc.brand.replaceLogo')}
                    </button>
                    {branding && (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(true)}
                        className="min-h-[36px] px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                        {t('settings.cc.brand.removeBrand')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {usageOpen && (
              <div className="mt-4 rounded-[11px] border border-slate-200 bg-slate-50 px-3.5 py-3">
                <strong className="block text-[13px] font-medium text-slate-900">{t('settings.cc.brand.usageTitle')}</strong>
                <ul className="mt-1.5 space-y-1 list-disc pl-5 text-[12px] leading-[17px] text-slate-600">
                  <li>{t('settings.cc.brand.usageDashboard')}</li>
                  <li>{t('settings.cc.brand.usageTab')}</li>
                  <li>{t('settings.cc.brand.usageSignIn')}</li>
                  <li>{t('settings.cc.brand.usageTemplates')}</li>
                </ul>
              </div>
            )}

            {confirmRemove && (
              <div className="mt-4 rounded-[11px] border border-red-200 bg-red-50 px-3.5 py-3" role="alertdialog" aria-labelledby="brand-remove-title">
                <strong id="brand-remove-title" className="block text-[13px] font-medium text-red-900">
                  {t('settings.cc.brand.removeTitle')}
                </strong>
                <p className="mt-1 text-[12px] leading-[17px] text-red-800">{t('settings.cc.brand.removeBody', { org: orgName })}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onRemoveBrand}
                    disabled={removing}
                    className="min-h-[36px] px-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-[13px] font-medium text-white disabled:opacity-60"
                  >
                    {removing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ImageOff className="w-4 h-4" aria-hidden />}
                    {t('settings.cc.brand.removeConfirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    disabled={removing}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-700"
                  >
                    {t('settings.common.cancel')}
                  </button>
                </div>
              </div>
            )}

            {canEdit && logoEditorOpen && (
              <div id="brand-logo-editor" className="mt-4">
                <BrandingWizard
                  mode="authed"
                  initial={wizardInitial || undefined}
                  vertical={((tenant as { vertical?: string } | undefined)?.vertical as never) || ('K12' as never)}
                  onAdopted={() => {
                    setLogoEditorOpen(false);
                    previewingRef.current = false;
                    resetDrafts();
                  }}
                />
              </div>
            )}
          </EditorSection>

          {/* ── Primary color ────────────────────────────────── */}
          <EditorSection id="brand-color" title={t('settings.cc.brand.colorTitle')} description={t('settings.cc.brand.colorDesc')}>
            <div className="grid grid-cols-1 min-[700px]:grid-cols-[minmax(0,1fr)_150px] gap-3.5">
              <div className="flex flex-wrap gap-2.5" role="group" aria-label={t('settings.cc.brand.colorOptionsLabel')}>
                {SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={effColor === s.hex.toUpperCase()}
                    aria-label={t(`settings.cc.brand.${s.labelKey}`)}
                    title={t(`settings.cc.brand.${s.labelKey}`)}
                    onClick={() => { setColorDraft(s.hex.toUpperCase()); setHexText(null); }}
                    className={
                      'w-[42px] h-[42px] rounded-xl border-[3px] border-transparent shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)] disabled:cursor-not-allowed ' +
                      (effColor === s.hex.toUpperCase() ? 'outline outline-2 outline-offset-[3px] outline-slate-900' : '')
                    }
                    style={{ background: s.hex }}
                  />
                ))}
                {/* The tenant's own primary, so "what we have now" is always pickable. */}
                {!SWATCHES.some((s) => s.hex.toUpperCase() === basePrimary) && (
                  <button
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={effColor === basePrimary}
                    aria-label={`${t('settings.cc.brand.swatchCurrent')} ${basePrimary}`}
                    title={`${t('settings.cc.brand.swatchCurrent')} ${basePrimary}`}
                    onClick={() => { setColorDraft(basePrimary); setHexText(null); }}
                    className={
                      'w-[42px] h-[42px] rounded-xl border-[3px] border-transparent shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)] disabled:cursor-not-allowed ' +
                      (effColor === basePrimary ? 'outline outline-2 outline-offset-[3px] outline-slate-900' : '')
                    }
                    style={{ background: basePrimary }}
                  />
                )}
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="brand-hex" className="text-[12px] font-medium text-slate-600">
                  {t('settings.cc.brand.hexLabel')}
                </label>
                <input
                  id="brand-hex"
                  value={hexText ?? effColor}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHexText(v);
                    if (HEX_RE.test(v.trim())) setColorDraft(v.trim().toUpperCase());
                  }}
                  aria-invalid={hexInvalid || undefined}
                  aria-describedby={hexInvalid ? 'brand-hex-error' : undefined}
                  className="w-full min-h-[42px] px-2.5 rounded-[9px] border border-slate-200 bg-slate-50 text-[13px] text-slate-900 disabled:opacity-60"
                />
                {hexInvalid && (
                  <p id="brand-hex-error" className="text-[12px] text-red-700">{t('settings.cc.brand.hexInvalid')}</p>
                )}
              </div>
            </div>
          </EditorSection>

          {/* ── Application appearance ───────────────────────── */}
          <EditorSection id="brand-appearance" title={t('settings.cc.brand.appearanceTitle')} description={t('settings.cc.brand.appearanceDesc')}>
            <div className="grid gap-2">
              <ChoiceRow
                icon={Sparkles}
                name="brand-appearance-mode"
                value="branded"
                checked={effAppearance === 'branded'}
                disabled={!canEdit}
                onChange={() => setAppearanceDraft('branded')}
                title={t('settings.cc.brand.appearanceBranded')}
                description={t('settings.cc.brand.appearanceBrandedDesc')}
              />
              <ChoiceRow
                icon={CircleDashed}
                name="brand-appearance-mode"
                value="neutral"
                checked={effAppearance === 'neutral'}
                disabled={!canEdit}
                onChange={() => setAppearanceDraft('neutral')}
                title={t('settings.cc.brand.appearanceNeutral')}
                description={t('settings.cc.brand.appearanceNeutralDesc')}
              />
            </div>
          </EditorSection>

          {/* ── Templates ────────────────────────────────────── */}
          <EditorSection id="brand-templates" title={t('settings.cc.brand.templatesTitle')} description={t('settings.cc.brand.templatesDesc')}>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={onApplyToTemplates}
                  disabled={applyBrand.isPending || !branding}
                  className="min-h-[38px] px-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                >
                  {applyBrand.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Wand2 className="w-4 h-4" aria-hidden />}
                  {applyBrand.isPending ? t('settings.cc.brand.applying') : t('settings.cc.brand.applyTemplates')}
                </button>
                <p className="mt-1.5 text-[12px] leading-[17px] text-slate-500">{t('settings.cc.brand.applyTemplatesHelp')}</p>
                {applyMessage && (
                  <p role="status" className="mt-1.5 text-[12px] text-slate-700">{applyMessage}</p>
                )}
              </>
            )}
            <div className="mt-3">
              <BrandingSettingsCard applyOnly />
            </div>
          </EditorSection>
        </>
      )}
    </SettingsPageFrame>
  );
}
