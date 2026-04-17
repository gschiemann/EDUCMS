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

export function EmergencyOverlay({ message, tenantId, apiUrl, pollMs = 10000 }: Props) {
  const [polled, setPolled] = useState<EmergencyMessageView | null>(null);

  useEffect(() => {
    if (message || !tenantId || !apiUrl) return;

    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`${apiUrl}/emergency/status?tenantId=${encodeURIComponent(tenantId)}`, {
          credentials: 'include',
        });
        if (!res.ok || stopped) return;
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
  }, [message, tenantId, apiUrl, pollMs]);

  const active = message || polled;
  if (!active) return null;

  const style = severityStyles[active.severity] || severityStyles.CRITICAL;
  const Icon = style.icon;

  // Banner-style for INFO text broadcasts, full-screen for everything else.
  const isBanner = active.type === 'TEXT_BROADCAST' && active.severity !== 'CRITICAL';

  if (isBanner) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`fixed top-0 left-0 right-0 z-[9999] ${style.bg} ${style.text} border-b-4 ${style.border} ${style.animate} px-8 py-4 flex items-center gap-4 shadow-2xl`}
      >
        <Icon className="w-8 h-8 flex-shrink-0" />
        <div className="flex-1 text-xl font-bold leading-snug">{active.textBlob}</div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed inset-0 z-[9999] ${style.bg} ${style.text} ${style.animate} flex flex-col items-center justify-center p-12 backdrop-blur-sm`}
    >
      {active.severity === 'CRITICAL' && (
        <div className="pointer-events-none absolute inset-0 border-[12px] border-red-500 animate-pulse" aria-hidden />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 max-h-[40vh]">
            {active.mediaUrls.slice(0, 4).map((url) => {
              const isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(url);
              return isVideo ? (
                <video key={url} src={url} autoPlay muted loop playsInline className="w-full h-full object-cover rounded-lg border-2 border-white/40" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="Emergency media" className="w-full h-full object-cover rounded-lg border-2 border-white/40" />
              );
            })}
          </div>
        )}

        {active.audioUrl && (
          <div className="mt-6 flex items-center justify-center gap-3 text-lg">
            <Volume2 className="w-6 h-6" />
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={active.audioUrl} autoPlay controls className="max-w-md" />
          </div>
        )}
      </div>
    </div>
  );
}

export default EmergencyOverlay;
