'use client';

import * as React from 'react';

/**
 * scheduleFit — the shared, hardened re-measure scheduler for FitOneLine +
 * FitBox. Both primitives compute scale from the box vs. the (unscaled,
 * base-font) content dimensions; the ONLY thing that ever made them clip was
 * measuring at the WRONG MOMENT.
 *
 * The failure mode (2026-06-16, item L — "team names cut off on a 4K TV"):
 * the first synchronous measure can land BEFORE the large base font has fully
 * laid out, or before a webfont has painted, on a cold 4K Android WebView /
 * Taurus. That reads a too-small content width → computes a too-LARGE scale →
 * the text overflows and the zone's `overflow:hidden` CLIPS it. The old code
 * only re-measured on a BOX resize (ResizeObserver + a box-only 500ms poll) and
 * `fonts.ready`; a late-loading font changes the CONTENT size without touching
 * the box, so the box-only poll never re-fired and the bad scale stuck.
 *
 * Hardening (all downscale-only — every re-measure can only SHRINK to fit, so
 * there is zero regression risk and no feedback loop):
 *   1. measure now, on the next two animation frames, AND at 80/300/1200ms —
 *      so the final scale always reflects fully-settled layout + fonts.
 *   2. ResizeObserver on the box (unchanged) for live canvas resizes.
 *   3. a 500ms poll that watches BOTH the box AND the content dimensions, so a
 *      webfont that lands late (changing content width, not the box) re-fits.
 *   4. `document.fonts.ready` + window `load` re-measures.
 *
 * Returns an array of cleanup fns the caller invokes on unmount.
 * Chromium-83 / Taurus safe — pure measurement, no new CSS.
 */
function scheduleFit(
  box: HTMLElement,
  content: HTMLElement,
  measure: () => void,
): Array<() => void> {
  const cleanups: Array<() => void> = [];
  measure();
  const raf1 = requestAnimationFrame(() => {
    measure();
    const raf2 = requestAnimationFrame(measure);
    cleanups.push(() => cancelAnimationFrame(raf2));
  });
  cleanups.push(() => cancelAnimationFrame(raf1));
  for (const d of [80, 300, 1200]) {
    const id = setTimeout(measure, d);
    cleanups.push(() => clearTimeout(id));
  }
  const ro = new ResizeObserver(measure);
  ro.observe(box);
  cleanups.push(() => ro.disconnect());
  let lw = 0, lh = 0, lcw = 0, lch = 0;
  const poll = setInterval(() => {
    const w = box.clientWidth, h = box.clientHeight;
    const cw = content.scrollWidth, ch = content.scrollHeight;
    if (w !== lw || h !== lh || cw !== lcw || ch !== lch) {
      lw = w; lh = h; lcw = cw; lch = ch;
      measure();
    }
  }, 500);
  cleanups.push(() => clearInterval(poll));
  if (typeof document !== 'undefined' && (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready) {
    (document as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(measure).catch(() => {});
  }
  if (typeof window !== 'undefined') {
    const onLoad = () => measure();
    window.addEventListener('load', onLoad);
    cleanups.push(() => window.removeEventListener('load', onLoad));
  }
  return cleanups;
}

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
    const cleanups = scheduleFit(box, txt, measure);
    return () => { for (const c of cleanups) c(); };
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
    const cleanups = scheduleFit(box, inner, measure);
    return () => { for (const c of cleanups) c(); };
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
