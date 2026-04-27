"use client";

/**
 * AnimatedHallwayScheduleP1Widget — REAL portrait companion for the
 * landscape AnimatedHallwayScheduleWidget.
 *
 * Vertical re-flow at 2160x3840 (4K portrait). NOT a landscape jammed
 * into a portrait frame — the layout regions stack purposefully:
 *   • Top band (title + tagline) — wider, calmer, full-width
 *   • Date tag — pinned to top-right (rotated washi-tape)
 *   • Notebook (period schedule) — fills the upper half, period rows
 *     are taller so a hallway-tall display still reads at distance
 *   • Attendance — prominent card row 1 of supporting strip
 *   • Clock + Weather two-up — row 2
 *   • Countdown — row 3 (full-width, hero treatment)
 *   • Announcement — row 4 (still dashed-pink callout)
 *   • Ticker — pinned bottom-full-width
 *
 * Same data-field hotspots as the landscape variant so the
 * THEMED_WIDGET_FIELDS registry editor "just works." Same data flow
 * (live time, current period highlight, countdown days computed from
 * countdownDate), same animation keyframes (re-prefixed `hsp-*` to
 * avoid collision with the landscape's `hs-*`).
 *
 * APPROVED 2026-04-27 — first real portrait variant of an Animated_*
 * widget. Pattern: copy landscape, swap CANVAS_W/H, re-flow regions,
 * re-prefix CSS, preserve every data-field. The rest of the queued
 * portrait conversions follow this exact recipe.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type PeriodRow = { num?: string | number; time?: string; name?: string; room?: string };

interface Cfg {
  title?: string;
  tagline?: string;
  dateTag?: string;
  notebookTitle?: string;
  notebookSub?: string;
  periods?: PeriodRow[];
  nowIndex?: number;
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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

const DEFAULT_PERIODS: PeriodRow[] = [
  { num: 1, time: '8:15 — 9:00',   name: 'Homeroom + Morning Meeting', room: 'Rm 12' },
  { num: 2, time: '9:05 — 9:55',   name: 'Math · Mrs. Chen',           room: 'Rm 14' },
  { num: 3, time: '10:00 — 10:50', name: 'Reading · Mrs. Hill',        room: 'Rm 12' },
  { num: 4, time: '11:00 — 11:45', name: 'Science — STATES OF MATTER!',room: 'Rm 21' },
  { num: 5, time: '11:50 — 12:30', name: 'Lunch + Recess',             room: 'Cafe' },
  { num: 6, time: '12:35 — 1:25',  name: 'Art with Ms. Greene 🎨',     room: 'Rm 9' },
  { num: 7, time: '1:30 — 2:15',   name: 'PE — Field Day prep!',       room: 'Gym' },
];

function parseTimeToMin(t: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(t || '');
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
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

export function AnimatedHallwaySchedulePortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
    return 2;
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
      <style>{CSS_HSP}</style>
      <div
        className="hsp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Decorative washi-tape strips — repositioned for portrait. */}
        <div className="hsp-tape hsp-t1" />
        <div className="hsp-tape hsp-t2" />
        <div className="hsp-tape hsp-t3" />
        <div className="hsp-tape hsp-t4" />

        {/* Top band — full-width title + tagline */}
        <div className="hsp-topBand">
          <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'LEARN · GROW · SHINE'}</h1>
          <div className="hsp-tagline" data-field="tagline" style={{ whiteSpace: 'pre-wrap' }}>{c.tagline || 'every day a new adventure'}</div>
        </div>

        <div className="hsp-tornEdge" />
        <div className="hsp-dateTag" data-field="dateTag" style={{ whiteSpace: 'pre-wrap' }}>{c.dateTag || 'Mon · 4/19'}</div>

        {/* Notebook — fills the upper portion, taller rows for hallway distance read */}
        <div className="hsp-notebook">
          <div className="hsp-holes">
            {Array.from({ length: 9 }).map((_, i) => <span key={i} />)}
          </div>
          <div className="hsp-notebookHeader">
            <h2 data-field="notebookTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.notebookTitle || 'Period by Period'}</h2>
            <div className="hsp-sub" data-field="notebookSub" style={{ whiteSpace: 'pre-wrap' }}>{c.notebookSub || "~ today's schedule ~"}</div>
          </div>
          <div className="hsp-rows">
            {periods.map((p, i) => (
              <div key={i} className={`hsp-row${i === nowIdx ? ' hsp-now' : ''}`}>
                <span className="hsp-num">{p.num ?? i + 1}</span>
                <span className="hsp-time">{p.time || ''}</span>
                <span className="hsp-name">{p.name || ''}</span>
                <span className="hsp-room">{p.room || ''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Supporting cards — vertical strip below notebook */}
        <div className="hsp-supportStrip">
          {/* Attendance — hero card, full-width row */}
          <div className="hsp-card hsp-attendance">
            <div className="hsp-big">{c.attendancePercent ?? '97%'}</div>
            <div className="hsp-aSub">{c.attendanceSub || '~ here today ~'}</div>
          </div>

          {/* Clock + Weather two-up */}
          <div className="hsp-twoUp">
            <div className="hsp-card hsp-clock">
              <div className="hsp-t">{hh}:{mm}</div>
              <div className="hsp-ap">{ampm}</div>
            </div>
            <div className="hsp-card hsp-weather" data-emoji={c.weatherEmoji || '☀️'}>
              <div className="hsp-temp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '42°'}</div>
              <div className="hsp-desc" data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherDesc || 'sunny + crisp'}</div>
            </div>
          </div>

          {/* Countdown — full-width hero */}
          <div className="hsp-card hsp-countdown">
            <div className="hsp-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'Field Day in'}</div>
            <div className="hsp-cdRow">
              <div className="hsp-cdNum" data-field="countdownNumber" style={{ whiteSpace: 'pre-wrap' }}>{days}</div>
              <div className="hsp-unit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownUnit || 'days'}</div>
            </div>
          </div>

          {/* Announcement — pink dashed callout, full-width */}
          <div className="hsp-announce">
            <div className="hsp-badge">{c.announceBadge || 'Announcement'}</div>
            <div className="hsp-msg">{c.announceMsg || 'Assembly in the gym Friday at 2 PM — all classes welcome!'}</div>
          </div>
        </div>

        {/* Ticker — pinned bottom */}
        <div className="hsp-ticker">
          <div className="hsp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.tickerStamp || 'Hallway News'}</div>
          <div className="hsp-tickerScroll">
            <span
              className="hsp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {/* Hotspots — operator clicks land in the right region */}
        {!isLive && (
          <>
            <Hotspot section="header"     x={0}    y={60}   w={2160} h={300} />
            <Hotspot section="dateTag"    x={1860} y={400}  w={260}  h={120} />
            <Hotspot section="periods"    x={60}   y={520}  w={2040} h={1700} />
            <Hotspot section="attendance" x={60}   y={2260} w={2040} h={400} />
            <Hotspot section="clock"      x={60}   y={2700} w={1000} h={360} />
            <Hotspot section="weather"    x={1100} y={2700} w={1000} h={360} />
            <Hotspot section="countdown"  x={60}   y={3100} w={2040} h={360} />
            <Hotspot section="announce"   x={60}   y={3500} w={2040} h={200} />
            <Hotspot section="ticker"     x={0}    y={3700} w={2160} h={140} />
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

const CSS_HSP = `
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Fredoka:wght@500;700&family=Shadows+Into+Light&display=swap');

.hsp-stage {
  position: relative;
  font-family: 'Caveat', cursive; color: #4a2818;
  background:
    radial-gradient(ellipse at 20% 15%, rgba(251,191,36,.10) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 85%, rgba(236,72,153,.08) 0%, transparent 50%),
    linear-gradient(180deg, #fef8e7 0%, #fdf4d4 60%, #fef3c7 100%);
  overflow: hidden;
}
.hsp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .35;
  background:
    repeating-radial-gradient(circle at 10% 20%, transparent 0 2px, rgba(180,83,9,.015) 2px 3px),
    repeating-radial-gradient(circle at 70% 80%, transparent 0 3px, rgba(180,83,9,.015) 3px 4px);
}

/* Washi tape — re-positioned for the tall canvas */
.hsp-tape { position: absolute; pointer-events: none; opacity: .9; z-index: 1; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
.hsp-t1 { top: 60px; left: 240px; width: 240px; height: 56px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 10px, transparent 10px 20px), #fbbf24; transform: rotate(-5deg); }
.hsp-t2 { top: 80px; right: 320px; width: 200px; height: 48px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 10px, transparent 10px 20px), #93c5fd; transform: rotate(4deg); }
.hsp-t3 { top: 480px; left: 120px; width: 180px; height: 44px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 10px, transparent 10px 20px), #86efac; transform: rotate(-3deg); }
.hsp-t4 { top: 480px; right: 130px; width: 180px; height: 42px; background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 10px, transparent 10px 20px), #f9a8d4; transform: rotate(3deg); }

/* Title band — full width, generous breathing room */
.hsp-topBand { position: absolute; top: 100px; left: 0; right: 0; text-align: center; z-index: 3; }
.hsp-topBand h1 {
  margin: 0; line-height: 1;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 220px;
  color: #be185d;
  text-shadow: 8px 8px 0 rgba(251,191,36,.35);
  animation: hsp-titleBob 4s ease-in-out infinite;
  letter-spacing: .02em;
}
@keyframes hsp-titleBob { 0%, 100% { transform: translateY(0) rotate(-.5deg); } 50% { transform: translateY(-8px) rotate(.5deg); } }
.hsp-tagline { font-family: 'Caveat', cursive; font-size: 64px; color: #92400e; margin-top: 12px; }

.hsp-tornEdge {
  position: absolute; top: 460px; left: 0; right: 0; height: 24px; z-index: 2;
  background: #fef8e7;
  clip-path: polygon(0 0, 100% 0, 100% 20%, 97% 80%, 94% 30%, 91% 90%, 88% 40%, 85% 100%, 82% 50%, 79% 90%, 76% 40%, 73% 100%, 70% 50%, 67% 90%, 64% 30%, 61% 100%, 58% 50%, 55% 80%, 52% 30%, 49% 100%, 46% 50%, 43% 90%, 40% 40%, 37% 100%, 34% 50%, 31% 90%, 28% 30%, 25% 100%, 22% 50%, 19% 90%, 16% 30%, 13% 100%, 10% 50%, 7% 90%, 4% 30%, 2% 100%, 0 50%);
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.12));
}

.hsp-dateTag {
  position: absolute; top: 410px; right: 80px; z-index: 4;
  background: linear-gradient(180deg, #fde68a, #fbbf24);
  padding: 16px 36px;
  border: 5px solid #fef8e7;
  box-shadow: 0 8px 18px rgba(0,0,0,.18);
  transform: rotate(6deg);
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 48px; color: #7c2d12;
  letter-spacing: .04em;
}

/* Notebook — fills upper-mid portion, period rows are big */
.hsp-notebook {
  position: absolute; top: 540px; left: 60px; right: 60px; height: 1700px;
  background: #fffdf5;
  border: 2px solid rgba(180,83,9,.18);
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0,0,0,.12), 0 0 0 5px rgba(251,191,36,.22);
  padding: 32px 50px 36px 180px;
  z-index: 3;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.hsp-notebook::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(180deg, transparent 0 90px, rgba(59,130,246,.22) 90px 92px);
  pointer-events: none; opacity: .8;
}
.hsp-notebook::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 154px; width: 4px;
  background: rgba(220,38,38,.35); pointer-events: none;
}
.hsp-holes {
  position: absolute; top: 80px; bottom: 80px; left: 50px; width: 44px;
  display: flex; flex-direction: column; justify-content: space-around;
  align-items: center; z-index: 2;
}
.hsp-holes span {
  display: block; width: 40px; height: 40px; border-radius: 50%;
  background: #fef8e7; box-shadow: inset 0 3px 5px rgba(0,0,0,.2);
}

.hsp-notebookHeader { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 28px; position: relative; z-index: 1; }
.hsp-notebookHeader h2 { margin: 0; font-family: 'Caveat', cursive; font-weight: 700; font-size: 96px; color: #be185d; line-height: 1; padding-right: 18px; }
.hsp-sub { font-family: 'Caveat', cursive; font-size: 44px; color: #92400e; }

.hsp-rows {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.hsp-row {
  flex: 1 1 0; min-height: 0;
  display: grid; grid-template-columns: 80px 320px 1fr 220px;
  align-items: center; gap: 24px;
  font-family: 'Caveat', cursive;
  padding: 8px 16px;
  border-radius: 8px;
  position: relative;
  border-bottom: 1px dashed rgba(180,83,9,.12);
}
.hsp-row:last-child { border-bottom: none; }
.hsp-row.hsp-now {
  background: linear-gradient(90deg, rgba(251,191,36,.32) 0%, rgba(253,224,71,.25) 80%, transparent 100%);
  box-shadow: inset 6px 0 0 #fbbf24;
}
.hsp-num { font-family: 'Caveat', cursive; font-weight: 700; font-size: 80px; color: #be185d; text-align: center; line-height: 1; }
.hsp-time { font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px; color: #92400e; letter-spacing: .02em; }
.hsp-name { font-family: 'Caveat', cursive; font-weight: 700; font-size: 64px; color: #4a2818; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hsp-room { font-family: 'Caveat', cursive; font-weight: 500; font-size: 50px; color: #b45309; text-align: right; }
.hsp-row::before { content: '•'; position: absolute; left: 100px; color: rgba(74,40,24,.6); font-size: 40px; }

/* Supporting strip — vertical stack of cards under the notebook */
.hsp-supportStrip {
  position: absolute; top: 2280px; left: 60px; right: 60px; bottom: 180px;
  display: flex; flex-direction: column; gap: 30px;
  z-index: 3;
}

.hsp-card {
  position: relative;
  background: #fffdf5;
  border-radius: 24px;
  padding: 32px 40px;
  box-shadow: 0 14px 36px rgba(0,0,0,.13), 0 0 0 4px rgba(251,191,36,.22);
  border: 2px solid rgba(180,83,9,.1);
}

.hsp-attendance {
  flex: 0 0 auto; min-height: 360px;
  background: linear-gradient(135deg, #fde68a 0%, #fbbf24 100%);
  border: 5px solid #fef8e7;
  text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 16px 40px rgba(180,83,9,.22), 0 0 0 5px rgba(251,191,36,.4);
}
.hsp-big {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 280px;
  color: #15803d; line-height: .9;
  text-shadow: 6px 6px 0 rgba(255,255,255,.55);
  animation: hsp-numPulse 2.4s ease-in-out infinite;
}
@keyframes hsp-numPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
.hsp-aSub { font-family: 'Caveat', cursive; font-size: 56px; color: #166534; margin-top: 8px; }

/* Two-up: clock + weather */
.hsp-twoUp { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; flex: 0 0 360px; }
.hsp-clock, .hsp-weather {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 30px;
}
.hsp-clock::before {
  content: '⏰'; position: absolute; top: -32px; left: 50%; transform: translateX(-50%);
  font-size: 64px; animation: hsp-clockShake 3s ease-in-out infinite;
}
@keyframes hsp-clockShake {
  0%, 90%, 100% { transform: translateX(-50%) rotate(0); }
  92%, 96%      { transform: translateX(-50%) rotate(-10deg); }
  94%, 98%      { transform: translateX(-50%) rotate(10deg); }
}
.hsp-clock .hsp-t { font-family: 'Caveat', cursive; font-weight: 700; font-size: 130px; color: #be185d; line-height: 1; }
.hsp-clock .hsp-ap { font-family: 'Caveat', cursive; font-size: 50px; color: #92400e; letter-spacing: .18em; margin-top: 4px; }

.hsp-weather::before {
  content: attr(data-emoji); position: absolute; top: -32px; left: 50%; transform: translateX(-50%);
  font-size: 64px; animation: hsp-sunBob 3.6s ease-in-out infinite;
}
@keyframes hsp-sunBob { 0%, 100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-8px); } }
.hsp-temp { font-family: 'Caveat', cursive; font-weight: 700; font-size: 130px; color: #be185d; line-height: 1; }
.hsp-desc { font-family: 'Caveat', cursive; font-size: 50px; color: #92400e; margin-top: 4px; }

/* Countdown — full-width hero */
.hsp-countdown {
  flex: 0 0 360px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 30px 40px;
}
.hsp-countdown::before {
  content: '🎉'; position: absolute; top: -36px; left: 60px;
  font-size: 72px; animation: hsp-confettiBob 2s ease-in-out infinite;
}
@keyframes hsp-confettiBob { 0%, 100% { transform: rotate(-10deg); } 50% { transform: rotate(10deg); } }
.hsp-countdown::after {
  content: ''; position: absolute; top: 24px; left: 0; right: 0; height: 6px;
  background: linear-gradient(90deg, #60a5fa 0%, #ec4899 100%);
}
.hsp-lbl {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 32px;
  color: #92400e; letter-spacing: .25em; text-transform: uppercase;
}
.hsp-cdRow { display: flex; align-items: baseline; gap: 30px; justify-content: center; margin-top: 12px; }
.hsp-cdNum {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 220px;
  color: #be185d; line-height: .9;
  animation: hsp-cdPulse 1.4s ease-in-out infinite;
}
@keyframes hsp-cdPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.hsp-unit { font-family: 'Caveat', cursive; font-size: 80px; color: #92400e; }

/* Announcement — pink dashed callout */
.hsp-announce {
  flex: 0 0 auto;
  background: linear-gradient(180deg, #fef3c7 0%, #fde68a 100%);
  border: 4px dashed #ec4899;
  border-radius: 24px;
  padding: 28px 40px;
  position: relative;
  box-shadow: 0 10px 28px rgba(0,0,0,.1);
}
.hsp-badge {
  display: inline-flex; align-items: center; gap: 14px;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 28px;
  color: #dc2626; letter-spacing: .2em; text-transform: uppercase;
}
.hsp-badge::before { content: '📣'; font-size: 40px; }
.hsp-msg { font-family: 'Caveat', cursive; font-weight: 700; font-size: 64px; color: #4a2818; line-height: 1.1; margin-top: 14px; }

/* Ticker — pinned bottom */
.hsp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 140px;
  background: linear-gradient(90deg, #dbeafe 0%, #fef3c7 100%);
  display: flex; align-items: center; overflow: hidden;
  border-top: 5px dashed #ec4899;
  z-index: 6;
}
.hsp-tickerStamp {
  flex: 0 0 auto; padding: 0 50px; height: 100%;
  background: linear-gradient(135deg, #fde68a, #fbbf24);
  display: flex; align-items: center;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 56px; color: #7c2d12;
  letter-spacing: .05em;
  border-right: 5px dashed #ec4899;
}
.hsp-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.hsp-tickerText {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 72px;
  color: #4a2818; white-space: nowrap;
  display: inline-block; padding-left: 100%;
  will-change: transform;
  animation: hsp-tickerScroll 60s linear infinite;
}
@keyframes hsp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 4px rgba(236, 72, 153, .85); }
`;
