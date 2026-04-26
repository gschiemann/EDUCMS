"use client";

// PORTED 2026-04-20 from scratch/design/scrapbook-hallway.html — transform:scale pattern, isLive-gated hotspots.
// Scrapbook theme: polaroids, washi tape, handwritten fonts (Caveat, Patrick Hand, Shadows Into Light, Kalam).
// Ticker is pinned position:absolute bottom:0 inside the stage — preserve.

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

const CANVAS_W = 1920;
const CANVAS_H = 1080;

export function ScrapbookHallwayWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { num: 1, time: '8:15 — 9:00', name: 'Homeroom + Morning Meeting', room: 'Rm 12' },
      { num: 2, time: '9:05 — 9:55', name: 'Math · Mrs. Chen', room: 'Rm 14' },
      { num: 3, time: '10:00 — 10:50', name: 'Reading · Mrs. Hill', room: 'Rm 12', highlight: true },
      { num: 4, time: '11:00 — 11:45', name: 'Science — STATES OF MATTER!', room: 'Rm 21' },
      { num: 5, time: '11:50 — 12:30', name: 'Lunch + Recess', room: 'Cafe' },
      { num: 6, time: '12:35 — 1:25', name: 'Art with Ms. Greene 🎨', room: 'Rm 9' },
      { num: 7, time: '1:30 — 2:15', name: 'PE — Field Day prep!', room: 'Gym' },
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
  const unit = typeof days === 'number' && days === 1 ? 'day' : (c.countdownUnit || 'days');

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('   ·   ');
    return "Walk, don't run in the halls 🚶   ·   Reading Challenge: 20 minutes a day   ·   Wear school colors on Spirit Friday! 🎉";
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_SBH}</style>

      <div
        className="sbh-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="sbh-banner">
          <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'LEARN · GROW · SHINE'}</h1>
          <div className="sbh-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'every day a new adventure'}</div>
        </div>

        <div className="sbh-schedule">
          <div className="sbh-pageLbl" data-field="schedulePageLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.schedulePageLabel || "~ Today's Schedule ~"}</div>
          <h2 data-field="scheduleTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleTitle || 'Period by Period'}</h2>
          <div className="sbh-rows">
            {rows.slice(0, 8).map((r, i) => (
              <div key={i} className={`sbh-row${r.highlight ? ' sbh-hl' : ''}`}>
                <div className="sbh-num">{r.num ?? ''}</div>
                <div className="sbh-time">{r.time || ''}</div>
                <div className="sbh-name">{r.name || ''}</div>
                <div className="sbh-room">{r.room || ''}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="sbh-rightStack">
          <div className="sbh-attendance">
            <div className="sbh-day">{c.attendanceDay || 'Mon · 4/19'}</div>
            <div className="sbh-pct"><b>{c.attendancePct ?? 97}</b><sup>%</sup></div>
            <div className="sbh-attLbl" data-field="attendanceLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceLabel || '~ here today ~'}</div>
          </div>
          <div className="sbh-miniRow">
            <div className="sbh-clock"><div className="sbh-t">{hh}:{mm}</div><div className="sbh-ap">{ampm}</div></div>
            <div className="sbh-weather"><div className="sbh-t" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '42°'}</div><div className="sbh-desc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherDesc || 'sunny + crisp'}</div></div>
          </div>
        </div>

        <div className="sbh-ann">
          <div className="sbh-annLbl" data-field="annLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.annLabel || 'Announcement'}</div>
          <div className="sbh-annMsg" data-field="annMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.annMsg || 'Assembly in the gym Friday at 2 PM — all classes welcome!'}</div>
        </div>
        <div className="sbh-ctd">
          <div className="sbh-ctdLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Field Day in'}</div>
          <div className="sbh-ctdNum">{days}</div>
          <div className="sbh-ctdUnit">{unit}</div>
        </div>

        <div className="sbh-ticker">
          <div className="sbh-stamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'HALLWAY NEWS').toUpperCase()}</div>
          <div className="sbh-scroll">
            <span
              className="sbh-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 45)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={48}  y={32}   w={1824} h={150} />
            <Hotspot section="schedule"   x={48}  y={210}  w={1120} h={620} />
            <Hotspot section="attendance" x={1200} y={210} w={672}  h={360} />
            <Hotspot section="clock"      x={1200} y={600} w={330}  h={230} />
            <Hotspot section="weather"    x={1542} y={600} w={330}  h={230} />
            <Hotspot section="announcement" x={48}  y={856} w={1120} h={140} />
            <Hotspot section="countdown"  x={1200} y={856} w={672}  h={140} />
            <Hotspot section="ticker"     x={0}    y={1000} w={1920} h={80} />
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

const CSS_SBH = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Patrick+Hand&family=Shadows+Into+Light&family=Kalam:wght@400;700&display=swap');

.sbh-stage {
  position: relative;
  background:
    radial-gradient(ellipse at 80% 10%, rgba(125,211,252,.12), transparent 55%),
    radial-gradient(ellipse at 10% 90%, rgba(244,114,182,.1), transparent 55%),
    repeating-linear-gradient(45deg, transparent 0 6px, rgba(120,53,15,.012) 6px 7px),
    #fbf3df;
  font-family: 'Patrick Hand', cursive;
  color: #3a2614;
  overflow: hidden;
  padding: 32px 48px 12px;
}

.sbh-banner {
  position: absolute; left: 48px; right: 48px; top: 32px; height: 150px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(0,0,0,.18);
  transform: rotate(-.4deg);
  text-align: center;
  padding: 18px 40px 14px;
  clip-path: polygon(0 0,100% 0,100% 92%,98% 100%,95% 91%,92% 100%,89% 92%,86% 100%,82% 91%,79% 100%,75% 92%,71% 100%,67% 91%,63% 100%,59% 92%,55% 100%,51% 91%,47% 100%,43% 91%,39% 100%,35% 92%,31% 100%,27% 91%,23% 100%,19% 92%,15% 100%,11% 91%,7% 100%,3% 92%,0 100%);
}
.sbh-banner h1 { font-family: 'Caveat', cursive; font-weight: 700; font-size: 96px; margin: 0; line-height: 1; color: #be185d; letter-spacing: -0.02em; }
.sbh-banner .sbh-sub { font-family: 'Shadows Into Light', cursive; font-size: 30px; color: #92400e; margin-top: 4px; }
.sbh-banner::before, .sbh-banner::after {
  content: ''; position: absolute; top: -14px; height: 30px; width: 130px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 6px, transparent 6px 12px), #fcd34d;
  box-shadow: 0 1px 3px rgba(0,0,0,.12); z-index: 2;
}
.sbh-banner::before { left: 60px; transform: rotate(-12deg); }
.sbh-banner::after  { right: 80px; transform: rotate(15deg); background-color: #93c5fd; }

.sbh-schedule {
  position: absolute; left: 48px; top: 210px; width: 1120px; height: 620px;
  background: #fffdf6;
  background-image:
    linear-gradient(to right, transparent 96px, rgba(244,63,94,.4) 96px 99px, transparent 99px),
    repeating-linear-gradient(to bottom, transparent 0 64px, rgba(99,102,241,.2) 64px 65px);
  box-shadow: 0 10px 26px rgba(0,0,0,.18);
  transform: rotate(-.6deg);
  padding: 24px 36px 24px 116px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.sbh-schedule::before {
  content: ''; position: absolute; left: 30px; top: 0; bottom: 0; width: 18px;
  background: radial-gradient(circle, #92400e 0 5px, transparent 6px) 0 24px / 18px 64px;
}
.sbh-pageLbl {
  position: absolute; top: 16px; right: 36px;
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 18px; letter-spacing: .15em; color: #92400e; text-transform: uppercase;
}
.sbh-schedule h2 {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 64px;
  color: #be185d; margin: 0 0 10px; line-height: 1;
}
.sbh-rows { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.sbh-row {
  display: flex; align-items: center; gap: 18px;
  padding: 10px 0;
  flex: 1 1 0;
  min-height: 0;
}
.sbh-num {
  width: 56px; flex: 0 0 56px;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 44px; color: #f472b6; line-height: 1; text-align: center;
}
.sbh-time {
  width: 220px; flex: 0 0 220px;
  font-family: 'Kalam', cursive; font-weight: 700; font-size: 22px; color: #92400e;
}
.sbh-name { flex: 1; font-family: 'Patrick Hand', cursive; font-size: 34px; color: #3a2614; line-height: 1.05; }
.sbh-room { font-family: 'Shadows Into Light', cursive; font-size: 28px; color: #be185d; padding-right: 8px; }
.sbh-row.sbh-hl {
  background: rgba(252,211,77,.5);
  margin: 0 -36px 0 -116px;
  padding: 10px 36px 10px 116px;
}

.sbh-rightStack {
  position: absolute; left: 1200px; top: 210px; width: 672px; height: 620px;
  display: flex; flex-direction: column; gap: 22px;
}
.sbh-attendance {
  background: #fff; padding: 18px 18px 60px;
  box-shadow: 0 10px 24px rgba(0,0,0,.2);
  transform: rotate(2.5deg);
  position: relative;
  display: flex; flex-direction: column;
  flex: 2;
}
.sbh-attendance::before {
  content: ''; position: absolute; top: -16px; left: 50%; transform: translateX(-50%) rotate(-3deg);
  width: 160px; height: 32px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 6px, transparent 6px 12px), #86efac;
  box-shadow: 0 1px 3px rgba(0,0,0,.12);
}
.sbh-pct {
  background: linear-gradient(180deg, #fef3c7, #fde68a);
  border: 5px solid #fcd34d;
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.sbh-pct b { font-family: 'Caveat', cursive; font-weight: 700; font-size: 200px; color: #15803d; line-height: 1; }
.sbh-pct sup { font-family: 'Caveat', cursive; font-size: 90px; color: #15803d; }
.sbh-attLbl {
  position: absolute; left: 0; right: 0; bottom: 14px; text-align: center;
  font-family: 'Caveat', cursive; font-size: 42px; color: #92400e;
}
.sbh-day {
  position: absolute; top: -28px; right: -14px; transform: rotate(8deg);
  background: #fcd34d; padding: 4px 16px; font-family: 'Kalam', cursive; font-weight: 700; font-size: 18px; color: #78350f;
  box-shadow: 0 2px 4px rgba(0,0,0,.18); z-index: 1;
}

.sbh-miniRow { display: flex; gap: 14px; flex: 1; }
.sbh-clock, .sbh-weather {
  flex: 1; background: #fff; padding: 16px 12px;
  box-shadow: 0 6px 14px rgba(0,0,0,.18);
  text-align: center; position: relative;
  display: flex; flex-direction: column; justify-content: center;
}
.sbh-clock { transform: rotate(-3deg); border-top: 8px solid #93c5fd; }
.sbh-weather { transform: rotate(2deg); border-top: 8px solid #fcd34d; }
.sbh-clock::before { content: '⏰'; position: absolute; top: -28px; left: 12px; font-size: 36px; }
.sbh-weather::before { content: '☀️'; position: absolute; top: -28px; right: 12px; font-size: 36px; }
.sbh-clock .sbh-t, .sbh-weather .sbh-t { font-family: 'Caveat', cursive; font-weight: 700; font-size: 80px; color: #be185d; line-height: 1; }
.sbh-clock .sbh-ap, .sbh-weather .sbh-desc { font-family: 'Patrick Hand', cursive; font-size: 26px; color: #92400e; }

.sbh-ann {
  position: absolute; left: 48px; top: 856px; width: 1120px; height: 140px;
  background: #fef3c7; padding: 18px 32px; transform: rotate(-1deg);
  border: 3px dashed #d97706;
  box-shadow: 0 6px 14px rgba(0,0,0,.12);
  display: flex; flex-direction: column; justify-content: center;
}
.sbh-ann::before { content: '📣'; position: absolute; top: -22px; left: 16px; font-size: 40px; }
.sbh-annLbl { font-family: 'Kalam', cursive; font-weight: 700; font-size: 18px; letter-spacing: .15em; color: #92400e; text-transform: uppercase; }
.sbh-annMsg { font-family: 'Caveat', cursive; font-size: 56px; color: #78350f; line-height: 1.05; margin-top: 4px; }

.sbh-ctd {
  position: absolute; left: 1200px; top: 856px; width: 672px; height: 140px;
  background: #fff; padding: 16px 18px; transform: rotate(2deg);
  box-shadow: 0 6px 14px rgba(0,0,0,.18);
  text-align: center; border-top: 8px solid #f472b6;
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 20px;
}
.sbh-ctd::before { content: '🎉'; position: absolute; top: -28px; left: 18px; font-size: 36px; }
.sbh-ctdLbl { font-family: 'Kalam', cursive; font-weight: 700; font-size: 20px; color: #831843; letter-spacing: .12em; text-transform: uppercase; }
.sbh-ctdNum { font-family: 'Caveat', cursive; font-weight: 700; font-size: 88px; line-height: 1; color: #be185d; }
.sbh-ctdUnit { font-family: 'Patrick Hand', cursive; font-size: 28px; color: #92400e; }

.sbh-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 80px;
  background: #fff; border-top: 5px double #f9a8d4;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -4px 12px rgba(0,0,0,.08);
  z-index: 6;
}
.sbh-stamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #93c5fd; color: #1e3a8a; display: flex; align-items: center;
  font-family: 'Kalam', cursive; font-weight: 700; letter-spacing: .15em; font-size: 20px;
  border-right: 2px dashed #fff;
}
.sbh-scroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.sbh-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Caveat', cursive; font-size: 40px; color: #92400e;
  padding-left: 100%;
  animation: sbh-tickerScroll 45s linear infinite;
  will-change: transform;
}
@keyframes sbh-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
