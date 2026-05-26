/**
 * BrandingSettingsCard — main /settings card for the auto-branding feature.
 *
 * Shows current brand (if any) with a clear "Reset to default" nuke
 * button so an operator can always undo a bad scrape. The full wizard
 * (URL paste → scan → preview → adopt) lives at /settings/branding.
 *
 * Gated behind the AUTO_BRANDING feature flag.
 */
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
// 2026-05-25 — Sparkles dropped here per operator: "why are we
// giving the AI sparkle on the branding button? are we using AI in
// there?" Branding is pure cheerio scraping (zero AI calls); the
// sparkle vocabulary is reserved for AI-generated content. Wand2
// is the established "magic auto-detection" icon for non-AI
// automation in this codebase (also used by the wizard header +
// "Apply brand to templates" button).
import { Paintbrush, RotateCcw, AlertTriangle, Check, Loader2, Wand2 } from 'lucide-react';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import { useAppStore } from '@/lib/store';
import { useApplyBrandToTemplates, useTenantBranding, useInvalidateTenantBranding } from '@/hooks/use-api';
import { pushBrandingPreview } from '@/components/branding/BrandStyleInjector';
import { useLogoTone } from '@/components/branding/useLogoTone';
import type { TenantBranding } from '@/lib/branding';

// 2026-05-26 — operator: "why bring all of these settings outside int
// the main settings page these should have been in the settings menu
// for the branding." Card now has THREE modes:
//   - slimOnly: header + Configure/Re-skin button only (for /settings
//     so it matches the Emergency / AI / Industry row pattern)
//   - applyOnly: just the Apply-to-templates section + Reset link
//     (for /settings/branding BELOW the wizard — the wizard above
//     already shows the adopted brand summary; surfacing logo + Re-skin
//     a second time was redundant). Operator (2026-05-26 round 2):
//     "why are we saying reskin and showing the logo even, the only
//     option this should be is to brand your templates right? the
//     reskin option should replace the scan option once you have
//     adopted the branding."
//   - default: header + full details block — kept for any callers
//     that depended on the legacy shape; new call sites should pick
//     slimOnly or applyOnly explicitly.
export function BrandingSettingsCard({
  slimOnly = false,
  applyOnly = false,
}: {
  slimOnly?: boolean;
  applyOnly?: boolean;
}) {
  // 2026-05-25 — useTenant() dropped (was only used for the
  // tenant-name pill that's no longer rendered).
  // 2026-05-25 — manual-mode state (inline file picker + color
  // pickers + display-name form) was removed from this card per
  // operator: "remove the upload button from the main area in the
  // settings, that should be inside the settings page only." The
  // /settings/branding sub-page hosts the full configure flow.
  // Removed: manualOpen, manualName, manualTagline, manualPrimary,
  // manualAccent, manualLogoFile, manualLogoUrl, manualSaving,
  // manualStatus, handleManualSave (~50 lines of dead code dropped).

  // Single shared `/branding/me` subscription — same hook every other
  // branding-aware component uses (60s staleTime + 5min gcTime). The
  // raw `apiFetch` this used to do was the 4th of ~8 duplicate calls
  // per navigation; now it dedupes through React Query.
  const featureEnabled = isFeatureEnabled(FLAGS.AUTO_BRANDING);
  const brandingQuery = useTenantBranding();
  const invalidateBranding = useInvalidateTenantBranding();
  const branding = featureEnabled ? (brandingQuery.data ?? null) : null;
  const loading = featureEnabled && brandingQuery.isLoading;
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const pathname = usePathname() || '';
  const schoolId = pathname.split('/')[1] || '';

  // Defense-in-depth: sanitize at render even though API now cleans on
  // write. Rows written before the XSS fix might still be dirty.
  const safeLogoSvg = useMemo(
    () =>
      branding?.logoSvgInline
        ? (DOMPurify.sanitize(branding.logoSvgInline, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['script', 'style', 'foreignObject'],
          }) as unknown as string)
        : '',
    [branding?.logoSvgInline],
  );

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await apiFetch('/branding/me', { method: 'DELETE' });
      // Drop the shared cache so every subscriber (sidebar, dashboard
      // hero, brand-style injector) repaints with the default palette.
      invalidateBranding();
      setConfirmReset(false);
      // Force a reload so all CSS variables / SSR-injected branding clear immediately.
      // Avoids a half-themed UI showing the old palette until the next navigation.
      window.location.reload();
    } catch (e: any) {
      setResetError(e?.message || 'Failed to reset branding.');
    } finally {
      setResetting(false);
    }
  };

  if (!isFeatureEnabled(FLAGS.AUTO_BRANDING)) return null;

  // 2026-05-26 applyOnly mode — only show Apply-to-templates + Reset.
  // No header, no logo, no source URL, no Re-skin button — those are
  // ALL already visible in the BrandingWizard rendered above this on
  // /settings/branding. Operator: "the only option this should be is
  // to brand your templates right?"
  //
  // If no brand is adopted yet, render NOTHING — the wizard above
  // takes over the full page. There's nothing to apply yet.
  if (applyOnly) {
    if (loading) {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="text-sm text-slate-400">Loading…</div>
        </div>
      );
    }
    if (!branding) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        {/* APPLY TO TEMPLATES — same component used in default mode. */}
        <ApplyBrandToTemplatesRow />

        {/* NUKE / Reset row */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => { setConfirmReset(true); setResetError(null); }}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-rose-600 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Reset to default branding
            </button>
          ) : (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-rose-900 text-sm">
                    Wipe custom branding and revert to VenueOS defaults?
                  </div>
                  <div className="text-xs text-rose-700/90 mt-1">
                    Logo, colors, fonts, display name, and tagline will all reset. This is reversible — you can re-scan any time.
                  </div>
                  {resetError && (
                    <div className="text-xs text-rose-800 mt-2 font-mono bg-rose-100 px-2 py-1 rounded">
                      {resetError}
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={resetting}
                      className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {resetting ? 'Resetting…' : 'Yes, wipe and reset'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      disabled={resetting}
                      className="px-3 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* 2026-05-25 — collapsed from a stacked title + subtitle header
          into a single horizontal row per operator feedback ("brand your
          CMS… just make that setting a single row and not double").
          Same compact pattern the industry switcher uses: icon + label +
          tenant pill + inline buttons. The cross-tenant-bleed indicator
          (which org you're branding) is preserved as the pill. */}
      {/* 2026-05-25 — header row padded to p-4 (was px-5 py-3) +
          icon wrapped in a 9×9 container so Brand visually matches
          Emergency + AI / settings rows on the main page. Operator:
          "keep it standard size unless we need more space." */}
      <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
          <Paintbrush className="w-4 h-4 text-indigo-600" />
        </div>
        {/* 2026-05-25 — operator: "no need to say dodgers here in
            the settings menu....just say Brand Your CMS and then
            fix that fucked up text you have there, website and
            then you start talking another langues." Tenant-name
            pill dropped (operator knows their own tenant — pill
            was redundant and clashing). Title text becomes "Brand
            your CMS." Description fixed: `&rsquo;` was the literal
            HTML entity rendering as text because the string lives
            in a JS ternary, not JSX — switched to the real
            Unicode apostrophe (’, U+2019) so it parses as
            "we'll" everywhere. */}
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
          <span className="text-sm font-bold text-slate-800 shrink-0">Brand your CMS</span>
          <span className="text-[11px] text-slate-500 truncate">
            {branding
              ? 'Update your colors, logo, and fonts.'
              : 'Brand it as your own — paste your website and we’ll match your colors, logo, and fonts.'}
          </span>
        </div>
        {/* 2026-05-25 operator: "remove the upload button from the
            main area in the settings, that should be inside the
            settings page only." Manual upload (logo + colors + name
            inline form) is now reachable only from /settings/branding,
            not duplicated on /settings. The single Configure button is
            the only action here. */}
        <div className="flex gap-2 shrink-0">
          <Link
            href={`/${schoolId}/settings/branding`}
            // 2026-05-25 — class signature aligned with the
            // Emergency + AI Configure buttons so all three settings
            // rows render the same button shape (only color differs:
            // rose for emergency, indigo elsewhere).
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
          >
            {branding ? 'Re-skin' : 'Configure'}
          </Link>
        </div>
      </div>

      {/* Manual-mode form moved 2026-05-25 — see note at top of file. */}
      {/* 2026-05-25 — when no branding is set yet, the card is a
          one-row header (matches industry/emergency cards). The
          verbose "paste your school's URL and we'll auto-skin"
          paragraph that used to live here was operator noise —
          the "Auto-brand" button already says what to click.
          When branding IS set we still render the logo preview +
          apply-to-templates + reset controls; that information is
          worth keeping below the header. */}
      {!slimOnly && (loading || branding) && <div className="p-6">
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : branding ? (
          <>
            <div className="flex items-center gap-4">
              {/* 2026-05-26 — logo thumbnail uses tone-detection +
                  brand-primary chip when the logo is light. White-on-
                  white was making the Dodgers wordmark invisible here
                  AND in the sidebar (separate fix on Sidebar.tsx).
                  Same pattern as BrandingLivePreview wizard chip. */}
              <LogoThumbnail
                logoUrl={branding.logoUrl || null}
                logoSvg={safeLogoSvg || null}
              />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{branding.displayName || 'Unnamed'}</div>
                {branding.tagline && <div className="text-xs text-slate-500 truncate max-w-md">{branding.tagline}</div>}
                {branding.sourceUrl && (
                  <div className="text-xs text-slate-400 mt-0.5 truncate">
                    Source: {branding.sourceUrl}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                {(['primary','accent'] as const).map(key => {
                  const hex = (branding.palette as any)?.[key];
                  if (!hex) return null;
                  return <div key={key} title={`${key}: ${hex}`} className="h-8 w-8 rounded border border-slate-200" style={{ background: hex }} />;
                })}
              </div>
            </div>

            {/* APPLY TO TEMPLATES — Operator (2026-04-27): "branding doesn't
                work" in templates. The brand-kit endpoint existed but had no
                UI button so the palette never propagated to template defaults.
                Two modes: fill-blanks (only colors templates haven't been
                customized away from defaults) and override (force-paint
                everything). Default is fill-blanks — non-destructive. */}
            <ApplyBrandToTemplatesRow />

            {/* NUKE / Reset row — always available when branding is set */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              {!confirmReset ? (
                <button
                  type="button"
                  onClick={() => { setConfirmReset(true); setResetError(null); }}
                  className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-rose-600 transition-colors"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset to default branding
                </button>
              ) : (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-semibold text-rose-900 text-sm">
                        Wipe custom branding and revert to VenueOS defaults?
                      </div>
                      <div className="text-xs text-rose-700/90 mt-1">
                        Logo, colors, fonts, display name, and tagline will all reset. This is reversible — you can re-scan any time.
                      </div>
                      {resetError && (
                        <div className="text-xs text-rose-800 mt-2 font-mono bg-rose-100 px-2 py-1 rounded">
                          {resetError}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={handleReset}
                          disabled={resetting}
                          className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {resetting ? 'Resetting…' : 'Yes, wipe and reset'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmReset(false)}
                          disabled={resetting}
                          className="px-3 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>}
    </div>
  );
}

/**
 * "Apply brand to all templates" row — sits inside BrandingSettingsCard.
 *
 * Calls POST /branding/apply-to-templates which walks every template
 * the tenant owns + paints zone defaultConfig with the current palette
 * (primary / accent / ink / surface) and font family. Two modes:
 *   - fill-blanks (default): only patches zones that still hold the
 *     stock generic colors. Won't override a template the operator
 *     customized.
 *   - override: force-repaint everything. Use after a brand refresh.
 */
function ApplyBrandToTemplatesRow() {
  const apply = useApplyBrandToTemplates();
  const [mode, setMode] = useState<'fill-blanks' | 'override'>('fill-blanks');
  const [doneSummary, setDoneSummary] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onApply = async () => {
    setDoneSummary(null);
    setErrMsg(null);
    try {
      const res = await apply.mutateAsync({ mode });
      setDoneSummary(`Applied to ${res.count} template${res.count === 1 ? '' : 's'} · ${res.zonesPatched} zone${res.zonesPatched === 1 ? '' : 's'} updated.`);
    } catch (e: any) {
      setErrMsg(e?.message || 'Apply failed — try again.');
    }
  };

  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <div className="flex items-start gap-3 mb-3">
        <Wand2 className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-bold text-slate-700">Apply brand to all templates</div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Repaint every template you own with your school&apos;s palette and fonts.
            <span className="font-semibold"> Fill blanks</span> only touches zones still using stock colors;{' '}
            <span className="font-semibold">override</span> force-repaints everything.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex bg-slate-100 rounded-md p-0.5 border border-slate-200">
          <button
            type="button"
            onClick={() => setMode('fill-blanks')}
            className={`px-3 py-1.5 text-[11px] font-bold rounded transition-colors ${
              mode === 'fill-blanks' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Fill blanks
          </button>
          <button
            type="button"
            onClick={() => setMode('override')}
            className={`px-3 py-1.5 text-[11px] font-bold rounded transition-colors ${
              mode === 'override' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Override
          </button>
        </div>
        <button
          type="button"
          onClick={onApply}
          disabled={apply.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {apply.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</>
          ) : (
            <><Wand2 className="h-3.5 w-3.5" /> Apply brand to templates</>
          )}
        </button>
      </div>
      {doneSummary && (
        <div className="mt-3 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5 inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5" /> {doneSummary}
        </div>
      )}
      {errMsg && (
        <div className="mt-3 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-1.5">
          {errMsg}
        </div>
      )}
    </div>
  );
}

/**
 * 2026-05-26 — LogoThumbnail renders the current brand logo with the
 * same tone-aware backdrop the wizard preview + sidebar use.
 *
 *  - Inline SVG path: text color flips to white on dark chip / slate-800
 *    on light chip so currentColor-fill marks always show.
 *  - Raster path: white wordmarks (Dodgers script, etc.) land on a
 *    var(--brand-primary) chip so they have contrast.
 *  - Dark logos render on a subtle slate-50 backdrop (legacy default).
 *  - Silent-zero fallback: img that loads 200 OK but with 0×0 dimensions
 *    (CORS-tainted hot-link) flips to a fallback icon.
 */
function LogoThumbnail({
  logoUrl,
  logoSvg,
}: {
  logoUrl: string | null;
  logoSvg: string | null;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const tone = useLogoTone(logoUrl, logoSvg);
  const needsDarkBacking = tone === 'light' || tone === 'unknown';
  const useSvg = logoSvg && /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(logoSvg);

  // Style — dark chip uses brand-primary, light chip uses slate-50.
  const chipStyle: React.CSSProperties = needsDarkBacking
    ? { background: 'var(--brand-primary, #4f46e5)' }
    : {};
  const chipClass = `h-14 w-14 rounded-lg ${
    needsDarkBacking ? '' : 'bg-slate-50 border border-slate-200'
  } flex items-center justify-center overflow-hidden ${
    needsDarkBacking ? 'text-white' : 'text-slate-800'
  }`;

  return (
    <div className={chipClass} style={chipStyle}>
      {useSvg ? (
        <div
          dangerouslySetInnerHTML={{ __html: logoSvg! }}
          className="max-h-12 max-w-12 [&_svg]:max-h-12 [&_svg]:max-w-12"
        />
      ) : logoUrl && !imgBroken ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={logoUrl}
          alt="logo"
          onError={() => setImgBroken(true)}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth === 0 || img.naturalHeight === 0) {
              setImgBroken(true);
            }
          }}
          className="max-h-12 max-w-12 object-contain"
        />
      ) : (
        <Paintbrush className="h-6 w-6 opacity-60" />
      )}
    </div>
  );
}
