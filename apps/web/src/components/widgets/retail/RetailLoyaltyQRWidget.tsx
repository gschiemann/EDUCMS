'use client';

import type { ReactElement } from 'react';

/**
 * RetailLoyaltyQRWidget — "Scan to join" loyalty signup callout.
 *
 * Two halves:
 *   - Left: editorial copy explaining the loyalty pitch (3 perks).
 *   - Right: a big QR code the shopper scans on their phone.
 *
 * The QR is a stylized SVG placeholder by default — a real QR can be
 * supplied via `qrImageUrl` (operator generates server-side and pastes
 * the URL in). The placeholder still renders cleanly so the gallery
 * thumbnail looks legitimate without a real QR generator dependency.
 */

export interface RetailLoyaltyQRConfig {
  /** Eyebrow line above headline e.g. "MEMBERS · EARN AS YOU SHOP". */
  eyebrow?: string;
  /** Big serif headline. */
  headline?: string;
  /** Tagline / pitch subhead under headline. */
  subhead?: string;
  /** Up to 3 short perk lines. */
  perks?: string[];
  /** Optional pre-rendered QR code image URL. */
  qrImageUrl?: string;
  /** "Scan to join" call-to-action above the QR. */
  ctaText?: string;
  /** Tiny URL or instruction line below the QR. */
  qrFootnote?: string;
  /** Background color. */
  bgColor?: string;
  /** Body text color. */
  inkColor?: string;
  /** Accent color for eyebrow + perks bullet. */
  accentColor?: string;
}

/**
 * Pure CSS / SVG QR placeholder. Renders a 21x21 module grid with a
 * deterministic but unique pattern derived from the input text — looks
 * QR-shaped but isn't scannable. Operators paste a real QR URL in
 * production via qrImageUrl.
 */
function QRPlaceholder({ text }: { text: string }) {
  // Deterministic pattern: hash the text into a 21x21 boolean grid,
  // skipping the three position-finder corners which are rendered fixed.
  const SIZE = 21;
  const cells: boolean[][] = [];
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  for (let y = 0; y < SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < SIZE; x++) {
      // Mix coordinates into the hash so each cell is its own bit
      const v = ((h ^ (x * 73856093)) ^ (y * 19349663)) | 0;
      row.push((v & 1) === 1);
    }
    cells.push(row);
  }

  // Position-finder pattern: 7x7 nested squares at three corners.
  const isFinder = (x: number, y: number): boolean | null => {
    const corners: [number, number][] = [[0, 0], [SIZE - 7, 0], [0, SIZE - 7]];
    for (const [cx, cy] of corners) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
        if (dx === 0 || dx === 6 || dy === 0 || dy === 6) return true;     // outer ring
        if (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) return true;          // inner block
        return false;
      }
    }
    return null;
  };

  const modules: ReactElement[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const finder = isFinder(x, y);
      const filled = finder !== null ? finder : cells[y][x];
      if (!filled) continue;
      modules.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill="currentColor"
        />
      );
    }
  }

  return (
    <svg
      className="rlqw-qr-svg"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      shapeRendering="crispEdges"
      aria-label="Loyalty signup QR code"
    >
      {modules}
    </svg>
  );
}

export function RetailLoyaltyQRWidget({
  config,
}: {
  config?: RetailLoyaltyQRConfig;
  live?: boolean;
}) {
  const c: RetailLoyaltyQRConfig = config || {};
  const eyebrow = c.eyebrow ?? 'MEMBERS CLUB';
  const headline = c.headline ?? 'Earn rewards every visit.';
  const subhead = c.subhead ?? 'Free to join · Members-only events · Birthday gift';
  const perks = c.perks && c.perks.length > 0
    ? c.perks
    : [
        '5% back on every purchase',
        'Early access to new arrivals',
        'Birthday gift each year',
      ];
  const ctaText = c.ctaText ?? 'Scan to join';
  const qrFootnote = c.qrFootnote ?? 'or visit yourstore.com/rewards';
  const bg = c.bgColor ?? '#faf6f1';
  const ink = c.inkColor ?? '#1a1411';
  const accent = c.accentColor ?? '#9a2d2d';

  return (
    <div
      className="rlqw-root"
      style={
        {
          '--rlqw-bg': bg,
          '--rlqw-ink': ink,
          '--rlqw-accent': accent,
        } as React.CSSProperties
      }
    >
      <style>{CSS}</style>

      <div className="rlqw-content-pane">
        <div className="rlqw-eyebrow">{eyebrow}</div>
        <h1 className="rlqw-headline">{headline}</h1>
        <div className="rlqw-subhead">{subhead}</div>

        <ul className="rlqw-perks">
          {perks.slice(0, 3).map((p, i) => (
            <li key={i}>
              <span className="rlqw-perk-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="rlqw-perk-text">{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rlqw-qr-pane">
        <div className="rlqw-cta">{ctaText}</div>
        <div className="rlqw-qr-card">
          {c.qrImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="rlqw-qr-image" src={c.qrImageUrl} alt={ctaText} />
          ) : (
            <QRPlaceholder text={`${headline}|${ctaText}`} />
          )}
        </div>
        {qrFootnote && <div className="rlqw-footnote">{qrFootnote}</div>}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

.rlqw-root {
  position: absolute; inset: 0;
  background: var(--rlqw-bg, #faf6f1);
  color: var(--rlqw-ink, #1a1411);
  font-family: 'Inter', sans-serif;
  display: grid;
  grid-template-columns: 5fr 4fr;
  gap: clamp(16px, 3cqw, 40px);
  padding: clamp(20px, 5cqh, 60px) clamp(24px, 5cqw, 80px);
  container-type: size;
  overflow: hidden;
}

.rlqw-content-pane {
  display: flex; flex-direction: column;
  justify-content: center;
  gap: clamp(8px, 1.6cqh, 18px);
}
.rlqw-eyebrow {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(10px, 1.5cqh, 14px);
  letter-spacing: 0.5em;
  text-transform: uppercase;
  color: var(--rlqw-accent);
}
.rlqw-headline {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(28px, 7cqh, 88px);
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0;
}
.rlqw-subhead {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(13px, 2.2cqh, 24px);
  opacity: 0.65;
  margin-bottom: clamp(8px, 2cqh, 20px);
}
.rlqw-perks {
  list-style: none;
  padding: 0; margin: 0;
  display: flex; flex-direction: column;
  gap: clamp(8px, 1.8cqh, 18px);
}
.rlqw-perks li {
  display: flex; align-items: baseline;
  gap: clamp(10px, 1.8cqw, 20px);
}
.rlqw-perk-num {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(14px, 2.4cqh, 26px);
  color: var(--rlqw-accent);
  letter-spacing: 0.04em;
  flex: none;
}
.rlqw-perk-text {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(12px, 1.9cqh, 20px);
  letter-spacing: 0.02em;
  opacity: 0.85;
}

.rlqw-qr-pane {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: clamp(8px, 1.8cqh, 18px);
}
.rlqw-cta {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 1.8cqh, 16px);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--rlqw-accent);
}
.rlqw-qr-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  padding: clamp(10px, 2cqh, 24px);
  width: clamp(140px, 38cqh, 380px);
  height: clamp(140px, 38cqh, 380px);
  box-shadow: 0 12px 36px rgba(0,0,0,0.12);
  display: flex; align-items: center; justify-content: center;
  color: var(--rlqw-ink);
}
.rlqw-qr-image {
  width: 100%; height: 100%;
  object-fit: contain;
}
.rlqw-qr-svg {
  width: 100%; height: 100%;
  display: block;
  color: var(--rlqw-ink);
}
.rlqw-footnote {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(10px, 1.4cqh, 13px);
  letter-spacing: 0.06em;
  opacity: 0.55;
  text-align: center;
}
`;
