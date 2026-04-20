'use client';

/**
 * FitnessMotivationalQuoteWidget — rotating gym-wall motivational
 * quotes. Nike / Peloton aesthetic: massive white Outfit type,
 * neon opening curly-quote, slow-drifting light-ray background.
 *
 * Widget type: FITNESS_MOTIVATIONAL_QUOTE
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface FitnessMotivationalQuoteConfig {
  quotes?: Array<{ text: string; author?: string }>;
  rotationMs?: number;
  accentColor?: string;
  showAuthor?: boolean;
  transitionStyle?: 'crossfade' | 'typewriter' | 'slide';
  align?: 'center' | 'left';
  bgStyle?: 'solid' | 'gradient' | 'photo-overlay';
}

const DEFAULT_QUOTES: Array<{ text: string; author?: string }> = [
  {
    text: "Stay hard.",
    author: "David Goggins",
  },
  {
    text: "The last three or four reps is what makes the muscle grow. This area of pain divides the champion from someone who is not a champion.",
    author: "Arnold Schwarzenegger",
  },
  {
    text: "It ain't about how hard you hit. It's about how hard you can get hit and keep moving forward.",
    author: "Rocky Balboa",
  },
  {
    text: "Float like a butterfly, sting like a bee.",
    author: "Muhammad Ali",
  },
  {
    text: "Pain is temporary. Quitting lasts forever.",
    author: "Lance Armstrong",
  },
  {
    text: "The only bad workout is the one that didn't happen.",
    author: "",
  },
];

// ─── Particle field ───
// 28 slow-drifting light rays generated once per mount.
function useLightRays(count = 7) {
  return useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      // Spread origins across the top half of the widget
      x: 10 + (i / (count - 1)) * 80,
      // Width varies so they don't all look identical
      width: 1 + Math.random() * 2.5,
      // Each ray drifts at its own pace
      duration: 12 + Math.random() * 18,
      delay: -Math.random() * 20,
      opacity: 0.04 + Math.random() * 0.07,
    })),
  [count]);
}

// ─── Typewriter hook ───
function useTypewriter(text: string, active: boolean, speedMs = 36) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    if (!active) { setDisplayed(text); return; }
    setDisplayed('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speedMs);
    return () => clearInterval(id);
  }, [text, active, speedMs]);
  return displayed;
}

export function FitnessMotivationalQuoteWidget({
  config,
  live,
}: {
  config?: FitnessMotivationalQuoteConfig;
  live?: boolean;
}) {
  const c: FitnessMotivationalQuoteConfig = config || {};
  const isLive = !!live;

  const accent = c.accentColor || '#39ff14';
  const rotationMs = c.rotationMs ?? 10_000;
  const showAuthor = c.showAuthor !== false;
  const transition = c.transitionStyle || 'crossfade';
  const align = c.align || 'center';
  const quotes = (c.quotes && c.quotes.length > 0) ? c.quotes : DEFAULT_QUOTES;

  // ─── Quote rotation ───
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  // Slide/crossfade: separate visible/entering quote states
  const [visible, setVisible] = useState(0);
  const [entering, setEntering] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle');

  useEffect(() => {
    if (!isLive) return;
    const started = Date.now();
    const prog = setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - started) / rotationMs) * 100));
    }, 60);

    const tick = setTimeout(() => {
      const next = (idx + 1) % quotes.length;
      if (transition === 'crossfade' || transition === 'typewriter') {
        setIdx(next);
        setProgress(0);
      } else {
        // slide: animate out then in
        setEntering(next);
        setPhase('out');
        setTimeout(() => {
          setVisible(next);
          setEntering(null);
          setPhase('in');
          setIdx(next);
          setProgress(0);
          setTimeout(() => setPhase('idle'), 600);
        }, 500);
      }
    }, rotationMs);

    return () => { clearInterval(prog); clearTimeout(tick); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, idx, rotationMs, quotes.length, transition]);

  const rays = useLightRays(7);

  const current = quotes[idx % quotes.length];

  // Typewriter effect applies only in that mode
  const twText = useTypewriter(current.text, isLive && transition === 'typewriter');
  const displayText = (isLive && transition === 'typewriter') ? twText : current.text;

  // Animation class for crossfade / slide
  let quoteClass = 'fmqw-quote-block';
  if (transition === 'crossfade') quoteClass += ' fmqw-cf';
  if (transition === 'slide') {
    if (phase === 'out') quoteClass += ' fmqw-slide-out';
    else if (phase === 'in') quoteClass += ' fmqw-slide-in';
    else quoteClass += ' fmqw-slide-idle';
  }

  // Progress bar shrinks right-to-left — full at start, empty at end
  const barWidth = isLive ? 100 - progress : 100;

  return (
    <div
      className="fmqw-root"
      style={{
        '--fmqw-accent': accent,
        '--fmqw-align': align === 'left' ? 'left' : 'center',
        '--fmqw-items': align === 'left' ? 'flex-start' : 'center',
      } as React.CSSProperties}
    >
      <style>{CSS}</style>

      {/* Background gradient */}
      <div className="fmqw-bg" />

      {/* Slow-drift light rays */}
      <div className="fmqw-rays" aria-hidden>
        {rays.map((r) => (
          <div
            key={r.id}
            className="fmqw-ray"
            style={{
              left: `${r.x}%`,
              width: `${r.width}%`,
              animationDuration: `${r.duration}s`,
              animationDelay: `${r.delay}s`,
              opacity: r.opacity,
            }}
          />
        ))}
      </div>

      {/* Quote content */}
      <div className="fmqw-center">
        <div
          className={quoteClass}
          // Key forces crossfade re-mount on quote change
          key={transition === 'crossfade' ? idx : undefined}
        >
          {/* Opening curly quote in neon */}
          <div className="fmqw-open-quote" aria-hidden>&#x275D;</div>

          <blockquote className="fmqw-text">
            {displayText || '\u00A0'}
          </blockquote>

          {showAuthor && current.author && (
            <div className="fmqw-author">
              <span className="fmqw-author-line" />
              <span className="fmqw-author-name">{current.author}</span>
            </div>
          )}
        </div>
      </div>

      {/* Rotation progress bar — thin neon line at bottom, shrinks right to left */}
      <div className="fmqw-progress-track" aria-hidden>
        <div
          className="fmqw-progress-fill"
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Inter:ital,wght@1,400;1,500&display=swap');

.fmqw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  font-family: 'Outfit', sans-serif;
  color: #f8fafc;
  container-type: size;
}

/* ─── Dark charcoal gradient background ─── */
.fmqw-bg {
  position: absolute; inset: 0; z-index: 0;
  background:
    linear-gradient(160deg, #07070c 0%, #0d0d14 45%, #0a0a0f 100%);
}

/* ─── Slow-drifting vertical light rays ─── */
.fmqw-rays {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  overflow: hidden;
}
.fmqw-ray {
  position: absolute;
  top: -10%;
  height: 130%;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(255,255,255,0.9) 20%,
    rgba(255,255,255,0.7) 50%,
    rgba(255,255,255,0.9) 80%,
    transparent 100%
  );
  filter: blur(18px);
  transform-origin: top center;
  animation: fmqw-ray-drift linear infinite;
}
@keyframes fmqw-ray-drift {
  0%   { transform: translateX(-6px) rotate(-1.5deg) scaleX(0.9); }
  50%  { transform: translateX( 6px) rotate( 1.5deg) scaleX(1.1); }
  100% { transform: translateX(-6px) rotate(-1.5deg) scaleX(0.9); }
}

/* ─── Center quote column ─── */
.fmqw-center {
  position: absolute; inset: 0; z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(24px, 7%, 72px) clamp(24px, 8%, 96px) clamp(36px, 9%, 80px);
}

/* ─── Quote block ─── */
.fmqw-quote-block {
  display: flex;
  flex-direction: column;
  align-items: var(--fmqw-items, center);
  gap: clamp(10px, 2.5cqh, 24px);
  max-width: 90%;
  width: 100%;
  text-align: var(--fmqw-align, center);
}

/* Crossfade: fade in on mount */
.fmqw-cf {
  animation: fmqw-fadein 700ms ease forwards;
}
@keyframes fmqw-fadein {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Slide transitions */
.fmqw-slide-idle { opacity: 1; transform: translateY(0); }
.fmqw-slide-out {
  animation: fmqw-slideout 500ms ease forwards;
}
.fmqw-slide-in {
  animation: fmqw-slidein 600ms ease forwards;
}
@keyframes fmqw-slideout {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-3%); }
}
@keyframes fmqw-slidein {
  from { opacity: 0; transform: translateY(3%); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ─── Opening curly quote mark ─── */
.fmqw-open-quote {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(36px, 15cqh, 120px);
  line-height: 0.7;
  color: var(--fmqw-accent, #39ff14);
  text-shadow: 0 0 30px var(--fmqw-accent, #39ff14);
  align-self: var(--fmqw-items, center);
  user-select: none;
}

/* ─── Quote text ─── */
.fmqw-text {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(18px, 10cqh, 80px);
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: #ffffff;
  margin: 0;
  /* Hard cap at 3 visible lines — beyond that the text clips, which
     is intentional: quotes should be punchy. */
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-shadow: 0 2px 20px rgba(0,0,0,0.3);
}

/* ─── Author attribution ─── */
.fmqw-author {
  display: flex;
  align-items: center;
  gap: clamp(8px, 1.5cqw, 18px);
  opacity: 0.45;
  margin-top: clamp(4px, 1cqh, 10px);
}
.fmqw-author-line {
  display: inline-block;
  width: clamp(20px, 3cqw, 48px);
  height: 1px;
  background: currentColor;
  flex-shrink: 0;
}
.fmqw-author-name {
  font-family: 'Inter', sans-serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(12px, 2.4cqh, 22px);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Rotation progress bar — bottom, shrinks right to left ─── */
.fmqw-progress-track {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 3px;
  background: rgba(255,255,255,0.04);
  z-index: 20;
  overflow: hidden;
}
.fmqw-progress-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: var(--fmqw-accent, #39ff14);
  box-shadow: 0 0 10px var(--fmqw-accent, #39ff14);
  transition: width 120ms linear;
}
`;
