/**
 * POS connector registry (2026-06-02).
 * ─────────────────────────────────────────────────────────
 *
 * The single place that maps a `providerId` → its connector functions, so
 * pos.service + the OAuth controller stop hard-coding `square`. Each entry
 * adapts a provider module (providers/<name>.ts) to ONE uniform interface:
 *
 *   authorizeUrl → exchangeCode → refreshAccessToken → fetchCatalog
 *
 * The per-provider "store id" (Square/Clover: merchantId, Lightspeed:
 * domainPrefix, Shopify: shop domain) is normalized to a single `storeId`
 * the service persists in the connection creds and threads back into
 * fetchCatalog. The adapter knows WHERE that id comes from:
 *   - Square    : the token response (callbackStoreIdParam = null)
 *   - Clover    : the OAuth callback query `merchant_id`
 *   - Lightspeed: the OAuth callback query `domain_prefix` (also on token)
 *   - Shopify   : supplied at AUTHORIZE time (the shop domain) + echoed back
 *
 * Adding a provider = drop a providers/<name>.ts module + one entry here +
 * flip its tier to DIRECT in @cms/api-types. No service/controller edits.
 */
import type { CatalogSnapshot, NormalizedLocation } from './square';
import * as square from './square';
import * as clover from './clover';
import * as shopify from './shopify';
import * as lightspeed from './lightspeed';

/** Provider-agnostic OAuth token. `storeId` = the provider's per-merchant
 *  identifier (merchantId / domainPrefix / shop). */
export interface ProviderToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  storeId: string;
  scope: string[];
}

export interface PosConnector {
  authorizeUrl(opts: { state: string; redirectUri: string; storeId?: string; scopes?: string[] }): string;
  exchangeCode(opts: { code: string; redirectUri: string; storeId?: string }): Promise<ProviderToken>;
  refreshAccessToken(refreshToken: string, storeId?: string): Promise<ProviderToken>;
  fetchCatalog(accessToken: string, ctx: { storeId?: string }): Promise<CatalogSnapshot>;
  /** List the provider's locations/stores/outlets (multi-location chains).
   *  Optional — only providers with a location hierarchy implement it
   *  (Square today; Shopify/Lightspeed later). Undefined → single-location. */
  fetchLocations?(accessToken: string, ctx?: { storeId?: string }): Promise<NormalizedLocation[]>;
  /** Env-var prefix the provider module reads ({PREFIX}_CLIENT_ID / _SECRET).
   *  Distinct from the provider id (id `lightspeed-retail` → prefix
   *  `LIGHTSPEED`, id `shopify-pos` → prefix `SHOPIFY`). */
  envPrefix: string;
  /** Callback query param carrying the storeId, or null if it's on the token. */
  callbackStoreIdParam: string | null;
  /** True when the storeId must be known at AUTHORIZE time (Shopify shop). */
  needsStoreIdAtAuthorize: boolean;
  /** False when tokens never expire (Shopify offline tokens). */
  refreshable: boolean;
}

// Keyed by the POS provider `id` in @cms/api-types (NOT the module name) —
// a connection row stores that id, so getConnector(conn.providerId) must
// resolve by it: square, clover, lightspeed-retail, shopify-pos.
export const POS_CONNECTORS: Record<string, PosConnector> = {
  square: {
    authorizeUrl: (o) => square.squareAuthorizeUrl(o),
    exchangeCode: async (o) => { const t = await square.squareExchangeCode(o); return { ...t, storeId: t.merchantId }; },
    refreshAccessToken: async (rt) => { const t = await square.squareRefreshAccessToken(rt); return { ...t, storeId: t.merchantId }; },
    fetchCatalog: (at) => square.squareFetchCatalog(at),
    fetchLocations: (at) => square.squareFetchLocations(at),
    envPrefix: 'SQUARE',
    callbackStoreIdParam: null,
    needsStoreIdAtAuthorize: false,
    refreshable: true,
  },
  clover: {
    authorizeUrl: (o) => clover.cloverAuthorizeUrl(o),
    exchangeCode: async (o) => { const t = await clover.cloverExchangeCode({ code: o.code, redirectUri: o.redirectUri, merchantId: o.storeId }); return { ...t, storeId: t.merchantId }; },
    refreshAccessToken: async (rt, sid) => { const t = await clover.cloverRefreshAccessToken(rt, sid); return { ...t, storeId: t.merchantId }; },
    fetchCatalog: (at, ctx) => clover.cloverFetchCatalog(at, { merchantId: ctx.storeId }),
    envPrefix: 'CLOVER',
    callbackStoreIdParam: 'merchant_id',
    needsStoreIdAtAuthorize: false,
    refreshable: true,
  },
  'lightspeed-retail': {
    authorizeUrl: (o) => lightspeed.lightspeedAuthorizeUrl(o),
    exchangeCode: async (o) => { const t = await lightspeed.lightspeedExchangeCode({ code: o.code, redirectUri: o.redirectUri, domainPrefix: o.storeId }); return { ...t, storeId: t.domainPrefix }; },
    refreshAccessToken: async (rt, sid) => { const t = await lightspeed.lightspeedRefreshAccessToken(rt, sid); return { ...t, storeId: t.domainPrefix }; },
    fetchCatalog: (at, ctx) => lightspeed.lightspeedFetchCatalog(at, { domainPrefix: ctx.storeId }),
    envPrefix: 'LIGHTSPEED',
    callbackStoreIdParam: 'domain_prefix',
    needsStoreIdAtAuthorize: false,
    refreshable: true,
  },
  'shopify-pos': {
    authorizeUrl: (o) => shopify.shopifyAuthorizeUrl({ state: o.state, redirectUri: o.redirectUri, shop: o.storeId || '', scopes: o.scopes }),
    exchangeCode: async (o) => { const t = await shopify.shopifyExchangeCode({ code: o.code, shop: o.storeId || '' }); return { ...t, storeId: t.shop }; },
    refreshAccessToken: async (rt, sid) => { const t = await shopify.shopifyRefreshAccessToken(rt, sid); return { ...t, storeId: (t as { shop: string }).shop }; },
    fetchCatalog: (at, ctx) => shopify.shopifyFetchCatalog(at, { shop: ctx.storeId }),
    envPrefix: 'SHOPIFY',
    callbackStoreIdParam: 'shop',
    needsStoreIdAtAuthorize: true,
    refreshable: false,
  },
};

/** Resolve a connector, or null for providers without a live handler
 *  (e.g. custom-webhook, or a PARTNER-tier provider not yet built). */
export function getConnector(providerId: string): PosConnector | null {
  return POS_CONNECTORS[providerId] ?? null;
}
