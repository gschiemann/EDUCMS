'use client';

/**
 * TapListWidget — beer-on-tap menu for a bar / taproom display.
 *
 * Designed to be readable from across a noisy bar room. Big numbered
 * tap handles down the side, brewery + style + ABV laid out so the
 * customer can scan price + IBU at a glance. Up to 16 taps; renders
 * in 1 / 2 / 3 columns based on the column count config.
 *
 * Visual DNA: charcoal background, amber neon accents (think the
 * stained glass in a craft taproom), Bebas-style condensed display
 * for tap names. Each tap gets a colored "handle" indicator so the
 * bartender can match the screen to the actual tap order.
 *
 * Widget type: BAR_TAP_LIST
 */

export interface BarTap {
  /** Beer name — main billing on the tap. e.g. "Pliny the Elder" */
  name: string;
  /** Brewery — small line under the beer name. e.g. "Russian River" */
  brewery?: string;
  /** Style — IPA / Stout / Pilsner / etc. */
  style?: string;
  /** Alcohol By Volume as a number. 5.2 → "5.2%". */
  abv?: number;
  /** International Bittering Units — optional, displayed when present. */
  ibu?: number;
  /** Price per pint as a string so the operator can format ($/€/£). e.g. "$8" */
  price?: string;
  /** Optional hex color for the tap handle. Defaults to a hue derived from
   *  the index so the row is still visually distinguishable. */
  color?: string;
  /** Show a small NEW chip on the tap when true. */
  isNew?: boolean;
}

export interface TapListConfig {
  taps?: BarTap[];
  /** Widget title. Default: "ON TAP" */
  title?: string;
  /** Subtitle. Default: rotating "16 LOCAL CRAFT" type label */
  subtitle?: string;
  /** Number of columns to render. 1 / 2 / 3. Default: 2 */
  columns?: 1 | 2 | 3;
  /** Accent color (neon edge / handle ring). Default: amber #f59e0b */
  accentColor?: string;
}

// ── Demo data — realistic 12-tap craft list, used when config.taps is empty ──
const DEMO_TAPS: BarTap[] = [
  { name: 'Pliny the Elder',       brewery: 'Russian River',     style: 'Double IPA',     abv: 8.0, ibu: 100, price: '$9',  color: '#f59e0b', isNew: true },
  { name: 'Heady Topper',          brewery: 'The Alchemist',     style: 'Hazy DIPA',      abv: 8.0, ibu: 75,  price: '$10', color: '#fbbf24' },
  { name: 'Pilsner Urquell',       brewery: 'Plzeňský Prazdroj', style: 'Czech Pilsner',  abv: 4.4, ibu: 40,  price: '$7',  color: '#facc15' },
  { name: 'Guinness Draught',      brewery: 'Guinness',          style: 'Irish Stout',    abv: 4.2, ibu: 45,  price: '$8',  color: '#1f2937' },
  { name: 'Modelo Especial',       brewery: 'Grupo Modelo',      style: 'Lager',          abv: 4.4, ibu: 18,  price: '$6',  color: '#fde047' },
  { name: 'Sierra Nevada Hazy',    brewery: 'Sierra Nevada',     style: 'New England IPA',abv: 6.7, ibu: 35,  price: '$8',  color: '#fb923c' },
  { name: 'Allagash White',        brewery: 'Allagash',          style: 'Belgian Witbier',abv: 5.2, ibu: 13,  price: '$8',  color: '#fef3c7' },
  { name: 'Founders Porter',       brewery: 'Founders',          style: 'Porter',         abv: 6.5, ibu: 45,  price: '$7',  color: '#7c2d12' },
  { name: 'Stone IPA',             brewery: 'Stone Brewing',     style: 'West Coast IPA', abv: 6.9, ibu: 71,  price: '$8',  color: '#84cc16' },
  { name: 'Westbrook Gose',        brewery: 'Westbrook',         style: 'Gose (sour)',    abv: 4.0, ibu: 5,   price: '$8',  color: '#22d3ee' },
  { name: 'Three Floyds Zombie',   brewery: 'Three Floyds',      style: 'American IPA',   abv: 5.6, ibu: 50,  price: '$8',  color: '#ef4444' },
  { name: 'Goose Island BCBS',     brewery: 'Goose Island',      style: 'Bourbon Stout',  abv:14.5, ibu: 60,  price: '$14', color: '#451a03', isNew: true },
];

function tapHandleColor(index: number, override?: string): string {
  if (override) return override;
  const palette = ['#f59e0b', '#fbbf24', '#fb923c', '#ef4444', '#84cc16', '#22d3ee', '#a855f7', '#ec4899'];
  return palette[index % palette.length];
}

export function TapListWidget({
  config,
  live: _live,
}: {
  config?: TapListConfig;
  live?: boolean;
}) {
  const c: TapListConfig = config || {};
  const accent = c.accentColor || '#f59e0b';
  const title = c.title || 'ON TAP';
  const subtitle = c.subtitle || 'CRAFT & IMPORTS';
  const columns = c.columns || 2;

  const taps = (c.taps && c.taps.length > 0) ? c.taps : DEMO_TAPS;

  return (
    <div
      className="btl-root"
      style={{ '--btl-accent': accent, '--btl-cols': String(columns) } as React.CSSProperties}
    >
      <style>{CSS}</style>

      {/* Background stack */}
      <div className="btl-bg" />
      <div className="btl-glow" />
      <div className="btl-grain" aria-hidden />

      {/* Header bar */}
      <div className="btl-header">
        <div className="btl-title-block">
          <span className="btl-title-icon" aria-hidden>🍺</span>
          <span className="btl-title">{title}</span>
        </div>
        <span className="btl-subtitle">{subtitle}</span>
      </div>

      {/* Tap grid */}
      <div className="btl-grid" role="list">
        {taps.map((tap, i) => {
          const handleColor = tapHandleColor(i, tap.color);
          return (
            <div key={i} className="btl-row" role="listitem">
              {/* Tap number + handle */}
              <div className="btl-tap-num-col">
                <div className="btl-tap-num">{String(i + 1).padStart(2, '0')}</div>
                <div
                  className="btl-handle"
                  style={{ background: handleColor, boxShadow: `0 0 12px ${handleColor}` }}
                  aria-hidden
                />
              </div>

              {/* Beer name + brewery + style */}
              <div className="btl-meta">
                <div className="btl-name">
                  {tap.name}
                  {tap.isNew && <span className="btl-new-chip">NEW</span>}
                </div>
                <div className="btl-sub-row">
                  {tap.brewery && <span className="btl-brewery">{tap.brewery}</span>}
                  {tap.style && (
                    <>
                      {tap.brewery && <span className="btl-dot" aria-hidden>·</span>}
                      <span className="btl-style">{tap.style}</span>
                    </>
                  )}
                </div>
              </div>

              {/* ABV / IBU stats column */}
              <div className="btl-stats">
                {typeof tap.abv === 'number' && (
                  <div className="btl-stat">
                    <span className="btl-stat-num">{tap.abv.toFixed(1)}</span>
                    <span className="btl-stat-label">% ABV</span>
                  </div>
                )}
                {typeof tap.ibu === 'number' && (
                  <div className="btl-stat">
                    <span className="btl-stat-num">{tap.ibu}</span>
                    <span className="btl-stat-label">IBU</span>
                  </div>
                )}
              </div>

              {/* Price chip on the right */}
              {tap.price && (
                <div className="btl-price">{tap.price}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');

.btl-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}

/* ─── Background ─── */
.btl-bg {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background:
    radial-gradient(800px 500px at 80% 100%, rgba(180,83,9,0.10), transparent 60%),
    radial-gradient(700px 400px at 10% 0%, rgba(245,158,11,0.07), transparent 60%),
    linear-gradient(160deg, #0a0a0a 0%, #0f0f10 50%, #0a0a0a 100%);
}
.btl-glow {
  position: absolute; inset: -20%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(900px 500px at 50% 50%, var(--btl-accent, #f59e0b), transparent 70%);
  opacity: 0.05;
  filter: blur(80px);
}
.btl-grain {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
}

/* ─── Header ─── */
.btl-header {
  position: relative; z-index: 10;
  display: flex; align-items: baseline; justify-content: space-between;
  padding: clamp(10px, 2.5cqh, 22px) clamp(14px, 3cqw, 30px) clamp(8px, 2cqh, 14px);
  border-bottom: 2px solid rgba(245, 158, 11, 0.4);
}
.btl-title-block {
  display: flex; align-items: center; gap: clamp(8px, 1.5cqw, 16px);
}
.btl-title-icon {
  font-size: clamp(20px, 4.5cqh, 44px);
  filter: drop-shadow(0 0 14px var(--btl-accent, #f59e0b));
}
.btl-title {
  font-family: 'Bebas Neue', 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(22px, 5.2cqh, 56px);
  letter-spacing: 0.18em;
  color: var(--btl-accent, #f59e0b);
  text-shadow: 0 0 22px var(--btl-accent, #f59e0b);
  line-height: 1;
  text-transform: uppercase;
}
.btl-subtitle {
  font-family: 'Outfit', sans-serif;
  font-size: clamp(10px, 1.6cqh, 14px);
  font-weight: 600;
  letter-spacing: 0.32em;
  color: #94a3b8;
  text-transform: uppercase;
}

/* ─── Grid ─── */
.btl-grid {
  position: relative; z-index: 10;
  display: grid;
  grid-template-columns: repeat(var(--btl-cols, 2), minmax(0, 1fr));
  gap: clamp(4px, 0.8cqh, 10px) clamp(10px, 2cqw, 22px);
  padding: clamp(8px, 2cqh, 16px) clamp(14px, 3cqw, 30px);
  align-content: start;
}

/* ─── Row ─── */
.btl-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: clamp(6px, 1.4cqw, 14px);
  padding: clamp(7px, 1.4cqh, 14px) clamp(8px, 1.5cqw, 14px);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(245, 158, 11, 0.10);
  transition: background 250ms ease;
}
.btl-row:hover {
  background: rgba(245, 158, 11, 0.06);
}

.btl-tap-num-col {
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(2px, 0.5cqh, 4px);
  flex-shrink: 0;
}
.btl-tap-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: clamp(9px, 1.4cqh, 12px);
  color: #64748b;
  letter-spacing: 0.1em;
}
.btl-handle {
  width: clamp(10px, 1.6cqh, 16px);
  height: clamp(10px, 1.6cqh, 16px);
  border-radius: 50%;
  border: 2px solid rgba(0,0,0,0.4);
}

.btl-meta {
  min-width: 0;
}
.btl-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(13px, 2.2cqh, 22px);
  color: #f8fafc;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex; align-items: center; gap: clamp(5px, 1cqw, 10px);
}
.btl-new-chip {
  background: var(--btl-accent, #f59e0b);
  color: #0a0a0a;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(7px, 1.1cqh, 10px);
  letter-spacing: 0.2em;
  padding: 2px clamp(4px, 0.8cqw, 7px);
  border-radius: 3px;
  text-shadow: none;
  flex-shrink: 0;
  box-shadow: 0 0 8px var(--btl-accent, #f59e0b);
}
.btl-sub-row {
  display: flex; align-items: center; gap: clamp(4px, 0.8cqw, 8px);
  margin-top: 2px;
  font-family: 'Inter', sans-serif;
  font-size: clamp(10px, 1.4cqh, 13px);
  color: #94a3b8;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.btl-brewery {
  font-weight: 600;
  color: #cbd5e1;
}
.btl-dot {
  color: #475569;
}
.btl-style {
  font-weight: 500;
  color: #94a3b8;
}

.btl-stats {
  display: flex; gap: clamp(6px, 1.2cqw, 12px);
  flex-shrink: 0;
}
.btl-stat {
  display: flex; flex-direction: column; align-items: center;
  line-height: 1;
}
.btl-stat-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(11px, 1.7cqh, 15px);
  color: #f8fafc;
}
.btl-stat-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(7px, 1cqh, 9px);
  color: #64748b;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  margin-top: 2px;
}

.btl-price {
  font-family: 'Bebas Neue', 'Outfit', sans-serif;
  font-size: clamp(15px, 2.6cqh, 26px);
  font-weight: 700;
  color: var(--btl-accent, #f59e0b);
  text-shadow: 0 0 12px var(--btl-accent, #f59e0b);
  flex-shrink: 0;
  letter-spacing: 0.04em;
}
`;
