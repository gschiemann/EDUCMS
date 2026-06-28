"use client";

/**
 * Sprint 5: Emergency overlay for the player/kiosk.
 *
 * Subscribes to active emergency messages for a tenant via HTTP polling
 * (matches the existing fallback pattern — WebSocket attachment is wired
 * at the player page level; this overlay only needs the latest state).
 *
 * Renders on top of the running playlist. Severity drives the visual:
 *   INFO     — yellow banner, non-intrusive
 *   WARN     — orange banner with accent
 *   CRITICAL — full-screen red, flashing border
 *
 * SOS and MEDIA_ALERT render the full overlay. TEXT_BROADCAST shows a
 * banner-style overlay unless severity is CRITICAL.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldAlert, Megaphone, Volume2 } from 'lucide-react';

/**
 * P0 (2026-06-27, Greg live-tested on the 960×1080 LED) — the full-screen
 * emergency render used FIXED sizes (text-8xl headline, w-32 icon, p-12) and
 * centered with NO fit. On a portrait / non-1080p canvas a real lockdown
 * message wraps taller than the viewport and centered overflow CLIPS it top
 * AND bottom → unreadable life-safety text. Unacceptable.
 *
 * FitToViewport measures the natural content size vs the available space and
 * scales the whole block DOWN (never up) with a CSS transform so the message
 * is ALWAYS the largest size that fully fits — on 960×1080, 320×1080 ribbons,
 * 4K, anything. transform:scale is Chromium-83-safe (Taurus). Re-measures on
 * resize + font load. A one-frame unscaled flash self-corrects instantly.
 */
function FitToViewport({ children, padding = 40 }: { children: React.ReactNode; padding?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const aw = outer.clientWidth - padding * 2;
      const ah = outer.clientHeight - padding * 2;
      // scrollWidth/Height = the UNtransformed natural size (transform is
      // visual only, doesn't change the layout box), so this never feeds back.
      const cw = inner.scrollWidth;
      const ch = inner.scrollHeight;
      if (cw <= 0 || ch <= 0 || aw <= 0 || ah <= 0) return;
      const s = Math.min(1, aw / cw, ah / ch);
      setScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      if (outerRef.current) ro.observe(outerRef.current);
      if (innerRef.current) ro.observe(innerRef.current);
    }
    const fonts = (document as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready?.then) fonts.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [children, padding]);

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        ref={innerRef}
        style={{
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * P0 (2026-06-28, Greg live-caught on the 960×1080 LED): "the emergency text
 * is cut off by half — it thinks it's 1920×1080."
 *
 * Root cause: the full-screen emergency root is `position: fixed` and, on a
 * NovaStar/Taurus controller, `position:fixed` resolves to the WebView's
 * frame-buffer VIEWPORT (forced 1920×1080 minimum) — NOT the LED's actual
 * visible canvas (e.g. 960×1080). So FitToViewport measured 1920 wide, sized
 * the message to 1920, and the panel only shows the top-left 960 → the right
 * half is cropped off the wall. Normal playlist content doesn't have this
 * problem because it renders inside TemplateScaler, which measures its
 * canvas-pinned parent (960) and scales to fit; the emergency overlay is
 * mounted OUTSIDE that scaler.
 *
 * Fix: size the emergency takeover to the LED's real canvas — read the same
 * `edu_canvasW/edu_canvasH` (URL param → localStorage) that TemplateScaler /
 * layout.tsx use, and anchor the overlay TOP-LEFT (the region a NovaStar/TB
 * controller lights up by default with zero pixel-mapping). When no canvas
 * override is set (a normal 1920×1080 screen / admin browser preview) we fall
 * back to the full viewport via top/right/bottom/left:0 — no vw/vh (those are
 * unreliable inside a 90°-rotated preview body on Taurus). Re-reads on resize
 * + storage so a late canvas-set (manifest applies it after mount) is honored.
 */
function useLedCanvas(activeKey: string | null): { w: number | null; h: number | null } {
  const [dims, setDims] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });
  useEffect(() => {
    const read = () => {
      try {
        const p = new URLSearchParams(window.location.search);
        const uw = parseInt(p.get('canvasW') || '', 10);
        const uh = parseInt(p.get('canvasH') || '', 10);
        const lw = parseInt(localStorage.getItem('edu_canvasW') || '', 10);
        const lh = parseInt(localStorage.getItem('edu_canvasH') || '', 10);
        const w = uw > 0 ? uw : (lw > 0 ? lw : null);
        const h = uh > 0 ? uh : (lh > 0 ? lh : null);
        setDims((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      } catch {
        /* ignore — fall back to viewport */
      }
    };
    read();
    // CRITICAL (2026-06-28, Greg live-caught round 2 — still cut off at 1920):
    // the player writes `edu_canvasW` to localStorage only AFTER it fetches the
    // manifest, which is AFTER this overlay has mounted — and a same-tab
    // `localStorage.setItem` does NOT fire a `storage` event. So a mount-only
    // read caches null and the takeover falls back to the 1920 frame-buffer
    // viewport FOREVER (the playlist fits 960 via its own manifest-watching
    // effect, but the emergency overlay had no such effect → it alone stayed at
    // 1920). Poll so we pick up the canvas within ~1s of it being set, and
    // re-read whenever an emergency becomes active (activeKey changes) so the
    // value is always fresh at the moment the alert is shown.
    const iv = setInterval(read, 1000);
    window.addEventListener('storage', read);
    window.addEventListener('resize', read);
    return () => {
      clearInterval(iv);
      window.removeEventListener('storage', read);
      window.removeEventListener('resize', read);
    };
  }, [activeKey]);
  return dims;
}

export interface EmergencyMessageView {
  id: string;
  type: 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  textBlob: string | null;
  mediaUrls: string[];
  audioUrl: string | null;
  expiresAt: number | null;
  createdAt: string;
}

interface Props {
  /** Pre-resolved active message (e.g. pushed via WebSocket).  */
  message?: EmergencyMessageView | null;
  /** Optional polling config — when provided, overlay self-fetches. */
  tenantId?: string;
  apiUrl?: string;
  pollMs?: number;
  /**
   * P0-2 (life-safety) — paired kiosks carry a DEVICE JWT, not a user
   * session cookie. When set, the overlay polls the DEVICE-authed
   * GET /emergency/messages endpoint with `Authorization: Bearer`
   * instead of the user-session GET /emergency/status (which 401s for
   * devices). `screenId` is required by the device endpoint's auth
   * (the token's sub must match), but the server reads it from the
   * token — we pass it only to gate which path we take.
   */
  screenId?: string | null;
  deviceToken?: string | null;
}

// `solidBg` is a raw hex applied via INLINE style so the emergency takeover
// ALWAYS paints opaque — even if Tailwind fails to load on the kiosk WebView
// (a real Taurus failure mode, cf. the 2026-05-13 "template went black"
// bug). Relying on the `bg-*` CLASS alone meant that when Tailwind didn't
// load, the overlay was transparent and the running playlist showed straight
// through behind the alert (Greg live-caught this on the 960×1080 LED). Hex
// values match the Tailwind classes (yellow-400 / orange-500 / red-700) at
// FULL opacity — a life-safety takeover must never be see-through.
const severityStyles = {
  INFO: {
    bg: 'bg-yellow-400',
    solidBg: '#facc15',
    border: 'border-yellow-600',
    text: 'text-slate-900',
    icon: Megaphone,
    animate: '',
  },
  WARN: {
    bg: 'bg-orange-500',
    solidBg: '#f97316',
    border: 'border-orange-700',
    text: 'text-white',
    icon: AlertTriangle,
    animate: '',
  },
  CRITICAL: {
    bg: 'bg-red-700',
    solidBg: '#b91c1c',
    border: 'border-red-900',
    text: 'text-white',
    icon: ShieldAlert,
    animate: 'animate-pulse',
  },
} as const;

export function EmergencyOverlay({ message, tenantId, apiUrl, pollMs = 10000, deviceToken }: Props) {
  const [polled, setPolled] = useState<EmergencyMessageView | null>(null);
  // LED canvas (960×1080 etc.) so the takeover sizes to the visible panel, not
  // the 1920 frame-buffer viewport. See useLedCanvas above (Greg's "cut off by
  // half / thinks it's 1920×1080" P0). Pass the active message id so the canvas
  // is re-read the instant an alert fires (the value is set by the manifest
  // after this overlay first mounts).
  const canvas = useLedCanvas(message?.id ?? polled?.id ?? null);

  useEffect(() => {
    if (message || !apiUrl) return;
    // A paired kiosk needs EITHER a device token (device-authed path)
    // or a tenantId (user-session path). Without either we can't poll.
    if (!deviceToken && !tenantId) return;

    let stopped = false;
    const tick = async () => {
      try {
        // P0-2 (life-safety): a paired kiosk has a DEVICE JWT, not a
        // session cookie. Hit the device-authed /emergency/messages
        // endpoint with a Bearer token. Only fall back to the
        // user-session /emergency/status (cookie) when no device token
        // exists (admin browser preview of the player). Previously this
        // ALWAYS used credentials:'include' → 401 on kiosks → the
        // `if (!res.ok) return` below swallowed it, so SOS / broadcast
        // / media alerts never reached the wall when the WS was down.
        const res = deviceToken
          ? await fetch(`${apiUrl}/emergency/messages`, {
              headers: { Authorization: `Bearer ${deviceToken}` },
            })
          : await fetch(`${apiUrl}/emergency/status?tenantId=${encodeURIComponent(tenantId || '')}`, {
              credentials: 'include',
            });
        if (stopped) return;
        if (!res.ok) {
          // Do NOT swallow silently (the old bug). A 401/403 here means
          // the kiosk can't read its own emergency state — a life-safety
          // delivery failure that must be visible in the player console.
          console.warn(
            `[EmergencyOverlay] poll failed: ${res.status} ${res.statusText} ` +
              `(${deviceToken ? 'device' : 'session'} path) — alerts may not reach this screen if the WebSocket is also down`,
          );
          return;
        }
        const json = await res.json();
        const active: EmergencyMessageView[] = (json.active || []).map((r: any) => ({
          id: r.id,
          type: r.type,
          severity: r.severity,
          textBlob: r.textBlob,
          mediaUrls: Array.isArray(r.mediaUrls) ? r.mediaUrls : [],
          audioUrl: r.audioUrl,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
        }));
        // Highest severity first, then newest.
        const order = { CRITICAL: 0, WARN: 1, INFO: 2 } as const;
        active.sort((a, b) => (order[a.severity] - order[b.severity]) || b.createdAt.localeCompare(a.createdAt));
        setPolled(active[0] || null);
      } catch {
        /* ignore — offline; overlay stays on last known state */
      }
    };

    tick();
    const h = setInterval(tick, pollMs);
    return () => { stopped = true; clearInterval(h); };
  }, [message, tenantId, apiUrl, pollMs, deviceToken]);

  const active = message || polled;
  if (!active) return null;

  const style = severityStyles[active.severity] || severityStyles.CRITICAL;
  const Icon = style.icon;

  // Banner-style for INFO text broadcasts, full-screen for everything else.
  const isBanner = active.type === 'TEXT_BROADCAST' && active.severity !== 'CRITICAL';

  // 2026-05-26 P0-5 — Chromium-83 sweep on a life-safety surface.
  // NovaStar Taurus LED controllers ship Chromium 83 and several K-12
  // pilots play on Taurus walls. CLAUDE.md rule #10 bans flex GAP
  // utilities (Chrome 84+; on 83 they collapse and icon+text stick
  // together → unreadable lockdown banner), Tailwind BLUR utilities
  // (Chromium 76+ but flaky on older Android WebView; renders as
  // transparent on Taurus), and vh/vw inside rotated bodies (player
  // preview mode). Fix: explicit margins instead of flex GAP, drop
  // the BLUR utility entirely (the /95 bg opacity is already nearly
  // opaque; blur was aesthetic polish, not load-bearing). Same render
  // on modern engines; correct render on Chromium 83.
  if (isBanner) {
    // 2026-06-27 (LANE 1 life-safety) — the banner is top-anchored and was a
    // plain `flex` row with `text-xl` and NO height bound + NO word-break. On a
    // narrow 320×1080 ribbon a long broadcast (or one long unbreakable word /
    // URL) overflowed horizontally and pushed the icon offscreen; on a short
    // canvas an unbounded banner could grow to cover the whole screen.
    // Fix — all readability, no logic change:
    //   • cap the banner at 40vh + `overflow-hidden` so it can NEVER become
    //     the whole canvas (40vh at text-xl holds ~12 lines — more than any
    //     real broadcast), and
    //   • `min-w-0` + `whitespace-pre-wrap` + `break-words` so a long word /
    //     URL wraps instead of running off a narrow ribbon edge.
    // Taurus-safe (no `inset`, no flex `gap` — the ml-4 stands in for a row
    // gap; vh on a top-anchored fixed bar is fine).
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`fixed top-0 left-0 z-[9999] ${style.bg} ${style.text} border-b-4 ${style.border} ${style.animate} px-8 py-4 flex items-center shadow-2xl overflow-hidden`}
        // Width pinned to the LED canvas (960 etc.) so the banner spans only the
        // visible panel, not the 1920 frame buffer. maxHeight in px off canvasH
        // when known (vh is unreliable in a rotated Taurus preview body).
        style={{
          width: canvas.w ? `${canvas.w}px` : undefined,
          right: canvas.w ? undefined : 0,
          maxHeight: canvas.h ? `${Math.round(canvas.h * 0.4)}px` : '40vh',
          backgroundColor: style.solidBg,
        }}
      >
        <Icon className="w-8 h-8 flex-shrink-0" />
        {/* ml-4 stand-in for a parent flex GAP (Chrome 84+ only). min-w-0 lets
            the text column actually shrink below its content width so wrapping
            kicks in on a narrow ribbon instead of overflowing the flex row. */}
        <div className="flex-1 min-w-0 text-xl font-bold leading-snug ml-4 whitespace-pre-wrap break-words">{active.textBlob}</div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed z-[9999] ${style.bg} ${style.text} ${style.animate}`}
      // FULL-VIEWPORT opaque backdrop — ALWAYS covers the entire frame buffer
      // so the running playlist can NEVER show behind a life-safety takeover.
      // (2026-06-28, Greg live-caught round 3: when the WHOLE overlay was shrunk
      // to the 960 canvas, the playlist showed through — the LED's visible panel
      // is WIDER than 960, so a 960-wide overlay only covered part of it and the
      // rest kept playing the playlist, even cycling slides. The pre-shrink
      // full-viewport overlay WAS solid; we keep that for the background and
      // confine only the TEXT to the canvas below.) Longhand only (Taurus-safe);
      // backgroundColor is the guaranteed-opaque paint even if Tailwind's bg
      // class fails to load on the kiosk WebView.
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: style.solidBg,
      }}
    >
      {/* Content region confined to the LED canvas (e.g. 960×1080), anchored
          TOP-LEFT (where a NovaStar/TB controller lights up by default), so the
          message FITS the visible panel instead of being sized to the 1920
          frame buffer (Greg's "cut off / thinks it's 1920" P0). Falls back to
          the full overlay (100%/100%) when no canvas override is set. The
          opaque background above always covers the whole panel regardless. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvas.w ? `${canvas.w}px` : '100%',
          height: canvas.h ? `${canvas.h}px` : '100%',
        }}
      >
      {active.severity === 'CRITICAL' && (
        <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 border-[12px] border-red-500 animate-pulse z-10" aria-hidden />
      )}

      {/* P0 2026-06-27 — scale-to-fit so the message is never clipped on a
          960×1080 / portrait / ribbon canvas (Greg live-caught the cutoff).
          max-w-6xl keeps long copy wrapping; FitToViewport shrinks the whole
          block to the largest size that fully fits. */}
      <FitToViewport padding={40}>
      <div className="relative max-w-6xl text-center">
        <Icon className="w-32 h-32 mx-auto mb-6" />
        <div className="text-sm uppercase tracking-[0.4em] font-bold opacity-80 mb-2">
          {active.type === 'SOS' ? 'Staff SOS' : active.type === 'MEDIA_ALERT' ? 'Emergency Alert' : 'Broadcast'}
        </div>
        {active.textBlob && (
          <h1 className="text-6xl md:text-8xl font-black leading-tight mb-8 whitespace-pre-wrap break-words">
            {active.textBlob}
          </h1>
        )}

        {active.mediaUrls && active.mediaUrls.length > 0 && (
          // Grid `gap-*` requires Chrome 84+. Use a negative-margin /
          // positive-padding pair instead — works on every engine.
          // max-h uses a fixed pixel cap rather than `vh` so the
          // 90°-rotated preview-mode body doesn't size against the
          // wrong axis on Taurus.
          <div className="grid grid-cols-1 md:grid-cols-2 mt-6 -m-2" style={{ maxHeight: '432px' }}>
            {active.mediaUrls.slice(0, 4).map((url) => {
              const isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(url);
              return (
                <div key={url} className="p-2">
                  {isVideo ? (
                    <video src={url} autoPlay muted loop playsInline className="w-full h-full object-cover rounded-lg border-2 border-white/40" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="Emergency media" className="w-full h-full object-cover rounded-lg border-2 border-white/40" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {active.audioUrl && (
          <div className="mt-6 flex items-center justify-center text-lg">
            <Volume2 className="w-6 h-6" />
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={active.audioUrl} autoPlay controls className="max-w-md ml-3" />
          </div>
        )}
      </div>
      </FitToViewport>
      </div>
    </div>
  );
}

export default EmergencyOverlay;
