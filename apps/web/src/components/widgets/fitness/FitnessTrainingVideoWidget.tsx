'use client';

/**
 * FitnessTrainingVideoWidget — silent, looping equipment tutorial video.
 *
 * Intended to sit next to a piece of gym equipment (leg press, cable row,
 * rowing machine) so members can see how to use it safely without asking
 * staff. Plays muted + looped + autoplay — kiosk mode by default. Captions
 * are the primary communication channel since the gym has its own music.
 *
 * Layout: 65/35 split (video left, info panel right).
 *   • Video pane has a neon accent ring that breathes subtly.
 *   • Info panel: huge equipment name, category chip, trainer credit,
 *     bulleted safety tips with neon bullet points.
 *   • Top-right "TUTORIAL" badge sits above the split inside the widget.
 *   • Bottom: a thin video-loop progress bar so the member knows roughly
 *     where they are in the demonstration.
 *   • When no videoUrl is configured, an animated gradient placeholder
 *     renders so the widget looks intentional in the gallery preview.
 *
 * Video element notes:
 *   • `muted` is required for autoplay to work in all browsers (Chrome
 *     autoplay policy blocks unmuted media without user interaction).
 *   • `playsInline` prevents iOS from hijacking playback into the system
 *     fullscreen player — critical for kiosk walls.
 *   • `loop` is set unconditionally unless `showControls` is on, in which
 *     case the operator can scrub and replay manually.
 *   • Progress bar is driven by a requestAnimationFrame loop reading
 *     video.currentTime / video.duration — accurate down to the frame.
 *
 * Widget type: FITNESS_TRAINING_VIDEO
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FitnessTrainingVideoConfig {
  /** .mp4 URL played muted + looped. Required for actual playback. */
  videoUrl?: string;
  /** Equipment display name — e.g. "LEG PRESS", "CABLE ROW". */
  equipmentName?: string;
  /** Equipment category chip — e.g. "STRENGTH", "CARDIO", "MOBILITY". */
  equipmentCategory?: string;
  /** Trainer name credited for the demonstration. */
  trainerName?: string;
  /** Bullet-list safety tips shown in the right panel. */
  safetyTips?: string[];
  /** Neon accent hex. Default: #39ff14 neon green */
  accentColor?: string;
  /** Show native video controls (seekbar, play/pause). Default: false */
  showControls?: boolean;
  /** Static poster image shown before first play or on load failure. */
  posterUrl?: string;
}

// ─── Demo content — shown when config fields are unset ───
const DEMO_TIPS = [
  'Keep your back flat against the pad throughout the movement',
  'Lower slowly on a 3-second count; drive through your heels',
  'Never lock your knees at the top of the rep',
];
const DEMO_EQUIPMENT = 'LEG PRESS';
const DEMO_CATEGORY  = 'STRENGTH';
const DEMO_TRAINER   = 'Coach Rivera';

export function FitnessTrainingVideoWidget({
  config,
  live,
}: {
  config?: FitnessTrainingVideoConfig;
  live?: boolean;
}) {
  const c: FitnessTrainingVideoConfig = config || {};
  const isLive = !!live;
  const accent = c.accentColor || '#39ff14';

  const equipmentName     = c.equipmentName     || DEMO_EQUIPMENT;
  const equipmentCategory = c.equipmentCategory || DEMO_CATEGORY;
  const trainerName       = c.trainerName       || DEMO_TRAINER;
  const safetyTips        = (c.safetyTips && c.safetyTips.length > 0) ? c.safetyTips : DEMO_TIPS;
  const showControls      = c.showControls === true;

  // ─── Video progress tracking ───
  const videoRef  = useRef<HTMLVideoElement>(null);
  const rafRef    = useRef<number>(0);
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState(false);

  const tick = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration > 0) {
      setProgress(v.currentTime / v.duration);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!isLive || !c.videoUrl) return;
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isLive, c.videoUrl, tick]);

  // Reset error flag if videoUrl changes.
  useEffect(() => {
    setHasError(false);
    setProgress(0);
  }, [c.videoUrl]);

  const hasVideo = !!c.videoUrl && !hasError;

  return (
    <div className="ftvw-root" style={{ '--ftvw-accent': accent } as React.CSSProperties}>
      <style>{CSS}</style>

      {/* Background */}
      <div className="ftvw-bg" />
      <div className="ftvw-glow" />
      <div className="ftvw-grain" aria-hidden />

      {/* TUTORIAL badge — top right, floats above the split */}
      <div className="ftvw-tutorial-badge">
        <span className="ftvw-badge-dot" />
        TUTORIAL
      </div>

      {/* Main split layout */}
      <div className="ftvw-split">

        {/* ─── LEFT — video pane ─── */}
        <div className="ftvw-video-pane">
          {/* Neon accent ring around the video pane */}
          <div className="ftvw-video-ring" aria-hidden />

          {hasVideo ? (
            <video
              ref={videoRef}
              className="ftvw-video"
              src={c.videoUrl}
              autoPlay
              muted
              loop={!showControls}
              playsInline
              controls={showControls}
              poster={c.posterUrl}
              onError={() => setHasError(true)}
            />
          ) : (
            /* Placeholder when no video is configured or load failed */
            <div className="ftvw-placeholder">
              <div className="ftvw-placeholder-anim" />
              <div className="ftvw-placeholder-inner">
                <div className="ftvw-placeholder-icon" aria-hidden>
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                    <polygon points="19,15 35,24 19,33" fill="currentColor" opacity="0.6" />
                  </svg>
                </div>
                <div className="ftvw-placeholder-text">
                  {hasError ? 'Video unavailable' : 'Equipment tutorial preview'}
                </div>
              </div>
            </div>
          )}

          {/* Video loop progress bar — sits at the bottom of the video pane */}
          <div className="ftvw-progress-track" aria-hidden>
            <div
              className="ftvw-progress-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        {/* ─── RIGHT — info panel ─── */}
        <div className="ftvw-info-pane">

          {/* Category chip */}
          <div className="ftvw-category-chip">
            <span className="ftvw-category-dot" />
            {equipmentCategory}
          </div>

          {/* Equipment name — huge display heading */}
          <div className="ftvw-equipment-name">{equipmentName}</div>

          {/* Trainer credit */}
          {trainerName && (
            <div className="ftvw-trainer">
              <span className="ftvw-trainer-label">WITH</span>
              <span className="ftvw-trainer-name">{trainerName}</span>
            </div>
          )}

          {/* Divider */}
          <div className="ftvw-divider" aria-hidden />

          {/* Safety tips */}
          {safetyTips.length > 0 && (
            <div className="ftvw-tips">
              <div className="ftvw-tips-label">SAFETY TIPS</div>
              <ul className="ftvw-tips-list" aria-label="Safety tips">
                {safetyTips.map((tip, i) => (
                  <li key={i} className="ftvw-tip-item">
                    <span className="ftvw-tip-bullet" aria-hidden />
                    <span className="ftvw-tip-text">{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer: loop indicator */}
          <div className="ftvw-loop-indicator">
            <svg className="ftvw-loop-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M14 6.5A6 6 0 1 0 8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <polyline points="11,4 14,6.5 11,9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="ftvw-loop-text">Loops continuously · muted</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');

.ftvw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}

/* ─── Background stack (matches fitness pack DNA) ─── */
.ftvw-bg {
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(145deg, #07070c 0%, #0a0a0f 60%, #0b0b10 100%);
}
.ftvw-glow {
  position: absolute; inset: -20%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(600px 500px at 65% 80%, var(--ftvw-accent, #39ff14), transparent 65%);
  opacity: 0.08;
  filter: blur(80px);
}
.ftvw-grain {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ─── TUTORIAL badge ─── */
.ftvw-tutorial-badge {
  position: absolute; top: clamp(10px, 2.2cqh, 18px); right: clamp(10px, 2.2cqw, 18px);
  z-index: 20;
  display: inline-flex; align-items: center; gap: 6px;
  padding: clamp(4px, 0.8cqh, 7px) clamp(8px, 1.8cqw, 14px);
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(10px);
  border: 1px solid var(--ftvw-accent, #39ff14);
  border-radius: 5px;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(9px, 1.5cqh, 13px);
  letter-spacing: 0.28em;
  color: var(--ftvw-accent, #39ff14);
  text-shadow: 0 0 12px var(--ftvw-accent, #39ff14);
  box-shadow: 0 0 16px rgba(57,255,20,0.2);
  text-transform: uppercase;
}
.ftvw-badge-dot {
  width: clamp(5px, 0.9cqh, 8px);
  height: clamp(5px, 0.9cqh, 8px);
  border-radius: 50%;
  background: var(--ftvw-accent, #39ff14);
  box-shadow: 0 0 8px var(--ftvw-accent, #39ff14);
  animation: ftvw-dot-blink 2.4s ease-in-out infinite;
}
@keyframes ftvw-dot-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

/* ─── 65 / 35 split ─── */
.ftvw-split {
  position: absolute; inset: 0;
  z-index: 10;
  display: flex;
}

/* ─── Video pane (left, 65%) ─── */
.ftvw-video-pane {
  position: relative;
  flex: 0 0 65%;
  overflow: hidden;
  /* inner border so it doesn't clip the ring */
  margin: clamp(10px, 2.5cqh, 20px) 0 clamp(10px, 2.5cqh, 20px) clamp(10px, 2.5cqw, 20px);
  border-radius: 10px;
}

/* Neon accent ring — breathes like the music widget's pulse ring */
.ftvw-video-ring {
  position: absolute; inset: 0; z-index: 5;
  border-radius: 10px;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 2px var(--ftvw-accent, #39ff14),
    0 0 28px var(--ftvw-accent, #39ff14);
  opacity: 0.3;
  animation: ftvw-ring-breathe 3.5s ease-in-out infinite;
}
@keyframes ftvw-ring-breathe {
  0%, 100% { opacity: 0.22; box-shadow: inset 0 0 0 2px var(--ftvw-accent, #39ff14), 0 0 18px var(--ftvw-accent, #39ff14); }
  50%      { opacity: 0.50; box-shadow: inset 0 0 0 2px var(--ftvw-accent, #39ff14), 0 0 40px var(--ftvw-accent, #39ff14); }
}

.ftvw-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
  border-radius: 10px;
}

/* ─── Placeholder (no videoUrl / load error) ─── */
.ftvw-placeholder {
  position: absolute; inset: 0;
  border-radius: 10px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: #0d0d14;
}
.ftvw-placeholder-anim {
  position: absolute; inset: 0;
  background: linear-gradient(
    120deg,
    #0d0d14 0%,
    rgba(57,255,20,0.08) 30%,
    rgba(0,212,255,0.06) 60%,
    #0d0d14 100%
  );
  background-size: 300% 300%;
  animation: ftvw-shimmer 6s ease-in-out infinite;
}
@keyframes ftvw-shimmer {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.ftvw-placeholder-inner {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center; gap: clamp(8px, 2cqh, 16px);
}
.ftvw-placeholder-icon {
  width: clamp(36px, 10cqh, 72px);
  height: clamp(36px, 10cqh, 72px);
  color: var(--ftvw-accent, #39ff14);
  opacity: 0.55;
}
.ftvw-placeholder-icon svg { width: 100%; height: 100%; }
.ftvw-placeholder-text {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 2cqh, 17px);
  letter-spacing: 0.15em;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  text-align: center;
  padding: 0 8px;
}

/* ─── Loop progress bar at bottom of video pane ─── */
.ftvw-progress-track {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 3px; z-index: 6;
  background: rgba(255,255,255,0.07);
  border-radius: 0 0 10px 10px;
}
.ftvw-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ftvw-accent, #39ff14), rgba(255,255,255,0.5));
  border-radius: 0 0 10px 10px;
  box-shadow: 0 0 10px var(--ftvw-accent, #39ff14);
  transition: width 150ms linear;
}

/* ─── Info pane (right, 35%) ─── */
.ftvw-info-pane {
  flex: 1;
  display: flex; flex-direction: column;
  padding: clamp(16px, 3.5cqh, 30px) clamp(14px, 3cqw, 26px) clamp(12px, 2.5cqh, 22px);
  overflow: hidden;
  min-width: 0;
}

/* Category chip */
.ftvw-category-chip {
  display: inline-flex; align-items: center; gap: clamp(5px, 0.8cqw, 8px);
  padding: clamp(3px, 0.6cqh, 6px) clamp(8px, 1.5cqw, 13px);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.11);
  border-radius: 999px;
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(9px, 1.4cqh, 12px);
  letter-spacing: 0.22em;
  color: var(--ftvw-accent, #39ff14);
  text-transform: uppercase;
  align-self: flex-start;
  margin-bottom: clamp(8px, 1.8cqh, 14px);
}
.ftvw-category-dot {
  width: clamp(5px, 0.85cqh, 7px);
  height: clamp(5px, 0.85cqh, 7px);
  border-radius: 50%;
  background: var(--ftvw-accent, #39ff14);
  box-shadow: 0 0 7px var(--ftvw-accent, #39ff14);
}

/* Equipment name — very large, punchy */
.ftvw-equipment-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 900;
  font-size: clamp(20px, 6.5cqh, 58px);
  line-height: 1.0;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-bottom: clamp(6px, 1.2cqh, 12px);
  /* Two-line clamp so extremely long names don't blow the layout */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Trainer credit */
.ftvw-trainer {
  display: flex; align-items: baseline; gap: clamp(5px, 0.9cqw, 8px);
  margin-bottom: clamp(10px, 2cqh, 18px);
}
.ftvw-trainer-label {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.3cqh, 11px);
  letter-spacing: 0.22em;
  color: #475569;
  text-transform: uppercase;
}
.ftvw-trainer-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(12px, 2cqh, 17px);
  color: #94a3b8;
}

/* Divider */
.ftvw-divider {
  height: 1px;
  background: rgba(255,255,255,0.07);
  margin-bottom: clamp(10px, 2cqh, 16px);
}

/* Safety tips section */
.ftvw-tips {
  flex: 1;
  overflow: hidden;
  display: flex; flex-direction: column;
  min-height: 0;
}
.ftvw-tips-label {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(9px, 1.4cqh, 12px);
  letter-spacing: 0.28em;
  color: var(--ftvw-accent, #39ff14);
  text-shadow: 0 0 10px var(--ftvw-accent, #39ff14);
  text-transform: uppercase;
  margin-bottom: clamp(6px, 1.2cqh, 10px);
}
.ftvw-tips-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: clamp(6px, 1.2cqh, 11px);
  overflow: hidden;
}
.ftvw-tip-item {
  display: flex; align-items: flex-start; gap: clamp(7px, 1.2cqw, 11px);
}
.ftvw-tip-bullet {
  flex-shrink: 0;
  margin-top: 0.4em;
  width: clamp(5px, 0.9cqh, 7px);
  height: clamp(5px, 0.9cqh, 7px);
  border-radius: 50%;
  background: var(--ftvw-accent, #39ff14);
  box-shadow: 0 0 8px var(--ftvw-accent, #39ff14);
}
.ftvw-tip-text {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: clamp(10px, 1.8cqh, 15px);
  line-height: 1.45;
  color: #94a3b8;
  /* Soft clamp per tip so very long tips don't overflow the pane */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ─── Loop indicator at the bottom of the info pane ─── */
.ftvw-loop-indicator {
  display: flex; align-items: center; gap: clamp(5px, 0.9cqw, 8px);
  margin-top: clamp(8px, 1.8cqh, 14px);
  padding-top: clamp(7px, 1.4cqh, 11px);
  border-top: 1px solid rgba(255,255,255,0.05);
}
.ftvw-loop-icon {
  flex-shrink: 0;
  width: clamp(11px, 1.8cqh, 16px);
  height: clamp(11px, 1.8cqh, 16px);
  color: #334155;
}
.ftvw-loop-text {
  font-family: 'Inter', sans-serif;
  font-size: clamp(9px, 1.3cqh, 11px);
  font-weight: 500;
  color: #334155;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;
