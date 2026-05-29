/**
 * menu-console-api.ts — client for the multi-location price-book console.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Targets the menu-management contract described in
 * docs/research/2026-05-29-menu-mgmt-scale/02-competitor-architecture.md
 * (§"Target data model" + §"Price-book console"):
 *
 *   • central catalog (`MenuCatalog`/`MenuCategory`/`MenuItem`,
 *     defaultPriceCents)
 *   • per-location overrides
 *     (`MenuLocationOverride { locationTenantId, menuItemId,
 *       priceCents?(null=inherit), isAvailable(=86), soldOutUntil?,
 *       isHidden }`)
 *   • resolution: price = override.priceCents ?? central.default;
 *     visible = !isHidden && isAvailable && soldOutUntil-not-future
 *   • a "location" = a CHILD Tenant via Tenant.parentId
 *
 * This module owns the FRONT-END half of that platform (the API half is
 * a sibling agent). Every call is written against the documented
 * endpoints and degrades gracefully:
 *   • the catalog read falls back to the live `/pos/items` synced rows
 *     when the dedicated `/menu/catalog` endpoint isn't deployed yet, so
 *     the console is never empty on a tenant that has a Square / custom-
 *     webhook catalog;
 *   • override reads return [] (everything inherits) when the endpoint
 *     is missing — the grid still renders, every cell shows the inherited
 *     central price;
 *   • mutations surface a typed `MenuApiUnavailable` so the UI can show
 *     an honest "saving needs the menu service — pushed, awaiting backend"
 *     state instead of a stack trace or a silent no-op.
 *
 * NOTHING here is player-shipped → full modern JS is fine (this is
 * dashboard-only; the Chromium-83 rule does not apply).
 */

import { apiFetch } from '@/lib/api-client';

// ── Money helpers (cents ↔ dollar string) ───────────────────────────
// Live here (not the page) so the grid cells + bulk bar can import them
// without a circular dependency on the page module.

/** Parse a user-typed price ("4.99", "$4.99", "4") → integer cents, or
 *  null when unparseable / negative. */
export function dollarsToCents(input: string): number | null {
  const cleaned = String(input).replace(/[^0-9.]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Integer cents → fixed 2-decimal dollar string (no leading $). */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ── Types (mirror the documented contract) ──────────────────────────

export interface MenuCatalogItem {
  /** Our menu-item id (the override key). When the catalog falls back to
   *  the live POS rows this is the PosMenuItem id. */
  id: string;
  /** Provider-side id (Square/Toast/custom) — used for BYO field binding
   *  tokens `{{pos.item:<externalId>.price}}`. */
  externalId: string;
  name: string;
  description?: string;
  /** Central price (cents). Per-location overrides inherit this unless set. */
  defaultPriceCents: number;
  category?: string;
  badges?: string[];
  imageUrl?: string;
  /** Centrally available (the catalog-level on/off, distinct from a
   *  per-location 86). */
  available?: boolean;
}

export interface MenuLocation {
  /** Child-tenant id. */
  id: string;
  name: string;
  slug: string;
}

export interface MenuOverride {
  locationTenantId: string;
  menuItemId: string;
  /** null/undefined = inherit the central price. */
  priceCents?: number | null;
  /** false = 86'd at this location. */
  isAvailable: boolean;
  /** ISO timestamp; when in the future the item is temporarily 86'd. */
  soldOutUntil?: string | null;
  isHidden: boolean;
}

/** A resolved cell — what one item shows at one location after applying
 *  the override on top of the central default. */
export interface ResolvedCell {
  priceCents: number;
  /** true when a price override exists at this location (UI flags it). */
  isPriceOverridden: boolean;
  /** false = not visible on the board (86'd, hidden, or sold-out window). */
  isVisible: boolean;
  /** the raw override, if any. */
  override?: MenuOverride;
}

/** Thrown when a mutation endpoint isn't deployed (404/501). The UI
 *  treats this as "pushed, awaiting backend" rather than a hard error. */
export class MenuApiUnavailable extends Error {
  constructor(message = 'Menu service endpoint is not available yet.') {
    super(message);
    this.name = 'MenuApiUnavailable';
  }
}

// ── Internal helpers ────────────────────────────────────────────────

function isMissingEndpoint(err: any): boolean {
  // apiFetch throws an Error whose message includes the status for !ok
  // responses. Treat 404 / 501 as "not deployed yet".
  const msg = String(err?.message || err || '');
  return /\b404\b|\b501\b|not found|not implemented/i.test(msg);
}

// ── Catalog ─────────────────────────────────────────────────────────

/**
 * Central catalog of menu items. Prefers the dedicated `/menu/catalog`
 * endpoint; falls back to the live `/pos/items` synced rows so the
 * console is populated on any tenant that has connected a POS.
 */
export async function fetchMenuCatalog(): Promise<MenuCatalogItem[]> {
  try {
    const rows = await apiFetch<any[]>('/menu/catalog');
    if (Array.isArray(rows)) return rows.map(normalizeCatalogItem);
  } catch (err) {
    if (!isMissingEndpoint(err)) throw err;
    // fall through to the POS-items fallback
  }
  // Fallback: the synced POS catalog (single-location today, but it gives
  // the console real items to lay out the grid with).
  const posRows = await apiFetch<any[]>('/pos/items');
  if (!Array.isArray(posRows)) return [];
  return posRows.map(normalizeCatalogItem);
}

function normalizeCatalogItem(r: any): MenuCatalogItem {
  return {
    id: String(r.id ?? r.menuItemId ?? r.externalId ?? ''),
    externalId: String(r.externalId ?? r.id ?? ''),
    name: String(r.name ?? 'Untitled item'),
    description: r.description ?? undefined,
    defaultPriceCents:
      typeof r.defaultPriceCents === 'number'
        ? r.defaultPriceCents
        : typeof r.priceCents === 'number'
          ? r.priceCents
          : 0,
    category: r.category ?? undefined,
    badges: Array.isArray(r.badges) ? r.badges : undefined,
    imageUrl: r.imageUrl ?? undefined,
    available: r.available !== false,
  };
}

// ── Locations (child tenants) ───────────────────────────────────────

/**
 * The current tenant's locations = its child tenants (Tenant.parentId).
 * Read from `/tenants/accessible` (already used by the school switcher)
 * and filtered to children of `current`. When the tenant has no children
 * (a single-location operator) we still return the tenant itself as the
 * one location so the grid renders one column instead of going blank.
 */
export async function fetchMenuLocations(): Promise<MenuLocation[]> {
  const data = await apiFetch<{
    current: string;
    tenants: Array<{ id: string; name: string; slug: string; parentId: string | null }>;
  }>('/tenants/accessible');
  const all = Array.isArray(data?.tenants) ? data.tenants : [];
  const currentId = data?.current;
  const children = all.filter((t) => t.parentId === currentId);
  const source = children.length > 0 ? children : all.filter((t) => t.id === currentId);
  return source.map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
}

// ── Overrides ───────────────────────────────────────────────────────

/** All per-location overrides for the current tenant's locations.
 *  Empty when the endpoint isn't deployed (every cell inherits). */
export async function fetchMenuOverrides(): Promise<MenuOverride[]> {
  try {
    const rows = await apiFetch<any[]>('/menu/overrides');
    if (Array.isArray(rows)) return rows.map(normalizeOverride);
    return [];
  } catch (err) {
    if (isMissingEndpoint(err)) return [];
    throw err;
  }
}

function normalizeOverride(r: any): MenuOverride {
  return {
    locationTenantId: String(r.locationTenantId ?? r.locationId ?? ''),
    menuItemId: String(r.menuItemId ?? r.itemId ?? ''),
    priceCents:
      r.priceCents === null || r.priceCents === undefined
        ? null
        : Number(r.priceCents),
    isAvailable: r.isAvailable !== false,
    soldOutUntil: r.soldOutUntil ?? null,
    isHidden: r.isHidden === true,
  };
}

/** Index overrides by `${locationTenantId}:${menuItemId}` for O(1) cell
 *  lookup in the grid. */
export function indexOverrides(overrides: MenuOverride[]): Map<string, MenuOverride> {
  const m = new Map<string, MenuOverride>();
  for (const o of overrides) m.set(`${o.locationTenantId}:${o.menuItemId}`, o);
  return m;
}

/** Resolve one cell from the central item + an optional override. This
 *  is the SAME resolution rule the server applies at render time, kept
 *  here so the console preview matches the wall exactly. */
export function resolveCell(
  item: MenuCatalogItem,
  override: MenuOverride | undefined,
): ResolvedCell {
  const priceCents =
    override && override.priceCents != null ? override.priceCents : item.defaultPriceCents;
  const isPriceOverridden = !!(override && override.priceCents != null);
  const soldOutActive =
    !!override?.soldOutUntil && new Date(override.soldOutUntil).getTime() > Date.now();
  const isVisible =
    item.available !== false &&
    !(override?.isHidden === true) &&
    !(override?.isAvailable === false) &&
    !soldOutActive;
  return { priceCents, isPriceOverridden, isVisible, override };
}

// ── Mutations ───────────────────────────────────────────────────────

export interface SetOverridePatch {
  /** null = revert price to inherited. undefined = leave price unchanged. */
  priceCents?: number | null;
  isAvailable?: boolean;
  soldOutUntil?: string | null;
  isHidden?: boolean;
}

/**
 * Upsert one per-location override. `priceCents: null` reverts the price
 * to the central default (the server is expected to delete the price
 * portion of the override, or the whole row if nothing else is set).
 *
 * PUT /menu/overrides/:locationTenantId/:menuItemId
 */
export async function setOverride(
  locationTenantId: string,
  menuItemId: string,
  patch: SetOverridePatch,
): Promise<MenuOverride> {
  try {
    const row = await apiFetch<any>(
      `/menu/overrides/${encodeURIComponent(locationTenantId)}/${encodeURIComponent(menuItemId)}`,
      { method: 'PUT', body: JSON.stringify(patch) },
    );
    return normalizeOverride(row ?? { locationTenantId, menuItemId, ...patch });
  } catch (err) {
    if (isMissingEndpoint(err)) throw new MenuApiUnavailable();
    throw err;
  }
}

/** Remove a per-location override entirely (full revert-to-inherited).
 *  DELETE /menu/overrides/:locationTenantId/:menuItemId */
export async function revertOverride(
  locationTenantId: string,
  menuItemId: string,
): Promise<void> {
  try {
    await apiFetch(
      `/menu/overrides/${encodeURIComponent(locationTenantId)}/${encodeURIComponent(menuItemId)}`,
      { method: 'DELETE' },
    );
  } catch (err) {
    if (isMissingEndpoint(err)) throw new MenuApiUnavailable();
    throw err;
  }
}

// ── Self-serve menu import ("paste your menu") ──────────────────────

/** One parsed line from a pasted / typed menu. */
export interface ParsedMenuItem {
  externalId: string;
  name: string;
  priceCents: number;
  description?: string;
  category?: string;
}

/**
 * Parse free-form pasted text into menu items. Each non-blank line is
 * one item; price is the last $-amount or trailing number on the line.
 * Tolerant by design — the operator pastes whatever their menu looks
 * like and we do our best:
 *
 *   Classic Cheeseburger  $8.99
 *   Fries - 3.49
 *   Veggie Wrap .......... 7
 *
 * Also accepts a pasted JSON array `[{name, price|priceCents, ...}]`.
 */
export function parseMenuText(raw: string): ParsedMenuItem[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // JSON array path.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.menu) ? parsed.menu : Array.isArray(parsed?.items) ? parsed.items : [];
      return arr
        .map((r: any, i: number): ParsedMenuItem | null => {
          const name = String(r?.name ?? '').trim();
          if (!name) return null;
          const priceCents =
            typeof r?.priceCents === 'number'
              ? Math.round(r.priceCents)
              : (dollarsToCents(String(r?.price ?? '')) ?? 0);
          return {
            externalId: String(r?.externalId ?? r?.id ?? `pasted-${slugify(name)}-${i}`),
            name,
            priceCents,
            description: r?.description ? String(r.description) : undefined,
            category: r?.category ? String(r.category) : undefined,
          };
        })
        .filter((x: ParsedMenuItem | null): x is ParsedMenuItem => x !== null);
    } catch {
      // not valid JSON — fall through to line parsing
    }
  }

  // Line-by-line path.
  const out: ParsedMenuItem[] = [];
  const lines = trimmed.split(/\r?\n/);
  let idx = 0;
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    // Last money-ish token on the line is the price.
    const priceMatch = text.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*$/);
    let name = text;
    let priceCents = 0;
    if (priceMatch) {
      priceCents = Math.round(Number(priceMatch[1]) * 100);
      name = text.slice(0, priceMatch.index).replace(/[\s.\-–—:]+$/, '').trim();
    }
    if (!name) continue;
    out.push({ externalId: `pasted-${slugify(name)}-${idx}`, name, priceCents });
    idx++;
  }
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
}

/**
 * Import a parsed menu into the tenant's catalog via the documented
 * session-authed `POST /menu/import` ({ menu: [...] }) — the
 * Integration-Concierge "paste your menu" path that wraps the
 * custom-webhook `{menu}` ingest so the operator never handles a raw
 * webhook secret. Throws MenuApiUnavailable when the endpoint isn't
 * deployed yet so the caller can fall back to "template seeded, connect
 * a POS to go live."
 */
export async function importMenu(items: ParsedMenuItem[]): Promise<{ imported: number }> {
  try {
    const res = await apiFetch<{ imported?: number }>('/menu/import', {
      method: 'POST',
      body: JSON.stringify({ menu: items }),
    });
    return { imported: res?.imported ?? items.length };
  } catch (err) {
    if (isMissingEndpoint(err)) throw new MenuApiUnavailable();
    throw err;
  }
}

export interface BulkOverrideBody {
  menuItemId: string;
  /** Target locations. Empty/omitted = all of the tenant's locations. */
  locationTenantIds?: string[];
  patch: SetOverridePatch;
}

/**
 * Apply one patch across many locations in a single call — the
 * "set $4.99 across all / a region" affordance.
 * POST /menu/overrides/bulk  { menuItemId, locationTenantIds?, patch }
 */
export async function bulkSetOverride(body: BulkOverrideBody): Promise<{ updated: number }> {
  try {
    const res = await apiFetch<{ updated?: number }>('/menu/overrides/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { updated: res?.updated ?? (body.locationTenantIds?.length ?? 0) };
  } catch (err) {
    if (isMissingEndpoint(err)) throw new MenuApiUnavailable();
    throw err;
  }
}
