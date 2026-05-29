/**
 * POS integrations — provider catalog and shared types.
 * ─────────────────────────────────────────────────────
 *
 * Sprint 8d (2026-05-03) — multi-tenant POS sync framework. Franchise
 * operators (QSR / restaurant / retail) connect their POS, our menu
 * boards + price callouts auto-sync from the live catalog. No more
 * "we changed the burger price three weeks ago and the screens still
 * say $7.99."
 *
 * SAME ARCHITECTURE AS STREAMING (`streaming.ts`):
 *   • `POS_PROVIDERS` is the canonical catalog. Both API + web read it.
 *   • Each provider declares auth strategy (oauth / apiKey / iframe).
 *   • Server-side handlers in `apps/api/src/pos/providers/<id>.ts`
 *     map the provider's catalog format → our normalized MenuItem.
 *   • Per-tenant credentials live in PosProviderConnection (encrypted
 *     with the same envelope-encryption helper used for streaming).
 *
 * DELIBERATELY OUT OF SCOPE for this commit:
 *   • Live order-taking — we sync the CATALOG (menu / prices / hours),
 *     not orders. Operators run their actual POS for orders.
 *   • Inventory sync — same reason; that's the POS's job.
 *
 * What we sync:
 *   • Menu items: name, description, price, modifiers, category, image
 *   • Categories: structure for menu-board layout
 *   • Daily availability: 86'd items hidden automatically
 *   • Pricing tiers: location-specific menus / promotions
 *
 * LICENSING NOTE — every provider in this catalog has a public dev
 * portal. Operators use their own credentials; we don't proxy auth.
 */

/** Authentication strategy required to connect a POS provider. */
export type PosAuthKind =
  | 'oauth2'        // Square, Toast, Stripe Terminal — standard OAuth + refresh
  | 'apiKey'        // Clover (API token), Lightspeed Retail
  | 'partnerKey'    // Some POS require a partner API key + per-merchant token
  | 'webhook';      // Operator-side push (rare; e.g. custom POS pushes to our webhook)

/** Product / service category — drives which catalog endpoints we
 *  hit and which widgets benefit. */
export type PosVerticalScope =
  | 'restaurant-qsr'   // Square, Toast, Clover Restaurant — burgers, coffee, etc.
  | 'restaurant-table' // Toast, Aloha — full-service dining
  | 'retail'           // Clover, Lightspeed Retail, Square for Retail
  | 'bar'              // Square, Toast Bar — drink menus, happy-hour
  | 'universal';       // Stripe Terminal — works anywhere

/** Same DIRECT/PARTNER/CLOSED model as streaming providers. Drives UI. */
export type PosIntegrationTier = 'DIRECT' | 'PARTNER' | 'CLOSED';

export interface PosProviderDef {
  /** Stable kebab-case id stored in DB / URLs. */
  id: string;
  name: string;
  scope: PosVerticalScope;
  /** Real-world integration tier. */
  integrationTier: PosIntegrationTier;
  /** ≤ 80 char marketing line shown in the connection wizard tile. */
  blurb: string;
  iconEmoji?: string;
  iconUrl?: string;
  auth: PosAuthKind;
  /** Developer / operator docs URL — shown in the wizard for setup help. */
  docsUrl?: string;
  websiteUrl?: string;
  /** Pricing note ("Free OAuth — pay per transaction" / "$0/mo"). */
  pricingNote?: string;
  /** Best-fit verticals (drives provider visibility in the picker). */
  bestFor?: ReadonlyArray<'GYM' | 'BAR' | 'RESTAURANT' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'K12'>;
  /** Sync features actually wired up. */
  capabilities: {
    menuSync?: boolean;
    categorySync?: boolean;
    availabilitySync?: boolean;
    locationsSync?: boolean;
    realtimeUpdates?: boolean;
  };
  /** Sales-led only? Hides self-serve "Connect" button. */
  salesLedOnly?: boolean;
  /** Plain-English tier explanation. */
  tierReason?: string;
}

/**
 * The POS provider catalog. Order = priority order in the UI picker.
 *
 * Mark NEW providers with the `// NEW 2026-05-DD` tag so release
 * notes can grep them.
 */
export const POS_PROVIDERS: ReadonlyArray<PosProviderDef> = [
  // ─── TIER 1 — RESTAURANT / QSR (mostly self-serve) ─────────────────
  {
    id: 'square',
    name: 'Square',
    scope: 'restaurant-qsr',
    integrationTier: 'DIRECT',
    blurb: 'Square Catalog API — items, modifiers, prices auto-sync.',
    iconEmoji: '◾',
    auth: 'oauth2',
    docsUrl: 'https://developer.squareup.com/docs/catalog-api/what-it-does',
    websiteUrl: 'https://squareup.com',
    pricingNote: 'Free sandbox + production OAuth',
    bestFor: ['QSR', 'BAR', 'RETAIL', 'GYM'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: true },
    tierReason: 'Square has a fully public Catalog API + free sandbox at developer.squareup.com. Real-time webhook updates included. Self-serve OAuth.',
  },
  {
    id: 'toast',
    name: 'Toast',
    scope: 'restaurant-table',
    integrationTier: 'PARTNER',
    blurb: 'Toast Menus API — restaurant-grade. Partner program required.',
    iconEmoji: '🍞',
    auth: 'oauth2',
    docsUrl: 'https://doc.toasttab.com/',
    websiteUrl: 'https://pos.toasttab.com',
    pricingNote: 'Toast Partner Program (paid)',
    bestFor: ['QSR'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: true },
    tierReason: 'Real public Menus API at doc.toasttab.com — but requires Toast Partner Program enrollment + commercial vetting before activation.',
  },
  {
    id: 'clover',
    name: 'Clover',
    // 2026-05-28 audit P1-6: was DIRECT (`apiKey`) but had NO sync
    // handler — `triggerSync` returned "not yet implemented" forever, so
    // an operator could connect, see a PENDING row, hit "Sync now," and
    // dead-end indefinitely. Clover's catalog API is real and free, but
    // the connector is not built yet. Downgraded to PARTNER so the tile
    // shows an honest "on the roadmap / contact us" state instead of a
    // ready-looking self-serve connector. Re-promote to DIRECT (with
    // `auth: 'apiKey'`) the moment a `providers/clover.ts` handler ships
    // and `triggerSync` routes to it.
    scope: 'restaurant-qsr',
    integrationTier: 'PARTNER',
    blurb: 'Clover Inventory + Menu API — small-business POS, broad reach.',
    iconEmoji: '🍀',
    auth: 'apiKey',
    docsUrl: 'https://docs.clover.com/docs/inventory-overview',
    websiteUrl: 'https://www.clover.com',
    pricingNote: 'Connector in development',
    bestFor: ['QSR', 'RETAIL', 'BAR'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: false },
    tierReason: 'Clover ships a real, free catalog API (docs.clover.com) — but our connector is still in development. Tell us you need it and we\'ll prioritize it; until then the live sync handler is not wired.',
  },
  {
    id: 'aloha-ncr',
    name: 'Aloha (NCR)',
    scope: 'restaurant-table',
    integrationTier: 'CLOSED',
    blurb: 'Aloha menus require CSV export → manual upload (no public CMS API).',
    iconEmoji: '🌺',
    auth: 'partnerKey',
    docsUrl: 'https://www.ncr.com/restaurants',
    salesLedOnly: true,
    bestFor: ['QSR'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true },
    // 2026-05-03 — equivalent of the streaming BRIDGE tier doesn't exist
    // for Aloha (you can't HDMI-capture a price catalog). The closest
    // workaround is the operator runs Aloha's built-in Item Library
    // export (CSV) and uploads it through our standard Asset uploader,
    // which our menu-board widget can pull from. Documented but not a
    // first-class connector.
    tierReason: 'Aloha integrations go through NCR Connected Payments / partner channel deals. No public API for third-party signage CMS — operators today export items as CSV from Aloha\'s back office and import via Settings → Menu Catalog. A direct API integration would require a custom SI engagement with NCR.',
  },

  // ─── TIER 2 — RETAIL (self-serve) ──────────────────────────────────
  {
    id: 'lightspeed-retail',
    name: 'Lightspeed Retail',
    // 2026-05-28 audit P1-6: was DIRECT but no OAuth + no sync handler.
    // The oauth2 path already rejects connect attempts ("OAuth flow not
    // yet implemented"), so this was a green "Self-serve" badge on a
    // connector that can't connect. Downgraded to PARTNER for honesty.
    scope: 'retail',
    integrationTier: 'PARTNER',
    blurb: 'Lightspeed R-Series Items API — multi-location retail.',
    iconEmoji: '⚡',
    auth: 'oauth2',
    docsUrl: 'https://developers.lightspeedhq.com/retail/',
    websiteUrl: 'https://www.lightspeedhq.com/pos/retail/',
    pricingNote: 'Connector in development',
    bestFor: ['RETAIL', 'FASHION'],
    capabilities: { menuSync: true, categorySync: true, locationsSync: true },
    tierReason: 'Lightspeed\'s R-Series Items API is real (free sandbox + OAuth) — but our OAuth flow and sync handler are still in development. Re-promotes to DIRECT once the connector ships.',
  },
  {
    id: 'shopify-pos',
    name: 'Shopify POS',
    // 2026-05-28 audit P1-6: was DIRECT but no OAuth + no sync handler.
    // Same costume as Lightspeed — downgraded to PARTNER.
    scope: 'retail',
    integrationTier: 'PARTNER',
    blurb: 'Shopify Admin API — products, variants, inventory, locations.',
    iconEmoji: '🛍',
    auth: 'oauth2',
    docsUrl: 'https://shopify.dev/docs/api/admin-rest/2024-04/resources/product',
    websiteUrl: 'https://www.shopify.com/pos',
    pricingNote: 'Connector in development',
    bestFor: ['RETAIL', 'FASHION'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: true },
    tierReason: 'Shopify\'s Admin API is real (free Partner account + dev store) — but our OAuth flow and sync handler are still in development. Re-promotes to DIRECT once the connector ships.',
  },

  // ─── TIER 3 — UNIVERSAL ────────────────────────────────────────────
  {
    id: 'stripe-terminal',
    name: 'Stripe (Catalog)',
    // 2026-05-28 audit P1-6: was DIRECT (`apiKey`) but had NO sync
    // handler — same dead-end-on-connect costume as Clover. Downgraded
    // to PARTNER. (Distinct from billing: this is the Products/Prices
    // catalog as a menu source, not the Stripe billing integration.)
    scope: 'universal',
    integrationTier: 'PARTNER',
    blurb: 'Stripe Products + Prices — works anywhere Stripe runs.',
    iconEmoji: '💳',
    auth: 'apiKey',
    docsUrl: 'https://docs.stripe.com/api/products',
    websiteUrl: 'https://stripe.com',
    pricingNote: 'Connector in development',
    bestFor: ['QSR', 'RETAIL', 'GYM', 'BAR'],
    capabilities: { menuSync: true, categorySync: true },
    tierReason: 'Stripe\'s Products/Prices API is a great catalog source (free test mode) — but our connector is still in development. Re-promotes to DIRECT once the sync handler ships.',
  },

  // ─── TIER 4 — GYM-SPECIFIC (partner) ───────────────────────────────
  {
    id: 'mindbody',
    name: 'MINDBODY',
    scope: 'universal',
    integrationTier: 'PARTNER',
    blurb: 'MINDBODY (ABC Fitness) — class schedules + retail. Partner program.',
    iconEmoji: '🧘',
    auth: 'oauth2',
    docsUrl: 'https://developers.mindbodyonline.com/',
    websiteUrl: 'https://www.mindbodyonline.com',
    pricingNote: 'Partner program (application required)',
    bestFor: ['GYM'],
    capabilities: { menuSync: true, categorySync: true, locationsSync: true },
    tierReason: 'Public Public API at developers.mindbodyonline.com — but partner registration + ABC Fitness review required before activating.',
  },

  // ─── TIER 5 — CUSTOM (always works) ────────────────────────────────
  {
    id: 'custom-webhook',
    name: 'Custom Webhook',
    scope: 'universal',
    integrationTier: 'DIRECT',
    blurb: 'Push your own catalog from any internal system. JSON spec we publish.',
    iconEmoji: '🔗',
    auth: 'webhook',
    // No docsUrl: there is no /docs route — the JSON spec is shown inline in
    // the connect modal (settings/pos). A dead "/docs/pos/custom-webhook-spec"
    // link was removed (2026-05-28 honesty sweep).
    pricingNote: 'Free',
    bestFor: ['QSR', 'RETAIL', 'GYM', 'BAR', 'CORPORATE'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: true },
    tierReason: 'Operator pushes their catalog to our webhook endpoint. Bring-your-own — works with any internal system that can fire HTTP.',
  },
];

export function getPosProvider(id: string): PosProviderDef | undefined {
  return POS_PROVIDERS.find((p) => p.id === id);
}

export const POS_PROVIDER_IDS = POS_PROVIDERS.map((p) => p.id) as readonly string[];

// ─── Normalized catalog DTOs (provider → our format) ────────────────────

/** Single menu item / SKU normalized across providers. */
export interface PosMenuItem {
  id: string;                      // our internal id (UUID)
  externalId: string;              // provider's id
  name: string;
  description?: string;
  /** Major-unit price (USD). For locale-aware display, format with Intl. */
  priceCents: number;
  /** Optional sale price for "was $X / now $Y" callouts. */
  salePriceCents?: number;
  category?: string;               // category name as shown by the provider
  imageUrl?: string;
  /** Dietary / modifier chips ("V" / "GF" / "DF" / "spicy" / etc.). */
  badges?: ReadonlyArray<string>;
  available: boolean;              // 86'd → false
  /** Provider-side last-updated timestamp; used for delta sync. */
  updatedAt: string;
}

export interface PosCategory {
  id: string;
  externalId: string;
  name: string;
  sortOrder: number;
}

export interface PosLocation {
  id: string;
  externalId: string;
  name: string;
  address?: string;
  /** Locations are filterable on the screen — operator picks "this
   *  screen shows the catalog from store #4". */
  active: boolean;
}

export interface PosConnectionDto {
  id: string;
  providerId: string;
  providerName: string;
  displayName?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  lastSyncedAt?: string;
  itemCount: number;
  locationCount: number;
  createdAt: string;
}
