'use client';

/**
 * RetailSaleCountdownWidget — big "Sale ends in 2d 14h" countdown.
 *
 * The conversion-driver: tells the shopper "if you don't buy now, you
 * pay full price tomorrow." Renders four clean digit blocks
 * (DAYS · HRS · MIN · SEC) with a serif "SALE ENDS IN" eyebrow above
 * and an optional fine-print line beneath.
 *
 * When the countdown reaches zero we render a friendly "SALE NOW LIVE"
 * (or operator-supplied finished-message) instead of negatives.
 *
 * Editorial rather than QSR — Playfair display digits, generous
 * whitespace, restrained color palette. Pairs with PriceCallout.
 */

import { useEffect, useState } from 'react';

export interface RetailSaleCountdownConfig {
  /** ISO 8601 timestamp when the sale ends. e.g. "2026-05-15T23:59:00-05:00". */
  endsAt?: string;
  /** Eyebrow line above the countdown. */
  eyebrow?: string;
  /** Headline above the digits. e.g. "Spring Sale Final Hours". */
  headline?: string;
  /** Fine-print line under the digits. e.g. "Online only · while supplies last". */
  fineprint?: string;
  /** Message rendered when the timer expires. */
  finishedMessage?: string;
  /** Background color. */
  bgColor?: string;
  /** Body text color. */
  inkColor?: string;
  /** Accent color for digit blocks + eyebrow. */
  accentColor?: string;
}

interface RemainingTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function computeRemaining(endsAt: string | undefined): RemainingTime {
  if (!endsAt) {
    // Demo state — show ~2d 14h 23m so the gallery thumbnail looks real.
    return { days: 2, hours: 14, minutes: 23, seconds: 0, expired: false };
  }
  const end = new Date(endsAt).getTime();
  const now = Date.now();
  const diff = end - now;
  if (!Number.isFinite(end) || diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / 1000 / 60) % 60;
  const hours = Math.floor(diff / 1000 / 60 / 60) % 24;
  const days = Math.floor(diff / 1000 / 60 / 60 / 24);
  return { days, hours, minutes, seconds, expired: false };
}

export function RetailSaleCountdownWidget({
  config,
}: {
  config?: RetailSaleCountdownConfig;
  live?: boolean;
}) {
  const c: RetailSaleCountdownConfig = config || {};
  const [remaining, setRemaining] = useState<RemainingTime>(() => computeRemaining(c.endsAt));

  useEffect(() => {
    setRemaining(computeRemaining(c.endsAt));
    const t = setInterval(() => setRemaining(computeRemaining(c.endsAt)), 1000);
    return () => clearInterval(t);
  }, [c.endsAt]);

  const eyebrow = c.eyebrow ?? 'SALE ENDS IN';
  const headline = c.headline ?? 'Spring Sale · 30% Off Sitewide';
  const fineprint = c.fineprint ?? 'Online and in-store · while supplies last';
  const finishedMsg = c.finishedMessage ?? 'Sale now live · Step inside';
  const bg = c.bgColor ?? '#1a1411';
  const ink = c.inkColor ?? '#faf6f1';
  const accent = c.accentColor ?? '#c9a66b';

  return (
    <div
      className="rscw-root"
      style={
        {
          '--rscw-bg': bg,
          '--rscw-ink': ink,
          '--rscw-accent': accent,
        } as React.CSSProperties
      }
    >
      <style>{CSS}</style>

      <div className="rscw-eyebrow">{eyebrow}</div>
      <h1 className="rscw-headline">{headline}</h1>

      {remaining.expired ? (
        <div className="rscw-finished">{finishedMsg}</div>
      ) : (
        <div className="rscw-digits">
          <DigitBlock value={remaining.days} label="DAYS" />
          <Separator />
          <DigitBlock value={remaining.hours} label="HOURS" />
          <Separator />
          <DigitBlock value={remaining.minutes} label="MIN" />
          <Separator />
          <DigitBlock value={remaining.seconds} label="SEC" />
        </div>
      )}

      {fineprint && <div className="rscw-fineprint">{fineprint}</div>}
    </div>
  );
}

function DigitBlock({ value, label }: { value: number; label: string }) {
  return (
    <div className="rscw-block">
      <div className="rscw-digits-value">{value.toString().padStart(2, '0')}</div>
      <div className="rscw-digits-label">{label}</div>
    </div>
  );
}

function Separator() {
  return <div className="rscw-sep" aria-hidden>·</div>;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');

.rscw-root {
  position: absolute; inset: 0;
  background: var(--rscw-bg, #1a1411);
  color: var(--rscw-ink, #faf6f1);
  font-family: 'Inter', sans-serif;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center;
  padding: clamp(20px, 5cqh, 60px);
  container-type: size;
  overflow: hidden;
  gap: clamp(8px, 2cqh, 24px);
}
.rscw-eyebrow {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(11px, 1.8cqh, 16px);
  letter-spacing: 0.5em;
  text-transform: uppercase;
  color: var(--rscw-accent);
}
.rscw-headline {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-weight: 600;
  font-size: clamp(20px, 5cqh, 56px);
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin: 0;
  opacity: 0.9;
}
.rscw-digits {
  display: flex; align-items: flex-end;
  gap: clamp(8px, 2.4cqw, 32px);
  margin: clamp(8px, 2cqh, 24px) 0;
}
.rscw-block {
  display: flex; flex-direction: column;
  align-items: center;
  gap: clamp(4px, 1cqh, 10px);
}
.rscw-digits-value {
  font-family: 'Playfair Display', serif;
  font-weight: 800;
  font-size: clamp(48px, 22cqh, 280px);
  line-height: 0.9;
  letter-spacing: -0.04em;
  color: var(--rscw-ink);
  font-variant-numeric: tabular-nums;
}
.rscw-digits-label {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.6cqh, 14px);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--rscw-accent);
}
.rscw-sep {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(36px, 18cqh, 200px);
  line-height: 0.9;
  color: var(--rscw-accent);
  opacity: 0.6;
  align-self: center;
  padding-bottom: clamp(20px, 6cqh, 60px);
}
.rscw-finished {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(28px, 8cqh, 96px);
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--rscw-accent);
  margin: clamp(12px, 3cqh, 32px) 0;
}
.rscw-fineprint {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: clamp(11px, 1.6cqh, 16px);
  letter-spacing: 0.05em;
  opacity: 0.6;
  margin-top: clamp(6px, 1.5cqh, 16px);
}
`;
