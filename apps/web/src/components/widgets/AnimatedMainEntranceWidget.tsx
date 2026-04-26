"use client";

// PORTED 2026-04-20 from scratch/design/animated-main-entrance.html — transform:scale pattern, isLive-gated hotspots.

import { useEffect, useRef, useState, useMemo } from 'react';

interface Cfg {
  eyebrow?: string;
  title?: string;
  subtitle?: string;

  leftCrestEmoji?: string;
  leftCrestLabel?: string;
  rightCrestEmoji?: string;
  rightCrestLabel?: string;

  tile1Emoji?: string;
  tile1Label?: string;
  tile1Big?: string;
  tile1Sub?: string;

  tile2Emoji?: string;
  tile2Label?: string;
  tile2Big?: string;
  tile2Sub?: string;

  tile3Emoji?: string;
  tile3Label?: string;
  tile3Big?: string;
  tile3Sub?: string;

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

export function AnimatedMainEntranceWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ★  ');
    return "Visitors: please check in at the front office · ID required  ★  Early dismissal FRIDAY at 1:15 PM  ★  Book fair extended through next Tuesday — library open 'til 4:30  ★  Parent-teacher conferences begin April 29";
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#dbeafe',
      }}
    >
      <style>{CSS_ME}</style>

      <div
        className="me-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="me-cloud me-c1" />
        <div className="me-cloud me-c2" />
        <div className="me-cloud me-c3" />

        {isLive && (
          <>
            <div className="me-balloon me-b1" />
            <div className="me-balloon me-b2" />
            <div className="me-balloon me-b3" />
            <div className="me-balloon me-b4" />
          </>
        )}

        <div className="me-signWrap">
          <div className="me-signChains" />
          <div className="me-sign">
            <div className="me-eyebrow" data-field="eyebrow" style={{ whiteSpace: 'pre-wrap' }}>★ {c.eyebrow || 'welcome to'} ★</div>
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'LINCOLN ELEMENTARY').toUpperCase()}</h1>
            <div className="me-signSub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'where curious minds begin · since 1962'}</div>
          </div>
        </div>

        <div className="me-crestWrap me-left">
          <div className="me-crest"><div className="me-crestIcon" data-field="leftCrestEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.leftCrestEmoji || '🦅'}</div></div>
          <div className="me-crestLbl" data-field="leftCrestLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.leftCrestLabel || 'GO EAGLES').toUpperCase()}</div>
        </div>

        <div className="me-crestWrap me-right">
          <div className="me-crest"><div className="me-crestIcon" data-field="rightCrestEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.rightCrestEmoji || '📚'}</div></div>
          <div className="me-crestLbl" data-field="rightCrestLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.rightCrestLabel || 'LEARN DAILY').toUpperCase()}</div>
        </div>

        <div className="me-info">
          <div className="me-tile">
            <div className="me-tileIcon" data-field="tile1Emoji" style={{ whiteSpace: 'pre-wrap' }}>{c.tile1Emoji || '🔔'}</div>
            <div className="me-tileLbl" data-field="tile1Label" style={{ whiteSpace: 'pre-wrap' }}>{(c.tile1Label || 'SCHOOL BELL').toUpperCase()}</div>
            <div className="me-tileBig" data-field="tile1Big" style={{ whiteSpace: 'pre-wrap' }}>{c.tile1Big || '8:15 AM'}</div>
            <div className="me-tileSub" data-field="tile1Sub" style={{ whiteSpace: 'pre-wrap' }}>{c.tile1Sub || 'first bell · see you in class'}</div>
          </div>
          <div className="me-tile">
            <div className="me-tileIcon" data-field="tile2Emoji" style={{ whiteSpace: 'pre-wrap' }}>{c.tile2Emoji || '☀️'}</div>
            <div className="me-tileLbl" data-field="tile2Label" style={{ whiteSpace: 'pre-wrap' }}>{(c.tile2Label || "TODAY'S FORECAST").toUpperCase()}</div>
            <div className="me-tileBig" data-field="tile2Big" style={{ whiteSpace: 'pre-wrap' }}>{c.tile2Big || '68°'}</div>
            <div className="me-tileSub" data-field="tile2Sub" style={{ whiteSpace: 'pre-wrap' }}>{c.tile2Sub || 'sunny + crisp, recess outside!'}</div>
          </div>
          <div className="me-tile">
            <div className="me-tileIcon" data-field="tile3Emoji" style={{ whiteSpace: 'pre-wrap' }}>{c.tile3Emoji || '🎉'}</div>
            <div className="me-tileLbl" data-field="tile3Label" style={{ whiteSpace: 'pre-wrap' }}>{(c.tile3Label || 'COMING UP').toUpperCase()}</div>
            <div className="me-tileBig" data-field="tile3Big" style={{ whiteSpace: 'pre-wrap' }}>{c.tile3Big || 'Spring Musical'}</div>
            <div className="me-tileSub" data-field="tile3Sub" style={{ whiteSpace: 'pre-wrap' }}>{c.tile3Sub || 'Thursday April 28 · 7pm'}</div>
          </div>
        </div>

        <div className="me-ticker">
          <div className="me-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Welcome').toUpperCase()}</div>
          <div className="me-tickerScroll">
            <span
              className="me-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 48)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"    x={360}  y={100} w={1200} h={360} />
            <Hotspot section="leftCrest" x={80}   y={340} w={220}  h={260} />
            <Hotspot section="rightCrest" x={1620} y={340} w={220}  h={260} />
            <Hotspot section="tile1"     x={240}  y={600} w={440}  h={320} />
            <Hotspot section="tile2"     x={740}  y={600} w={440}  h={320} />
            <Hotspot section="tile3"     x={1240} y={600} w={440}  h={320} />
            <Hotspot section="ticker"    x={0}    y={970} w={1920} h={110} />
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

const CSS_ME = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Caveat:wght@700&family=Inter:wght@600;700;800&display=swap');

.me-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% -20%, #fef3c7 0%, transparent 50%),
    radial-gradient(ellipse at 20% 80%, rgba(59,130,246,.25) 0%, transparent 45%),
    radial-gradient(ellipse at 80% 80%, rgba(236,72,153,.25) 0%, transparent 45%),
    linear-gradient(180deg, #dbeafe 0%, #ffe4e6 50%, #fef3c7 100%);
  overflow: hidden;
}

.me-cloud {
  position: absolute; width: 180px; height: 60px;
  background: #fff; border-radius: 40px;
  box-shadow:
    -50px -4px 0 -8px #fff, -100px 0 0 -14px #fff,
     50px -6px 0 -6px #fff,  100px 0 0 -12px #fff;
  animation: me-drift linear infinite;
  opacity: .85;
}
.me-c1 { top: 60px; left: -10%; animation-duration: 110s; }
.me-c2 { top: 140px; left: -30%; animation-duration: 140s; animation-delay: -40s; transform: scale(.7); }
.me-c3 { top: 100px; left: -20%; animation-duration: 120s; animation-delay: -70s; transform: scale(1.1); }
@keyframes me-drift { from { transform: translateX(0); } to { transform: translateX(2400px); } }

.me-balloon {
  position: absolute; bottom: -100px; width: 64px; height: 80px;
  border-radius: 50% 50% 48% 48%;
  animation: me-riseBalloon linear infinite;
  z-index: 1;
}
.me-balloon::after {
  content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 200px;
  background: rgba(0,0,0,.3); transform: translateX(-50%);
}
.me-b1 { left: 8%; background: #ec4899; animation-duration: 16s; animation-delay: 0s; }
.me-b2 { left: 18%; background: #fbbf24; animation-duration: 19s; animation-delay: -4s; }
.me-b3 { left: 86%; background: #06b6d4; animation-duration: 17s; animation-delay: -7s; }
.me-b4 { left: 92%; background: #a78bfa; animation-duration: 21s; animation-delay: -12s; }
@keyframes me-riseBalloon {
  0%   { transform: translateY(0) translateX(0); opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translateY(-1300px) translateX(30px); opacity: .9; }
}

.me-signWrap {
  position: absolute; top: 100px; left: 50%; transform: translateX(-50%); z-index: 5;
  display: flex; flex-direction: column; align-items: center;
}
.me-signChains {
  width: 60%; height: 40px;
  background: repeating-linear-gradient(90deg,
    #64748b 0 4px, transparent 4px 14px);
  background-size: 14px 40px;
  position: relative;
}
.me-sign {
  position: relative;
  background: linear-gradient(180deg, #fff 0%, #fef3c7 100%);
  border: 8px solid #dc2626;
  border-radius: 28px;
  padding: 30px 80px;
  text-align: center;
  box-shadow:
    0 0 0 5px #fff, 0 0 0 12px #dc2626,
    0 0 40px rgba(220,38,38,.35),
    0 24px 48px rgba(0,0,0,.3);
  animation: me-signSway 5s ease-in-out infinite;
  transform-origin: 50% -20px;
}
@keyframes me-signSway { 0%, 100% { transform: rotate(-1deg); } 50% { transform: rotate(1deg); } }
.me-sign::before {
  content: ''; position: absolute; inset: -4px; border-radius: 24px;
  background:
    radial-gradient(circle at 0% 0%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 25% 0%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 50% 0%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 75% 0%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 100% 0%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 0% 100%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 25% 100%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 50% 100%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 75% 100%, #fbbf24 0 10px, transparent 10px),
    radial-gradient(circle at 100% 100%, #fbbf24 0 10px, transparent 10px);
  animation: me-bulbBlink 1.5s steps(2) infinite;
  pointer-events: none;
}
@keyframes me-bulbBlink { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.me-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 24px;
  color: #dc2626; letter-spacing: .35em; text-transform: uppercase;
  position: relative; z-index: 1;
}
.me-sign h1 {
  margin: 0;
  font-family: 'Anton', sans-serif; font-size: 110px; line-height: .9;
  background: linear-gradient(90deg, #dc2626 0%, #f59e0b 50%, #ec4899 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em;
  text-shadow: 0 0 40px rgba(220,38,38,.2);
  text-transform: uppercase;
  position: relative; z-index: 1;
  white-space: nowrap;
}
.me-signSub {
  font-family: 'Caveat', cursive; font-size: 52px; color: #92400e;
  margin-top: 2px; position: relative; z-index: 1;
}

.me-crestWrap {
  position: absolute; top: 340px; width: 180px; z-index: 4;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.me-crestWrap.me-left  { left: 4%;  animation: me-crestBobL 3.6s ease-in-out infinite; }
.me-crestWrap.me-right { right: 4%; animation: me-crestBobR 3.6s ease-in-out infinite -1s; }
@keyframes me-crestBobL { 0%, 100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-12px) rotate(4deg); } }
@keyframes me-crestBobR { 0%, 100% { transform: translateY(0) rotate(4deg); } 50% { transform: translateY(-12px) rotate(-4deg); } }
.me-crest {
  width: 160px; height: 180px;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 60%, #b45309);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 24px rgba(0,0,0,.4);
  position: relative;
}
.me-crest::before {
  content: ''; position: absolute; inset: 12px;
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  box-shadow: inset 0 0 0 4px #92400e;
}
.me-crestIcon {
  font-size: 86px; line-height: 1; transform: translateY(-8px);
  filter: drop-shadow(0 3px 6px rgba(0,0,0,.4));
  position: relative; z-index: 1;
}
.me-crestLbl {
  font-family: 'Bungee', cursive; font-size: 18px; color: #7c2d12;
  letter-spacing: .1em; text-align: center;
}

.me-info {
  position: absolute; top: 600px; left: 240px; right: 240px; bottom: 160px;
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px;
  z-index: 3;
}

.me-tile {
  background: #fff;
  border: 5px solid #1f2937;
  border-radius: 20px;
  padding: 20px 24px;
  box-shadow: 0 14px 28px rgba(0,0,0,.2), 8px 8px 0 rgba(0,0,0,.15);
  position: relative;
  display: flex; flex-direction: column;
  animation: me-tileFloat 5s ease-in-out infinite;
}
.me-tile:nth-child(1) { animation-delay: 0s; border-color: #dc2626; box-shadow: 0 14px 28px rgba(0,0,0,.2), 8px 8px 0 #dc2626; }
.me-tile:nth-child(2) { animation-delay: -1s; border-color: #f59e0b; box-shadow: 0 14px 28px rgba(0,0,0,.2), 8px 8px 0 #f59e0b; }
.me-tile:nth-child(3) { animation-delay: -2s; border-color: #06b6d4; box-shadow: 0 14px 28px rgba(0,0,0,.2), 8px 8px 0 #06b6d4; }
@keyframes me-tileFloat {
  0%, 100% { transform: translateY(0) rotate(-.5deg); }
  50%      { transform: translateY(-6px) rotate(.5deg); }
}
.me-tileIcon { font-size: 78px; line-height: 1; margin-bottom: 4px; filter: drop-shadow(0 4px 6px rgba(0,0,0,.2)); }
.me-tileLbl {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px;
  color: #92400e; letter-spacing: .2em; text-transform: uppercase;
}
.me-tile:nth-child(2) .me-tileLbl { color: #b45309; }
.me-tile:nth-child(3) .me-tileLbl { color: #0e7490; }
.me-tileBig {
  font-family: 'Anton', sans-serif; font-size: 72px; line-height: 1;
  color: #1f2937; margin-top: 2px;
  letter-spacing: .01em;
}
.me-tileSub {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 26px;
  color: #475569; margin-top: 4px; line-height: 1.1;
}
.me-tile::after {
  content: ''; position: absolute; top: -12px; left: 30%; right: 30%; height: 22px;
  background: repeating-linear-gradient(135deg, rgba(0,0,0,.15) 0 8px, rgba(0,0,0,.08) 8px 16px);
  border: 2px solid rgba(0,0,0,.2);
  opacity: .6;
  transform: rotate(-2deg);
}

.me-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(90deg, #dc2626 0%, #f59e0b 50%, #ec4899 100%);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 4px solid #fff;
  box-shadow: 0 -6px 18px rgba(0,0,0,.2);
}
.me-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #fff; color: #dc2626;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 32px; letter-spacing: .15em;
  border-right: 4px solid #dc2626;
}
.me-tickerScroll { flex: 1; overflow: hidden; }
.me-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 40px;
  color: #fff; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  text-shadow: 2px 2px 0 rgba(0,0,0,.3);
  animation: me-tickerScroll 48s linear infinite;
}
@keyframes me-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(220, 38, 38, .08); box-shadow: inset 0 0 0 3px rgba(220, 38, 38, .55); }
.aw-hotspot:focus-visible { background-color: rgba(220, 38, 38, .14); box-shadow: inset 0 0 0 3px rgba(220, 38, 38, .85); }
`;
