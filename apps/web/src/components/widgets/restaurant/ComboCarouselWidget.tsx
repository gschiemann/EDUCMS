'use client';

/**
 * ComboCarouselWidget — auto-rotating combo / value-meal carousel.
 *
 * Shows one combo at a time with a big food emoji or photo block,
 * combo name, included items, and a "starting at $X" callout. Rotates
 * through configured combos on a timer; live mode plays the rotation
 * automatically. In gallery preview (live=false) the first item is
 * rendered statically.
 *
 * Visual DNA: warm cream / charcoal canvas, mustard accent, large
 * bold display type. Combo image is a colored block with emoji
 * fallback so the widget never relies on a missing photo.
 *
 * Widget type: RESTAURANT_COMBO_CAROUSEL
 */

import { useEffect, useRef, useState } from 'react';

export interface ComboItem {
  name: string;
  /** Bullet list of included items / sides / drink. */
  includes?: string[];
  /** "Starting at" price, e.g. "$9.99". */
  price: string;
  /** Optional image URL. If absent, emoji fallback is used. */
  imageUrl?: string;
  /** Big emoji shown when imageUrl is empty / fails. */
  emoji?: string;
  /** Optional "TODAY ONLY" / "LIMITED TIME" badge. */
  badge?: string;
  /** Optional tile bg color override. */
  tileBg?: string;
}

export interface ComboCarouselConfig {
  combos?: ComboItem[];
  /** ms between rotations. Default 7000. */
  rotationMs?: number;
  /** Section title shown above the combo. */
  title?: string;
  /** Mustard accent color. */
  accentColor?: string;
}

const DEMO_COMBOS: ComboItem[] = [
  {
    name: 'Big Burger Combo',
    includes: ['1/3 lb cheeseburger', 'Sea-salt fries', '22oz fountain soda'],
    price: '$9.99',
    emoji: '🍔',
    tileBg: '#7a1f1f',
    badge: 'BEST VALUE',
  },
  {
    name: 'Crispy Chicken Combo',
    includes: ['Buttermilk chicken sandwich', 'Onion rings', 'Strawberry lemonade'],
    price: '$10.49',
    emoji: '🍗',
    tileBg: '#b8650a',
    badge: 'CHEF PICK',
  },
  {
    name: 'Family Bundle',
    includes: ['4 burgers · 4 fries', '4 fountain drinks', '1 free shake'],
    price: '$32.99',
    emoji: '👨‍👩‍👧‍👦',
    tileBg: '#2c5e3f',
    badge: 'FAMILY MEAL',
  },
];

export function ComboCarouselWidget({
  config,
  live,
}: {
  config?: ComboCarouselConfig;
  live?: boolean;
}) {
  const c: ComboCarouselConfig = config || {};
  const accent = c.accentColor || '#e8b94a';
  const rotationMs = c.rotationMs || 7000;
  const combos = (Array.isArray(c.combos) && c.combos.length > 0) ? c.combos : DEMO_COMBOS;
  const title = c.title || 'COMBO MEALS';

  const [idx, setIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!live || combos.length < 2) return;
    timerRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % combos.length);
    }, rotationMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [live, combos.length, rotationMs]);

  const current = combos[Math.min(idx, combos.length - 1)] || combos[0];

  return (
    <div className="rcc-root" style={{ ['--rcc-accent' as string]: accent } as React.CSSProperties}>
      <style>{CSS}</style>

      <div className="rcc-bg" />
      <div className="rcc-glow" aria-hidden />

      <div className="rcc-header">
        <div className="rcc-eyebrow">
          <span className="rcc-eyebrow-dot" />
          {title}
        </div>
        {combos.length > 1 && (
          <div className="rcc-dots" aria-hidden>
            {combos.map((_, i) => (
              <span key={i} className={`rcc-dot ${i === idx ? 'rcc-dot-on' : ''}`} />
            ))}
          </div>
        )}
      </div>

      <div className="rcc-stage">
        {/* Big image / emoji tile */}
        <div className="rcc-tile" style={{ background: current.tileBg || '#7a1f1f' }}>
          {current.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="rcc-tile-img"
              src={current.imageUrl}
              alt={current.name}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          <div className="rcc-tile-emoji" aria-hidden>{current.emoji || '🍽️'}</div>
          {current.badge && (
            <div className="rcc-badge">{current.badge}</div>
          )}
        </div>

        {/* Info column */}
        <div className="rcc-info">
          <div className="rcc-combo-name">{current.name}</div>

          {current.includes && current.includes.length > 0 && (
            <ul className="rcc-includes" aria-label="Includes">
              {current.includes.map((it, i) => (
                <li key={i} className="rcc-include-item">
                  <span className="rcc-include-bullet" aria-hidden />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="rcc-price-block">
            <div className="rcc-price-label">starting at</div>
            <div className="rcc-price-value">{current.price}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');

.rcc-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #fbf6ee;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}
.rcc-bg {
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(140deg, #1a1714 0%, #2a211c 60%, #1a1714 100%);
}
.rcc-glow {
  position: absolute; inset: -10%; z-index: 1;
  background: radial-gradient(700px 500px at 30% 10%, var(--rcc-accent, #e8b94a), transparent 60%);
  opacity: 0.12;
  filter: blur(80px);
  pointer-events: none;
}

.rcc-header {
  position: absolute; top: clamp(10px, 2cqh, 22px); left: clamp(14px, 2.5cqw, 30px); right: clamp(14px, 2.5cqw, 30px);
  z-index: 10;
  display: flex; justify-content: space-between; align-items: center;
}
.rcc-eyebrow {
  display: inline-flex; align-items: center; gap: clamp(5px, 0.9cqw, 9px);
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.7cqh, 18px);
  letter-spacing: 0.28em;
  color: var(--rcc-accent, #e8b94a);
  text-transform: uppercase;
}
.rcc-eyebrow-dot {
  width: clamp(6px, 1cqh, 9px);
  height: clamp(6px, 1cqh, 9px);
  border-radius: 50%;
  background: var(--rcc-accent, #e8b94a);
  box-shadow: 0 0 8px var(--rcc-accent, #e8b94a);
}
.rcc-dots {
  display: inline-flex; gap: clamp(4px, 0.7cqw, 7px);
}
.rcc-dot {
  width: clamp(6px, 1cqh, 9px);
  height: clamp(6px, 1cqh, 9px);
  border-radius: 50%;
  background: rgba(251,246,238,0.2);
  transition: background 200ms;
}
.rcc-dot-on {
  background: var(--rcc-accent, #e8b94a);
}

.rcc-stage {
  position: absolute; inset: 0; z-index: 5;
  display: flex; align-items: center; gap: clamp(14px, 3cqw, 36px);
  padding: clamp(40px, 8cqh, 80px) clamp(18px, 3cqw, 36px) clamp(18px, 3cqh, 32px);
}

.rcc-tile {
  position: relative;
  flex: 0 0 42%;
  aspect-ratio: 1 / 1;
  max-height: 100%;
  border-radius: clamp(10px, 1.5cqh, 22px);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(251,246,238,0.08);
}
.rcc-tile-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
}
.rcc-tile-emoji {
  font-size: clamp(60px, 28cqh, 240px);
  line-height: 1;
  filter: drop-shadow(0 6px 18px rgba(0,0,0,0.35));
}
.rcc-badge {
  position: absolute; top: clamp(8px, 1.5cqh, 16px); left: clamp(8px, 1.5cqw, 16px);
  background: var(--rcc-accent, #e8b94a);
  color: #1a1714;
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  letter-spacing: 0.18em;
  font-size: clamp(10px, 1.6cqh, 16px);
  padding: clamp(3px, 0.6cqh, 6px) clamp(7px, 1.2cqw, 12px);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
  text-transform: uppercase;
}

.rcc-info {
  flex: 1;
  display: flex; flex-direction: column;
  gap: clamp(8px, 1.6cqh, 18px);
  min-width: 0;
}
.rcc-combo-name {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(28px, 8cqh, 90px);
  line-height: 1;
  letter-spacing: 0.02em;
  color: #fbf6ee;
  text-shadow: 0 2px 16px rgba(0,0,0,0.4);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rcc-includes {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: clamp(4px, 0.7cqh, 8px);
}
.rcc-include-item {
  display: flex; align-items: baseline; gap: clamp(6px, 1cqw, 11px);
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(11px, 1.9cqh, 22px);
  color: rgba(251,246,238,0.85);
  line-height: 1.3;
}
.rcc-include-bullet {
  flex-shrink: 0;
  width: clamp(5px, 0.8cqh, 8px);
  height: clamp(5px, 0.8cqh, 8px);
  border-radius: 50%;
  background: var(--rcc-accent, #e8b94a);
}
.rcc-price-block {
  display: flex; flex-direction: column;
  margin-top: clamp(4px, 0.8cqh, 10px);
}
.rcc-price-label {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.4cqh, 14px);
  letter-spacing: 0.22em;
  color: rgba(251,246,238,0.65);
  text-transform: uppercase;
}
.rcc-price-value {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(36px, 11cqh, 130px);
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--rcc-accent, #e8b94a);
  text-shadow: 0 0 28px rgba(232,185,74,0.35);
}
`;
