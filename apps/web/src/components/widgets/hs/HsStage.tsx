"use client";

/**
 * Shared 4K stage wrapper for the 8 high-school lobby templates
 * (scratch/design/hs/*.html).
 *
 * Every HS template is authored at a fixed 3840×2160 canvas. This
 * wrapper measures the parent container and applies a CSS transform
 * scale so the stage fits whatever the screen actually is — 4K
 * lobby monitor, 1080p hallway TV, thumbnail in the gallery, or
 * the template builder's editing canvas — with no per-widget
 * layout drift.
 *
 * IMPORTANT: the scaling pattern is three-layered, matching the
 * HTML mockup in scratch/design/hs/*.html:
 *
 *   .viewport       → fills the parent (position:absolute, inset:0)
 *   .stage-outer    → takes SCALED dimensions in layout so the
 *                     centering grid places it correctly
 *   .stage          → 3840×2160 unscaled, transform:scale(k)
 *                     with transform-origin at 0 0
 *
 * A previous (broken) implementation used `place-items:center` on
 * the viewport + `transform-origin:center center` on an otherwise-
 * unscaled 3840×2160 stage. That made the stage's LAYOUT BOX stay
 * 3840×2160 — the `place-items:center` positioned the unscaled box
 * in the centre of the tiny parent, which (since the parent had
 * `overflow:hidden`) cropped everything except a 3840×2160 centered
 * slice. Symptom: the gallery thumbnail rendered as a tiny crop of
 * the centre, and the builder's customize canvas showed only the
 * top-left corner at 1:1. Do NOT regress to that. The .stage-outer
 * layer is what makes the layout box shrink.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';

const STAGE_W = 3840;
const STAGE_H = 2160;

interface Props {
  children: ReactNode;
  /** Optional inline style applied to the stage div. */
  stageStyle?: React.CSSProperties;
  /** Optional className applied to the stage div. */
  stageClassName?: string;
  /**
   * Optional override for the stage width in CSS pixels. Defaults to 3840
   * (landscape). Portrait MS templates pass 2160 here so the scale fit
   * math respects the portrait aspect ratio instead of cropping.
   */
  width?: number;
  /**
   * Optional override for the stage height in CSS pixels. Defaults to 2160
   * (landscape). Portrait MS templates pass 3840 here.
   */
  height?: number;
}

export function HsStage({
  children,
  stageStyle,
  stageClassName,
  width = STAGE_W,
  height = STAGE_H,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / width, h / height));
    };
    fit();
    // Two animation frames — one to catch the initial layout pass,
    // one to catch any font-load re-flow after fonts.ready.
    const r1 = requestAnimationFrame(fit);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(fit));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      ro.disconnect();
    };
  }, [width, height]);

  return (
    <div
      ref={viewportRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {/* stage-outer holds the SCALED dimensions so the grid centers
          the right size — without this, place-items:center centres an
          unscaled stage box and the overflow:hidden crops to a middle slice. */}
      <div
        style={{
          width: width * scale,
          height: height * scale,
          position: 'relative',
        }}
      >
        <div
          className={stageClassName}
          style={{
            width,
            height,
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            overflow: 'hidden',
            ...stageStyle,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export { STAGE_W, STAGE_H };
