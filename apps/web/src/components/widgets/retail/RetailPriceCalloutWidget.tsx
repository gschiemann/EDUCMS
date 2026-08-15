'use client';


import { sceneCss } from '../scene-css';
/**
 * RetailPriceCalloutWidget — single-product hero with big-price callout.
 *
 * The end-cap "this is the deal" widget. Huge sale price front and
 * center, the original price strike-through next to it, percentage-off
 * starburst on top, and a 3-bullet selling-point column for "why care".
 * Optional product image fills the left half; emoji fallback when
 * imageUrl is missing.
 *
 * Editorial DNA — Playfair display headline, generous whitespace,
 * tracked uppercase eyebrow. NOT a flashy QSR menu — a department-store
 * end-cap or a luxury boutique window.
 */

export interface RetailPriceCalloutConfig {
  /** Eyebrow above headline e.g. "FEATURED · LIMITED RUN". */
  eyebrow?: string;
  /** Big serif headline e.g. "Cashmere Crewneck". */
  headline?: string;
  /** Sub-line under headline. */
  subhead?: string;
  /** The price you're charging today. Big. */
  salePrice?: string;
  /** Original price, struck-through. */
  originalPrice?: string;
  /** Auto-rendered if salePrice + originalPrice both numeric. Override here. */
  discountLabel?: string;
  /** Up to 3 bullet selling points. */
  sellingPoints?: string[];
  /** Optional product photo URL. */
  imageUrl?: string;
  /** Emoji fallback when no image. Defaults to 👗. */
  emoji?: string;
  /** Color for the emoji fallback panel. */
  swatchColor?: string;
  /** Background color. */
  bgColor?: string;
  /** Body text color. */
  inkColor?: string;
  /** Accent for the price + starburst. */
  accentColor?: string;
}

function deriveDiscountLabel(sale?: string, original?: string): string | null {
  if (!sale || !original) return null;
  const s = parseFloat(sale.replace(/[^\d.]/g, ''));
  const o = parseFloat(original.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(s) || !Number.isFinite(o) || o <= 0 || s >= o) return null;
  const pct = Math.round(((o - s) / o) * 100);
  return `SAVE ${pct}%`;
}

export function RetailPriceCalloutWidget({
  config,
}: {
  config?: RetailPriceCalloutConfig;
  live?: boolean;
}) {
  const c: RetailPriceCalloutConfig = config || {};
  const eyebrow = c.eyebrow ?? 'FEATURED · END-CAP DEAL';
  const headline = c.headline ?? 'Cashmere Crewneck';
  const subhead = c.subhead ?? 'A wardrobe staple, retailored.';
  const salePrice = c.salePrice ?? '$49';
  const originalPrice = c.originalPrice ?? '$79';
  const discount = c.discountLabel ?? deriveDiscountLabel(salePrice, originalPrice);
  const points = c.sellingPoints && c.sellingPoints.length > 0
    ? c.sellingPoints
    : ['Hand-finished in Italy', 'Pure Mongolian cashmere', 'Limited stock — 60 pieces'];
  const emoji = c.emoji ?? '🧥';
  const swatch = c.swatchColor ?? '#dccfb8';
  const bg = c.bgColor ?? '#faf6f1';
  const ink = c.inkColor ?? '#1a1411';
  const accent = c.accentColor ?? '#9a2d2d';

  return (
    <div
      className="rpcw-root"
      style={
        {
          '--rpcw-bg': bg,
          '--rpcw-ink': ink,
          '--rpcw-accent': accent,
        } as React.CSSProperties
      }
    >
      <style>{sceneCss(CSS)}</style>

      <div className="rpcw-image-pane">
        {c.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rpcw-image" src={c.imageUrl} alt={headline} />
        ) : (
          <div className="rpcw-swatch" style={{ background: swatch }}>
            <span className="rpcw-emoji">{emoji}</span>
          </div>
        )}

        {discount && (
          <div className="rpcw-starburst" aria-hidden>
            <svg viewBox="0 0 200 200" className="rpcw-starburst-svg">
              <polygon
                points="100,5 117,52 168,40 145,86 195,100 145,114 168,160 117,148 100,195 83,148 32,160 55,114 5,100 55,86 32,40 83,52"
                fill="var(--rpcw-accent)"
              />
            </svg>
            <div className="rpcw-starburst-text">
              {discount.split(' ').map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rpcw-content-pane">
        <div className="rpcw-eyebrow">{eyebrow}</div>
        <h1 className="rpcw-headline">{headline}</h1>
        <div className="rpcw-subhead">{subhead}</div>

        <div className="rpcw-price-block">
          <div className="rpcw-sale-price">{salePrice}</div>
          <div className="rpcw-original-row">
            <span className="rpcw-original-label">WAS</span>
            <span className="rpcw-original-price">{originalPrice}</span>
          </div>
        </div>

        <ul className="rpcw-points">
          {points.slice(0, 3).map((p, i) => (
            <li key={i}>
              <span className="rpcw-point-mark" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');

.rpcw-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: var(--rpcw-bg, #faf6f1);
  color: var(--rpcw-ink, #1a1411);
  font-family: 'Inter', sans-serif;
  display: grid;
  grid-template-columns: 5fr 4fr;
  gap: 0;
  container-type: size;
  overflow: hidden;
}
.rpcw-image-pane {
  position: relative;
  overflow: hidden;
  background: #ece6dc;
}
.rpcw-image {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.rpcw-swatch {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  display: flex; align-items: center; justify-content: center;
}
.rpcw-emoji {
  font-size: clamp(120px, 36cqh, 480px);
  filter: drop-shadow(0 8px 36px rgba(0,0,0,0.18));
}
.rpcw-starburst {
  position: absolute;
  top: clamp(16px, 4cqh, 56px);
  right: clamp(16px, 4cqh, 56px);
  width: clamp(80px, 18cqh, 200px);
  height: clamp(80px, 18cqh, 200px);
  display: flex; align-items: center; justify-content: center;
  animation: rpcw-spin 14s linear infinite;
}
.rpcw-starburst-svg {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  width: 100%; height: 100%;
  filter: drop-shadow(0 6px 16px rgba(0,0,0,0.2));
}
.rpcw-starburst-text {
  position: relative;
  z-index: 1;
  display: flex; flex-direction: column;
  align-items: center;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: clamp(11px, 2.2cqh, 22px);
  letter-spacing: 0.1em;
  color: #fff;
  text-align: center;
  line-height: 1.1;
}
.rpcw-starburst-text span:first-child { opacity: 0.85; }
.rpcw-starburst-text span:last-child { font-size: 1.4em; font-weight: 900; }
@keyframes rpcw-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.rpcw-content-pane {
  padding: clamp(20px, 5cqh, 80px) clamp(24px, 5cqw, 80px);
  display: flex; flex-direction: column;
  justify-content: center;
  gap: clamp(8px, 1.5cqh, 18px);
}
.rpcw-eyebrow {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(10px, 1.6cqh, 14px);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--rpcw-accent);
}
.rpcw-headline {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(32px, 9cqh, 120px);
  line-height: 1.0;
  letter-spacing: -0.015em;
  margin: 0;
}
.rpcw-subhead {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(14px, 2.2cqh, 26px);
  opacity: 0.7;
  margin-bottom: clamp(8px, 2cqh, 24px);
}
.rpcw-price-block {
  display: flex; align-items: baseline; gap: clamp(12px, 2cqw, 28px);
  margin: clamp(8px, 2cqh, 20px) 0;
}
.rpcw-sale-price {
  font-family: 'Playfair Display', serif;
  font-weight: 800;
  font-size: clamp(48px, 14cqh, 200px);
  line-height: 0.9;
  letter-spacing: -0.02em;
  color: var(--rpcw-accent);
}
.rpcw-original-row {
  display: flex; flex-direction: column;
  font-family: 'Inter', sans-serif;
}
.rpcw-original-label {
  font-weight: 600;
  font-size: clamp(9px, 1.3cqh, 12px);
  letter-spacing: 0.4em;
  opacity: 0.5;
}
.rpcw-original-price {
  font-weight: 500;
  font-size: clamp(16px, 2.8cqh, 32px);
  text-decoration: line-through;
  opacity: 0.55;
}
.rpcw-points {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex; flex-direction: column;
  gap: clamp(6px, 1.4cqh, 14px);
}
.rpcw-points li {
  display: flex; align-items: center;
  gap: clamp(8px, 1.5cqw, 16px);
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(13px, 2cqh, 22px);
  letter-spacing: 0.02em;
  opacity: 0.85;
}
.rpcw-point-mark {
  display: inline-block;
  width: clamp(8px, 1.4cqh, 14px);
  height: 1px;
  background: var(--rpcw-accent);
  flex: none;
}
`;
