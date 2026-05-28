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

import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Megaphone, Volume2 } from 'lucide-react';

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

const severityStyles = {
  INFO: {
    bg: 'bg-yellow-400/95',
    border: 'border-yellow-600',
    text: 'text-slate-900',
    icon: Megaphone,
    animate: '',
  },
  WARN: {
    bg: 'bg-orange-500/95',
    border: 'border-orange-700',
    text: 'text-white',
    icon: AlertTriangle,
    animate: '',
  },
  CRITICAL: {
    bg: 'bg-red-700/95',
    border: 'border-red-900',
    text: 'text-white',
    icon: ShieldAlert,
    animate: 'animate-pulse',
  },
} as const;

export function EmergencyOverlay({ message, tenantId, apiUrl, pollMs = 10000, deviceToken }: Props) {
  const [polled, setPolled] = useState<EmergencyMessageView | null>(null);

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
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`fixed top-0 left-0 right-0 z-[9999] ${style.bg} ${style.text} border-b-4 ${style.border} ${style.animate} px-8 py-4 flex items-center shadow-2xl`}
      >
        <Icon className="w-8 h-8 flex-shrink-0" />
        {/* ml-4 stand-in for a parent flex GAP (Chrome 84+ only) */}
        <div className="flex-1 text-xl font-bold leading-snug ml-4">{active.textBlob}</div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed top-0 right-0 bottom-0 left-0 z-[9999] ${style.bg} ${style.text} ${style.animate} flex flex-col items-center justify-center p-12`}
    >
      {active.severity === 'CRITICAL' && (
        <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 border-[12px] border-red-500 animate-pulse" aria-hidden />
      )}

      <div className="relative max-w-6xl w-full text-center">
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
    </div>
  );
}

export default EmergencyOverlay;
