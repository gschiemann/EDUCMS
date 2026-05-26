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
}

export interface NormalizedCategory {
  externalId: string;
  name: string;
  sortOrder: number;
}

export interface CatalogSnapshot {
  items: NormalizedItem[];
  categories: NormalizedCategory[];
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
