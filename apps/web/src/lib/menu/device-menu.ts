/**
 * device-menu.ts — player-side, device-authed menu fetch for the
 * MenuBoardWidget.
 * ──────────────────────────────────────────────────────────────────
 *
 * THE TIER-0 UNBLOCK (see docs/research/2026-05-29-menu-mgmt-scale/
 * 01-codebase-reality.md §"Tier 0"). Before this, MenuBoardWidget
 * called the session-authed `/pos/items` endpoint. On a real Pi /
 * kiosk the player only holds a DEVICE token (no role) → `/pos/items`
 * is RBAC-admin-locked → 403 → the widget silently fell back to
 * hardcoded DEMO_ITEMS *on every actual wall*. It demoed perfectly in
 * the admin preview (which carries a user-session token) and was dead
 * on the screen — the classic CLAUDE.md §9 "looks right on the laptop,
 * dead on the wall" failure.
 *
 * The fix is a device-authed read of `GET /api/v1/screens/:id/menu`
 * (the endpoint the API agent ships — DEVICE token auth, resolves the
 * screen's location via the tenant hierarchy and returns a
 * MenuBoardWidget-shaped payload). This module:
 *   1. Resolves the screenId WITHOUT touching the player page (which a
 *      sibling owns): URL `?screenId=` → cached manifest
 *      (`edu_manifest_cache_v1`, which the player already writes and
 *      whose JSON carries `screenId`) → a `window.__VENUEOS_SCREEN_ID__`
 *      hook a future player build may set.
 *   2. Resolves the device JWT from `localStorage['edu_device_token']`
 *      (the key the player mints + caches at /register time) or the
 *      `?token=` URL param (same precedence the player itself uses).
 *   3. Calls `/screens/:id/menu` with `Authorization: Bearer <jwt>`.
 *   4. Falls back to the legacy session path `/pos/items` so the
 *      DASHBOARD PREVIEW (no device token, but a user session) keeps
 *      working unchanged.
 *
 * Forward-compatible: the moment the API agent's `/screens/:id/menu`
 * lands, the player path lights up. Until then, the dashboard preview
 * path keeps the widget editable + previewing exactly as today.
 *
 * Chromium-83 / Taurus-safe: pure fetch + JSON, no modern-only APIs.
 */

import type { MenuBoardItem } from '@/components/widgets/restaurant/MenuBoardWidget';

const LS_DEVICE_TOKEN = 'edu_device_token';
const LS_MANIFEST_CACHE = 'edu_manifest_cache_v1';

/** Shape of one item returned by either menu source. Both the device
 *  endpoint and the legacy `/pos/items` endpoint return this superset;
 *  we map it to the widget's MenuBoardItem. */
interface RawMenuItem {
  name?: string;
  description?: string;
  desc?: string;
  /** integer cents (canonical) */
  priceCents?: number;
  /** pre-formatted string (the device endpoint may send this directly) */
  price?: string;
  salePriceCents?: number;
  badges?: string[];
  dietary?: string[];
  emoji?: string;
  imageUrl?: string;
  available?: boolean;
  /** Size / option price variants from the resolved feed. priceCents is
   *  canonical; price (pre-formatted) accepted as a fallback. */
  variants?: { label?: string; priceCents?: number; price?: string }[];
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** Resolve the current screenId on the player without editing the
 *  player page. Order: URL param → cached manifest → global hook. */
export function resolvePlayerScreenId(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = getQueryParam('screenId') || getQueryParam('screen');
  if (fromUrl) return fromUrl;
  // The player caches its last good manifest (which includes screenId)
  // so it survives a cold offline reboot — read it back here.
  try {
    const raw = localStorage.getItem(LS_MANIFEST_CACHE);
    if (raw) {
      const parsed = JSON.parse(raw);
      const sid = parsed?.m?.screenId || parsed?.screenId;
      if (typeof sid === 'string' && sid) return sid;
    }
  } catch {
    /* ignore parse / storage errors */
  }
  const glob = (window as any).__VENUEOS_SCREEN_ID__;
  if (typeof glob === 'string' && glob) return glob;
  return null;
}

/** Resolve the device JWT. Mirrors the player's own getDeviceToken()
 *  precedence (URL `?token=` → localStorage) so the two never disagree. */
export function resolveDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = getQueryParam('token');
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(LS_DEVICE_TOKEN);
  } catch {
    return null;
  }
}

/** Are we running as a real device (have both a screenId and a device
 *  JWT)? If not, the widget should use the session/dashboard path. */
export function hasDeviceContext(): boolean {
  return !!resolvePlayerScreenId() && !!resolveDeviceToken();
}

function getApiRoot(): string {
  // Mirror the player's getApiRoot(): prefer the configured public API
  // URL, else same-origin (dev). Trim a trailing slash so we can append
  // a path cleanly.
  const fromEnv =
    (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_API_URL) || '';
  const root = fromEnv || (typeof window !== 'undefined' ? window.location.origin : '');
  return root.replace(/\/$/, '');
}

function mapRawItems(rows: RawMenuItem[], opts?: { keepUnavailable?: boolean }): MenuBoardItem[] {
  const keepUnavailable = opts?.keepUnavailable === true;
  const fmtCents = (c: number) => `$${(c / 100).toFixed(2)}`;
  return rows
    .filter((r) => r && (r.name ?? '').toString().trim().length > 0)
    // Normally drop 86'd items (the endpoint already does). When the caller
    // asked for them (includeUnavailable) keep them so the board can grey
    // them out — they carry `available:false`.
    .filter((r) => keepUnavailable || r.available !== false)
    .map((r) => {
      // Price: prefer the server's pre-formatted string; else format
      // cents (sale price wins when present + lower).
      let price = '';
      if (typeof r.price === 'string' && r.price.trim()) {
        price = r.price.trim();
      } else if (typeof r.salePriceCents === 'number' && r.salePriceCents >= 0 &&
                 (typeof r.priceCents !== 'number' || r.salePriceCents < r.priceCents)) {
        price = fmtCents(r.salePriceCents);
      } else if (typeof r.priceCents === 'number' && r.priceCents >= 0) {
        price = fmtCents(r.priceCents);
      }
      // Size/option variants → pre-formatted price strings.
      const variants = Array.isArray(r.variants)
        ? r.variants
            .map((v) => {
              const label = String(v?.label ?? '').trim();
              let vp = '';
              if (typeof v?.price === 'string' && v.price.trim()) vp = v.price.trim();
              else if (typeof v?.priceCents === 'number' && v.priceCents >= 0) vp = fmtCents(v.priceCents);
              return label && vp ? { label, price: vp } : null;
            })
            .filter((x): x is { label: string; price: string } => x != null)
        : undefined;
      return {
        name: String(r.name),
        desc: r.description ?? r.desc ?? undefined,
        price,
        dietary: Array.isArray(r.badges) ? r.badges : (Array.isArray(r.dietary) ? r.dietary : undefined),
        emoji: r.emoji ?? undefined,
        available: r.available,
        ...(variants && variants.length ? { variants } : {}),
      } as MenuBoardItem;
    });
}

export interface FetchMenuOptions {
  /** Optional category filter (matches MenuBoardWidget's posCategory). */
  category?: string;
  /** Abort signal so the polling loop can cancel an in-flight request. */
  signal?: AbortSignal;
  /** Include 86'd / sold-out items (flagged available:false) instead of
   *  dropping them — used by fixed-slot HTML boards that grey them out. */
  includeUnavailable?: boolean;
}

/**
 * Fetch the live menu for THIS device.
 *
 * On a real player: `GET /api/v1/screens/:id/menu` with the device JWT
 * (location-resolved server-side). On the dashboard preview (no device
 * context): falls back to the legacy session-authed `/pos/items`, which
 * `apiFetchFallback` is responsible for (we inject it to avoid a hard
 * dependency cycle with api-client and to keep this module player-safe).
 *
 * Returns null on any failure / empty result so the widget keeps its
 * existing "never render blank → DEMO_ITEMS" behavior.
 */
export async function fetchDeviceMenu(
  opts: FetchMenuOptions,
  apiFetchFallback: (path: string, init?: { signal?: AbortSignal }) => Promise<any>,
): Promise<MenuBoardItem[] | null> {
  const screenId = resolvePlayerScreenId();
  const deviceToken = resolveDeviceToken();

  // ── Player path: device-authed /screens/:id/menu ──
  if (screenId && deviceToken) {
    try {
      const params = new URLSearchParams();
      if (opts.category) params.set('category', opts.category);
      if (opts.includeUnavailable) params.set('includeUnavailable', '1');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const url = `${getApiRoot()}/api/v1/screens/${encodeURIComponent(screenId)}/menu${qs}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${deviceToken}` },
        cache: 'no-store',
        signal: opts.signal,
      });
      if (res.ok) {
        const body = await res.json();
        // Accept either a bare array OR { items: [...] } so we match
        // whichever envelope the API agent ships.
        const rows: RawMenuItem[] = Array.isArray(body)
          ? body
          : Array.isArray(body?.items)
            ? body.items
            : [];
        const mapped = mapRawItems(rows, { keepUnavailable: !!opts.includeUnavailable });
        return mapped.length > 0 ? mapped : null;
      }
      // 404 = endpoint not deployed yet (API agent's work not merged) OR
      // this screen has no menu bound. Either way, fall through to the
      // session path so the dashboard preview still works; on a real
      // player with no session there's nothing more to try → null.
      if (res.status !== 404) return null;
    } catch {
      // Network error / aborted — let the caller keep the last good list.
      return null;
    }
  }

  // ── Dashboard-preview path: legacy session-authed /pos/items ──
  try {
    const path = opts.category
      ? `/pos/items?category=${encodeURIComponent(opts.category)}`
      : '/pos/items';
    const rows = await apiFetchFallback(path, { signal: opts.signal });
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const mapped = mapRawItems(rows as RawMenuItem[]);
    return mapped.length > 0 ? mapped : null;
  } catch {
    return null;
  }
}

/** Poll interval for live menu re-render. Menus are not life-safety;
 *  a 30s cadence is snappy enough (competitors' "instant" is a few
 *  seconds in practice — see 02-competitor-architecture.md) and keeps
 *  fleet request volume sane. */
export const MENU_POLL_INTERVAL_MS = 30_000;
