'use client';
// 2026-05-03 — POS sync: when `config.posSync` is true the widget
// fetches items live from /api/v1/pos/items (optionally filtered by
// `config.posCategory`) instead of using static config. Falls through
// to static items / DEMO_ITEMS if the fetch fails or returns empty so
// the widget NEVER renders blank even when the POS is unhealthy.
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

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
                    {item.emoji && <span className="rmb-item-emoji" aria-hidden>{item.emoji}</span>}
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
  gap: clamp(8px, 1.6cqh, 18px);
  overflow: hidden;
}

.rmb-item {
  display: flex; flex-direction: column;
  gap: clamp(2px, 0.4cqh, 5px);
  padding-bottom: clamp(6px, 1.2cqh, 12px);
  border-bottom: 1px dashed currentColor;
  border-color: rgba(0,0,0,0.1);
}
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

// 2026-05-03 — POS-sync hook. When `enabled` (config.posSync) is true,
// fetches /api/v1/pos/items optionally filtered by category. Returns
// an array of MenuBoardItems mapped from PosMenuItem rows. Returns
// null on error / loading so the caller falls back to static items.
function usePosMenuItems(enabled: boolean, category?: string): MenuBoardItem[] | null {
  const [items, setItems] = useState<MenuBoardItem[] | null>(null);
  useEffect(() => {
    if (!enabled) { setItems(null); return; }
    let cancelled = false;
    const path = category ? `/pos/items?category=${encodeURIComponent(category)}` : "/pos/items";
    apiFetch<any[]>(path).then((rows) => {
      if (cancelled) return;
      if (!Array.isArray(rows) || rows.length === 0) { setItems(null); return; }
      const mapped: MenuBoardItem[] = rows.map((r) => ({
        name: r.name,
        desc: r.description,
        price: `$${(r.priceCents / 100).toFixed(2)}`,
        dietary: r.badges,
      }));
      setItems(mapped);
    }).catch(() => { if (!cancelled) setItems(null); });
    return () => { cancelled = true; };
  }, [enabled, category]);
  return items;
}

