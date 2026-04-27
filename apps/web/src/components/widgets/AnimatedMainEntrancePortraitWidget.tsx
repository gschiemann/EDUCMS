"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.

/**
 * AnimatedMainEntrancePortraitWidget — REAL portrait companion for
 * AnimatedMainEntranceWidget (landscape).
 *
 * Vertical re-flow at 2160x3840 (4K portrait). NOT a landscape jammed
 * into a portrait frame. Layout regions stack purposefully:
 *   • Top hero band (~900px): hanging WELCOME sign (school logo emoji
 *     pair flanking a giant school-name marquee + scripted subtitle +
 *     today's date).
 *   • Mid info column (~1400px): three full-width info cards stacked —
 *     today's bell time, weather (3-tier with icon), and the "next
 *     event / coming up" countdown. Polaroid-tilt + colored drop shadow
 *     so each tile feels physical, not a rounded rectangle.
 *   • Lower 2-up grid (~1000px): visitor crests on left + right
 *     (school mascot / motto crests, same shape language as landscape).
 *   • Bottom (~540px): scrolling news ticker, full-width, big text.
 *
 * Same Cfg shape as the landscape widget so THEMED_WIDGET_FIELDS edits
 * pick up automatically. Same animation language (drifting clouds,
 * rising balloons, sign sway, tile float, marquee bulb blink) — re-
 * prefixed `mep-*` so it cannot collide with the landscape's `me-*`
 * keyframes when both are mounted (gallery thumbs).
 *
 * Pattern follows AnimatedHallwaySchedulePortraitWidget exactly:
 *   1. Wrapper measures parent, applies transform: scale(N).
 *   2. Inner stage is fixed 2160x3840 — every size is a real px.
 *   3. Hotspots fire `aw-edit-section` so editor-side wiring is
 *      identical to landscape.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

export function AnimatedMainEntrancePortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
      <style>{CSS_MEP}</style>

      <div
        className="mep-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Drifting clouds across the top */}
        <div className="mep-cloud mep-c1" />
        <div className="mep-cloud mep-c2" />
        <div className="mep-cloud mep-c3" />
        <div className="mep-cloud mep-c4" />

        {/* Rising balloons (live only — keep editor calm) */}
        {isLive && (
          <>
            <div className="mep-balloon mep-b1" />
            <div className="mep-balloon mep-b2" />
            <div className="mep-balloon mep-b3" />
            <div className="mep-balloon mep-b4" />
            <div className="mep-balloon mep-b5" />
            <div className="mep-balloon mep-b6" />
          </>
        )}

        {/* HERO BAND — hanging welcome sign + huge marquee + scripted subtitle */}
        <div className="mep-signWrap">
          <div className="mep-signChains" />
          <div className="mep-sign">
            <div className="mep-eyebrow" data-field="eyebrow" style={{ whiteSpace: 'pre-wrap' }}>★ {c.eyebrow || 'welcome to'} ★</div>
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'LINCOLN ELEMENTARY').toUpperCase()}</h1>
            <div className="mep-signSub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'where curious minds begin · since 1962'}</div>
          </div>
        </div>

        {/* MID COLUMN — three full-width info cards, stacked */}
        <div className="mep-info">
          <div className="mep-tile mep-tile1">
            <div className="mep-tileIcon" data-field="tile1Emoji" style={{ whiteSpace: 'pre-wrap' }}>{c.tile1Emoji || '🔔'}</div>
            <div className="mep-tileBody">
              <div className="mep-tileLbl" data-field="tile1Label" style={{ whiteSpace: 'pre-wrap' }}>{(c.tile1Label || 'SCHOOL BELL').toUpperCase()}</div>
              <div className="mep-tileBig" data-field="tile1Big" style={{ whiteSpace: 'pre-wrap' }}>{c.tile1Big || '8:15 AM'}</div>
              <div className="mep-tileSub" data-field="tile1Sub" style={{ whiteSpace: 'pre-wrap' }}>{c.tile1Sub || 'first bell · see you in class'}</div>
            </div>
          </div>

          <div className="mep-tile mep-tile2">
            <div className="mep-tileIcon" data-field="tile2Emoji" style={{ whiteSpace: 'pre-wrap' }}>{c.tile2Emoji || '☀️'}</div>
            <div className="mep-tileBody">
              <div className="mep-tileLbl" data-field="tile2Label" style={{ whiteSpace: 'pre-wrap' }}>{(c.tile2Label || "TODAY'S FORECAST").toUpperCase()}</div>
              <div className="mep-tileBig" data-field="tile2Big" style={{ whiteSpace: 'pre-wrap' }}>{c.tile2Big || '68°'}</div>
              <div className="mep-tileSub" data-field="tile2Sub" style={{ whiteSpace: 'pre-wrap' }}>{c.tile2Sub || 'sunny + crisp, recess outside!'}</div>
            </div>
          </div>

          <div className="mep-tile mep-tile3">
            <div className="mep-tileIcon" data-field="tile3Emoji" style={{ whiteSpace: 'pre-wrap' }}>{c.tile3Emoji || '🎉'}</div>
            <div className="mep-tileBody">
              <div className="mep-tileLbl" data-field="tile3Label" style={{ whiteSpace: 'pre-wrap' }}>{(c.tile3Label || 'COMING UP').toUpperCase()}</div>
              <div className="mep-tileBig" data-field="tile3Big" style={{ whiteSpace: 'pre-wrap' }}>{c.tile3Big || 'Spring Musical'}</div>
              <div className="mep-tileSub" data-field="tile3Sub" style={{ whiteSpace: 'pre-wrap' }}>{c.tile3Sub || 'Thursday April 28 · 7pm'}</div>
            </div>
          </div>
        </div>

        {/* LOWER 2-UP — left + right crests (mascot / motto), big and centered */}
        <div className="mep-crestRow">
          <div className="mep-crestWrap mep-left">
            <div className="mep-crest"><div className="mep-crestIcon" data-field="leftCrestEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.leftCrestEmoji || '🦅'}</div></div>
            <div className="mep-crestLbl" data-field="leftCrestLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.leftCrestLabel || 'GO EAGLES').toUpperCase()}</div>
          </div>
          <div className="mep-crestWrap mep-right">
            <div className="mep-crest"><div className="mep-crestIcon" data-field="rightCrestEmoji" style={{ whiteSpace: 'pre-wrap' }}>{c.rightCrestEmoji || '📚'}</div></div>
            <div className="mep-crestLbl" data-field="rightCrestLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.rightCrestLabel || 'LEARN DAILY').toUpperCase()}</div>
          </div>
        </div>

        {/* BOTTOM TICKER — pinned full-width */}
        <div className="mep-ticker">
          <div className="mep-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'Welcome').toUpperCase()}</div>
          <div className="mep-tickerScroll">
            <span
              className="mep-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 72)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — operator clicks land in the right region */}
        {!isLive && (
          <>
            <Hotspot section="header"     x={120}  y={140}  w={1920} h={780} />
            <Hotspot section="tile1"      x={120}  y={1000} w={1920} h={420} />
            <Hotspot section="tile2"      x={120}  y={1450} w={1920} h={420} />
            <Hotspot section="tile3"      x={120}  y={1900} w={1920} h={420} />
            <Hotspot section="leftCrest"  x={120}  y={2380} w={920}  h={760} />
            <Hotspot section="rightCrest" x={1120} y={2380} w={920}  h={760} />
            <Hotspot section="ticker"     x={0}    y={3300} w={2160} h={540} />
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

const CSS_MEP = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Caveat:wght@700&family=Inter:wght@600;700;800&display=swap');

.mep-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #1f2937;
  background:
    radial-gradient(ellipse at 50% -10%, #fef3c7 0%, transparent 45%),
    radial-gradient(ellipse at 15% 75%, rgba(59,130,246,.22) 0%, transparent 40%),
    radial-gradient(ellipse at 85% 75%, rgba(236,72,153,.22) 0%, transparent 40%),
    linear-gradient(180deg, #dbeafe 0%, #ffe4e6 50%, #fef3c7 100%);
  overflow: hidden;
}

/* Clouds drift across the top band */
.mep-cloud {
  position: absolute; width: 360px; height: 120px;
  background: #fff; border-radius: 80px;
  box-shadow:
    -100px -8px 0 -16px #fff, -200px 0 0 -28px #fff,
     100px -12px 0 -12px #fff,  200px 0 0 -24px #fff;
  animation: mep-drift linear infinite;
  opacity: .85;
}
.mep-c1 { top: 120px;  left: -10%; animation-duration: 130s; }
.mep-c2 { top: 280px;  left: -30%; animation-duration: 160s; animation-delay: -50s; transform: scale(.7); }
.mep-c3 { top: 200px;  left: -20%; animation-duration: 145s; animation-delay: -85s; transform: scale(1.1); }
.mep-c4 { top: 400px;  left: -40%; animation-duration: 175s; animation-delay: -25s; transform: scale(.9); }
@keyframes mep-drift { from { transform: translateX(0); } to { transform: translateX(2700px); } }

/* Balloons rise the full height of the canvas */
.mep-balloon {
  position: absolute; bottom: -160px; width: 110px; height: 140px;
  border-radius: 50% 50% 48% 48%;
  animation: mep-riseBalloon linear infinite;
  z-index: 1;
}
.mep-balloon::after {
  content: ''; position: absolute; left: 50%; top: 100%; width: 2px; height: 320px;
  background: rgba(0,0,0,.3); transform: translateX(-50%);
}
.mep-b1 { left: 6%;  background: #ec4899; animation-duration: 28s; animation-delay: 0s; }
.mep-b2 { left: 14%; background: #fbbf24; animation-duration: 32s; animation-delay: -6s; }
.mep-b3 { left: 22%; background: #06b6d4; animation-duration: 30s; animation-delay: -11s; }
.mep-b4 { left: 78%; background: #a78bfa; animation-duration: 34s; animation-delay: -3s; }
.mep-b5 { left: 86%; background: #34d399; animation-duration: 31s; animation-delay: -16s; }
.mep-b6 { left: 94%; background: #f97316; animation-duration: 29s; animation-delay: -22s; }
@keyframes mep-riseBalloon {
  0%   { transform: translateY(0) translateX(0); opacity: 0; }
  6%   { opacity: 1; }
  100% { transform: translateY(-4200px) translateX(60px); opacity: .9; }
}

/* HERO — hanging welcome sign */
.mep-signWrap {
  position: absolute; top: 140px; left: 50%; transform: translateX(-50%); z-index: 5;
  display: flex; flex-direction: column; align-items: center;
  width: 1900px;
}
.mep-signChains {
  width: 50%; height: 80px;
  background: repeating-linear-gradient(90deg,
    #64748b 0 8px, transparent 8px 28px);
  background-size: 28px 80px;
}
.mep-sign {
  position: relative;
  background: linear-gradient(180deg, #fff 0%, #fef3c7 100%);
  border: 16px solid #dc2626;
  border-radius: 56px;
  padding: 60px 130px;
  text-align: center;
  box-shadow:
    0 0 0 10px #fff, 0 0 0 24px #dc2626,
    0 0 80px rgba(220,38,38,.35),
    0 48px 96px rgba(0,0,0,.3);
  animation: mep-signSway 5s ease-in-out infinite;
  transform-origin: 50% -40px;
  width: 100%;
  box-sizing: border-box;
}
@keyframes mep-signSway { 0%, 100% { transform: rotate(-1deg); } 50% { transform: rotate(1deg); } }
.mep-sign::before {
  content: ''; position: absolute; inset: -8px; border-radius: 48px;
  background:
    radial-gradient(circle at 0% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 16% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 33% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 50% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 66% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 83% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 100% 0%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 0% 100%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 16% 100%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 33% 100%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 50% 100%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 66% 100%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 83% 100%, #fbbf24 0 18px, transparent 18px),
    radial-gradient(circle at 100% 100%, #fbbf24 0 18px, transparent 18px);
  animation: mep-bulbBlink 1.5s steps(2) infinite;
  pointer-events: none;
}
@keyframes mep-bulbBlink { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.mep-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 48px;
  color: #dc2626; letter-spacing: .35em; text-transform: uppercase;
  position: relative; z-index: 1;
}
.mep-sign h1 {
  margin: 12px 0 0 0;
  font-family: 'Anton', sans-serif; font-size: 220px; line-height: .9;
  background: linear-gradient(90deg, #dc2626 0%, #f59e0b 50%, #ec4899 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em;
  text-shadow: 0 0 80px rgba(220,38,38,.2);
  text-transform: uppercase;
  position: relative; z-index: 1;
  white-space: nowrap;
}
.mep-signSub {
  font-family: 'Caveat', cursive; font-size: 100px; color: #92400e;
  margin-top: 16px; position: relative; z-index: 1;
  line-height: 1;
}

/* INFO COLUMN — three full-width tiles stacked vertically */
.mep-info {
  position: absolute; top: 1000px; left: 120px; right: 120px;
  display: flex; flex-direction: column; gap: 32px;
  z-index: 3;
}

.mep-tile {
  background: #fff;
  border: 10px solid #1f2937;
  border-radius: 36px;
  padding: 36px 56px;
  box-shadow: 0 24px 48px rgba(0,0,0,.18), 14px 14px 0 rgba(0,0,0,.15);
  position: relative;
  display: flex; align-items: center; gap: 56px;
  height: 388px;
  box-sizing: border-box;
  animation: mep-tileFloat 5s ease-in-out infinite;
}
.mep-tile1 { animation-delay: 0s; border-color: #dc2626; box-shadow: 0 24px 48px rgba(0,0,0,.2), 14px 14px 0 #dc2626; }
.mep-tile2 { animation-delay: -1.2s; border-color: #f59e0b; box-shadow: 0 24px 48px rgba(0,0,0,.2), 14px 14px 0 #f59e0b; }
.mep-tile3 { animation-delay: -2.4s; border-color: #06b6d4; box-shadow: 0 24px 48px rgba(0,0,0,.2), 14px 14px 0 #06b6d4; }
@keyframes mep-tileFloat {
  0%, 100% { transform: translateY(0) rotate(-.4deg); }
  50%      { transform: translateY(-10px) rotate(.4deg); }
}
.mep-tile::after {
  content: ''; position: absolute; top: -22px; left: 36%; right: 36%; height: 38px;
  background: repeating-linear-gradient(135deg, rgba(0,0,0,.15) 0 14px, rgba(0,0,0,.08) 14px 28px);
  border: 3px solid rgba(0,0,0,.2);
  opacity: .6;
  transform: rotate(-2deg);
}
.mep-tileIcon {
  font-size: 220px; line-height: 1;
  filter: drop-shadow(0 8px 12px rgba(0,0,0,.2));
  flex: 0 0 240px; text-align: center;
}
.mep-tileBody { flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.mep-tileLbl {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 36px;
  color: #92400e; letter-spacing: .2em; text-transform: uppercase;
  margin-bottom: 6px;
}
.mep-tile2 .mep-tileLbl { color: #b45309; }
.mep-tile3 .mep-tileLbl { color: #0e7490; }
.mep-tileBig {
  font-family: 'Anton', sans-serif; font-size: 168px; line-height: 1;
  color: #1f2937;
  letter-spacing: .01em;
  text-transform: none;
}
.mep-tileSub {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 64px;
  color: #475569; margin-top: 8px; line-height: 1.05;
}

/* CRESTS — left + right, big and ceremonial, on the lower half */
.mep-crestRow {
  position: absolute; top: 2380px; left: 120px; right: 120px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 80px;
  z-index: 4;
  height: 760px;
}
.mep-crestWrap {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 32px;
}
.mep-crestWrap.mep-left  { animation: mep-crestBobL 3.6s ease-in-out infinite; }
.mep-crestWrap.mep-right { animation: mep-crestBobR 3.6s ease-in-out infinite -1s; }
@keyframes mep-crestBobL { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-16px) rotate(3deg); } }
@keyframes mep-crestBobR { 0%, 100% { transform: translateY(0) rotate(3deg); } 50% { transform: translateY(-16px) rotate(-3deg); } }
.mep-crest {
  width: 460px; height: 520px;
  background: radial-gradient(circle at 35% 30%, #fde68a, #fbbf24 60%, #b45309);
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 28px 56px rgba(0,0,0,.4);
  position: relative;
}
.mep-crest::before {
  content: ''; position: absolute; inset: 28px;
  clip-path: polygon(50% 0%, 100% 12%, 100% 60%, 50% 100%, 0 60%, 0 12%);
  box-shadow: inset 0 0 0 10px #92400e;
}
.mep-crestIcon {
  font-size: 240px; line-height: 1; transform: translateY(-16px);
  filter: drop-shadow(0 8px 14px rgba(0,0,0,.4));
  position: relative; z-index: 1;
}
.mep-crestLbl {
  font-family: 'Bungee', cursive; font-size: 56px; color: #7c2d12;
  letter-spacing: .1em; text-align: center; line-height: 1;
}

/* TICKER — pinned bottom, tall enough for distance read */
.mep-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 260px;
  background: linear-gradient(90deg, #dc2626 0%, #f59e0b 50%, #ec4899 100%);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 10px solid #fff;
  box-shadow: 0 -16px 40px rgba(0,0,0,.25);
}
.mep-tickerStamp {
  flex: 0 0 auto; padding: 0 64px; height: 100%;
  background: #fff; color: #dc2626;
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 96px; letter-spacing: .15em;
  border-right: 10px solid #dc2626;
}
.mep-tickerScroll { flex: 1; overflow: hidden; }
.mep-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 110px;
  color: #fff; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  text-shadow: 4px 4px 0 rgba(0,0,0,.3);
  animation: mep-tickerScroll 72s linear infinite;
}
@keyframes mep-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(220, 38, 38, .08); box-shadow: inset 0 0 0 4px rgba(220, 38, 38, .55); }
.aw-hotspot:focus-visible { background-color: rgba(220, 38, 38, .14); box-shadow: inset 0 0 0 4px rgba(220, 38, 38, .85); }
`;
