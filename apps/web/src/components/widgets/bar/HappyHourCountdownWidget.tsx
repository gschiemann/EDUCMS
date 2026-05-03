'use client';

/**
 * HappyHourCountdownWidget — full-bleed countdown to happy hour end
 * + featured drink callout. Designed to live on a TV near the bar
 * during the 4-7pm rush window.
 *
 * Reads the current time on the client (no live feed required) and
 * counts down to `endsAt` (HH:MM string in local time). When the
 * countdown hits 0, the widget flips to a "Happy Hour ended" panel
 * for `postEndedMs` milliseconds before recycling for tomorrow.
 *
 * Visual DNA: deep neon magenta + amber, big condensed type for the
 * timer, animated pulse on the seconds digit, featured drink shows
 * with a strike-through original price + happy hour price.
 *
 * Widget type: BAR_HAPPY_HOUR_COUNTDOWN
 */

import { useEffect, useState } from 'react';
import { parseTimeToMinutes, formatTime12 } from '@/lib/format-time';

export interface HappyHourFeaturedDrink {
  name: string;
  /** Strike-through "regular" price. e.g. "$12" */
  regularPrice?: string;
  /** Big "happy hour" price. e.g. "$6" */
  happyPrice?: string;
  /** Optional emoji glyph. Default 🍹 */
  emoji?: string;
}

export interface HappyHourCountdownConfig {
  /** Loose time string for happy hour end. e.g. "7:00 PM", "19:00", "7pm" */
  endsAt?: string;
  /** Loose time string for happy hour start. Default "4:00 PM". */
  startsAt?: string;
  /** Headline. Default "HAPPY HOUR" */
  title?: string;
  /** Subtitle. Default "Tap drinks · House wine · Apps" */
  subtitle?: string;
  /** Featured drinks shown beneath the countdown. */
  drinks?: HappyHourFeaturedDrink[];
  /** Accent neon hex. Default magenta #ec4899 */
  accentColor?: string;
  /** How long to show the "ended" state before refreshing. Default 30 minutes. */
  postEndedMs?: number;
}

const DEMO_DRINKS: HappyHourFeaturedDrink[] = [
  { name: 'Drafts',     regularPrice: '$8',  happyPrice: '$5',  emoji: '🍺' },
  { name: 'Wells',      regularPrice: '$11', happyPrice: '$7',  emoji: '🥃' },
  { name: 'House Red',  regularPrice: '$12', happyPrice: '$8',  emoji: '🍷' },
  { name: 'Margarita',  regularPrice: '$13', happyPrice: '$9',  emoji: '🍸' },
];

function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function nowSec(): number {
  return new Date().getSeconds();
}

export function HappyHourCountdownWidget({
  config,
  live: _live,
}: {
  config?: HappyHourCountdownConfig;
  live?: boolean;
}) {
  const c: HappyHourCountdownConfig = config || {};
  const accent = c.accentColor || '#ec4899';
  const title = c.title || 'HAPPY HOUR';
  const subtitle = c.subtitle || 'Tap drinks · House wine · Apps';
  const drinks = (c.drinks && c.drinks.length > 0) ? c.drinks : DEMO_DRINKS;

  const endMin = parseTimeToMinutes(c.endsAt) ?? (19 * 60); // 7 PM default
  const startMin = parseTimeToMinutes(c.startsAt) ?? (16 * 60); // 4 PM default

  const [tick, setTick] = useState({ m: nowMin(), s: nowSec() });

  useEffect(() => {
    const t = setInterval(() => setTick({ m: nowMin(), s: nowSec() }), 1000);
    return () => clearInterval(t);
  }, []);

  // Determine state: BEFORE / ACTIVE / ENDED
  const minsTotal = tick.m;
  let state: 'BEFORE' | 'ACTIVE' | 'ENDED' = 'BEFORE';
  if (minsTotal >= startMin && minsTotal < endMin) state = 'ACTIVE';
  else if (minsTotal >= endMin) state = 'ENDED';

  // Compute remaining time
  const remainingMin = state === 'ACTIVE' ? (endMin - minsTotal - 1) : 0;
  const remainingSec = state === 'ACTIVE' ? (60 - tick.s) % 60 : 0;
  const hh = Math.max(0, Math.floor(remainingMin / 60));
  const mm = Math.max(0, remainingMin % 60);
  const ss = Math.max(0, remainingSec);

  return (
    <div
      className={'bhh-root bhh-state-' + state.toLowerCase()}
      style={{ '--bhh-accent': accent } as React.CSSProperties}
    >
      <style>{CSS}</style>

      <div className="bhh-bg" />
      <div className="bhh-glow" />
      <div className="bhh-grain" aria-hidden />

      <div className="bhh-frame">
        <div className="bhh-eyebrow">
          {state === 'BEFORE' && `STARTS AT ${formatTime12(c.startsAt) || formatTime12(c.startsAt ?? '4:00 PM') || '4:00pm'}`}
          {state === 'ACTIVE' && 'ENDS IN'}
          {state === 'ENDED' && 'TODAY'}
        </div>

        <div className="bhh-title">{title}</div>

        <div className="bhh-subtitle">{subtitle}</div>

        {/* Countdown row */}
        {state === 'ACTIVE' && (
          <div className="bhh-countdown">
            <div className="bhh-time-block">
              <div className="bhh-time-num">{String(hh).padStart(2, '0')}</div>
              <div className="bhh-time-label">HRS</div>
            </div>
            <div className="bhh-time-sep">:</div>
            <div className="bhh-time-block">
              <div className="bhh-time-num">{String(mm).padStart(2, '0')}</div>
              <div className="bhh-time-label">MIN</div>
            </div>
            <div className="bhh-time-sep bhh-time-sep--blink">:</div>
            <div className="bhh-time-block">
              <div className="bhh-time-num bhh-time-num--secs">{String(ss).padStart(2, '0')}</div>
              <div className="bhh-time-label">SEC</div>
            </div>
          </div>
        )}

        {state === 'BEFORE' && (
          <div className="bhh-status-row">
            <div className="bhh-status-text">
              Coming up at <span className="bhh-status-time">{formatTime12(c.startsAt) || '4:00pm'}</span>
            </div>
            <div className="bhh-status-sub">Through {formatTime12(c.endsAt) || '7:00pm'}</div>
          </div>
        )}

        {state === 'ENDED' && (
          <div className="bhh-status-row">
            <div className="bhh-status-text bhh-status-text--ended">Happy hour ended</div>
            <div className="bhh-status-sub">See you tomorrow at {formatTime12(c.startsAt) || '4:00pm'}</div>
          </div>
        )}

        {/* Featured drinks */}
        <div className="bhh-drinks">
          {drinks.slice(0, 4).map((d, i) => (
            <div key={i} className="bhh-drink">
              <div className="bhh-drink-emoji" aria-hidden>{d.emoji || '🍹'}</div>
              <div className="bhh-drink-name">{d.name}</div>
              <div className="bhh-drink-prices">
                {d.regularPrice && (
                  <span className="bhh-drink-regular">{d.regularPrice}</span>
                )}
                {d.happyPrice && (
                  <span className="bhh-drink-happy">{d.happyPrice}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@600;700&display=swap');

.bhh-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; align-items: center; justify-content: center;
}

.bhh-bg {
  position: absolute; inset: 0; z-index: 0;
  background:
    radial-gradient(900px 600px at 20% 10%, rgba(236,72,153,0.18), transparent 60%),
    radial-gradient(800px 500px at 80% 95%, rgba(245,158,11,0.13), transparent 60%),
    linear-gradient(160deg, #18012a 0%, #0a0a0a 60%, #1a0a05 100%);
}
.bhh-glow {
  position: absolute; inset: -10%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(700px 700px at 50% 40%, var(--bhh-accent, #ec4899), transparent 65%);
  opacity: 0.18;
  filter: blur(80px);
  animation: bhh-glow-pulse 6s ease-in-out infinite;
}
@keyframes bhh-glow-pulse {
  0%, 100% { opacity: 0.18; }
  50%      { opacity: 0.28; }
}
.bhh-grain {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.06;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
}

.bhh-frame {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  padding: clamp(14px, 3cqh, 30px);
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.bhh-eyebrow {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.8cqh, 18px);
  color: #fbbf24;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(251,191,36,0.6);
}

.bhh-title {
  font-family: 'Bebas Neue', 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(48px, 14cqh, 180px);
  letter-spacing: 0.04em;
  color: var(--bhh-accent, #ec4899);
  text-shadow:
    0 0 40px var(--bhh-accent, #ec4899),
    0 0 16px var(--bhh-accent, #ec4899),
    2px 2px 0 rgba(0,0,0,0.4);
  line-height: 0.95;
  margin: clamp(2px, 0.6cqh, 8px) 0;
}

.bhh-subtitle {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(11px, 2cqh, 20px);
  color: #cbd5e1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: clamp(8px, 2cqh, 18px);
}

/* Countdown */
.bhh-countdown {
  display: flex; align-items: center; justify-content: center;
  gap: clamp(4px, 1cqw, 10px);
  margin: clamp(6px, 1.6cqh, 14px) 0 clamp(10px, 2.5cqh, 22px);
}
.bhh-time-block {
  display: flex; flex-direction: column; align-items: center;
  background: rgba(0,0,0,0.45);
  border: 2px solid rgba(245,158,11,0.5);
  border-radius: clamp(6px, 1.2cqh, 12px);
  padding: clamp(6px, 1.4cqh, 14px) clamp(10px, 2cqw, 20px);
  box-shadow: 0 0 24px rgba(236,72,153,0.3), inset 0 0 18px rgba(245,158,11,0.05);
}
.bhh-time-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(34px, 8cqh, 100px);
  color: #fef3c7;
  text-shadow: 0 0 20px #fbbf24, 0 0 6px #fbbf24;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.bhh-time-num--secs {
  color: var(--bhh-accent, #ec4899);
  text-shadow: 0 0 22px var(--bhh-accent, #ec4899), 0 0 6px var(--bhh-accent, #ec4899);
  animation: bhh-sec-pulse 1s ease-in-out infinite;
}
@keyframes bhh-sec-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.65; }
}
.bhh-time-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(8px, 1.3cqh, 12px);
  color: #fbbf24;
  letter-spacing: 0.18em;
  margin-top: 4px;
  text-transform: uppercase;
}
.bhh-time-sep {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(28px, 6.5cqh, 80px);
  color: #fbbf24;
  text-shadow: 0 0 18px #fbbf24;
  line-height: 1;
  margin-bottom: clamp(14px, 3cqh, 28px);
}
.bhh-time-sep--blink {
  animation: bhh-blink 1s steps(2) infinite;
}
@keyframes bhh-blink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0.35; }
}

/* BEFORE / ENDED status row */
.bhh-status-row {
  margin: clamp(10px, 2.5cqh, 24px) 0;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.bhh-status-text {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(18px, 4cqh, 48px);
  color: #fbbf24;
  text-shadow: 0 0 20px rgba(251,191,36,0.6);
}
.bhh-status-text--ended {
  color: #94a3b8;
  text-shadow: none;
}
.bhh-status-time {
  color: var(--bhh-accent, #ec4899);
  text-shadow: 0 0 22px var(--bhh-accent, #ec4899);
}
.bhh-status-sub {
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
  font-size: clamp(11px, 1.8cqh, 16px);
  color: #94a3b8;
  letter-spacing: 0.1em;
}

/* Featured drinks row */
.bhh-drinks {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: clamp(8px, 2cqw, 22px);
  width: 92%;
  margin-top: clamp(8px, 2cqh, 16px);
}
.bhh-drink {
  display: flex; flex-direction: column; align-items: center;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: clamp(6px, 1cqh, 10px);
  padding: clamp(6px, 1.4cqh, 12px) clamp(6px, 1.2cqw, 12px);
}
.bhh-drink-emoji {
  font-size: clamp(20px, 4.5cqh, 44px);
  line-height: 1;
  filter: drop-shadow(0 0 10px rgba(245,158,11,0.4));
}
.bhh-drink-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.8cqh, 17px);
  color: #fef3c7;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 4px;
}
.bhh-drink-prices {
  display: flex; align-items: baseline; gap: clamp(4px, 0.8cqw, 8px);
  margin-top: 4px;
}
.bhh-drink-regular {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: clamp(10px, 1.5cqh, 14px);
  color: #94a3b8;
  text-decoration: line-through;
  text-decoration-color: rgba(236,72,153,0.7);
}
.bhh-drink-happy {
  font-family: 'Bebas Neue', 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(16px, 3cqh, 28px);
  color: var(--bhh-accent, #ec4899);
  text-shadow: 0 0 14px var(--bhh-accent, #ec4899);
  letter-spacing: 0.04em;
  line-height: 1;
}
`;
