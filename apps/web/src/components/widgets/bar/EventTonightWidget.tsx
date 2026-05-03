'use client';

/**
 * EventTonightWidget — band / show / DJ poster for a bar's live night.
 *
 * Designed to live full-bleed during the day announcing the night's
 * show. Big artist name, "TONIGHT" eyebrow with a pulsing dot, doors
 * open countdown if `doorsAt` is set, cover charge in a hand-stamped
 * chip, optional subtitle ("with special guest XXX").
 *
 * Reads the current time on the client. When doors are open, the
 * "Doors at" label flips to "DOORS OPEN" with a green dot. After the
 * scheduled show end time the widget collapses to a "Catch us tomorrow"
 * line so the screen doesn't sit on stale info overnight.
 *
 * Visual DNA: gig-poster — magenta + cyan neon, big condensed display
 * type for the artist name, slight rotation on the cover-charge stamp,
 * grain texture for that risograph print look.
 *
 * Widget type: BAR_EVENT_TONIGHT
 */

import { useEffect, useState } from 'react';
import { parseTimeToMinutes, formatTime12 } from '@/lib/format-time';

export interface EventTonightConfig {
  /** Headlining act / band / DJ. Default "TONIGHT'S SHOW". */
  artist?: string;
  /** Subtitle line — opener / genre / etc. */
  subtitle?: string;
  /** Loose time string for doors. e.g. "8:00 PM", "20:00", "8pm" */
  doorsAt?: string;
  /** Loose time string for show start. */
  showAt?: string;
  /** Cover charge label. e.g. "$15", "FREE", "$10 in advance / $15 at door" */
  cover?: string;
  /** Eyebrow label above artist. Default "TONIGHT" — set "THIS WEEKEND" etc */
  eyebrow?: string;
  /** Footer rule line, e.g. "21+ · Cash bar · No RSVP needed" */
  footer?: string;
  /** Accent color (neon glow). Default magenta #d946ef. */
  accentColor?: string;
  /** Secondary neon. Default cyan #22d3ee. */
  accent2?: string;
}

function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function EventTonightWidget({
  config,
  live: _live,
}: {
  config?: EventTonightConfig;
  live?: boolean;
}) {
  const c: EventTonightConfig = config || {};
  const accent = c.accentColor || '#d946ef';
  const accent2 = c.accent2 || '#22d3ee';
  const eyebrow = c.eyebrow || 'TONIGHT';
  const artist = c.artist || "TONIGHT'S SHOW";
  const subtitle = c.subtitle || 'Live music + late kitchen';
  const cover = c.cover || '$10 cover';
  const footer = c.footer || '21+ · Doors close at midnight';

  const doorsMin = parseTimeToMinutes(c.doorsAt) ?? (20 * 60);  // 8 PM default
  const showMin = parseTimeToMinutes(c.showAt) ?? (21 * 60);    // 9 PM default

  const [tick, setTick] = useState(nowMin());
  useEffect(() => {
    const t = setInterval(() => setTick(nowMin()), 30000);
    return () => clearInterval(t);
  }, []);

  // Status detection
  let status: 'BEFORE' | 'DOORS_OPEN' | 'SHOW_LIVE' | 'AFTER' = 'BEFORE';
  if (tick >= doorsMin && tick < showMin) status = 'DOORS_OPEN';
  else if (tick >= showMin && tick < showMin + 240) status = 'SHOW_LIVE';
  else if (tick >= showMin + 240) status = 'AFTER';

  return (
    <div
      className="bet-root"
      style={{ '--bet-accent': accent, '--bet-accent2': accent2 } as React.CSSProperties}
    >
      <style>{CSS}</style>

      {/* Background stack — gig-poster gradient + grain */}
      <div className="bet-bg" />
      <div className="bet-glow1" />
      <div className="bet-glow2" />
      <div className="bet-grain" aria-hidden />

      {/* Halftone dot pattern overlay — print feel */}
      <svg className="bet-halftone" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden>
        <defs>
          <pattern id="halftone-bet" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1" fill="#fff" opacity="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#halftone-bet)" />
      </svg>

      <div className="bet-frame">
        {/* Eyebrow — TONIGHT pulse */}
        <div className="bet-eyebrow">
          <span className="bet-eyebrow-dot" aria-hidden />
          <span className="bet-eyebrow-text">{eyebrow}</span>
          <span className="bet-eyebrow-dot" aria-hidden />
        </div>

        {/* Artist name — main billing */}
        <div className="bet-artist">{artist}</div>

        {/* Subtitle */}
        {subtitle && <div className="bet-subtitle">{subtitle}</div>}

        {/* Doors / show time row */}
        <div className="bet-times">
          {c.doorsAt && (
            <div className={'bet-time-block' + (status === 'DOORS_OPEN' ? ' bet-time-block--live' : '')}>
              <div className="bet-time-label">
                {status === 'DOORS_OPEN' ? 'DOORS OPEN' : 'DOORS'}
              </div>
              <div className="bet-time-val">{formatTime12(c.doorsAt) || c.doorsAt}</div>
            </div>
          )}
          {c.showAt && (
            <div className={'bet-time-block' + (status === 'SHOW_LIVE' ? ' bet-time-block--live' : '')}>
              <div className="bet-time-label">
                {status === 'SHOW_LIVE' ? 'ON STAGE NOW' : 'SHOW'}
              </div>
              <div className="bet-time-val">{formatTime12(c.showAt) || c.showAt}</div>
            </div>
          )}
        </div>

        {/* Cover charge — "stamp" chip */}
        {cover && (
          <div className="bet-cover">
            <span className="bet-cover-text">{cover}</span>
          </div>
        )}

        {/* AFTER state messaging — only after the show window */}
        {status === 'AFTER' && (
          <div className="bet-after-msg">
            ✦ Show wrapped — see you tomorrow ✦
          </div>
        )}

        {/* Footer */}
        {footer && <div className="bet-footer">{footer}</div>}
      </div>

      {/* Decorative star bursts */}
      <div className="bet-star bet-star--tl" aria-hidden>✦</div>
      <div className="bet-star bet-star--br" aria-hidden>✦</div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Anton&family=Outfit:wght@500;600;700;800&family=Inter:wght@500;600&family=Permanent+Marker&display=swap');

.bet-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; align-items: center; justify-content: center;
}

.bet-bg {
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(155deg, #160730 0%, #0a0218 50%, #200822 100%);
}
.bet-glow1 {
  position: absolute; top: -40%; left: -20%; width: 80%; height: 80%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(closest-side, var(--bet-accent, #d946ef), transparent 70%);
  opacity: 0.45;
  filter: blur(60px);
}
.bet-glow2 {
  position: absolute; bottom: -40%; right: -20%; width: 90%; height: 90%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(closest-side, var(--bet-accent2, #22d3ee), transparent 70%);
  opacity: 0.32;
  filter: blur(70px);
}
.bet-grain {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.10;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>");
  mix-blend-mode: overlay;
}
.bet-halftone {
  position: absolute; inset: 0; z-index: 3;
  width: 100%; height: 100%;
  opacity: 0.06;
  mix-blend-mode: screen;
}

.bet-frame {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  width: 100%; height: 100%;
  padding: clamp(16px, 4cqh, 36px);
  box-sizing: border-box;
  justify-content: center;
}

/* Decorative star bursts */
.bet-star {
  position: absolute; z-index: 11;
  font-family: 'Anton', sans-serif;
  font-size: clamp(28px, 8cqh, 100px);
  color: var(--bet-accent2, #22d3ee);
  text-shadow: 0 0 28px var(--bet-accent2, #22d3ee);
  pointer-events: none;
  line-height: 1;
}
.bet-star--tl {
  top: clamp(10px, 3cqh, 30px);
  left: clamp(14px, 3cqw, 40px);
  transform: rotate(-12deg);
  color: var(--bet-accent, #d946ef);
  text-shadow: 0 0 22px var(--bet-accent, #d946ef);
}
.bet-star--br {
  bottom: clamp(10px, 3cqh, 30px);
  right: clamp(14px, 3cqw, 40px);
  transform: rotate(15deg);
}

/* Eyebrow */
.bet-eyebrow {
  display: flex; align-items: center; gap: clamp(8px, 1.5cqw, 14px);
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(13px, 2.4cqh, 22px);
  color: var(--bet-accent2, #22d3ee);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  text-shadow: 0 0 14px var(--bet-accent2, #22d3ee);
  margin-bottom: clamp(6px, 1.4cqh, 14px);
}
.bet-eyebrow-dot {
  width: clamp(8px, 1.4cqh, 12px);
  height: clamp(8px, 1.4cqh, 12px);
  border-radius: 50%;
  background: var(--bet-accent, #d946ef);
  box-shadow: 0 0 14px var(--bet-accent, #d946ef);
  animation: bet-dot-blink 1.4s ease-in-out infinite;
}
@keyframes bet-dot-blink {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(0.85); }
}

/* Artist name */
.bet-artist {
  font-family: 'Anton', 'Bebas Neue', sans-serif;
  font-weight: 400;
  font-size: clamp(40px, 13cqh, 200px);
  color: #ffffff;
  letter-spacing: 0.02em;
  text-shadow:
    -2px -2px 0 var(--bet-accent, #d946ef),
    2px 2px 0 var(--bet-accent2, #22d3ee),
    0 0 36px rgba(255,255,255,0.18);
  line-height: 0.92;
  text-transform: uppercase;
  margin: clamp(2px, 0.8cqh, 8px) 0;
  max-width: 92%;
}

/* Subtitle */
.bet-subtitle {
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
  font-style: italic;
  font-size: clamp(13px, 2.4cqh, 24px);
  color: #fef3c7;
  letter-spacing: 0.06em;
  margin-top: clamp(4px, 1cqh, 8px);
  margin-bottom: clamp(10px, 2.2cqh, 22px);
}

/* Doors / show time row */
.bet-times {
  display: flex; gap: clamp(10px, 2.5cqw, 30px);
  margin: clamp(10px, 2.2cqh, 22px) 0 clamp(12px, 2.5cqh, 24px);
}
.bet-time-block {
  display: flex; flex-direction: column; align-items: center;
  background: rgba(0,0,0,0.4);
  border: 2px solid var(--bet-accent2, #22d3ee);
  padding: clamp(6px, 1.4cqh, 14px) clamp(12px, 2.4cqw, 26px);
  border-radius: clamp(4px, 0.8cqh, 8px);
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.25);
}
.bet-time-block--live {
  border-color: #22c55e;
  box-shadow: 0 0 22px rgba(34, 197, 94, 0.4);
  animation: bet-live-pulse 1.8s ease-in-out infinite;
}
@keyframes bet-live-pulse {
  0%, 100% { box-shadow: 0 0 18px rgba(34, 197, 94, 0.32); }
  50%      { box-shadow: 0 0 36px rgba(34, 197, 94, 0.55); }
}
.bet-time-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(8px, 1.4cqh, 12px);
  color: var(--bet-accent2, #22d3ee);
  letter-spacing: 0.28em;
}
.bet-time-block--live .bet-time-label {
  color: #4ade80;
}
.bet-time-val {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(20px, 4.4cqh, 44px);
  color: #ffffff;
  letter-spacing: 0.04em;
  margin-top: 2px;
  line-height: 1;
}

/* Cover charge stamp */
.bet-cover {
  display: inline-block;
  background: var(--bet-accent, #d946ef);
  color: #0a0218;
  padding: clamp(7px, 1.5cqh, 14px) clamp(14px, 3cqw, 28px);
  border-radius: 999px;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(15px, 3cqh, 30px);
  font-weight: 400;
  letter-spacing: 0.04em;
  margin-top: clamp(4px, 1cqh, 10px);
  transform: rotate(-3deg);
  box-shadow: 0 0 22px var(--bet-accent, #d946ef);
  border: 3px dashed rgba(0,0,0,0.4);
}
.bet-cover-text {
  display: inline-block;
}

/* AFTER state */
.bet-after-msg {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(13px, 2.4cqh, 22px);
  color: #94a3b8;
  letter-spacing: 0.08em;
  margin-top: clamp(8px, 2cqh, 18px);
  font-style: italic;
}

/* Footer */
.bet-footer {
  position: absolute; bottom: clamp(12px, 2.2cqh, 22px); left: 0; right: 0;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(10px, 1.6cqh, 14px);
  color: #94a3b8;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  text-align: center;
}
`;
