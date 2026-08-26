"use client";

/**
 * BrandingContext — broadcasts the active tenant's brand kit to every
 * widget in the editor (and, eventually, the player) so widgets can
 * fall back to brand colors / fonts when their own config is blank.
 *
 * Why this exists (2026-05-04):
 *   Operator: "i have added the branding to the templates multiple
 *              times now but it doesnt seem to save that"
 *   Operator: "i feel like the widgets them selves should get your
 *              branding overhaul, the tickers font, font color,
 *              background of the widgets, etc...."
 *
 *   Today every widget hard-codes its own palette + font in its
 *   render. The user's tenant brand never reaches the rendered
 *   screen. This is the fix's foundation: a single fetch of
 *   /tenants/me/branding, broadcast via React context, consumed by
 *   any widget that wants to brand-fallback.
 *
 * Contract:
 *   - useBranding() returns the brand snapshot or null. Returning
 *     null is safe — widgets must keep their own defaults as a
 *     fallback so they render correctly OUTSIDE the provider (e.g.
 *     screenshot tools, the standalone player when it consumes the
 *     manifest's template.brandKit instead of the tenant fetch).
 *   - Hierarchy a widget should follow:
 *       1) explicit zone config.style.* (operator chose a value)
 *       2) explicit top-level config.* (legacy editor field)
 *       3) brand from useBranding() (auto-themed)
 *       4) widget's hard-coded default
 *
 *   - DO NOT use this to override an explicit operator choice. Brand
 *     is a fallback only.
 *
 *   - The provider is intentionally inside QueryClientProvider so it
 *     can use useTenantBranding(). Outside QueryClient the hook
 *     would throw.
 */

import { createContext, useContext, ReactNode } from 'react';
import { useTenantBranding } from '@/hooks/use-api';

export interface BrandSnapshot {
  /** Full palette { primary, primaryHover, accent, accentHover, ink, surface, surfaceAlt, ... } */
  palette: Record<string, string> | null;
  /** Google-Fonts-matched name for headings, or null. */
  fontHeading: string | null;
  /** Google-Fonts-matched name for body text, or null. */
  fontBody: string | null;
  /** Tenant logo URL (re-hosted in our Supabase). */
  logoUrl: string | null;
  /** Inline SVG for crisp logo rendering when source was SVG. */
  logoSvgInline: string | null;
  /**
   * Backdrop treatment the operator picked for the logo (the branding
   * wizard's third picker). Read it through
   * `components/branding/logo-backdrop.ts` — never hand-roll the mapping.
   */
  logoBackground: string | null;
  /** Display name like "Lincoln HS Signage". */
  displayName: string | null;
}

const Ctx = createContext<BrandSnapshot | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  // useTenantBranding() returns { data, isLoading, error }. We only
  // care about data — if the fetch fails (no auth, no tenant brand
  // configured) we hand null to consumers and they fall through to
  // their own defaults. No retry, no spinner — branding is a "nice
  // to have" decoration, not load-bearing.
  const { data } = useTenantBranding();

  const snapshot: BrandSnapshot | null = data
    ? {
        // Cast via `unknown` — BrandPalette has named keys (primary,
        // accent, etc.) but consumers iterate by arbitrary string key
        // via `palette[name]`. The two type shapes are structurally
        // compatible at runtime (BrandPalette values are all strings)
        // but the type system needs an explicit bridge.
        palette: (data.palette as unknown as Record<string, string>) || null,
        fontHeading: data.fontHeading || null,
        fontBody: data.fontBody || null,
        logoUrl: data.logoUrl || null,
        logoSvgInline: data.logoSvgInline || null,
        logoBackground: (data.palette as any)?.logoBackground || null,
        displayName: data.displayName || null,
      }
    : null;

  return <Ctx.Provider value={snapshot}>{children}</Ctx.Provider>;
}

/**
 * Read the active tenant brand. Returns null when no provider is
 * mounted OR the tenant has no brand configured. Widgets MUST handle
 * the null case by using their own defaults — never assume non-null.
 */
export function useBranding(): BrandSnapshot | null {
  return useContext(Ctx);
}

/**
 * Convenience: pick a brand color by key with a fallback. Returns the
 * fallback if no brand or the key doesn't exist. For widgets that
 * want one-line "use brand primary or fall back to my hard-coded
 * default" semantics:
 *
 *   const textColor = config.style?.textColor ?? brandColor(brand, 'primary', '#ff2bd6');
 */
export function brandColor(
  brand: BrandSnapshot | null,
  key: string,
  fallback: string,
): string {
  if (!brand?.palette) return fallback;
  return (brand.palette[key] as string) || fallback;
}

/**
 * Convenience: pick the brand heading font with fallback. Same null-
 * safe contract as brandColor.
 */
export function brandFontHeading(brand: BrandSnapshot | null, fallback: string): string {
  return brand?.fontHeading || fallback;
}
