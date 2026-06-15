/**
 * Shared score-change / clock motion primitives for the crowd surfaces
 * (board, ribbon, scorebug). The 2026-06-15 sports-pro gap analysis flagged
 * "scores hard-swap with zero animation" as the single most-noticed cheap
 * tell vs Daktronics/ScoreVision — the score change is the instant the whole
 * crowd looks at the board.
 *
 * Taurus / Chromium-83 SAFE: pure `transform` + `opacity` keyframes only.
 * NO `inset`, NO flex `gap`, NO `backdrop-filter`. Modern engines and the
 * NovaStar Taurus LED controller (Chromium 83) compute these identically.
 *
 * Usage (each surface owns its own score markup; this just drives the pop):
 *   const { flipKey, dir } = useScoreFlip(homeScore);
 *   <span key={flipKey} style={{ animation: dir ? SCORE_POP_ANIM : undefined }}>{homeScore}</span>
 * and inject SCORE_MOTION_KEYFRAMES once in a <style> block in the scene.
 */
import { useEffect, useRef, useState } from 'react';

/** Inject ONCE per scene (board/ribbon/scorebug each include it in their keyframes <style>). */
export const SCORE_MOTION_KEYFRAMES = `
@keyframes venueScorePop {
  0%   { transform: scale(1);    }
  18%  { transform: scale(1.28); }
  46%  { transform: scale(0.94); }
  72%  { transform: scale(1.06); }
  100% { transform: scale(1);    }
}
@keyframes venueScoreGlow {
  0%   { opacity: 0;   transform: scale(0.4); }
  20%  { opacity: 0.9; transform: scale(1);   }
  100% { opacity: 0;   transform: scale(1.9); }
}
@keyframes venueClockSheen {
  0%   { opacity: 0.0; }
  50%  { opacity: 0.22; }
  100% { opacity: 0.0; }
}
@keyframes venueAmbientDrift {
  0%   { transform: translate3d(0, 0, 0); }
  50%  { transform: translate3d(0, -1.4%, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
`;

/** Ready-to-use animation shorthands (apply to `style.animation`). */
export const SCORE_POP_ANIM = 'venueScorePop 720ms cubic-bezier(.2,.9,.25,1)';
export const SCORE_GLOW_ANIM = 'venueScoreGlow 720ms ease-out';
/** Slow, almost-subliminal background breathing for the live board (P2 idle motion). */
export const AMBIENT_DRIFT_ANIM = 'venueAmbientDrift 14s ease-in-out infinite';

export type ScoreFlipDir = 'up' | 'down' | null;

/**
 * Track a numeric value and return an incrementing key (to retrigger a CSS
 * animation via React's `key` remount) plus the change direction. First paint
 * does NOT animate (dir = null) so a cold-boot board doesn't pop on load.
 */
export function useScoreFlip(value: number): { flipKey: number; dir: ScoreFlipDir } {
  const prev = useRef<number | null>(null);
  const [state, setState] = useState<{ flipKey: number; dir: ScoreFlipDir }>({ flipKey: 0, dir: null });

  useEffect(() => {
    if (prev.current === null) {
      prev.current = value;
      return;
    }
    if (value !== prev.current) {
      const dir: ScoreFlipDir = value > prev.current ? 'up' : 'down';
      prev.current = value;
      setState((s) => ({ flipKey: s.flipKey + 1, dir }));
    }
  }, [value]);

  return state;
}
