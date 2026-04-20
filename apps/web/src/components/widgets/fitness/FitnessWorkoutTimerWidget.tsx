'use client';

/**
 * FitnessWorkoutTimerWidget — HIIT / Tabata / interval timer for a
 * group-fitness studio wall screen.
 *
 * Counts down work and rest phases with a massive SVG progress ring +
 * colour-coded phase label so athletes can read the state from across
 * the room. No audio dependency — visual flash + background colour shift
 * signal the phase transition.
 *
 * Widget type: FITNESS_WORKOUT_TIMER
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FitnessWorkoutTimerConfig {
  mode?: 'tabata' | 'hiit' | 'emom' | 'amrap' | 'custom';
  workSeconds?: number;
  restSeconds?: number;
  totalRounds?: number;
  currentRound?: number;
  workColor?: string;
  restColor?: string;
  autoStart?: boolean;
  classTitle?: string;
  trainerName?: string;
}

type Phase = 'work' | 'rest' | 'done';

// ─── SVG ring geometry ───
const RING_R = 42;          // radius as % of viewBox
const RING_CIRC = 2 * Math.PI * RING_R;  // ≈ 263.9

export function FitnessWorkoutTimerWidget({
  config,
  live,
}: {
  config?: FitnessWorkoutTimerConfig;
  live?: boolean;
}) {
  const c: FitnessWorkoutTimerConfig = config || {};
  const isLive = !!live;

  const workColor  = c.workColor  || '#ff2a4d';
  const restColor  = c.restColor  || '#39ff14';
  const totalRounds = c.totalRounds  ?? 8;
  const workSec    = c.workSeconds ?? 40;
  const restSec    = c.restSeconds ?? 20;

  // ─── Timer state ───
  const [phase, setPhase]   = useState<Phase>('work');
  const [round, setRound]   = useState(c.currentRound ?? 1);
  const [remaining, setRemaining] = useState(workSec);
  const [running, setRunning]     = useState(isLive && (c.autoStart ?? false));
  const [flashing, setFlashing]   = useState(false);

  // Ref used inside interval callback so closure doesn't go stale.
  const stateRef = useRef({ phase, round, remaining, running });
  stateRef.current = { phase, round, remaining, running };

  // ─── Reset when config changes ───
  useEffect(() => {
    setPhase('work');
    setRound(c.currentRound ?? 1);
    setRemaining(workSec);
    setRunning(isLive && (c.autoStart ?? false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workSec, restSec, totalRounds, isLive]);

  // ─── 1-second countdown tick ───
  const flash = useCallback(() => {
    setFlashing(true);
    setTimeout(() => setFlashing(false), 500);
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { phase: ph, round: r, remaining: rem } = stateRef.current;
      if (rem > 1) {
        setRemaining((x) => x - 1);
        return;
      }
      // Phase ended — transition
      flash();
      if (ph === 'work') {
        setPhase('rest');
        setRemaining(restSec);
      } else {
        // rest finished
        if (r >= totalRounds) {
          setPhase('done');
          setRunning(false);
        } else {
          setPhase('work');
          setRound((x) => x + 1);
          setRemaining(workSec);
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, restSec, workSec, totalRounds, flash]);

  // ─── Click anywhere to start (live mode only) ───
  const handleClick = () => {
    if (!isLive || running) return;
    if (phase === 'done') {
      // Restart
      setPhase('work');
      setRound(1);
      setRemaining(workSec);
    }
    setRunning(true);
  };

  // ─── Computed display values ───
  const phaseSec   = phase === 'work' ? workSec : restSec;
  const progress   = phase === 'done' ? 1 : 1 - remaining / phaseSec;
  const dashOffset = RING_CIRC * (1 - progress);
  const accent     = phase === 'rest' ? restColor : workColor;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = (s % 60).toString().padStart(2, '0');
    return m > 0 ? `${m}:${ss}` : `0:${ss}`;
  };

  // ─── Static preview (not live) ───
  if (!isLive) {
    const previewAccent = workColor;
    return (
      <div className="fwtw-root" style={{ '--fwtw-accent': previewAccent, '--fwtw-bg-tint': previewAccent } as React.CSSProperties}>
        <style>{CSS}</style>
        <div className="fwtw-bg" />
        <div className="fwtw-glow" />
        {c.classTitle && (
          <div className="fwtw-chip">
            <span className="fwtw-chip-dot" />
            <span>{c.classTitle}{c.trainerName ? ` · ${c.trainerName}` : ''}</span>
          </div>
        )}
        <div className="fwtw-center">
          <div className="fwtw-phase-label" style={{ color: previewAccent }}>WORK</div>
          <div className="fwtw-ring-wrap">
            <svg className="fwtw-svg" viewBox="0 0 100 100">
              <circle className="fwtw-ring-track" cx="50" cy="50" r={RING_R} />
              <circle
                className="fwtw-ring-fill"
                cx="50" cy="50" r={RING_R}
                strokeDasharray={RING_CIRC}
                strokeDashoffset={RING_CIRC * 0.25}
                style={{ stroke: previewAccent }}
              />
            </svg>
            <div className="fwtw-countdown">0:40</div>
          </div>
          <div className="fwtw-round-label">ROUND 1 / {totalRounds}</div>
        </div>
      </div>
    );
  }

  // ─── Live render ───
  return (
    <div
      className={`fwtw-root${flashing ? ' fwtw-flash' : ''}`}
      style={{ '--fwtw-accent': accent, '--fwtw-bg-tint': accent } as React.CSSProperties}
      onClick={handleClick}
    >
      <style>{CSS}</style>
      <div className="fwtw-bg" />
      <div className="fwtw-glow" />

      {(c.classTitle || c.trainerName) && (
        <div className="fwtw-chip">
          <span className="fwtw-chip-dot" />
          <span>{c.classTitle}{c.trainerName ? ` · ${c.trainerName}` : ''}</span>
        </div>
      )}

      <div className="fwtw-center">
        <div className="fwtw-phase-label" style={{ color: accent }}>
          {phase === 'done' ? 'DONE' : phase === 'work' ? 'WORK' : 'REST'}
        </div>

        <div className="fwtw-ring-wrap">
          <svg className="fwtw-svg" viewBox="0 0 100 100">
            <circle className="fwtw-ring-track" cx="50" cy="50" r={RING_R} />
            <circle
              className="fwtw-ring-fill"
              cx="50" cy="50" r={RING_R}
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashOffset}
              style={{ stroke: accent }}
            />
          </svg>
          <div className="fwtw-countdown">
            {phase === 'done' ? '🏁' : fmtTime(remaining)}
          </div>
        </div>

        <div className="fwtw-round-label">
          {phase === 'done'
            ? 'WORKOUT COMPLETE'
            : `ROUND ${round} / ${totalRounds}`}
        </div>

        {!running && phase !== 'done' && (
          <div className="fwtw-start-hint">TAP ANYWHERE TO START</div>
        )}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Inter+Mono:wght@500;600&family=JetBrains+Mono:wght@500;600&display=swap');

.fwtw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Outfit', sans-serif;
  container-type: size;
  cursor: default;
  user-select: none;
}
.fwtw-bg {
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(160deg, #07070c 0%, #0b0b14 60%, #0a0a0f 100%);
  transition: background 600ms ease;
}
/* Subtle phase-colour wash on the background */
.fwtw-root::before {
  content: '';
  position: absolute; inset: 0; z-index: 1;
  background: radial-gradient(ellipse 70% 50% at 50% 50%, var(--fwtw-bg-tint, #ff2a4d), transparent 70%);
  opacity: 0.06;
  pointer-events: none;
  transition: background 600ms ease, opacity 600ms ease;
}
.fwtw-glow {
  position: absolute; inset: -20%; z-index: 2; pointer-events: none;
  background: radial-gradient(600px 400px at 50% 40%, var(--fwtw-accent, #ff2a4d), transparent 65%);
  opacity: 0.1;
  filter: blur(60px);
  transition: background 600ms ease;
}

/* Flash overlay for phase transition */
.fwtw-flash::after {
  content: '';
  position: absolute; inset: 0; z-index: 50;
  background: var(--fwtw-accent, #ff2a4d);
  opacity: 0.18;
  animation: fwtw-flashin 500ms ease-out forwards;
  pointer-events: none;
}
@keyframes fwtw-flashin {
  0%   { opacity: 0.22; }
  100% { opacity: 0; }
}

/* ─── Class chip top-left ─── */
.fwtw-chip {
  position: absolute; top: 3.5%; left: 4%;
  z-index: 20;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 999px;
  backdrop-filter: blur(8px);
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.6cqh, 14px);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #cbd5e1;
}
.fwtw-chip-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--fwtw-accent, #ff2a4d);
  box-shadow: 0 0 10px var(--fwtw-accent, #ff2a4d);
  flex-shrink: 0;
  animation: fwtw-blink 2s ease-in-out infinite;
}
@keyframes fwtw-blink {
  0%, 100% { opacity: 1; } 50% { opacity: 0.45; }
}

/* ─── Center block ─── */
.fwtw-center {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(6px, 1.5cqh, 14px);
  padding: clamp(16px, 4%, 40px);
  text-align: center;
}

/* ─── Phase label ─── */
.fwtw-phase-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(20px, 7cqh, 72px);
  letter-spacing: 0.25em;
  text-transform: uppercase;
  text-shadow: 0 0 30px currentColor;
  line-height: 1;
  transition: color 400ms ease;
}

/* ─── SVG ring + countdown ─── */
.fwtw-ring-wrap {
  position: relative;
  width: clamp(160px, 42cqh, 400px);
  height: clamp(160px, 42cqh, 400px);
  display: flex; align-items: center; justify-content: center;
}
.fwtw-svg {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  transform: rotate(-90deg);   /* start arc at top */
}
.fwtw-ring-track {
  fill: none;
  stroke: rgba(255,255,255,0.06);
  stroke-width: 5;
}
.fwtw-ring-fill {
  fill: none;
  stroke-width: 5;
  stroke-linecap: round;
  transition: stroke-dashoffset 900ms linear, stroke 400ms ease;
  filter: drop-shadow(0 0 8px var(--fwtw-accent, #ff2a4d));
}
.fwtw-countdown {
  position: relative; z-index: 2;
  font-family: 'Outfit', sans-serif;
  font-weight: 900;
  font-size: clamp(48px, 16cqh, 200px);
  line-height: 1;
  letter-spacing: -0.04em;
  color: #ffffff;
  text-shadow:
    0 0 40px rgba(255,255,255,0.15),
    0 2px 0 rgba(0,0,0,0.4);
  transition: font-size 200ms ease;
}

/* ─── Round counter ─── */
.fwtw-round-label {
  font-family: 'JetBrains Mono', 'Inter Mono', ui-monospace, monospace;
  font-weight: 600;
  font-size: clamp(12px, 2.4cqh, 22px);
  letter-spacing: 0.18em;
  color: #64748b;
  text-transform: uppercase;
}

/* ─── Idle hint ─── */
.fwtw-start-hint {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.8cqh, 16px);
  letter-spacing: 0.2em;
  color: var(--fwtw-accent, #ff2a4d);
  text-shadow: 0 0 12px var(--fwtw-accent, #ff2a4d);
  animation: fwtw-blink 1.6s ease-in-out infinite;
  text-transform: uppercase;
}
`;
