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
  /**
   * Gallery-grid freeze. When true, EXTERNAL_HTML board iframes load with
   * `freeze=1` so their baked shim renders ONE auto-fit frame then kills all
   * timers + animations (near-zero CPU). The grid passes `freeze` so dozens of
   * mounted 4K board iframes can't peg the main thread; the full-screen preview
   * modal renders a SINGLE board fully live, so it leaves freeze false.
   */
  freeze?: boolean;
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

/** For a board preview (a single EXTERNAL_HTML zone), the path to its
 *  pre-rendered static poster PNG under /templates/_thumbs/. The gallery grid
 *  shows this instead of mounting a live 3840×2160 iframe per card — an <img>
 *  is "just there" (one ~40KB cached image, no document/process), so the grid
 *  loads instantly and re-filters with zero cost. Returns null when there's no
 *  single EXTERNAL_HTML board url (zone-based templates render their widgets;
 *  a custom board with no generated poster falls back to the live frame). */
function posterFor(zones: Zone[]): string | null {
  if (!zones || zones.length !== 1) return null;
  const z = zones[0];
  if (z.widgetType !== 'EXTERNAL_HTML') return null;
  let cfg: any = z.defaultConfig;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { return null; } }
  // A customized board — operator applied brand / text / image / style
  // overrides — must render LIVE (frozen iframe with ?brand=/?text=/?img=) so
  // those show. The static poster is the pristine default look and would mask
  // the customization (e.g. "Apply brand did nothing" in the gallery).
  if (cfg && (cfg.brand || cfg.textOverrides || cfg.imageOverrides || cfg._styles)) return null;
  const url: unknown = cfg?.url;
  if (typeof url !== 'string' || !url.startsWith('/templates/')) return null;
  const clean = url.split('?')[0].split('#')[0];
  if (!clean.endsWith('.html')) return null;
  // A board that ships BOTH native compositions is one HTML file; the portrait
  // preset points at `...html?orientation=portrait`. Its poster is captured at
  // 9:16 beside the landscape one as `<name>-portrait.png` — without this the
  // stripped query would resolve a portrait card to the LANDSCAPE poster.
  const isPortrait = /[?&]orientation=portrait\b/.test(url);
  // Cache-bust: poster PNGs live at a stable URL, so a browser (and Vercel's
  // edge) hard-cache the OLD image after we regenerate a board's poster. Append
  // a version query so an updated poster is actually fetched. BUMP POSTER_VERSION
  // every time posters are regenerated (gen-template-posters.cjs / regen-*).
  return (
    clean.replace('/templates/', '/templates/_thumbs/').replace(/\.html$/, isPortrait ? '-portrait.png' : '.png') +
    `?v=${POSTER_VERSION}`
  );
}

/** Bump on every poster regeneration so browsers/CDN refetch the new PNGs.
 *  Date-based; append a letter for multiple regens in one day (…24b). */
const POSTER_VERSION = '20260816a';

export function ScaledTemplateThumbnail({
  zones, screenWidth, screenHeight, bgImage, bgGradient, bgColor, maxHeight = 150, freeze = false,
}: Props) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(0);
  // If a board's static poster 404s (e.g. a custom board with no generated
  // thumbnail), flip to the live-frame fallback below.
  const [posterFailed, setPosterFailed] = useState(false);

  // Two-way IntersectionObserver gate WITH HYSTERESIS — mount the widgets when
  // the tile nears the viewport, and UNMOUNT them once it scrolls well past, so
  // off-screen previews free their DOM / timers / iframes instead of piling up.
  //
  // Why this matters: the gallery renders ~114 EXTERNAL_HTML presets, each a
  // LIVE sandboxed 4K board iframe (live clock setInterval + keyframe anims +
  // scrolling ticker). The old gate mounted on first intersection and then
  // `io.disconnect()`-ed ("stay mounted") — so as the operator scrolled, dozens
  // of animating 4K iframes ACCUMULATED, pegged the main thread, and the browser
  // showed "page unresponsive." Unmounting off-screen tiles caps the live count.
  //
  // Hysteresis: mount when within ~600px of the viewport; unmount only once
  // MORE than ~1600px away. The 1000px gap between the two thresholds means
  // normal scrolling never sits a tile on the boundary, so it can't thrash /
  // flicker mount↔unmount. Both observers stay connected for the tile's life
  // (no permanent disconnect), so a tile that scrolls back into view re-mounts.
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    // SSR / old browsers: just show it (and keep it shown).
    if (typeof IntersectionObserver === 'undefined') { setIsVisible(true); return; }
    const mountIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setIsVisible(true); break; }
        }
      },
      { rootMargin: '600px 0px', threshold: 0 },
    );
    const unmountIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Not intersecting even the 1600px-expanded viewport → it's well
          // off-screen → tear the widget subtree (incl. iframe) down.
          if (!e.isIntersecting) { setIsVisible(false); break; }
        }
      },
      { rootMargin: '1600px 0px', threshold: 0 },
    );
    mountIO.observe(el);
    unmountIO.observe(el);
    return () => { mountIO.disconnect(); unmountIO.disconnect(); };
  }, []);

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

  // Gallery grid: render the lightweight static poster instead of a live iframe.
  // `freeze` is true only for the grid (the full-screen preview + builder pass
  // freeze=false and keep the live frame). If the poster 404s — e.g. a custom
  // board with no generated thumbnail — onError flips to the live render below.
  const posterUrl = freeze ? posterFor(zones) : null;
  if (posterUrl && !posterFailed) {
    return (
      <div
        ref={outerRef}
        className="relative overflow-hidden rounded-lg border border-slate-200 shadow-sm mx-auto"
        style={{ width: cardWidth, height: cardHeight, ...bgStyle(bgImage, bgGradient, bgColor) }}
      >
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setPosterFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
        />
      </div>
    );
  }

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
                freeze={freeze}
              />
            </ZoneBoundary>
          </div>
        ))}
      </div>
    </div>
  );
}
