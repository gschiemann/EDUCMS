/**
 * Square POS provider — full implementation (2026-05-25).
 * ─────────────────────────────────────────────────────────
 *
 * SHIPPABLE FOUNDATION: every UI / DB / connect-wizard / audit /
 * encrypted-credential surface already existed; the actual provider
 * handler was missing. Operator clicked "Connect Square" and got a 400
 * from pos.service.ts ("OAuth flow not yet implemented"). This module
 * is the missing handler.
 *
 * What this ships:
 *   • OAuth (authorize → callback → token exchange → refresh)
 *   • Catalog poll (`/v2/catalog/list?types=ITEM,CATEGORY` paginated)
 *   • Upsert into PosMenuItem / PosCategory rows
 *   • Webhook signature verification (HMAC-SHA256 of URL+body)
 *   • Idempotency via ProcessedPosEvent (mirrors ProcessedStripeEvent)
 *   • AuditLog on every License/menu change + every webhook decision
 *
 * Sandbox vs production:
 *   process.env.SQUARE_ENV === 'production'  → live endpoints
 *   anything else (default)                  → sandbox endpoints
 *
 * Env vars (declared in .env.example, never committed live):
 *   SQUARE_CLIENT_ID           — OAuth client id
 *   SQUARE_CLIENT_SECRET       — OAuth client secret
 *   SQUARE_WEBHOOK_SIG_KEY     — Webhook signature key from Sq dashboard
 *   SQUARE_ENV                 — 'production' | 'sandbox' (default sandbox)
 */
import { Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const log = new Logger('SquareProvider');

// ─── Endpoint base URLs ─────────────────────────────────────────────────

function isProd(): boolean {
  return process.env.SQUARE_ENV === 'production';
}

export function squareApiBase(): string {
  // Dev-only sandbox-harness override (2026-08-04): lets the local mock POS
  // server (scripts/pos-sandbox/) stand in for Square so the full OAuth +
  // catalog pipeline is testable with zero external accounts. NEVER honored
  // in production — a prod deploy cannot be redirected via env.
  const override = process.env.SQUARE_API_BASE;
  if (override && process.env.NODE_ENV !== 'production') {
    return override.replace(/\/$/, '');
  }
  return isProd()
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

/** Square's OAuth authorize page is the same domain as the API. */
export function squareAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
  scopes?: string[];
}): string {
  const clientId = process.env.SQUARE_CLIENT_ID || '';
  const scopes = (opts.scopes && opts.scopes.length
    ? opts.scopes
    : ['MERCHANT_PROFILE_READ', 'ITEMS_READ', 'INVENTORY_READ']
  ).join('+');
  const u = new URL('/oauth2/authorize', squareApiBase());
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', scopes);
  u.searchParams.set('session', 'false');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  // Square wants `+`-separated scope (URLSearchParams encodes it as %2B).
  return u.toString().replace(`scope=${encodeURIComponent(scopes)}`, `scope=${scopes}`);
}

// ─── OAuth token exchange ───────────────────────────────────────────────

export interface SquareOAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO
  merchantId: string;
  scope: string[];
}

/**
 * Exchange the one-shot `code` from Square's redirect for a real OAuth
 * token pair. The refresh token is what we persist (encrypted) so the
 * sync cron can mint fresh access tokens on its own cadence.
 */
export async function squareExchangeCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<SquareOAuthToken> {
  const clientId = process.env.SQUARE_CLIENT_ID || '';
  const clientSecret = process.env.SQUARE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error(
      'Square OAuth not configured: set SQUARE_CLIENT_ID + SQUARE_CLIENT_SECRET',
    );
  }
  const res = await fetch(`${squareApiBase()}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': '2024-05-15',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      grant_type: 'authorization_code',
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Square token exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_at,
    merchantId: json.merchant_id,
    scope: Array.isArray(json.scope) ? json.scope : String(json.scope || '').split(/\s+/),
  };
}

/** Refresh an expiring Square access token. */
export async function squareRefreshAccessToken(refreshToken: string): Promise<SquareOAuthToken> {
  const clientId = process.env.SQUARE_CLIENT_ID || '';
  const clientSecret = process.env.SQUARE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('Square OAuth not configured');
  }
  const res = await fetch(`${squareApiBase()}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': '2024-05-15',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Square token refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: json.expires_at,
    merchantId: json.merchant_id,
    scope: Array.isArray(json.scope) ? json.scope : String(json.scope || '').split(/\s+/),
  };
}

// ─── Catalog poll ───────────────────────────────────────────────────────

/** Per-location price / availability for one item, keyed by the provider's
 *  own location id. `priceCents` undefined = inherit the base price;
 *  `available` undefined = inherit (present everywhere). Consumed by the
 *  menu bridge to write MenuLocationOverride rows per mapped location. */
export interface NormalizedLocationPrice {
  externalLocationId: string;
  priceCents?: number;
  available?: boolean;
}

export interface NormalizedItem {
  externalId: string;
  name: string;
  description?: string;
  priceCents: number;
  categoryExternalId?: string;
  imageUrl?: string;
  available: boolean;
  externalUpdatedAt?: Date;
  category?: string;
  /** Per-location price/availability overrides (multi-location chains). */
  locationPrices?: NormalizedLocationPrice[];
}

export interface NormalizedCategory {
  externalId: string;
  name: string;
  sortOrder: number;
}

/** A provider-side location/store/outlet (Square location_id, Shopify
 *  location, Lightspeed outlet). Upserted into PosLocation; the operator
 *  maps each to one of our (child) location tenants. */
export interface NormalizedLocation {
  externalId: string;
  name: string;
  address?: string;
  timezone?: string;
  status?: string;
}

export interface CatalogSnapshot {
  items: NormalizedItem[];
  categories: NormalizedCategory[];
}

// ─── Locations ──────────────────────────────────────────────────────────

/**
 * List the merchant's Square locations (stores). A multi-location chain has
 * one per store; the operator maps each to one of our location tenants so a
 * screen at that store shows its store's live prices. `GET /v2/locations`.
 * docs: developer.squareup.com/reference/square/locations-api/list-locations
 */
export async function squareFetchLocations(accessToken: string): Promise<NormalizedLocation[]> {
  const res = await fetch(`${squareApiBase()}/v2/locations`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-05-15' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Square locations fetch failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const locs: any[] = Array.isArray(json.locations) ? json.locations : [];
  return locs
    .map((l) => {
      const a = l.address || {};
      const address = [a.address_line_1, a.locality, a.administrative_district_level_1, a.postal_code]
        .filter(Boolean)
        .join(', ') || undefined;
      return {
        externalId: String(l.id || ''),
        name: String(l.name || l.id || 'Location'),
        address,
        timezone: l.timezone ? String(l.timezone) : undefined,
        status: l.status ? String(l.status) : undefined,
      } as NormalizedLocation;
    })
    .filter((l) => l.externalId);
}

/**
 * Compute per-location price/availability for one Square item variation.
 * Price comes from the variation's `location_overrides[]` (per location_id);
 * availability from the item object's present/absent location lists. Only
 * locations explicitly mentioned are emitted — others inherit base price +
 * availability. (Edge: an item with present_at_all_locations=false at an
 * unlisted location can't be enumerated here without the full location list;
 * the common case — price overrides on a present-everywhere item — is exact.)
 */
function buildLocationPrices(obj: any, vData: any): NormalizedLocationPrice[] | undefined {
  const byLoc = new Map<string, NormalizedLocationPrice>();
  for (const ov of Array.isArray(vData.location_overrides) ? vData.location_overrides : []) {
    const lid = String(ov.location_id || '');
    if (!lid) continue;
    const entry = byLoc.get(lid) || { externalLocationId: lid };
    const amt = ov.price_money?.amount;
    if (amt != null) entry.priceCents = Number(amt);
    byLoc.set(lid, entry);
  }
  const presentAll = obj.present_at_all_locations !== false; // Square defaults true
  for (const lid of Array.isArray(obj.absent_at_location_ids) ? obj.absent_at_location_ids : []) {
    const k = String(lid);
    const entry = byLoc.get(k) || { externalLocationId: k };
    entry.available = false;
    byLoc.set(k, entry);
  }
  if (!presentAll) {
    for (const lid of Array.isArray(obj.present_at_location_ids) ? obj.present_at_location_ids : []) {
      const k = String(lid);
      const entry = byLoc.get(k) || { externalLocationId: k };
      if (entry.available !== false) entry.available = true;
      byLoc.set(k, entry);
    }
  }
  return byLoc.size ? [...byLoc.values()] : undefined;
}

/**
 * Fetch the entire catalog from Square. Paginates via the `cursor`
 * token returned by Square (NOT pagination by offset — Square uses
 * opaque cursors). Caps at 50 pages defensively.
 */
export async function squareFetchCatalog(accessToken: string): Promise<CatalogSnapshot> {
  const items: NormalizedItem[] = [];
  const categories: NormalizedCategory[] = [];
  const categoryIdToName = new Map<string, string>();

  let cursor: string | undefined;
  let pages = 0;
  const PAGE_CAP = 50;

  do {
    if (pages++ >= PAGE_CAP) {
      log.warn(`squareFetchCatalog hit page cap (${PAGE_CAP}); aborting pagination`);
      break;
    }
    const url = new URL('/v2/catalog/list', squareApiBase());
    url.searchParams.set('types', 'ITEM,CATEGORY');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': '2024-05-15',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Square catalog fetch failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const json: any = await res.json();
    const objects: any[] = Array.isArray(json.objects) ? json.objects : [];

    for (const obj of objects) {
      if (obj.type === 'CATEGORY') {
        const id = String(obj.id || '');
        const name = String(obj.category_data?.name || obj.id || 'Untitled');
        if (!id) continue;
        categoryIdToName.set(id, name);
        categories.push({
          externalId: id,
          name,
          sortOrder: Number(obj.category_data?.ordinal ?? 0),
        });
      } else if (obj.type === 'ITEM') {
        const itemData = obj.item_data || {};
        const variations: any[] = Array.isArray(itemData.variations) ? itemData.variations : [];
        if (variations.length === 0) {
          items.push({
            externalId: String(obj.id),
            name: String(itemData.name || 'Untitled'),
            description: itemData.description ? String(itemData.description) : undefined,
            priceCents: 0,
            categoryExternalId: itemData.category_id ? String(itemData.category_id) : undefined,
            available: !obj.is_deleted,
            externalUpdatedAt: obj.updated_at ? new Date(obj.updated_at) : undefined,
          });
          continue;
        }
        for (const v of variations) {
          const vData = v.item_variation_data || {};
          const priceMoney = vData.price_money || {};
          const priceCents = Number(priceMoney.amount ?? 0);
          const externalId = `${obj.id}:${v.id}`;
          const baseName = String(itemData.name || 'Untitled');
          const varName = vData.name ? String(vData.name) : '';
          const fullName = varName && varName !== 'Regular' ? `${baseName} / ${varName}` : baseName;
          items.push({
            externalId,
            name: fullName,
            description: itemData.description ? String(itemData.description) : undefined,
            priceCents,
            categoryExternalId: itemData.category_id ? String(itemData.category_id) : undefined,
            available: !obj.is_deleted && !v.is_deleted,
            externalUpdatedAt: (v.updated_at || obj.updated_at)
              ? new Date(v.updated_at || obj.updated_at)
              : undefined,
            locationPrices: buildLocationPrices(obj, vData),
          });
        }
      }
    }
    cursor = json.cursor;
  } while (cursor);

  // Backfill the category name on each item now that we've seen all
  // CATEGORY rows (Square sometimes returns ITEM before CATEGORY).
  for (const item of items) {
    if (item.categoryExternalId) {
      const name = categoryIdToName.get(item.categoryExternalId);
      if (name) item.category = name;
    }
  }

  return { items, categories };
}

// ─── Webhook signature verification ─────────────────────────────────────

/**
 * Square signs every webhook with HMAC over the concatenation of the
 * notification URL + the request body. v2 webhook subscriptions use
 * SHA256 (header: X-Square-HmacSha256-Signature); legacy v1 used SHA1
 * (X-Square-Signature). We support both.
 *
 * https://developer.squareup.com/docs/webhooks/step3validate
 */
export function verifySquareSignature(opts: {
  signatureHeader: string | undefined;
  notificationUrl: string;
  body: string;
  signingKey: string;
  algo?: 'sha1' | 'sha256';
}): boolean {
  if (!opts.signatureHeader) return false;
  if (!opts.signingKey) return false;
  const algo = opts.algo || 'sha256';
  const computed = createHmac(algo, opts.signingKey)
    .update(opts.notificationUrl + opts.body)
    .digest('base64');
  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(opts.signatureHeader, 'base64');
    expected = Buffer.from(computed, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/** One-shot CSRF token for the connect flow. */
export function newOAuthStateToken(): string {
  return randomBytes(24).toString('hex');
}
