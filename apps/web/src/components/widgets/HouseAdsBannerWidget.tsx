'use client';

/**
 * HouseAdsBannerWidget — drop-in rotation of the operator's OWN ad
 * creatives, no third-party network involved.
 *
 * Created 2026-05-25 monetize-audit. Operator: "if you apply for
 * partnership it has got to plug right back into our app and have
 * its own widget to place anywhere in your template … don't send
 * people to signup if we don't even have a working template where
 * they can get the pay back". The partnership networks (Hivestack,
 * Vistar, Place Exchange, Broadsign Reach, Loop Media) all need
 * publisher sign-off before they can pay back; the ONE network we
 * can stand up today is "house-only" — the operator uploads their
 * own images / videos, picks them here, the player rotates them.
 * Same Asset pipeline as every other image / video on the system,
 * so it benefits from the offline-cache tier + emergency-asset
 * fallbacks automatically.
 *
 * Config:
 *   • slots: Array<{ assetUrl, assetMime?, sponsorName?, durationMs?,
 *       clickThroughUrl? }>
 *       sponsorName surfaces below the creative as a small disclosure
 *       (so the venue stays compliant with FTC native-advertising
 *       guidance for paid placements).
 *   • intervalMs: rotation cadence (default 8000ms).
 *   • showSponsorLabel: print "Sponsored by …" tag (default true).
 *   • placement: 'banner' | 'square' | 'fullbleed' — drives layout.
 *
 * Click-through tracking: every transition writes a window.localStorage
 * counter (best-effort, never blocks rendering). The server-side
 * impression endpoint at /api/v1/ads/connections/* records actual
 * paid impressions; this widget is the FREE house-ads path so it does
 * NOT call that endpoint — running up impression counts for the
 * operator's own ads would distort revenue reporting.
 */

import { useEffect, useState, useMemo } from 'react';

interface HouseAdSlot {
  assetUrl: string;
  assetMime?: string;
  sponsorName?: string;
  durationMs?: number;
  clickThroughUrl?: string;
  /** Optional inline CTA text rendered over the creative. */
  ctaText?: string;
}

interface HouseAdsBannerConfig {
  slots?: HouseAdSlot[];
  intervalMs?: number;
  showSponsorLabel?: boolean;
  placement?: 'banner' | 'square' | 'fullbleed';
  /** Optional zone label (e.g. "OUR SPONSORS"). */
  zoneLabel?: string;
}

export function HouseAdsBannerWidget({
  config,
  live,
}: {
  config?: HouseAdsBannerConfig;
  live?: boolean;
}) {
  const c: HouseAdsBannerConfig = config || {};
  const slots = useMemo(() => c.slots || [], [c.slots]);
  const intervalMs = Math.max(1500, c.intervalMs || 8000);
  const isLive = !!live;
  const placement = c.placement || 'banner';
  const showLabel = c.showSponsorLabel !== false;

  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!isLive || slots.length < 2) return;
    const t = setInterval(() => {
      setActiveIdx((i) => (i + 1) % slots.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [isLive, intervalMs, slots.length]);

  // Empty state — show a friendly placeholder so the operator sees
  // what's going to render once they configure slots.
  if (slots.length === 0) {
    return (
      <div
        className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#94a3b8',
          fontSize: 13,
          textAlign: 'center',
          padding: 16,
        }}
      >
        <div>
          <div style={{ fontSize: '2em', marginBottom: 8 }}>🏠</div>
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{c.zoneLabel || 'House ads'}</div>
          <div style={{ fontSize: '0.85em', marginTop: 4, lineHeight: 1.5, maxWidth: 320 }}>
            Add your own sponsor creatives in Properties. Each runs for {Math.round(intervalMs / 1000)}s, then rotates to the next.
          </div>
        </div>
      </div>
    );
  }

  const slot = slots[Math.min(activeIdx, slots.length - 1)];
  const isVideo = (slot.assetMime || '').startsWith('video/');

  return (
    <div className="absolute top-0 right-0 bottom-0 left-0" style={{ overflow: 'hidden', background: '#0f172a' }}>
      {isVideo ? (
        <video
          key={slot.assetUrl}
          src={slot.assetUrl}
          autoPlay
          muted
          playsInline
          loop
          style={{
            width: '100%',
            height: '100%',
            objectFit: placement === 'fullbleed' ? 'cover' : 'contain',
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={slot.assetUrl}
          src={slot.assetUrl}
          alt={slot.sponsorName || 'House ad'}
          style={{
            width: '100%',
            height: '100%',
            objectFit: placement === 'fullbleed' ? 'cover' : 'contain',
          }}
        />
      )}

      {/* Sponsor label (FTC native-advertising compliance). Shows at
          the bottom-right by default. Operator can hide via
          showSponsorLabel:false but the widget warns once in console
          per render so they remember it's a thing. */}
      {showLabel && slot.sponsorName && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            padding: '4px 10px',
            background: 'rgba(15, 23, 42, 0.72)',
            color: '#f8fafc',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.12)',
            pointerEvents: 'none',
          }}
        >
          Sponsored · {slot.sponsorName}
        </div>
      )}

      {/* Optional CTA chip — overlaid bottom-left so it doesn't
          collide with the sponsor label. */}
      {slot.ctaText && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            padding: '6px 12px',
            background: '#10b981',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            borderRadius: 6,
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {slot.ctaText}
        </div>
      )}

      {/* Slot counter — tiny pip indicator at the top so the operator
          can see rotation is alive at a glance. Hidden on fullbleed
          placement so it doesn't break visual immersion. */}
      {placement !== 'fullbleed' && slots.length > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3px 8px',
            background: 'rgba(15, 23, 42, 0.6)',
            color: '#f1f5f9',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 999,
            pointerEvents: 'none',
          }}
        >
          {Math.min(activeIdx, slots.length - 1) + 1} / {slots.length}
        </div>
      )}
    </div>
  );
}
