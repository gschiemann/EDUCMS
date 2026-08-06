'use client';

/**
 * ConnectionLostPill — the staleness chip for the public game surfaces
 * (/board + /ribbon). Rendered ONLY while a frame is on glass but the
 * feed has gone quiet (no good poll for STALE_FEED_AFTER_MS, or the
 * device reports offline). A frozen scoreboard is indistinguishable
 * from a live one — a wrong score that LOOKS live is the worst failure
 * a trust surface can have, so the board must say so.
 *
 * Chromium-83 (Taurus) safe: longhand offsets only (2 sides — can never
 * CSSOM-collapse to `inset`), no flex `gap` (marginRight), no
 * backdrop-filter (solid scrim). pointer-events: none so the pill can
 * never eat a kiosk touch.
 */
export function ConnectionLostPill({
  pulseName,
  defineKeyframe = false,
}: {
  /** Name of an opacity-pulse @keyframes already on the surface (the
   *  board's `venuePulse`). Set `defineKeyframe` on surfaces that have
   *  none and the pill ships its own under this name. */
  pulseName: string;
  defineKeyframe?: boolean;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 24,
        bottom: 24,
        // Above the scene AND the zIndex-50 celebration overlays —
        // connectivity truth outranks a cued celebration.
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(5, 8, 15, 0.85)',
        border: '1px solid rgba(251, 191, 36, 0.4)',
        borderRadius: 999,
        padding: '10px 22px 10px 16px',
        pointerEvents: 'none',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {defineKeyframe && (
        <style>{`@keyframes ${pulseName}{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
      )}
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: '#fbbf24',
          marginRight: 12,
          flexShrink: 0,
          animation: `${pulseName} 1.6s ease-in-out infinite`,
        }}
      />
      <span
        style={{
          color: '#fcd34d',
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: 2.5,
          whiteSpace: 'nowrap',
        }}
      >
        CONNECTION LOST — SCORE MAY BE BEHIND
      </span>
    </div>
  );
}
