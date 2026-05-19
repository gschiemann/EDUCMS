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
    tagline: 'Every screen, every venue — one platform.',
    // K-12 leads the pitch: it's the proven pilot and the strongest
    // emergency-alert story. The other verticals follow so the
    // platform reads as a universal CMS, not a school-only tool.
    pitch: 'Digital signage, kiosks, and emergency alerts for K-12 schools, restaurants, gyms, retail, healthcare, hotels, and corporate lobbies. One CMS, every industry.',
    colors: {
      // Indigo — matches the redesigned signup / login / landing chrome
      // and the hexagonal brand mark (BrandMark.tsx). A brand-new account
      // with no custom TenantBranding paints THIS palette (via
      // BrandStyleInjector → brandDefaultPalette) so the dashboard reads
      // as the same product as the marketing site from the first login.
      primary: '#4f46e5',      // indigo-600 — the hex-mark fill + signup CTA
      primaryHover: '#4338ca', // indigo-700 — the CTA hover
      accent: '#6366f1',       // indigo-500 — focus rings, highlights
    },
    primaryDomain: 'venue-os.app',
    logoVariant: 'venue',
    showVerticalPicker: true,  // multi-vertical
    defaultVertical: 'GYM',    // most common non-K12 starter
  },
};

/**
 * Server-side brand resolution. Call from RSC / route handlers.
 * Reads NEXT_PUBLIC_CMS_BRAND env var; defaults to VenueOS so the
 * platform reads as industry-agnostic by default. Operator decision
 * 2026-05-04: "remove the text that says EDU Signage and replace it
 * all with Venue OS so that the app can be used for any industry".
 * The educms brand still exists as an explicit override for the
 * K-12 pilot deployment.
 */
export function getServerBrand(): BrandConfig {
  const envBrand = (process.env.NEXT_PUBLIC_CMS_BRAND || '').toLowerCase().trim();
  if (envBrand === 'educms') return BRANDS.educms;
  return BRANDS.venueos;
}

/**
 * Client-side brand resolution. Prefers env (set at build time and
 * inlined into the bundle).
 *
 * 2026-05-05 — operator: "lets change the default to Venue OS right?
 * and the login screen still says K-12". Previously the host-based
 * fallback flipped to EDU CMS branding whenever the URL contained
 * 'educms' — which fired on the existing pilot deployment
 * (educms-five.vercel.app), so refreshing the dashboard always reset
 * to the K-12 chrome. Removed the host check: the deployment URL is
 * an artifact, not a brand declaration. EDU CMS branding now requires
 * an EXPLICIT `NEXT_PUBLIC_CMS_BRAND=educms` opt-in. Default = VenueOS
 * everywhere else.
 */
export function getClientBrand(): BrandConfig {
  if (typeof window === 'undefined') return getServerBrand();
  const envBrand = (process.env.NEXT_PUBLIC_CMS_BRAND || '').toLowerCase().trim();
  if (envBrand === 'educms') return BRANDS.educms;
  return BRANDS.venueos;
}
