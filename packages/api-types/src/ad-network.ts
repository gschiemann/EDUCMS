/**
 * Ad-network integrations — provider catalog and shared types.
 * ──────────────────────────────────────────────────────────────
 *
 * Sprint 8d (2026-05-03) — programmatic display advertising. Venue
 * operators (gym / bar / restaurant / retail) opt their screens into
 * a programmatic ad-network and earn revenue when ads play. We act
 * as the SSP-side integration, serving inventory through the
 * operator's existing CMS template — they get a revenue share, we
 * get a transaction fee.
 *
 * SAME ARCHITECTURE AS STREAMING + POS:
 *   • `AD_NETWORKS` is the canonical catalog. Both API + web read it.
 *   • Each network declares auth strategy + pricing model.
 *   • Server-side handlers fetch creative + report impressions.
 *   • Per-tenant credentials in AdNetworkConnection (encrypted).
 *
 * REVENUE MODEL:
 *   • Operator earns CPM (cost-per-thousand-impressions) — typically
 *     $5-$15 per 1k for venue-grade DOOH (digital out-of-home).
 *   • We take a 10-15% transaction fee on each impression delivered.
 *   • Operator can mix paid network ads with their own house ads
 *     (already supported via StreamAdSlot from streaming framework).
 *
 * COMPLIANCE / TRUST DISCIPLINE:
 *   • IAB content-category controls per tenant — gym tenant can
 *     opt out of alcohol / pharma ads, bar can opt out of family
 *     content, etc.
 *   • Brand safety: every creative passes through our moderation
 *     queue before its first impression.
 *   • Daypart / placement caps enforced server-side (operator can
 *     forbid ads during emergency mode, between 6am-9am, etc.)
 */

/** Authentication strategy for connecting an ad network. */
export type AdNetworkAuthKind =
  | 'oauth2'        // Standard OAuth + refresh tokens (Hivestack, Vistar, Place Exchange)
  | 'apiKey'        // Per-publisher API key (Broadsign, smaller SSPs)
  | 'partnerKey';   // Sales-led partner programs (Adams Outdoor, large DOOH)

/** Pricing model the network uses. Drives the rev-share UI. */
export type AdNetworkPricingModel =
  | 'cpm'           // Cost per thousand impressions — most common for DOOH
  | 'cpc'           // Cost per click — rare for non-touch screens
  | 'cpd'           // Cost per day — flat-rate buyouts
  | 'revshare';     // Pure revenue share, no fixed CPM

/** Categories the ad network specializes in. */
export type AdNetworkCategory =
  | 'dooh-programmatic' // Hivestack, Vistar, Place Exchange — open exchange
  | 'dooh-direct'       // Direct sales orgs (Adams, Lamar) — sales-led
  | 'venue-network'     // Atmosphere, Loop Media — vertical-specific
  | 'house-only';       // Operator runs their own ads, no network — no rev

export interface AdNetworkDef {
  id: string;
  name: string;
  category: AdNetworkCategory;
  blurb: string;
  iconEmoji?: string;
  iconUrl?: string;
  auth: AdNetworkAuthKind;
  pricingModel: AdNetworkPricingModel;
  /** Typical CPM range in USD cents (e.g. 1000 = $10 CPM). */
  typicalCpmCents?: { low: number; high: number };
  /** Our take-rate (basis points). 1500 = 15% transaction fee. */
  takeRateBps?: number;
  docsUrl?: string;
  websiteUrl?: string;
  pricingNote?: string;
  bestFor?: ReadonlyArray<'GYM' | 'BAR' | 'RESTAURANT' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'K12'>;
  /** Capabilities — drives the per-network UI. */
  capabilities: {
    creativeFetch?: boolean;     // network sends us VAST/HTML5 creative
    impressionReporting?: boolean;// we report back impression counts
    daypartTargeting?: boolean;   // network respects our daypart filters
    contentSafety?: boolean;      // network has IAB category controls
    realtimeFill?: boolean;       // RTB-style real-time bidding
  };
  /** Sales-led only? Hides self-serve "Connect" button. */
  salesLedOnly?: boolean;
  /** Schools (K12) cannot show third-party ads — gating flag. */
  k12Forbidden?: boolean;
}

/**
 * The ad-network catalog. Order = priority order in the UI picker.
 *
 * Mark NEW networks with `// NEW 2026-05-DD` so release notes can grep them.
 */
export const AD_NETWORKS: ReadonlyArray<AdNetworkDef> = [
  // ─── TIER 1 — PROGRAMMATIC DOOH (open exchange) ───────────────────
  {
    id: 'hivestack',
    name: 'Hivestack',
    category: 'dooh-programmatic',
    blurb: 'Global programmatic DOOH SSP. Highest fill rate for venue networks.',
    iconEmoji: '🐝',
    auth: 'oauth2',
    pricingModel: 'cpm',
    typicalCpmCents: { low: 500, high: 1500 },
    takeRateBps: 1500,
    docsUrl: 'https://hivestack.com/publishers',
    websiteUrl: 'https://hivestack.com',
    pricingNote: '~$5-15 CPM, we take 15%',
    bestFor: ['GYM', 'BAR', 'RESTAURANT', 'QSR', 'RETAIL'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: true,
      daypartTargeting: true,
      contentSafety: true,
      realtimeFill: true,
    },
    k12Forbidden: true,
  },
  {
    id: 'vistar-media',
    name: 'Vistar Media',
    category: 'dooh-programmatic',
    blurb: 'Largest US programmatic DOOH SSP. Premium venue network.',
    iconEmoji: '✨',
    auth: 'oauth2',
    pricingModel: 'cpm',
    typicalCpmCents: { low: 600, high: 2000 },
    takeRateBps: 1500,
    docsUrl: 'https://www.vistarmedia.com/publishers',
    websiteUrl: 'https://www.vistarmedia.com',
    pricingNote: '~$6-20 CPM, we take 15%',
    bestFor: ['GYM', 'BAR', 'RESTAURANT', 'QSR', 'RETAIL'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: true,
      daypartTargeting: true,
      contentSafety: true,
      realtimeFill: true,
    },
    k12Forbidden: true,
  },
  {
    id: 'place-exchange',
    name: 'Place Exchange',
    category: 'dooh-programmatic',
    blurb: 'IAB OpenRTB-compliant DOOH exchange. Strong RTB integration.',
    iconEmoji: '📍',
    auth: 'oauth2',
    pricingModel: 'cpm',
    typicalCpmCents: { low: 400, high: 1200 },
    takeRateBps: 1200,
    docsUrl: 'https://placeexchange.com/publishers/',
    websiteUrl: 'https://placeexchange.com',
    pricingNote: '~$4-12 CPM, we take 12%',
    bestFor: ['GYM', 'BAR', 'RESTAURANT', 'QSR', 'RETAIL'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: true,
      daypartTargeting: true,
      contentSafety: true,
      realtimeFill: true,
    },
    k12Forbidden: true,
  },
  {
    id: 'broadsign-reach',
    name: 'Broadsign Reach',
    category: 'dooh-programmatic',
    blurb: 'Broadsign\'s SSP — strong with cinema, transit, and retail networks.',
    iconEmoji: '📡',
    auth: 'apiKey',
    pricingModel: 'cpm',
    typicalCpmCents: { low: 500, high: 1500 },
    takeRateBps: 1500,
    docsUrl: 'https://broadsign.com/products/broadsign-reach/',
    websiteUrl: 'https://broadsign.com',
    pricingNote: '~$5-15 CPM, we take 15%',
    bestFor: ['RETAIL', 'CORPORATE', 'RESTAURANT'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: true,
      daypartTargeting: true,
      contentSafety: true,
    },
    k12Forbidden: true,
  },

  // ─── TIER 2 — VENUE NETWORKS (vertical-specific) ──────────────────
  {
    id: 'loop-media',
    name: 'Loop Media',
    category: 'venue-network',
    blurb: 'Music videos + branded content for bars, restaurants, gyms. Rev share.',
    iconEmoji: '🎵',
    auth: 'oauth2',
    pricingModel: 'revshare',
    takeRateBps: 1500,
    docsUrl: 'https://loop.tv/publishers',
    websiteUrl: 'https://loop.tv',
    pricingNote: 'Free content + revenue share',
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: true,
      daypartTargeting: true,
      contentSafety: true,
    },
    k12Forbidden: true,
  },
  {
    id: 'atmosphere-monetize',
    name: 'Atmosphere TV (monetize)',
    category: 'venue-network',
    blurb: "Atmosphere's revenue program — earn from ads alongside their content.",
    iconEmoji: '📺',
    auth: 'partnerKey',
    pricingModel: 'revshare',
    takeRateBps: 1000,
    docsUrl: 'https://atmosphere.tv/business/',
    websiteUrl: 'https://atmosphere.tv',
    pricingNote: 'Free + rev share',
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: true,
    },
    salesLedOnly: true,
    k12Forbidden: true,
  },

  // ─── TIER 3 — DIRECT SALES (sales-led, no API) ────────────────────
  {
    id: 'lamar-direct',
    name: 'Lamar Advertising',
    category: 'dooh-direct',
    blurb: "Lamar's national digital network. Direct sales — they sell, we host.",
    iconEmoji: '🛣',
    auth: 'partnerKey',
    pricingModel: 'cpd',
    docsUrl: 'https://www.lamar.com/InventoryBrowser/',
    websiteUrl: 'https://www.lamar.com',
    salesLedOnly: true,
    bestFor: ['RETAIL', 'CORPORATE'],
    capabilities: {
      creativeFetch: true,
      impressionReporting: false,
    },
    k12Forbidden: true,
  },

  // ─── TIER 4 — HOUSE ONLY (operator's own ads, no network) ─────────
  {
    id: 'house-only',
    name: 'House ads only (no network)',
    category: 'house-only',
    blurb: 'Run only your own creatives, no third-party network. Full control.',
    iconEmoji: '🏠',
    auth: 'apiKey',
    pricingModel: 'revshare',
    pricingNote: 'Free — no rev share',
    bestFor: ['K12', 'CORPORATE', 'GYM', 'BAR', 'RESTAURANT', 'RETAIL', 'QSR', 'FASHION'],
    capabilities: {
      creativeFetch: false,
      impressionReporting: true,
      daypartTargeting: true,
      contentSafety: true,
    },
  },
];

export function getAdNetwork(id: string): AdNetworkDef | undefined {
  return AD_NETWORKS.find((n) => n.id === id);
}

export const AD_NETWORK_IDS = AD_NETWORKS.map((n) => n.id) as readonly string[];

/** Networks visible to a tenant in the picker. K12 only sees house-only. */
export function adNetworksForVertical(vertical: string): ReadonlyArray<AdNetworkDef> {
  return AD_NETWORKS.filter((n) => {
    if (n.k12Forbidden && vertical === 'K12') return false;
    if (n.bestFor && n.bestFor.length > 0 && !n.bestFor.includes(vertical as any)) return false;
    return true;
  });
}

// ─── DTOs for API endpoints ─────────────────────────────────────────────

export interface AdNetworkConnectionDto {
  id: string;
  networkId: string;
  networkName: string;
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  /** Total impressions delivered for this connection. */
  impressionsTotal: number;
  /** Cents earned (gross — before our take). */
  grossRevenueCents: number;
  /** Cents we kept. */
  feeCents: number;
  createdAt: string;
  /** Operator's content-safety preferences. */
  contentControls: {
    blockedCategories: string[];      // IAB categories to block (alcohol, pharma, etc.)
    dayparts: Array<{ daysOfWeek: number[]; start: string; end: string }>;
    pauseDuringEmergency: boolean;
  };
}

/** Earnings summary card for the dashboard. */
export interface AdEarningsSummary {
  todayImpressions: number;
  todayRevenueCents: number;
  monthImpressions: number;
  monthRevenueCents: number;
  yearImpressions: number;
  yearRevenueCents: number;
  topNetwork?: { id: string; name: string; revenueCents: number };
}
