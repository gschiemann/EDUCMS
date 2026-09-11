'use client';

// 2026-05-30 — POS sync: when `config.posSync` is true the carousel
// is driven by the live POS feed instead of static combos. Each
// PosMenuItem maps to a ComboItem (name, price, description → includes
// split on " · " / " / " / "," for multi-item combos, emoji). Falls
// back to the operator's own static combos when posSync is off or the feed
// hasn't loaded yet so the widget NEVER renders blank.
//
// Only wired where it genuinely makes sense — combo carousels ARE
// item/price feeds. Wait-times, event schedules, loyalty tickers,
// allergy legends, and game-day schedules are NOT wired.

import { useEffect, useRef, useState } from 'react';
import { usePosMenuItems } from '@/lib/menu/use-pos-menu-items';
import { sceneCss } from '../scene-css';
import { WidgetEmptyState } from '../WidgetEmptyState';

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
  /** When true, pull live combos from the connected POS instead of the
   *  static `combos` above (set by the template "Driven by: POS" picker).
   *  Falls back to static combos on error / before first load. */
  posSync?: boolean;
  /** Optional POS category filter when posSync is on (e.g. "Combos"). */
  posCategory?: string;
}

// §19, 2026-09-11. A DEMO_COMBOS array stood here — 'Big Burger Combo',
// '$9.99', 'BEST VALUE' — and it was the fallback whenever the operator had
// no combos. A QSR that dropped this widget on a drive-thru board advertised
// a price its POS has never heard of, with no field behind a word of it.

/** Map a PosMenuItem onto ComboItem for the live-POS path.
 *  - name / price are 1:1.
 *  - desc is treated as a multi-item description: split on " · ", " / ",
 *    or "," so a POS description like "burger · fries · drink" renders
 *    as the bullet list the carousel shows for includes.
 *  - emoji / imageUrl pass through when the POS has them.
 */
function posItemToCombo(it: { name: string; desc?: string; price: string; emoji?: string; imageUrl?: string }): ComboItem {
  const includesRaw = it.desc ? it.desc.split(/\s*[·\/,]\s*/).filter(Boolean) : undefined;
  return {
    name: it.name,
    price: it.price,
    includes: includesRaw && includesRaw.length > 1 ? includesRaw : undefined,
    emoji: it.emoji,
    imageUrl: it.imageUrl,
  };
}

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

  // Live POS feed. When posSync is on, map each PosMenuItem to a
  // ComboItem. The mapping/fallback pattern mirrors TapListWidget
  // and CocktailMenuWidget exactly. Null before first load; array on
  // success. We only switch away from the static list when we have
  // live items, so a POS outage falls back to the operator's OWN combos
  // (never to invented ones — see the §19 note above).
  const posItems = usePosMenuItems(!!c.posSync, c.posCategory);
  const liveCombos: ComboItem[] | null =
    c.posSync && posItems && posItems.length > 0
      ? posItems.map(posItemToCombo)
      : null;

  const combos: ComboItem[] = liveCombos ?? (Array.isArray(c.combos)
    // A row added but never named is not a combo.
    ? c.combos.filter((x) => x && ((x.name || '').trim() || (x.price || '').trim()))
    : []);
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

  if (combos.length === 0) {
    return (
      <WidgetEmptyState
        eyebrow="COMBOS"
        action="Add your first combo"
        hint={c.posSync ? 'Waiting on your POS — or add combos in Properties' : 'Properties → Combos → Add combo'}
        accent={accent}
        tone="dark"
      />
    );
  }

  const current = combos[Math.min(idx, combos.length - 1)] || combos[0];

  return (
    <div className="rcc-root" style={{ ['--rcc-accent' as string]: accent } as React.CSSProperties}>
      <style>{sceneCss(CSS)}</style>

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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: #fbf6ee;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}
.rcc-bg {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background: linear-gradient(140deg, #1a1714 0%, #2a211c 60%, #1a1714 100%);
}
.rcc-glow {
  position: absolute; top: -10%; right: -10%; bottom: -10%; left: -10%; z-index: 1;
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
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 5;
  display: flex; align-items: stretch; gap: clamp(14px, 3cqw, 36px);
  padding: clamp(40px, 8cqh, 80px) clamp(18px, 3cqw, 36px) clamp(18px, 3cqh, 32px);
}

/* Taurus-safe square (was a Chromium-88-only ratio property). This is a
   42%-wide flex-row item; padding-top:42% resolves against the SAME flex-row
   content width as the 42% flex-basis, so height == width: a perfect square
   on every engine including Chromium 83 (Taurus). The emoji/image fill an
   absolutely-positioned layer (longhand sides, not the inset shorthand). */
.rcc-tile {
  position: relative;
  width: 42%; flex: 0 0 42%;
  align-self: center;
  height: 0; padding-top: 42%;
  box-sizing: border-box;
  max-height: 100%;
  border-radius: clamp(10px, 1.5cqh, 22px);
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(251,246,238,0.08);
}
.rcc-tile-img {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;
}
.rcc-tile-emoji {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  display: flex; align-items: center; justify-content: center;
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
  /* Span the stage height and spread name → includes → price so the
     info column fills the canvas instead of clumping in the middle. */
  justify-content: space-between;
  gap: clamp(8px, 1.6cqh, 18px);
  min-width: 0; min-height: 0;
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
