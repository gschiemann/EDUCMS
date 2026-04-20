"use client";

// PORTED 2026-04-20 from scratch/design/storybook-hallway.html — transform:scale pattern, isLive-gated hotspots.
// Storybook theme: open-book spread with center spine, illuminated drop caps, parchment texture, double border frames.
// Attendance .pct b reduced to 140px (was 200px) — matches HTML note. MULTI-PERIOD countdown design note preserved
// in comments below (additive config.countdownPeriods shape to be wired in a later sprint).
// Ticker uses @keyframes sh-tickerScroll with will-change: transform.

import { useEffect, useMemo, useRef, useState } from 'react';

type Row = { num?: string; time?: string; name?: string; room?: string; highlight?: boolean };

// Design note — MULTI-PERIOD COUNTDOWN (future):
// config.countdownPeriods = [{ label: 'Lunch A', start: '11:30' }, ...]
// Widget picks next period > now; rolls to tomorrow if all past; shows
// "Lunch A in progress · next wave 12:05" when currently in-period.
// Single-period countdownDate shape stays; countdownPeriods is additive.

interface Cfg {
  chapter?: string;
  title?: string;
  subtitle?: string;
  scheduleTitle?: string;
  scheduleSub?: string;
  rows?: Row[];
  attendanceTopLabel?: string;
  attendancePct?: string | number;
  attendanceBotLabel?: string;
  clockTimeZone?: string;
  clockLabel?: string;
  weatherTemp?: string;
  weatherDesc?: string;
  annLabel?: string;
  annMsg?: string;
  countdownLabel?: string;
  countdownDate?: string;
  countdownNumber?: string | number;
  countdownUnit?: string;
  pageNumLeft?: string;
  pageNumRight?: string;
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

export function StorybookHallwayWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
    return [
      { num: 'I',   time: '8:15 — 9:00',  name: 'Homeroom & Morning Meeting', room: 'Rm 12' },
      { num: 'II',  time: '9:05 — 9:55',  name: 'Mathematics with Mrs. Chen',  room: 'Rm 14' },
      { num: 'III', time: '10:00 — 10:50', name: 'Reading Workshop · Mrs. Hill', room: 'Rm 12', highlight: true },
      { num: 'IV',  time: '11:00 — 11:45', name: 'Science — States of Matter',   room: 'Rm 21' },
      { num: 'V',   time: '11:50 — 12:30', name: 'Lunch & Recess',               room: 'Cafe' },
      { num: 'VI',  time: '12:35 — 1:25',  name: 'Art with Ms. Greene',          room: 'Rm 9' },
    ];
  }, [c.rows]);

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const nowStart = new Date(); nowStart.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - nowStart.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 8;
  }, [c.countdownDate, c.countdownNumber]);
  const unit = typeof days === 'number' && days === 1 ? 'day hence' : (c.countdownUnit || 'days hence');

  const tickerSegments = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list;
    return [
      'Walk, do not run in the corridors',
      'Reading challenge: twenty minutes a day',
      'Wear school colours on Spirit Friday',
      'Field Day in eight days — sign up at the office',
      'Lunch Wave A at 11:30, Wave B at 12:05, Wave C at 12:40',
    ];
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1c1206',
      }}
    >
      <style>{CSS_SH}</style>

      <div
        className="sh-book"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="sh-pageFrames">
          <div className="sh-left" />
          <div className="sh-right" />
        </div>

        <div className="sh-corner sh-tl"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>
        <div className="sh-corner sh-tr"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>
        <div className="sh-corner sh-bl"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>
        <div className="sh-corner sh-br"><svg viewBox="0 0 70 70"><path d="M2 2 Q 35 2 35 35 M2 2 Q 2 35 35 35 M10 10 Q 26 10 26 26 M10 10 Q 10 26 26 26" /></svg></div>

        <div className="sh-pages">
          <div className="sh-header">
            <div className="sh-chapter">{c.chapter || 'In which we begin our day'}</div>
            <h1>{c.title || 'LEARN · GROW · SHINE'}</h1>
            <div className="sh-sub">{c.subtitle || 'every day, a new adventure'}</div>
          </div>

          <div className="sh-schedule">
            <h2>{c.scheduleTitle || "Today's Schedule"}</h2>
            <div className="sh-schSub">{c.scheduleSub || 'period by period, hour by hour'}</div>
            <div className="sh-rows">
              {rows.slice(0, 8).map((r, i) => (
                <div key={i} className={`sh-row${r.highlight ? ' sh-hl' : ''}`}>
                  <div className="sh-num">{r.num || ''}</div>
                  <div className="sh-time">{r.time || ''}</div>
                  <div className="sh-name">{r.name || ''}</div>
                  <div className="sh-room">{r.room || ''}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="sh-spine" />

          <div className="sh-right-col">
            <div className="sh-attendance">
              <div className="sh-lblTop">{c.attendanceTopLabel || 'Attendance today'}</div>
              <div className="sh-pct"><b>{c.attendancePct ?? 97}</b><sup>%</sup></div>
              <div className="sh-lblBot">{c.attendanceBotLabel || '— a fine showing —'}</div>
            </div>
            <div className="sh-miniRow">
              <div className="sh-clockBig">
                <div className="sh-t">{hh}:{mm} {ampm}</div>
                <div className="sh-lbl">{c.clockLabel || '~ noon hour ~'}</div>
              </div>
              <div className="sh-weather">
                <div className="sh-t">{c.weatherTemp || '42°'}</div>
                <div className="sh-desc">{c.weatherDesc || '~ clear skies ~'}</div>
              </div>
            </div>
          </div>

          <div className="sh-footer">
            <div className="sh-ann">
              <div className="sh-annLbl">{c.annLabel || 'An announcement —'}</div>
              <div className="sh-annMsg">{c.annMsg || "Assembly in the gymnasium, Friday at two o'clock — all classes welcome!"}</div>
            </div>
            <div className="sh-ctd">
              <div className="sh-ctdLbl">{c.countdownLabel || 'until field day'}</div>
              <div className="sh-ctdNum">{days}</div>
              <div className="sh-ctdUnit">{unit}</div>
            </div>
          </div>
        </div>

        <div className="sh-pgnum sh-pgL">{c.pageNumLeft || '— xiv —'}</div>
        <div className="sh-pgnum sh-pgR">{c.pageNumRight || '— xv —'}</div>

        <div className="sh-ticker">
          <div className="sh-stamp">{(c.tickerStamp || 'A WORD FROM THE HALLS').toUpperCase()}</div>
          <div className="sh-scroll">
            <span
              className="sh-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 52)}s` }}
            >
              {tickerSegments.map((seg, i) => (
                <span key={i}>
                  {i > 0 && <span className="sh-sep"> · </span>}
                  {seg}
                </span>
              ))}
            </span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={80}   y={70}   w={1760} h={200} />
            <Hotspot section="schedule"   x={80}   y={290}  w={1080} h={650} />
            <Hotspot section="attendance" x={1200} y={290}  w={640}  h={430} />
            <Hotspot section="clock"      x={1200} y={740}  w={310}  h={200} />
            <Hotspot section="weather"    x={1530} y={740}  w={310}  h={200} />
            <Hotspot section="announcement" x={80}  y={960}  w={1420} h={44} />
            <Hotspot section="countdown"  x={1520} y={960}  w={320}  h={44} />
            <Hotspot section="ticker"     x={0}    y={1004} w={1920} h={76} />
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

const CSS_SH = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;700&family=Quattrocento:wght@400;700&family=Italianno&display=swap');

.sh-book {
  position: relative;
  background:
    linear-gradient(90deg, transparent 48%, rgba(70,40,15,.0) 48%, rgba(70,40,15,.35) 50%, rgba(70,40,15,.0) 52%, transparent 52%),
    linear-gradient(90deg, #faecc6 0%, #f5dca0 45%, #d4a86a 50%, #f5dca0 55%, #faecc6 100%),
    #faecc6;
  font-family: 'Quattrocento', serif; color: #3d2410;
  overflow: hidden;
}
.sh-book::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(120,53,15,.025) 3px 4px);
  mix-blend-mode: multiply;
}
.sh-book::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 80px rgba(120,53,15,.35);
}

.sh-pageFrames { position: absolute; inset: 28px; pointer-events: none; }
.sh-pageFrames .sh-left, .sh-pageFrames .sh-right {
  position: absolute; top: 0; bottom: 0; width: calc(50% - 24px); border: 2px solid #8b5a2b;
}
.sh-pageFrames .sh-left { left: 0; }
.sh-pageFrames .sh-right { right: 0; }
.sh-pageFrames .sh-left::after, .sh-pageFrames .sh-right::after {
  content: ''; position: absolute; inset: 8px; border: 1px solid #8b5a2b;
}

.sh-corner { position: absolute; width: 70px; height: 70px; pointer-events: none; }
.sh-corner svg { width: 100%; height: 100%; fill: none; stroke: #8b5a2b; stroke-width: 2; opacity: .8; }
.sh-corner.sh-tl { top: 36px; left: 36px; }
.sh-corner.sh-tr { top: 36px; right: 36px; transform: scaleX(-1); }
.sh-corner.sh-bl { bottom: 36px; left: 36px; transform: scaleY(-1); }
.sh-corner.sh-br { bottom: 36px; right: 36px; transform: scale(-1,-1); }

.sh-pages {
  position: absolute; inset: 70px 80px 70px;
  display: grid;
  grid-template-columns: 1.55fr 80px 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 18px 0;
}

.sh-header {
  grid-column: 1 / -1; text-align: center; padding: 0 0 12px;
  border-bottom: 1px solid #8b5a2b; position: relative;
}
.sh-header::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -6px; height: 1px; background: #8b5a2b;
}
.sh-chapter { font-family: 'Italianno', cursive; font-size: 56px; color: #8b5a2b; line-height: 1; }
.sh-chapter::before { content: '~ '; }
.sh-chapter::after  { content: ' ~'; }
.sh-header h1 { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 110px; letter-spacing: .12em; margin: 0; line-height: 1; color: #3d2410; }
.sh-header .sh-sub { font-family: 'Italianno', cursive; font-size: 40px; color: #8b5a2b; }

.sh-schedule {
  grid-column: 1; grid-row: 2;
  padding: 18px 16px;
  display: flex; flex-direction: column; min-height: 0;
}
.sh-schedule h2 { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 50px; margin: 0 0 4px; line-height: 1; text-align: center; }
.sh-schSub { text-align: center; font-family: 'Italianno', cursive; font-size: 36px; color: #8b5a2b; margin-bottom: 10px; }
.sh-rows { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sh-row {
  display: flex; align-items: center; gap: 16px;
  padding: 6px 8px;
  border-bottom: 1px dashed rgba(139,90,43,.4);
  flex: 1 1 0; min-height: 0;
}
.sh-row:last-child { border-bottom: none; }
.sh-num {
  width: 64px; height: 64px; flex: 0 0 64px;
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 38px; color: #faecc6;
  background: #8b5a2b; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 3px #faecc6;
}
.sh-time { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 22px; color: #8b5a2b; width: 170px; flex: 0 0 170px; }
.sh-name { flex: 1; font-family: 'Quattrocento', serif; font-size: 30px; color: #3d2410; line-height: 1.1; }
.sh-room { font-family: 'Italianno', cursive; font-size: 34px; color: #8b5a2b; }
.sh-row.sh-hl { background: rgba(252,211,77,.4); }

.sh-spine { grid-column: 2; grid-row: 2; }

.sh-right-col {
  grid-column: 3; grid-row: 2;
  display: flex; flex-direction: column; gap: 18px;
  padding: 18px 16px; min-height: 0;
}
.sh-attendance {
  flex: 2; padding: 18px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border: 2px double #8b5a2b;
  background: rgba(255,248,225,.5);
  box-shadow: inset 0 0 0 5px #faecc6, inset 0 0 0 6px #8b5a2b;
  position: relative;
}
.sh-lblTop { font-family: 'Italianno', cursive; font-size: 36px; color: #8b5a2b; line-height: 1; }
.sh-pct { display: flex; align-items: baseline; line-height: .85; margin: 4px 0; }
.sh-pct b { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 140px; color: #15803d; line-height: .9; }
.sh-pct sup { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 62px; color: #15803d; }
.sh-lblBot { font-family: 'Quattrocento', serif; font-style: italic; font-size: 20px; color: #5d3a1a; }
.sh-attendance::before, .sh-attendance::after { content: '❦'; position: absolute; color: #8b5a2b; font-size: 26px; }
.sh-attendance::before { top: 18px; left: 24px; }
.sh-attendance::after  { bottom: 18px; right: 24px; }

.sh-miniRow { display: flex; gap: 16px; flex: 1; min-height: 0; }
.sh-clockBig, .sh-weather {
  flex: 1; padding: 12px;
  border: 2px solid #8b5a2b; background: rgba(255,248,225,.5);
  box-shadow: inset 0 0 0 4px #faecc6, inset 0 0 0 5px #8b5a2b;
  text-align: center;
  display: flex; flex-direction: column; justify-content: center;
}
.sh-clockBig .sh-t, .sh-weather .sh-t { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 64px; color: #3d2410; line-height: 1; }
.sh-clockBig .sh-lbl, .sh-weather .sh-desc { font-family: 'Italianno', cursive; font-size: 28px; color: #8b5a2b; }

.sh-footer {
  grid-column: 1 / -1; grid-row: 3;
  display: grid; grid-template-columns: 1fr 320px;
  border-top: 1px solid #8b5a2b; padding-top: 12px; position: relative;
}
.sh-footer::before {
  content: ''; position: absolute; left: 0; right: 0; top: 6px; height: 1px; background: #8b5a2b;
}
.sh-ann {
  padding: 10px 24px;
  border-right: 1px solid #8b5a2b;
  background: linear-gradient(180deg, transparent, rgba(250,236,198,.6));
  position: relative;
}
.sh-ann::before { content: '✶'; position: absolute; top: 14px; left: 4px; color: #8b5a2b; font-size: 22px; }
.sh-annLbl { font-family: 'Italianno', cursive; font-size: 36px; color: #8b5a2b; line-height: 1; padding-left: 30px; }
.sh-annMsg { font-family: 'Cormorant Garamond', serif; font-weight: 500; font-size: 40px; color: #3d2410; line-height: 1.05; padding-left: 30px; margin-top: 4px; }

.sh-ctd { text-align: center; padding: 10px 18px; }
.sh-ctdLbl { font-family: 'Italianno', cursive; font-size: 32px; color: #8b5a2b; line-height: 1; }
.sh-ctdNum { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 78px; line-height: 1; color: #3d2410; }
.sh-ctdUnit { font-family: 'Quattrocento', serif; font-style: italic; font-size: 22px; color: #5d3a1a; }

.sh-pgnum { position: absolute; bottom: 96px; font-family: 'Cormorant Garamond', serif; font-style: italic; color: #8b5a2b; font-size: 22px; }
.sh-pgnum.sh-pgL { left: 100px; }
.sh-pgnum.sh-pgR { right: 100px; }

.sh-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 76px;
  background: #3d2410; color: #faecc6;
  display: flex; align-items: center; overflow: hidden;
  border-top: 4px double #8b5a2b;
  z-index: 6;
}
.sh-stamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #8b5a2b; color: #faecc6; display: flex; align-items: center;
  font-family: 'Cormorant Garamond', serif; font-weight: 700; letter-spacing: .25em; font-size: 18px;
}
.sh-scroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.sh-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Cormorant Garamond', serif; font-size: 38px; font-style: italic;
  color: #faecc6; padding-left: 100%;
  animation: sh-tickerScroll 52s linear infinite;
  will-change: transform;
}
.sh-sep { color: #d4a558; padding: 0 22px; }
@keyframes sh-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(139, 90, 43, .1); box-shadow: inset 0 0 0 3px rgba(139, 90, 43, .55); }
.aw-hotspot:focus-visible { background-color: rgba(139, 90, 43, .18); box-shadow: inset 0 0 0 3px rgba(139, 90, 43, .85); }
`;
