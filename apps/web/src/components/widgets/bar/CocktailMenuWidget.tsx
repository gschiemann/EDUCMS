'use client';

/**
 * CocktailMenuWidget — chalkboard-style cocktail list for a bar.
 *
 * Mood: a slate behind the bar, hand-drawn names in cream chalk, the
 * occasional doodle, prices in a different chalk color. The vibe is
 * craft cocktail lounge — not a dive bar's marker board, but a
 * speakeasy / mezcal joint where every drink has a story.
 *
 * Uses the Caveat / Permanent Marker / Special Elite Google Fonts
 * to fake handwritten chalk strokes, plus a noise overlay for the
 * slate texture. SVG flourishes between sections.
 *
 * Widget type: BAR_COCKTAIL_MENU
 */

import { usePosMenuItems } from '@/lib/menu/use-pos-menu-items';

export interface BarCocktail {
  /** Cocktail name — the "headline" line in the menu. */
  name: string;
  /** Free-form ingredients string — e.g. "Bourbon · Vermouth · Bitters" */
  ingredients?: string;
  /** Description / tasting note. Optional, italicized. */
  note?: string;
  /** Price string — formatted by operator. e.g. "$14" */
  price?: string;
  /** Garnish or glass — small label. e.g. "Coupe", "Smoked Rosemary" */
  garnish?: string;
  /** Mark this cocktail with the bartender-recommended star. */
  featured?: boolean;
}

export interface CocktailMenuConfig {
  cocktails?: BarCocktail[];
  /** Top of the menu — defaults to "COCKTAILS" */
  title?: string;
  /** Sub-title under the title. Default "HOUSE & CLASSICS" */
  subtitle?: string;
  /** Footer flourish line. Default "Ask your bartender." */
  footer?: string;
  /** Number of columns. 1 / 2. Default 2. */
  columns?: 1 | 2;
  /** When true, pull live cocktails from the connected POS instead of the
   *  static `cocktails` above (set by the template "Driven by: POS"
   *  picker). Falls back to static on error / before first load. */
  posSync?: boolean;
  /** Optional POS category filter when posSync is on (e.g. "Cocktails"). */
  posCategory?: string;
}

const DEMO_COCKTAILS: BarCocktail[] = [
  { name: 'Old Fashioned',     ingredients: 'Rye · Demerara · Angostura', note: 'Stirred · orange peel',                price: '$14', garnish: 'Coupe', featured: true },
  { name: 'Negroni',           ingredients: 'Gin · Campari · Sweet Vermouth', note: 'Equal parts · stirred',           price: '$13' },
  { name: 'Espresso Martini',  ingredients: 'Vodka · Cold Brew · Coffee Liqueur', note: 'Shaken hard · froth crown',  price: '$15', featured: true },
  { name: 'Paper Plane',       ingredients: 'Bourbon · Aperol · Amaro · Lemon', note: 'Citrus forward',                price: '$14' },
  { name: 'Mezcal Last Word',  ingredients: 'Mezcal · Chartreuse · Maraschino · Lime', note: 'Smoky riff on a classic', price: '$15' },
  { name: 'French 75',         ingredients: 'Gin · Lemon · Champagne · Sugar', note: 'Effervescent · flute',           price: '$16' },
  { name: 'Penicillin',        ingredients: 'Scotch · Honey-Ginger · Lemon', note: 'Smoke float · candied ginger',     price: '$15' },
  { name: 'Whiskey Sour',      ingredients: 'Bourbon · Lemon · Sugar · Egg White', note: 'Velvet foam · luxardo',     price: '$13' },
];

export function CocktailMenuWidget({
  config,
  live: _live,
}: {
  config?: CocktailMenuConfig;
  live?: boolean;
}) {
  const c: CocktailMenuConfig = config || {};
  const title = c.title || 'COCKTAILS';
  const subtitle = c.subtitle || 'House & Classics';
  const footer = c.footer || 'Ask your bartender.';
  const columns = c.columns ?? 2;

  // Live POS feed (shared hook). When the template is "Driven by: POS"
  // (posSync on), map each POS item onto the cocktail shape — name + price
  // are 1:1; the item description becomes the ingredients line.
  const posItems = usePosMenuItems(!!c.posSync, c.posCategory);
  const liveCocktails: BarCocktail[] | null =
    c.posSync && posItems && posItems.length > 0
      ? posItems.map((it) => ({ name: it.name, price: it.price, ingredients: it.desc }))
      : null;
  const cocktails = liveCocktails ?? ((c.cocktails && c.cocktails.length > 0) ? c.cocktails : DEMO_COCKTAILS);

  return (
    <div className="bcm-root" style={{ '--bcm-cols': String(columns) } as React.CSSProperties}>
      <style>{CSS}</style>

      {/* Slate texture stack */}
      <div className="bcm-slate" />
      <div className="bcm-noise" aria-hidden />
      <div className="bcm-edge" aria-hidden />

      {/* Header — hand-lettered title with chalk underline */}
      <div className="bcm-header">
        <div className="bcm-title">{title}</div>
        <svg className="bcm-flourish" viewBox="0 0 200 12" aria-hidden>
          <path
            d="M5 6 Q 50 1 100 6 T 195 6"
            stroke="#fef3c7"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            opacity="0.9"
          />
          <circle cx="100" cy="6" r="2" fill="#f59e0b" />
        </svg>
        <div className="bcm-subtitle">{subtitle}</div>
      </div>

      {/* Cocktail grid — chalkboard menu rows */}
      <div className="bcm-grid">
        {cocktails.map((c, i) => (
          <div key={i} className={'bcm-item' + (c.featured ? ' bcm-item--featured' : '')}>
            <div className="bcm-item-head">
              <div className="bcm-item-name">
                {c.featured && <span className="bcm-star" aria-hidden>★</span>}
                {c.name}
              </div>
              <div className="bcm-item-dots" aria-hidden />
              {c.price && <div className="bcm-item-price">{c.price}</div>}
            </div>
            {c.ingredients && (
              <div className="bcm-item-ing">{c.ingredients}</div>
            )}
            {c.note && (
              <div className="bcm-item-note">{c.note}</div>
            )}
            {c.garnish && (
              <div className="bcm-item-garnish">{c.garnish}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer flourish */}
      <div className="bcm-footer">
        <span className="bcm-footer-flourish" aria-hidden>~</span>
        <span>{footer}</span>
        <span className="bcm-footer-flourish" aria-hidden>~</span>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;600;700&family=Permanent+Marker&family=Special+Elite&family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&display=swap');

.bcm-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: #fef3c7;
  font-family: 'Caveat', cursive;
  container-type: size;
  padding: clamp(16px, 3cqh, 36px);
  box-sizing: border-box;
  display: flex; flex-direction: column;
}

/* ─── Slate texture ─── */
.bcm-slate {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background:
    radial-gradient(900px 500px at 30% 20%, rgba(255,255,255,0.04), transparent 60%),
    radial-gradient(700px 400px at 80% 90%, rgba(255,255,255,0.03), transparent 60%),
    linear-gradient(160deg, #1c1917 0%, #1f1d1b 50%, #1a1916 100%);
}
.bcm-noise {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1;
  pointer-events: none;
  opacity: 0.18;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.7'/></svg>");
  mix-blend-mode: overlay;
}
.bcm-edge {
  position: absolute; top: clamp(8px, 1.5cqh, 18px); right: clamp(8px, 1.5cqh, 18px); bottom: clamp(8px, 1.5cqh, 18px); left: clamp(8px, 1.5cqh, 18px); z-index: 2;
  pointer-events: none;
  border: 2px solid rgba(254, 243, 199, 0.18);
  border-radius: 4px;
  box-shadow: inset 0 0 60px rgba(0,0,0,0.4);
}

/* ─── Header ─── */
.bcm-header {
  position: relative; z-index: 10;
  flex: 0 0 auto;
  display: flex; flex-direction: column; align-items: center;
  margin-bottom: clamp(8px, 2cqh, 18px);
}
.bcm-title {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(28px, 6cqh, 64px);
  color: #fef3c7;
  letter-spacing: 0.08em;
  text-shadow:
    0 0 20px rgba(254,243,199,0.18),
    1px 1px 0 rgba(0,0,0,0.4);
  /* Permanent Marker's glyphs ride above the cap line; line-height:1
     inside an overflow:hidden root clipped the top of the title.
     A touch more leading + padding gives the strokes room. */
  line-height: 1.18;
  padding-top: 0.08em;
}
.bcm-flourish {
  width: clamp(140px, 30cqw, 320px);
  height: clamp(8px, 1.4cqh, 14px);
  margin: clamp(4px, 0.8cqh, 8px) 0;
}
.bcm-subtitle {
  font-family: 'Caveat', cursive;
  font-weight: 600;
  font-size: clamp(13px, 2cqh, 22px);
  color: #fbbf24;
  letter-spacing: 0.06em;
  font-style: italic;
}

/* ─── Cocktail grid ─── */
.bcm-grid {
  position: relative; z-index: 10;
  flex: 1 1 0; min-height: 0;
  display: grid;
  grid-template-columns: repeat(var(--bcm-cols, 2), minmax(0, 1fr));
  /* Equal-height rows that grow to fill the slate height so a short
     list doesn't bunch at the top and leave the chalkboard half-empty. */
  grid-auto-rows: minmax(0, 1fr);
  gap: clamp(6px, 1.4cqh, 14px) clamp(20px, 4cqw, 50px);
  align-content: stretch;
}

/* ─── Cocktail item ─── */
.bcm-item {
  position: relative;
  font-family: 'Caveat', cursive;
  display: flex; flex-direction: column; justify-content: center;
  min-height: 0; overflow: hidden;
  padding: clamp(2px, 0.4cqh, 5px) 0;
}
.bcm-item--featured .bcm-item-name {
  color: #fde68a;
}

.bcm-item-head {
  display: flex; align-items: baseline; gap: clamp(6px, 1.2cqw, 12px);
}
.bcm-item-name {
  font-family: 'Caveat', cursive;
  font-weight: 700;
  font-size: clamp(16px, 2.6cqh, 28px);
  color: #fef3c7;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 70%;
  display: inline-flex;
  align-items: baseline;
  gap: clamp(4px, 0.8cqw, 8px);
}
.bcm-star {
  color: #fbbf24;
  font-size: clamp(13px, 2cqh, 20px);
  text-shadow: 0 0 10px rgba(251,191,36,0.6);
}
.bcm-item-dots {
  flex: 1;
  border-bottom: 2px dotted rgba(254, 243, 199, 0.35);
  height: clamp(6px, 1cqh, 10px);
  align-self: end;
  margin: 0 clamp(3px, 0.6cqw, 6px);
}
.bcm-item-price {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(15px, 2.4cqh, 24px);
  color: #fbbf24;
  text-shadow: 0 0 10px rgba(251,191,36,0.4);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.bcm-item-ing {
  font-family: 'Special Elite', monospace;
  font-size: clamp(10px, 1.45cqh, 13px);
  color: #d6d3d1;
  letter-spacing: 0.02em;
  margin-top: 2px;
  margin-left: clamp(4px, 0.8cqw, 8px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bcm-item-note {
  font-family: 'Cormorant Garamond', serif;
  font-style: italic;
  font-size: clamp(10px, 1.5cqh, 13px);
  color: #fbbf24;
  margin-top: 1px;
  margin-left: clamp(4px, 0.8cqw, 8px);
  opacity: 0.78;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bcm-item-garnish {
  display: inline-block;
  font-family: 'Caveat', cursive;
  font-size: clamp(9px, 1.3cqh, 12px);
  color: #1c1917;
  background: #fde68a;
  padding: 1px clamp(5px, 1cqw, 10px);
  border-radius: 99px;
  margin-top: 4px;
  margin-left: clamp(4px, 0.8cqw, 8px);
  letter-spacing: 0.04em;
  font-weight: 600;
  transform: rotate(-1.5deg);
}

/* ─── Footer ─── */
.bcm-footer {
  position: relative;
  flex: 0 0 auto;
  z-index: 10;
  margin-top: 12px;
  display: flex; align-items: center; justify-content: center;
  gap: clamp(6px, 1.2cqw, 14px);
  font-family: 'Caveat', cursive;
  font-size: clamp(11px, 1.7cqh, 16px);
  color: #94a3b8;
  font-style: italic;
  letter-spacing: 0.04em;
}
.bcm-footer-flourish {
  color: #fbbf24;
  opacity: 0.7;
}
`;
