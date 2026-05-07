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

  // IntersectionObserver gate — don't mount the widgets until the tile is
  // actually near the viewport. Gallery pages render ~60 template cards at
  // once; before this gate, every card mounted its full WidgetPreview tree
  // (inline <style> blocks, keyframe animations, ResizeObservers) on initial
  // paint even when it was 10 screens down. Now we render a cheap placeholder
  // div until ~400px from the viewport, then hydrate the real widgets.
  // Once mounted, stay mounted — remounting on scroll causes flicker.
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    if (isVisible) return;
    // SSR / old browsers: just show it.
    if (typeof IntersectionObserver === 'undefined') { setIsVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setIsVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '400px 0px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isVisible]);

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

  // Compute the card's on-screen dimensions directly so we don't depend
  // on aspect-ratio + maxHeight resolving to the right width. We pick the
  // LARGER rendering that still fits inside (maxWidth 100% of parent,
  // maxHeight).  Parent gives us width via ResizeObserver; height derives
  // from screen aspect.
  const [parentWidth, setParentWidth] = useState<number>(0);
  useEffect(() => {
    const el = outerRef.current?.parentElement;
    if (!el) return;
    const measure = () => setParentWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = screenWidth / screenHeight;
  // Fit inside (parentWidth × maxHeight) preserving aspect ratio.
  const widthFromHeight = maxHeight * aspect;
  const cardWidth = Math.max(1, Math.min(parentWidth || widthFromHeight, widthFromHeight));
  const cardHeight = cardWidth / aspect;
  const effectiveScale = scale > 0 ? scale : cardWidth / screenWidth;

  return (
    <div
      ref={outerRef}
      className="relative overflow-hidden rounded-lg border border-slate-200 shadow-sm mx-auto"
      style={{
        width: cardWidth,
        height: cardHeight,
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
