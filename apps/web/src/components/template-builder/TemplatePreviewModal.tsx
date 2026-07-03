"use client";

/**
 * TemplatePreviewModal — fullscreen "what does this look like on a TV?"
 * preview for the template builder.
 *
 * 2026-05-10 — operator: "we need a preview button to see the template
 * before we post it". The existing "Live preview" toggle in the
 * builder toolbar only hides the side panels — the canvas is still at
 * builder zoom and widgets render with `live={false}` (videos don't
 * autoplay, transitions don't fire). What the operator actually wants
 * is a true preview: full template at native resolution (e.g.
 * 1920×1080), scaled to fit their browser viewport, with widgets
 * running in `live={true}` mode so videos play, IMAGE_CAROUSEL rotates,
 * and animations run.
 *
 * Behavior:
 *   - Modal opens fullscreen, dark backdrop, single template canvas
 *     centered + letterboxed if aspect ratios don't match.
 *   - Esc / X button / backdrop click closes.
 *   - Renders every zone via WidgetPreview with `live={true}`.
 *   - Uses the same transform:scale pattern as ScaledTemplateThumbnail.
 *
 * Out of scope (intentionally):
 *   - This is NOT the player — there's no playlist rotation,
 *     emergency override, or device pairing. It's a single-template
 *     preview for "did I build the right layout?" review before
 *     publishing.
 *
 * task #290 (2026-07-03) — `live={true}` here is deliberately a BUILDER
 * signal, not a player one: it means "run this preview as if it's really
 * playing" (autoplay video, rotate carousels) for a genuinely un-scheduled
 * template. Do NOT add `renderSurface="player"` to the WidgetPreview call
 * below — that prop is reserved for the two components that render a REAL
 * screen (apps/web/src/app/player/page.tsx, apps/web/src/components/
 * player/TouchOverlay.tsx). Sport widgets (CtsScoreboard/CtsRibbonWidgets,
 * MainScoreboardWidget, SwimDiveWidgets) read RenderSurfaceContext to
 * decide SAMPLE-vs-NEUTRAL; omitting `renderSurface` here (defaulting to
 * 'builder') is what keeps this preview showing the alive SAMPLE instead
 * of a "NO GAME BOUND" / neutral-dash state a real screen would show.
 */

import { useEffect, useRef, useState } from 'react';
import { X as XIcon } from 'lucide-react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { WidgetErrorBoundary } from '@/components/widgets/WidgetErrorBoundary';
import type { Zone } from './types';

type Props = {
  open: boolean;
  onClose: () => void;
  zones: Zone[];
  screenWidth: number;
  screenHeight: number;
  bgColor?: string;
  bgGradient?: string;
  bgImage?: string;
  templateName?: string;
};

function bgStyle(bgImage?: string, bgGradient?: string, bgColor?: string): React.CSSProperties {
  // Match the canvas's layered approach: solid color underneath, then
  // gradient, then image on top. Keeps templates that mix all three
  // (e.g. Sunny Meadow) looking right in preview.
  const layers: string[] = [];
  if (bgImage) layers.push(`url(${bgImage}) center/cover no-repeat`);
  if (bgGradient) layers.push(bgGradient);
  return {
    background: layers.length > 0 ? layers.join(', ') : (bgColor || '#ffffff'),
    backgroundColor: layers.length === 0 ? bgColor : undefined,
  };
}

export function TemplatePreviewModal({
  open, onClose, zones, screenWidth, screenHeight,
  bgColor, bgGradient, bgImage, templateName,
}: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // Esc closes. Mounted only when open so the listener doesn't
  // intercept Esc during normal builder use.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Compute the largest scale that fits the template inside the
  // available viewport (minus padding for the close button + name pill).
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const sx = rect.width / screenWidth;
      const sy = rect.height / screenHeight;
      setScale(Math.min(sx, sy));
    };
    compute();
    const raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [open, screenWidth, screenHeight]);

  if (!open) return null;

  const stageW = screenWidth * scale;
  const stageH = screenHeight * scale;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-slate-950/95 backdrop-blur-md flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${templateName || 'Template'}`}
    >
      {/* Top bar — name + close */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0">
        <div className="text-white/90 text-sm font-bold truncate">
          {templateName || 'Template Preview'}
          <span className="ml-3 text-[10px] font-mono text-white/50">
            {screenWidth}&times;{screenHeight}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-white/50">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">Esc</kbd> to close
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <XIcon className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Stage — fills the remaining viewport, centered. Click on the
          backdrop closes; click on the stage itself does not. */}
      <div
        ref={stageRef}
        className="flex-1 flex items-center justify-center overflow-hidden p-4"
        onClick={onClose}
      >
        <div
          className="relative shadow-2xl ring-1 ring-white/10 overflow-hidden"
          style={{
            width: stageW,
            height: stageH,
            ...bgStyle(bgImage, bgGradient, bgColor),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Native-resolution stage; transform:scale shrinks it to fit. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: screenHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="absolute overflow-hidden"
                style={{
                  left: `${zone.x}%`,
                  top: `${zone.y}%`,
                  width: `${zone.width}%`,
                  height: `${zone.height}%`,
                  zIndex: zone.zIndex || 0,
                }}
              >
                <WidgetErrorBoundary resetKey={zone.id} widgetLabel={zone.widgetType}>
                  {/* live={true} — videos autoplay (muted), carousels
                      rotate, animations run. The WHOLE point of preview:
                      see what the screen actually does. NO `renderSurface`
                      — this is a builder surface (task #290); sport
                      widgets must keep showing their alive SAMPLE here,
                      never the "no game bound" neutral state a real
                      screen shows. */}
                  <WidgetPreview
                    widgetType={zone.widgetType}
                    config={zone.defaultConfig || {}}
                    width={zone.width}
                    height={zone.height}
                    live={true}
                  />
                </WidgetErrorBoundary>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
