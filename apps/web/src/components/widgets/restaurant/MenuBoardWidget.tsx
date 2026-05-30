'use client';
// 2026-05-03 — POS sync: when `config.posSync` is true the widget
// fetches items live from the connected POS (optionally filtered by
// `config.posCategory`) instead of using static config. Falls through
// to static items / DEMO_ITEMS if the fetch fails or returns empty so
// the widget NEVER renders blank even when the POS is unhealthy.
//
// 2026-05-29 — TIER-0 FIX (docs/research/2026-05-29-menu-mgmt-scale/
// 01-codebase-reality.md). This widget is PLAYER-SHIPPED. The old hook
// called the session-authed `/pos/items` with the user JWT — which a
// real Pi/kiosk doesn't have (it holds a DEVICE token with no role) →
// 403 → DEMO_ITEMS on every actual wall. Now it reads the device-authed
// `GET /screens/:id/menu` (location-resolved server-side) when running
// on a player, and falls back to the session `/pos/items` only for the
// dashboard preview. It also re-renders on a poll instead of the old
// one-shot useEffect, so a price change / 86 reaches the wall live.
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  fetchDeviceMenu,
  MENU_POLL_INTERVAL_MS,
} from '@/lib/menu/device-menu';

/**
 * MenuBoardWidget — multi-column QSR / counter-service menu.
 *
 * Optimized for legibility from across a counter — bold display type,
 * appetizing palette (deep cream / charcoal / mustard accents), and
 * dietary chips so allergens are visible at a glance.
 *
 * Layout: column header strip on top, then a flex-row of N columns;
 * each column is a stack of menu items (name / desc / price / dietary
 * chips). When no items are configured a demo menu renders so the
 * widget never looks empty in the gallery preview.
 *
 * Defensive notes:
 *   • Accepts `config.items` as an array OR a JSON string (some
 *     legacy editors may serialize). The string path is parsed
 *     with try/catch — silent fallback to demo on parse failure.
 *   • `columns` is clamped to [1..5] so a misconfigured value can't
 *     render zero columns.
 *
 * Widget type: RESTAURANT_MENU_BOARD
 */

export interface MenuBoardItem {
  name: string;
  desc?: string;
  price: string;            // free-form string, e.g. "$8.99", "12 / 16"
  dietary?: string[];       // tags like 'V', 'GF', 'DF', 'spicy'
  emoji?: string;           // optional fallback when no image
  /** Asset URL for a dish photo. When set, shown as a small thumbnail
   *  left of the name (replaces the emoji glyph). */
  imageUrl?: string;
}

export interface MenuBoardConfig {
  /** Section title shown above the columns. */
  title?: string;
  /** Subtitle / tagline shown beneath the title. */
  subtitle?: string;
  /** 1-5 columns. Default 3. */
  columns?: number;
  /** Items array. Each renders inside the next column round-robin. */
  items?: MenuBoardItem[];
  /** Mustard / caramel accent color. */
  accentColor?: string;
  /** Background color override; default cream. */
  bgColor?: string;
  /** Color theme: cream/dark/charcoal */
  theme?: 'cream' | 'charcoal' | 'red';
  /** When true, fetch live items from the connected POS instead of
   *  using `items` above. Falls back to static items on error. */
  posSync?: boolean;
  /** Optional category filter when posSync is true (e.g. "Burgers"). */
  posCategory?: string;
  /** Cap how many items to display; default 12 (4 cols × 3 rows). */
  maxItems?: number;
}

const DEMO_ITEMS: MenuBoardItem[] = [
  { name: 'Classic Cheeseburger', desc: '1/3 lb angus, american cheese, house pickles', price: '$8.99', dietary: [], emoji: '🍔' },
  { name: 'Bacon Smash',          desc: 'double smash, applewood bacon, special sauce',   price: '$10.49', dietary: [], emoji: '🥓' },
  { name: 'Crispy Chicken',       desc: 'buttermilk-brined breast, slaw, brioche bun',     price: '$9.49', dietary: [], emoji: '🍗' },
  { name: 'Veggie Black Bean',    desc: 'house-made patty, avocado, chipotle aioli',       price: '$8.99', dietary: ['V'], emoji: '🥑' },
  { name: 'Sea Salt Fries',       desc: 'hand-cut, fried twice, flaky sea salt',           price: '$3.49', dietary: ['V', 'GF'], emoji: '🍟' },
  { name: 'Onion Rings',          desc: 'beer-battered, served with house ranch',          price: '$4.49', dietary: ['V'], emoji: '🧅' },
  { name: 'Fountain Soda',        desc: 'free refills, 22oz cup',                          price: '$2.79', dietary: ['V', 'GF'], emoji: '🥤' },
  { name: 'Chocolate Shake',      desc: 'hand-spun, real ice cream',                       price: '$4.99', dietary: [], emoji: '🥛' },
  { name: 'Strawberry Lemonade',  desc: 'fresh-squeezed, muddled berries',                 price: '$3.49', dietary: ['V', 'GF'], emoji: '🍋' },
];

function normalizeItems(input: unknown): MenuBoardItem[] {
  if (Array.isArray(input)) return input as MenuBoardItem[];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed as MenuBoardItem[];
    } catch {
      /* fall through */
    }
  }
  return DEMO_ITEMS;
}

export function MenuBoardWidget({
  config,
  live: _live,
}: {
  config?: MenuBoardConfig;
  live?: boolean;
}) {
  const c: MenuBoardConfig = config || {};
  const accent = c.accentColor || '#e8b94a';
  const theme = c.theme || 'cream';
  const themeBg =
    theme === 'charcoal' ? '#1a1714' :
    theme === 'red'      ? '#7a1f1f' :
                           '#fbf6ee';
  const bg = c.bgColor || themeBg;
  const ink = theme === 'cream' ? '#1a1714' : '#fbf6ee';
  const subInk = theme === 'cream' ? 'rgba(26,23,20,0.7)' : 'rgba(251,246,238,0.75)';
  const colCount = Math.max(1, Math.min(5, c.columns || 3));
  // POS-synced live items override the static config when posSync is on.
  // Hook only fires when the flag is set so the widget stays SSR-safe
  // for static templates.
  const posItems = usePosMenuItems(!!c.posSync, c.posCategory);
  const items = (c.posSync && posItems && posItems.length > 0)
    ? posItems.slice(0, c.maxItems || 12)
    : normalizeItems(c.items).slice(0, c.maxItems || 12);
  const title = c.title || 'OUR MENU';
  const subtitle = c.subtitle || 'made fresh daily';

  // Distribute items round-robin into N columns so each column has
  // roughly equal length even when total items don't divide evenly.
  const columns: MenuBoardItem[][] = Array.from({ length: colCount }, () => []);
  items.forEach((it, i) => {
    columns[i % colCount].push(it);
  });

  return (
    <div className="rmb-root" style={{ background: bg, color: ink, ['--rmb-accent' as string]: accent } as React.CSSProperties}>
      <style>{CSS}</style>

      <div className="rmb-header">
        <div className="rmb-rule" aria-hidden />
        <div className="rmb-title">{title}</div>
        <div className="rmb-subtitle" style={{ color: subInk }}>{subtitle}</div>
        <div className="rmb-rule" aria-hidden />
      </div>

      <div className="rmb-columns" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
        {columns.map((colItems, ci) => (
          <div key={ci} className="rmb-col">
            {colItems.map((item, ii) => (
              <div key={ii} className="rmb-item">
                <div className="rmb-item-row">
                  <div className="rmb-item-name">
                    {/* imageUrl takes priority; fall back to emoji if it looks like
                        a URL (the PropertiesPanel 'image' type writes asset URLs to
                        the `emoji` key for back-compat), then fall back to the raw
                        emoji glyph. */}
                    {(item.imageUrl || (item.emoji && item.emoji.startsWith('http'))) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="rmb-item-thumb"
                        src={item.imageUrl || item.emoji}
                        alt=""
                        aria-hidden
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : item.emoji ? (
                      <span className="rmb-item-emoji" aria-hidden>{item.emoji}</span>
                    ) : null}
                    <span>{item.name}</span>
                  </div>
                  <div className="rmb-item-price">{item.price}</div>
                </div>
                {item.desc && (
                  <div className="rmb-item-desc" style={{ color: subInk }}>{item.desc}</div>
                )}
                {item.dietary && item.dietary.length > 0 && (
                  <div className="rmb-chips">
                    {item.dietary.map((d, k) => (
                      <span key={k} className="rmb-chip">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600;700&display=swap');

.rmb-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; flex-direction: column;
  padding: clamp(14px, 2.5cqh, 36px) clamp(18px, 3cqw, 48px);
}

.rmb-header {
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(4px, 0.6cqh, 10px);
  margin-bottom: clamp(10px, 2cqh, 24px);
}
.rmb-rule {
  width: clamp(60px, 18cqw, 220px);
  height: 3px;
  background: var(--rmb-accent, #e8b94a);
  border-radius: 99px;
}
.rmb-title {
  font-family: 'Bebas Neue', 'Playfair Display', serif;
  font-weight: 900;
  letter-spacing: 0.08em;
  font-size: clamp(22px, 7cqh, 78px);
  line-height: 1;
  text-transform: uppercase;
}
.rmb-subtitle {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-size: clamp(12px, 1.8cqh, 22px);
  letter-spacing: 0.05em;
}

.rmb-columns {
  flex: 1;
  display: grid;
  gap: clamp(14px, 2.4cqw, 36px);
  min-height: 0;
}
.rmb-col {
  display: flex; flex-direction: column;
  /* Distribute items down the full column height so a short menu
     fills the 1080px canvas instead of clumping at the top with a
     dead band beneath it. */
  justify-content: space-between;
  gap: clamp(8px, 1.6cqh, 18px);
  min-height: 0;
  overflow: hidden;
}

.rmb-item {
  display: flex; flex-direction: column;
  justify-content: center;
  flex: 0 1 auto;
  gap: clamp(2px, 0.4cqh, 5px);
  padding-bottom: clamp(6px, 1.2cqh, 12px);
  border-bottom: 1px dashed currentColor;
  border-color: rgba(0,0,0,0.1);
}
.rmb-item:last-child { border-bottom: none; padding-bottom: 0; }
.rmb-item-row {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: clamp(8px, 1.4cqw, 18px);
}
.rmb-item-name {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(13px, 2.2cqh, 26px);
  letter-spacing: -0.01em;
  display: inline-flex; align-items: baseline; gap: clamp(4px, 0.7cqw, 9px);
  flex: 1; min-width: 0;
}
.rmb-item-emoji {
  font-size: clamp(14px, 2.4cqh, 28px);
  line-height: 1;
}
.rmb-item-thumb {
  /* em-based (scales with item text), NOT cqh — Chromium-83/Taurus has no
     container queries, and the taurus-safety gate only ratchets cq DOWN. */
  width: clamp(22px, 2.2em, 40px);
  height: clamp(22px, 2.2em, 40px);
  object-fit: cover;
  border-radius: clamp(3px, 0.3em, 6px);
  flex-shrink: 0;
}
.rmb-item-price {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(15px, 2.6cqh, 32px);
  color: var(--rmb-accent, #e8b94a);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.rmb-item-desc {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: clamp(10px, 1.5cqh, 16px);
  line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rmb-chips {
  display: flex; flex-wrap: wrap; gap: clamp(3px, 0.5cqw, 6px);
}
.rmb-chip {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(8px, 1cqh, 11px);
  letter-spacing: 0.1em;
  padding: clamp(1px, 0.3cqh, 3px) clamp(5px, 0.8cqw, 9px);
  border-radius: 99px;
  border: 1px solid currentColor;
  text-transform: uppercase;
  opacity: 0.8;
}
`;

// 2026-05-29 — POS-sync hook, rebuilt for the live multi-location menu
// platform. When `enabled` (config.posSync) is true it fetches the
// menu via `fetchDeviceMenu`:
//   • On a real player (device token + screenId resolvable) → the
//     device-authed `GET /screens/:id/menu`, which the server resolves
//     to THIS screen's location (per-location prices + auto-86 applied
//     server-side). This is the path that was 403-ing before.
//   • On the dashboard preview (user session, no device token) → the
//     legacy `/pos/items` so editing + preview stay unchanged.
// It RE-RENDERS on a poll (every MENU_POLL_INTERVAL_MS) so a price edit
// or an 86 reaches the wall without a manual refresh. On any error it
// KEEPS the last good list (or null → caller falls back to static /
// DEMO_ITEMS) so the board never flashes blank mid-service.
function usePosMenuItems(enabled: boolean, category?: string): MenuBoardItem[] | null {
  const [items, setItems] = useState<MenuBoardItem[] | null>(null);
  // Tracks whether we've EVER loaded a real list this mount. Using a ref
  // (not the `items` state) avoids a stale-closure trap inside the poll
  // loop: every tick must see the live "have we loaded?" value, not the
  // value captured when the effect first ran.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
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
        (path, init) => apiFetch<any[]>(path, init as any),
      );
      if (cancelled) return;
      if (next && next.length > 0) {
        // Got a real list → render it.
        hasLoadedRef.current = true;
        setItems(next);
      } else if (!hasLoadedRef.current) {
        // FIRST load failed → null so the caller uses static / DEMO items.
        // (Once we've loaded once, a transient null is IGNORED — we keep
        // the last good menu on screen instead of blanking mid-service.)
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

