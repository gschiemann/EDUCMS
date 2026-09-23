'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { fetchDeviceMenu, MENU_POLL_INTERVAL_MS } from './device-menu';

/**
 * PosMenuItem — the lowest-common-denominator shape every menu / drink
 * board can render from a live POS feed (name + price, plus an optional
 * description / dietary tags / photo). Restaurant menu boards, bar tap
 * lists, and cocktail menus each map their richer static item shapes
 * onto this when "Driven by POS" is on (template meta.dataSource ===
 * 'POS' → widget config.posSync = true).
 */
export interface PosMenuItem {
  externalId?: string;
  category?: string;
  name: string;
  desc?: string;
  price: string;
  dietary?: string[];
  emoji?: string;
  imageUrl?: string;
  /** false = 86'd / sold out today (only set when fetched with
   *  includeUnavailable) — lets a board grey the item out. */
  available?: boolean;
  /** Pre-formatted size/option price variants (SM/MED/LG, etc.). */
  variants?: { label: string; price: string }[];
}

/**
 * usePosMenuItems — the ONE shared live-POS menu feed every menu / drink
 * widget consumes. Extracted from MenuBoardWidget 2026-05-30 for the
 * Phase-2 field-mapping work so tap lists + cocktail menus read the SAME
 * live feed the menu board already did (instead of each widget hand-
 * rolling its own poll).
 *
 * When `enabled` (the widget's config.posSync, set by the template-level
 * "Driven by: POS" picker) is true it polls fetchDeviceMenu:
 *   • Real player (device token + screenId resolvable) → the device-authed
 *     GET /screens/:id/menu, which the server resolves to THIS screen's
 *     location (per-location prices + auto-86 applied server-side).
 *   • Dashboard preview (user session, no device token) → the legacy
 *     /pos/items so editing + preview stay unchanged.
 *
 * Re-renders on a poll (every MENU_POLL_INTERVAL_MS) so a price edit or
 * an 86 reaches the wall without a manual refresh. On any error it KEEPS
 * the last good list (never blanks mid-service); only a FIRST-load
 * failure returns null so the caller falls back to its static items.
 */
export function usePosMenuItems(
  enabled: boolean,
  category?: string,
  opts?: { includeUnavailable?: boolean; connectionId?: string; providerId?: string },
): PosMenuItem[] | null {
  const [items, setItems] = useState<PosMenuItem[] | null>(null);
  // Ref (not state) so the poll loop always sees the live "have we ever
  // loaded?" value, never a stale closure from the first effect run.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    // Intentional synchronous reset when the feed is turned off (posSync
    // → false): drop any live items so the widget falls back to its static
    // list immediately. Faithful to the shipped MenuBoard pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!enabled) { setItems(null); hasLoadedRef.current = false; return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const tick = async () => {
      controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const next = await fetchDeviceMenu(
        { category, signal: controller?.signal, includeUnavailable: opts?.includeUnavailable, connectionId: opts?.connectionId, providerId: opts?.providerId },
        // Session fallback for the dashboard preview path. `apiFetch`
        // attaches the user JWT + CSRF; device-menu never uses it on a
        // real player (no session there).
        (path, init) => apiFetch<unknown[]>(path, init as Parameters<typeof apiFetch>[1]),
      );
      if (cancelled) return;
      // 2026-09-11 — an EMPTY result is data, a NULL is a failure. This used
      // to gate on `next.length > 0`, so a category whose every item had been
      // removed or sold out looked exactly like a dropped connection and the
      // board kept showing the old items, with their prices, indefinitely.
      if (Array.isArray(next)) {
        // Success — including an empty menu, which must CLEAR the old list.
        hasLoadedRef.current = true;
        setItems(next as PosMenuItem[]);
      } else if (!hasLoadedRef.current) {
        // First load failed → null so the caller uses its static items.
        // Once we have loaded once, a transient FAILURE is ignored: keep the
        // last good menu on screen rather than blanking mid-service.
        setItems(null);
      }
      if (!cancelled) {
        timer = setTimeout(tick, MENU_POLL_INTERVAL_MS);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { controller?.abort(); } catch { /* noop */ }
    };
  }, [enabled, category, opts?.includeUnavailable, opts?.connectionId, opts?.providerId]);
  return items;
}
