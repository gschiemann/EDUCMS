'use client';

/**
 * RetailLookbookCarouselWidget — auto-rotating fashion-style hero.
 *
 * Full-bleed crossfading hero images with editorial overlay caption
 * (eyebrow + headline + subhead + price). Each slide is rendered in a
 * stacked layer and opacity-swapped on a configurable interval. When
 * an image is missing we render a stylized solid-color "lookbook
 * page" with emoji + caption so the layout never collapses while
 * merchandisers wait for product photography.
 *
 * Visual DNA: high-end boutique window — cinematic crossfade,
 * tracked-uppercase eyebrow, italic Playfair display headlines, deep
 * gradient-to-black overlay on the bottom 40% so caption text always
 * stays readable over any image.
 */

import { useEffect, useState } from 'react';
import { sceneCss } from '../scene-css';
import { WidgetEmptyState } from '../WidgetEmptyState';

export interface RetailLookbookSlide {
  id?: string;
  /** Hero image URL. Falls back to swatchColor + emoji when missing. */
  imageUrl?: string;
  /** Tiny eyebrow above the headline e.g. "SS26 · NEW IN". */
  eyebrow?: string;
  /** Big serif headline. */
  headline?: string;
  /** Italic subhead. */
  subhead?: string;
  /** Optional price callout pinned bottom-right. */
  price?: string;
  /** Solid color shown when imageUrl is missing. */
  swatchColor?: string;
  /** Emoji shown over the swatch when imageUrl is missing. */
  emoji?: string;
}

export interface RetailLookbookCarouselConfig {
  slides?: RetailLookbookSlide[];
  /** Rotation duration per slide in ms. Default 6000. */
  rotationMs?: number;
  /** Crossfade duration in ms. Default 800. */
  fadeMs?: number;
  /** Body text color over the gradient overlay. Default white. */
  inkColor?: string;
  /** Accent for eyebrow + price. */
  accentColor?: string;
}

// §19, 2026-09-11. A hardcoded DEMO_SLIDES array used to stand in whenever the
// operator had configured nothing, so an empty widget rendered an invented seasonal lookbook ('The Linen Edit', 'From $89')
// with no field behind a single word of it. Empty means empty — see
// ../WidgetEmptyState.tsx.

export function RetailLookbookCarouselWidget({
  config,
  live,
}: {
  config?: RetailLookbookCarouselConfig;
  live?: boolean;
}) {
  const c: RetailLookbookCarouselConfig = config || {};
  const isLive = !!live;
  const slides: RetailLookbookSlide[] = Array.isArray(c.slides)
    ? c.slides.filter((s) => s && ((s.headline || '').trim() || (s.eyebrow || '').trim() || (s.imageUrl || '').trim()))
    : [];
  const rotationMs = c.rotationMs ?? 6000;
  const fadeMs = c.fadeMs ?? 800;
  const ink = c.inkColor ?? '#ffffff';
  const accent = c.accentColor ?? '#e8c87a';

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!isLive || slides.length <= 1) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % slides.length);
    }, rotationMs);
    return () => clearInterval(t);
  }, [isLive, slides.length, rotationMs]);

  if (slides.length === 0) {
    return (
      <WidgetEmptyState
        eyebrow="LOOKBOOK"
        action="Add your first slide"
        hint="Properties → Slides → Add slide"
        accent={accent}
        tone="light"
      />
    );
  }

  return (
    <div
      className="rlcw-root"
      style={
        {
          '--rlcw-ink': ink,
          '--rlcw-accent': accent,
          '--rlcw-fade': `${fadeMs}ms`,
        } as React.CSSProperties
      }
    >
      <style>{sceneCss(CSS)}</style>

      {slides.map((s, i) => {
        const isActive = i === idx;
        return (
          <div
            key={s.id || i}
            className="rlcw-slide"
            style={{ opacity: isActive ? 1 : 0 }}
            aria-hidden={!isActive}
          >
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="rlcw-image" src={s.imageUrl} alt={s.headline || ''} />
            ) : (
              <div className="rlcw-swatch" style={{ background: s.swatchColor || '#cbb898' }}>
                <span className="rlcw-emoji">{s.emoji || '👗'}</span>
              </div>
            )}

            <div className="rlcw-overlay" />

            <div className="rlcw-caption">
              {s.eyebrow && <div className="rlcw-eyebrow">{s.eyebrow}</div>}
              {s.headline && <h1 className="rlcw-headline">{s.headline}</h1>}
              {s.subhead && <div className="rlcw-subhead">{s.subhead}</div>}
            </div>

            {s.price && <div className="rlcw-price">{s.price}</div>}
          </div>
        );
      })}

      {slides.length > 1 && (
        <div className="rlcw-dots" aria-hidden>
          {slides.map((_, i) => (
            <span
              key={i}
              className={`rlcw-dot ${i === idx ? 'rlcw-dot-active' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');

.rlcw-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  background: #1a1411;
  color: var(--rlcw-ink, #ffffff);
  font-family: 'Inter', sans-serif;
  container-type: size;
}
.rlcw-slide {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  transition: opacity var(--rlcw-fade, 800ms) ease-in-out;
}
.rlcw-image {
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
}
.rlcw-swatch {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  display: flex; align-items: center; justify-content: center;
}
.rlcw-emoji {
  font-size: clamp(120px, 32cqh, 480px);
  filter: drop-shadow(0 16px 56px rgba(0,0,0,0.35));
}
.rlcw-overlay {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: linear-gradient(180deg,
    rgba(0,0,0,0) 30%,
    rgba(0,0,0,0.4) 70%,
    rgba(0,0,0,0.85) 100%);
}
.rlcw-caption {
  position: absolute;
  left: clamp(20px, 5cqw, 80px);
  right: clamp(20px, 5cqw, 80px);
  bottom: clamp(40px, 12cqh, 140px);
  z-index: 2;
}
.rlcw-eyebrow {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(11px, 1.8cqh, 16px);
  letter-spacing: 0.5em;
  text-transform: uppercase;
  color: var(--rlcw-accent);
  margin-bottom: clamp(6px, 1.2cqh, 14px);
}
.rlcw-headline {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(32px, 9cqh, 120px);
  line-height: 1.0;
  letter-spacing: -0.015em;
  margin: 0;
  color: var(--rlcw-ink);
  text-shadow: 0 4px 24px rgba(0,0,0,0.45);
}
.rlcw-subhead {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(14px, 2.4cqh, 28px);
  opacity: 0.9;
  margin-top: clamp(6px, 1.2cqh, 14px);
  text-shadow: 0 2px 12px rgba(0,0,0,0.45);
}
.rlcw-price {
  position: absolute;
  right: clamp(20px, 5cqw, 80px);
  bottom: clamp(40px, 12cqh, 140px);
  z-index: 3;
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(20px, 4cqh, 48px);
  color: var(--rlcw-accent);
  letter-spacing: -0.01em;
  text-shadow: 0 2px 12px rgba(0,0,0,0.45);
}
.rlcw-dots {
  position: absolute;
  bottom: clamp(14px, 3cqh, 32px);
  left: 0; right: 0;
  display: flex; justify-content: center;
  gap: clamp(6px, 1cqw, 12px);
  z-index: 4;
  pointer-events: none;
}
.rlcw-dot {
  display: inline-block;
  width: clamp(20px, 3cqw, 36px);
  height: 2px;
  background: rgba(255,255,255,0.35);
  transition: background 400ms;
}
.rlcw-dot-active {
  background: var(--rlcw-accent);
}
`;
