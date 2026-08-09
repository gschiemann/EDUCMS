'use client';

import type { CSSProperties } from 'react';

/**
 * ConnectionLostPill — the staleness chip for the public game surfaces
 * (/board + /ribbon). Rendered ONLY while a frame is on glass but the
 * feed has gone quiet (no good poll for STALE_FEED_AFTER_MS, or the
 * device reports offline). A frozen scoreboard is indistinguishable
 * from a live one — a wrong score that LOOKS live is the worst failure
 * a trust surface can have, so the board must say so.
 *
 * Two placements (refuter fix B1, 2026-08-09):
 *  - `board` (default): bottom-left — plenty of clear glass there on a
 *    16:9 scoreboard.
 *  - `ribbon`: right-aligned + vertically centered. The ribbon pins its
 *    ScoreZone at the LEFT edge (>= 360px wide, full strip height), so a
 *    bottom-left pill on a 96-240px strip sat exactly on top of the
 *    score — the chip warning "score may be behind" HID the score. On
 *    short strips (< 140px) the pill also drops to a compact size and
 *    shortens its label so it doesn't dominate the strip.
 *
 * Chromium-83 (Taurus) safe: longhand offsets only (2 sides per variant —
 * can never CSSOM-collapse to `inset`), translateY transform (Chrome 36+),
 * no flex `gap` (marginRight), no backdrop-filter (solid scrim).
 * pointer-events: none so the pill can never eat a kiosk touch.
 */
export function ConnectionLostPill({
  pulseName,
  defineKeyframe = false,
  variant = 'board',
  stripHeight,
}: {
  /** Name of an opacity-pulse @keyframes already on the surface (the
   *  board's `venuePulse`). Set `defineKeyframe` on surfaces that have
   *  none and the pill ships its own under this name. */
  pulseName: string;
  defineKeyframe?: boolean;
  /** 'board' = bottom-left (default). 'ribbon' = right-aligned, vertically
   *  centered, so the pill never covers the left-pinned ScoreZone. */
  variant?: 'board' | 'ribbon';
  /** The ribbon strip's pixel height (the surface's canvas-height variable
   *  in scope at the mount). Below 140px the ribbon variant renders the
   *  compact treatment. Ignored on the board variant. */
  stripHeight?: number;
}) {
  const ribbon = variant === 'ribbon';
  const compact = ribbon && typeof stripHeight === 'number' && stripHeight < 140;
  const placement: CSSProperties = ribbon
    ? { right: 24, top: '50%', transform: 'translateY(-50%)' }
    : { left: 24, bottom: 24 };
  return (
    <div
      style={{
        position: 'absolute',
        ...placement,
        // Above the scene AND the zIndex-50 celebration overlays —
        // connectivity truth outranks a cued celebration.
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(5, 8, 15, 0.85)',
        border: '1px solid rgba(251, 191, 36, 0.4)',
        borderRadius: 999,
        padding: compact ? '5px 12px 5px 9px' : '10px 22px 10px 16px',
        pointerEvents: 'none',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {defineKeyframe && (
        <style>{`@keyframes ${pulseName}{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
      )}
      <span
        style={{
          width: compact ? 9 : 12,
          height: compact ? 9 : 12,
          borderRadius: '50%',
          background: '#fbbf24',
          marginRight: compact ? 8 : 12,
          flexShrink: 0,
          animation: `${pulseName} 1.6s ease-in-out infinite`,
        }}
      />
      <span
        style={{
          color: '#fcd34d',
          fontSize: compact ? 12 : 15,
          fontWeight: 800,
          letterSpacing: compact ? 1.8 : 2.5,
          whiteSpace: 'nowrap',
        }}
      >
        {compact ? 'CONNECTION LOST' : 'CONNECTION LOST — SCORE MAY BE BEHIND'}
      </span>
    </div>
  );
}
