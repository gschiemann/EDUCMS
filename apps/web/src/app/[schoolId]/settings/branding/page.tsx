/**
 * /[schoolId]/settings/branding — authed tenant admin page to re-run or
 * tweak the brand detection. Loads the existing TenantBranding if there
 * is one so the wizard starts in "editing" mode rather than blank.
 */
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { BrandingWizard, BrandingPreview } from '@/components/branding/BrandingWizard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, Paintbrush } from 'lucide-react';
import { pushBrandingPreview } from '@/components/branding/BrandStyleInjector';

export default function SettingsBrandingPage() {
  const [current, setCurrent] = useState<BrandingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRevert, setConfirmRevert] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const b = await apiFetch<any>('/branding/me');
        if (b) {
          // Shape-coerce the stored record into a BrandingPreview enough for
          // the wizard's editing mode
          setCurrent({
            sourceUrl: b.sourceUrl || '',
            finalUrl: b.sourceUrl || '',
            displayName: b.displayName,
            tagline: b.tagline,
            // IMPORTANT: never prefill svgInline from b.logoSvgInline —
            // the stored value is the DOMPurify-sanitized version, which
            // has had <image>/<use> refs stripped out. If the user hits
            // Adopt without re-scanning, the wizard would POST that
            // stripped string and the server rejects it ("no shape
            // primitives"). Prefill URL-only so the adopt endpoint
            // preserves the existing Supabase logo rather than trying
            // to re-validate a stripped svg.
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
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const revert = async () => {
    try {
      await apiFetch('/branding/me', { method: 'DELETE' });
      setCurrent(null);
      pushBrandingPreview({ palette: null, displayName: null, tagline: null, logoUrl: null, faviconUrl: null, fontHeading: null, fontBody: null });
      setConfirmRevert(false);
    } catch (e) {
      // let user retry
    }
  };

  return (
    <div>
      <div className="px-6 py-5 flex items-center justify-between border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <Paintbrush className="h-5 w-5 text-indigo-600" />
          <div>
            <h1 className="text-lg font-bold">Branding</h1>
            <p className="text-xs text-slate-500">Your CMS looks like your school. Paste a URL or tweak below.</p>
          </div>
        </div>
        {current && (
          <div>
            {confirmRevert ? (
              <div className="flex gap-2 items-center text-sm">
                <span>Revert to default theme?</span>
                <Button variant="outline" size="sm" onClick={() => setConfirmRevert(false)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={revert}>Revert</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmRevert(true)}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Revert to default
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-500">Loading…</div>
      ) : (
        <BrandingWizard mode="authed" initial={current || undefined} />
      )}
    </div>
  );
}
