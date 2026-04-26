"use client";

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTenantBranding } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { useBuilderStore } from './useBuilderStore';

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
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const qc = useQueryClient();
  const updateZone = useBuilderStore((s) => s.updateZone);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const zones = useBuilderStore((s) => s.zones);

  const handleScrape = async () => {
    if (!scrapeUrl.trim()) return;
    setScraping(true);
    setScrapeError(null);
    try {
      await apiFetch('/branding/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: scrapeUrl }),
      });
      setScrapeUrl('');
      qc.invalidateQueries({ queryKey: ['tenant-branding'] });
    } catch (err) {
      setScrapeError(
        err instanceof Error ? err.message : 'Failed to scrape branding'
      );
    } finally {
      setScraping(false);
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
            <input
              type="url"
              placeholder="https://example.com"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
              className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={handleScrape}
              disabled={!scrapeUrl.trim() || scraping}
              className="w-full px-2 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {scraping ? 'Scraping...' : 'Detect brand'}
            </button>
            {scrapeError && (
              <div className="text-[11px] text-red-600">{scrapeError}</div>
            )}
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
