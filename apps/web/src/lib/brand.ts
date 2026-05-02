/**
 * VenueOS / EDU CMS — single source of truth for brand identity.
 *
 * One codebase, two brand storefronts. Operator decision 2026-05-02:
 *   - EDU CMS — direct K-12 sales, current pilot, district focus
 *   - VenueOS — multi-industry version (gym, retail, corporate, QSR,
 *     fashion, ...) repurposes the same backend
 *
 * Resolution order:
 *   1. Server-side (SSR / API routes) — read NEXT_PUBLIC_CMS_BRAND env
 *      var. Set per Vercel deployment (`venueos.com` deployment sets
 *      NEXT_PUBLIC_CMS_BRAND=venueos; `educms.com` deployment sets it
 *      to `educms`).
 *   2. Client-side fallback — read window.location.host. Lets a single
 *      preview deployment serve both brands by domain detection.
 *   3. Default — EDU CMS (preserves existing pilot behavior; nothing
 *      changes for current customers until they're explicitly migrated
 *      to a VenueOS-branded deployment).
 *
 * Tenant-level branding (custom logos, colors, terminology) layers on
 * top of this — see TenantBranding model in schema.prisma. The resolved
 * brand here is the FALLBACK shown when no tenant override is set
 * AND the marketing chrome (login page, landing page, footer).
 */

export type BrandKey = 'educms' | 'venueos';

export interface BrandConfig {
  key: BrandKey;
  name: string;
  tagline: string;
  /** Used for <title>, page heads, OG tags */
  productName: string;
  /** Marketing one-liner — the elevator pitch */
  pitch: string;
  /** Default theme colors. Tenant branding overrides these per-tenant. */
  colors: {
    primary: string;
    primaryHover: string;
    accent: string;
  };
  /** Domain we expect this brand to be served from in production. */
  primaryDomain: string;
  /** Logo identifier — components map this to the actual SVG/PNG path. */
  logoVariant: 'edu' | 'venue';
  /** Whether the vertical-picker is shown on signup. */
  showVerticalPicker: boolean;
  /** Default vertical for new signups under this brand. */
  defaultVertical: 'K12' | 'GYM' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION';
}

export const BRANDS: Record<BrandKey, BrandConfig> = {
  educms: {
    key: 'educms',
    name: 'EDU CMS',
    productName: 'EDU CMS',
    tagline: 'K-12 digital signage, made simple.',
    pitch: 'Built for districts, schools, and campuses. Emergency-grade alerts on every screen, every time.',
    colors: {
      primary: '#6366f1',      // indigo-500
      primaryHover: '#4f46e5', // indigo-600
      accent: '#10b981',       // emerald-500
    },
    primaryDomain: 'educms-five.vercel.app',
    logoVariant: 'edu',
    showVerticalPicker: false, // K12 only
    defaultVertical: 'K12',
  },
  venueos: {
    key: 'venueos',
    name: 'VenueOS',
    productName: 'VenueOS',
    tagline: 'Run any screen, anywhere — one platform for every venue.',
    pitch: 'Digital signage, kiosks, and emergency systems for gyms, retail, restaurants, corporate lobbies, and more. One CMS, every industry.',
    colors: {
      primary: '#0ea5e9',      // sky-500 — distinct from EDU's indigo
      primaryHover: '#0284c7', // sky-600
      accent: '#f59e0b',       // amber-500 (warm, broad-appeal)
    },
    primaryDomain: 'venueos.com', // placeholder until domain is acquired
    logoVariant: 'venue',
    showVerticalPicker: true,  // multi-vertical
    defaultVertical: 'GYM',    // most common non-K12 starter
  },
};

/**
 * Server-side brand resolution. Call from RSC / route handlers.
 * Reads NEXT_PUBLIC_CMS_BRAND env var; defaults to EDU CMS to preserve
 * current pilot behavior without an explicit env config.
 */
export function getServerBrand(): BrandConfig {
  const envBrand = (process.env.NEXT_PUBLIC_CMS_BRAND || '').toLowerCase().trim();
  if (envBrand === 'venueos') return BRANDS.venueos;
  return BRANDS.educms;
}

/**
 * Client-side brand resolution. Prefers env (set at build time and
 * inlined into the bundle); falls back to host detection so a single
 * staging deployment can serve both brands by domain.
 */
export function getClientBrand(): BrandConfig {
  if (typeof window === 'undefined') return getServerBrand();
  const envBrand = (process.env.NEXT_PUBLIC_CMS_BRAND || '').toLowerCase().trim();
  if (envBrand === 'venueos') return BRANDS.venueos;
  if (envBrand === 'educms') return BRANDS.educms;
  // Domain-based fallback
  const host = window.location.host.toLowerCase();
  if (host.includes('venueos')) return BRANDS.venueos;
  return BRANDS.educms;
}
