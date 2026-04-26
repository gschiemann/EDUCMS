"use client";

// PORTED 2026-04-20 from scratch/design/animated-bell-schedule.html — transform:scale pattern, isLive-gated hotspots.

import { useEffect, useMemo, useRef, useState } from 'react';

type Period = {
  num?: string | number;
  label?: string;
  room?: string;
  startTime?: string;  // "8:15" or "8:15 AM"
  endTime?: string;
  time?: string;       // optional pre-formatted "8:15 — 9:00"
};

interface Cfg {
  eyebrow?: string;
  title?: string;          // "Period 4" — auto-overridden in live mode
  subtitle?: string;       // "Monday · April 19 · 2026 · REGULAR BELL"
  clockTimeZone?: string;

  periods?: Period[];

  currentBadge?: string;
  currentLabelTemplate?: string; // e.g. "Period {num} · {label}"; defaults to "Period {num} · {label}"

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

export function AnimatedBellScheduleWidget({ config, live }: { config?: Cfg; live?: boolean; tickerSpeed?: 'slow' | 'normal' | 'fast' | number; width?: number; height?: number }) {
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

  // In live mode, recompute NOW every 30s (per spec).
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

  // Determine current / next index
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

  const currentDisplayIdx = isLive ? currentIdx : 3; // default: Period 4 is NOW (mockup)
  const current = currentDisplayIdx >= 0 ? periods[currentDisplayIdx] : null;

  const currentLabelTpl = c.currentLabelTemplate || 'Period {num} · {label}';
  const currentLabel = current
    ? currentLabelTpl
        .replace('{num}', String(current.num ?? currentDisplayIdx + 1))
        .replace('{label}', current.label || '')
    : 'Between Periods';

  const currentRange = current ? periodRange(current).display : '';
  const currentRoom = current?.room || '';

  // Header "title" (big gradient) — in live mode, reflect current period
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

  // Row status classifier
  const rowStatus = (i: number): 'done' | 'now' | 'next' | 'upcoming' => {
    if (i === currentDisplayIdx) return 'now';
    if (isLive) {
      if (i < currentDisplayIdx) return 'done';
      if (i === nextIdx) return 'next';
      return 'upcoming';
    }
    // static mockup semantics: before "now" = done, one after = next, rest = upcoming
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
      <style>{CSS_BS}</style>
      <div
        className="bs-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="bs-header">
          <div className="bs-title">
            <div className="bs-eyebrow" data-field="eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{c.eyebrow || "★ Today's Bell Schedule ★"}</div>
            <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{headerTitle}</h1>
            <div className="bs-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'Monday · April 19 · 2026 · REGULAR BELL'}</div>
          </div>
          <div className="bs-nowClock">
            <div className="bs-nowLbl">Now</div>
            <div className="bs-nowT">{hh}:{mm}</div>
            <div className="bs-nowDate">{dateStr}</div>
          </div>
        </div>

        <div className="bs-currentCard">
          <div className="bs-info">
            <div className="bs-badge" data-field="currentBadge" style={{ whiteSpace: 'pre-wrap' }}>{c.currentBadge || 'LIVE · IN SESSION'}</div>
            <div className="bs-period" style={{ whiteSpace: 'pre-wrap' }}>{currentLabel}</div>
            <div className="bs-when" style={{ whiteSpace: 'pre-wrap' }}>{currentRange}{currentRoom ? ` · ${currentRoom}` : ''}</div>
          </div>
          <div className="bs-timer">
            <div className="bs-until">Bell in</div>
            <div className="bs-bigNum">{bellInFormatted}</div>
            <div className="bs-progress"><div className="bs-progressFill" style={{ width: `${fillPct}%` }} /></div>
          </div>
        </div>

        <div className="bs-timeline">
          <div className="bs-tHeader">Today's Full Schedule</div>
          <div className="bs-rows">
            {periods.map((p, i) => {
              const s = rowStatus(i);
              const cls = s === 'now' ? 'bs-row bs-nowRow' : s === 'done' ? 'bs-row bs-done' : 'bs-row bs-upcoming';
              return (
                <div key={i} className={cls}>
                  <span className="bs-time">{periodRange(p).display}</span>
                  <span className="bs-num">{p.num ?? i + 1}</span>
                  <div className="bs-content">
                    <div className="bs-pname">{p.label || ''}</div>
                    <div className="bs-room">{p.room || ''}</div>
                  </div>
                  <span className="bs-status">{statusLabel(s)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bs-ticker">
          <div className="bs-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.tickerStamp || 'BELL SCHEDULE'}</div>
          <div className="bs-tickerScroll">
            <span
              className="bs-tickerText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 50)}s` }}
            >{tickerText}</span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"     x={36}  y={36}  w={1200} h={210} />
            <Hotspot section="clock"      x={1600} y={36}  w={284}  h={210} />
            <Hotspot section="current"    x={36}  y={260} w={1848} h={200} />
            <Hotspot section="periods"    x={36}  y={510} w={1848} h={420} />
            <Hotspot section="ticker"     x={0}   y={970} w={1920} h={110} />
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

const CSS_BS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Inter:wght@500;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

.bs-stage {
  position: relative;
  font-family: 'Inter', sans-serif; color: #fff;
  background:
    radial-gradient(ellipse at 30% 10%, rgba(99,102,241,.25) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 90%, rgba(236,72,153,.25) 0%, transparent 50%),
    linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%);
  overflow: hidden;
}
.bs-stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .08;
  background:
    linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px) 0 0 / 60px 60px,
    linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px) 0 0 / 60px 60px;
}

.bs-header {
  position: absolute; top: 36px; left: 36px; right: 36px;
  display: flex; align-items: center; justify-content: space-between; z-index: 5;
}
.bs-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 22px;
  color: #a78bfa; letter-spacing: .35em; text-transform: uppercase;
}
.bs-title h1 {
  margin: 0; line-height: .95;
  font-family: 'Anton', sans-serif; font-size: 110px;
  background: linear-gradient(90deg, #fbbf24 0%, #ec4899 50%, #06b6d4 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  letter-spacing: .02em; text-transform: uppercase;
}
.bs-sub { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px; color: #94a3b8; margin-top: -4px; letter-spacing: .05em; }

.bs-nowClock {
  background: rgba(15,23,42,.8);
  border: 3px solid #fbbf24;
  border-radius: 16px;
  padding: 16px 28px; text-align: center;
  box-shadow: 0 0 40px rgba(251,191,36,.3);
  backdrop-filter: blur(6px);
}
.bs-nowLbl { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 13px; color: #fbbf24; letter-spacing: .3em; text-transform: uppercase; }
.bs-nowT { font-family: 'Anton', sans-serif; font-size: 72px; color: #fff; line-height: 1; text-shadow: 0 0 20px rgba(251,191,36,.4); }
.bs-nowDate { font-family: 'JetBrains Mono', monospace; font-size: 15px; color: #94a3b8; letter-spacing: .08em; }

.bs-currentCard {
  position: absolute; top: 260px; left: 36px; right: 36px; height: 200px;
  background: linear-gradient(135deg, #ec4899 0%, #f59e0b 60%, #fbbf24 100%);
  border: 5px solid #fff;
  border-radius: 22px;
  padding: 24px 36px;
  display: flex; align-items: center; gap: 40px;
  box-shadow: 0 20px 40px rgba(236,72,153,.4), 0 0 0 3px rgba(236,72,153,.3);
  z-index: 4;
  animation: bs-currentPulse 2.5s ease-in-out infinite;
}
@keyframes bs-currentPulse {
  0%, 100% { box-shadow: 0 20px 40px rgba(236,72,153,.4), 0 0 0 3px rgba(236,72,153,.3); }
  50%      { box-shadow: 0 20px 50px rgba(236,72,153,.6), 0 0 0 6px rgba(236,72,153,.4); }
}
.bs-badge {
  font-family: 'Bungee', cursive; font-size: 18px; color: #fff;
  background: rgba(0,0,0,.3); padding: 6px 16px; border-radius: 999px;
  letter-spacing: .18em;
  display: inline-flex; align-items: center; gap: 8px;
}
.bs-badge::before {
  content: ''; width: 10px; height: 10px; border-radius: 50%; background: #fff;
  animation: bs-recDot 1.2s ease-in-out infinite;
}
@keyframes bs-recDot { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.bs-info { flex: 1; }
.bs-period {
  font-family: 'Anton', sans-serif; font-size: 72px; color: #fff; line-height: .95;
  text-shadow: 3px 3px 0 rgba(0,0,0,.2);
  letter-spacing: .02em; text-transform: uppercase;
}
.bs-when {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 22px;
  color: #fef3c7; margin-top: 4px; letter-spacing: .08em;
}
.bs-timer { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 260px; }
.bs-bigNum { font-family: 'Anton', sans-serif; font-size: 80px; color: #fff; line-height: 1; text-shadow: 3px 3px 0 rgba(0,0,0,.2); }
.bs-until { font-family: 'Inter', sans-serif; font-weight: 800; font-size: 14px; color: rgba(255,255,255,.9); letter-spacing: .2em; text-transform: uppercase; }
.bs-progress { width: 100%; height: 10px; background: rgba(0,0,0,.25); border-radius: 999px; overflow: hidden; }
.bs-progressFill {
  height: 100%;
  background: linear-gradient(90deg, #fef3c7, #fff);
  border-radius: 999px;
  box-shadow: 0 0 12px rgba(255,255,255,.5);
  animation: bs-progressSheen 2s linear infinite;
}
@keyframes bs-progressSheen { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }

.bs-timeline {
  position: absolute; top: 510px; left: 36px; right: 36px; bottom: 150px;
  display: flex; flex-direction: column; gap: 10px;
  z-index: 3;
}
.bs-tHeader {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px;
  color: #94a3b8; letter-spacing: .3em; text-transform: uppercase;
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 4px;
}
.bs-tHeader::after { content: ''; flex: 1; height: 2px; background: linear-gradient(90deg, rgba(148,163,184,.4) 0%, transparent 100%); }
.bs-rows { flex: 1; display: flex; flex-direction: column; gap: clamp(4px, 1.5%, 10px); min-height: 0; overflow: hidden; }
.bs-row {
  container-type: size;
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: 20px;
  background: rgba(255,255,255,.05);
  border: 2px solid rgba(255,255,255,.1);
  border-radius: 12px;
  padding: clamp(6px, 10cqh, 14px) clamp(16px, 4cqh + 10px, 24px);
  transition: background .2s;
}
.bs-row.bs-done { opacity: .5; }
.bs-row.bs-done .bs-time, .bs-row.bs-done .bs-pname, .bs-row.bs-done .bs-room { text-decoration: line-through; text-decoration-color: rgba(255,255,255,.3); }
.bs-row.bs-upcoming { opacity: .95; }
.bs-row.bs-nowRow {
  background: linear-gradient(90deg, rgba(236,72,153,.25), rgba(251,191,36,.15));
  border-color: #fbbf24; border-width: 3px;
  box-shadow: 0 0 20px rgba(236,72,153,.3);
}
.bs-time {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: clamp(18px, 30cqh, 32px);
  color: #fbbf24; letter-spacing: .04em; min-width: 180px; line-height: 1.1;
}
.bs-num {
  font-family: 'Anton', sans-serif; font-size: clamp(24px, 48cqh, 52px);
  color: rgba(255,255,255,.3); line-height: .85;
  min-width: 50px; text-align: center;
  flex: 0 0 auto;
}
.bs-row.bs-nowRow .bs-num { color: #fbbf24; text-shadow: 0 0 16px rgba(251,191,36,.6); }
.bs-content { flex: 1; min-width: 0; }
.bs-pname {
  font-family: 'Anton', sans-serif; font-size: clamp(20px, 36cqh, 40px);
  color: #fff; line-height: 1.05;
  letter-spacing: .01em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bs-room {
  font-family: 'Inter', sans-serif; font-weight: 600;
  font-size: clamp(12px, 18cqh, 18px);
  color: #94a3b8; margin-top: 2px;
}
.bs-status {
  font-family: 'Inter', sans-serif; font-weight: 800;
  font-size: clamp(10px, 16cqh, 14px);
  padding: 4px 12px; border-radius: 999px;
  letter-spacing: .15em; text-transform: uppercase;
  flex: 0 0 auto;
}
.bs-row.bs-done .bs-status    { background: rgba(148,163,184,.2); color: #94a3b8; }
.bs-row.bs-nowRow .bs-status  { background: #fbbf24; color: #0f172a; animation: bs-statusPulse 1.2s ease-in-out infinite; }
.bs-row.bs-upcoming .bs-status{ background: rgba(99,102,241,.25); color: #a5b4fc; }
@keyframes bs-statusPulse { 0%, 100% { opacity: 1; } 50% { opacity: .75; } }

.bs-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(135deg, #6366f1, #ec4899);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 3px solid #fbbf24;
}
.bs-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #0f172a; color: #fbbf24;
  display: flex; align-items: center; gap: 10px;
  font-family: 'Bungee', cursive; font-size: 28px; letter-spacing: .12em;
}
.bs-tickerStamp::before {
  content: '🔔'; font-size: 28px;
  animation: bs-bellRing 2s ease-in-out infinite;
  transform-origin: 50% 20%;
}
@keyframes bs-bellRing {
  0%, 100% { transform: rotate(0); }
  10%, 30% { transform: rotate(-10deg); }
  20%, 40% { transform: rotate(10deg); }
  60%      { transform: rotate(0); }
}
.bs-tickerScroll { flex: 1; overflow: hidden; }
.bs-tickerText {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 36px;
  color: #fff; white-space: nowrap; padding-left: 100%;
  display: inline-block;
  text-shadow: 2px 2px 0 rgba(0,0,0,.3);
  animation: bs-scroll 50s linear infinite;
}
@keyframes bs-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(236, 72, 153, .08); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55); }
.aw-hotspot:focus-visible { background-color: rgba(236, 72, 153, .14); box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85); }
`;
