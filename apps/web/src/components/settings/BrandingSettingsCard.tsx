/**
 * BrandingSettingsCard — compact card on the main /settings page that
 * shows the current brand (if any) + a link into the full wizard at
 * /settings/branding. Gated behind the AUTO_BRANDING feature flag.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { Paintbrush, Sparkles } from 'lucide-react';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import type { TenantBranding } from '@/lib/branding';

export function BrandingSettingsCard() {
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname() || '';
  const schoolId = pathname.split('/')[1] || '';

  useEffect(() => {
    if (!isFeatureEnabled(FLAGS.AUTO_BRANDING)) { setLoading(false); return; }
    (async () => {
      try {
        const b = await apiFetch<TenantBranding | null>('/api/v1/branding/me');
        setBranding(b);
      } finally { setLoading(false); }
    })();
  }, []);

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
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden">
              {branding.logoSvgInline ? (
                <div dangerouslySetInnerHTML={{ __html: branding.logoSvgInline }} className="max-h-12 max-w-12 [&_svg]:max-h-12 [&_svg]:max-w-12" />
              ) : branding.logoUrl ? (
                <img src={branding.logoUrl} alt="logo" className="max-h-12 max-w-12 object-contain" />
              ) : (
                <Paintbrush className="h-6 w-6 text-slate-300" />
              )}
            </div>
            <div className="flex-1">
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
        ) : (
          <div className="text-sm text-slate-600">
            Paste your school&apos;s website URL and we&apos;ll auto-skin the CMS — logo, colors, fonts, all at once. Takes about ten seconds.
          </div>
        )}
      </div>
    </div>
  );
}
