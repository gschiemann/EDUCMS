/**
 * Shopify POS / e-commerce provider — full implementation (2026-06-02).
 * ─────────────────────────────────────────────────────────
 *
 * Mirrors providers/clover.ts + providers/square.ts so the connector registry
 * treats every POS the same way: OAuth (authorize → callback → token exchange
 * → refresh) + catalog poll → normalized CatalogSnapshot. The catalog upsert +
 * the encrypted-credential store + the connect wizard are all provider-agnostic
 * in pos.service — this module only supplies the Shopify-specific bytes. Drives
 * Menu Board / promo signage from a retailer's live Shopify product catalog.
 *
 * Verified against Shopify developer docs (2026-06-02):
 *   • OAuth (authorization code grant):
 *       authorize : https://{shop}.myshopify.com/admin/oauth/authorize
 *                     ?client_id=&scope=&redirect_uri=&state=   (scope is COMMA-separated)
 *       token     : POST https://{shop}.myshopify.com/admin/oauth/access_token
 *                     body { client_id, client_secret, code }   (code → access_token)
 *     shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 *   • Products (REST Admin, per-store):
 *       GET https://{shop}.myshopify.com/admin/api/{version}/products.json?limit=250
 *       variant `price` is a DECIMAL DOLLAR STRING (e.g. "199.00") → cents below.
 *     shopify.dev/docs/api/admin-rest/latest/resources/product
 *     shopify.dev/docs/api/admin-rest/latest/resources/product-variant
 *   • Cursor pagination via the Link response header (page_info token, used verbatim):
 *       Link: <https://{shop}.myshopify.com/admin/api/{v}/products.json?page_info=...&limit=...>; rel="next"
 *     shopify.dev/docs/api/usage/pagination-rest   (max limit 250/page)
 *
 * Shopify quirks vs Clover/Square (handled below):
 *   • The shop domain ({shop}.myshopify.com) is the required per-store
 *     identifier — Shopify's equivalent of Clover's merchantId. It is part of
 *     EVERY URL (OAuth + REST), so the controller threads it into authorizeUrl
 *     / exchangeCode() and we carry it on the token + read it back in
 *     fetchCatalog(ctx.shop).
 *   • OFFLINE ACCESS TOKENS DO NOT EXPIRE. The default offline token (we never
 *     pass `expiring=1`) is permanent and has NO refresh_token. So
 *     `shopifyRefreshAccessToken` is a documented NO-OP — the signature is kept
 *     only for registry uniformity with the expiring-token providers.
 *   • Money is a decimal dollar string, NOT integer cents (Clover) — convert
 *     via Math.round(parseFloat(price) * 100).
 *   • Pagination is an opaque page_info cursor delivered in the Link HEADER
 *     (not the JSON body, not Clover's limit/offset, not Square's body cursor).
 *
 * Env vars (declared in .env.example by the lead, never committed live):
 *   SHOPIFY_CLIENT_ID      — OAuth client id (Shopify "API key")
 *   SHOPIFY_CLIENT_SECRET  — OAuth client secret (Shopify "API secret key")
 */
import { Logger } from '@nestjs/common';
import type { CatalogSnapshot, NormalizedItem, NormalizedCategory } from './square';

const log = new Logger('ShopifyProvider');

/**
 * Current stable REST Admin API version (Shopify ships a new one each quarter;
 * each stable version is supported ≥12 months). Bump deliberately — pinning
 * keeps response shapes stable rather than tracking `latest`.
 */
export function shopifyApiVersion(): string {
  return '2026-01';
}

/**
 * Normalize a raw shop value to its canonical `{shop}.myshopify.com` host.
 * Accepts "acme", "acme.myshopify.com", or "https://acme.myshopify.com" and
 * always returns the bare host (no scheme, no trailing slash). This host is the
 * required per-store identifier baked into every OAuth + REST URL.
 */
export function shopifyHost(shop: string): string {
  let s = String(shop || '').trim().toLowerCase();
  // Strip scheme + any path/trailing slash.
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) return '';
  // Bare subdomain → append the canonical myshopify.com suffix.
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  return s;
}

/**
 * Origin for a shop's Admin API calls — normally `https://{host}`.
 * Dev-only sandbox-harness override (2026-08-04): SHOPIFY_API_BASE lets the
 * local mock POS server (scripts/pos-sandbox/) stand in for the per-store
 * host so the OAuth + catalog pipeline is testable with zero external
 * accounts. NEVER honored in production.
 */
export function shopifyOrigin(host: string): string {
  const override = process.env.SHOPIFY_API_BASE;
  if (override && process.env.NODE_ENV !== 'production') {
    return override.replace(/\/$/, '');
  }
  return `https://${host}`;
}

// ─── OAuth ──────────────────────────────────────────────────────────────

export interface ShopifyOAuthToken {
  accessToken: string;
  /**
   * Empty for the default offline token (offline tokens DON'T expire and carry
   * no refresh token). Field kept for registry parity with Square/Clover.
   */
  refreshToken: string;
  /**
   * Always null for offline tokens (they never expire). Field kept for parity.
   */
  expiresAt: string | null;
  /** Carried through from the connect flow — the per-store shop host. */
  shop: string;
  scope: string[];
}

/**
 * Build the authorize URL the operator's browser hits. Shopify's authorize
 * page lives on the per-store host, so `shop` is required. Scope is a
 * COMMA-separated list (unlike Square's `+`-separated). Defaults to the minimal
 * read scope this connector needs.
 */
export function shopifyAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
  shop: string;
  scopes?: string[];
}): string {
  const host = shopifyHost(opts.shop);
  if (!host) {
    throw new Error('Shopify authorize needs a shop domain (e.g. acme.myshopify.com)');
  }
  const clientId = process.env.SHOPIFY_CLIENT_ID || '';
  const scopes = (opts.scopes && opts.scopes.length ? opts.scopes : ['read_products']).join(',');
  const u = new URL('/admin/oauth/authorize', shopifyOrigin(host));
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', scopes);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  return u.toString();
}

/**
 * Exchange the one-shot `code` from Shopify's redirect for an OFFLINE access
 * token. We never request an expiring token (`expiring=1`), so the response is
 * a permanent token with no refresh_token. `shop` comes from the connect flow
 * and is threaded through so the connection row stores it for catalog calls.
 */
export async function shopifyExchangeCode(opts: {
  code: string;
  shop: string;
}): Promise<ShopifyOAuthToken> {
  const host = shopifyHost(opts.shop);
  if (!host) {
    throw new Error('Shopify token exchange needs a shop domain (e.g. acme.myshopify.com)');
  }
  const clientId = process.env.SHOPIFY_CLIENT_ID || '';
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error(
      'Shopify OAuth not configured: set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET',
    );
  }
  const res = await fetch(`${shopifyOrigin(host)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify token exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: String(json.access_token || ''),
    // Offline tokens carry no refresh token; surface it if Shopify ever does.
    refreshToken: String(json.refresh_token || ''),
    // Offline tokens never expire.
    expiresAt: null,
    shop: host,
    scope: typeof json.scope === 'string' ? json.scope.split(',').filter(Boolean) : [],
  };
}

/**
 * NO-OP by design. Shopify OFFLINE access tokens do not expire and carry no
 * refresh token, so there is nothing to refresh — see
 * shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant.
 * The signature is kept only so the connector registry can treat every
 * provider uniformly. If you call it, you get the same (still-valid) token back.
 */
export async function shopifyRefreshAccessToken(
  _refreshToken: string,
  _shop?: string,
): Promise<ShopifyOAuthToken> {
  throw new Error(
    'Shopify offline access tokens do not expire — refresh is not needed (no-op)',
  );
}

// ─── Catalog poll ─────────────────────────────────────────────────────────

/**
 * Parse the opaque `page_info` cursor for the NEXT page out of the RFC-5988
 * Link response header. Format:
 *   Link: <https://shop/admin/api/v/products.json?page_info=XXX&limit=250>; rel="next"
 * (a `previous` rel may also be present). The token must be used verbatim — we
 * read it straight from the URL Shopify hands us and never reconstruct it.
 */
export function parseNextPageInfo(linkHeader: string | null | undefined): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(',')) {
    const seg = part.trim();
    if (!/rel="?next"?/.test(seg)) continue;
    const m = seg.match(/<([^>]+)>/);
    if (!m) continue;
    try {
      const pi = new URL(m[1]).searchParams.get('page_info');
      if (pi) return pi;
    } catch {
      /* malformed URL in header — ignore, stop paging */
    }
  }
  return undefined;
}

/** Decimal dollar string → integer cents. "199.00" → 19900, bad input → 0. */
function dollarsToCents(price: unknown): number {
  const n = parseFloat(String(price));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Fetch the full Shopify product catalog for a store. Products carry their
 * variants inline; each variant becomes a NormalizedItem (price converted from
 * the dollar string to integer cents). `product_type` is the category — we
 * synthesize a NormalizedCategory per distinct non-empty product_type and link
 * items to it. Cursor pagination via the Link header (page_info), 250/page,
 * capped at 50 pages defensively (mirrors square/clover PAGE_CAP).
 */
export async function shopifyFetchCatalog(
  accessToken: string,
  ctx?: { shop?: string },
): Promise<CatalogSnapshot> {
  const host = shopifyHost(ctx?.shop || '');
  if (!host) {
    throw new Error('Shopify catalog fetch needs a shop domain (captured during OAuth)');
  }
  const version = shopifyApiVersion();
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  };
  const PAGE = 250;
  const PAGE_CAP = 50;

  const items: NormalizedItem[] = [];
  // product_type → synthesized category. Shopify product_type is a free-text
  // string, not an entity with its own id, so we key the category by the type
  // name itself (stable + human-readable).
  const categoryNameToCat = new Map<string, NormalizedCategory>();

  let pageInfo: string | undefined;
  for (let p = 0; p < PAGE_CAP; p++) {
    const url = new URL(`/admin/api/${version}/products.json`, shopifyOrigin(host));
    url.searchParams.set('limit', String(PAGE));
    // page_info is mutually exclusive with all filters except limit/fields.
    if (pageInfo) url.searchParams.set('page_info', pageInfo);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Shopify products fetch failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const json: any = await res.json();
    const products: any[] = Array.isArray(json.products) ? json.products : [];

    for (const prod of products) {
      const productId = String(prod.id ?? '');
      if (!productId) continue;
      const title = String(prod.title || 'Untitled');
      // Product status governs visibility: only `active` shows on the storefront.
      const productActive = prod.status ? prod.status === 'active' : true;

      // Category from product_type (free-text). Synthesize one category row per
      // distinct type and remember its insertion order for sortOrder.
      const productType = String(prod.product_type || '').trim();
      let categoryExternalId: string | undefined;
      let categoryName: string | undefined;
      if (productType) {
        categoryExternalId = productType;
        categoryName = productType;
        if (!categoryNameToCat.has(productType)) {
          categoryNameToCat.set(productType, {
            externalId: productType,
            name: productType,
            sortOrder: categoryNameToCat.size,
          });
        }
      }

      const variants: any[] = Array.isArray(prod.variants) ? prod.variants : [];
      if (variants.length === 0) {
        // Product with no variants — surface the product itself.
        items.push({
          externalId: productId,
          name: title,
          description: prod.body_html ? String(prod.body_html) : undefined,
          priceCents: 0,
          categoryExternalId,
          category: categoryName,
          available: productActive,
          externalUpdatedAt: prod.updated_at ? new Date(prod.updated_at) : undefined,
        });
        continue;
      }

      for (const v of variants) {
        const variantId = String(v.id ?? '');
        if (!variantId) continue;
        const variantName = v.title ? String(v.title) : '';
        // "Default Title" is Shopify's single-variant sentinel — show just the
        // product name then; otherwise "Product / Variant" (mirrors Square).
        const isDefaultVariant = !variantName || variantName === 'Default Title';
        const name = isDefaultVariant ? title : `${title} / ${variantName}`;
        // A variant is available if the product is active AND the variant is
        // either not inventory-tracked, in stock, or allowed to oversell.
        const tracked = v.inventory_management === 'shopify';
        const inStock = Number(v.inventory_quantity ?? 0) > 0;
        const oversell = v.inventory_policy === 'continue';
        const variantAvailable = productActive && (!tracked || inStock || oversell);
        items.push({
          externalId: `${productId}:${variantId}`,
          name,
          description: prod.body_html ? String(prod.body_html) : undefined,
          // Shopify variant price is a decimal DOLLAR string → integer cents.
          priceCents: dollarsToCents(v.price),
          categoryExternalId,
          category: categoryName,
          available: variantAvailable,
          externalUpdatedAt: (v.updated_at || prod.updated_at)
            ? new Date(v.updated_at || prod.updated_at)
            : undefined,
        });
      }
    }

    pageInfo = parseNextPageInfo(res.headers.get('link') || res.headers.get('Link'));
    if (!pageInfo) break;
    if (p === PAGE_CAP - 1) {
      log.warn(`shopifyFetchCatalog hit page cap (${PAGE_CAP}); aborting pagination`);
    }
  }

  const categories = Array.from(categoryNameToCat.values());
  log.debug(`Shopify catalog: ${items.length} items, ${categories.length} categories (shop ${host})`);
  return { items, categories };
}
