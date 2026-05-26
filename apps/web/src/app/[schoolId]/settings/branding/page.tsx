/**
 * /[schoolId]/settings/branding — authed tenant admin page to re-run or
 * tweak the brand detection. Loads the existing TenantBranding if there
 * is one so the wizard starts in "editing" mode rather than blank.
 */
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { BrandingWizard, BrandingPreview } from '@/components/branding/BrandingWizard';
import { BrandingSettingsCard } from '@/components/settings/BrandingSettingsCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trash2, Paintbrush } from 'lucide-react';
import { pushBrandingPreview } from '@/components/branding/BrandStyleInjector';
import { useTenant, useTenantBranding, useInvalidateTenantBranding } from '@/hooks/use-api';

export default function SettingsBrandingPage() {
  const { data: tenant } = useTenant();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const [confirmRevert, setConfirmRevert] = useState(false);

  // Shared cache subscription instead of a raw apiFetch on mount.
  // This page is one of ~4 sites that used to fire its own
  // `/branding/me` request, contributing to the 8x-per-nav burst.
  // Now it reads through useTenantBranding so the BrandStyleInjector
  // + Sidebar + BrandingSettingsCard + BrandingProvider all share the
  // same in-flight or already-resolved query.
  const { data: brandingRow, isLoading: brandingLoading } = useTenantBranding();
  const invalidateBranding = useInvalidateTenantBranding();
  const loading = brandingLoading;

  // 2026-05-26 — operator: "when i save and apply the branding then go
  // back into the reskin option, it forgets everything i had loaded".
  //
  // Bug was effect-ordering. Pre-fix used `useState+useEffect`: the
  // wizard mounted with `initial={current}` where `current` was the
  // useState slot, which started null and was filled by useEffect ON
  // THE NEXT TICK. But the wizard's own internal `useState` captured
  // `initial?.sourceUrl ?? ''` on FIRST render — which was still null
  // at that moment. Subsequent updates to `current` never re-pushed
  // through because the wizard already had its captured state.
  //
  // Fix: derive `current` synchronously via `useMemo` so it's already
  // populated on the same render the wizard mounts on. No async gap.
  const current = useMemo<BrandingPreview | null>(() => {
    if (!brandingRow) return null;
    const b = brandingRow as any;
    return {
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
    };
  }, [brandingRow]);

  const revert = async () => {
    try {
      await apiFetch('/branding/me', { method: 'DELETE' });
      // `current` is now derived via useMemo from brandingRow, so we
      // don't setCurrent(null) — the cache invalidation below makes
      // useTenantBranding refetch and return null, which makes
      // `current` recompute to null on the next render automatically.
      invalidateBranding();
      pushBrandingPreview({ palette: null, displayName: null, tagline: null, logoUrl: null, faviconUrl: null, fontHeading: null, fontBody: null });
      setConfirmRevert(false);
    } catch (e) {
      // let user retry
    }
  };

  // 2026-05-25 — header pattern unified with /settings/emergency.
  // Was a full-width white box with border-b that looked square
  // against the page background. Now a contained max-w header
  // that matches the rest of the chrome.
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href={`/${schoolId}/settings`}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Paintbrush className="w-6 h-6 text-indigo-500" />
            Branding
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Your CMS looks like your school. Paste a URL or tweak below.
          </p>
        </div>
        {current && (
          <div className="mt-1">
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
      </header>

      {/* 2026-05-26 round 2 — operator: "we talked about moving the
          template rebranding to underneath the inital scanning section
          because its weird to have that above the area where you
          actually do the inital scanning and selecting of the logos."
          Order is now:
            1) BrandingWizard (scan + scrape + adopt — the primary action)
            2) BrandingSettingsCard (Apply-brand-to-templates +
               Reset — the follow-up actions you only take AFTER you
               have a brand)
          This is the inverse of the previous shipped order; the
          earlier "move details OFF /settings" pass conflated two
          things — operator wanted the brand-DETAILS card off of
          /settings (kept), and wanted it BELOW the wizard on
          /settings/branding (was reversed; now correct). */}
      {loading ? (
        <div className="p-10 text-center text-slate-500">Loading…</div>
      ) : (
        <>
          <BrandingWizard
            mode="authed"
            initial={current || undefined}
            vertical={(tenant as any)?.vertical || 'K12'}
          />
          {/* applyOnly mode: just Apply-to-templates + Reset. The
              logo + source URL + Re-skin header would be redundant
              here — the wizard above already shows those. Operator:
              "the only option this should be is to brand your
              templates right?" */}
          <div className="mt-6">
            <BrandingSettingsCard applyOnly />
          </div>
        </>
      )}
    </div>
  );
}
