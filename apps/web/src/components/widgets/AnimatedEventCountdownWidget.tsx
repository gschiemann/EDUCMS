"use client";

/**
 * AnimatedEventCountdownWidget — full-screen single-focus countdown
 * for musicals, pep rallies, graduation, testing windows, etc.
 *
 * Ported from scratch/design/animated-event-countdown.html (approved
 * 2026-04-19, user feedback: "this one is perfect, build it").
 *
 * Same patterns as the Welcome + Cafeteria widgets:
 * - 1920×1080 fixed canvas + transform:scale via offsetWidth so it
 *   scales to any zone / any gallery thumbnail.
 * - `live` prop gates expensive work (second-tick timer + confetti).
 * - `aw-edit-section` hotspot CustomEvent routes clicks in the
 *   preview to the matching PropertiesPanel section.
 *
 * Countdown math: we render D/H/M/S from the delta between
 * config.countdownDate (or countdownDateTime) and now. If no target
 * is set we render a zero countdown; if the target is in the past
 * we stop at zero (no negative numbers — the scene naturally ends
 * itself after the event passes).
 */

import { useEffect, useRef, useState } from 'react';

interface InfoCard { icon?: string; label?: string; value?: string }

interface Cfg {
  eyebrow?: string;            // small pill above the title
  title?: string;              // big gradient headline
  subtitle?: string;           // Caveat script line under the title
  countdownDate?: string;      // ISO date 'YYYY-MM-DD' — assumes midnight
  countdownDateTime?: string;  // ISO datetime 'YYYY-MM-DDTHH:mm' — wins over countdownDate
  infoCards?: InfoCard[];      // bottom 3 glass cards; renders up to 3
  tickerStamp?: string;
  tickerMessages?: string[] | string;
  tickerSpeed?: 'slow' | 'normal' | 'fast' | number;
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function tickerDurationSec(speed: Cfg['tickerSpeed'], baseSec: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return baseSec * 1.8;
  if (speed === 'fast') return baseSec * 0.6;
  return baseSec;
}

// Break a millisecond delta into D/H/M/S with each field zero-padded
// to 2 digits. Negative delta => all zeros (event has passed).
function splitDelta(msUntil: number): { d: string; h: string; m: string; s: string } {
  if (!isFinite(msUntil) || msUntil <= 0) return { d: '00', h: '00', m: '00', s: '00' };
  const totalSec = Math.floor(msUntil / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { d: pad(d), h: pad(h), m: pad(m), s: pad(s) };
}

export function AnimatedEventCountdownWidget({ config, live }: { config: Cfg; live?: boolean }) {
  const c = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / CANVAS_W, h / CANVAS_H));
    };
    compute();
    const r1 = requestAnimationFrame(compute);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, []);

  // Tick every second on live — seconds field needs the resolution.
  // In thumbnail mode we skip the interval entirely; the frozen
  // snapshot reads just fine.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // Confetti — 80 pieces, only on live (saves 80 DOM nodes × N
  // thumbnails in the templates gallery).
  useEffect(() => {
    if (!isLive) return;
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#fbbf24', '#ec4899', '#06b6d4', '#f59e0b', '#a78bfa', '#10b981', '#f43f5e'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'ec-confetti';
      const size = 6 + Math.random() * 14;
      const dur = 5 + Math.random() * 9;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.borderRadius = isCircle ? '50%' : '3px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [isLive]);

  // Compute the countdown. countdownDateTime wins over countdownDate
  // when both are present (datetime is precise to the minute).
  const target = (() => {
    if (c.countdownDateTime) {
      const t = new Date(c.countdownDateTime);
      return isNaN(t.getTime()) ? null : t;
    }
    if (c.countdownDate) {
      // midnight local on that date
      const t = new Date(c.countdownDate + 'T00:00:00');
      return isNaN(t.getTime()) ? null : t;
    }
    return null;
  })();
  const msUntil = target ? (target.getTime() - now.getTime()) : 0;
  const { d, h, m, s } = splitDelta(msUntil);

  const tickerText = (() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'Tickets $5 at the door · cash or card  ✦  Family matinee Saturday  ✦  Help promote — flyers in the main office';
  })();

  // Up to 3 info cards — if caller provides fewer, we just render fewer.
  const cards: InfoCard[] = Array.isArray(c.infoCards) && c.infoCards.length > 0
    ? c.infoCards.slice(0, 3)
    : [
        { icon: '📍', label: 'Where',    value: 'Main Auditorium' },
        { icon: '🎭', label: 'Starring', value: 'The 7th Grade Cast' },
        { icon: '🎟️', label: 'Tickets',  value: '$5 at the door' },
      ];

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1e3a8a',
      }}
    >
      <style>{CSS_EC}</style>

      <div
        className="ec-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="ec-stars" />
        <div className="ec-spot ec-l" />
        <div className="ec-spot ec-r" />
        <div className="ec-confettiLayer" ref={confettiRef} />

        <div className="ec-header">
          {c.eyebrow && <div className="ec-eyebrow">{c.eyebrow}</div>}
          <div className="ec-title">{c.title || 'Spring Musical'}</div>
          {c.subtitle && <div className="ec-subtitle">{c.subtitle}</div>}
        </div>

        <div className="ec-countdown">
          <div className="ec-unit"><div className="ec-num">{d}</div><div className="ec-label">Days</div></div>
          <div className="ec-gap">:<br />:</div>
          <div className="ec-unit"><div className="ec-num">{h}</div><div className="ec-label">Hours</div></div>
          <div className="ec-gap">:<br />:</div>
          <div className="ec-unit"><div className="ec-num">{m}</div><div className="ec-label">Min</div></div>
          <div className="ec-gap">:<br />:</div>
          <div className="ec-unit"><div className="ec-num">{s}</div><div className="ec-label">Sec</div></div>
        </div>

        <div className="ec-infoRow">
          {cards.map((card, i) => (
            <div key={i} className="ec-infoCard">
              {card.icon && <span className="ec-infoIcon">{card.icon}</span>}
              <div>
                {card.label && <div className="ec-infoLabel">{card.label}</div>}
                {card.value && <div className="ec-infoValue">{card.value}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="ec-ticker">
          <div className="ec-stamp">{(c.tickerStamp || 'Save the Date').toUpperCase()}</div>
          <div className="ec-tickerScroll">
            <span
              className="ec-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 42)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — builder-only, gated on !isLive. */}
        {!isLive && (
          <>
            <Hotspot section="header"     x={120}  y={40}  w={1680} h={260} />
            <Hotspot section="countdown"  x={120}  y={320} w={1680} h={320} />
            <Hotspot section="infoCards"  x={120}  y={680} w={1680} h={190} />
            <Hotspot section="ticker"     x={0}    y={980} w={1920} h={100} />
          </>
        )}
      </div>
    </div>
  );
}

function Hotspot({ section, x, y, w, h }: { section: string; x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="aw-hotspot"
      data-section={section}
      role="button"
      tabIndex={0}
      onPointerDown={() => {
        try { window.dispatchEvent(new CustomEvent('aw-edit-section', { detail: { section } })); } catch { /* noop */ }
      }}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h, cursor: 'pointer', zIndex: 50 }}
      aria-label={`Edit ${section}`}
    />
  );
}

// Every pixel size sized for 1920×1080 — scaled by the wrapper.
const CSS_EC = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Caveat:wght@700&family=Inter:wght@600;800&display=swap');

.ec-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(251,191,36,.35) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(236,72,153,.45) 0%, transparent 50%),
    linear-gradient(180deg, #1e3a8a 0%, #7c3aed 50%, #be185d 100%);
  overflow: hidden;
}

.ec-confettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
.ec-confetti {
  position: absolute; top: -30px; width: 14px; height: 22px; border-radius: 3px;
  animation: ec-fall linear infinite; will-change: transform;
}
@keyframes ec-fall {
  0%   { transform: translateY(-30px) rotate(0); opacity: 0; }
  5%   { opacity: 1; }
  100% { transform: translateY(1110px) rotate(720deg); opacity: .9; }
}

.ec-spot {
  position: absolute; width: 800px; height: 1200px;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,.08) 40%, transparent 100%);
  transform-origin: 50% 100%; pointer-events: none;
  animation: ec-spot 14s ease-in-out infinite;
  z-index: 1;
}
.ec-l { left: -10%; bottom: 0; transform: rotate(-20deg); }
.ec-r { right: -10%; bottom: 0; transform: rotate(20deg); animation-delay: -7s; }
@keyframes ec-spot { 0%, 100% { opacity: .25; } 50% { opacity: .6; } }

.ec-stars {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background:
    radial-gradient(1px 1px at 10% 12%, #fff, transparent),
    radial-gradient(2px 2px at 24% 28%, #fff, transparent),
    radial-gradient(1px 1px at 38% 8%, #fff, transparent),
    radial-gradient(2px 2px at 56% 22%, #fff, transparent),
    radial-gradient(1px 1px at 72% 14%, #fff, transparent),
    radial-gradient(1px 1px at 88% 32%, #fff, transparent),
    radial-gradient(2px 2px at 8% 48%, #fbbf24, transparent),
    radial-gradient(1px 1px at 92% 60%, #fbbf24, transparent);
  opacity: .7;
  animation: ec-twinkle 3s ease-in-out infinite;
}
@keyframes ec-twinkle { 0%, 100% { opacity: .5; } 50% { opacity: .9; } }

.ec-header { position: absolute; top: 60px; left: 0; right: 0; text-align: center; z-index: 4; }
.ec-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 28px;
  color: #fbbf24; letter-spacing: .4em; text-transform: uppercase;
  margin-bottom: 6px;
  text-shadow: 0 0 20px rgba(251,191,36,.6);
}
.ec-title {
  font-family: 'Anton', sans-serif; font-size: 150px; line-height: .92;
  background: linear-gradient(90deg, #fbbf24 0%, #ec4899 50%, #06b6d4 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: ec-titleShift 6s linear infinite;
  letter-spacing: .02em;
  text-transform: uppercase;
  filter: drop-shadow(0 10px 20px rgba(0,0,0,.4));
  white-space: nowrap; padding: 0 40px;
}
@keyframes ec-titleShift { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
.ec-subtitle {
  font-family: 'Caveat', cursive; font-size: 52px;
  color: #fef3c7; margin-top: 4px;
  text-shadow: 2px 2px 0 rgba(0,0,0,.3);
}

.ec-countdown {
  position: absolute; top: 340px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 24px; z-index: 5;
  animation: ec-breathe 4s ease-in-out infinite;
}
@keyframes ec-breathe { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.02); } }

.ec-unit {
  position: relative;
  width: 240px; height: 260px;
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  border: 5px solid #fbbf24; border-radius: 20px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 0 0 4px rgba(251,191,36,.3), 0 20px 40px rgba(0,0,0,.5), inset 0 0 40px rgba(251,191,36,.12);
}
.ec-unit::before {
  content: ''; position: absolute; top: 50%; left: 8px; right: 8px; height: 2px;
  background: rgba(255,255,255,.15); transform: translateY(-50%);
}
.ec-num {
  font-family: 'Anton', sans-serif; font-size: 180px; line-height: 1;
  color: #fbbf24;
  text-shadow: 0 0 30px rgba(251,191,36,.8), 6px 6px 0 rgba(0,0,0,.3);
  animation: ec-glow 2s ease-in-out infinite;
  font-variant-numeric: tabular-nums;
}
@keyframes ec-glow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.2); } }
.ec-label {
  font-family: 'Bungee', cursive; font-size: 22px;
  color: #fef3c7; letter-spacing: .2em; text-transform: uppercase;
  margin-top: 4px;
}

.ec-gap {
  display: flex; flex-direction: column; justify-content: center; gap: 24px;
  color: #fbbf24; font-family: 'Anton', sans-serif; font-size: 80px;
  line-height: .6;
  animation: ec-pulse 1s ease-in-out infinite;
  padding-top: 60px;
}
@keyframes ec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }

.ec-infoRow {
  position: absolute; bottom: 160px; left: 0; right: 0;
  display: flex; justify-content: center; gap: 40px;
  z-index: 4;
}
.ec-infoCard {
  background: rgba(255,255,255,.08); backdrop-filter: blur(12px);
  border: 2px solid rgba(255,255,255,.2); border-radius: 16px;
  padding: 16px 26px;
  display: flex; align-items: center; gap: 16px;
  min-width: 280px;
}
.ec-infoIcon { font-size: 42px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0,0,0,.3)); }
.ec-infoLabel { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 13px; color: #fbbf24; letter-spacing: .2em; text-transform: uppercase; }
.ec-infoValue { font-family: 'Anton', sans-serif; font-size: 30px; color: #fff; line-height: 1; margin-top: 2px; letter-spacing: .02em; }

.ec-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 100px;
  background: linear-gradient(135deg, #fbbf24, #ec4899);
  display: flex; align-items: center; overflow: hidden;
  z-index: 6; border-top: 4px solid #0f172a;
}
.ec-stamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #0f172a; color: #fbbf24;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 32px; letter-spacing: .12em;
}
.ec-tickerScroll { flex: 1; overflow: hidden; }
.ec-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 36px;
  color: #0f172a; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation-name: ec-scroll;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes ec-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(251,191,36,.1); box-shadow: inset 0 0 0 3px rgba(251,191,36,.5); }
.aw-hotspot:focus-visible { background-color: rgba(251,191,36,.16); box-shadow: inset 0 0 0 3px rgba(251,191,36,.85); }
`;
