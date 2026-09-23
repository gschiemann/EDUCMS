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
 * What we sync (2026-09-23 — corrected; see POS_LIVE_FACTS in concierge-pos.ts
 * for the per-provider truth the product copy must follow):
 *   • Menu items: name, description, price, category, image — sizes flattened
 *     where the provider exposes them; modifiers are NOT synced
 *   • Categories: structure for menu-board layout
 *   • Sold-out (86'd) items: only where the provider reports them (Square, the
 *     custom webhook) or an operator 86s an item in the Menu console
 *   • Pricing tiers: location-specific menus / promotions
 *
 * LICENSING NOTE — every provider in this catalog has a public dev
 * portal. Operators use their own credentials; we don't proxy auth.
 */

/** Authentication strategy required to connect a POS provider. */
export type PosAuthKind =
  | 'oauth2'        // Square and other browser-redirect OAuth providers
  | 'apiKey'        // Clover (API token), Lightspeed Retail
  | 'partnerKey'    // Some POS require a partner API key + per-merchant token
  | 'machineClient' // Toast client ID/secret exchanged server-side for a bearer token
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
    // 2026-09-23 — said "items, modifiers, prices": modifiers are never synced.
    blurb: 'Square Catalog API — items, sizes, prices and sold-out auto-sync.',
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
    scope: 'restaurant-qsr',
    integrationTier: 'PARTNER',
    blurb: 'Sync published menu items, prices, and photos from Toast.',
    iconEmoji: '🍞',
    auth: 'machineClient',
    docsUrl: 'https://doc.toasttab.com/doc/devguide/authentication.html',
    websiteUrl: 'https://pos.toasttab.com',
    pricingNote: 'Toast API access required',
    bestFor: ['QSR'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: false, locationsSync: true, realtimeUpdates: false },
    tierReason: 'Connect with Toast API credentials. Stores are discovered when the account permits it; otherwise enter a restaurant GUID. Published menus are checked every five minutes and can be synced on demand.',
  },
  {
    id: 'clover',
    name: 'Clover',
    // 2026-06-02: PROMOTED PARTNER → DIRECT. The OAuth + catalog-sync
    // connector now ships in providers/clover.ts (OAuth v2 authorize →
    // token → refresh; /v3/merchants/{mId}/items + /categories) and
    // triggerSync routes to it via the connector registry. `auth` flips
    // apiKey → oauth2 to match the real Connect flow (the Connect button
    // launches Clover's OAuth, not an API-key paste). Self-serve once
    // CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET are set (free sandbox at
    // sandbox.dev.clover.com). realtimeUpdates stays false — webhook push
    // isn't wired yet; the hourly cron + manual Sync keep the catalog fresh.
    scope: 'restaurant-qsr',
    integrationTier: 'DIRECT',
    blurb: 'Clover Inventory + Menu API — small-business POS, broad reach.',
    iconEmoji: '🍀',
    auth: 'oauth2',
    docsUrl: 'https://docs.clover.com/docs/inventory-overview',
    websiteUrl: 'https://www.clover.com',
    pricingNote: 'Self-serve — free sandbox',
    // FASHION added 2026-06-27 (beta finding #14): Clover is a major
    // apparel/boutique POS (Clover for Retail powers clothing shops), so it
    // belongs in the FASHION picker alongside Lightspeed + Shopify.
    bestFor: ['QSR', 'RETAIL', 'BAR', 'FASHION'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: false },
    tierReason: 'Clover ships a real, free catalog API (docs.clover.com). Self-serve OAuth — connect with a free Clover sandbox, then go live with production credentials. Catalog syncs hourly + on demand.',
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
    // 2026-06-02: PROMOTED PARTNER → DIRECT. providers/lightspeed.ts now
    // ships the X-Series OAuth (authorize on the fixed host, token/refresh
    // per-retailer {domainPrefix}.retail.lightspeed.app) + catalog sync
    // (/api/2.0/products + /product_categories, version-cursor paged), wired
    // through the connector registry. Self-serve once LIGHTSPEED_CLIENT_ID /
    // LIGHTSPEED_CLIENT_SECRET are set (free sandbox at retail.lightspeed.app).
    scope: 'retail',
    integrationTier: 'DIRECT',
    blurb: 'Lightspeed X-Series Items API — multi-location retail.',
    iconEmoji: '⚡',
    auth: 'oauth2',
    docsUrl: 'https://x-series-api.lightspeedhq.com/',
    websiteUrl: 'https://www.lightspeedhq.com/pos/retail/',
    pricingNote: 'Self-serve — free sandbox',
    bestFor: ['RETAIL', 'FASHION'],
    capabilities: { menuSync: true, categorySync: true, locationsSync: true },
    tierReason: 'Lightspeed\'s X-Series (Retail) API is real (free sandbox + OAuth). Self-serve — connect a sandbox retailer, go live with production credentials. Catalog syncs hourly + on demand.',
  },
  {
    id: 'shopify-pos',
    name: 'Shopify POS',
    // 2026-06-02: PROMOTED PARTNER → DIRECT. providers/shopify.ts now ships
    // the Admin OAuth (/admin/oauth/authorize → /admin/oauth/access_token,
    // offline token) + catalog sync (/admin/api/<ver>/products.json,
    // Link-header cursor paged, $ → cents), wired through the connector
    // registry. The shop domain is collected at connect time (?shop=).
    // Self-serve once SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET are set (free
    // Partner account + dev store). realtimeUpdates is FALSE (2026-09-23): it
    // used to stay true "because Shopify webhooks exist", which put the
    // "⚡ realtime" badge on Settings → POS over what is really the hourly
    // sync — webhook receive isn't wired. Flip it back only when it is. REST
    // Admin API is Shopify-"legacy" as of 2024-10 — GraphQL migration tracked
    // separately.
    scope: 'retail',
    integrationTier: 'DIRECT',
    blurb: 'Shopify Admin API — products, variants, inventory, locations.',
    iconEmoji: '🛍',
    auth: 'oauth2',
    docsUrl: 'https://shopify.dev/docs/api/admin-rest',
    websiteUrl: 'https://www.shopify.com/pos',
    pricingNote: 'Self-serve — free dev store',
    bestFor: ['RETAIL', 'FASHION'],
    capabilities: { menuSync: true, categorySync: true, availabilitySync: true, locationsSync: true, realtimeUpdates: false },
    tierReason: 'Shopify\'s Admin API is real (free Partner account + dev store). Self-serve OAuth — enter your shop domain, connect, go live with production credentials. Catalog syncs hourly + on demand.',
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
