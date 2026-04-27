"use client";

import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate, useAdoptTemplateBrandKit, useClearTemplateBrandKit } from '@/hooks/use-api';

/**
 * Per-template Brand Kit panel.
 *
 * IMPORTANT — operator feedback 2026-04-27:
 *   "you are suppose to bring in colors, logos, etc TO US ON THE
 *   CUSTOM TEMPLATE MAKER but what you really do is update the
 *   overall page brand from the template … those are two separate
 *   things — one for the template making and one for the overall
 *   CMS software."
 *
 * Pre-fix: this panel called /branding/scrape THEN /branding/adopt,
 * the second of which writes to the tenant-wide TenantBranding row
 * — the same row that themes the entire CMS dashboard chrome via
 * BrandStyleInjector. So one click here re-skinned the whole CMS
 * for the entire tenant, which was never the intent.
 *
 * Post-fix (this file):
 *   - Scrape stays at /branding/scrape (no persistence — correct).
 *   - Adopt now goes to /branding/templates/{id}/adopt — writes
 *     ONLY to Template.brandKit JSON column. The global tenant
 *     branding is untouched.
 *   - Reads brandKit FROM the loaded template (via useTemplate),
 *     not from the tenant branding query.
 *   - Does NOT call pushBrandingPreview / BrandStyleInjector.
 *   - Does NOT seed the global LS branding cache.
 *
 * The "skin the whole CMS dashboard" lever stays at
 * `/settings/branding` — that's its intended home.
 */

interface BrandKit {
  logoUrl?: string | null;
  logoSvgInline?: string | null;
  palette?: {
    primary?: string;
    primaryHover?: string;
    accent?: string;
    ink?: string;
    surface?: string;
    surfaceAlt?: string;
  } | null;
  fontHeading?: string | null;
  fontBody?: string | null;
  displayName?: string | null;
  sourceUrl?: string | null;
  scrapedAt?: string | null;
}

export function BrandKitPanel() {
  const templateId = useBuilderStore((s) => s.templateId);
  const isSystem = useBuilderStore((s) => s.isSystem);
  const { data: template, isLoading } = useTemplate(templateId);
  const brandKit: BrandKit | null = (template as any)?.brandKit ?? null;

  const adoptMutation = useAdoptTemplateBrandKit(templateId);
  const clearMutation = useClearTemplateBrandKit(templateId);

  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapePhase, setScrapePhase] = useState<'idle' | 'scanning' | 'applying'>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const updateZone = useBuilderStore((s) => s.updateZone);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const zones = useBuilderStore((s) => s.zones);

  /**
   * One-click "detect brand from URL" — scrapes the URL preview, then
   * persists ONLY to this template (not the global CMS theme).
   */
  const handleScrape = async () => {
    const raw = scrapeUrl.trim();
    if (!raw) return;
    if (!templateId) {
      setScrapeError('Save the template first, then detect brand.');
      return;
    }
    if (isSystem) {
      setScrapeError('System presets can\'t carry per-template brand kits. Duplicate this preset, then customize the copy.');
      return;
    }
    // Accept "e-arc.com" or "www.e-arc.com" without the scheme.
    const finalUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    setScraping(true);
    setScrapeError(null);
    setScrapePhase('scanning');
    try {
      const preview = await apiFetch<any>('/branding/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: finalUrl }),
      });

      if (!preview || (!preview.palette && !preview.colors?.length && !preview.logos?.length)) {
        throw new Error("We couldn't find a logo or palette on that site. Try the school's main homepage URL.");
      }

      setScrapePhase('applying');

      // Persist to THIS TEMPLATE ONLY. Same body shape as the global
      // /branding/adopt endpoint — the server uses the same logo
      // rehost + sanitize logic, just scoped to a per-template
      // Supabase prefix.
      await adoptMutation.mutateAsync({
        ...preview,
        palette: preview.palette,
      });

      setScrapeUrl('');
    } catch (err) {
      setScrapeError(
        err instanceof Error ? err.message : 'Failed to detect brand. Try the homepage URL.'
      );
    } finally {
      setScraping(false);
      setScrapePhase('idle');
    }
  };

  /** Wipe this template's brand kit. Doesn't touch the tenant theme. */
  const handleClear = async () => {
    if (!templateId) return;
    if (!confirm('Clear this template\'s brand kit? Your global CMS theme is not affected.')) return;
    try {
      await clearMutation.mutateAsync();
    } catch (err) {
      setScrapeError(
        err instanceof Error ? err.message : 'Failed to clear brand kit.'
      );
    }
  };

  const handleColorClick = (hex: string) => {
    if (selectedIds.length === 1) {
      const zoneId = selectedIds[0];
      const zone = zones.find((z) => z.id === zoneId);
      if (zone && zone.defaultConfig?.color !== undefined) {
        updateZone(zoneId, {
          defaultConfig: { ...zone.defaultConfig, color: hex },
        });
        return;
      }
    }
    navigator.clipboard.writeText(hex);
  };

  const handleFontClick = (fontName: string, _fontType: 'heading' | 'body') => {
    if (selectedIds.length === 1) {
      const zoneId = selectedIds[0];
      const zone = zones.find((z) => z.id === zoneId);
      if (zone && zone.widgetType === 'TEXT') {
        updateZone(zoneId, {
          defaultConfig: { ...zone.defaultConfig, fontFamily: fontName },
        });
        return;
      }
    }
  };

  if (isLoading || !templateId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-xs">Loading brand kit…</div>
      </div>
    );
  }

  // Empty state — no per-template brand kit yet
  if (!brandKit) {
    return (
      <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-xs font-semibold text-slate-600">
            No brand kit on this template
          </div>
          <div className="text-[11px] text-slate-500 leading-relaxed">
            Paste your school's website URL to auto-detect colors, logo,
            and fonts to use <em>inside this template</em>. Your global
            CMS theme is separate.
          </div>
          <div className="w-full space-y-2">
            <input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="yourschool.org or https://www.yourschool.org"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
              disabled={scraping || isSystem}
              className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              onClick={handleScrape}
              disabled={!scrapeUrl.trim() || scraping || isSystem}
              className="w-full px-2 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {scrapePhase === 'scanning' ? 'Scanning website…' :
               scrapePhase === 'applying' ? 'Saving brand kit…' :
               'Detect brand for this template'}
            </button>
            {isSystem && (
              <div className="text-[11px] text-amber-600 leading-relaxed">
                System presets can't carry brand kits. Duplicate this preset, then add a brand kit to the copy.
              </div>
            )}
            {scrapeError && (
              <div className="text-[11px] text-red-600 leading-relaxed">{scrapeError}</div>
            )}
            <div className="text-[10px] text-slate-400 leading-relaxed pt-1">
              Want to skin the whole CMS dashboard instead? Open
              {' '}<a href="/settings/branding" className="underline text-indigo-600 hover:text-indigo-700">Settings → Branding</a>
              {' '}— that page is for the global theme.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Populated state — per-template brand kit is set
  return (
    <div className="flex flex-col h-full gap-0 overflow-y-auto">
      {/* Header — make it crystal clear this is per-template */}
      <div className="border-b border-slate-200/50 p-3 bg-indigo-50/50">
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
          This template's brand kit
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
          Used as design tokens inside this template only. Doesn't change the dashboard theme.
        </div>
      </div>

      {/* Logo */}
      {brandKit.logoUrl && (
        <div className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Logo
          </div>
          <div className="w-24 h-24 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
            <img
              src={brandKit.logoUrl}
              alt="School logo"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Palette */}
      {brandKit.palette && (
        <div className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand colors
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[
              { label: 'Primary', hex: brandKit.palette.primary },
              { label: 'Primary Hover', hex: brandKit.palette.primaryHover },
              { label: 'Accent', hex: brandKit.palette.accent },
              { label: 'Text', hex: brandKit.palette.ink },
              { label: 'Surface', hex: brandKit.palette.surface },
              { label: 'Surface Alt', hex: brandKit.palette.surfaceAlt },
            ].filter((c) => !!c.hex).map((item) => (
              <button
                key={item.label}
                onClick={() => handleColorClick(item.hex as string)}
                title={`${item.label}: ${item.hex} (click to apply or copy)`}
                className="group relative w-8 h-8 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 transition-all"
                style={{ backgroundColor: item.hex }}
              >
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[9px] px-1 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                  {item.label}
                </div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed">
            Click a swatch to apply to the selected text zone, or copy the hex.
          </div>
        </div>
      )}

      {/* Fonts */}
      {(brandKit.fontHeading || brandKit.fontBody) && (
        <div className="border-b border-slate-200/50 p-4 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand fonts
          </div>
          <div className="space-y-2">
            {brandKit.fontHeading && (
              <button
                onClick={() => handleFontClick(brandKit.fontHeading!, 'heading')}
                className="w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="text-sm font-semibold" style={{ fontFamily: brandKit.fontHeading }}>
                  {brandKit.fontHeading}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Heading font</div>
              </button>
            )}
            {brandKit.fontBody && (
              <button
                onClick={() => handleFontClick(brandKit.fontBody!, 'body')}
                className="w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="text-sm" style={{ fontFamily: brandKit.fontBody }}>
                  {brandKit.fontBody}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Body font</div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Footer — display name + clear button */}
      <div className="border-t border-slate-200/50 p-3 bg-slate-50 space-y-2">
        {brandKit.displayName && (
          <div className="text-[10px] font-semibold text-slate-600">
            {brandKit.displayName}
          </div>
        )}
        {brandKit.sourceUrl && (
          <div className="text-[9px] text-slate-400 truncate" title={brandKit.sourceUrl}>
            From {brandKit.sourceUrl}
          </div>
        )}
        <button
          onClick={handleClear}
          disabled={clearMutation.isPending}
          className="w-full text-[10px] text-slate-500 hover:text-red-600 disabled:text-slate-300 transition-colors py-1"
        >
          {clearMutation.isPending ? 'Clearing…' : 'Clear brand kit for this template'}
        </button>
      </div>
    </div>
  );
}
