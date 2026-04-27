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
import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { Paintbrush, Sparkles, RotateCcw, AlertTriangle, Upload, Check, Loader2, Wand2 } from 'lucide-react';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import { useAppStore } from '@/lib/store';
import { useTenant, useApplyBrandToTemplates } from '@/hooks/use-api';
import { pushBrandingPreview } from '@/components/branding/BrandStyleInjector';
import type { TenantBranding } from '@/lib/branding';

export function BrandingSettingsCard() {
  const { data: tenant } = useTenant();
  const user = useAppStore((s) => s.user);
  // Manual-mode state — escape hatch when the auto-scraper can't produce
  // a usable logo (common for sites with SVG-inside-SVG <image> refs,
  // .ico-only favicons, or JS-rendered logos).
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualTagline, setManualTagline] = useState('');
  const [manualPrimary, setManualPrimary] = useState('#4f46e5');
  const [manualAccent, setManualAccent] = useState('#ec4899');
  const [manualLogoFile, setManualLogoFile] = useState<File | null>(null);
  const [manualLogoUrl, setManualLogoUrl] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualStatus, setManualStatus] = useState<{kind: 'ok' | 'err', msg: string} | null>(null);

  const handleManualSave = async () => {
    setManualSaving(true);
    setManualStatus(null);
    try {
      let logoDataUrl: string | undefined;
      if (manualLogoFile) {
        if (manualLogoFile.size > 2 * 1024 * 1024) throw new Error('Logo too large (max 2MB)');
        logoDataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = () => rej(new Error('Could not read file'));
          r.readAsDataURL(manualLogoFile);
        });
      }
      const payload = {
        displayName: manualName || undefined,
        tagline: manualTagline || undefined,
        primaryHex: manualPrimary,
        accentHex: manualAccent,
        ...(logoDataUrl ? { logoDataUrl } : manualLogoUrl ? { logoUrl: manualLogoUrl } : {}),
      };
      const res: any = await apiFetch('/branding/me/manual', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Update local cache + fire event so sidebar + injector repaint now
      try {
        const key = `edu-cms-branding-cache-v1:${(user as any)?.tenantId || ''}`;
        localStorage.setItem(key, JSON.stringify(res.branding));
      } catch {}
      pushBrandingPreview(res.branding);
      setBranding(res.branding);
      setManualStatus({ kind: 'ok', msg: 'Branding saved — repainting the dashboard now.' });
      setManualOpen(false);
      setManualLogoFile(null);
    } catch (e: any) {
      setManualStatus({ kind: 'err', msg: e?.message || 'Save failed' });
    } finally {
      setManualSaving(false);
    }
  };

  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!isFeatureEnabled(FLAGS.AUTO_BRANDING)) { setLoading(false); return; }
    (async () => {
      try {
        const b = await apiFetch<TenantBranding | null>('/branding/me');
        setBranding(b);
      } finally { setLoading(false); }
    })();
  }, []);

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await apiFetch('/branding/me', { method: 'DELETE' });
      setBranding(null);
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

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-indigo-500" /> Brand your CMS
          </h2>
          {/* Big tenant indicator so the user knows which org they're
              branding — was a cross-tenant-bleed vector when users
              adopted Chardon's URL while logged into Springfield. */}
          <div className="text-[11px] text-slate-500 mt-1">
            Branding: <span className="font-semibold text-indigo-700">{(tenant as any)?.name || '(unknown tenant)'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" /> {manualOpen ? 'Cancel' : 'Upload logo manually'}
          </button>
          <Link
            href={`/${schoolId}/settings/branding`}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" /> {branding ? 'Re-skin' : 'Auto-brand from URL'}
          </Link>
        </div>
      </div>

      {manualOpen && (
        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 space-y-4">
          <p className="text-xs text-slate-600">
            Set branding for <strong className="text-indigo-700">{(tenant as any)?.name || 'this tenant'}</strong> directly — no scraper. Upload a logo image (PNG, JPG, SVG) or paste a URL.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Display name
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder={(tenant as any)?.name || ''}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
              />
            </label>
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Tagline (optional)
              <input
                value={manualTagline}
                onChange={(e) => setManualTagline(e.target.value)}
                placeholder="Digital Signage"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
              />
            </label>
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Primary color
              <div className="flex gap-2">
                <input
                  type="color"
                  value={manualPrimary}
                  onChange={(e) => setManualPrimary(e.target.value)}
                  className="w-10 h-10 border border-slate-200 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={manualPrimary}
                  onChange={(e) => setManualPrimary(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-800"
                />
              </div>
            </label>
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Accent color
              <div className="flex gap-2">
                <input
                  type="color"
                  value={manualAccent}
                  onChange={(e) => setManualAccent(e.target.value)}
                  className="w-10 h-10 border border-slate-200 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={manualAccent}
                  onChange={(e) => setManualAccent(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-800"
                />
              </div>
            </label>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Logo — upload file (PNG / JPG / SVG, max 2MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={(e) => setManualLogoFile(e.target.files?.[0] || null)}
                className="text-xs text-slate-700"
              />
              {manualLogoFile && (
                <span className="text-[11px] text-emerald-700 font-semibold">
                  <Check className="inline w-3 h-3" /> {manualLogoFile.name} ({Math.round(manualLogoFile.size / 1024)} KB)
                </span>
              )}
            </label>
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1 mt-3">
              …or paste a logo URL
              <input
                value={manualLogoUrl}
                onChange={(e) => setManualLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
              />
            </label>
          </div>

          {manualStatus && (
            <div className={`text-xs px-3 py-2 rounded-lg ${manualStatus.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
              {manualStatus.msg}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleManualSave}
              disabled={manualSaving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white text-xs font-bold rounded-lg flex items-center gap-2"
            >
              {manualSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save branding
            </button>
            <button
              type="button"
              onClick={() => { setManualOpen(false); setManualStatus(null); }}
              className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="p-6">
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : branding ? (
          <>
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden text-slate-800">
                {safeLogoSvg ? (
                  <div dangerouslySetInnerHTML={{ __html: safeLogoSvg }} className="max-h-12 max-w-12 [&_svg]:max-h-12 [&_svg]:max-w-12" />
                ) : branding.logoUrl ? (
                  <img src={branding.logoUrl} alt="logo" className="max-h-12 max-w-12 object-contain" />
                ) : (
                  <Paintbrush className="h-6 w-6 text-slate-300" />
                )}
              </div>
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
                        Wipe custom branding and revert to EduSignage defaults?
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
        ) : (
          <div className="text-sm text-slate-600">
            Paste your school&apos;s website URL and we&apos;ll auto-skin the CMS — logo, colors, fonts, all at once. Takes about ten seconds. You can reset to defaults at any time.
          </div>
        )}
      </div>
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
