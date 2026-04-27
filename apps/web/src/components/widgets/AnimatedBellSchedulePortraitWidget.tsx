"use client";

/**
 * AnimatedBellSchedulePortraitWidget — REAL 4K portrait companion.
 *
 * NOT a landscape jammed into a portrait frame. Vertical re-flow at
 * 2160×3840 with regions stacked for hallway-tall reading distance:
 *   • Header — eyebrow + 220px gradient title centered, NOW clock pinned
 *     directly below (instead of right-side as in landscape).
 *   • Current period card — full-width hero with 200px period name,
 *     time + room sub-line, "Bell in mm:ss" + progress bar.
 *   • Timeline — fills middle, generous row heights so all 8 periods
 *     read at portrait distance with clear NOW / DONE / NEXT badges.
 *   • Ticker — pinned bottom-full-width.
 *
 * Same `data-field` keys as the landscape so the auto-form editor and
 * canvas click-to-edit work identically. Same data flow (live time,
 * bell-in countdown, progress bar). All keyframes re-prefixed `bsp-*`
 * so they don't collide with the landscape `bs-*`.
 *
 * APPROVED 2026-04-27 — second real portrait conversion.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type Period = {
  num?: string | number;
  label?: string;
  room?: string;
  startTime?: string;
  endTime?: string;
  time?: string;
};

interface Cfg {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  clockTimeZone?: string;
  periods?: Period[];
  currentBadge?: string;
  currentLabelTemplate?: string;
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

const DEFAULT_PERIODS: Period[] = [
  { num: 1, label: 'Homeroom',       room: 'Room 101 · Mr. Johnson',     startTime: '8:15',  endTime: '9:00'  },
  { num: 2, label: 'Math',           room: 'Room 118 · Ms. Park',        startTime: '9:05',  endTime: '9:55'  },
  { num: 3, label: 'English',        room: 'Room 205 · Mrs. Chen',       startTime: '10:00', endTime: '10:50' },
  { num: 4, label: 'Science',        room: 'Room 214 · Dr. Rivera',      startTime: '11:15', endTime: '12:00' },
  { num: 5, label: 'Lunch · Wave B', room: 'Cafeteria',                  startTime: '12:05', endTime: '12:45' },
  { num: 6, label: 'History',        room: 'Room 312 · Mr. Patel',       startTime: '12:50', endTime: '1:40'  },
  { num: 7, label: 'Gym / PE',       room: 'Gymnasium · Coach Brooks',   startTime: '1:45',  endTime: '2:35'  },
  { num: 8, label: 'Art',            room: 'Art Studio · Ms. Delacroix', startTime: '2:40',  endTime: '3:25'  },
];

function parseTimeToMin(t: string): number | null {
  if (!t) return null;
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(t);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 7) h += 12;
  return h * 60 + mm;
}

function periodRange(p: Period): { start: number | null; end: number | null; display: string } {
  if (p.startTime && p.endTime) {
    return { start: parseTimeToMin(p.startTime), end: parseTimeToMin(p.endTime), display: `${p.startTime} — ${p.endTime}` };
  }
  if (p.time) {
    const parts = p.time.split('—');
    return { start: parseTimeToMin(parts[0] || ''), end: parseTimeToMin(parts[1] || ''), display: p.time };
  }
  return { start: null, end: null, display: '' };
}

export function AnimatedBellSchedulePortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
    hour: 'numeric', minute: '2-digit', hour12: false,
    ...(tz ? { timeZone: tz } : {}),
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '11';
  const mm = parts.find(p => p.type === 'minute')?.value || '45';
  const datePartsFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  });
  const dateStr = datePartsFmt.format(now).toUpperCase().replace(/,/g, '').replace(/\s+/g, ' · ');

  const periods: Period[] = useMemo(() => {
    if (Array.isArray(c.periods) && c.periods.length > 0) return c.periods;
    return DEFAULT_PERIODS;
  }, [c.periods]);

  const { currentIdx, nextIdx, minutesUntilBell, progressPct } = useMemo(() => {
    const curMin = now.getHours() * 60 + now.getMinutes();
    let cur = -1, nxt = -1;
    for (let i = 0; i < periods.length; i++) {
      const { start, end } = periodRange(periods[i]);
      if (start != null && end != null && curMin >= start && curMin < end) { cur = i; break; }
    }
    for (let i = 0; i < periods.length; i++) {
      const { start } = periodRange(periods[i]);
      if (start != null && start > curMin) { nxt = i; break; }
    }
    let until = 0, pct = 0;
    if (cur >= 0) {
      const { start, end } = periodRange(periods[cur]);
      if (start != null && end != null) {
        until = Math.max(0, end - curMin);
        const total = end - start;
        pct = total > 0 ? Math.min(100, Math.max(0, ((curMin - start) / total) * 100)) : 0;
      }
    }
    return { currentIdx: cur, nextIdx: nxt, minutesUntilBell: until, progressPct: pct };
  }, [periods, now]);

  const currentDisplayIdx = isLive ? currentIdx : 3;
  const current = currentDisplayIdx >= 0 ? periods[currentDisplayIdx] : null;
  const currentLabelTpl = c.currentLabelTemplate || 'Period {num} · {label}';
  const currentLabel = current
    ? currentLabelTpl
        .replace('{num}', String(current.num ?? currentDisplayIdx + 1))
        .replace('{label}', current.label || '')
    : 'Between Periods';

  const currentRange = current ? periodRange(current).display : '';
  const currentRoom = current?.room || '';
  const headerTitle = isLive && current
    ? `Period ${current.num ?? currentDisplayIdx + 1}`
    : (c.title || 'Period 4');

  const bellInFormatted = useMemo(() => {
    if (!isLive || currentIdx < 0) return '15:23';
    const m = Math.floor(minutesUntilBell);
    const s = Math.floor((minutesUntilBell - m) * 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, [isLive, currentIdx, minutesUntilBell]);

  const fillPct = isLive && currentIdx >= 0 ? progressPct : 64;

  const tickerText = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list.join('  ✦  ');
    return 'Wednesday is an assembly day — shortened schedule, lunch at 11:45  ✦  Period 4 runs long today for science lab  ✦  Early dismissal Friday — bell schedule A, out at 1:15  ✦  Check your hallway display for the full weekly bell pattern';
  }, [c.tickerMessages]);

  const rowStatus = (i: number): 'done' | 'now' | 'next' | 'upcoming' => {
    if (i === currentDisplayIdx) return 'now';
    if (isLive) {
      if (i < currentDisplayIdx) return 'done';
      if (i === nextIdx) return 'next';
      return 'upcoming';
    }
    if (i < currentDisplayIdx) return 'done';
    if (i === currentDisplayIdx + 1) return 'next';
    return 'upcoming';
  };
  const statusLabel = (s: 'done' | 'now' | 'next' | 'upcoming') =>
    s === 'done' ? 'Done' : s === 'now' ? 'NOW' : s === 'next' ? 'Next' : 'Upcoming';

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a',
      }}
    >
      <style>{CSS_BSP}</style>
      <div
        className="bsp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Header — title centered, clock pinned below */}
        <div className="bsp-header">
          <div className="bsp-eyebrow" data-field="eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{c.eyebrow || "★ Today's Bell Schedule ★"}</div>
          <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{headerTitle}</h1>
          <div className="bsp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'Monday · April 19 · 2026 · REGULAR BELL'}</div>
        </div>

        <div className="bsp-nowClock">
          <div className="bsp-nowLbl">Now</div>
          <div className="bsp-nowT">{hh}:{mm}</div>
          <div className="bsp-nowDate">{dateStr}</div>
        </div>

        {/* Current period — full-width hero card */}
        <div className="bsp-currentCard">
          <div className="bsp-info">
            <div className="bsp-badge" data-field="currentBadge" style={{ whiteSpace: 'pre-wrap' }}>{c.currentBadge || 'LIVE · IN SESSION'}</div>
            <div className="bsp-period" style={{ whiteSpace: 'pre-wrap' }}>{currentLabel}</div>
            <div className="bsp-when" style={{ whiteSpace: 'pre-wrap' }}>{currentRange}{currentRoom ? ` · ${currentRoom}` : ''}</div>
          </div>
          <div className="bsp-timer">
            <div className="bsp-until">Bell in</div>
            <div className="bsp-bigNum">{bellInFormatted}</div>
            <div className="bsp-progress"><div className="bsp-progressFill" style={{ width: `${fillPct}%` }} /></div>
          </div>
        </div>

        {/* Timeline — full-width, generous rows */}
        <div className="bsp-timeline">
          <div className="bsp-tHeader">Today's Full Schedule</div>
          <div className="bsp-rows">
            {periods.map((p, i) => {
              const s = rowStatus(i);
              const cls = s === 'now' ? 'bsp-row bsp-nowRow' : s === 'done' ? 'bsp-row bsp-done' : 'bsp-row bsp-upcoming';
              return (
                <div key={i} className={cls}>
                  <span className="bsp-time">{periodRange(p).display}</span>
                  <span className="bsp-num">{p.num ?? i + 1}</span>
                  <div className="bsp-content">
                    <div className="bsp-pname">{p.label || ''}</div>
                    <div className="bsp-room">{p.room || ''}</div>
                  </div>
                  <span className="bsp-status">{statusLabel(s)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ticker pinned bottom */}
        <div className="bsp-ticker">
          <div className="bsp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.tickerStamp || 'BELL SCHEDULE'}</div>
          <div className="bsp-tickerScroll">
            <span
              className="bsp-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"  x={60}  y={60}   w={2040} h={500} />
            <Hotspot section="clock"   x={730} y={580}  w={700}  h={300} />
            <Hotspot section="current" x={60}  y={920}  w={2040} h={500} />
            <Hotspot section="periods" x={60}  y={1480} w={2040} h={2160} />
            <Hotspot section="ticker"  x={0}   y={3700} w={2160} h={140} />
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

const CSS_BSP = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Inter:wght@500;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

.bsp-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 30% 8%, rgba(99,102,241,.30) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 92%, rgba(236,72,153,.30) 0%, transparent 50%),
    linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%);
  overflow: hidden;
}
.bsp-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .08;
  background:
    linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px) 0 0 / 100px 100px,
    linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px) 0 0 / 100px 100px;
}

.bsp-header {
  position: absolute; top: 100px; left: 60px; right: 60px;
  text-align: center; z-index: 5;
}
.bsp-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 40px;
  color: #a78bfa; letter-spacing: .35em; text-transform: uppercase;
}
.bsp-header h1 {
  margin: 16px 0 0; line-height: .95;
  font-family: 'Anton', sans-serif; font-size: 220px;
  background: linear-gradient(90deg, #fbbf24 0%, #ec4899 50%, #06b6d4 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em; text-transform: uppercase;
}
.bsp-sub { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 36px; color: #94a3b8; margin-top: 12px; letter-spacing: .05em; }

.bsp-nowClock {
  position: absolute; top: 580px; left: 50%; transform: translateX(-50%);
  background: rgba(15,23,42,.8);
  border: 5px solid #fbbf24;
  border-radius: 24px;
  padding: 28px 60px; text-align: center;
  box-shadow: 0 0 80px rgba(251,191,36,.35);
  backdrop-filter: blur(8px);
  z-index: 5;
}
.bsp-nowLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 26px; color: #fbbf24; letter-spacing: .3em; text-transform: uppercase; }
.bsp-nowT { font-family: 'Anton', sans-serif; font-size: 160px; color: #fff; line-height: 1; text-shadow: 0 0 40px rgba(251,191,36,.45); }
.bsp-nowDate { font-family: 'JetBrains Mono', monospace; font-size: 28px; color: #94a3b8; letter-spacing: .08em; }

.bsp-currentCard {
  position: absolute; top: 940px; left: 60px; right: 60px; height: 480px;
  background: linear-gradient(135deg, #ec4899 0%, #f59e0b 60%, #fbbf24 100%);
  border: 8px solid #fff;
  border-radius: 32px;
  padding: 40px 60px;
  display: flex; align-items: center; gap: 60px;
  box-shadow: 0 30px 60px rgba(236,72,153,.45), 0 0 0 5px rgba(236,72,153,.35);
  z-index: 4;
  animation: bsp-currentPulse 2.5s ease-in-out infinite;
}
@keyframes bsp-currentPulse {
  0%, 100% { box-shadow: 0 30px 60px rgba(236,72,153,.45), 0 0 0 5px rgba(236,72,153,.35); }
  50%      { box-shadow: 0 30px 70px rgba(236,72,153,.65), 0 0 0 10px rgba(236,72,153,.45); }
}
.bsp-badge {
  font-family: 'Bungee', cursive; font-size: 32px; color: #fff;
  background: rgba(0,0,0,.3); padding: 12px 28px; border-radius: 999px;
  letter-spacing: .18em;
  display: inline-flex; align-items: center; gap: 14px;
}
.bsp-badge::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  animation: bsp-recDot 1.2s ease-in-out infinite;
}
@keyframes bsp-recDot { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.bsp-info { flex: 1; }
.bsp-period {
  font-family: 'Anton', sans-serif; font-size: 130px; color: #fff; line-height: .95;
  text-shadow: 5px 5px 0 rgba(0,0,0,.2);
  letter-spacing: .02em; text-transform: uppercase;
  margin-top: 10px;
}
.bsp-when {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 38px;
  color: #fef3c7; margin-top: 10px; letter-spacing: .08em;
}
.bsp-timer { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; min-width: 480px; }
.bsp-bigNum { font-family: 'Anton', sans-serif; font-size: 160px; color: #fff; line-height: 1; text-shadow: 5px 5px 0 rgba(0,0,0,.2); }
.bsp-until { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 26px; color: rgba(255,255,255,.9); letter-spacing: .2em; text-transform: uppercase; }
.bsp-progress { width: 100%; height: 18px; background: rgba(0,0,0,.25); border-radius: 999px; overflow: hidden; }
.bsp-progressFill {
  height: 100%;
  background: linear-gradient(90deg, #fef3c7, #fff);
  border-radius: 999px;
  box-shadow: 0 0 24px rgba(255,255,255,.5);
  animation: bsp-progressSheen 2s linear infinite;
}
@keyframes bsp-progressSheen { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }

.bsp-timeline {
  position: absolute; top: 1500px; left: 60px; right: 60px; bottom: 200px;
  display: flex; flex-direction: column; gap: 18px;
  z-index: 3;
}
.bsp-tHeader {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 28px;
  color: #94a3b8; letter-spacing: .3em; text-transform: uppercase;
  display: flex; align-items: center; gap: 24px;
  margin-bottom: 8px;
}
.bsp-tHeader::after { content: ''; flex: 1; height: 3px; background: linear-gradient(90deg, rgba(148,163,184,.4) 0%, transparent 100%); }

.bsp-rows { flex: 1; display: flex; flex-direction: column; gap: 14px; min-height: 0; overflow: hidden; }
.bsp-row {
  flex: 1 1 0; min-height: 0;
  display: grid; grid-template-columns: 320px 100px 1fr 200px;
  align-items: center; gap: 30px;
  padding: 18px 28px;
  border-radius: 20px;
  background: rgba(255,255,255,.05);
  border: 2px solid rgba(255,255,255,.08);
}
.bsp-nowRow {
  background: linear-gradient(135deg, rgba(236,72,153,.25) 0%, rgba(251,191,36,.15) 100%);
  border-color: rgba(251,191,36,.6);
  box-shadow: 0 0 40px rgba(251,191,36,.3);
}
.bsp-done { opacity: .45; }
.bsp-time {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 38px;
  color: #cbd5e1; letter-spacing: .04em;
}
.bsp-num {
  font-family: 'Anton', sans-serif; font-size: 64px; color: #fbbf24;
  text-align: center; line-height: 1;
}
.bsp-content { min-width: 0; }
.bsp-pname {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 56px;
  color: #fff; line-height: 1; letter-spacing: .02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bsp-room {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  color: #94a3b8; margin-top: 6px;
}
.bsp-status {
  font-family: 'Bungee', cursive; font-size: 28px;
  color: #94a3b8; letter-spacing: .15em;
  text-align: right;
}
.bsp-nowRow .bsp-status {
  color: #fbbf24;
  text-shadow: 0 0 20px rgba(251,191,36,.6);
  animation: bsp-statusPulse 1.4s ease-in-out infinite;
}
@keyframes bsp-statusPulse { 0%, 100% { opacity: 1; } 50% { opacity: .6; } }

.bsp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 200px;
  background: rgba(15,23,42,.92);
  border-top: 5px solid rgba(251,191,36,.5);
  display: flex; align-items: center; overflow: hidden;
  z-index: 6;
}
.bsp-tickerStamp {
  flex: 0 0 auto; padding: 0 60px; height: 100%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  display: flex; align-items: center;
  font-family: 'Bungee', cursive; font-size: 56px; color: #0f172a;
  letter-spacing: .12em;
}
.bsp-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.bsp-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 56px;
  color: #fff; white-space: nowrap;
  display: inline-block; padding-left: 100%;
  will-change: transform;
  animation: bsp-tickerScroll 60s linear infinite;
}
@keyframes bsp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(251, 191, 36, .12); box-shadow: inset 0 0 0 4px rgba(251, 191, 36, .55); }
.aw-hotspot:focus-visible { background-color: rgba(251, 191, 36, .18); box-shadow: inset 0 0 0 4px rgba(251, 191, 36, .85); }
`;
