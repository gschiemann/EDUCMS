"use client";

/**
 * FitText — picks the largest font-size that fits inside its
 * container, never overflowing. Used by shape-based themes (Rainbow
 * Ribbon, Field Day) where widget zones range from tiny corner
 * thumbnails to full-4K hero cards and a fixed em/px size can't hit
 * every size right.
 *
 * Algorithm: binary search between `min` and `max`. At each candidate
 * size, measure the span's scrollWidth/scrollHeight; if it fits both
 * axes of the wrapper, raise the floor, else lower the ceiling. Five
 * iterations is enough for <1px precision. A 0.92 safety factor
 * guarantees visible breathing room so drop-shadows, letter-spacing,
 * and subpixel rendering never clip at the edges.
 *
 * Re-runs on every ResizeObserver tick so builder-zoom, preview-modal
 * opening, and window resize all land at the right size. Using rAF to
 * coalesce multiple bursts so we don't thrash layout.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  children: React.ReactNode;
  /** Maximum font-size in px. Default tuned for shape overlays. */
  max?: number;
  /** Minimum font-size in px. */
  min?: number;
  /** Inline styles for the measured span (font-family, color, weight). */
  style?: React.CSSProperties;
  className?: string;
  /** Center content inside wrapper. Default true. */
  center?: boolean;
  /** Line-height multiplier. 1.05 for tight display, 1.25 for paragraphs. */
  lineHeight?: number;
  /** Allow wrapping onto multiple lines. Default true. */
  wrap?: boolean;
}

// 0.97 leaves ~3% breathing room for sub-pixel rendering + drop
// shadows without looking under-sized. Any lower and text visibly
// floats inside its container; any higher and shadows clip.
const SAFETY = 0.97;

export function FitText({
  children, max = 200, min = 8, style, className, center = true, lineHeight = 1.1, wrap = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [size, setSize] = useState<number>(min);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    let raf = 0;

    const fit = () => {
      const availW = wrap.clientWidth * SAFETY;
      const availH = wrap.clientHeight * SAFETY;
      if (availW <= 0 || availH <= 0) return;

      // Lock the span's width to the wrapper so it wraps naturally
      // instead of overflowing. Without this, an inline-block with
      // `maxWidth:100%` in a flex parent picks the largest single-
      // line size that fits horizontally — which is usually smaller
      // than the size at which the text would fill the whole box on
      // two lines. Forcing width lets the binary search honestly
      // compare "big font across 2 lines" vs "smaller font on 1 line".
      inner.style.width = `${Math.floor(availW)}px`;

      const fits = (size: number) => {
        inner.style.fontSize = `${size}px`;
        // scrollHeight is the true rendered height including wraps.
        // scrollWidth with width set returns the content's natural
        // unwrapped width — if that exceeds availW the text is
        // clipping single words (not wrapping cleanly), which we
        // still want to reject so we don't chop letters.
        return inner.scrollHeight <= availH && inner.scrollWidth <= availW;
      };

      let lo = min;
      let hi = max;
      // Quick check: if even the minimum doesn't fit, snap to min so
      // something visible renders (preferable to blank space).
      if (!fits(lo)) {
        setSize(lo);
        return;
      }
      // Binary search — 8 iterations = ~0.4% precision.
      for (let i = 0; i < 8; i++) {
        const mid = Math.floor((lo + hi) / 2);
        if (mid === lo) break;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      setSize(lo);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    // Observe the element itself AND several ancestors. Builder zone
    // resizes sometimes mutate a grandparent's inline style (the zone
    // wrapper) without firing a layout event on the intermediate
    // divs. Observing up the chain guarantees we catch it.
    ro.observe(wrap);
    let p: HTMLElement | null = wrap.parentElement;
    for (let i = 0; i < 4 && p; i++) { ro.observe(p); p = p.parentElement; }
    window.addEventListener('resize', schedule);
    // Low-cost safety net — every 500ms check if the wrapper's size
    // has changed since last fit. Covers weird edge cases like zone
    // drags that don't trigger ResizeObserver at all (Safari flexbox
    // quirks, Turbopack HMR, etc.). Stops once unmounted.
    let lastW = 0, lastH = 0;
    const pollId = setInterval(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (w !== lastW || h !== lastH) {
        lastW = w; lastH = h;
        schedule();
      }
    }, 500);
    // Refit once fonts load — the initial pass often runs before web
    // fonts swap in, and a display font is usually wider than the
    // system-sans fallback so the result comes out oversized.
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(schedule).catch(() => {});
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearInterval(pollId);
      window.removeEventListener('resize', schedule);
    };
  }, [children, max, min]);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        width: '100%', height: '100%',
        display: 'flex',
        alignItems: center ? 'center' : 'flex-start',
        justifyContent: center ? 'center' : 'flex-start',
        // textAlign tracks the `center` prop instead of being forced
        // to 'center' always. Calendar pills and other left-aligned
        // widgets pass center={false} — the old hardcoded 'center'
        // was overriding that and centering pill text too.
        textAlign: center ? 'center' : 'left',
        overflow: 'hidden',
      }}
    >
      <span
        ref={innerRef}
        style={{
          display: 'inline-block',
          whiteSpace: wrap ? 'normal' : 'nowrap',
          lineHeight,
          fontSize: size,
          maxWidth: '100%',
          ...style,
        }}
      >
        {children}
      </span>
    </div>
  );
}
