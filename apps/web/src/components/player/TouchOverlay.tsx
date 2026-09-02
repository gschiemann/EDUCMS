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

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X as XIcon, Volume2, VolumeX } from 'lucide-react';
// P0-3 — this file is imported by /player's boot path, so it must NOT name
// `WidgetRenderer` statically: doing so dragged the whole widget catalog
// back in front of registration through the side door. The renderer comes
// from the shared lazy island instead. See app/player/lazyRenderer.ts.
import { LazyTouchZoneWidget } from '@/app/player/lazyRenderer';

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

  // 2026-05-14 — operator: "touch load a 404 error on the URL".
  // Root cause: TouchOverlay built proxy/asset URLs as
  // `${process.env.NEXT_PUBLIC_API_URL}/api/v1/...` — but the env
  // var on Vercel ALREADY includes `/api/v1`, so the resolved URL
  // became `…/api/v1/api/v1/proxy/web?...` (double-prefixed) which
  // Express routed to a 404. The rest of the player uses
  // `getApiRoot()` in player/page.tsx which strips `/api/v1` from
  // the env var before appending. Replicate that here so the
  // touch-overlay paths join cleanly regardless of how the env
  // var was set.
  const apiBase = (() => {
    const raw = (typeof window !== 'undefined' && (window as any).__edu_api_root)
      || process.env.NEXT_PUBLIC_API_URL
      || '';
    return raw.replace(/\/api\/v1\/?$/, '');
  })();

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
        const proxied = `${apiBase}/api/v1/proxy/web?url=${encodeURIComponent(target)}&v=2&interactive=true`;
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

    // UUID-ish → fetch /api/v1/assets/:id/playback to resolve.
    //
    // 2026-05-14 — was hitting /assets/:id which didn't exist (404
    // routing failure → operator saw "webpage unavailable" Android
    // WebView error). Same audit miss as the templates /playback
    // endpoint; assets controller never had a single-asset GET at
    // all, only /list and /pending. New /:id/playback accepts
    // device JWTs and returns the playback-only fields.
    let cancelled = false;
    (async () => {
      try {
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('edu_cms_token') || localStorage.getItem('edu_device_token') || ''
            : '';
        // Same apiBase normalization as the iframe path (strips
        // trailing /api/v1 from the env var so we don't double-prefix).
        const res = await fetch(
          `${apiBase}/api/v1/assets/${encodeURIComponent(target)}/playback`,
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
      className="fixed top-0 right-0 bottom-0 left-0 bg-black/90 z-[120] flex items-center justify-center"
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
  idleReturnMs = 90_000,
}: {
  template: any;
  onBack: () => void;
  /** Auto-return-home after this many ms of no interaction. Defaults
   *  to 90s (matches typical kiosk-attention timeout); the parent
   *  player can override with its template-level idleResetMs. */
  idleReturnMs?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const screenWidth = template?.screenWidth || 1920;
  const screenHeight = template?.screenHeight || 1080;

  // Auto-return: visitor walks away mid-overlay → kiosk reverts to
  // the main playback so the next visitor sees the home screen, not
  // someone else's half-explored content. Any tap inside the overlay
  // resets the countdown (UX audit H3, 2026-05-12).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onBack(), idleReturnMs);
    };
    const onActivity = () => arm();
    arm();
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [onBack, idleReturnMs]);

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
  //
  // Structured form (separate properties rather than concatenated
  // `background:` shorthand) defeats the CSS-injection foot-gun where
  // a `)` inside an operator-controlled bgImage URL could break out
  // of `url(...)` and append arbitrary declarations (Security audit
  // MED-3, 2026-05-12). We also URL-escape backslashes + quotes in
  // the bg URL before interpolation.
  const bgStyle: React.CSSProperties = (() => {
    if (template?.bgImage) {
      const safe = String(template.bgImage).replace(/["\\]/g, (m) => `\\${m}`);
      return {
        backgroundColor: '#000',
        backgroundImage: `url("${safe}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    if (template?.bgGradient) return { background: template.bgGradient };
    if (template?.bgColor) return { background: template.bgColor };
    return { background: '#000' };
  })();

  return (
    <div className="fixed top-0 right-0 bottom-0 left-0 bg-black z-[115] flex flex-col" role="dialog" aria-modal="true">
      {/* Back chip — sized for a kiosk display viewed from 6-10 ft.
          Dashboard-sized text (14px) was unreadable across a school
          lobby (UX audit H1, 2026-05-12). text-2xl + tall padding +
          min width gives the visitor a fingertip-friendly target
          regardless of the underlying scene's background color
          (slate-900 capsule kills the white-on-white invisibility
          case). */}
      <button
        type="button"
        onClick={onBack}
        className="absolute top-8 left-8 z-10 inline-flex items-center px-6 py-4 rounded-full bg-slate-900/70 hover:bg-slate-900/85 text-white text-2xl font-bold backdrop-blur-md transition-colors min-w-[160px] justify-center"
        aria-label="Return to main display"
      >
        {/* Taurus-safety (CLAUDE.md rule #10): flex `gap-*` needs Chromium
            84+ and silently collapses on the Chromium-83 LED floor. Use an
            explicit margin on the spacing child instead of `gap-2`. */}
        <span aria-hidden className="mr-2">←</span>
        Back
      </button>

      {/* Scaling pane. Outer ref provides the measurement viewport;
          inner div is the *fixed-pixel* canvas at the template's
          natural resolution; transform:scale shrinks it to fit.

          2026-05-14 — operator: "the template one loads the
          template all small at the bottom of the screen". Root
          cause: prior version used `flex items-center
          justify-center` to center the inner div, but the inner
          div's LAYOUT box is the template's native res (e.g.
          3840×2160) — way bigger than the kiosk viewport (320×1080
          for a single-panel LED). Flex centering an oversized
          child overflows in unpredictable ways on Chromium 83 +
          various WebView builds; the operator saw the template
          render shrunk in a corner instead of filling the LED.

          Fix: positioned absolute with top-50% / left-50% +
          translate(-50%, -50%) AND scale in the same transform.
          Visual center is guaranteed regardless of how big the
          native layout box is; the parent only has to measure
          itself, not align an oversized child. */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {zones.length === 0 ? (
          // Hard-empty template fallback. Could happen if a freshly-
          // created template was navigated to without any zones.
          //
          // Visitor-facing copy — the audience here is a school
          // visitor in a lobby, NOT an operator. They have no idea
          // what a "widget" is. "Nothing to show here" + Back is the
          // entire message they need (UX audit G4, 2026-05-12).
          <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-white text-center px-8">
            <div>
              <h2 className="text-3xl font-black mb-3">Nothing to show here</h2>
              <p className="text-base text-white/60">Tap Back to return.</p>
            </div>
          </div>
        ) : (
          <div
            style={{
              width: screenWidth,
              height: screenHeight,
              // Center the LAYOUT box at the viewport center, then
              // translate by -50% of own size to anchor visually at
              // the same center. Stack `translate(...)` BEFORE
              // `scale(...)` so the translate compensates the full
              // native size; scaling then shrinks the visible
              // result symmetrically around that anchor.
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) scale(${scale})`,
              transformOrigin: 'center center',
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
                  <Suspense fallback={null}>
                    <LazyTouchZoneWidget
                      widgetType={z.widgetType}
                      config={z.defaultConfig || {}}
                      width={z.width}
                      height={z.height}
                    />
                  </Suspense>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
