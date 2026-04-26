"use client";

// PORTED 2026-04-20 from scratch/design/bulletin-hallway.html — transform:scale pattern, isLive-gated hotspots.
// Bulletin theme: cork-board texture, pinned index cards with pushpin shapes, washi tape.
// Ticker pinned position:absolute bottom:14px inside cork frame — preserve.

import { useEffect, useMemo, useRef, useState } from 'react';

type Row = { num?: string | number; time?: string; name?: string; room?: string; highlight?: boolean };

interface Cfg {
  title?: string;
  subtitle?: string;
  scheduleTitle?: string;
  scheduleStamp?: string;
  rows?: Row[];
  attendanceLabel?: string;
  attendancePct?: string | number;
  attendanceDay?: string;
  clockTimeZone?: string;
  clockLabel?: string;
  weatherTemp?: string;
  weatherLabel?: string;
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

export function BulletinHallwayWidget({ config, live }: { config: Cfg; live?: boolean }) {
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
      { num: 1, time: '8:15 — 9:00', name: 'Homeroom + Morning Meeting', room: 'RM 12' },
      { num: 2, time: '9:05 — 9:55', name: 'Math · Mrs. Chen', room: 'RM 14' },
      { num: 3, time: '10:00 — 10:50', name: 'Reading · Mrs. Hill', room: 'RM 12', highlight: true },
      { num: 4, time: '11:00 — 11:45', name: 'Science Lab — STATES OF MATTER', room: 'RM 21' },
      { num: 5, time: '11:50 — 12:30', name: 'Lunch + Recess', room: 'CAFE' },
      { num: 6, time: '12:35 — 1:25', name: 'Art with Ms. Greene', room: 'RM 9' },
      { num: 7, time: '1:30 — 2:15', name: 'PE — Field Day prep', room: 'GYM' },
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

  const tickerSegments = useMemo(() => {
    const list = Array.isArray(c.tickerMessages)
      ? c.tickerMessages
      : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
    if (list.length > 0) return list;
    return [
      "Walk, don't run in the halls",
      'Reading Challenge: 20 minutes a day',
      'Wear school colors on Spirit Friday',
      'Field Day in 8 days — sign up at the office',
      'Lunch Wave A 11:30, Wave B 12:05, Wave C 12:40',
    ];
  }, [c.tickerMessages]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1c0e02',
      }}
    >
      <style>{CSS_BH}</style>

      <div
        className="bh-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="bh-frame" />

        <div className="bh-banner">
          <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'LEARN · GROW · SHINE'}</h1>
          <div className="bh-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ every day a new adventure ~'}</div>
          <div className="bh-pin" style={{ top: -13, left: -13 }} />
          <div className="bh-pin bh-pin-blue" style={{ top: -13, right: -13 }} />
        </div>

        <div className="bh-schedule">
          <div className="bh-stamp" data-field="scheduleStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleStamp || '~ TODAY ~'}</div>
          <h2 data-field="scheduleTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleTitle || "Today's Schedule"}</h2>
          <div className="bh-rows">
            {rows.slice(0, 8).map((r, i) => (
              <div key={i} className={`bh-row${r.highlight ? ' bh-hl' : ''}`}>
                <div className="bh-num">{r.num ?? ''}</div>
                <div className="bh-time">{r.time || ''}</div>
                <div className="bh-name">{r.name || ''}</div>
                <div className="bh-room">{r.room || ''}</div>
              </div>
            ))}
          </div>
          <div className="bh-pin bh-pin-yellow" style={{ top: -13, left: '50%', transform: 'translateX(-50%)' }} />
        </div>

        <div className="bh-right">
          <div className="bh-attendance">
            <div className="bh-attLbl" data-field="attendanceLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceLabel || 'ATTENDANCE TODAY'}</div>
            <div className="bh-pct"><b>{c.attendancePct ?? 97}</b><sup>%</sup></div>
            <div className="bh-day">{c.attendanceDay || 'Mon · April 19'}</div>
            <div className="bh-pin bh-pin-green" style={{ top: -13, right: 18 }} />
          </div>
          <div className="bh-miniRow">
            <div className="bh-clock">
              <div className="bh-t">{hh}:{mm} {ampm}</div>
              <div className="bh-lbl" data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.clockLabel || '~ time check ~'}</div>
              <div className="bh-pin bh-pin-blue" style={{ top: -13, left: '50%', transform: 'translateX(-50%)' }} />
            </div>
            <div className="bh-weather">
              <div className="bh-t">{c.weatherTemp || '42°'}</div>
              <div className="bh-lbl" data-field="weatherLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherLabel || '~ sunny + crisp ~'}</div>
              <div className="bh-pin bh-pin-yellow" style={{ top: -13, left: '50%', transform: 'translateX(-50%)' }} />
            </div>
          </div>
        </div>

        <div className="bh-memo">
          <div className="bh-memoMsg" data-field="annMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.annMsg || 'Assembly in the gym Friday at 2 PM — all classes welcome!'}</div>
          <div className="bh-pin" style={{ top: -13, left: 18 }} />
          <div className="bh-pin bh-pin-yellow" style={{ top: -13, right: 18 }} />
        </div>

        <div className="bh-ticket">
          <div className="bh-ticketLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.countdownLabel || 'FIELD DAY IN').toUpperCase()}</div>
          <div className="bh-ticketNum">{days}</div>
          <div className="bh-ticketUnit">{unit}</div>
          <div className="bh-pin bh-pin-blue" style={{ top: -13, left: '50%', transform: 'translateX(-50%)' }} />
        </div>

        <div className="bh-ticker">
          <div className="bh-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'HALLWAY NEWS').toUpperCase()}</div>
          <div className="bh-tickerScroll">
            <span
              className="bh-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 50)}s` }}
            >
              {tickerSegments.map((seg, i) => (
                <span key={i}>
                  {i > 0 && <span className="bh-sep"> · </span>}
                  {seg}
                </span>
              ))}
            </span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"       x={80}   y={56}   w={1760} h={170} />
            <Hotspot section="schedule"     x={80}   y={254}  w={1120} h={636} />
            <Hotspot section="attendance"   x={1228} y={254}  w={612}  h={410} />
            <Hotspot section="clock"        x={1228} y={692}  w={298}  h={198} />
            <Hotspot section="weather"      x={1542} y={692}  w={298}  h={198} />
            <Hotspot section="announcement" x={80}   y={918}  w={1120} h={66} />
            <Hotspot section="countdown"    x={1228} y={918}  w={612}  h={66} />
            <Hotspot section="ticker"       x={14}   y={1000} w={1892} h={80} />
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

const CSS_BH = `
@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Indie+Flower&family=Special+Elite&family=Kalam:wght@400;700&display=swap');

.bh-stage {
  position: relative;
  background-color: #b88251;
  background-image:
    radial-gradient(circle at 12% 18%, #a56a3e 0 4px, transparent 5px),
    radial-gradient(circle at 27% 41%, #c79268 0 3px, transparent 4px),
    radial-gradient(circle at 56% 12%, #8e5828 0 5px, transparent 6px),
    radial-gradient(circle at 78% 28%, #b07442 0 3px, transparent 4px),
    radial-gradient(circle at 22% 62%, #d6a072 0 4px, transparent 5px),
    radial-gradient(circle at 71% 71%, #8e5828 0 4px, transparent 5px),
    radial-gradient(circle at 41% 88%, #c79268 0 3px, transparent 4px),
    radial-gradient(circle at 86% 92%, #a56a3e 0 5px, transparent 6px),
    repeating-radial-gradient(circle at 50% 50%, #a56a3e 0 1px, transparent 2px 5px),
    linear-gradient(135deg, #c79268 0%, #b07442 50%, #a56a3e 100%);
  color: #2a1808; font-family: 'Indie Flower', cursive;
  overflow: hidden;
  padding: 56px 80px 110px;
}

.bh-frame {
  position: absolute; inset: 14px;
  border: 22px solid;
  border-image: linear-gradient(135deg, #6b3a14 0%, #8b5a2b 30%, #5a3010 70%, #3d2010 100%) 1;
  box-shadow: inset 0 0 0 3px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.4);
  pointer-events: none;
  z-index: 1;
}

.bh-pin {
  position: absolute; width: 26px; height: 26px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #ff8a8a, #c0392b 60%, #5a0e0e);
  box-shadow: 0 4px 5px rgba(0,0,0,.55), inset -2px -2px 3px rgba(0,0,0,.3), inset 2px 2px 3px rgba(255,255,255,.4);
  z-index: 5;
}
.bh-pin-blue   { background: radial-gradient(circle at 30% 30%, #93c5fd, #1d4ed8 60%, #0c1f5a); }
.bh-pin-green  { background: radial-gradient(circle at 30% 30%, #86efac, #15803d 60%, #0c3a1a); }
.bh-pin-yellow { background: radial-gradient(circle at 30% 30%, #fde68a, #d97706 60%, #4a2a08); }

.bh-banner {
  position: absolute; left: 80px; right: 80px; top: 56px; height: 170px;
  background: #fff; padding: 22px 36px;
  box-shadow: 0 8px 22px rgba(0,0,0,.45);
  border-top: 10px solid #b91c1c;
  transform: rotate(-.4deg);
  text-align: center;
  z-index: 2;
}
.bh-banner h1 { font-family: 'Permanent Marker', cursive; font-size: 84px; line-height: 1; margin: 0; color: #1f2937; letter-spacing: .03em; }
.bh-banner .bh-sub { font-family: 'Indie Flower', cursive; font-size: 30px; color: #57534e; margin-top: 8px; }

.bh-schedule {
  position: absolute; left: 80px; top: 254px; width: 1120px; height: 636px;
  background: #fffefa;
  box-shadow: 0 12px 28px rgba(0,0,0,.45);
  transform: rotate(-.4deg);
  padding: 22px 32px;
  background-image:
    linear-gradient(to right, transparent 70px, rgba(220,38,38,.35) 70px 73px, transparent 73px),
    repeating-linear-gradient(to bottom, transparent 0 56px, rgba(59,130,246,.18) 56px 57px);
  background-position: 0 60px;
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 2;
}
.bh-schedule .bh-stamp {
  position: absolute; top: 14px; right: 24px; transform: rotate(8deg);
  font-family: 'Special Elite', serif; font-size: 16px; letter-spacing: .25em; color: #fef3c7;
  background: #b91c1c; padding: 6px 14px; box-shadow: 0 2px 4px rgba(0,0,0,.3); z-index: 1;
}
.bh-schedule h2 {
  font-family: 'Permanent Marker', cursive; font-size: 50px; color: #1f2937; line-height: 1; margin: 0 0 8px;
  border-bottom: 3px double #1f2937; padding-bottom: 10px;
}
.bh-rows { flex: 1; display: flex; flex-direction: column; padding-top: 6px; min-height: 0; }
.bh-row {
  display: flex; align-items: center; gap: 18px; padding: 6px 8px;
  flex: 1 1 0; min-height: 0;
}
.bh-num {
  width: 50px; flex: 0 0 50px;
  font-family: 'Permanent Marker', cursive; font-size: 36px; color: #b91c1c; line-height: 1; text-align: center;
}
.bh-time {
  width: 200px; flex: 0 0 200px;
  font-family: 'Special Elite', serif; font-size: 18px; color: #44403c; letter-spacing: .04em;
}
.bh-name { flex: 1; font-family: 'Indie Flower', cursive; font-size: 32px; color: #1f2937; line-height: 1.1; }
.bh-room {
  font-family: 'Special Elite', serif; font-size: 16px; color: #44403c;
  background: #fef3c7; padding: 4px 10px; border: 1px solid #d97706;
}
.bh-row.bh-hl {
  background: rgba(254,240,138,.65);
  margin: 0 -32px; padding: 6px 32px 6px 40px;
  border-left: 8px solid #b91c1c;
}

.bh-right {
  position: absolute; left: 1228px; top: 254px; width: 612px; height: 636px;
  display: flex; flex-direction: column; gap: 22px;
  z-index: 2;
}
.bh-attendance {
  background: #fef3c7;
  box-shadow: 0 12px 24px rgba(0,0,0,.45);
  transform: rotate(2deg);
  padding: 18px 22px;
  border-top: 14px solid #d97706;
  position: relative;
  flex: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.bh-attendance::after {
  content: ''; position: absolute; top: -14px; left: 0; width: 90px; height: 14px;
  background: #d97706; border-radius: 6px 6px 0 0;
}
.bh-attLbl { font-family: 'Special Elite', serif; font-size: 18px; letter-spacing: .25em; color: #78350f; }
.bh-pct { display: flex; align-items: baseline; }
.bh-pct b { font-family: 'Permanent Marker', cursive; font-size: 200px; color: #15803d; line-height: 1; }
.bh-pct sup { font-family: 'Permanent Marker', cursive; font-size: 90px; color: #15803d; }
.bh-day { font-family: 'Indie Flower', cursive; font-size: 28px; color: #44403c; }

.bh-miniRow { display: flex; gap: 16px; flex: 1; min-height: 0; }
.bh-miniRow > div {
  flex: 1; background: #fff; padding: 16px 12px;
  box-shadow: 0 6px 14px rgba(0,0,0,.35);
  text-align: center;
  position: relative;
  display: flex; flex-direction: column; justify-content: center;
}
.bh-clock { transform: rotate(-2deg); border-top: 8px solid #2563eb; }
.bh-weather { transform: rotate(2deg); border-top: 8px solid #f59e0b; }
.bh-miniRow .bh-t { font-family: 'Permanent Marker', cursive; font-size: 56px; line-height: 1; color: #1f2937; }
.bh-miniRow .bh-lbl { font-family: 'Indie Flower', cursive; font-size: 24px; color: #57534e; }

.bh-memo {
  position: absolute; left: 80px; top: 918px; width: 1120px; height: 66px;
  padding: 22px 32px;
  background: #fef9c3;
  box-shadow: 0 6px 14px rgba(0,0,0,.3);
  transform: rotate(-1.2deg);
  display: flex; flex-direction: column; justify-content: center;
  z-index: 2;
}
.bh-memo::before {
  content: 'ANNOUNCEMENT'; position: absolute; top: 8px; left: 18px;
  font-family: 'Special Elite', serif; font-size: 14px; letter-spacing: .25em; color: #92400e;
}
.bh-memoMsg { font-family: 'Permanent Marker', cursive; font-size: 28px; color: #b91c1c; line-height: 1.05; margin-top: 14px; }

.bh-ticket {
  position: absolute; left: 1228px; top: 918px; width: 612px; height: 66px;
  background: #fff; padding: 10px 22px;
  box-shadow: 0 6px 14px rgba(0,0,0,.3);
  transform: rotate(2deg);
  text-align: center;
  border-left: 8px dashed #2563eb;
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 18px;
  z-index: 2;
}
.bh-ticket::before, .bh-ticket::after {
  content: ''; position: absolute; top: 50%; width: 18px; height: 18px; border-radius: 50%; background: #b88251; transform: translateY(-50%);
}
.bh-ticket::before { left: -9px; }
.bh-ticket::after  { right: -9px; }
.bh-ticketLbl  { font-family: 'Special Elite', serif; font-size: 14px; letter-spacing: .2em; color: #57534e; }
.bh-ticketNum  { font-family: 'Permanent Marker', cursive; font-size: 54px; line-height: 1; color: #2563eb; }
.bh-ticketUnit { font-family: 'Indie Flower', cursive; font-size: 22px; color: #57534e; }

.bh-ticker {
  position: absolute; left: 14px; right: 14px; bottom: 14px; height: 80px;
  background: #fff;
  border-top: 5px solid #1f2937;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -4px 14px rgba(0,0,0,.2);
  z-index: 4;
}
.bh-tickerStamp {
  flex: 0 0 auto; padding: 0 28px; height: 100%;
  background: #1f2937; color: #fef3c7; display: flex; align-items: center;
  font-family: 'Special Elite', serif; letter-spacing: .25em; font-size: 20px;
}
.bh-tickerScroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.bh-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Indie Flower', cursive; font-size: 38px; color: #44403c;
  padding-left: 100%;
  animation: bh-tickerScroll 50s linear infinite;
  will-change: transform;
}
.bh-sep { color: #b91c1c; padding: 0 22px; }
@keyframes bh-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 12px; }
.aw-hotspot:hover { background-color: rgba(185, 28, 28, .1); box-shadow: inset 0 0 0 3px rgba(185, 28, 28, .55); }
.aw-hotspot:focus-visible { background-color: rgba(185, 28, 28, .18); box-shadow: inset 0 0 0 3px rgba(185, 28, 28, .85); }
`;
