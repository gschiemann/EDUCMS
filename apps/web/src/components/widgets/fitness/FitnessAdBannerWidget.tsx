'use client';

/**
 * FitnessAdBannerWidget — rotating ad creative display for a gym.
 *
 * Two mental models the gym can run with:
 *   (a) The gym IS the advertiser — uploads their own promos
 *       ("New members: 50% off first month", "Yoga Intro Pack $49").
 *       Zero integration needed — creatives is an array of
 *       {imageUrl, advertiser, message, rotationMs}.
 *   (b) The gym sells border slots to local businesses — the fitness
 *       CMS manages impression logs + daily rotation. Still just
 *       creatives + a `network` field set to 'local'.
 *   (c) Phase 2 — gym opts into a national ad network (AdMob,
 *       Broadsign, DoohNetwork). `network` flips to the provider id,
 *       and we fetch creatives from their API on a cron. The widget
 *       contract doesn't change — it always shows whatever creative
 *       objects are in the list.
 *
 * Every rotation writes an impression event to /api/v1/ads/impressions
 * when `enableImpressionLogging` is on, so the gym can show a revenue
 * report to their sales rep. Fire-and-forget HTTP — a failed log
 * never blocks rotation.
 *
 * Visual language matches the rest of the fitness pack: dark frame,
 * neon accent, Outfit display font. Progress bar at the bottom shows
 * the rotation position so the gym owner standing in front of the
 * screen knows exactly when the next slot fires.
 */

import { useEffect, useRef, useState } from 'react';

export interface FitnessAdCreative {
  id: string;
  /** Image OR video. If videoUrl is set it takes precedence and loops for its natural duration (up to rotationMs). */
  imageUrl?: string;
  videoUrl?: string;
  /** Advertiser name — optional byline rendered in the bottom chip. */
  advertiser?: string;
  /** Short call-to-action shown in the bottom-left overlay. Kept tiny
   *  because the creative itself carries the message — this is just
   *  a "who is this from" label. */
  headline?: string;
  /** Per-creative rotation override in ms. Fall back to widget-level
   *  rotationMs when unset. Useful for blending 5s image spots with
   *  a 30s video spot in the same rotation. */
  rotationMs?: number;
}

export interface FitnessAdBannerConfig {
  creatives?: FitnessAdCreative[];
  /** Default rotation duration in ms. Individual creatives can override. */
  rotationMs?: number;
  /** Hex color for the "AD" chip + progress bar. Defaults to amber so
   *  it reads as "paid placement" without being punitive. */
  accentColor?: string;
  /** Whether to show the "AD" disclosure chip in the corner. Required
   *  in several US markets + feels honest to gym members. Default on. */
  showAdBadge?: boolean;
  /** Hit /api/v1/ads/impressions with a tiny payload every time a
   *  creative cycles into view. Default on; set to false for preview
   *  mode or offline kiosks. */
  enableImpressionLogging?: boolean;
  /** When true, use the demo creatives if `creatives` is empty. Only
   *  for the gallery preview — live signage shouldn't accidentally
   *  display our placeholders. */
  showDemoWhenEmpty?: boolean;
}

const DEMO_CREATIVES: FitnessAdCreative[] = [
  {
    id: 'demo-1',
    advertiser: 'Your Gym',
    headline: 'New Member Special · 50% off first month',
    rotationMs: 6000,
  },
  {
    id: 'demo-2',
    advertiser: 'Local Smoothie Co.',
    headline: '$2 off any protein smoothie · Show this screen at checkout',
    rotationMs: 6000,
  },
  {
    id: 'demo-3',
    advertiser: 'Yoga Studio Downtown',
    headline: 'Intro to Yoga · 3 classes for $49',
    rotationMs: 6000,
  },
];

export function FitnessAdBannerWidget({
  config,
  live,
}: {
  config?: FitnessAdBannerConfig;
  live?: boolean;
}) {
  const c: FitnessAdBannerConfig = config || {};
  const isLive = !!live;
  const accent = c.accentColor || '#fbbf24';
  const showBadge = c.showAdBadge !== false;

  const creatives: FitnessAdCreative[] = (c.creatives && c.creatives.length > 0)
    ? c.creatives
    : (c.showDemoWhenEmpty !== false ? DEMO_CREATIVES : []);

  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  // ─── Rotation ticker ───
  // Per-creative rotation so a 5s image and a 30s video can coexist
  // in the same queue. We reset progress on creative change.
  useEffect(() => {
    if (!isLive || creatives.length === 0) return;
    const current = creatives[idx % creatives.length];
    const ms = current?.rotationMs || c.rotationMs || 8000;
    const started = Date.now();

    const prog = setInterval(() => {
      const p = Math.min(100, ((Date.now() - started) / ms) * 100);
      setProgress(p);
    }, 60);

    const tick = setTimeout(() => {
      setIdx((i) => (i + 1) % creatives.length);
      setProgress(0);
    }, ms);

    // Fire-and-forget impression log. Best-effort — we never block
    // rotation on the network. Shape matches what a /ads/impressions
    // controller would accept (tenant context is already in the
    // session/JWT so we don't duplicate tenantId here).
    if (c.enableImpressionLogging !== false) {
      try {
        const url = (process.env.NEXT_PUBLIC_API_URL || '/api/v1') + '/ads/impressions';
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creativeId: current?.id,
            advertiser: current?.advertiser,
            at: Date.now(),
          }),
          keepalive: true,
        }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }

    return () => { clearInterval(prog); clearTimeout(tick); };
  }, [isLive, idx, creatives, c.rotationMs, c.enableImpressionLogging]);

  // ─── Empty state ───
  if (creatives.length === 0) {
    return (
      <div className="fabw-root fabw-empty" style={{ '--fabw-accent': accent } as React.CSSProperties}>
        <style>{CSS}</style>
        <div className="fabw-empty-inner">
          <span className="fabw-empty-badge">AD SLOT</span>
          <span className="fabw-empty-text">No creatives scheduled — configure under Ads</span>
        </div>
      </div>
    );
  }

  const current = creatives[idx % creatives.length];

  return (
    <div className="fabw-root" style={{ '--fabw-accent': accent } as React.CSSProperties}>
      <style>{CSS}</style>

      {/* Creative layer — crossfade between slides. Each creative is
          rendered in its own absolutely-positioned layer and opacity-
          swapped so video creatives preserve playback state across
          rotations if they loop back in. */}
      {creatives.map((cre, i) => {
        const isActive = i === (idx % creatives.length);
        return (
          <div
            key={cre.id}
            className="fabw-slide"
            style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? 'auto' : 'none' }}
            aria-hidden={!isActive}
          >
            {cre.videoUrl ? (
              <video
                className="fabw-media"
                src={cre.videoUrl}
                autoPlay
                loop
                muted
                playsInline
                aria-label={cre.advertiser || 'Advertisement'}
              />
            ) : cre.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cre.imageUrl}
                alt={cre.advertiser || 'Advertisement'}
                className="fabw-media"
              />
            ) : (
              // Synth-creative: stylized card when no image/video is
              // provided. Keeps layout stable while the gym uploads
              // their first real asset + lets demo mode render cleanly.
              <div className="fabw-synth">
                <div className="fabw-synth-beams">
                  <span /><span /><span /><span />
                </div>
                <div className="fabw-synth-content">
                  <div className="fabw-synth-advertiser">{cre.advertiser || 'YOUR BRAND HERE'}</div>
                  <div className="fabw-synth-headline">{cre.headline || 'Upload a creative to feature your promotion'}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Advertiser strip — tiny line across the bottom naming who's
          being shown. Reads as honest attribution + helps the gym's
          sales rep prove impressions to a local business. */}
      {current?.advertiser && (
        <div className="fabw-byline">
          <span className="fabw-byline-from">PRESENTED BY</span>
          <span className="fabw-byline-name">{current.advertiser}</span>
        </div>
      )}

      {/* "AD" disclosure chip top-right. Honest + often legally required. */}
      {showBadge && (
        <div className="fabw-ad-badge">AD</div>
      )}

      {/* Rotation progress bar at the very bottom. Unobtrusive —
          reads as a small accent line, not a progress meter. */}
      <div className="fabw-progress" style={{ width: `${progress}%` }} />

      {/* Slot counter top-left — 1/3, 2/3, etc. Tiny. */}
      {creatives.length > 1 && (
        <div className="fabw-counter">
          {(idx % creatives.length) + 1} / {creatives.length}
        </div>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Inter:wght@500;600&display=swap');

.fabw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  background: #0a0a0f;
  color: #f8fafc;
  font-family: 'Inter', sans-serif;
  container-type: size;
}
.fabw-slide {
  position: absolute; inset: 0;
  transition: opacity 600ms ease-in-out;
}
.fabw-media {
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
}

/* ─── Synthetic creative (no image/video provided) ─── */
.fabw-synth {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #0f172a, #1e1b4b, #0f172a);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.fabw-synth-beams {
  position: absolute; inset: -50%;
  pointer-events: none;
}
.fabw-synth-beams span {
  position: absolute;
  width: 200%; height: 2px;
  background: linear-gradient(90deg, transparent, var(--fabw-accent, #fbbf24), transparent);
  opacity: 0.15;
  transform-origin: center;
  animation: fabw-beam 8s linear infinite;
}
.fabw-synth-beams span:nth-child(1) { top: 20%; left: -50%; transform: rotate(-8deg); animation-delay: 0s; }
.fabw-synth-beams span:nth-child(2) { top: 45%; left: -50%; transform: rotate(12deg); animation-delay: -2s; }
.fabw-synth-beams span:nth-child(3) { top: 65%; left: -50%; transform: rotate(-4deg); animation-delay: -4s; }
.fabw-synth-beams span:nth-child(4) { top: 85%; left: -50%; transform: rotate(8deg); animation-delay: -6s; }
@keyframes fabw-beam {
  from { transform: translateX(-20%) rotate(-8deg); }
  to   { transform: translateX(20%) rotate(-8deg); }
}
.fabw-synth-content {
  position: relative; z-index: 2;
  padding: clamp(16px, 5%, 48px);
  text-align: center;
  max-width: 90%;
}
.fabw-synth-advertiser {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.8cqh, 14px);
  letter-spacing: 0.35em;
  color: var(--fabw-accent, #fbbf24);
  text-transform: uppercase;
  margin-bottom: clamp(8px, 2cqh, 16px);
  text-shadow: 0 0 16px var(--fabw-accent, #fbbf24);
}
.fabw-synth-headline {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(18px, 5cqh, 40px);
  line-height: 1.15;
  color: #ffffff;
  letter-spacing: -0.01em;
}

/* ─── Empty state ─── */
.fabw-empty {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #111, #1a1a22);
  border: 2px dashed rgba(255,255,255,0.08);
}
.fabw-empty-inner {
  text-align: center;
  padding: 12px;
}
.fabw-empty-badge {
  display: inline-block;
  padding: 4px 10px;
  background: var(--fabw-accent, #fbbf24);
  color: #000;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.2em;
  border-radius: 4px;
  margin-bottom: 10px;
}
.fabw-empty-text {
  display: block;
  font-size: 12px;
  color: #64748b;
}

/* ─── Bottom byline ─── */
.fabw-byline {
  position: absolute; left: 0; right: 0; bottom: 0;
  z-index: 10;
  padding: clamp(6px, 1.5cqh, 12px) clamp(10px, 3%, 20px);
  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.7));
  display: flex; align-items: baseline; gap: 10px;
  pointer-events: none;
}
.fabw-byline-from {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.3cqh, 11px);
  letter-spacing: 0.25em;
  color: rgba(255,255,255,0.6);
}
.fabw-byline-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(13px, 2cqh, 18px);
  color: #ffffff;
  letter-spacing: 0.05em;
}

/* ─── AD disclosure chip ─── */
.fabw-ad-badge {
  position: absolute; top: clamp(8px, 2cqh, 14px); right: clamp(8px, 2cqh, 14px);
  z-index: 11;
  padding: 3px 10px;
  background: var(--fabw-accent, #fbbf24);
  color: #0a0a0f;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(9px, 1.4cqh, 12px);
  letter-spacing: 0.3em;
  border-radius: 3px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

/* ─── Slot counter top-left ─── */
.fabw-counter {
  position: absolute; top: clamp(8px, 2cqh, 14px); left: clamp(8px, 2cqh, 14px);
  z-index: 11;
  padding: 3px 10px;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.7);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 600;
  font-size: clamp(9px, 1.4cqh, 12px);
  border-radius: 3px;
}

/* ─── Rotation progress line at the very bottom ─── */
.fabw-progress {
  position: absolute; left: 0; bottom: 0;
  height: 3px;
  background: var(--fabw-accent, #fbbf24);
  box-shadow: 0 0 12px var(--fabw-accent, #fbbf24);
  z-index: 12;
  transition: width 60ms linear;
}
`;
