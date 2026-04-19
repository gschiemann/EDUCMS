"use client";

/**
 * AnimatedBackgroundWidget — pure-decoration animated layer.
 *
 * Renders the rainbow ribbon, drifting clouds, falling confetti, and
 * rising balloons WITHOUT any foreground content. Designed to sit on
 * a full-screen zone at low z-index behind the actual content widgets.
 *
 * The visual elements are copied verbatim from the locked-in
 * AnimatedWelcomeWidget (commit dc80f51 / APPROVED 2026-04-19) so that
 * the multi-zone version of the Animated Rainbow template feels
 * identical to the monolithic version, while every foreground piece
 * (clock, title, weather, announcement, etc.) becomes its own
 * editable, draggable zone.
 *
 * Config:
 *   variant?: 'rainbow' (default) — for future themes (jungle, space…)
 *   confettiCount?: number, default 80
 *
 * Built using the same transform:scale pattern: fixed 1920×1080 canvas,
 * offsetWidth measurement, scales to fill any zone.
 */

import { useEffect, useRef, useState } from 'react';

const CANVAS_W = 1920;
const CANVAS_H = 1080;

interface Cfg {
  variant?: 'rainbow';
  confettiCount?: number;
}

export function AnimatedBackgroundWidget({ config }: { config: Cfg }) {
  const c = config || {};
  const wrapperRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  // Same transform:scale pattern as the locked-in AnimatedWelcomeWidget
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      const sx = w / CANVAS_W;
      const sy = h / CANVAS_H;
      setScale(Math.min(sx, sy));
    };
    compute();
    const raf1 = requestAnimationFrame(compute);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899','#f59e0b','#10b981','#6366f1','#f43f5e','#06b6d4','#fbbf24','#a78bfa'];
    const count = c.confettiCount ?? 80;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'abw-confetti';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 6 + Math.random() * 12;
      const dur = 5 + Math.random() * 7;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = color;
      el.style.borderRadius = isCircle ? '50%' : '2px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [c.confettiCount]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        pointerEvents: 'none', // Background is purely decorative, never blocks editor clicks
      }}
    >
      <style>{CSS}</style>
      <div
        className="abw-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="abw-rainbow" />
        <div className="abw-confettiLayer" ref={confettiRef} />
        <div className="abw-bgBalloon" style={{ left: 154, background: '#f87171', animationDuration: '14s', animationDelay: '0s' }} />
        <div className="abw-bgBalloon" style={{ left: 422, background: '#fbbf24', animationDuration: '18s', animationDelay: '-6s' }} />
        <div className="abw-bgBalloon" style={{ left: 1498, background: '#60a5fa', animationDuration: '16s', animationDelay: '-3s' }} />
        <div className="abw-bgBalloon" style={{ left: 1766, background: '#a78bfa', animationDuration: '20s', animationDelay: '-10s' }} />
      </div>
    </div>
  );
}

const CSS = `
.abw-stage {
  position: relative;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  overflow: hidden;
}
.abw-stage::before, .abw-stage::after {
  content: ''; position: absolute; pointer-events: none;
  width: 200%; height: 100%;
  background-image:
    radial-gradient(ellipse 80px 30px at 10% 20%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 120px 40px at 30% 35%, rgba(255,255,255,.6), transparent 60%),
    radial-gradient(ellipse 90px 32px at 55% 18%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 110px 38px at 78% 28%, rgba(255,255,255,.6), transparent 60%);
  animation: abw-cloudDrift 90s linear infinite; top: 0; left: -100%;
}
.abw-stage::after { animation-duration: 130s; animation-delay: -40s; opacity: .65; }
@keyframes abw-cloudDrift { from { transform: translateX(0); } to { transform: translateX(50%); } }

.abw-confettiLayer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.abw-confetti {
  position: absolute; top: -20px; width: 12px; height: 18px; border-radius: 2px;
  animation: abw-confettiFall linear infinite; will-change: transform;
}
@keyframes abw-confettiFall {
  0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
  8% { opacity: 1; }
  100% { transform: translateY(1180px) rotate(720deg); opacity: .8; }
}

.abw-rainbow {
  position: absolute; left: -200px; right: -200px; top: 200px; height: 90px;
  background: repeating-linear-gradient(135deg,
    #ff5e7e 0 30px, #ffb950 30px 60px, #ffe66d 60px 90px,
    #6cd97e 90px 120px, #5cc5ff 120px 150px, #b48cff 150px 180px);
  background-size: 360px 100%;
  animation: abw-rainbowSlide 8s linear infinite;
  transform: rotate(-3deg);
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
}
@keyframes abw-rainbowSlide { from { background-position: 0 0; } to { background-position: 360px 0; } }

.abw-bgBalloon {
  position: absolute; bottom: -120px; width: 60px; height: 76px; border-radius: 50% 50% 48% 48%;
  animation: abw-balloonRise linear infinite; will-change: transform;
}
.abw-bgBalloon::after {
  content: ''; position: absolute; left: 50%; top: 100%;
  width: 1px; height: 220px; background: rgba(0,0,0,.3); transform: translateX(-50%);
}
@keyframes abw-balloonRise {
  0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
  10% { opacity: 1; }
  50% { transform: translateY(-540px) translateX(20px) rotate(8deg); }
  100% { transform: translateY(-1300px) translateX(-20px) rotate(-8deg); opacity: .9; }
}
`;
