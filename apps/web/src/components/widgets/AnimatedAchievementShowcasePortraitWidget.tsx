"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// AnimatedAchievementShowcasePortraitWidget — REAL portrait companion for the
// landscape AnimatedAchievementShowcaseWidget.
//
// Vertical re-flow at 2160x3840 (4K portrait). NOT a landscape jammed
// into a portrait frame — the layout regions stack purposefully:
//   • Top ~700px — giant "Achievement Showcase" title + medal stack (gold/silver/bronze)
//   • Hero ~1200px — "Student of the Week" full-width card (CSS portrait silhouette
//                    + giant name + grade + 2-3 line script citation)
//   • Honor Roll ~900px — 2-column grid of student names with rank chips + medal icons
//   • Stats ~600px — 4-up grid (number + label cards)
//   • Ticker ~440px — full-width scrolling trophy ticker
//
// Reuses the landscape Cfg interface verbatim. Same data-field hotspots so the
// THEMED_WIDGET_FIELDS registry editor "just works." CSS keyframes preserved
// from the landscape widget; new ones added (medal stack hover, portrait pulse)
// only where the vertical layout demanded them.

import { useEffect, useMemo, useRef, useState } from 'react';

type HonorEntry = { rank?: string | number; name?: string; emoji?: string };
type Stat = { emoji?: string; value?: string | number; label?: string };

interface Cfg {
  eyebrow?: string;
  title?: string;
  dateBar?: string;

  heroIcon?: string;           // emoji used as the portrait/avatar accent
  awardLabel?: string;         // "Academic Excellence"
  heroName?: string;
  heroGrade?: string;
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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

const DEFAULT_LEFT: HonorEntry[] = [
  { rank: 1,  name: 'Ethan Garcia',     emoji: '📚' },
  { rank: 2,  name: 'Aisha Patel',      emoji: '🎨' },
  { rank: 3,  name: 'Marcus Johnson',   emoji: '⚽' },
  { rank: 4,  name: 'Lily Rodriguez',   emoji: '🎵' },
  { rank: 5,  name: 'Dylan Kim',        emoji: '🔬' },
  { rank: 6,  name: 'Harper Wilson',    emoji: '📖' },
  { rank: 7,  name: 'Owen Martinez',    emoji: '✍️' },
  { rank: 8,  name: 'Grace Thompson',   emoji: '🎭' },
  { rank: 9,  name: 'Levi Brown',       emoji: '🧪' },
  { rank: 10, name: 'Chloe Davis',      emoji: '🎻' },
  { rank: 11, name: 'Mason Lee',        emoji: '🏀' },
  { rank: 12, name: 'Zara Khan',        emoji: '🌍' },
  { rank: 13, name: 'Jaxon Nguyen',     emoji: '⚡' },
  { rank: 14, name: 'Ivy Robinson',     emoji: '🌸' },
  { rank: 15, name: 'Eli Anderson',     emoji: '🚀' },
];
const DEFAULT_RIGHT: HonorEntry[] = [
  { rank: '★', name: 'Zoe Williams',    emoji: '💖' },
  { rank: '★', name: 'Jayden Park',     emoji: '🤝' },
  { rank: '★', name: 'Sofia Martinez',  emoji: '🌟' },
  { rank: '★', name: 'Noah Taylor',     emoji: '🌈' },
  { rank: '★', name: 'Ava Chen',        emoji: '☀️' },
  { rank: '★', name: 'Liam Foster',     emoji: '🦋' },
  { rank: '★', name: 'Mila Sanchez',    emoji: '🌻' },
  { rank: '★', name: 'Caleb Rivera',    emoji: '🌟' },
  { rank: '★', name: 'Aria Bennett',    emoji: '🍀' },
  { rank: '★', name: 'Henry Cooper',    emoji: '✨' },
  { rank: '★', name: 'Layla Morgan',    emoji: '🎀' },
  { rank: '★', name: 'Wyatt Phillips',  emoji: '🌟' },
  { rank: '★', name: 'Emery Bailey',    emoji: '🌷' },
  { rank: '★', name: 'Asher Hayes',     emoji: '🍎' },
  { rank: '★', name: 'Nora Reed',       emoji: '🌼' },
];
const DEFAULT_STATS: Stat[] = [
  { emoji: '🏆', value: '247',  label: 'Awards This Year' },
  { emoji: '📚', value: '89%',  label: 'Honor Roll Rate' },
  { emoji: '🎯', value: '100%', label: 'Attendance' },
  { emoji: '🎓', value: '12',   label: 'AP Scholars' },
];

export function AnimatedAchievementShowcasePortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
    if (list.length > 0) return list.join('  ·  ');
    return '🏆 Hannah Lee — Math Olympiad Gold  ·  🥈 Carter S — Cross-Country PR  ·  ⭐️ Mia P — Solo & Ensemble Sup\'r  ·  🎨 Devon R — Regional Art Showcase Best in Show  ·  🏅 Lincoln Robotics — State Finalist  ·  🎤 Avery J — All-State Choir';
  }, [c.tickerMessages]);

  const reasonLines = (c.heroReason || 'perfect score on the state-wide spelling bee,\nAND she tutors 3rd graders after school!').split(/\n/);

  // Honor roll columns are sized to fit; cap to 15 each so the grid stays readable.
  const leftCol = leftHonors.slice(0, 15);
  const rightCol = rightHonors.slice(0, 15);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_ASP}</style>
      <div
        className="asp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Top header band — eyebrow + giant title + date */}
        <div className="asp-header">
          <div className="asp-eyebrow" data-field="eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{c.eyebrow || '★ Wall of Fame ★'}</div>
          <div className="asp-h1" data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'Achievement Showcase'}</div>
          <div className="asp-dateBar" data-field="dateBar" style={{ whiteSpace: 'pre-wrap' }}>{c.dateBar || 'monday · april 19 · 2026'}</div>
        </div>

        {/* Medal stack — three medals overlapping (gold center, silver left, bronze right) */}
        <div className="asp-medalStack">
          <div className="asp-medalHanger asp-mhSilver" />
          <div className="asp-medalHanger asp-mhGold" />
          <div className="asp-medalHanger asp-mhBronze" />
          <div className="asp-medal asp-mSilver">
            <span className="asp-mIcon">🥈</span>
          </div>
          <div className="asp-medal asp-mGold">
            <span className="asp-mIcon">{c.heroIcon || '🏆'}</span>
          </div>
          <div className="asp-medal asp-mBronze">
            <span className="asp-mIcon">🥉</span>
          </div>
        </div>

        {/* Hero — Student of the Week full-width card */}
        <div className="asp-hero">
          <div className="asp-heroInner">
            <div className="asp-portrait">
              <div className="asp-portraitRing" />
              <div className="asp-portraitFigure">
                <div className="asp-pHead" />
                <div className="asp-pShoulders" />
              </div>
              <div className="asp-portraitBadge">{c.heroIcon || '🏆'}</div>
            </div>
            <div className="asp-heroText">
              <div className="asp-award" data-field="awardLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.awardLabel || 'Academic Excellence'}</div>
              <div className="asp-name" data-field="heroName" style={{ whiteSpace: 'pre-wrap' }}>{c.heroName || 'MAYA CHEN'}</div>
              <div className="asp-grade" data-field="heroGrade" style={{ whiteSpace: 'pre-wrap' }}>{c.heroGrade || '5th Grade · Mrs. Patel\'s Class'}</div>
              <div className="asp-reason" data-field="heroReason" style={{ whiteSpace: 'pre-wrap' }}>
                {reasonLines.map((line, i) => (
                  <span key={i}>{line}{i < reasonLines.length - 1 ? <br /> : null}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Honor Roll — two-column grid */}
        <div className="asp-honorBlock">
          <div className="asp-honorCol asp-leftCol">
            <div className="asp-honorHeader" data-field="leftHeader" style={{ whiteSpace: 'pre-wrap' }}>{c.leftHeader || '★ HONOR ROLL ★'}</div>
            <div className="asp-honorList">
              {leftCol.map((h, i) => (
                <div key={i} className={`asp-honor${i % 2 === 0 ? ' asp-alt' : ''}`}>
                  <span className="asp-rank">{h.rank ?? i + 1}</span>
                  <span className="asp-nm">{h.name || ''}</span>
                  <span className="asp-hEmoji">{h.emoji || ''}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="asp-honorCol asp-rightCol">
            <div className="asp-honorHeader" data-field="rightHeader" style={{ whiteSpace: 'pre-wrap' }}>{c.rightHeader || '★ KINDNESS STARS ★'}</div>
            <div className="asp-honorList">
              {rightCol.map((h, i) => (
                <div key={i} className={`asp-honor${i % 2 === 0 ? ' asp-alt' : ''}`}>
                  <span className="asp-rank">{h.rank ?? '★'}</span>
                  <span className="asp-nm">{h.name || ''}</span>
                  <span className="asp-hEmoji">{h.emoji || ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats — 4-up grid */}
        <div className="asp-statsRow">
          {stats.map((s, i) => (
            <div key={i} className="asp-stat">
              <span className="asp-statEmoji">{s.emoji || ''}</span>
              <div className="asp-big">{s.value ?? ''}</div>
              <div className="asp-lbl">{s.label || ''}</div>
            </div>
          ))}
        </div>

        {/* Trophy ticker — pinned bottom */}
        <div className="asp-ticker">
          <div className="asp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.tickerStamp || 'WALL OF FAME'}</div>
          <div className="asp-tickerScroll">
            <span
              className="asp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 64)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — operator clicks land in the right region */}
        {!isLive && (
          <>
            <Hotspot section="header"      x={0}    y={60}   w={2160} h={620} />
            <Hotspot section="medalStack"  x={580}  y={200}  w={1000} h={600} />
            <Hotspot section="hero"        x={60}   y={760}  w={2040} h={1180} />
            <Hotspot section="leftHonors"  x={60}   y={1980} w={1010} h={900} />
            <Hotspot section="rightHonors" x={1090} y={1980} w={1010} h={900} />
            <Hotspot section="stats"       x={60}   y={2920} w={2040} h={620} />
            <Hotspot section="ticker"      x={0}    y={3560} w={2160} h={280} />
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

const CSS_ASP = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Inter:wght@500;700;800;900&family=Caveat:wght@700&display=swap');

.asp-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(251,191,36,.32) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(236,72,153,.18) 0%, transparent 50%),
    linear-gradient(180deg, #0f172a 0%, #1e293b 60%, #0f172a 100%);
  overflow: hidden;
}
.asp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .08;
  background: conic-gradient(from 0deg at 50% 25%,
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
  animation: asp-rayspin 80s linear infinite;
}
@keyframes asp-rayspin { to { transform: rotate(360deg); } }

/* HEADER */
.asp-header { position: absolute; top: 100px; left: 0; right: 0; text-align: center; z-index: 5; }
.asp-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 56px;
  color: #fbbf24; letter-spacing: .42em; text-transform: uppercase;
  text-shadow: 0 0 36px rgba(251,191,36,.45);
}
.asp-h1 {
  font-family: 'Anton', sans-serif; font-size: 240px; line-height: .9;
  letter-spacing: .02em;
  text-shadow: 0 0 50px rgba(251,191,36,.3);
  margin-top: 14px;
  background: linear-gradient(180deg, #fef3c7 0%, #fbbf24 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 10px 22px rgba(0,0,0,.5));
}
.asp-dateBar { font-family: 'Caveat', cursive; font-size: 76px; color: #e0e7ff; margin-top: 14px; }

/* MEDAL STACK — 3 medals overlapping */
.asp-medalStack {
  position: absolute; top: 510px; left: 0; right: 0; height: 420px;
  z-index: 4;
  pointer-events: none;
}
.asp-medalHanger {
  position: absolute; top: 0;
  width: 64px; height: 130px;
  clip-path: polygon(0 0, 100% 0, 100% 85%, 50% 100%, 0 85%);
  transform-origin: 50% 0;
  box-shadow: 4px 0 8px rgba(0,0,0,.5);
}
.asp-mhGold {
  left: 50%; margin-left: -32px;
  background: linear-gradient(180deg, #dc2626 0%, #991b1b 50%, #dc2626 100%);
  animation: asp-medalSway 4s ease-in-out infinite;
}
.asp-mhSilver {
  left: 50%; margin-left: -290px;
  background: linear-gradient(180deg, #2563eb 0%, #1e40af 50%, #2563eb 100%);
  animation: asp-medalSway 4s ease-in-out infinite .25s reverse;
}
.asp-mhBronze {
  left: 50%; margin-left: 226px;
  background: linear-gradient(180deg, #b45309 0%, #78350f 50%, #b45309 100%);
  animation: asp-medalSway 4s ease-in-out infinite .5s;
}
@keyframes asp-medalSway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
.asp-medalHanger::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 100%;
  background: repeating-linear-gradient(180deg, rgba(255,255,255,.18) 0 4px, transparent 4px 10px);
}

.asp-medal {
  position: absolute; top: 80px;
  width: 320px; height: 320px; border-radius: 50%;
  border: 12px solid #92400e;
  box-shadow: 0 24px 50px rgba(0,0,0,.55), inset 0 0 30px rgba(255,255,255,.32);
  display: flex; align-items: center; justify-content: center;
}
.asp-mGold {
  left: 50%; margin-left: -160px; width: 360px; height: 360px;
  margin-top: -10px;
  background:
    conic-gradient(from 0deg,
      #fef3c7 0 45deg, #fbbf24 45deg 135deg,
      #d97706 135deg 225deg, #fbbf24 225deg 315deg,
      #fef3c7 315deg 360deg);
  z-index: 3;
  animation: asp-medalSpin 4s ease-in-out infinite, asp-medalShine 2s ease-in-out infinite;
}
@keyframes asp-medalSpin { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(6deg); } }
@keyframes asp-medalShine {
  0%, 100% { filter: drop-shadow(0 0 28px rgba(251,191,36,.6)); }
  50%      { filter: drop-shadow(0 0 56px rgba(251,191,36,.95)); }
}
.asp-mGold::before {
  content: ''; position: absolute; inset: 36px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 70%, #b45309);
  border: 6px solid #92400e;
}
.asp-mSilver {
  left: 50%; margin-left: -440px;
  background:
    conic-gradient(from 0deg,
      #f1f5f9 0 45deg, #cbd5e1 45deg 135deg,
      #64748b 135deg 225deg, #cbd5e1 225deg 315deg,
      #f1f5f9 315deg 360deg);
  border-color: #475569;
  z-index: 2;
  transform: scale(.92);
  animation: asp-medalSpinSide 5s ease-in-out infinite;
}
.asp-mSilver::before {
  content: ''; position: absolute; inset: 30px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f8fafc, #cbd5e1 70%, #475569);
  border: 5px solid #475569;
}
.asp-mBronze {
  left: 50%; margin-left: 120px;
  background:
    conic-gradient(from 0deg,
      #fde68a 0 45deg, #d97706 45deg 135deg,
      #92400e 135deg 225deg, #d97706 225deg 315deg,
      #fde68a 315deg 360deg);
  border-color: #78350f;
  z-index: 2;
  transform: scale(.92);
  animation: asp-medalSpinSide 5s ease-in-out infinite .7s reverse;
}
.asp-mBronze::before {
  content: ''; position: absolute; inset: 30px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fcd34d, #d97706 70%, #78350f);
  border: 5px solid #78350f;
}
@keyframes asp-medalSpinSide { 0%, 100% { transform: scale(.92) rotate(-4deg); } 50% { transform: scale(.92) rotate(4deg); } }
.asp-mIcon {
  position: relative; z-index: 2; font-size: 150px; line-height: 1;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.5));
}
.asp-mSilver .asp-mIcon, .asp-mBronze .asp-mIcon { font-size: 130px; }

/* HERO — Student of the Week full-width card */
.asp-hero {
  position: absolute; top: 980px; left: 60px; right: 60px; height: 1180px;
  z-index: 4;
  display: flex; align-items: center; justify-content: center;
}
.asp-heroInner {
  position: relative;
  width: 100%; height: 100%;
  background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%);
  border: 12px solid #fbbf24;
  border-radius: 36px;
  padding: 60px 80px;
  display: flex; flex-direction: row; align-items: center; gap: 70px;
  color: #1f2937;
  box-shadow: 0 30px 60px rgba(0,0,0,.5), 0 0 0 6px rgba(251,191,36,.32);
  animation: asp-cardFloat 5s ease-in-out infinite;
}
@keyframes asp-cardFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.asp-heroInner::before, .asp-heroInner::after {
  content: '★'; position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 96px; color: #dc2626;
  animation: asp-starTwinkle 1.6s ease-in-out infinite;
}
.asp-heroInner::before { left: -52px; }
.asp-heroInner::after { right: -52px; animation-delay: .3s; }
@keyframes asp-starTwinkle { 0%, 100% { transform: translateY(-50%) scale(.9) rotate(-10deg); opacity: .7; } 50% { transform: translateY(-50%) scale(1.2) rotate(15deg); opacity: 1; } }

/* CSS portrait silhouette — head + shoulders inside a glowing ring */
.asp-portrait {
  position: relative;
  flex: 0 0 700px;
  height: 940px;
  display: flex; align-items: center; justify-content: center;
}
.asp-portraitRing {
  position: absolute; inset: 0;
  border-radius: 36px;
  background:
    conic-gradient(from 0deg, #fbbf24, #ec4899, #60a5fa, #fbbf24);
  box-shadow: 0 0 50px rgba(251,191,36,.5), inset 0 0 40px rgba(255,255,255,.4);
  animation: asp-portraitRingSpin 12s linear infinite;
}
@keyframes asp-portraitRingSpin { to { transform: rotate(360deg); } }
.asp-portrait::after {
  content: ''; position: absolute; inset: 16px;
  border-radius: 26px;
  background: linear-gradient(180deg, #93c5fd 0%, #3b82f6 60%, #1e3a8a 100%);
  box-shadow: inset 0 0 60px rgba(0,0,0,.3);
}
.asp-portraitFigure {
  position: relative; z-index: 2;
  width: 100%; height: 100%;
  animation: asp-portraitPulse 3.6s ease-in-out infinite;
}
@keyframes asp-portraitPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
.asp-pHead {
  position: absolute;
  top: 130px; left: 50%; transform: translateX(-50%);
  width: 320px; height: 320px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fde68a 0%, #fbbf24 60%, #b45309 100%);
  box-shadow: 0 16px 40px rgba(0,0,0,.45), inset -10px -16px 30px rgba(0,0,0,.18);
}
.asp-pHead::before {
  content: '';
  position: absolute; inset: -10px -10px 65% -10px;
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  background: linear-gradient(180deg, #1e293b 0%, #334155 100%);
  box-shadow: 0 8px 14px rgba(0,0,0,.35);
}
.asp-pShoulders {
  position: absolute;
  top: 470px; left: 50%; transform: translateX(-50%);
  width: 560px; height: 540px;
  border-radius: 50% 50% 0 0 / 80% 80% 0 0;
  background: linear-gradient(180deg, #be185d 0%, #831843 100%);
  box-shadow: 0 16px 40px rgba(0,0,0,.45), inset 10px -16px 30px rgba(0,0,0,.22);
}
.asp-pShoulders::before {
  content: '';
  position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
  width: 90px; height: 90px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #b45309);
  border: 4px solid #92400e;
  box-shadow: 0 6px 12px rgba(0,0,0,.4);
}
.asp-portraitBadge {
  position: absolute; bottom: 24px; right: 24px;
  width: 130px; height: 130px;
  border-radius: 50%;
  background: linear-gradient(180deg, #fef3c7 0%, #fbbf24 100%);
  border: 6px solid #92400e;
  display: flex; align-items: center; justify-content: center;
  font-size: 72px;
  box-shadow: 0 12px 24px rgba(0,0,0,.45);
  z-index: 3;
  animation: asp-badgeBob 3s ease-in-out infinite;
}
@keyframes asp-badgeBob { 0%, 100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-8px) rotate(6deg); } }

.asp-heroText {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; justify-content: center;
  text-align: left;
}
.asp-award {
  font-family: 'Bungee', cursive; font-size: 56px; color: #dc2626;
  letter-spacing: .15em; text-transform: uppercase;
  line-height: 1.1;
}
.asp-name {
  font-family: 'Anton', sans-serif; font-size: 180px; color: #1e293b; line-height: .92;
  margin-top: 14px;
  letter-spacing: .02em;
  text-shadow: 0 6px 0 rgba(251,191,36,.35);
}
.asp-grade {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 44px;
  color: #92400e; letter-spacing: .05em;
  margin-top: 14px;
}
.asp-reason {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 78px; color: #92400e;
  line-height: 1.18; margin-top: 24px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* HONOR ROLL — two-column stack */
.asp-honorBlock {
  position: absolute; top: 2200px; left: 60px; right: 60px; height: 880px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 30px;
  z-index: 3;
}
.asp-honorCol { display: flex; flex-direction: column; }
.asp-leftCol  { transform: rotate(-1.2deg); }
.asp-rightCol { transform: rotate(1.2deg); }

.asp-honorHeader {
  font-family: 'Bungee', cursive; font-size: 56px; color: #fbbf24;
  letter-spacing: .15em; text-align: center;
  background: rgba(251,191,36,.18); padding: 22px 16px;
  border: 5px solid #fbbf24; border-radius: 18px;
  text-shadow: 0 0 22px rgba(251,191,36,.55);
  flex: 0 0 auto;
}
.asp-honorList {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  margin-top: 18px;
  background: rgba(255,255,255,.04);
  border: 3px solid rgba(251,191,36,.3);
  border-radius: 20px;
  overflow: hidden;
  backdrop-filter: blur(6px);
}
.asp-honor {
  flex: 1 1 0; min-height: 0;
  display: grid; grid-template-columns: 90px 1fr 70px;
  align-items: center; gap: 16px;
  padding: 0 24px;
  border-bottom: 2px dashed rgba(251,191,36,.2);
}
.asp-honor:last-child { border-bottom: none; }
.asp-honor.asp-alt { background: rgba(251,191,36,.06); }
.asp-rank {
  font-family: 'Anton', sans-serif; font-size: 48px; color: #fbbf24;
  text-align: center; line-height: 1;
  text-shadow: 0 0 14px rgba(251,191,36,.7);
}
.asp-nm {
  font-family: 'Inter', sans-serif; font-weight: 800;
  font-size: 38px; color: #fff; line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.asp-hEmoji { font-size: 50px; line-height: 1; text-align: right; }

/* STATS — 4-up grid */
.asp-statsRow {
  position: absolute; top: 3120px; left: 60px; right: 60px; height: 420px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px;
  z-index: 3;
}
.asp-stat {
  background: linear-gradient(135deg, rgba(251,191,36,.18), rgba(236,72,153,.18));
  backdrop-filter: blur(8px);
  border: 4px solid rgba(251,191,36,.45);
  border-radius: 28px;
  padding: 26px 18px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  box-shadow: 0 14px 28px rgba(0,0,0,.4);
}
.asp-statEmoji { font-size: 100px; line-height: 1; }
.asp-big {
  font-family: 'Anton', sans-serif; font-size: 130px; line-height: .9;
  color: #fbbf24; text-shadow: 0 0 28px rgba(251,191,36,.55);
  margin-top: 10px;
}
.asp-lbl {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 22px;
  color: #fef3c7; letter-spacing: .2em; text-transform: uppercase;
  margin-top: 12px;
  line-height: 1.2;
}

/* TICKER — pinned bottom */
.asp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 240px;
  background: linear-gradient(90deg, #fbbf24, #d97706);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 8px solid #0f172a;
  box-shadow: 0 -10px 30px rgba(0,0,0,.4);
}
.asp-tickerStamp {
  flex: 0 0 auto; padding: 0 60px; height: 100%;
  background: #0f172a; color: #fbbf24;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 80px; letter-spacing: .12em;
}
.asp-tickerScroll { flex: 1; overflow: hidden; }
.asp-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 96px;
  color: #0f172a; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  animation: asp-tickerScroll 64s linear infinite;
}
@keyframes asp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
