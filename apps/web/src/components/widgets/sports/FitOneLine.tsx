'use client';

import * as React from 'react';

/**
 * Fill-the-zone one-liner — the STANDARD auto-fit primitive for every
 * sport scoreboard text/number element (team name, score, clock, segment,
 * stat, …). Shared so all of them shrink-to-fit identically.
 *
 * Renders `children` at a LARGE fixed base font (`maxFontPx`, nowrap) and
 * scales it with `transform: scale()` to FILL the zone — as large as fits
 * its width AND height (operator: "it should start as large as possible …
 * but fit in the template"). Because the base font is large, scale stays
 * ≤ 1 (downscale only = crisp; no upscale blur).
 *
 * Deterministic: the measured scrollWidth/Height is stable (the base font
 * never changes), so there's no binary-search / re-render feedback loop —
 * that was FitText's failure mode (stuck at max on long single-line text).
 *
 * Chromium-83 / NovaStar-Taurus safe: `transform: scale()` is universal;
 * no `gap` / `inset` / `backdrop-filter`.
 */
export function FitOneLine({
  children,
  maxFontPx,
  align = 'center',
  style,
  autoShrink = true,
}: {
  children: React.ReactNode;
  maxFontPx: number;
  align?: 'left' | 'center' | 'right';
  style?: React.CSSProperties;
  /** When false, render at exactly maxFontPx (no shrink-to-fit) — used when
   *  the operator has set an explicit font size so +/- visibly changes the
   *  rendered size; overflow is clipped by the zone. Default true (fill). */
  autoShrink?: boolean;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const txtRef = React.useRef<HTMLSpanElement>(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    const txt = txtRef.current;
    if (!box || !txt) return;
    const measure = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      const tw = txt.scrollWidth;
      const th = txt.scrollHeight;
      if (!bw || !bh || !tw || !th) return;
      setScale(autoShrink ? Math.min(1, (bw * 0.96) / tw, (bh * 0.94) / th) : 1);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    let lastW = 0, lastH = 0;
    const poll = setInterval(() => {
      const w = box.clientWidth, h = box.clientHeight;
      if (w !== lastW || h !== lastH) { lastW = w; lastH = h; measure(); }
    }, 500);
    if (typeof document !== 'undefined' && (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready) {
      (document as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(measure).catch(() => {});
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); clearInterval(poll); };
  }, [children, maxFontPx, autoShrink]);
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const origin = align === 'left' ? 'left center' : align === 'right' ? 'right center' : 'center center';
  return (
    <div ref={boxRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: justify, overflow: 'hidden' }}>
      <span
        ref={txtRef}
        style={{ ...style, fontSize: maxFontPx, lineHeight: 1, whiteSpace: 'nowrap', display: 'inline-block', transform: `scale(${scale})`, transformOrigin: origin }}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * FitBox — the COMPOSITE sibling of FitOneLine. Where FitOneLine fits a
 * single line of text, FitBox scales an ARBITRARY block (a label+value
 * stack, a lamp row, an icon+text combo) to fill-but-fit its zone.
 *
 * Use it for any sport element that stacks/combines pieces (e.g. a small
 * "FOULS" label over a big number, "DOWN 2 · 7" play state, a timeout dot
 * row). Set `baseFontPx` to the element's intended size — children that use
 * `em` units scale with it, and the whole block is then transform-scaled
 * down so it never overflows the zone. Single bare values should use
 * FitOneLine instead (tighter line-height).
 *
 * Same guarantees as FitOneLine: deterministic (no feedback loop),
 * downscale-only (crisp), Chromium-83 / Taurus safe (transform:scale only;
 * no gap / inset / backdrop-filter).
 */
export function FitBox({
  children,
  baseFontPx = 400,
  align = 'center',
  style,
  autoShrink = true,
}: {
  children: React.ReactNode;
  baseFontPx?: number;
  align?: 'left' | 'center' | 'right';
  style?: React.CSSProperties;
  /** When false, render at baseFontPx (no shrink) so an explicit size grows
   *  the block on +/- ; overflow clipped by the zone. Default true (fill). */
  autoShrink?: boolean;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      const cw = inner.scrollWidth;
      const ch = inner.scrollHeight;
      if (!bw || !bh || !cw || !ch) return;
      setScale(autoShrink ? Math.min(1, (bw * 0.96) / cw, (bh * 0.94) / ch) : 1);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    let lastW = 0, lastH = 0;
    const poll = setInterval(() => {
      const w = box.clientWidth, h = box.clientHeight;
      if (w !== lastW || h !== lastH) { lastW = w; lastH = h; measure(); }
    }, 500);
    if (typeof document !== 'undefined' && (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready) {
      (document as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(measure).catch(() => {});
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); clearInterval(poll); };
  }, [children, baseFontPx, autoShrink]);
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const origin = align === 'left' ? 'left center' : align === 'right' ? 'right center' : 'center center';
  return (
    <div ref={boxRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: justify, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{ ...style, fontSize: baseFontPx, lineHeight: 1.1, display: 'inline-block', transform: `scale(${scale})`, transformOrigin: origin }}
      >
        {children}
      </div>
    </div>
  );
}
