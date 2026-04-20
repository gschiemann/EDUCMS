"use client";

// PORTED 2026-04-20 from scratch/design/animated-achievement-showcase.html — transform:scale pattern, isLive-gated hotspots.
// Citation layout preserved verbatim (including -webkit-line-clamp: 3 on .reason) per user's explicit instruction.

import { useEffect, useMemo, useRef, useState } from 'react';

type HonorEntry = { rank?: string | number; name?: string; emoji?: string };
type Stat = { emoji?: string; value?: string | number; label?: string };

interface Cfg {
  eyebrow?: string;
  title?: string;
  dateBar?: string;

  heroIcon?: string;           // emoji in center of medal
  awardLabel?: string;         // "Academic Excellence"
  heroName?: string;
  heroReason?: string;         // supports \n

  leftHeader?: string;
  leftHonors?: HonorEntry[];
  rightHeader?: string;
  rightHonors?: HonorEntry[];

  stats?: Stat[];

  tickerStamp?: string;
  tickerMessages?: string[] | string;
  tickerSpeed?: 'slow' | 'normal' | 'fast' | number;
}

function tickerDurationSec(speed: Cfg['tickerSpeed'], baseSec: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return baseSec * 1.8;
  if (speed === 'fast') return baseSec * 0.6;
  return baseSec;
}

const CANVAS_W = 1920;
const CANVAS_H = 1080;

const DEFAULT_LEFT: HonorEntry[] = [
  { rank: 1, name: 'Ethan Garcia',    emoji: '📚' },
  { rank: 2, name: 'Aisha Patel',     emoji: '🎨' },
  { rank: 3, name: 'Marcus Johnson',  emoji: '⚽' },
  { rank: 4, name: 'Lily Rodriguez',  emoji: '🎵' },
  { rank: 5, name: 'Dylan Kim',       emoji: '🔬' },
];
const DEFAULT_RIGHT: HonorEntry[] = [
  { rank: '★', name: 'Zoe Williams',   emoji: '💖' },
  { rank: '★', name: 'Jayden Park',    emoji: '🤝' },
  { rank: '★', name: 'Sofia Martinez', emoji: '🌟' },
  { rank: '★', name: 'Noah Taylor',    emoji: '🌈' },
  { rank: '★', name: 'Ava Chen',       emoji: '☀️' },
];
const DEFAULT_STATS: Stat[] = [
  { emoji: '🏆', value: '247', label: 'Awards This Year' },
  { emoji: '📚', value: '89%', label: 'Honor Roll Rate' },
  { emoji: '🎨', value: '54',  label: 'Art Show Pieces' },
  { emoji: '🏅', value: '12',  label: 'Team Championships' },
];

export function AnimatedAchievementShowcaseWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
  const c = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

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

  const leftHonors = (Array.isArray(c.leftHonors) && c.leftHonors.length > 0) ? c.leftHonors : DEFAULT_LEFT;
  const rightHonors = (Array.isArray(c.rightHonors) && c.rightHonors.length > 0) ? c.rightHonors : DEFAULT_RIGHT;
  const stats = (Array.isArray(c.stats) && c.stats.length > 0) ? c.stats.slice(0, 4) : DEFAULT_STATS;

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ★  ');
    return 'CONGRATULATIONS MAYA CHEN — Student of the Week  ★  Spelling Bee team wins District for the 3rd year running  ★  Honor roll ceremony Friday 2:00 PM · Main Auditorium  ★  Kindness Star nominations open — drop in the box outside the office';
  }, [c.tickerMessages]);

  // Support \n-separated reason lines.
  const reasonLines = (c.heroReason || 'perfect score on the state-wide spelling bee,\nAND she tutors 3rd graders after school!').split(/\n/);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_AS}</style>
      <div
        className="as-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="as-header">
          <div className="as-eyebrow">{c.eyebrow || '★ Wall of Fame ★'}</div>
          <div className="as-h1">{c.title || 'Student of the Week'}</div>
          <div className="as-dateBar">{c.dateBar || 'monday · april 19 · 2026'}</div>
        </div>

        <div className="as-hero">
          <div className="as-medalHanger" />
          <div className="as-medal">
            <span className="as-icon">{c.heroIcon || '🏆'}</span>
          </div>
          <div className="as-citation">
            <div className="as-award">{c.awardLabel || 'Academic Excellence'}</div>
            <div className="as-name">{c.heroName || 'MAYA CHEN'}</div>
            <div className="as-reason">
              {reasonLines.map((line, i) => (
                <span key={i}>{line}{i < reasonLines.length - 1 ? <br /> : null}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="as-honorRoll as-left">
          <div className="as-honorHeader">{c.leftHeader || '★ HONOR ROLL ★'}</div>
          {leftHonors.map((h, i) => (
            <div key={i} className="as-honor">
              <span className="as-rank">{h.rank ?? i + 1}</span>
              <span className="as-nm">{h.name || ''}</span>
              <span className="as-hEmoji">{h.emoji || ''}</span>
            </div>
          ))}
        </div>

        <div className="as-honorRoll as-right">
          <div className="as-honorHeader">{c.rightHeader || '★ KINDNESS STARS ★'}</div>
          {rightHonors.map((h, i) => (
            <div key={i} className="as-honor">
              <span className="as-rank">{h.rank ?? '★'}</span>
              <span className="as-nm">{h.name || ''}</span>
              <span className="as-hEmoji">{h.emoji || ''}</span>
            </div>
          ))}
        </div>

        <div className="as-statsRow">
          {stats.map((s, i) => (
            <div key={i} className="as-stat">
              <span className="as-statEmoji">{s.emoji || ''}</span>
              <div className="as-nums">
                <div className="as-big">{s.value ?? ''}</div>
                <div className="as-lbl">{s.label || ''}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="as-ticker">
          <div className="as-tickerStamp">{c.tickerStamp || 'WALL OF FAME'}</div>
          <div className="as-tickerScroll">
            <span
              className="as-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 52)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"      x={0}    y={40}  w={1920} h={180} />
            <Hotspot section="hero"        x={710}  y={210} w={500}  h={560} />
            <Hotspot section="leftHonors"  x={36}   y={300} w={280}  h={520} />
            <Hotspot section="rightHonors" x={1604} y={300} w={280}  h={520} />
            <Hotspot section="stats"       x={36}   y={800} w={1848} h={120} />
            <Hotspot section="ticker"      x={0}    y={970} w={1920} h={110} />
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

const CSS_AS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Inter:wght@500;700;800&family=Caveat:wght@700&display=swap');

.as-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(251,191,36,.35) 0%, transparent 55%),
    linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  overflow: hidden;
}
.as-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .08;
  background: conic-gradient(from 0deg at 50% 30%,
    transparent 0 10deg, #fbbf24 10deg 12deg,
    transparent 12deg 25deg, #fbbf24 25deg 27deg,
    transparent 27deg 40deg, #fbbf24 40deg 42deg,
    transparent 42deg 55deg, #fbbf24 55deg 57deg,
    transparent 57deg 70deg, #fbbf24 70deg 72deg,
    transparent 72deg 85deg, #fbbf24 85deg 87deg,
    transparent 87deg 100deg, #fbbf24 100deg 102deg,
    transparent 102deg 115deg, #fbbf24 115deg 117deg,
    transparent 117deg 130deg, #fbbf24 130deg 132deg,
    transparent 132deg 145deg, #fbbf24 145deg 147deg,
    transparent 147deg 160deg, #fbbf24 160deg 162deg,
    transparent 162deg 175deg, #fbbf24 175deg 177deg,
    transparent 177deg 190deg, #fbbf24 190deg 192deg,
    transparent 192deg 360deg);
  animation: as-rayspin 60s linear infinite;
}
@keyframes as-rayspin { to { transform: rotate(360deg); } }

.as-header { position: absolute; top: 40px; left: 0; right: 0; text-align: center; z-index: 5; }
.as-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 26px;
  color: #fbbf24; letter-spacing: .4em; text-transform: uppercase;
  text-shadow: 0 0 18px rgba(251,191,36,.4);
}
.as-h1 {
  font-family: 'Anton', sans-serif; font-size: 110px; line-height: .95;
  letter-spacing: .02em;
  text-shadow: 0 0 30px rgba(251,191,36,.25);
  margin-top: 2px;
  background: linear-gradient(180deg, #fef3c7 0%, #fbbf24 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 6px 12px rgba(0,0,0,.4));
}
.as-dateBar { font-family: 'Caveat', cursive; font-size: 32px; color: #e0e7ff; margin-top: 2px; }

.as-hero {
  position: absolute; top: 210px; left: 50%; transform: translateX(-50%);
  width: 500px; z-index: 4;
  display: flex; flex-direction: column; align-items: center;
}

.as-medalHanger {
  position: relative;
  width: 40px; height: 90px;
  margin-bottom: -30px; z-index: 2;
  background: linear-gradient(180deg, #dc2626 0%, #991b1b 50%, #dc2626 100%);
  clip-path: polygon(0 0, 100% 0, 100% 85%, 50% 100%, 0 85%);
  animation: as-medalSway 4s ease-in-out infinite;
  transform-origin: 50% 0;
  box-shadow: 4px 0 6px rgba(0,0,0,.4);
}
@keyframes as-medalSway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.as-medalHanger::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 100%;
  background: repeating-linear-gradient(180deg, rgba(255,255,255,.18) 0 4px, transparent 4px 10px);
}

.as-medal {
  position: relative;
  width: 220px; height: 220px; border-radius: 50%;
  background:
    conic-gradient(from 0deg,
      #fef3c7 0 45deg, #fbbf24 45deg 135deg,
      #d97706 135deg 225deg, #fbbf24 225deg 315deg,
      #fef3c7 315deg 360deg);
  border: 8px solid #92400e;
  box-shadow: 0 20px 40px rgba(0,0,0,.5), inset 0 0 20px rgba(255,255,255,.3);
  display: flex; align-items: center; justify-content: center;
  animation: as-medalSpin 4s ease-in-out infinite, as-medalShine 2s ease-in-out infinite;
}
@keyframes as-medalSpin { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(6deg); } }
@keyframes as-medalShine {
  0%, 100% { filter: drop-shadow(0 0 20px rgba(251,191,36,.6)); }
  50%      { filter: drop-shadow(0 0 40px rgba(251,191,36,.9)); }
}
.as-medal::before {
  content: ''; position: absolute; inset: 30px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 70%, #b45309);
  border: 4px solid #92400e;
}
.as-icon {
  position: relative; z-index: 2; font-size: 110px; line-height: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.4));
}

.as-citation {
  margin-top: 24px;
  background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%);
  border: 5px solid #fbbf24;
  border-radius: 20px;
  padding: 22px 40px 26px;
  text-align: center;
  color: #1f2937;
  box-shadow: 0 20px 40px rgba(0,0,0,.4), 0 0 0 3px rgba(251,191,36,.3);
  position: relative;
  max-width: 500px;
  animation: as-cardFloat 5s ease-in-out infinite;
}
@keyframes as-cardFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.as-citation::before, .as-citation::after {
  content: '★'; position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 40px; color: #dc2626;
  animation: as-starTwinkle 1.6s ease-in-out infinite;
}
.as-citation::before { left: -26px; }
.as-citation::after { right: -26px; animation-delay: .3s; }
@keyframes as-starTwinkle { 0%, 100% { transform: translateY(-50%) scale(.9) rotate(-10deg); opacity: .7; } 50% { transform: translateY(-50%) scale(1.2) rotate(15deg); opacity: 1; } }
.as-award {
  font-family: 'Bungee', cursive; font-size: 22px; color: #dc2626;
  letter-spacing: .15em; text-transform: uppercase;
}
.as-name {
  font-family: 'Anton', sans-serif; font-size: 74px; color: #1e293b; line-height: 1;
  margin-top: 2px;
  letter-spacing: .02em;
}
.as-reason {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 30px; color: #92400e;
  line-height: 1.2; margin-top: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.as-honorRoll {
  position: absolute; top: 300px; width: 280px; z-index: 3;
  display: flex; flex-direction: column; gap: 10px;
}
.as-left  { left: 36px;  transform: rotate(-2deg); }
.as-right { right: 36px; transform: rotate(2deg); }
.as-honorHeader {
  font-family: 'Bungee', cursive; font-size: 20px; color: #fbbf24;
  letter-spacing: .15em; text-align: center;
  background: rgba(251,191,36,.15); padding: 10px;
  border: 2px solid #fbbf24; border-radius: 10px;
}
.as-honor {
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,255,255,.05);
  backdrop-filter: blur(4px);
  border: 2px solid rgba(251,191,36,.3);
  border-radius: 10px; padding: 10px 12px;
}
.as-rank {
  font-family: 'Anton', sans-serif; font-size: 24px; color: #fbbf24;
  width: 30px; text-align: center;
  text-shadow: 0 0 8px rgba(251,191,36,.6);
}
.as-nm {
  flex: 1; font-family: 'Inter', sans-serif; font-weight: 700;
  font-size: 18px; color: #fff; line-height: 1.1;
}
.as-hEmoji { font-size: 28px; line-height: 1; }

.as-statsRow {
  position: absolute; bottom: 180px; left: 36px; right: 36px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;
  z-index: 3;
}
.as-stat {
  background: linear-gradient(135deg, rgba(251,191,36,.15), rgba(236,72,153,.15));
  backdrop-filter: blur(6px);
  border: 2px solid rgba(251,191,36,.4);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: 0 8px 18px rgba(0,0,0,.3);
}
.as-statEmoji { font-size: 48px; line-height: 1; }
.as-big {
  font-family: 'Anton', sans-serif; font-size: 46px; line-height: 1;
  color: #fbbf24; text-shadow: 0 0 16px rgba(251,191,36,.5);
}
.as-lbl {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 12px;
  color: #fef3c7; letter-spacing: .18em; text-transform: uppercase;
  margin-top: 2px;
}

.as-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(90deg, #fbbf24, #d97706);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 4px solid #0f172a;
  box-shadow: 0 -6px 18px rgba(0,0,0,.3);
}
.as-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #0f172a; color: #fbbf24;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 32px; letter-spacing: .12em;
}
.as-tickerScroll { flex: 1; overflow: hidden; }
.as-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 38px;
  color: #0f172a; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: as-tickerScroll 52s linear infinite;
}
@keyframes as-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
