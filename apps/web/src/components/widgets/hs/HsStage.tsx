"use client";

/**
 * Shared 4K stage wrapper for the 8 high-school lobby templates
 * (scratch/design/hs/*.html).
 *
 * Every HS template is authored at a fixed 3840×2160 canvas. This
 * wrapper measures the parent container and applies a CSS transform
 * scale so the stage fits whatever the screen actually is — 4K
 * lobby monitor, 1080p hallway TV, or a browser tab preview — with
 * no per-widget layout drift.
 *
 * This is the same pattern ScaledTemplateThumbnail uses for gallery
 * thumbnails, extracted into a reusable component so every HS
 * theme (Varsity, Broadcast, Yearbook, Terminal, Transit, Gallery,
 * Blueprint, Zine) shares the exact same scaling math.
 *
 * DO NOT use vw/% for sizing inside {children}. Keep every pixel
 * size fixed (the same numbers used in the HTML mockup). The
 * transform:scale at the outer level handles all responsive work.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';

const STAGE_W = 3840;
const STAGE_H = 2160;

interface Props {
  children: ReactNode;
  /** Optional inline style applied to the 3840×2160 stage div. */
  stageStyle?: React.CSSProperties;
  /** Optional className applied to the 3840×2160 stage div. */
  stageClassName?: string;
}

export function HsStage({ children, stageStyle, stageClassName }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const k = Math.min(rect.width / STAGE_W, rect.height / STAGE_H);
      setScale(k);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (viewportRef.current) ro.observe(viewportRef.current);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

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
      <div
        className={stageClassName}
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          position: 'relative',
          overflow: 'hidden',
          flexShrink: 0,
          ...stageStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export { STAGE_W, STAGE_H };
