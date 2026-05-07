"use client";

/**
 * ScaledTemplateThumbnail — renders a template preview at the template's
 * NATURAL resolution (e.g. 1920×1080) and then uses CSS `transform: scale()`
 * to shrink the whole thing proportionally into the card's visible area.
 *
 * Why not just render widgets at the small size directly? Because the
 * widget components (ClockWidget, WeatherWidget, themed variants, etc.)
 * use `em`/`rem`/`px` sizing internally. A ticker with font-size 2rem
 * doesn't shrink when the container shrinks — it just overflows or gets
 * clipped. Scaling via transform keeps every font, icon, and layout
 * proportion exactly right, so the gallery card looks like a TRUE
 * thumbnail of the actual template instead of a squished mess.
 */

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// Lazy-load the entire widget catalog (WidgetRenderer.tsx is 2000+ lines
// that transitively imports ~40 theme modules + the 3 animated welcome
// scenes + all generic widgets). Without dynamic() here, every route that
// mounts the templates gallery SSR/CSR — and every component that imports
// ScaledTemplateThumbnail — drags that entire bundle in. With dynamic()
// Next splits it into a separate chunk that only loads when a tile
// intersects the viewport (we already IO-gate the <WidgetPreview> call
// below — see isVisible). Combined effect: /templates first paint cost
// is decoupled from how many themes are installed.
const WidgetPreview = dynamic(
  () => import('@/components/widgets/WidgetRenderer').then((m) => ({ default: m.WidgetPreview })),
  { ssr: false, loading: () => null },
);

interface Zone {
  id?: string;
  widgetType: string;
  x: number; y: number; width: number; height: number;
  zIndex?: number | null;
  defaultConfig?: any;
}

interface Props {
  zones: Zone[];
  screenWidth: number;
  screenHeight: number;
  bgImage?: string | null;
  bgGradient?: string | null;
  bgColor?: string | null;
  /** Fallback max height for the scaled preview (px). */
  maxHeight?: number;
}

/** Small class error-boundary — one broken widget can't blank the preview. */
class ZoneBoundary extends React.Component<{ children: React.ReactNode }, { broke: boolean }> {
  state = { broke: false };
  static getDerivedStateFromError() { return { broke: true }; }
  render() {
    if (this.state.broke) return <div style={{ width: '100%', height: '100%', background: 'rgba(244,63,94,0.05)' }} />;
    return this.props.children;
  }
}

/** Builds the outer background style using ONLY longhand props so React
 *  doesn't warn about shorthand/longhand collision on re-render. */
function bgStyle(bgImage?: string | null, bgGradient?: string | null, bgColor?: string | null): React.CSSProperties {
  const s: React.CSSProperties = {
    backgroundColor: bgColor || '#ffffff',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
  if (bgImage) {
    s.backgroundImage = bgImage.trim().startsWith('url(') ? bgImage : `url(${bgImage})`;
  } else if (bgGradient) {
    s.backgroundImage = bgGradient;
  }
  return s;
}

export function ScaledTemplateThumbnail({
  zones, screenWidth, screenHeight, bgImage, bgGradient, bgColor, maxHeight = 150,
}: Props) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(0);

  // 2026-05-07 — DEMO HOTFIX: IntersectionObserver gate was causing
  // template cards to collapse on scroll. Even after fixing the
  // live-prop forwarding bug in WidgetRenderer (16 HS widgets were
  // running setInterval every 30s in thumbnails because the parent
  // forgot to pass `live={live}` after a signature change), the IO
  // gate is still mis-firing in production. Force always-visible
  // for the demo. Re-litigate the perf optimization post-demo.
  const [isVisible] = useState(true);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const compute = () => {
      // Use getBoundingClientRect — clientWidth can be 0 during hydration
      // on flex children that haven't been measured yet.
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        setScale(rect.width / screenWidth);
      }
    };
    compute();
    // Re-measure on the next frame as well — aspect-ratio + maxHeight
    // sometimes resolves width after the first paint.
    const raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [screenWidth]);

  // 2026-05-07 — DEMO HOTFIX #2.
  // Old version measured parentElement.getBoundingClientRect().width via
  // ResizeObserver and computed cardWidth = min(parentWidth, widthFromHeight).
  // BUG: when scrolling triggered a layout reflow, RO sometimes reported a
  // tiny non-zero width (e.g. 1px) during the reflow tick. The `||` fallback
  // only triggered on 0/null, not small numbers — so cardWidth got stuck at
  // 1px and every card collapsed to a thin grey bar. This is what the
  // operator was seeing on scroll.
  //
  // Fix: use pure CSS — width 100% capped by max-width, height derived from
  // aspect-ratio. No JS layout measurement, no ResizeObserver, no way to
  // get stuck in a bad state.
  const aspect = screenWidth / screenHeight;
  const widthFromHeight = maxHeight * aspect;
  const effectiveScale = scale > 0 ? scale : widthFromHeight / screenWidth;

  return (
    <div
      ref={outerRef}
      className="relative overflow-hidden rounded-lg border border-slate-200 shadow-sm mx-auto"
      style={{
        width: '100%',
        maxWidth: widthFromHeight,
        aspectRatio: `${screenWidth} / ${screenHeight}`,
        ...bgStyle(bgImage, bgGradient, bgColor),
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: screenWidth,
          height: screenHeight,
          transform: `scale(${effectiveScale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {isVisible && zones.map((zone, i) => (
          <div
            key={zone.id ?? i}
            className="absolute overflow-hidden"
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              zIndex: zone.zIndex || 0,
            }}
          >
            <ZoneBoundary>
              <WidgetPreview
                widgetType={zone.widgetType}
                config={zone.defaultConfig || {}}
                width={zone.width}
                height={zone.height}
                live={false}
              />
            </ZoneBoundary>
          </div>
        ))}
      </div>
    </div>
  );
}
