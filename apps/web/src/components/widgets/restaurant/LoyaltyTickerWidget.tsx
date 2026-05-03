'use client';

/**
 * LoyaltyTickerWidget — rotating loyalty / rewards messaging strip.
 *
 * Designed for the strip above or below a menu board where the
 * operator wants to keep "earn 1 point per $1" + "join via QR"
 * in front of every guest without it dominating the canvas.
 *
 * Auto-rotates between configured messages on a timer; live mode
 * plays the rotation. Supports an optional QR-code image / URL
 * shown on the right side of the strip for sign-ups.
 *
 * Defensive notes:
 *   • messages can be array OR \n-delimited string (legacy editors).
 *   • rotationMs clamped to a sane minimum (1500ms) so a misconfig
 *     can't burn the GPU.
 *
 * Widget type: RESTAURANT_LOYALTY_TICKER
 */

import { useEffect, useRef, useState } from 'react';

export interface LoyaltyTickerConfig {
  /** Brand / loyalty program name shown as the eyebrow chip. */
  programName?: string;
  /** Array of headline strings to rotate through. */
  messages?: string[] | string;
  /** ms per message. Default 5500. */
  rotationMs?: number;
  /** Optional QR code URL or text to encode (text path uses Google Chart fallback). */
  qrUrl?: string;
  /** Display copy under QR — e.g. "Scan to join". */
  qrCaption?: string;
  /** Mustard accent color. */
  accentColor?: string;
  /** Background tone — 'cream' / 'charcoal' / 'red'. Default charcoal. */
  theme?: 'cream' | 'charcoal' | 'red';
}

const DEMO_MESSAGES = [
  'Earn 1 point per $1 spent',
  '50 points = a free coffee on us',
  'Birthday treat? Of course — every year, on us',
  'Join free at the counter or scan to enroll',
  'Members save 10% every Tuesday',
];

function parseMessages(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  if (typeof input === 'string' && input.trim()) {
    return input.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  return DEMO_MESSAGES;
}

export function LoyaltyTickerWidget({
  config,
  live,
}: {
  config?: LoyaltyTickerConfig;
  live?: boolean;
}) {
  const c: LoyaltyTickerConfig = config || {};
  const accent = c.accentColor || '#e8b94a';
  const programName = c.programName || 'REWARDS';
  const messages = parseMessages(c.messages);
  const rotationMs = Math.max(1500, c.rotationMs || 5500);
  const theme = c.theme || 'charcoal';
  const themeBg =
    theme === 'cream'    ? 'linear-gradient(90deg, #fbf6ee 0%, #f5ebd9 100%)' :
    theme === 'red'      ? 'linear-gradient(90deg, #7a1f1f 0%, #5a0e0e 100%)' :
                           'linear-gradient(90deg, #1a1714 0%, #2a211c 100%)';
  const themeInk = theme === 'cream' ? '#1a1714' : '#fbf6ee';
  const subInk   = theme === 'cream' ? 'rgba(26,23,20,0.65)' : 'rgba(251,246,238,0.65)';

  const [idx, setIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!live || messages.length < 2) return;
    timerRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % messages.length);
    }, rotationMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [live, messages.length, rotationMs]);

  const current = messages[Math.min(idx, messages.length - 1)] || messages[0] || '';

  const qrSrc = c.qrUrl
    ? (c.qrUrl.startsWith('http')
        ? c.qrUrl
        : `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(c.qrUrl)}`)
    : undefined;

  return (
    <div className="rlt-root" style={{ background: themeBg, color: themeInk, ['--rlt-accent' as string]: accent } as React.CSSProperties}>
      <style>{CSS}</style>

      <div className="rlt-strip">
        {/* Brand chip */}
        <div className="rlt-chip">
          <span className="rlt-chip-icon" aria-hidden>★</span>
          <span className="rlt-chip-text">{programName}</span>
        </div>

        <div className="rlt-divider" aria-hidden />

        {/* Animated messages */}
        <div className="rlt-msg-stack">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rlt-msg ${i === idx ? 'rlt-msg-on' : ''}`}
              aria-hidden={i !== idx}
            >
              {m}
            </div>
          ))}
        </div>

        {/* QR slot — right side */}
        {qrSrc && (
          <div className="rlt-qr-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="rlt-qr-img" src={qrSrc} alt="QR code" />
            {c.qrCaption && (
              <div className="rlt-qr-caption" style={{ color: subInk }}>{c.qrCaption}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');

.rlt-root {
  position: absolute; inset: 0;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; align-items: center;
}

.rlt-strip {
  display: flex; align-items: center; gap: clamp(8px, 1.6cqw, 22px);
  width: 100%; height: 100%;
  padding: 0 clamp(12px, 2cqw, 28px);
}

.rlt-chip {
  display: inline-flex; align-items: center; gap: clamp(4px, 0.8cqw, 8px);
  padding: clamp(4px, 0.9cqh, 8px) clamp(9px, 1.6cqw, 16px);
  background: var(--rlt-accent, #e8b94a);
  border-radius: 99px;
  color: #1a1714;
  flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(232,185,74,0.3);
}
.rlt-chip-icon {
  font-size: clamp(11px, 2cqh, 18px);
  line-height: 1;
}
.rlt-chip-text {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.7cqh, 16px);
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.rlt-divider {
  width: 1px;
  height: 60%;
  background: currentColor;
  opacity: 0.15;
  flex-shrink: 0;
}

.rlt-msg-stack {
  position: relative;
  flex: 1;
  height: 100%;
  display: flex; align-items: center;
  overflow: hidden;
  min-width: 0;
}
.rlt-msg {
  position: absolute;
  inset: 0;
  display: flex; align-items: center;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(13px, 2.4cqh, 28px);
  letter-spacing: 0;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 380ms ease, transform 380ms ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rlt-msg-on {
  opacity: 1;
  transform: translateY(0);
}

.rlt-qr-block {
  flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(2px, 0.4cqh, 4px);
}
.rlt-qr-img {
  height: clamp(40px, 9cqh, 90px);
  width: clamp(40px, 9cqh, 90px);
  object-fit: contain;
  border-radius: clamp(4px, 0.8cqh, 8px);
  background: #fff;
  padding: clamp(2px, 0.4cqh, 4px);
}
.rlt-qr-caption {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(7px, 1cqh, 11px);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
`;
