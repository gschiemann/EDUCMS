"use client";

/**
 * AnimatedWelcomeWidget — full-screen elementary welcome scene.
 *
 * APPROVED 2026-04-19 — matches scratch/design/animated-rainbow.html.
 * Ported via the transform:scale pattern: a fixed 1920×1080 canvas
 * with every pixel size copied verbatim from the HTML mockup, wrapped
 * in a measuring container that scales it to fit any zone.
 *
 * DO NOT regress to vw/% units inside the scene — they read the
 * browser viewport, not the widget container, and the design will
 * break at 4K and on small previews. See CLAUDE.md "Template Design
 * Workflow" for the full reasoning.
 */

import { useEffect, useRef, useState } from 'react';

interface Cfg {
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  weatherTemp?: string;
  weatherDesc?: string;
  announcementLabel?: string;
  announcementMessage?: string;
  countdownLabel?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;
  teacherEmoji?: string;
  teacherName?: string;
  teacherRole?: string;
  birthdayNames?: string;
  tickerStamp?: string;
  tickerMessages?: string[] | string;
}

// Canonical canvas dimensions — every pixel size below is sized for
// this and the wrapper scales to fit. Match the HTML mockup exactly.
const CANVAS_W = 1920;
const CANVAS_H = 1080;

export function AnimatedWelcomeWidget({ config }: { config: Cfg }) {
  const c = config || {};
  const wrapperRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  // Measure THIS element (which fills its zone) and scale the 1920×1080
  // canvas to fit. Measure self instead of parent because the parent
  // sometimes hasn't laid out yet (during thumbnail hydration) and
  // returns 0×0, which collapses the canvas to invisible.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const sx = rect.width / CANVAS_W;
      const sy = rect.height / CANVAS_H;
      setScale(Math.min(sx, sy));
    };
    compute();
    const raf1 = requestAnimationFrame(compute);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); ro.disconnect(); };
  }, []);

  // Live clock — refresh every 30s
  useEffect(() => {
    const tick = () => {
      const t = document.getElementById('aw-clock-time');
      const a = document.getElementById('aw-clock-ampm');
      if (!t || !a) return;
      const d = new Date();
      const h = d.getHours();
      const m = d.getMinutes().toString().padStart(2, '0');
      a.textContent = h >= 12 ? 'PM' : 'AM';
      t.textContent = `${((h + 11) % 12) + 1}:${m}`;
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Spawn confetti once
  useEffect(() => {
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899','#f59e0b','#10b981','#6366f1','#f43f5e','#06b6d4','#fbbf24','#a78bfa'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'aw-confetti';
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
  }, []);

  const tickerList = Array.isArray(c.tickerMessages)
    ? c.tickerMessages
    : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
  const tickerText = tickerList.length
    ? tickerList.join('  ·  ')
    : 'Welcome back, Stars!  ·  Picture day is Friday  ·  Reading Challenge: 20 minutes a day';

  // Outer div fills the zone; inner div is the fixed 1920x1080 canvas
  // scaled by transform. transformOrigin top-left so it scales from
  // the corner cleanly.
  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#BFE8FF',
      }}
    >
      <style>{CSS}</style>

      <div
        className="aw-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="aw-rainbow" />
        <div className="aw-confettiLayer" ref={confettiRef} />

        <div className="aw-bgBalloon" style={{ left: 154, background: '#f87171', animationDuration: '14s', animationDelay: '0s' }} />
        <div className="aw-bgBalloon" style={{ left: 422, background: '#fbbf24', animationDuration: '18s', animationDelay: '-6s' }} />
        <div className="aw-bgBalloon" style={{ left: 1498, background: '#60a5fa', animationDuration: '16s', animationDelay: '-3s' }} />
        <div className="aw-bgBalloon" style={{ left: 1766, background: '#a78bfa', animationDuration: '20s', animationDelay: '-10s' }} />

        <div className="aw-header">
          <div className="aw-logo">{c.logoEmoji || '🍎'}</div>
          <div className="aw-titleBox">
            <h1>{c.title || 'Welcome, Friends!'}</h1>
            <div className="aw-sub">{c.subtitle || 'today is going to be amazing ✨'}</div>
          </div>
          <div className="aw-clock">
            <div className="aw-clockT" id="aw-clock-time">12:34</div>
            <div className="aw-clockAp" id="aw-clock-ampm">PM</div>
          </div>
        </div>

        <div className="aw-grid">
          <div className="aw-weather">
            <div className="aw-sunDisc">
              <div className="aw-sunFace">{c.weatherTemp || '68°'}</div>
            </div>
            <div className="aw-weatherDesc">{c.weatherDesc || '~ sunny + crisp ~'}</div>
          </div>

          <div className="aw-announce">
            <div className="aw-stars">
              <span>⭐</span><span>✨</span><span>🌟</span><span>💫</span>
            </div>
            <div className="aw-megaphone">📣</div>
            <div className="aw-annLbl">{c.announcementLabel || 'Big News'}</div>
            <div className="aw-annMsg">{c.announcementMessage || 'Book Fair starts Monday! 📚 Come find your new favorite story.'}</div>
          </div>

          <div className="aw-countdown">
            <div className="aw-badge">
              <div className="aw-cdLbl">{c.countdownLabel || 'Field Trip in'}</div>
              <div className="aw-cdNum">{c.countdownNumber ?? 3}</div>
              <div className="aw-cdUnit">{c.countdownUnit || 'days'}</div>
            </div>
          </div>

          <div className="aw-teacher">
            <div className="aw-polaroid">
              <div className="aw-tFace">{c.teacherEmoji || '👩‍🏫'}</div>
              <div className="aw-tName">{c.teacherName || 'Mrs. Johnson'}</div>
            </div>
            <div className="aw-tRole">{c.teacherRole || 'Teacher of the Week'}</div>
          </div>

          <div className="aw-birthdays">
            <div className="aw-cluster">
              <div className="aw-bal aw-bal1" />
              <div className="aw-bal aw-bal2" />
              <div className="aw-bal aw-bal3" />
              <div className="aw-cake">🎂</div>
            </div>
            <div className="aw-bdLbl">Today's Birthdays</div>
            <div className="aw-bdNames">{c.birthdayNames || 'Maya · Eli · Sofia'}</div>
          </div>
        </div>

        <div className="aw-ticker">
          <div className="aw-tickerStamp">{c.tickerStamp || 'SCHOOL NEWS'}</div>
          <div className="aw-tickerScroll">{tickerText}</div>
        </div>
      </div>
    </div>
  );
}

// CSS is identical to scratch/design/animated-rainbow.html. All sizes
// in pixels — sized for the 1920×1080 canvas. Do NOT replace with vw/%.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Patrick+Hand&display=swap');

.aw-stage {
  position: relative;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  color: #2d1b4d;
  background:
    radial-gradient(ellipse at 50% 110%, #fef3c7 0%, transparent 50%),
    linear-gradient(180deg, #BFE8FF 0%, #FFE0EC 55%, #FFD8A8 100%);
  overflow: hidden;
}
.aw-stage::before, .aw-stage::after {
  content: ''; position: absolute; pointer-events: none;
  width: 200%; height: 100%;
  background-image:
    radial-gradient(ellipse 80px 30px at 10% 20%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 120px 40px at 30% 35%, rgba(255,255,255,.6), transparent 60%),
    radial-gradient(ellipse 90px 32px at 55% 18%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 110px 38px at 78% 28%, rgba(255,255,255,.6), transparent 60%);
  animation: aw-cloudDrift 90s linear infinite; top: 0; left: -100%;
}
.aw-stage::after { animation-duration: 130s; animation-delay: -40s; opacity: .65; }
@keyframes aw-cloudDrift { from { transform: translateX(0); } to { transform: translateX(50%); } }

.aw-confettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.aw-confetti {
  position: absolute; top: -20px; width: 12px; height: 18px; border-radius: 2px;
  animation: aw-confettiFall linear infinite; will-change: transform;
}
@keyframes aw-confettiFall {
  0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
  8% { opacity: 1; }
  100% { transform: translateY(1180px) rotate(720deg); opacity: .8; }
}

.aw-rainbow {
  position: absolute; left: -200px; right: -200px; top: 200px; height: 90px; z-index: 1;
  background: repeating-linear-gradient(135deg,
    #ff5e7e 0 30px, #ffb950 30px 60px, #ffe66d 60px 90px,
    #6cd97e 90px 120px, #5cc5ff 120px 150px, #b48cff 150px 180px);
  background-size: 360px 100%;
  animation: aw-rainbowSlide 8s linear infinite;
  transform: rotate(-3deg);
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
}
@keyframes aw-rainbowSlide { from { background-position: 0 0; } to { background-position: 360px 0; } }

.aw-header {
  position: absolute; top: 36px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 180px 1fr 180px;
  gap: 36px; z-index: 5; align-items: center;
}
.aw-logo {
  width: 180px; height: 180px; background: #fff; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 96px;
  box-shadow: 0 6px 16px rgba(0,0,0,.18), inset 0 0 0 6px #fcd34d;
  animation: aw-bounceLogo 2.4s ease-in-out infinite;
}
@keyframes aw-bounceLogo {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50% { transform: translateY(-12px) rotate(4deg); }
}
.aw-titleBox {
  background: rgba(255,255,255,.85); backdrop-filter: blur(4px);
  border-radius: 28px; padding: 28px 36px; text-align: center;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  border: 5px dashed #ec4899;
  animation: aw-breathe 3.5s ease-in-out infinite;
}
@keyframes aw-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
.aw-titleBox h1 {
  margin: 0; line-height: .95;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 110px;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 33%, #10b981 66%, #6366f1 100%);
  background-size: 300% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: aw-gradientShift 6s linear infinite;
}
@keyframes aw-gradientShift { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }
.aw-sub { font-family: 'Caveat', cursive; font-size: 56px; color: #92400e; margin-top: 10px; }

.aw-clock {
  width: 180px; height: 180px;
  background: #fff; border-radius: 50%; border: 10px solid #fcd34d;
  box-shadow: 0 6px 16px rgba(0,0,0,.2);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  animation: aw-wiggle 4s ease-in-out infinite;
}
@keyframes aw-wiggle {
  0%, 7%, 100% { transform: rotate(0deg); }
  1%, 5% { transform: rotate(-12deg); }
  3% { transform: rotate(12deg); }
}
.aw-clockT { font-size: 56px; color: #be185d; line-height: 1; }
.aw-clockAp { font-size: 28px; color: #92400e; }

.aw-grid {
  position: absolute; top: 270px; left: 36px; right: 36px; bottom: 130px;
  display: grid; grid-template-columns: 380px 1fr 380px;
  grid-template-rows: 1fr 1fr; gap: 28px; z-index: 3;
}

/* WEATHER — sun with rays */
.aw-weather { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.aw-sunDisc { position: relative; width: 260px; height: 260px; display: flex; align-items: center; justify-content: center; }
.aw-sunDisc::before {
  content: ''; position: absolute; inset: -50px; border-radius: 50%;
  background:
    conic-gradient(from 0deg,
      transparent 0 18deg, #fcd34d 18deg 24deg,
      transparent 24deg 48deg, #fcd34d 48deg 54deg,
      transparent 54deg 78deg, #fcd34d 78deg 84deg,
      transparent 84deg 108deg, #fcd34d 108deg 114deg,
      transparent 114deg 138deg, #fcd34d 138deg 144deg,
      transparent 144deg 168deg, #fcd34d 168deg 174deg,
      transparent 174deg 198deg, #fcd34d 198deg 204deg,
      transparent 204deg 228deg, #fcd34d 228deg 234deg,
      transparent 234deg 258deg, #fcd34d 258deg 264deg,
      transparent 264deg 288deg, #fcd34d 288deg 294deg,
      transparent 294deg 318deg, #fcd34d 318deg 324deg,
      transparent 324deg 348deg, #fcd34d 348deg 354deg,
      transparent 354deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 130px, #000 130px, #000 165px, transparent 165px);
          mask: radial-gradient(circle, transparent 130px, #000 130px, #000 165px, transparent 165px);
  animation: aw-spin 18s linear infinite; opacity: .85;
}
@keyframes aw-spin { to { transform: rotate(360deg); } }
.aw-sunFace {
  width: 230px; height: 230px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 60px rgba(251, 191, 36, .65), inset 0 -12px 20px rgba(180, 83, 9, .25);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 76px; color: #7c2d12;
  text-shadow: 0 2px 0 rgba(255,255,255,.4);
}
.aw-weatherDesc { font-family: 'Caveat', cursive; font-size: 38px; color: #78350f; margin-top: 18px; text-align: center; text-shadow: 0 2px 0 rgba(255,255,255,.7); }

/* ANNOUNCEMENT — cloud puff */
.aw-announce {
  grid-column: 2; grid-row: 1 / span 2;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
  position: relative; padding: 50px 80px;
  animation: aw-floatUp 4s ease-in-out infinite;
}
@keyframes aw-floatUp { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-10px) rotate(1deg); } }
.aw-announce::before {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 280px; height: 200px; transform: translate(-50%, -50%);
  background: #fff; border-radius: 50%;
  box-shadow:
    -190px 30px 0 -10px #fff, -130px -50px 0 -8px #fff, -50px -90px 0 -2px #fff,
    60px -90px 0 -4px #fff, 150px -50px 0 -8px #fff, 200px 30px 0 -10px #fff,
    120px 70px 0 -6px #fff, 0 90px 0 -2px #fff, -120px 70px 0 -6px #fff,
    0 0 0 4px #fcd34d,
    -190px 30px 0 -6px #fcd34d, -130px -50px 0 -4px #fcd34d, -50px -90px 0 2px #fcd34d,
    60px -90px 0 0 #fcd34d, 150px -50px 0 -4px #fcd34d, 200px 30px 0 -6px #fcd34d,
    120px 70px 0 -2px #fcd34d, 0 90px 0 2px #fcd34d, -120px 70px 0 -2px #fcd34d,
    0 16px 32px rgba(0,0,0,.18);
  z-index: -1;
}
.aw-stars { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.aw-stars span { position: absolute; font-size: 44px; opacity: .9; animation: aw-twinkle 1.4s ease-in-out infinite; }
.aw-stars span:nth-child(1) { top: 50px; left: 130px; }
.aw-stars span:nth-child(2) { top: 80px; right: 140px; animation-delay: .3s; }
.aw-stars span:nth-child(3) { bottom: 80px; left: 160px; animation-delay: .6s; }
.aw-stars span:nth-child(4) { bottom: 60px; right: 180px; animation-delay: .9s; }
@keyframes aw-twinkle {
  0%, 100% { opacity: .25; transform: scale(.8) rotate(0deg); }
  50% { opacity: 1; transform: scale(1.2) rotate(20deg); }
}
.aw-megaphone { font-size: 96px; line-height: 1; animation: aw-shake 1.6s ease-in-out infinite; transform-origin: 80% 80%; }
@keyframes aw-shake {
  0%, 100% { transform: rotate(-8deg); }
  20%, 60% { transform: rotate(10deg); }
  40%, 80% { transform: rotate(-10deg); }
}
.aw-annLbl { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .25em; color: #b45309; text-transform: uppercase; margin-top: 12px; }
.aw-annMsg { font-family: 'Caveat', cursive; font-weight: 700; font-size: 90px; color: #be185d; line-height: 1.05; margin-top: 18px; text-shadow: 2px 2px 0 #fff; max-width: 800px; }

/* COUNTDOWN — starburst */
.aw-countdown { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; position: relative; }
.aw-badge {
  width: 280px; height: 280px;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 75%, #d97706);
  clip-path: polygon(
    50% 0%, 60% 12%, 75% 8%, 73% 23%, 88% 25%, 80% 38%,
    96% 45%, 84% 55%, 96% 65%, 80% 70%, 88% 82%, 73% 80%,
    75% 96%, 60% 88%, 50% 100%, 40% 88%, 25% 96%, 27% 80%,
    12% 82%, 20% 70%, 4% 65%, 16% 55%, 4% 45%, 20% 38%,
    12% 25%, 27% 23%, 25% 8%, 40% 12%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  box-shadow: 0 12px 28px rgba(0,0,0,.18);
  animation: aw-bounceNum 1.6s ease-in-out infinite;
}
@keyframes aw-bounceNum {
  0%, 100% { transform: scale(1) rotate(-3deg); }
  50% { transform: scale(1.06) rotate(3deg); }
}
.aw-cdLbl { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: .12em; color: #7c2d12; text-transform: uppercase; max-width: 180px; line-height: 1.05; }
.aw-cdNum { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 90px; line-height: .9; color: #7c2d12; text-shadow: 0 3px 0 rgba(255,255,255,.5); margin: 4px 0; }
.aw-cdUnit { font-family: 'Caveat', cursive; font-size: 36px; color: #7c2d12; }

/* TEACHER — polaroid */
.aw-teacher { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
.aw-polaroid {
  background: #fff; padding: 18px 18px 60px; width: 260px;
  box-shadow: 0 12px 24px rgba(0,0,0,.22);
  transform: rotate(-3deg); position: relative;
  animation: aw-slideX 5s ease-in-out infinite;
}
@keyframes aw-slideX {
  0%, 100% { transform: rotate(-3deg) translateX(-4px); }
  50% { transform: rotate(-3deg) translateX(4px); }
}
.aw-polaroid::before {
  content: ''; position: absolute; top: -16px; left: 80px;
  width: 130px; height: 28px; transform: rotate(-3deg);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #f9a8d4;
  box-shadow: 0 1px 4px rgba(0,0,0,.2);
}
.aw-tFace {
  width: 100%; aspect-ratio: 1;
  background: linear-gradient(135deg, #fce7f3, #ddd6fe);
  display: flex; align-items: center; justify-content: center; font-size: 120px;
}
.aw-tName {
  position: absolute; left: 0; right: 0; bottom: 20px; text-align: center;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 40px; color: #6d28d9;
  line-height: 1;
}
.aw-tRole {
  margin-top: 22px; text-align: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 22px; color: #be185d;
  letter-spacing: .12em; text-transform: uppercase;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
}

/* BIRTHDAYS — balloon cluster */
.aw-birthdays { grid-column: 3; grid-row: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.aw-cluster { position: relative; width: 230px; height: 200px; animation: aw-bob 1.4s ease-in-out infinite; }
@keyframes aw-bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-10px) rotate(3deg); }
}
.aw-bal { position: absolute; width: 90px; height: 110px; border-radius: 50% 50% 48% 48%; box-shadow: inset -8px -10px 12px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.18); }
.aw-bal::after { content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 60px; background: rgba(0,0,0,.4); transform: translateX(-50%); }
.aw-bal1 { left: 10px; top: 0; background: #f87171; }
.aw-bal2 { left: 70px; top: 14px; background: #fbbf24; transform: rotate(-6deg); width: 80px; height: 100px; }
.aw-bal3 { left: 130px; top: 0; background: #ec4899; }
.aw-cake { position: absolute; bottom: -15px; left: 50%; transform: translateX(-50%); font-size: 60px; line-height: 1; }
.aw-bdLbl { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 24px; letter-spacing: .12em; color: #be185d; text-transform: uppercase; margin-top: 28px; text-shadow: 0 2px 0 rgba(255,255,255,.7); }
.aw-bdNames { font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px; color: #831843; line-height: 1.05; text-shadow: 0 2px 0 rgba(255,255,255,.7); margin-top: 4px; }

/* TICKER — wavy ribbon */
.aw-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(90deg, #fcd34d, #fbbf24);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 5px solid #ec4899;
  box-shadow: 0 -4px 12px rgba(0,0,0,.12);
  clip-path: polygon(
    0% 16%, 5% 0%, 10% 16%, 15% 0%, 20% 16%, 25% 0%, 30% 16%, 35% 0%, 40% 16%,
    45% 0%, 50% 16%, 55% 0%, 60% 16%, 65% 0%, 70% 16%, 75% 0%, 80% 16%, 85% 0%,
    90% 16%, 95% 0%, 100% 16%, 100% 100%, 0% 100%);
}
.aw-tickerStamp {
  flex: 0 0 auto; padding: 0 36px; height: 100%;
  background: #ec4899; color: #fff; display: flex; align-items: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700; letter-spacing: .15em; font-size: 26px;
  border-right: 3px dashed #fff; margin-top: 18px;
}
.aw-tickerScroll {
  flex: 1; font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 44px; color: #831843;
  white-space: nowrap; padding-left: 100%; margin-top: 18px;
  animation: aw-scrollText 28s linear infinite;
}
@keyframes aw-scrollText { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-bgBalloon {
  position: absolute; bottom: -120px; width: 60px; height: 76px; border-radius: 50% 50% 48% 48%;
  z-index: 2; animation: aw-balloonRise linear infinite; will-change: transform;
}
.aw-bgBalloon::after {
  content: ''; position: absolute; left: 50%; top: 100%;
  width: 1px; height: 220px; background: rgba(0,0,0,.3); transform: translateX(-50%);
}
@keyframes aw-balloonRise {
  0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
  10% { opacity: 1; }
  50% { transform: translateY(-540px) translateX(20px) rotate(8deg); }
  100% { transform: translateY(-1300px) translateX(-20px) rotate(-8deg); opacity: .9; }
}
`;
