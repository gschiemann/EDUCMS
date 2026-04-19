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
import { Paintbrush, Sparkles, RotateCcw, AlertTriangle } from 'lucide-react';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import type { TenantBranding } from '@/lib/branding';

export function BrandingSettingsCard() {
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
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Paintbrush className="w-4 h-4 text-indigo-500" /> Brand your CMS
        </h2>
        <Link
          href={`/${schoolId}/settings/branding`}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" /> {branding ? 'Re-skin' : 'Auto-brand from URL'}
        </Link>
      </div>
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
