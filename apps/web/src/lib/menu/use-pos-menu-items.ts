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
  name: string;
  desc?: string;
  price: string;
  dietary?: string[];
  emoji?: string;
  imageUrl?: string;
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
export function usePosMenuItems(enabled: boolean, category?: string): PosMenuItem[] | null {
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
        { category, signal: controller?.signal },
        // Session fallback for the dashboard preview path. `apiFetch`
        // attaches the user JWT + CSRF; device-menu never uses it on a
        // real player (no session there).
        (path, init) => apiFetch<unknown[]>(path, init as Parameters<typeof apiFetch>[1]),
      );
      if (cancelled) return;
      if (next && next.length > 0) {
        hasLoadedRef.current = true;
        setItems(next as PosMenuItem[]);
      } else if (!hasLoadedRef.current) {
        // FIRST load failed → null so the caller uses its static items.
        // Once we've loaded once, a transient null is IGNORED — we keep
        // the last good menu on screen instead of blanking mid-service.
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
  }, [enabled, category]);
  return items;
}
