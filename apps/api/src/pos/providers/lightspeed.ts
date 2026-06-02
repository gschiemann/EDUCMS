/**
 * Lightspeed Retail X-Series (formerly Vend) POS provider — full
 * implementation (2026-06-02).
 * ─────────────────────────────────────────────────────────────────
 *
 * Mirrors providers/clover.ts so the connector registry treats every POS
 * the same way: OAuth (authorize → callback → token exchange → refresh) +
 * catalog poll → normalized CatalogSnapshot. The catalog upsert + the
 * encrypted-credential store + the connect wizard are all provider-agnostic
 * in pos.service — this module only supplies the X-Series-specific bytes.
 *
 * Verified against the official Lightspeed X-Series API docs (2026-06-02):
 *   • Authorization (OAuth2 authorization-code flow):
 *       authorize : https://secure.retail.lightspeed.app/connect
 *       token     : https://{domain_prefix}.retail.lightspeed.app/api/1.0/token   (grant_type=authorization_code)
 *       refresh   : https://{domain_prefix}.retail.lightspeed.app/api/1.0/token   (grant_type=refresh_token)
 *     Token/refresh bodies are application/x-www-form-urlencoded; the token
 *     response carries access_token, refresh_token, expires (absolute unix
 *     ts), expires_in (relative s), token_type=Bearer, scope, AND the
 *     per-retailer `domain_prefix`.
 *     https://x-series-api.lightspeedhq.com/docs/authorization
 *   • Products (REST 2.0, per-retailer host):
 *       GET https://{domain_prefix}.retail.lightspeed.app/api/2.0/products
 *     Response envelope: { data: Product[], version: { min, max } }.
 *     https://x-series-api.lightspeedhq.com/reference/listproducts
 *   • Pagination (version-cursor, NOT offset/opaque-cursor):
 *       set `after` = the PREVIOUS response's `version.max`; repeat until
 *       `data` comes back empty.  `page_size` caps items per page.
 *     https://x-series-api.lightspeedhq.com/docs/pagination
 *   • Product categories:
 *       GET https://{domain_prefix}.retail.lightspeed.app/api/2.0/product_categories
 *     (id, name, category_path). Same { data, version } envelope.
 *     https://x-series-api.lightspeedhq.com/reference/listproductcategories
 *
 * X-Series quirks vs Clover/Square (handled below):
 *   • The OAuth authorize page is a FIXED host (secure.retail.lightspeed.app),
 *     NOT the per-retailer host — the retailer's `domain_prefix` is only
 *     known AFTER the token exchange (it's a field on the token response).
 *   • Every API call (token, refresh, products) needs the retailer's
 *     `domain_prefix` in the host. This is X-Series's equivalent of Clover's
 *     merchantId. Clover gets merchantId on the OAuth callback query; X-Series
 *     returns domain_prefix on the TOKEN response. We thread it through
 *     exchangeCode()/refresh() (the controller can also pass a known prefix),
 *     carry it on the token, and read it back in fetchCatalog(ctx.domainPrefix).
 *   • Price is in decimal DOLLARS (price_including_tax / price_excluding_tax,
 *     e.g. 12.99) — we convert to integer CENTS (× 100, rounded) so the
 *     normalized shape matches Clover/Square (which already report cents).
 *   • Pagination is a version cursor (after = prev version.max), not Clover's
 *     limit/offset and not Square's opaque cursor.
 *
 * Sandbox vs production: X-Series has NO separate sandbox HOST — the docs'
 * "sandbox" is just a trial retailer account, which is reached via that
 * retailer's own `domain_prefix` host exactly like production. So there is
 * nothing to toggle in the host. `LIGHTSPEED_ENV` is accepted + surfaced
 * (lightspeedEnv()) for parity/logging only; it does NOT change any URL.
 *
 * Env vars (declared in .env.example by the lead, never committed live):
 *   LIGHTSPEED_CLIENT_ID, LIGHTSPEED_CLIENT_SECRET, LIGHTSPEED_ENV
 */
import { Logger } from '@nestjs/common';
import type { CatalogSnapshot, NormalizedItem, NormalizedCategory } from './square';

const log = new Logger('LightspeedProvider');

/** The fixed host that serves the OAuth authorize page (retailer-agnostic). */
const AUTHORIZE_HOST = 'https://secure.retail.lightspeed.app';

/**
 * Informational only. X-Series has no separate sandbox host — a "sandbox"
 * is a trial retailer account reached via its own domain_prefix host, same
 * as production. Surfaced for parity/logging; never alters a URL.
 */
export function lightspeedEnv(): 'production' | 'sandbox' {
  return process.env.LIGHTSPEED_ENV === 'sandbox' ? 'sandbox' : 'production';
}

/**
 * Per-retailer API host. X-Series is multi-tenant by subdomain: every REST
 * call + the token/refresh endpoints live under the retailer's own
 * `domain_prefix`. Throws if the prefix is missing (we never guess a host).
 */
export function lightspeedApiBase(ctx: { domainPrefix?: string }): string {
  const prefix = String(ctx?.domainPrefix || '').trim();
  if (!prefix) {
    throw new Error('Lightspeed API host needs a domainPrefix (captured during OAuth)');
  }
  return `https://${prefix}.retail.lightspeed.app`;
}

// ─── OAuth ──────────────────────────────────────────────────────────────

export interface LightspeedOAuthToken {
  accessToken: string;
  refreshToken: string;
  /** ISO string, or null if X-Series didn't return an expiry. */
  expiresAt: string | null;
  /**
   * The retailer's subdomain prefix, carried so every catalog call can
   * build the per-retailer host. X-Series returns it on the token response
   * (X-Series equivalent of Clover's merchantId).
   */
  domainPrefix: string;
  scope: string[];
}

export function lightspeedAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
  scopes?: string[];
}): string {
  const clientId = process.env.LIGHTSPEED_CLIENT_ID || '';
  const u = new URL('/connect', AUTHORIZE_HOST);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  // Scopes are a space-delimited list (e.g. "products:read sales:read").
  // Default to read-only catalog access; URLSearchParams encodes the space.
  const scopes = opts.scopes && opts.scopes.length ? opts.scopes : ['products:read'];
  u.searchParams.set('scope', scopes.join(' '));
  return u.toString();
}

/** X-Series returns `expires` (absolute unix SECONDS) and `expires_in` (relative s). */
function expiryToIso(json: any): string | null {
  const abs = Number(json?.expires);
  if (Number.isFinite(abs) && abs > 0) {
    return new Date(abs * 1000).toISOString();
  }
  const rel = Number(json?.expires_in);
  if (Number.isFinite(rel) && rel > 0) {
    return new Date(Date.now() + rel * 1000).toISOString();
  }
  return null;
}

function scopeToArray(scope: unknown): string[] {
  if (Array.isArray(scope)) return scope.map(String);
  const s = String(scope || '').trim();
  return s ? s.split(/\s+/) : [];
}

/**
 * Exchange the one-shot `code` for an access/refresh pair. The retailer's
 * `domainPrefix` is required to address the token host; it normally comes
 * from the OAuth callback (X-Series appends `domain_prefix` to the redirect)
 * and is also echoed on the token response — we prefer the response value and
 * fall back to the threaded one.
 */
export async function lightspeedExchangeCode(opts: {
  code: string;
  redirectUri: string;
  domainPrefix?: string;
}): Promise<LightspeedOAuthToken> {
  const clientId = process.env.LIGHTSPEED_CLIENT_ID || '';
  const clientSecret = process.env.LIGHTSPEED_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error(
      'Lightspeed OAuth not configured: set LIGHTSPEED_CLIENT_ID + LIGHTSPEED_CLIENT_SECRET',
    );
  }
  const base = lightspeedApiBase({ domainPrefix: opts.domainPrefix });
  const body = new URLSearchParams({
    code: opts.code,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
  });
  const res = await fetch(`${base}/api/1.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lightspeed token exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: String(json.access_token || ''),
    refreshToken: String(json.refresh_token || ''),
    expiresAt: expiryToIso(json),
    domainPrefix: String(json.domain_prefix || opts.domainPrefix || ''),
    scope: scopeToArray(json.scope),
  };
}

/**
 * Refresh an expiring X-Series access token. The refresh call also lives on
 * the per-retailer host, so `domainPrefix` is required; preserve it on the
 * returned token. X-Series may omit a fresh refresh_token — keep the old one.
 */
export async function lightspeedRefreshAccessToken(
  refreshToken: string,
  domainPrefix?: string,
): Promise<LightspeedOAuthToken> {
  const clientId = process.env.LIGHTSPEED_CLIENT_ID || '';
  const clientSecret = process.env.LIGHTSPEED_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Lightspeed OAuth not configured');
  const base = lightspeedApiBase({ domainPrefix });
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${base}/api/1.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lightspeed token refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: String(json.access_token || ''),
    refreshToken: String(json.refresh_token || refreshToken),
    expiresAt: expiryToIso(json),
    domainPrefix: String(json.domain_prefix || domainPrefix || ''),
    scope: scopeToArray(json.scope),
  };
}

// ─── Catalog poll ─────────────────────────────────────────────────────────

/** Decimal dollars (e.g. 12.99) → integer cents (1299). NaN/negative → 0. */
function dollarsToCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * Fetch the full X-Series catalog for a retailer. Categories first (so each
 * product's category name resolves inline), then products. Both paginate via
 * the version cursor: `after` = the previous response's `version.max`,
 * repeated until `data` is empty. Capped at 50 pages defensively (mirrors
 * clover/square PAGE_CAP).
 */
export async function lightspeedFetchCatalog(
  accessToken: string,
  ctx?: { domainPrefix?: string },
): Promise<CatalogSnapshot> {
  const domainPrefix = String(ctx?.domainPrefix || '');
  if (!domainPrefix) {
    throw new Error('Lightspeed catalog fetch needs a domainPrefix (captured during OAuth)');
  }
  const base = lightspeedApiBase({ domainPrefix });
  const headers = { Authorization: `Bearer ${accessToken}` };
  const PAGE = 200;
  const PAGE_CAP = 50;

  // Categories
  const categories: NormalizedCategory[] = [];
  const categoryIdToName = new Map<string, string>();
  {
    let after: number | undefined;
    let sortOrder = 0;
    for (let p = 0; p < PAGE_CAP; p++) {
      const url = new URL('/api/2.0/product_categories', base);
      url.searchParams.set('page_size', String(PAGE));
      if (after !== undefined) url.searchParams.set('after', String(after));
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Lightspeed categories fetch failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json: any = await res.json();
      const data: any[] = Array.isArray(json.data) ? json.data : [];
      // X-Series pagination: repeat until an empty collection is returned.
      if (data.length === 0) break;
      for (const c of data) {
        const id = String(c.id || '');
        if (!id) continue;
        const name = String(c.name || id);
        if (!categoryIdToName.has(id)) {
          categoryIdToName.set(id, name);
          // X-Series has no numeric ordinal — categories sort alphabetically
          // by path. Preserve the returned order via a running counter.
          categories.push({ externalId: id, name, sortOrder: sortOrder++ });
        }
      }
      // Advance the version cursor; stop if it isn't moving forward (guards
      // against a non-advancing/absent `version.max` looping forever).
      const max = Number(json?.version?.max);
      if (!Number.isFinite(max) || (after !== undefined && max <= after)) break;
      after = max;
    }
  }

  // Products
  const items: NormalizedItem[] = [];
  {
    let after: number | undefined;
    for (let p = 0; p < PAGE_CAP; p++) {
      const url = new URL('/api/2.0/products', base);
      url.searchParams.set('page_size', String(PAGE));
      if (after !== undefined) url.searchParams.set('after', String(after));
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Lightspeed products fetch failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json: any = await res.json();
      const data: any[] = Array.isArray(json.data) ? json.data : [];
      // X-Series pagination: repeat until an empty collection is returned.
      if (data.length === 0) break;
      for (const prod of data) {
        const id = String(prod.id || '');
        if (!id) continue;
        // Prefer the tax-inclusive shelf price (what a menu/price board
        // shows the customer); fall back to the exclusive price.
        const priceCents = dollarsToCents(prod.price_including_tax ?? prod.price_excluding_tax);
        const cat = prod.product_category;
        const categoryExternalId = cat?.id ? String(cat.id) : undefined;
        const inlineCatName = cat?.name ? String(cat.name) : undefined;
        // active/is_active default true unless explicitly false; a non-null
        // deleted_at always means gone.
        const available =
          prod.deleted_at == null && prod.active !== false && prod.is_active !== false;
        items.push({
          externalId: id,
          name: String(prod.name || 'Untitled'),
          description: prod.description ? String(prod.description) : undefined,
          priceCents,
          categoryExternalId,
          category: inlineCatName ?? (categoryExternalId ? categoryIdToName.get(categoryExternalId) : undefined),
          imageUrl: typeof prod.image_thumbnail_url === 'string' ? prod.image_thumbnail_url : undefined,
          available,
          externalUpdatedAt: prod.updated_at ? new Date(prod.updated_at) : undefined,
        });
        // Learn category names we only saw inline on a product.
        if (categoryExternalId && inlineCatName && !categoryIdToName.has(categoryExternalId)) {
          categoryIdToName.set(categoryExternalId, inlineCatName);
        }
      }
      // Advance the version cursor; stop if it isn't moving forward (guards
      // against a non-advancing/absent `version.max` looping forever).
      const max = Number(json?.version?.max);
      if (!Number.isFinite(max) || (after !== undefined && max <= after)) break;
      after = max;
    }
  }

  // Backfill any category name we couldn't resolve inline.
  for (const item of items) {
    if (item.categoryExternalId && !item.category) {
      const name = categoryIdToName.get(item.categoryExternalId);
      if (name) item.category = name;
    }
  }

  log.debug(
    `Lightspeed catalog: ${items.length} items, ${categories.length} categories (retailer ${domainPrefix})`,
  );
  return { items, categories };
}
