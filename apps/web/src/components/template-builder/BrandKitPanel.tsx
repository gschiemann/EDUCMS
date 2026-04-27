"use client";

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTenantBranding } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { useBuilderStore } from './useBuilderStore';
import { pushBrandingPreview } from '@/components/branding/BrandStyleInjector';
import { useAppStore } from '@/lib/store';

interface BrandingData {
  logoUrl: string | null;
  palette: {
    primary: string;
    primaryHover: string;
    accent: string;
    ink: string;
    surface: string;
    surfaceAlt: string;
  } | null;
  fontHeading: string | null;
  fontBody: string | null;
  displayName: string | null;
}

export function BrandKitPanel() {
  const { data: branding, isLoading, error } = useTenantBranding();
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapePhase, setScrapePhase] = useState<'idle' | 'scanning' | 'applying'>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const qc = useQueryClient();
  const updateZone = useBuilderStore((s) => s.updateZone);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const zones = useBuilderStore((s) => s.zones);
  const user = useAppStore((s) => s.user);

  /**
   * One-click "detect + apply" — scrapes the URL and immediately adopts
   * the scraped preview. The full BrandingWizard at /settings/branding
   * lets operators tweak each piece (logo choice, primary color, fonts)
   * before adopting; the in-builder panel is the fast path that just
   * snaps a brand kit on so the operator can keep designing.
   *
   * Two operator-reported bugs this fixes:
   *  1. "first it didnt take the url without http" — the input was
   *     `type="url"` so HTML5 validation silently rejected bare
   *     hostnames like `e-arc.com`. Switched to `type="text"` and
   *     auto-prefix `https://` if no scheme is present.
   *  2. "i added it and it didnt do shit" — old handleScrape called
   *     /branding/scrape (preview-only) but never /branding/adopt
   *     (persist), so the panel reloaded with no change. Now scrape
   *     immediately rolls into adopt and dispatches the live-update
   *     event so the admin chrome repaints in real time.
   */
  const handleScrape = async () => {
    const raw = scrapeUrl.trim();
    if (!raw) return;
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

      // No usable signal back? Tell the operator instead of silently
      // succeeding into "nothing happened."
      if (!preview || (!preview.palette && !preview.colors?.length && !preview.logos?.length)) {
        throw new Error("We couldn't find a logo or palette on that site. Try the school's main homepage URL.");
      }

      setScrapePhase('applying');

      // Adopt the scraped preview verbatim. The wizard at
      // /settings/branding is the place to fine-tune choices; the
      // builder panel goes for "fast and good enough."
      const adopted = await apiFetch<any>('/branding/adopt', {
        method: 'POST',
        body: JSON.stringify({
          ...preview,
          // adopt expects palette to be the FINAL palette object —
          // scraper already returns one, so pass it through. No
          // logoOverride means it'll pick the top-ranked logo.
          palette: preview.palette,
        }),
      });

      // Push the new branding to BrandStyleInjector (live-repaint) and
      // seed the LS cache so the next route render reads the new theme
      // instead of falling back to defaults. Mirror of what the wizard
      // does on adopt.
      try {
        const json = JSON.stringify(adopted.branding);
        const tenantId = user?.tenantId;
        if (tenantId) localStorage.setItem(`edu-cms-branding-cache-v1:${tenantId}`, json);
        else localStorage.setItem('edu-cms-branding-cache-v1', json);
      } catch {}
      pushBrandingPreview(adopted.branding);

      setScrapeUrl('');
      qc.invalidateQueries({ queryKey: ['tenant-branding'] });
    } catch (err) {
      setScrapeError(
        err instanceof Error ? err.message : 'Failed to detect brand. Try the homepage URL.'
      );
    } finally {
      setScraping(false);
      setScrapePhase('idle');
    }
  };

  const handleColorClick = (hex: string) => {
    // If a zone is selected and it has a color property, update it
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
    // Otherwise copy to clipboard
    navigator.clipboard.writeText(hex);
  };

  const handleFontClick = (fontName: string, fontType: 'heading' | 'body') => {
    // If a single text zone is selected, update its font
    if (selectedIds.length === 1) {
      const zoneId = selectedIds[0];
      const zone = zones.find((z) => z.id === zoneId);
      if (zone && zone.widgetType === 'TEXT') {
        const fontKey = fontType === 'heading' ? 'fontFamily' : 'fontFamily';
        updateZone(zoneId, {
          defaultConfig: { ...zone.defaultConfig, [fontKey]: fontName },
        });
        return;
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-xs">Loading brand kit...</div>
      </div>
    );
  }

  // Empty state — no branding configured
  if (!branding) {
    return (
      <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-xs font-semibold text-slate-600">
            No brand kit configured
          </div>
          <div className="text-[11px] text-slate-500 leading-relaxed">
            Paste your school's website URL to auto-detect your brand colors,
            logo, and fonts.
          </div>
          <div className="w-full space-y-2">
            {/* type="text" not "url" — HTML5 url validation rejects
                bare hostnames like "e-arc.com" before they can even
                reach the handler. We add the https:// in JS. */}
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
              disabled={scraping}
              className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              onClick={handleScrape}
              disabled={!scrapeUrl.trim() || scraping}
              className="w-full px-2 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {scrapePhase === 'scanning' ? 'Scanning website…' :
               scrapePhase === 'applying' ? 'Applying brand…' :
               'Detect brand'}
            </button>
            {scrapeError && (
              <div className="text-[11px] text-red-600 leading-relaxed">{scrapeError}</div>
            )}
            <div className="text-[10px] text-slate-400 leading-relaxed pt-1">
              Need fine-tuning? Open <a href="/settings/branding" className="underline text-indigo-600 hover:text-indigo-700">Settings → Branding</a> to pick logos, tweak colors, and preview before adopting.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Populated state — show logo, colors, fonts
  return (
    <div className="flex flex-col h-full gap-0 overflow-y-auto">
      {/* Logo section */}
      {branding.logoUrl && (
        <div className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Logo
          </div>
          <div className="w-24 h-24 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
            <img
              src={branding.logoUrl}
              alt="School logo"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Brand colors section */}
      {branding.palette && (
        <div className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand colors
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[
              { label: 'Primary', hex: branding.palette.primary },
              { label: 'Primary Hover', hex: branding.palette.primaryHover },
              { label: 'Accent', hex: branding.palette.accent },
              { label: 'Text', hex: branding.palette.ink },
              { label: 'Surface', hex: branding.palette.surface },
              { label: 'Surface Alt', hex: branding.palette.surfaceAlt },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => handleColorClick(item.hex)}
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
            Click a swatch to apply to the selected text zone, or copy the hex
            code.
          </div>
        </div>
      )}

      {/* Fonts section */}
      {(branding.fontHeading || branding.fontBody) && (
        <div className="border-b border-slate-200/50 p-4 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand fonts
          </div>
          <div className="space-y-2">
            {branding.fontHeading && (
              <button
                onClick={() => handleFontClick(branding.fontHeading!, 'heading')}
                className="w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-colors text-left"
              >
                <div
                  className="text-sm font-semibold"
                  style={{ fontFamily: branding.fontHeading }}
                >
                  {branding.fontHeading}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Heading font
                </div>
              </button>
            )}
            {branding.fontBody && (
              <button
                onClick={() => handleFontClick(branding.fontBody!, 'body')}
                className="w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-colors text-left"
              >
                <div
                  className="text-sm"
                  style={{ fontFamily: branding.fontBody }}
                >
                  {branding.fontBody}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Body font
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Branding info footer */}
      {branding.displayName && (
        <div className="border-t border-slate-200/50 p-3 bg-slate-50">
          <div className="text-[10px] font-semibold text-slate-600">
            {branding.displayName}
          </div>
        </div>
      )}
    </div>
  );
}
