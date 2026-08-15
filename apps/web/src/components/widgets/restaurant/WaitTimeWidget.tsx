'use client';

/**
 * WaitTimeWidget — counter-service / dine-in queue display.
 *
 * Designed for the lobby of a fast-casual / counter-service spot
 * where guests want to know "how long is the wait?" + "what's my
 * place in line?" before committing. SMS-alert hint at the bottom
 * prevents people from hovering at the counter.
 *
 * Layout (top → bottom):
 *   1. Big estimate readout: "~12 MIN" with "estimated wait" eyebrow.
 *   2. Queue stats row: parties ahead, current time, status pill.
 *   3. SMS hint card with text-back number.
 *
 * Status colors auto-resolve from estimateMins:
 *   • 0-10 min → green ("walk right in")
 *   • 11-25 min → amber ("short wait")
 *   • 26+ min → red ("busy")
 *
 * Widget type: RESTAURANT_WAIT_TIME
 */

import { useEffect, useState } from 'react';
import { formatTime12 } from '@/lib/format-time';
import { sceneCss } from '../scene-css';

export interface WaitTimeConfig {
  /** Estimated wait in minutes. */
  estimateMins?: number;
  /** Number of parties ahead in the queue. */
  partiesAhead?: number;
  /** SMS short-code or number guests text to join the queue. */
  smsNumber?: string;
  /** SMS keyword (e.g. "QUEUE"). */
  smsKeyword?: string;
  /** Optional title — defaults to "WAIT TIME". */
  title?: string;
  /** Optional venue name shown in the SMS hint. */
  venueName?: string;
  /** Force a status color override. */
  statusOverride?: 'open' | 'short' | 'busy';
}

function statusFromMins(m: number): { tone: 'open' | 'short' | 'busy'; label: string; color: string } {
  if (m <= 10) return { tone: 'open',  label: 'WALK RIGHT IN',  color: '#3a8c4a' };
  if (m <= 25) return { tone: 'short', label: 'SHORT WAIT',     color: '#d68a1f' };
  return            { tone: 'busy',  label: 'BUSY · SIT TIGHT', color: '#b03a2e' };
}

export function WaitTimeWidget({
  config,
  live: _live,
}: {
  config?: WaitTimeConfig;
  live?: boolean;
}) {
  const c: WaitTimeConfig = config || {};
  const estimate = typeof c.estimateMins === 'number' ? Math.max(0, c.estimateMins) : 12;
  const parties  = typeof c.partiesAhead === 'number' ? Math.max(0, c.partiesAhead) : 3;
  const title    = c.title || 'WAIT TIME';
  const sms      = c.smsNumber || '85503';
  const keyword  = c.smsKeyword || 'QUEUE';
  const venue    = c.venueName || 'our lobby';
  const auto     = statusFromMins(estimate);
  const tone     = c.statusOverride || auto.tone;
  const status   = c.statusOverride
    ? statusFromMins(c.statusOverride === 'open' ? 0 : c.statusOverride === 'short' ? 15 : 35)
    : auto;

  // Live clock for the "current time" stat.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const timeStr = formatTime12(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);

  return (
    <div className="rwt-root" style={{ ['--rwt-status' as string]: status.color } as React.CSSProperties}>
      <style>{sceneCss(CSS)}</style>

      <div className="rwt-bg" />
      <div className="rwt-glow" aria-hidden />

      <div className="rwt-title">{title}</div>

      <div className="rwt-est-block">
        <div className="rwt-est-eyebrow">estimated wait</div>
        <div className="rwt-est-value">
          <span className="rwt-est-num">~{estimate}</span>
          <span className="rwt-est-unit">MIN</span>
        </div>
      </div>

      <div className={`rwt-status-pill rwt-status-${tone}`}>
        <span className="rwt-status-dot" />
        {status.label}
      </div>

      <div className="rwt-stats">
        <div className="rwt-stat">
          <div className="rwt-stat-num">{parties}</div>
          <div className="rwt-stat-label">parties ahead</div>
        </div>
        <div className="rwt-stat-sep" aria-hidden />
        <div className="rwt-stat">
          <div className="rwt-stat-num">{timeStr}</div>
          <div className="rwt-stat-label">current time</div>
        </div>
      </div>

      <div className="rwt-sms">
        <div className="rwt-sms-icon" aria-hidden>📱</div>
        <div className="rwt-sms-copy">
          <div className="rwt-sms-line1">
            Text <strong>{keyword}</strong> to <strong>{sms}</strong>
          </div>
          <div className="rwt-sms-line2">we&apos;ll text you when your table&apos;s ready in {venue}</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');

.rwt-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: #fbf6ee;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; flex-direction: column; align-items: center;
  padding: clamp(14px, 2.6cqh, 30px) clamp(14px, 2.4cqw, 28px);
  text-align: center;
}
.rwt-bg {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background: linear-gradient(160deg, #1a1714 0%, #2a211c 60%, #1a1714 100%);
}
.rwt-glow {
  position: absolute; top: -10%; right: -10%; bottom: -10%; left: -10%; z-index: 1;
  background: radial-gradient(700px 500px at 50% 25%, var(--rwt-status, #e8b94a), transparent 60%);
  opacity: 0.2;
  filter: blur(80px);
  pointer-events: none;
}

.rwt-title {
  position: relative; z-index: 5;
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(12px, 1.9cqh, 22px);
  letter-spacing: 0.32em;
  color: rgba(251,246,238,0.7);
  text-transform: uppercase;
  margin-bottom: clamp(6px, 1.2cqh, 14px);
}

.rwt-est-block {
  position: relative; z-index: 5;
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(2px, 0.4cqh, 6px);
  margin-bottom: clamp(8px, 1.6cqh, 18px);
}
.rwt-est-eyebrow {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.4cqh, 14px);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(251,246,238,0.55);
}
.rwt-est-value {
  display: inline-flex; align-items: baseline; gap: clamp(4px, 0.8cqw, 11px);
}
.rwt-est-num {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(60px, 22cqh, 240px);
  line-height: 0.85;
  letter-spacing: -0.02em;
  color: var(--rwt-status, #e8b94a);
  text-shadow: 0 0 50px var(--rwt-status, #e8b94a);
}
.rwt-est-unit {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(20px, 6cqh, 70px);
  letter-spacing: 0.1em;
  color: rgba(251,246,238,0.7);
}

.rwt-status-pill {
  position: relative; z-index: 5;
  display: inline-flex; align-items: center; gap: clamp(5px, 0.9cqw, 10px);
  padding: clamp(5px, 1cqh, 9px) clamp(10px, 2cqw, 22px);
  border-radius: 99px;
  background: rgba(0,0,0,0.4);
  border: 1.5px solid var(--rwt-status, #e8b94a);
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.7cqh, 20px);
  letter-spacing: 0.22em;
  color: var(--rwt-status, #e8b94a);
  text-transform: uppercase;
  margin-bottom: clamp(8px, 1.6cqh, 16px);
}
.rwt-status-dot {
  width: clamp(6px, 1cqh, 9px);
  height: clamp(6px, 1cqh, 9px);
  border-radius: 50%;
  background: var(--rwt-status, #e8b94a);
  box-shadow: 0 0 8px var(--rwt-status, #e8b94a);
  animation: rwt-blink 2s ease-in-out infinite;
}
@keyframes rwt-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

.rwt-stats {
  position: relative; z-index: 5;
  display: flex; align-items: center; gap: clamp(10px, 2cqw, 28px);
  margin-bottom: clamp(10px, 2cqh, 22px);
}
.rwt-stat {
  display: flex; flex-direction: column; align-items: center; gap: clamp(2px, 0.4cqh, 5px);
}
.rwt-stat-num {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(20px, 5cqh, 56px);
  line-height: 1;
  color: #fbf6ee;
}
.rwt-stat-label {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(8px, 1.2cqh, 12px);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(251,246,238,0.55);
}
.rwt-stat-sep {
  width: 1px;
  height: clamp(20px, 5cqh, 50px);
  background: rgba(251,246,238,0.12);
}

.rwt-sms {
  position: relative; z-index: 5;
  display: flex; align-items: center; gap: clamp(8px, 1.4cqw, 14px);
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(251,246,238,0.12);
  border-radius: clamp(8px, 1.2cqh, 14px);
  padding: clamp(8px, 1.5cqh, 14px) clamp(12px, 2.2cqw, 22px);
  max-width: 80%;
}
.rwt-sms-icon {
  font-size: clamp(20px, 4.5cqh, 44px);
  flex-shrink: 0;
}
.rwt-sms-copy {
  display: flex; flex-direction: column; gap: clamp(1px, 0.3cqh, 3px);
  text-align: left;
}
.rwt-sms-line1 {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(12px, 1.9cqh, 22px);
  color: #fbf6ee;
}
.rwt-sms-line1 strong {
  font-weight: 800;
  color: var(--rwt-status, #e8b94a);
}
.rwt-sms-line2 {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: clamp(9px, 1.4cqh, 14px);
  color: rgba(251,246,238,0.55);
  line-height: 1.3;
}
`;
