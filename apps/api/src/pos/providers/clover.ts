/**
 * Clover POS provider — full implementation (2026-06-01).
 * ─────────────────────────────────────────────────────────
 *
 * Mirrors providers/square.ts so the connector registry treats every POS
 * the same way: OAuth (authorize → callback → token exchange → refresh) +
 * catalog poll → normalized CatalogSnapshot. The catalog upsert + the
 * encrypted-credential store + the connect wizard are all provider-agnostic
 * in pos.service — this module only supplies the Clover-specific bytes.
 *
 * Verified against Clover developer docs (2026-06-01):
 *   • OAuth v2 (expiring access + refresh tokens):
 *       authorize : {accountBase}/oauth/v2/authorize
 *       token     : {apiBase}/oauth/v2/token     (code → token pair)
 *       refresh   : {apiBase}/oauth/v2/refresh   (refresh_token → new pair)
 *     docs.clover.com/dev/docs/use-oauth + /refresh-access-tokens
 *   • Catalog (REST v3, per-merchant):
 *       GET {apiBase}/v3/merchants/{mId}/categories
 *       GET {apiBase}/v3/merchants/{mId}/items?expand=categories  (price in CENTS)
 *     docs.clover.com/dev/reference/inventorygetitems
 *
 * Clover quirks vs Square (handled below):
 *   • The OAuth authorize page is on the ACCOUNT host, not the API host.
 *   • Every catalog call needs the merchantId in the URL path. Clover
 *     returns `merchant_id` on the OAuth CALLBACK query (not the token
 *     response), so the controller threads it into exchangeCode() and we
 *     carry it on the token + read it back in fetchCatalog(ctx.merchantId).
 *   • Pagination is offset-based (limit/offset), not Square's opaque cursor.
 *
 * Sandbox vs production (env CLOVER_ENV === 'production' → live):
 *   account host : https://www.clover.com         | https://sandbox.dev.clover.com
 *   api host     : https://api.clover.com          | https://apisandbox.dev.clover.com
 *
 * Env vars (declared in .env.example, never committed live):
 *   CLOVER_CLIENT_ID, CLOVER_CLIENT_SECRET, CLOVER_ENV ('production'|'sandbox')
 */
import { Logger } from '@nestjs/common';
import type { CatalogSnapshot, NormalizedItem, NormalizedCategory } from './square';

const log = new Logger('CloverProvider');

function isProd(): boolean {
  return process.env.CLOVER_ENV === 'production';
}

/** Dev-only sandbox-harness override (2026-08-04) — see
 *  scripts/pos-sandbox/. Never honored in production. */
function devOverride(): string | null {
  const override = process.env.CLOVER_API_BASE;
  if (override && process.env.NODE_ENV !== 'production') {
    return override.replace(/\/$/, '');
  }
  return null;
}

/** API host — REST v3 + token/refresh endpoints. */
export function cloverApiBase(): string {
  const dev = devOverride();
  if (dev) return dev;
  return isProd() ? 'https://api.clover.com' : 'https://apisandbox.dev.clover.com';
}

/** Account host — the OAuth authorize page the operator's browser hits. */
export function cloverAccountBase(): string {
  const dev = devOverride();
  if (dev) return dev;
  return isProd() ? 'https://www.clover.com' : 'https://sandbox.dev.clover.com';
}

// ─── OAuth ──────────────────────────────────────────────────────────────

export interface CloverOAuthToken {
  accessToken: string;
  refreshToken: string;
  /** ISO string, or null if Clover didn't return an expiry. */
  expiresAt: string | null;
  /** Carried through from the OAuth callback query (Clover-specific). */
  merchantId: string;
  scope: string[];
}

export function cloverAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
  scopes?: string[];
}): string {
  const clientId = process.env.CLOVER_CLIENT_ID || '';
  const u = new URL('/oauth/v2/authorize', cloverAccountBase());
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  return u.toString();
}

function expiryToIso(seconds: unknown): string | null {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Clover returns epoch SECONDS for *_expiration.
  return new Date(n * 1000).toISOString();
}

/**
 * Exchange the one-shot `code` for an access/refresh pair. `merchantId`
 * comes from the OAuth callback query (`merchant_id`) and is threaded
 * through so the connection row stores it for catalog calls.
 */
export async function cloverExchangeCode(opts: {
  code: string;
  redirectUri: string;
  merchantId?: string;
}): Promise<CloverOAuthToken> {
  const clientId = process.env.CLOVER_CLIENT_ID || '';
  const clientSecret = process.env.CLOVER_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('Clover OAuth not configured: set CLOVER_CLIENT_ID + CLOVER_CLIENT_SECRET');
  }
  const res = await fetch(`${cloverApiBase()}/oauth/v2/token`, {
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
    throw new Error(`Clover token exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: String(json.access_token || ''),
    refreshToken: String(json.refresh_token || ''),
    expiresAt: expiryToIso(json.access_token_expiration),
    merchantId: String(opts.merchantId || json.merchant_id || ''),
    scope: [],
  };
}

/** Refresh an expiring Clover access token. Preserve merchantId. */
export async function cloverRefreshAccessToken(
  refreshToken: string,
  merchantId?: string,
): Promise<CloverOAuthToken> {
  const clientId = process.env.CLOVER_CLIENT_ID || '';
  const clientSecret = process.env.CLOVER_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Clover OAuth not configured');
  const res = await fetch(`${cloverApiBase()}/oauth/v2/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Clover token refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return {
    accessToken: String(json.access_token || ''),
    refreshToken: String(json.refresh_token || refreshToken),
    expiresAt: expiryToIso(json.access_token_expiration),
    merchantId: String(merchantId || json.merchant_id || ''),
    scope: [],
  };
}

// ─── Catalog poll ─────────────────────────────────────────────────────────

/**
 * Fetch the full Clover catalog for a merchant. Categories first, then
 * items (with their category association expanded). Offset pagination,
 * 1000/page, capped at 50 pages defensively (mirrors square's PAGE_CAP).
 */
export async function cloverFetchCatalog(
  accessToken: string,
  ctx?: { merchantId?: string },
): Promise<CatalogSnapshot> {
  const merchantId = String(ctx?.merchantId || '');
  if (!merchantId) {
    throw new Error('Clover catalog fetch needs a merchantId (captured during OAuth)');
  }
  const base = cloverApiBase();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const PAGE = 1000;
  const PAGE_CAP = 50;

  // Categories
  const categories: NormalizedCategory[] = [];
  const categoryIdToName = new Map<string, string>();
  {
    let offset = 0;
    for (let p = 0; p < PAGE_CAP; p++) {
      const url = new URL(`/v3/merchants/${merchantId}/categories`, base);
      url.searchParams.set('limit', String(PAGE));
      url.searchParams.set('offset', String(offset));
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Clover categories fetch failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json: any = await res.json();
      const els: any[] = Array.isArray(json.elements) ? json.elements : [];
      for (const c of els) {
        const id = String(c.id || '');
        if (!id) continue;
        const name = String(c.name || id);
        categoryIdToName.set(id, name);
        categories.push({ externalId: id, name, sortOrder: Number(c.sortOrder ?? 0) });
      }
      if (els.length < PAGE) break;
      offset += PAGE;
    }
  }

  // Items (expand categories so we get the association inline)
  const items: NormalizedItem[] = [];
  {
    let offset = 0;
    for (let p = 0; p < PAGE_CAP; p++) {
      const url = new URL(`/v3/merchants/${merchantId}/items`, base);
      url.searchParams.set('expand', 'categories');
      url.searchParams.set('limit', String(PAGE));
      url.searchParams.set('offset', String(offset));
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Clover items fetch failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json: any = await res.json();
      const els: any[] = Array.isArray(json.elements) ? json.elements : [];
      for (const it of els) {
        const id = String(it.id || '');
        if (!id) continue;
        const catEl = it.categories?.elements?.[0];
        const categoryExternalId = catEl?.id ? String(catEl.id) : undefined;
        items.push({
          externalId: id,
          name: String(it.name || 'Untitled'),
          // Clover price is in cents (priceType FIXED). Variable/per-unit
          // items report 0 — surfaced as 0 rather than guessed.
          priceCents: Number(it.price ?? 0),
          categoryExternalId,
          category: categoryExternalId ? categoryIdToName.get(categoryExternalId) : undefined,
          // hidden = not shown on register; available defaults true unless explicitly false.
          available: it.hidden !== true && it.available !== false,
          externalUpdatedAt: it.modifiedTime ? new Date(Number(it.modifiedTime)) : undefined,
        });
      }
      if (els.length < PAGE) break;
      offset += PAGE;
    }
  }

  // Backfill any category name we couldn't resolve inline.
  for (const item of items) {
    if (item.categoryExternalId && !item.category) {
      const name = categoryIdToName.get(item.categoryExternalId);
      if (name) item.category = name;
    }
  }

  log.debug(`Clover catalog: ${items.length} items, ${categories.length} categories (merchant ${merchantId})`);
  return { items, categories };
}
