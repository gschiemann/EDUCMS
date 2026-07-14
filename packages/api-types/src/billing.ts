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

// 2026-05-03 — Operator: simplify the catalog to launch with three
// SKUs only. No unlimited, no add-ons, no school references. Per-screen
// metering across the board. Add tiers back in later sprints once
// real demand from a specific buyer makes them worth supporting.
export type LicenseTierId =
  | 'FREE_TRIAL'   // 14-day free, 3 screens, no credit card needed
  | 'MONTHLY'      // $25 / screen / month, billed monthly
  | 'ANNUAL'       // $240 / screen / year = $20/mo effective (save 20% vs monthly)
  | 'COMP'         // Internal / partner — admin only
  | 'CUSTOM';      // Negotiated — admin only

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
  // Three public SKUs. Same features across all three tiers — only
  // the price and billing cadence change. Per-screen metering for
  // every tier so we never have to retroactively remap existing
  // customers when we add seats / locations.
  {
    id: 'FREE_TRIAL',
    name: 'Free trial',
    blurb: '14 days, up to 3 screens, no credit card needed.',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    seatLimit: 3,
    bestFor: [],
    features: [
      '3 screens',
      '14-day trial',
      'Full template library',
      'All integrations',
      'Email support',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'MONTHLY',
    name: 'Monthly',
    blurb: '$25 per screen, billed monthly. Cancel anytime.',
    monthlyPriceCents: 2500,
    annualPriceCents: null,
    seatLimit: null,
    bestFor: [],
    features: [
      'Per-screen billing',
      'Full template library',
      'All integrations (streaming, POS, ads)',
      'Emergency alerts',
      'Email + chat support',
      'Cancel any time',
    ],
    selfServe: true,
    isAddon: false,
  },
  {
    id: 'ANNUAL',
    name: 'Annual',
    blurb: '$240 per screen / year — $20/mo effective. Save 20% vs monthly.',
    monthlyPriceCents: null,
    annualPriceCents: 24000,
    seatLimit: null,
    bestFor: [],
    features: [
      'Per-screen billing',
      'Save 20% vs monthly ($20/mo effective)',
      'Full template library',
      'All integrations (streaming, POS, ads)',
      'Emergency alerts',
      'Priority support',
    ],
    selfServe: true,
    isAddon: false,
  },
  // Internal-only — never shown in the public picker.
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
    blurb: 'Negotiated. Pricing + limits captured in License.notes.',
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

/** Tiers a tenant should see in the upgrade picker. Every public
 *  tier is universal — vertical doesn't filter the tier list anymore. */
export function recommendedTiersForVertical(_vertical: string): ReadonlyArray<LicenseTier> {
  return LICENSE_TIERS.filter((t) => t.id !== 'COMP' && t.id !== 'CUSTOM');
}
