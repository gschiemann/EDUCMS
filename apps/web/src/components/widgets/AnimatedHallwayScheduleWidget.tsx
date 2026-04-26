"use client";

// PORTED 2026-04-20 from scratch/design/animated-hallway-schedule.html — transform:scale pattern, isLive-gated hotspots.

import { useEffect, useMemo, useRef, useState } from 'react';

type PeriodRow = { num?: string | number; time?: string; name?: string; room?: string };

interface Cfg {
  title?: string;
  tagline?: string;
  dateTag?: string;

  notebookTitle?: string;
  notebookSub?: string;
  periods?: PeriodRow[];
  nowIndex?: number; // 0-based; if omitted uses middle in non-live

  announceBadge?: string;
  announceMsg?: string;

  attendancePercent?: string | number;
  attendanceSub?: string;

  clockTimeZone?: string;

  weatherEmoji?: string;
  weatherTemp?: string;
  weatherDesc?: string;

  countdownLabel?: string;
  countdownNumber?: string | number;
  countdownDate?: string;
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

const DEFAULT_PERIODS: PeriodRow[] = [
  { num: 1, time: '8:15 — 9:00',   name: 'Homeroom + Morning Meeting', room: 'Rm 12' },
  { num: 2, time: '9:05 — 9:55',   name: 'Math · Mrs. Chen',           room: 'Rm 14' },
  { num: 3, time: '10:00 — 10:50', name: 'Reading · Mrs. Hill',        room: 'Rm 12' },
  { num: 4, time: '11:00 — 11:45', name: 'Science — STATES OF MATTER!',room: 'Rm 21' },
  { num: 5, time: '11:50 — 12:30', name: 'Lunch + Recess',             room: 'Cafe' },
  { num: 6, time: '12:35 — 1:25',  name: 'Art with Ms. Greene 🎨',     room: 'Rm 9' },
  { num: 7, time: '1:30 — 2:15',   name: 'PE — Field Day prep!',       room: 'Gym' },
];

// Parse "8:15" / "8:15 AM" into minutes since midnight. Accepts bare "H:MM".
function parseTimeToMin(t: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(t || '');
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  // If no am/pm and looks small (1..7), assume afternoon/school hours
  if (!ap && h >= 1 && h <= 7) h += 12;
  return h * 60 + mm;
}

function pickCurrentIndex(periods: PeriodRow[], now: Date): number {
  const cur = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < periods.length; i++) {
    const range = (periods[i].time || '').split('—');
    const start = parseTimeToMin(range[0] || '');
    const end = parseTimeToMin(range[1] || '');
    if (start != null && end != null && cur >= start && cur < end) return i;
  }
  return -1;
}

export function AnimatedHallwayScheduleWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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

  const periods: PeriodRow[] = useMemo(() => {
    if (Array.isArray(c.periods) && c.periods.length > 0) return c.periods;
    return DEFAULT_PERIODS;
  }, [c.periods]);

  const nowIdx = useMemo(() => {
    if (typeof c.nowIndex === 'number') return c.nowIndex;
    if (isLive) {
      const idx = pickCurrentIndex(periods, now);
      if (idx >= 0) return idx;
    }
    return 2; // default from mockup
  }, [c.nowIndex, isLive, periods, now]);

  const days = useMemo(() => {
    if (c.countdownDate) {
      const target = new Date(c.countdownDate + 'T00:00:00');
      const start = new Date(); start.setHours(0, 0, 0, 0);
      return Math.max(0, Math.ceil((target.getTime() - start.getTime()) / 86_400_000));
    }
    return c.countdownNumber ?? 8;
  }, [c.countdownDate, c.countdownNumber]);

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ·  ');
    return "Walk, don't run in the halls 🚶  ·  Reading Challenge: 20 minutes a day  ·  Wear school colors on Spirit Friday! 🎉  ·  Field Day in 8 days — sign up at the office";
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fef8e7',
      }}
    >
      <style>{CSS_HS}</style>
      <div
        className="hs-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="hs-tape hs-t1" />
        <div className="hs-tape hs-t2" />
        <div className="hs-tape hs-t3" />
        <div className="hs-tape hs-t4" />
        <div className="hs-tape hs-t5" />

        <div className="hs-topBand">
          <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{(c.title || 'LEARN · GROW · SHINE')}</h1>
          <div className="hs-tagline" data-field="tagline" style={{ whiteSpace: 'pre-wrap' }}>{c.tagline || 'every day a new adventure'}</div>
        </div>

        <div className="hs-tornEdge" />
        <div className="hs-dateTag" data-field="dateTag" style={{ whiteSpace: 'pre-wrap' }}>{c.dateTag || 'Mon · 4/19'}</div>

        <div className="hs-body">
          <div className="hs-leftCol">
            <div className="hs-notebook">
              <div className="hs-holes">
                {Array.from({ length: 7 }).map((_, i) => <span key={i} />)}
              </div>
              <div className="hs-notebookHeader">
                <h2 data-field="notebookTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.notebookTitle || 'Period by Period'}</h2>
                <div className="hs-sub" data-field="notebookSub" style={{ whiteSpace: 'pre-wrap' }}>{c.notebookSub || "~ today's schedule ~"}</div>
              </div>
              <div className="hs-rows">
                {periods.map((p, i) => (
                  <div key={i} className={`hs-row${i === nowIdx ? ' hs-now' : ''}`}>
                    <span className="hs-num">{p.num ?? i + 1}</span>
                    <span className="hs-time">{p.time || ''}</span>
                    <span className="hs-name">{p.name || ''}</span>
                    <span className="hs-room">{p.room || ''}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hs-announce">
              <div className="hs-badge">{c.announceBadge || 'Announcement'}</div>
              <div className="hs-msg">{c.announceMsg || 'Assembly in the gym Friday at 2 PM — all classes welcome!'}</div>
            </div>
          </div>

          <div className="hs-rightCol">
            <div className="hs-card hs-attendance">
              <div className="hs-big">{c.attendancePercent ?? '97%'}</div>
              <div className="hs-aSub">{c.attendanceSub || '~ here today ~'}</div>
            </div>

            <div className="hs-twoUp">
              <div className="hs-card hs-clock">
                <div className="hs-t">{hh}:{mm}</div>
                <div className="hs-ap">{ampm}</div>
              </div>
              <div className="hs-card hs-weather" data-emoji={c.weatherEmoji || '☀️'}>
                <div className="hs-temp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '42°'}</div>
                <div className="hs-desc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherDesc || 'sunny + crisp'}</div>
              </div>
            </div>

            <div className="hs-card hs-countdown">
              <div className="hs-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Field Day in'}</div>
              <div className="hs-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
              <div className="hs-unit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{(c.countdownUnit || 'days')}</div>
            </div>
          </div>
        </div>

        <div className="hs-ticker">
          <div className="hs-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.tickerStamp || 'Hallway News'}</div>
          <div className="hs-tickerScroll">
            <span
              className="hs-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 52)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={0}    y={40}   w={1920} h={180} />
            <Hotspot section="dateTag"    x={1680} y={220}  w={200}  h={60} />
            <Hotspot section="periods"    x={40}   y={260}  w={1420} h={560} />
            <Hotspot section="announce"   x={40}   y={830}  w={1420} h={110} />
            <Hotspot section="attendance" x={1500} y={260}  w={380}  h={300} />
            <Hotspot section="clock"      x={1500} y={570}  w={180}  h={160} />
            <Hotspot section="weather"    x={1700} y={570}  w={180}  h={160} />
            <Hotspot section="countdown"  x={1500} y={740}  w={380}  h={200} />
            <Hotspot section="ticker"     x={0}    y={980}  w={1920} h={100} />
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

const CSS_HS = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Fredoka:wght@500;700&family=Shadows+Into+Light&display=swap');

.hs-stage {
  position: relative;
  font-family: 'Caveat', cursive; color: #4a2818;
  background:
    radial-gradient(ellipse at 20% 30%, rgba(251,191,36,.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(236,72,153,.06) 0%, transparent 50%),
    linear-gradient(180deg, #fef8e7 0%, #fdf4d4 60%, #fef3c7 100%);
  overflow: hidden;
}
.hs-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .35;
  background:
    repeating-radial-gradient(circle at 10% 20%, transparent 0 2px, rgba(180,83,9,.015) 2px 3px),
    repeating-radial-gradient(circle at 70% 80%, transparent 0 3px, rgba(180,83,9,.015) 3px 4px);
}

.hs-tape { position: absolute; pointer-events: none; opacity: .9; z-index: 1; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
.hs-t1 { top: 28px; left: 180px; width: 140px; height: 32px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #fbbf24; transform: rotate(-5deg); }
.hs-t2 { top: 40px; right: 240px; width: 120px; height: 28px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #93c5fd; transform: rotate(4deg); }
.hs-t3 { top: 234px; right: 94px; width: 100px; height: 26px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #86efac; transform: rotate(-2deg); }
.hs-t4 { top: 634px; right: 280px; width: 100px; height: 24px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #93c5fd; transform: rotate(3deg); }
.hs-t5 { top: 254px; left: 100px; width: 100px; height: 24px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #93c5fd; transform: rotate(-3deg); }

.hs-topBand { position: absolute; top: 40px; left: 0; right: 0; text-align: center; z-index: 3; }
.hs-topBand h1 {
  margin: 0; line-height: 1;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 128px;
  color: #be185d;
  text-shadow: 4px 4px 0 rgba(251,191,36,.3);
  animation: hs-titleBob 4s ease-in-out infinite;
  letter-spacing: .02em;
}
@keyframes hs-titleBob { 0%, 100% { transform: translateY(0) rotate(-.5deg); } 50% { transform: translateY(-4px) rotate(.5deg); } }
.hs-tagline { font-family: 'Caveat', cursive; font-size: 36px; color: #92400e; margin-top: -4px; }

.hs-tornEdge {
  position: absolute; top: 220px; left: 0; right: 0; height: 16px; z-index: 2;
  background: #fef8e7;
  clip-path: polygon(0 0, 100% 0, 100% 20%, 97% 80%, 94% 30%, 91% 90%, 88% 40%, 85% 100%, 82% 50%, 79% 90%, 76% 40%, 73% 100%, 70% 50%, 67% 90%, 64% 30%, 61% 100%, 58% 50%, 55% 80%, 52% 30%, 49% 100%, 46% 50%, 43% 90%, 40% 40%, 37% 100%, 34% 50%, 31% 90%, 28% 30%, 25% 100%, 22% 50%, 19% 90%, 16% 30%, 13% 100%, 10% 50%, 7% 90%, 4% 30%, 2% 100%, 0 50%);
  filter: drop-shadow(0 3px 4px rgba(0,0,0,.1));
}

.hs-dateTag {
  position: absolute; top: 220px; right: 40px; z-index: 4;
  background: linear-gradient(180deg, #fde68a, #fbbf24);
  padding: 8px 22px;
  border: 3px solid #fef8e7;
  box-shadow: 0 4px 10px rgba(0,0,0,.15);
  transform: rotate(6deg);
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 22px; color: #7c2d12;
  letter-spacing: .04em;
}

.hs-body {
  position: absolute; top: 260px; left: 40px; right: 40px; bottom: 140px;
  display: grid; grid-template-columns: 1fr 420px; gap: 32px;
  z-index: 3;
}

.hs-leftCol { display: flex; flex-direction: column; gap: 20px; min-height: 0; }

.hs-notebook {
  position: relative; flex: 1;
  background: #fffdf5;
  border: 1px solid rgba(180,83,9,.15);
  border-radius: 4px;
  box-shadow: 0 10px 24px rgba(0,0,0,.1), 0 0 0 3px rgba(251,191,36,.18);
  padding: 20px 28px 24px 96px;
  overflow: hidden;
}
.hs-notebook::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(180deg, transparent 0 50px, rgba(59,130,246,.22) 50px 51px);
  pointer-events: none; opacity: .8;
}
.hs-notebook::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 80px; width: 2px;
  background: rgba(220,38,38,.35); pointer-events: none;
}
.hs-holes {
  position: absolute; top: 50px; bottom: 40px; left: 24px; width: 24px;
  display: flex; flex-direction: column; justify-content: space-around;
  align-items: center; z-index: 2;
}
.hs-holes span {
  display: block; width: 22px; height: 22px; border-radius: 50%;
  background: #fef8e7; box-shadow: inset 0 2px 3px rgba(0,0,0,.2);
}

.hs-notebookHeader { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 10px; position: relative; z-index: 1; }
.hs-notebookHeader h2 { margin: 0; font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px; color: #be185d; line-height: 1; padding-right: 12px; }
.hs-sub { font-family: 'Caveat', cursive; font-size: 22px; color: #92400e; }

.hs-rows {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  container-type: size;
  flex: 1; min-height: 0; overflow: hidden;
}
.hs-row {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: grid; grid-template-columns: 42px 200px 1fr 120px;
  align-items: center; gap: 18px;
  font-family: 'Caveat', cursive;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background .2s;
  position: relative;
}
.hs-row.hs-now {
  background: linear-gradient(90deg, rgba(251,191,36,.3) 0%, rgba(253,224,71,.25) 80%, transparent 100%);
  box-shadow: inset 3px 0 0 #fbbf24;
}
.hs-num { font-family: 'Caveat', cursive; font-weight: 700; font-size: clamp(22px, 42cqh, 36px); color: #be185d; text-align: center; line-height: 1; }
.hs-time { font-family: 'Caveat', cursive; font-weight: 700; font-size: clamp(18px, 32cqh, 30px); color: #92400e; letter-spacing: .02em; }
.hs-name { font-family: 'Caveat', cursive; font-weight: 700; font-size: clamp(20px, 36cqh, 34px); color: #4a2818; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hs-room { font-family: 'Caveat', cursive; font-weight: 500; font-size: clamp(16px, 28cqh, 26px); color: #b45309; text-align: right; }
.hs-row::before { content: '•'; position: absolute; left: 54px; color: rgba(74,40,24,.6); font-size: 22px; }

.hs-announce {
  flex: 0 0 auto;
  background: linear-gradient(180deg, #fef3c7 0%, #fde68a 100%);
  border: 2px dashed #ec4899;
  border-radius: 14px;
  padding: 16px 24px;
  position: relative;
  box-shadow: 0 6px 16px rgba(0,0,0,.1);
}
.hs-badge {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 13px;
  color: #dc2626; letter-spacing: .2em; text-transform: uppercase;
}
.hs-badge::before { content: '📣'; font-size: 20px; }
.hs-msg { font-family: 'Caveat', cursive; font-weight: 700; font-size: 34px; color: #4a2818; line-height: 1.1; margin-top: 6px; }

.hs-rightCol { display: flex; flex-direction: column; gap: 18px; min-height: 0; }
.hs-card {
  position: relative;
  background: #fffdf5;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 8px 20px rgba(0,0,0,.12), 0 0 0 2px rgba(251,191,36,.2);
  border: 1px solid rgba(180,83,9,.1);
}

.hs-attendance {
  flex: 2 1 0;
  background: linear-gradient(135deg, #fde68a 0%, #fbbf24 100%);
  border: 3px solid #fef8e7;
  padding: 20px 24px; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 10px 24px rgba(180,83,9,.2), 0 0 0 3px rgba(251,191,36,.35);
}
.hs-big {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 180px;
  color: #15803d; line-height: .9;
  text-shadow: 4px 4px 0 rgba(255,255,255,.5);
  animation: hs-numPulse 2.4s ease-in-out infinite;
}
@keyframes hs-numPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
.hs-aSub { font-family: 'Caveat', cursive; font-size: 30px; color: #166534; margin-top: -4px; }

.hs-twoUp { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; flex: 1 1 0; }
.hs-clock, .hs-weather {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 14px;
}
.hs-clock::before {
  content: '⏰'; position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  font-size: 28px; animation: hs-clockShake 3s ease-in-out infinite;
}
@keyframes hs-clockShake {
  0%, 90%, 100% { transform: translateX(-50%) rotate(0); }
  92%, 96%      { transform: translateX(-50%) rotate(-10deg); }
  94%, 98%      { transform: translateX(-50%) rotate(10deg); }
}
.hs-clock .hs-t { font-family: 'Caveat', cursive; font-weight: 700; font-size: 52px; color: #be185d; line-height: 1; }
.hs-clock .hs-ap { font-family: 'Caveat', cursive; font-size: 22px; color: #92400e; letter-spacing: .18em; margin-top: 2px; }

.hs-weather::before {
  content: attr(data-emoji); position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  font-size: 28px; animation: hs-sunBob 3.6s ease-in-out infinite;
}
@keyframes hs-sunBob { 0%, 100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-4px); } }
.hs-temp { font-family: 'Caveat', cursive; font-weight: 700; font-size: 52px; color: #be185d; line-height: 1; }
.hs-desc { font-family: 'Caveat', cursive; font-size: 22px; color: #92400e; margin-top: 2px; }

.hs-countdown {
  flex: 1.2 1 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 16px 20px;
}
.hs-countdown::before {
  content: '🎉'; position: absolute; top: -16px; left: 20px;
  font-size: 32px; animation: hs-confettiBob 2s ease-in-out infinite;
}
@keyframes hs-confettiBob { 0%, 100% { transform: rotate(-10deg); } 50% { transform: rotate(10deg); } }
.hs-countdown::after {
  content: ''; position: absolute; top: 12px; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, #60a5fa 0%, #ec4899 100%);
}
.hs-lbl {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 14px;
  color: #92400e; letter-spacing: .25em; text-transform: uppercase;
  margin-top: 6px;
}
.hs-cdNum {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 82px;
  color: #be185d; line-height: .9;
  animation: hs-cdPulse 1.4s ease-in-out infinite;
}
@keyframes hs-cdPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.hs-unit { font-family: 'Caveat', cursive; font-size: 22px; color: #92400e; }

.hs-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 100px;
  background: linear-gradient(90deg, #dbeafe 0%, #fef3c7 100%);
  display: flex; align-items: center; overflow: hidden;
  border-top: 3px dashed #ec4899;
  z-index: 6;
}
.hs-tickerStamp {
  flex: 0 0 auto; padding: 0 30px; height: 100%;
  background: linear-gradient(135deg, #fde68a, #fbbf24);
  display: flex; align-items: center;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 32px; color: #7c2d12;
  letter-spacing: .05em;
  border-right: 3px dashed #ec4899;
}
.hs-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.hs-tickerText {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 42px;
  color: #4a2818; white-space: nowrap;
  display: inline-block; padding-left: 100%;
  will-change: transform;
  animation: hs-tickerScroll 52s linear infinite;
}
@keyframes hs-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
