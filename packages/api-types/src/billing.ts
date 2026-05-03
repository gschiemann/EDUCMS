/**
 * Billing — license tier catalog.
 *
 * Sprint 8c (2026-05-03). Single source of truth for what plans we
 * sell, at what price, with what limits. Both the Super-Admin
 * dashboard and the tenant-facing /settings/billing page read from
 * this catalog so a price change ships in one place.
 *
 * Stripe wire-up: each tier carries the Stripe Price IDs (test +
 * live). Real Stripe Checkout / Customer Portal sessions are created
 * server-side via `stripe.checkout.sessions.create`. The API needs
 * STRIPE_SECRET_KEY (env) before /billing/checkout endpoints can fire.
 *
 * "Per-screen" billing: License.seatLimit is the soft cap. When a
 * screen registers, ScreenService checks the limit and returns
 * LICENSE_EXHAUSTED if over. Operators can self-upgrade via the
 * Customer Portal once Stripe is wired.
 */

export type LicenseTierId =
  | 'PILOT'                    // 90-day free, 5 screens
  | 'CMS_CORE'                 // entry tier
  | 'SCHOOL_UNLIMITED'         // K12 full
  | 'GYM_PRO'                  // GYM full
  | 'RESTAURANT_CHAIN'         // QSR/Restaurant chains
  | 'RETAIL_CHAIN'             // Retail chains
  | 'COMMAND'                  // Add-on: incident workflows + accountability
  | 'DISTRICT_OPS'             // Multi-school district / multi-location
  | 'RESPONDER_BRIDGE'         // Add-on: 911/ECC integration
  | 'COMP'                     // Internal / partner / staff comps
  | 'CUSTOM';                  // Negotiated; see License.notes

export interface LicenseTier {
  id: LicenseTierId;
  name: string;
  blurb: string;
  /** Monthly price in USD cents. null = quote / contract / comp. */
  monthlyPriceCents: number | null;
  /** Annual price (typically 10× monthly = 2 months free). */
  annualPriceCents: number | null;
  /** Soft seat limit (screens). Null = unlimited. */
  seatLimit: number | null;
  /** Verticals this tier is most relevant to. Empty = universal. */
  bestFor: ReadonlyArray<'K12' | 'GYM' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'BAR'>;
  /** Highlighted features for the upgrade card. */
  features: ReadonlyArray<string>;
  /** Stripe Price IDs — fill these in once Stripe is configured. */
  stripeMonthlyPriceId?: string;
  stripeAnnualPriceId?: string;
  /** Whether this tier is publicly purchasable (vs sales-led). */
  selfServe: boolean;
  /** Whether this tier is an ADD-ON to a base tier (e.g. COMMAND).
   *  Add-ons multiply with the base tier; the License row in the DB
   *  captures the BASE tier and the JSON addons[] array. */
  isAddon: boolean;
}

export const LICENSE_TIERS: ReadonlyArray<LicenseTier> = [
  {
    id: 'PILOT',
    name: 'Pilot',
    blurb: 'Free 90-day trial — up to 5 screens, full features.',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    seatLimit: 5,
    bestFor: [],
    features: [
      'Up to 5 screens',
      '90-day trial',
      'Full template library',
      'Emergency alerts',
      'Email + chat support',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'CMS_CORE',
    name: 'CMS Core',
    blurb: 'Entry-tier signage. Per-screen billing, self-serve.',
    monthlyPriceCents: 700,            // $7 / screen / month
    annualPriceCents: 7000,
    seatLimit: null,                    // metered per screen
    bestFor: ['CORPORATE', 'RETAIL', 'QSR', 'BAR'],
    features: [
      'Unlimited templates',
      'Drag-and-drop builder',
      'Standard alerts',
      'Email support',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'SCHOOL_UNLIMITED',
    name: 'School Unlimited',
    blurb: 'K-12 full — unlimited screens per school.',
    monthlyPriceCents: 16600,          // $1,999 / year ÷ 12
    annualPriceCents: 199900,
    seatLimit: null,
    bestFor: ['K12'],
    features: [
      'Unlimited screens per school',
      'District + school tenancy',
      'Emergency alert routing',
      'CAP / custom provider ingest',
      'All-clear handling',
      'Premium support',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'GYM_PRO',
    name: 'Gym Pro',
    blurb: 'Fitness venue full plan — unlimited screens, streaming included.',
    monthlyPriceCents: 14900,          // $149 / location / month
    annualPriceCents: 149000,
    seatLimit: null,
    bestFor: ['GYM'],
    features: [
      'Unlimited screens per gym',
      'Class schedule + live TV widgets',
      'Streaming integrations (Atmosphere, public broadcasters)',
      'Member-app launcher',
      'Premium support',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'RESTAURANT_CHAIN',
    name: 'Restaurant / QSR',
    blurb: 'Menu boards + drive-thru + loyalty for QSR + casual dining.',
    monthlyPriceCents: 9900,           // $99 / location / month
    annualPriceCents: 99000,
    seatLimit: null,
    bestFor: ['QSR'],
    features: [
      'Unlimited screens per location',
      'Menu boards + combo carousel',
      'Wait-time + queue widgets',
      'Loyalty + promo rotations',
      'Multi-location publish',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'RETAIL_CHAIN',
    name: 'Retail Chain',
    blurb: 'Lookbook + pricing + storefront promo. Multi-store roll-out ready.',
    monthlyPriceCents: 12900,          // $129 / location / month
    annualPriceCents: 129000,
    seatLimit: null,
    bestFor: ['RETAIL', 'FASHION'],
    features: [
      'Unlimited screens per store',
      'Editorial lookbook templates',
      'Sale + price-point widgets',
      'Wayfinding map',
      'Multi-store publishing',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'COMMAND',
    name: 'Command (Add-on)',
    blurb: 'Incident workflows, accountability, drill reporting, reunification-lite.',
    monthlyPriceCents: 8300,           // $1,000-$2,000/yr add-on
    annualPriceCents: 100000,
    seatLimit: null,
    bestFor: ['K12'],
    features: [
      'Incident state machine',
      'Roll-call + reunification',
      'Drill reporting',
      'Responder packet (Raptor / RapidSOS handoff)',
    ],
    selfServe: false,
    isAddon: true,
  },
  {
    id: 'DISTRICT_OPS',
    name: 'District Ops',
    blurb: 'Cross-school command center, mutual-aid, governance. Annual contract.',
    monthlyPriceCents: null,            // sales-led
    annualPriceCents: null,
    seatLimit: null,
    bestFor: ['K12', 'CORPORATE'],
    features: [
      'Cross-school dashboard',
      'Inherited policies',
      'SSO + audit exports',
      'Premium support',
      'Annual contract',
    ],
    selfServe: false,
    isAddon: false,
  },
  {
    id: 'RESPONDER_BRIDGE',
    name: 'Responder Bridge',
    blurb: '911/ECC integration via Raptor / RapidSOS. Sales-led.',
    monthlyPriceCents: null,
    annualPriceCents: null,
    seatLimit: null,
    bestFor: ['K12'],
    features: [
      'Raptor / RapidSOS connector',
      'Structured responder data',
      'Drill testing support',
      'Sales-led onboarding',
    ],
    selfServe: false,
    isAddon: true,
  },
  {
    id: 'COMP',
    name: 'Comp / Partner',
    blurb: 'Manually granted by a SUPER_ADMIN. Free.',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    seatLimit: null,
    bestFor: [],
    features: ['Custom — see notes'],
    selfServe: false,
    isAddon: false,
  },
  {
    id: 'CUSTOM',
    name: 'Custom',
    blurb: 'Negotiated tier. Pricing + limits captured in License.notes.',
    monthlyPriceCents: null,
    annualPriceCents: null,
    seatLimit: null,
    bestFor: [],
    features: ['Negotiated'],
    selfServe: false,
    isAddon: false,
  },
];

export function getLicenseTier(id: string): LicenseTier | undefined {
  return LICENSE_TIERS.find((t) => t.id === id);
}

/** Tiers a tenant of this vertical should see in the upgrade picker. */
export function recommendedTiersForVertical(vertical: string): ReadonlyArray<LicenseTier> {
  return LICENSE_TIERS.filter((t) => {
    if (t.id === 'COMP' || t.id === 'CUSTOM') return false;       // hidden from public
    if (t.bestFor.length === 0) return true;                       // universal
    return t.bestFor.includes(vertical as any);
  });
}
