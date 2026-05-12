"use client";

/**
 * TouchOverlay — Phase D1.5 (touch builder v1) overlay layer.
 *
 * Renders on top of the player playback chrome when a visitor taps a
 * tap-action zone whose action resolves to an overlay (open-url
 * default, play-video, or show-overlay). Mirrors the iframe + video
 * + image render paths the playback layer already uses, but in a
 * modal frame with a tap-outside dismiss.
 *
 * Asset resolution:
 *   - If target looks like an http(s) URL → use it directly
 *   - Otherwise treat as an asset UUID → GET /api/v1/assets/:id to
 *     resolve to a file URL + mime type
 *
 * The component is intentionally minimal — no styling beyond a black
 * backdrop + close affordance. It's a v1 ship; richer animations,
 * pinch-zoom, and image carousels can layer on later.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X as XIcon, Volume2, VolumeX } from 'lucide-react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';

type TouchOverlayShape =
  | { kind: 'iframe'; url: string }
  | { kind: 'video'; assetId: string; returnOnEnd: boolean }
  | { kind: 'asset'; assetId: string };

interface ResolvedAsset {
  url: string;
  mimeType: string;
}

export function TouchOverlay({
  overlay,
  muted,
  onClose,
  onSoundToggle,
}: {
  overlay: TouchOverlayShape | null;
  muted: boolean;
  onClose: () => void;
  onSoundToggle: () => void;
}) {
  const [resolved, setResolved] = useState<ResolvedAsset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Resolve the target whenever the overlay opens or its target changes.
  useEffect(() => {
    if (!overlay) {
      setResolved(null);
      setLoadError(null);
      return;
    }

    const target =
      overlay.kind === 'iframe' ? overlay.url :
      overlay.kind === 'video' ? overlay.assetId :
      overlay.assetId;

    // Full URL → use directly. For iframe-kind, the proxy-rewrite
    // pattern from the existing playback iframe is reused so
    // X-Frame-Options doesn't strand the visitor on a blank page.
    if (/^https?:\/\//i.test(target)) {
      if (overlay.kind === 'iframe') {
        // Route through the proxy with interactive=true (matches
        // playback iframe behavior). The proxy strips X-Frame-Options
        // + CSP frame-ancestors so the page actually renders.
        const apiRoot =
          (typeof window !== 'undefined' && (window as any).__edu_api_root) ||
          (process.env.NEXT_PUBLIC_API_URL || '');
        const proxied = `${apiRoot}/api/v1/proxy/web?url=${encodeURIComponent(target)}&v=2&interactive=true`;
        setResolved({ url: proxied, mimeType: 'text/html' });
      } else {
        // Direct video/image URL — guess mime by extension. Browser
        // <video> + <img> tolerate occasional wrong-mime headers so
        // this is a heuristic, not a correctness gate.
        const lower = target.toLowerCase();
        const isVid = /\.(mp4|webm|mov|m4v)(\?|$)/.test(lower);
        setResolved({ url: target, mimeType: isVid ? 'video/mp4' : 'image/*' });
      }
      setLoadError(null);
      return;
    }

    // UUID-ish → fetch /api/v1/assets/:id to resolve.
    let cancelled = false;
    (async () => {
      try {
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('edu_cms_token') || localStorage.getItem('edu_device_token') || ''
            : '';
        const apiRoot = process.env.NEXT_PUBLIC_API_URL || '';
        const res = await fetch(
          `${apiRoot}/api/v1/assets/${encodeURIComponent(target)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(`Asset fetch failed (HTTP ${res.status})`);
          return;
        }
        const a = await res.json();
        setResolved({ url: a.fileUrl || a.url || '', mimeType: a.mimeType || 'image/*' });
      } catch (e) {
        if (!cancelled) setLoadError((e as Error)?.message || 'Asset fetch error');
      }
    })();
    return () => { cancelled = true; };
  }, [overlay]);

  // Esc to close — consistent with the dashboard's modal pattern.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, onClose]);

  if (!overlay) return null;

  const inner = (() => {
    if (loadError) {
      return (
        <div className="text-white text-center p-12">
          <p className="text-2xl font-bold mb-2">Couldn’t load content</p>
          <p className="text-sm opacity-70">{loadError}</p>
        </div>
      );
    }
    if (!resolved) {
      return <div className="text-white text-sm opacity-70">Loading…</div>;
    }
    if (overlay.kind === 'iframe') {
      return (
        <iframe
          src={resolved.url}
          className="w-full h-full border-0 bg-white"
          title="Tap-action overlay"
        />
      );
    }
    if (overlay.kind === 'video' || resolved.mimeType.startsWith('video/')) {
      return (
        <video
          src={resolved.url}
          className="max-w-full max-h-full"
          autoPlay
          muted={muted}
          controls={false}
          playsInline
          onEnded={() => {
            if (overlay.kind === 'video' && overlay.returnOnEnd) onClose();
          }}
        />
      );
    }
    // asset / image
    return (
      <img
        src={resolved.url}
        alt=""
        className="max-w-full max-h-full object-contain"
      />
    );
  })();

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[120] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top-right close button. Larger tap target than the dashboard
          modals because kiosk visitors aren't precision-clicking with
          a mouse — they're using fingertips on a TV-sized display. */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
        aria-label="Close"
      >
        <XIcon className="w-6 h-6" />
      </button>
      {/* Sound toggle — only renders for video overlays. Bottom-left
          so a thumb can find it on a portrait kiosk without
          stretching toward the X. */}
      {(overlay.kind === 'video' || (resolved?.mimeType.startsWith('video/'))) && (
        <button
          type="button"
          onClick={onSoundToggle}
          className="absolute bottom-6 left-6 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
        </button>
      )}
      <div className="w-[90vw] h-[90vh] flex items-center justify-center">
        {inner}
      </div>
    </div>
  );
}

/**
 * TouchNavOverlay — Phase D2.7 (2026-05-12).
 *
 * Full-screen render of a navigated-to template with a back chip.
 * Visitor lands here after tapping a goto-template action; tap "Back"
 * or wait for idle to return home.
 *
 * v2 (this revision) renders the target template's zones via the same
 * `WidgetPreview` the builder uses, scaled via transform:scale to fit
 * the viewport. Same pattern the gallery thumbnails use
 * (ScaledTemplateThumbnail) so coordinates stay pixel-accurate at any
 * viewport size. live=true so widgets behave as on the main player
 * (clocks tick, weather fetches, etc.).
 *
 * Limitations / honest scope:
 *   - Stateless: every visit re-mounts the widgets (no carryover).
 *   - No audio sync with the underlying player — audio toggles still
 *     route via the existing edu:touch-sound-toggle event.
 *   - Animations restart on every nav (acceptable for v1).
 *   - Renders the template's default scene only. goto-scene fires the
 *     edu:touch-scene-change event which the host player intercepts
 *     before reaching this overlay, so this code path only handles
 *     cross-template nav.
 */
export function TouchNavOverlay({
  template,
  onBack,
}: {
  template: any;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const screenWidth = template?.screenWidth || 1920;
  const screenHeight = template?.screenHeight || 1080;

  // Compute the transform:scale every time the container resizes so
  // the rendered scene fits the available viewport. Same math the
  // gallery's `ScaledTemplateThumbnail` uses. Padding accounts for the
  // back-chip + breathing room around the canvas.
  useLayoutEffect(() => {
    const recompute = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const sx = w / screenWidth;
      const sy = h / screenHeight;
      setScale(Math.min(sx, sy));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [screenWidth, screenHeight]);

  // Pick the default scene (or first by sort order). Mirrors the
  // player's `defaultScene` resolution. Zones with `sceneId === null`
  // render in every scene (shared); zones with a matching `sceneId`
  // render on the active scene; zones with a *different* sceneId stay
  // hidden so visitors see only the intended slice.
  const scenes: Array<{ id: string; isDefault: boolean; sortOrder: number }> = Array.isArray(template?.scenes) ? template.scenes : [];
  const defaultScene = scenes.find((s) => s.isDefault) || scenes[0] || null;
  const allZones: any[] = Array.isArray(template?.zones) ? template.zones : [];
  const zones = defaultScene
    ? allZones.filter((z) => !z.sceneId || z.sceneId === defaultScene.id)
    : allZones;

  // Background paint — same precedence the playback layer uses: image
  // wins over gradient wins over color, with a default-black fallback.
  const bgStyle: React.CSSProperties = (() => {
    if (template?.bgImage) {
      return { background: `#000 url(${template.bgImage}) center/cover no-repeat` };
    }
    if (template?.bgGradient) return { background: template.bgGradient };
    if (template?.bgColor) return { background: template.bgColor };
    return { background: '#000' };
  })();

  return (
    <div className="fixed inset-0 bg-black z-[115] flex flex-col" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onBack}
        className="absolute top-6 left-6 z-10 px-4 py-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-sm font-semibold backdrop-blur-sm transition-colors"
        aria-label="Back to previous scene"
      >
        ← Back
      </button>

      {/* Scaling pane. Outer ref provides the measurement viewport;
          inner div is the *fixed-pixel* canvas at the template's
          natural resolution; transform:scale shrinks it to fit. */}
      <div ref={containerRef} className="flex-1 relative flex items-center justify-center">
        {zones.length === 0 ? (
          // Hard-empty template fallback. Could happen if a freshly-
          // created template was navigated to without any zones; better
          // to communicate than to leave a black screen.
          <div className="text-white text-center px-8">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-2">
              Empty scene
            </p>
            <h2 className="text-4xl font-black mb-3">{template?.name || 'Untitled'}</h2>
            <p className="text-sm text-white/50">This template has no widgets yet. Tap "← Back" to return.</p>
          </div>
        ) : (
          <div
            style={{
              width: screenWidth,
              height: screenHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              position: 'relative',
              ...bgStyle,
            }}
          >
            {zones
              .slice()
              .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
              .map((z) => (
                <div
                  key={z.id}
                  style={{
                    position: 'absolute',
                    left: `${z.x}%`,
                    top: `${z.y}%`,
                    width: `${z.width}%`,
                    height: `${z.height}%`,
                    zIndex: z.zIndex ?? 0,
                    overflow: 'hidden',
                  }}
                >
                  <WidgetPreview
                    widgetType={z.widgetType}
                    config={z.defaultConfig || {}}
                    width={z.width}
                    height={z.height}
                    live={true}
                  />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
