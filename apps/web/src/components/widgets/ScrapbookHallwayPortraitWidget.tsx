"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// Scrapbook Hallway portrait companion — vertical re-flow of the landscape ScrapbookHallwayWidget.
// Reuses the exact `Cfg` shape (verbatim — same hotspot section names, same default values, same
// data-field attributes) so the THEMED_WIDGET_FIELDS editor "just works." Inner stage is exactly
// 2160x3840 px. Outer wrapper measures parent and applies `transform: scale(N)` so it fits any
// container without distortion.
//
// Layout regions (top → bottom):
//   • Top ~700px:  scrapbook header — handwritten "HALLWAY · LEARN GROW SHINE" with washi-tape
//                  banner, tilted day card, clock polaroid
//   • ~1300px:    schedule — 7 tilted polaroid cards, each TIME · CLASS · ROOM in handwriting
//                  with washi-tape corners; current period highlighted yellow
//   • ~700px:     attendance polaroid hero — large tilted cream polaroid with check-mark badge
//                  + giant handwritten percentage
//   • ~600px:     2-up — Today's Announcement polaroid + Coming Up countdown polaroid
//   • Bottom ~440px: scrapbook ticker — handwritten "HALLWAY NEWS" stamp + scrolling text
//
// Same CSS animation philosophy as the landscape (subtle paper sway, polaroid wobble), prefixed
// `sbhp-` to avoid collision with the landscape's `sbh-`. Cream paper background (#fff7ed) with
// paper-grain repeating-radial-gradient texture, washi-tape strips, polaroids with offset shadows.

import { useEffect, useMemo, useRef, useState } from 'react';

type Row = { num?: string | number; time?: string; name?: string; room?: string; highlight?: boolean };

interface Cfg {
  title?: string;
  subtitle?: string;
  scheduleTitle?: string;
  schedulePageLabel?: string;
  rows?: Row[];
  attendancePct?: string | number;
  attendanceDay?: string;
  attendanceLabel?: string;
  clockTimeZone?: string;
  weatherTemp?: string;
  weatherDesc?: string;
  annLabel?: string;
  annMsg?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;
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

const DEFAULT_ROWS: Row[] = [
  { num: 1, time: '8:15 — 9:00',   name: 'Homeroom + Morning Meeting', room: 'Rm 12' },
  { num: 2, time: '9:05 — 9:55',   name: 'Math · Mrs. Chen',           room: 'Rm 14' },
  { num: 3, time: '10:00 — 10:50', name: 'Reading · Mrs. Hill',        room: 'Rm 12', highlight: true },
  { num: 4, time: '11:00 — 11:45', name: 'Science — STATES OF MATTER!',room: 'Rm 21' },
  { num: 5, time: '11:50 — 12:30', name: 'Lunch + Recess',             room: 'Cafe' },
  { num: 6, time: '12:35 — 1:25',  name: 'Art with Ms. Greene 🎨',     room: 'Rm 9' },
  { num: 7, time: '1:30 — 2:15',   name: 'PE — Field Day prep!',       room: 'Gym' },
];

export function ScrapbookHallwayPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
  const c = config || {};
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isLive]);

  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '34';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'PM';

  const rows: Row[] = useMemo(() => {
    if (Array.isArray(c.rows) && c.rows.length > 0) return c.rows;
    return DEFAULT_ROWS;
  }, [c.rows]);

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 8;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'day' : (c.countdownUnit || 'days');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('   ·   ');
    return "Walk, don't run in the halls 🚶   ·   Reading Challenge: 20 minutes a day   ·   Wear school colors on Spirit Friday! 🎉";
  }, [c.tickerMessages]);

  // Per-row tilt seed (deterministic so it doesn't re-flicker on every render)
  const rowTilts = useMemo(() => rows.map((_, i) => {
    const seed = (i * 37) % 9;
    return ((seed - 4) * 0.6).toFixed(2);
  }), [rows]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff7ed',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Patrick+Hand&family=Permanent+Marker&family=Special+Elite&family=Shadows+Into+Light&family=Kalam:wght@400;700&display=swap"
      />
      <style>{CSS_SBHP}</style>

      <div
        className="sbhp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Decorative corner washi tape */}
        <div className="sbhp-corner sbhp-corner-tl" />
        <div className="sbhp-corner sbhp-corner-tr" />

        {/* ───────── HEADER (~700px) ───────── */}
        <div className="sbhp-header">
          <div className="sbhp-banner">
            <div className="sbhp-bannerTape sbhp-bannerTape-l" />
            <div className="sbhp-bannerTape sbhp-bannerTape-r" />
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'HALLWAY'}</h1>
            <div className="sbhp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'learn · grow · shine'}</div>
          </div>

          <div className="sbhp-headerRow">
            <div className="sbhp-dayCard" data-field="attendanceDay" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceDay || 'Mon · 4/19'}</div>
            <div className="sbhp-clockPolaroid">
              <div className="sbhp-clockTape" />
              <div className="sbhp-clockTime">{hh}:{mm}</div>
              <div className="sbhp-clockAp">{ampm}</div>
              <div className="sbhp-clockCaption">~ right now ~</div>
            </div>
          </div>
        </div>

        {/* ───────── SCHEDULE (~1300px) ───────── */}
        <div className="sbhp-scheduleWrap">
          <div className="sbhp-pageLbl" data-field="schedulePageLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.schedulePageLabel || "~ Today's Schedule ~"}</div>
          <h2 className="sbhp-scheduleTitle" data-field="scheduleTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleTitle || 'Period by Period'}</h2>
          <div className="sbhp-rows">
            {rows.slice(0, 7).map((r, i) => (
              <div
                key={i}
                className={`sbhp-row${r.highlight ? ' sbhp-hl' : ''}`}
                style={{ transform: `rotate(${rowTilts[i] || 0}deg)` }}
              >
                <div className="sbhp-rowTape sbhp-rowTape-l" />
                <div className="sbhp-rowTape sbhp-rowTape-r" />
                <div className="sbhp-num">{r.num ?? i + 1}</div>
                <div className="sbhp-rowMid">
                  <div className="sbhp-time">{r.time || ''}</div>
                  <div className="sbhp-name">{r.name || ''}</div>
                </div>
                <div className="sbhp-room">{r.room || ''}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ───────── ATTENDANCE HERO (~700px) ───────── */}
        <div className="sbhp-attendance">
          <div className="sbhp-attTape" />
          <div className="sbhp-attCheck">
            <svg viewBox="0 0 100 100" width="160" height="160" aria-hidden="true">
              <circle cx="50" cy="50" r="44" fill="#86efac" stroke="#15803d" strokeWidth="4" />
              <path d="M28 52 L44 68 L74 36" fill="none" stroke="#14532d" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="sbhp-attBig">
            <b>{c.attendancePct ?? 97}</b><sup>%</sup>
          </div>
          <div className="sbhp-attLbl" data-field="attendanceLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceLabel || '~ here today ~'}</div>
          <div className="sbhp-attCaption">attendance count</div>
        </div>

        {/* ───────── TWO-UP: ANNOUNCEMENT + COUNTDOWN (~600px) ───────── */}
        <div className="sbhp-twoUp">
          <div className="sbhp-ann">
            <div className="sbhp-annTape" />
            <div className="sbhp-annLbl" data-field="annLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.annLabel || "Today's Announcement"}</div>
            <div className="sbhp-annMsg" data-field="annMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.annMsg || 'Assembly in the gym Friday at 2 PM — all classes welcome!'}</div>
          </div>

          <div className="sbhp-ctd">
            <div className="sbhp-ctdTape" />
            <div className="sbhp-ctdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Coming Up'}</div>
            <div className="sbhp-ctdNum">{days}</div>
            <div className="sbhp-ctdUnit">{unit}</div>
            <div className="sbhp-ctdCaption">till field day</div>
          </div>
        </div>

        {/* ───────── TICKER (~440px reserved bottom band, 320px ticker) ───────── */}
        <div className="sbhp-ticker">
          <div className="sbhp-stamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'HALLWAY NEWS').toUpperCase()}</div>
          <div className="sbhp-scroll">
            <span
              className="sbhp-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 90)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — same section names as landscape so editor keys map */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={60}   y={60}   w={2040} h={680} />
            <Hotspot section="schedule"     x={60}   y={780}  w={2040} h={1240} />
            <Hotspot section="attendance"   x={60}   y={2060} w={2040} h={680} />
            <Hotspot section="announcement" x={60}   y={2780} w={1000} h={580} />
            <Hotspot section="countdown"    x={1100} y={2780} w={1000} h={580} />
            <Hotspot section="clock"        x={1340} y={420}  w={760}  h={300} />
            <Hotspot section="ticker"       x={0}    y={3500} w={2160} h={340} />
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

const CSS_SBHP = `
.sbhp-stage {
  position: relative;
  font-family: 'Patrick Hand', cursive;
  color: #3a2614;
  background:
    radial-gradient(ellipse at 18% 8%, rgba(125,211,252,.12), transparent 55%),
    radial-gradient(ellipse at 82% 92%, rgba(244,114,182,.10), transparent 55%),
    repeating-radial-gradient(circle at 22% 30%, transparent 0 3px, rgba(120,53,15,.022) 3px 4px),
    repeating-linear-gradient(45deg, transparent 0 8px, rgba(120,53,15,.012) 8px 9px),
    #fff7ed;
  overflow: hidden;
  animation: sbhp-paperSway 18s ease-in-out infinite;
}
.sbhp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .35; z-index: 0;
  background:
    repeating-radial-gradient(circle at 12% 22%, transparent 0 2px, rgba(180,83,9,.018) 2px 3px),
    repeating-radial-gradient(circle at 72% 78%, transparent 0 3px, rgba(180,83,9,.018) 3px 4px);
}
@keyframes sbhp-paperSway {
  0%, 100% { background-position: 0 0, 0 0, 0 0, 0 0, 0 0; }
  50%      { background-position: 6px 4px, -4px 6px, 0 0, 0 0, 0 0; }
}

/* Corner washi tape strips */
.sbhp-corner {
  position: absolute; width: 280px; height: 64px; z-index: 2;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 12px, transparent 12px 24px), #fcd34d;
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
}
.sbhp-corner-tl { top: 60px; left: -60px; transform: rotate(-22deg); }
.sbhp-corner-tr { top: 50px; right: -60px; transform: rotate(22deg); background-color: #93c5fd; }

/* ────────── HEADER ────────── */
.sbhp-header {
  position: absolute; top: 0; left: 0; right: 0; height: 740px; z-index: 3;
  padding: 80px 100px 0;
  display: flex; flex-direction: column;
}
.sbhp-banner {
  position: relative;
  background: #fff;
  box-shadow: 0 12px 32px rgba(0,0,0,.18);
  padding: 36px 60px 28px;
  text-align: center;
  transform: rotate(-.6deg);
  clip-path: polygon(
    0 0,100% 0,100% 88%,
    97% 100%,93% 88%,89% 100%,85% 88%,81% 100%,77% 88%,73% 100%,
    69% 88%,65% 100%,61% 88%,57% 100%,53% 88%,49% 100%,45% 88%,
    41% 100%,37% 88%,33% 100%,29% 88%,25% 100%,21% 88%,17% 100%,
    13% 88%,9% 100%,5% 88%,2% 100%,0 88%
  );
}
.sbhp-bannerTape {
  position: absolute; top: -18px; height: 44px; width: 220px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 8px, transparent 8px 16px), #fcd34d;
  box-shadow: 0 2px 6px rgba(0,0,0,.18); z-index: 2;
}
.sbhp-bannerTape-l { left: 80px; transform: rotate(-12deg); }
.sbhp-bannerTape-r { right: 80px; transform: rotate(15deg); background-color: #93c5fd; }
.sbhp-banner h1 {
  font-family: 'Permanent Marker', cursive; font-weight: 400;
  font-size: 220px; line-height: .95; margin: 0;
  color: #be185d; letter-spacing: -.01em;
  text-shadow: 6px 6px 0 rgba(252,211,77,.45);
}
.sbhp-banner .sbhp-sub {
  font-family: 'Shadows Into Light', cursive; font-size: 64px; color: #92400e; margin-top: 8px;
}

.sbhp-headerRow {
  margin-top: 32px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 40px;
}
.sbhp-dayCard {
  background: linear-gradient(180deg, #fde68a, #fcd34d);
  padding: 22px 50px;
  border: 5px solid #fff;
  box-shadow: 0 8px 22px rgba(0,0,0,.22);
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 56px; color: #78350f;
  letter-spacing: .05em;
  transform: rotate(-4deg);
  animation: sbhp-dayWobble 6s ease-in-out infinite;
}
@keyframes sbhp-dayWobble {
  0%, 100% { transform: rotate(-4deg) translateY(0); }
  50%      { transform: rotate(-2.5deg) translateY(-4px); }
}

.sbhp-clockPolaroid {
  position: relative;
  background: #fff;
  width: 360px; padding: 28px 24px 32px;
  box-shadow: 0 14px 30px rgba(0,0,0,.22);
  transform: rotate(3deg);
  text-align: center;
  border: 3px solid #fff;
  animation: sbhp-clockWobble 8s ease-in-out infinite;
}
@keyframes sbhp-clockWobble {
  0%, 100% { transform: rotate(3deg); }
  50%      { transform: rotate(1.5deg); }
}
.sbhp-clockTape {
  position: absolute; top: -22px; left: 50%; transform: translateX(-50%) rotate(-5deg);
  width: 180px; height: 38px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 8px, transparent 8px 16px), #f9a8d4;
  box-shadow: 0 2px 4px rgba(0,0,0,.16);
}
.sbhp-clockTime { font-family: 'Caveat', cursive; font-weight: 700; font-size: 130px; color: #be185d; line-height: 1; }
.sbhp-clockAp   { font-family: 'Patrick Hand', cursive; font-size: 44px; color: #92400e; letter-spacing: .12em; }
.sbhp-clockCaption { font-family: 'Shadows Into Light', cursive; font-size: 32px; color: #92400e; margin-top: 6px; }

/* ────────── SCHEDULE ────────── */
.sbhp-scheduleWrap {
  position: absolute; top: 760px; left: 60px; right: 60px; height: 1280px; z-index: 3;
  padding: 28px 36px 32px;
  background: #fffdf6;
  box-shadow: 0 16px 40px rgba(0,0,0,.16), 0 0 0 4px rgba(252,211,77,.32);
  border: 2px solid rgba(180,83,9,.18);
  background-image:
    repeating-linear-gradient(to bottom, transparent 0 56px, rgba(99,102,241,.10) 56px 57px);
  transform: rotate(.3deg);
  display: flex; flex-direction: column;
}
.sbhp-pageLbl {
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 36px;
  color: #92400e; letter-spacing: .15em; text-transform: uppercase;
  text-align: right; padding-right: 16px; margin-bottom: 4px;
}
.sbhp-scheduleTitle {
  margin: 0 0 18px; padding-left: 24px;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 130px; line-height: 1;
  color: #be185d;
}
.sbhp-rows {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 18px;
}

.sbhp-row {
  position: relative;
  flex: 1 1 0; min-height: 0;
  display: grid; grid-template-columns: 130px 1fr 280px;
  align-items: center; gap: 28px;
  padding: 18px 36px 18px 30px;
  background: #fff;
  box-shadow: 0 6px 16px rgba(0,0,0,.14);
  border: 2px solid rgba(180,83,9,.12);
}
.sbhp-row.sbhp-hl {
  background: linear-gradient(90deg, #fef3c7 0%, #fde68a 100%);
  box-shadow: 0 8px 22px rgba(252,211,77,.45), inset 0 0 0 4px #fcd34d;
}
.sbhp-rowTape {
  position: absolute; top: -10px; height: 24px; width: 90px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 6px, transparent 6px 12px), #93c5fd;
  box-shadow: 0 1px 3px rgba(0,0,0,.14); z-index: 2;
}
.sbhp-rowTape-l { left: 28px; transform: rotate(-8deg); }
.sbhp-rowTape-r { right: 28px; transform: rotate(8deg); background-color: #fcd34d; }

.sbhp-num {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 96px;
  color: #f472b6; line-height: 1; text-align: center;
}
.sbhp-rowMid { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.sbhp-time {
  font-family: 'Special Elite', cursive; font-size: 38px; color: #92400e; letter-spacing: .02em;
}
.sbhp-name {
  font-family: 'Patrick Hand', cursive; font-size: 56px; color: #3a2614; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sbhp-room {
  font-family: 'Shadows Into Light', cursive; font-size: 48px; color: #be185d;
  text-align: right; white-space: nowrap;
}

/* ────────── ATTENDANCE HERO ────────── */
.sbhp-attendance {
  position: absolute; top: 2080px; left: 100px; right: 100px; height: 660px; z-index: 3;
  background: #fff;
  padding: 60px 60px 56px;
  box-shadow: 0 20px 48px rgba(0,0,0,.22);
  transform: rotate(-1.5deg);
  display: grid; grid-template-columns: 240px 1fr; grid-template-rows: auto auto auto;
  column-gap: 50px; row-gap: 6px;
  align-items: center;
  border: 4px solid #fff;
  animation: sbhp-attWobble 9s ease-in-out infinite;
}
@keyframes sbhp-attWobble {
  0%, 100% { transform: rotate(-1.5deg); }
  50%      { transform: rotate(-.5deg); }
}
.sbhp-attTape {
  position: absolute; top: -28px; left: 50%; transform: translateX(-50%) rotate(-4deg);
  width: 280px; height: 48px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #86efac;
  box-shadow: 0 2px 6px rgba(0,0,0,.18);
}
.sbhp-attCheck {
  grid-column: 1; grid-row: 1 / span 3;
  display: flex; align-items: center; justify-content: center;
}
.sbhp-attCheck svg {
  width: 220px; height: 220px;
  filter: drop-shadow(0 8px 14px rgba(21,128,61,.35));
  animation: sbhp-checkBob 3.6s ease-in-out infinite;
}
@keyframes sbhp-checkBob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50%      { transform: translateY(-6px) rotate(2deg); }
}
.sbhp-attBig {
  grid-column: 2; grid-row: 1;
  display: flex; align-items: baseline; gap: 6px;
}
.sbhp-attBig b {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 360px;
  color: #15803d; line-height: .85;
  text-shadow: 8px 8px 0 rgba(252,211,77,.6);
}
.sbhp-attBig sup {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 160px;
  color: #15803d; line-height: 1;
}
.sbhp-attLbl {
  grid-column: 2; grid-row: 2;
  font-family: 'Caveat', cursive; font-size: 92px; color: #92400e; line-height: 1;
}
.sbhp-attCaption {
  grid-column: 2; grid-row: 3;
  font-family: 'Special Elite', cursive; font-size: 36px; color: #78350f; letter-spacing: .12em;
  text-transform: uppercase; opacity: .8;
}

/* ────────── TWO-UP: ANNOUNCEMENT + COUNTDOWN ────────── */
.sbhp-twoUp {
  position: absolute; top: 2800px; left: 60px; right: 60px; height: 580px; z-index: 3;
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
}

.sbhp-ann {
  position: relative;
  background: #fef3c7;
  padding: 60px 50px 40px;
  border: 5px dashed #d97706;
  box-shadow: 0 12px 30px rgba(0,0,0,.16);
  transform: rotate(-1.2deg);
  display: flex; flex-direction: column; justify-content: center;
}
.sbhp-annTape {
  position: absolute; top: -22px; left: 50px; transform: rotate(-8deg);
  width: 200px; height: 42px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #f9a8d4;
  box-shadow: 0 2px 5px rgba(0,0,0,.18);
}
.sbhp-annLbl {
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 38px; color: #92400e;
  letter-spacing: .15em; text-transform: uppercase;
}
.sbhp-annLbl::before { content: '📣 '; font-size: 44px; }
.sbhp-annMsg {
  margin-top: 14px;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 96px;
  color: #78350f; line-height: 1.05;
}

.sbhp-ctd {
  position: relative;
  background: #fff;
  padding: 60px 40px 36px;
  border-top: 14px solid #f472b6;
  box-shadow: 0 12px 30px rgba(0,0,0,.16);
  transform: rotate(2deg);
  text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.sbhp-ctdTape {
  position: absolute; top: -22px; right: 50px; transform: rotate(10deg);
  width: 180px; height: 42px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px), #93c5fd;
  box-shadow: 0 2px 5px rgba(0,0,0,.18);
}
.sbhp-ctdLbl {
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 38px; color: #831843;
  letter-spacing: .15em; text-transform: uppercase;
}
.sbhp-ctdNum {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 280px;
  color: #be185d; line-height: .9; margin-top: 6px;
  text-shadow: 6px 6px 0 rgba(252,211,77,.5);
  animation: sbhp-ctdPulse 1.6s ease-in-out infinite;
}
@keyframes sbhp-ctdPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}
.sbhp-ctdUnit {
  font-family: 'Patrick Hand', cursive; font-size: 70px; color: #92400e; line-height: 1;
}
.sbhp-ctdCaption {
  margin-top: 6px;
  font-family: 'Special Elite', cursive; font-size: 28px; color: #78350f;
  letter-spacing: .15em; text-transform: uppercase; opacity: .8;
}

/* ────────── TICKER ────────── */
.sbhp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 320px;
  background: #fff; border-top: 8px double #f9a8d4;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -8px 22px rgba(0,0,0,.10);
  z-index: 6;
}
.sbhp-ticker::before {
  content: ''; position: absolute; top: -4px; left: 0; right: 0; height: 22px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 14px, transparent 14px 28px), #fcd34d;
  box-shadow: 0 2px 4px rgba(0,0,0,.18);
  z-index: 1;
}
.sbhp-stamp {
  flex: 0 0 auto; padding: 0 70px; height: 100%;
  background: linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%);
  color: #1e3a8a;
  display: flex; align-items: center;
  font-family: 'Permanent Marker', cursive;
  font-weight: 400; font-size: 88px; letter-spacing: .08em;
  border-right: 8px dashed #fff;
  text-shadow: 3px 3px 0 rgba(255,255,255,.5);
}
.sbhp-scroll {
  flex: 1; overflow: hidden; position: relative; height: 100%;
  display: flex; align-items: center;
}
.sbhp-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 130px; color: #92400e; line-height: 1;
  padding-left: 100%;
  animation: sbhp-tickerScroll 90s linear infinite;
  will-change: transform;
}
@keyframes sbhp-tickerScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

/* ────────── HOTSPOTS ────────── */
.aw-hotspot {
  outline: none;
  transition: box-shadow .15s ease, background-color .15s ease;
  border-radius: 16px;
}
.aw-hotspot:hover {
  background-color: rgba(236, 72, 153, .08);
  box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55);
}
.aw-hotspot:focus-visible {
  background-color: rgba(236, 72, 153, .14);
  box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85);
}
`;
