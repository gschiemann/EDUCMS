"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// BulletinHallwayPortraitWidget — REAL portrait companion for the
// landscape BulletinHallwayWidget. Vertical re-flow at 2160x3840.
//
// Cork-board hallway info board re-imagined for a tall display:
//   • Top ~700px:   pinned banner "HALLWAY" + day pin + clock pin + washi-tape corners
//   • ~1300px:      schedule index cards — 7 period rows, each pinned with TIME · CLASS · ROOM
//   • ~700px:       attendance polaroid hero — pinned tilted card with check mark + percent
//   • ~600px:       2-up — Today's Announcement + Coming Up countdown, both pinned cards
//   • Bottom ~440px: scrolling ticker with "HALLWAY NEWS" pin + scroll
//
// Same Cfg interface as the landscape variant so THEMED_WIDGET_FIELDS
// editor "just works." Same data flow (live time, countdown days from
// countdownDate, ticker speed). CSS prefixed `bhp-*` to avoid collision
// with the landscape's `bh-*`.

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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

export function BulletinHallwayPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
      <style>{CSS_BHP}</style>

      <div
        className="bhp-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Wood frame around the cork-board */}
        <div className="bhp-frame" />

        {/* Top region (~700px): pinned hallway banner + day pin + clock pin */}
        <div className="bhp-banner">
          <h1 data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'HALLWAY'}</h1>
          <div className="bhp-sub" data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || '~ learn · grow · shine ~'}</div>
          <div className="bhp-pin" style={{ top: -22, left: -22 }} />
          <div className="bhp-pin bhp-pin-blue" style={{ top: -22, right: -22 }} />
          {/* Washi tape corners */}
          <div className="bhp-washi bhp-washi-tl" />
          <div className="bhp-washi bhp-washi-tr" />
        </div>

        <div className="bhp-headerRow">
          <div className="bhp-dayPin">
            <div className="bhp-dayLbl">~ TODAY ~</div>
            <div className="bhp-dayVal">{c.attendanceDay || 'Mon · April 19'}</div>
            <div className="bhp-pin bhp-pin-yellow" style={{ top: -20, left: '50%', transform: 'translateX(-50%)' }} />
          </div>
          <div className="bhp-clockPin">
            <div className="bhp-clockTime">{hh}:{mm} {ampm}</div>
            <div className="bhp-clockLbl" data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.clockLabel || '~ time check ~'}</div>
            <div className="bhp-pin bhp-pin-blue" style={{ top: -20, left: '50%', transform: 'translateX(-50%)' }} />
          </div>
          <div className="bhp-weatherPin">
            <div className="bhp-weatherTemp">{c.weatherTemp || '42°'}</div>
            <div className="bhp-weatherLbl" data-field="weatherLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherLabel || '~ sunny + crisp ~'}</div>
            <div className="bhp-pin bhp-pin-green" style={{ top: -20, left: '50%', transform: 'translateX(-50%)' }} />
          </div>
        </div>

        {/* Schedule region (~1300px): pinned index cards stacked */}
        <div className="bhp-scheduleHead">
          <div className="bhp-stamp" data-field="scheduleStamp" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleStamp || '~ TODAY ~'}</div>
          <h2 data-field="scheduleTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleTitle || "Today's Schedule"}</h2>
        </div>
        <div className="bhp-cards">
          {rows.slice(0, 7).map((r, i) => (
            <div key={i} className={`bhp-card${r.highlight ? ' bhp-cardHl' : ''}`} style={{ transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (0.6 + (i % 3) * 0.3)}deg)` }}>
              <div className="bhp-cardNum">{r.num ?? i + 1}</div>
              <div className="bhp-cardBody">
                <div className="bhp-cardTime">{r.time || ''}</div>
                <div className="bhp-cardName">{r.name || ''}</div>
              </div>
              <div className="bhp-cardRoom">{r.room || ''}</div>
              <div
                className={`bhp-pin ${i % 4 === 0 ? '' : i % 4 === 1 ? 'bhp-pin-blue' : i % 4 === 2 ? 'bhp-pin-yellow' : 'bhp-pin-green'}`}
                style={{ top: -18, left: '50%', transform: 'translateX(-50%)' }}
              />
            </div>
          ))}
        </div>

        {/* Attendance polaroid hero (~700px): tilted, oversized */}
        <div className="bhp-attendance">
          <div className="bhp-attLbl" data-field="attendanceLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceLabel || 'ATTENDANCE TODAY'}</div>
          <div className="bhp-attCheck">
            <svg viewBox="0 0 100 100" width="180" height="180" aria-hidden>
              <circle cx="50" cy="50" r="44" fill="none" stroke="#15803d" strokeWidth="6" />
              <path d="M28 52 L44 68 L72 36" fill="none" stroke="#15803d" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="bhp-attPct"><b>{c.attendancePct ?? 97}</b><sup>%</sup></div>
          <div className="bhp-attDay">{c.attendanceDay || 'Mon · April 19'}</div>
          <div className="bhp-pin bhp-pin-green" style={{ top: -22, right: 60 }} />
          <div className="bhp-pin" style={{ top: -22, left: 60 }} />
        </div>

        {/* Two-up region (~600px): announcement + countdown, pinned cards */}
        <div className="bhp-twoUp">
          <div className="bhp-memo">
            <div className="bhp-memoTag">ANNOUNCEMENT</div>
            <div className="bhp-memoMsg" data-field="annMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.annMsg || 'Assembly in the gym Friday at 2 PM — all classes welcome!'}</div>
            <div className="bhp-pin" style={{ top: -20, left: 36 }} />
            <div className="bhp-pin bhp-pin-yellow" style={{ top: -20, right: 36 }} />
          </div>

          <div className="bhp-ticket">
            <div className="bhp-ticketLbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{(c.countdownLabel || 'FIELD DAY IN').toUpperCase()}</div>
            <div className="bhp-ticketRow">
              <div className="bhp-ticketNum">{days}</div>
              <div className="bhp-ticketUnit">{unit}</div>
            </div>
            <div className="bhp-pin bhp-pin-blue" style={{ top: -20, left: '50%', transform: 'translateX(-50%)' }} />
          </div>
        </div>

        {/* Ticker (~440px from bottom): handwritten "HALLWAY NEWS" pin + scroll */}
        <div className="bhp-ticker">
          <div className="bhp-tickerStamp" data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'HALLWAY NEWS').toUpperCase()}</div>
          <div className="bhp-tickerScroll">
            <span
              className="bhp-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 60)}s` }}
            >
              {tickerSegments.map((seg, i) => (
                <span key={i}>
                  {i > 0 && <span className="bhp-sep"> · </span>}
                  {seg}
                </span>
              ))}
            </span>
          </div>
        </div>

        {!isLive && (
          <>
            <Hotspot section="header"       x={120}  y={120}  w={1920} h={500} />
            <Hotspot section="dayClock"     x={120}  y={660}  w={1920} h={300} />
            <Hotspot section="schedule"     x={80}   y={1000} w={2000} h={1280} />
            <Hotspot section="attendance"   x={140}  y={2320} w={1880} h={680} />
            <Hotspot section="announcement" x={80}   y={3030} w={1010} h={530} />
            <Hotspot section="countdown"    x={1110} y={3030} w={970}  h={530} />
            <Hotspot section="ticker"       x={14}   y={3580} w={2132} h={246} />
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

const CSS_BHP = `
@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Indie+Flower&family=Special+Elite&family=Kalam:wght@400;700&display=swap');

.bhp-stage {
  position: relative;
  background-color: #c08457;
  background-image:
    radial-gradient(circle at 12% 8%,  #a56a3e 0 6px, transparent 7px),
    radial-gradient(circle at 27% 22%, #c79268 0 5px, transparent 6px),
    radial-gradient(circle at 56% 14%, #8e5828 0 7px, transparent 8px),
    radial-gradient(circle at 78% 26%, #b07442 0 5px, transparent 6px),
    radial-gradient(circle at 22% 42%, #d6a072 0 6px, transparent 7px),
    radial-gradient(circle at 71% 51%, #8e5828 0 6px, transparent 7px),
    radial-gradient(circle at 41% 64%, #c79268 0 5px, transparent 6px),
    radial-gradient(circle at 86% 72%, #a56a3e 0 7px, transparent 8px),
    radial-gradient(circle at 18% 80%, #d6a072 0 5px, transparent 6px),
    radial-gradient(circle at 60% 88%, #b07442 0 6px, transparent 7px),
    radial-gradient(circle at 33% 94%, #8e5828 0 5px, transparent 6px),
    repeating-radial-gradient(circle at 50% 50%, #a56a3e 0 1px, transparent 2px 6px),
    linear-gradient(135deg, #c79268 0%, #b07442 50%, #a56a3e 100%);
  color: #2a1808; font-family: 'Indie Flower', cursive;
  overflow: hidden;
}

.bhp-frame {
  position: absolute; inset: 24px;
  border: 36px solid;
  border-image: linear-gradient(135deg, #6b3a14 0%, #8b5a2b 30%, #5a3010 70%, #3d2010 100%) 1;
  box-shadow: inset 0 0 0 5px rgba(0,0,0,.3), 0 10px 32px rgba(0,0,0,.5);
  pointer-events: none;
  z-index: 1;
}

.bhp-pin {
  position: absolute; width: 44px; height: 44px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #ff8a8a, #c0392b 60%, #5a0e0e);
  box-shadow: 0 7px 9px rgba(0,0,0,.55), inset -3px -3px 5px rgba(0,0,0,.3), inset 3px 3px 5px rgba(255,255,255,.4);
  z-index: 6;
}
.bhp-pin-blue   { background: radial-gradient(circle at 30% 30%, #93c5fd, #1d4ed8 60%, #0c1f5a); }
.bhp-pin-green  { background: radial-gradient(circle at 30% 30%, #86efac, #15803d 60%, #0c3a1a); }
.bhp-pin-yellow { background: radial-gradient(circle at 30% 30%, #fde68a, #d97706 60%, #4a2a08); }

/* ===== Top banner (HALLWAY) ===== */
.bhp-banner {
  position: absolute; left: 120px; right: 120px; top: 120px; height: 500px;
  background: #fff;
  padding: 60px 80px;
  box-shadow: 0 14px 36px rgba(0,0,0,.5);
  border-top: 22px solid #b91c1c;
  transform: rotate(-.4deg);
  text-align: center;
  z-index: 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.bhp-banner h1 {
  font-family: 'Permanent Marker', cursive; font-size: 280px; line-height: .95; margin: 0;
  color: #1f2937; letter-spacing: .04em;
  text-shadow: 8px 8px 0 rgba(185,28,28,.18);
}
.bhp-banner .bhp-sub {
  font-family: 'Indie Flower', cursive; font-size: 76px; color: #57534e; margin-top: 20px;
}
.bhp-washi {
  position: absolute; width: 220px; height: 56px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 14px, transparent 14px 28px), #fbbf24;
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
  z-index: 4;
}
.bhp-washi-tl { top: -22px; left: 80px; transform: rotate(-7deg); }
.bhp-washi-tr { top: -22px; right: 80px; transform: rotate(7deg); background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 14px, transparent 14px 28px), #93c5fd; }

/* ===== Header row: day pin + clock pin + weather pin ===== */
.bhp-headerRow {
  position: absolute; left: 120px; right: 120px; top: 690px; height: 260px;
  display: flex; flex-direction: row; gap: 32px;
  z-index: 3;
}
.bhp-headerRow > div {
  flex: 1;
  background: #fff;
  box-shadow: 0 10px 22px rgba(0,0,0,.4);
  text-align: center;
  position: relative;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  padding: 24px 18px;
}
.bhp-dayPin    { transform: rotate(-2deg); border-top: 12px solid #d97706; }
.bhp-clockPin  { transform: rotate(1deg);  border-top: 12px solid #2563eb; }
.bhp-weatherPin{ transform: rotate(-1deg); border-top: 12px solid #15803d; }

.bhp-dayLbl     { font-family: 'Special Elite', serif; font-size: 26px; letter-spacing: .25em; color: #92400e; }
.bhp-dayVal     { font-family: 'Permanent Marker', cursive; font-size: 70px; color: #1f2937; line-height: 1; margin-top: 6px; }
.bhp-clockTime  { font-family: 'Permanent Marker', cursive; font-size: 92px; color: #1f2937; line-height: 1; }
.bhp-clockLbl   { font-family: 'Indie Flower', cursive; font-size: 38px; color: #57534e; margin-top: 6px; }
.bhp-weatherTemp{ font-family: 'Permanent Marker', cursive; font-size: 92px; color: #1f2937; line-height: 1; }
.bhp-weatherLbl { font-family: 'Indie Flower', cursive; font-size: 38px; color: #57534e; margin-top: 6px; }

/* ===== Schedule header ===== */
.bhp-scheduleHead {
  position: absolute; left: 80px; right: 80px; top: 1000px; height: 130px;
  background: #fffefa;
  box-shadow: 0 12px 28px rgba(0,0,0,.4);
  transform: rotate(-.5deg);
  padding: 22px 36px;
  z-index: 3;
  display: flex; flex-direction: row; align-items: center; justify-content: space-between;
}
.bhp-scheduleHead h2 {
  font-family: 'Permanent Marker', cursive; font-size: 86px; color: #1f2937; line-height: 1; margin: 0;
}
.bhp-scheduleHead .bhp-stamp {
  font-family: 'Special Elite', serif; font-size: 26px; letter-spacing: .25em; color: #fef3c7;
  background: #b91c1c; padding: 12px 22px; box-shadow: 0 3px 6px rgba(0,0,0,.3);
  transform: rotate(8deg);
}

/* ===== Schedule cards (pinned index cards stacked) ===== */
.bhp-cards {
  position: absolute; left: 80px; right: 80px; top: 1180px; bottom: 1560px;
  display: flex; flex-direction: column; gap: 18px;
  z-index: 3;
}
.bhp-card {
  flex: 1 1 0; min-height: 0;
  background: #fffefa;
  background-image:
    linear-gradient(to right, transparent 100px, rgba(220,38,38,.35) 100px 103px, transparent 103px),
    repeating-linear-gradient(to bottom, transparent 0 36px, rgba(59,130,246,.18) 36px 37px);
  box-shadow: 0 10px 22px rgba(0,0,0,.4);
  padding: 18px 28px 18px 130px;
  position: relative;
  display: grid; grid-template-columns: 80px 1fr 200px;
  align-items: center; gap: 28px;
  border-left: 8px solid transparent;
}
.bhp-card.bhp-cardHl {
  background-color: #fef3c7;
  border-left: 12px solid #b91c1c;
  box-shadow: 0 12px 26px rgba(185,28,28,.35);
}
.bhp-cardNum {
  font-family: 'Permanent Marker', cursive; font-size: 90px; color: #b91c1c;
  line-height: 1; text-align: center;
}
.bhp-cardBody {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
}
.bhp-cardTime {
  font-family: 'Special Elite', serif; font-size: 36px; color: #44403c; letter-spacing: .04em;
}
.bhp-cardName {
  font-family: 'Indie Flower', cursive; font-size: 64px; color: #1f2937; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bhp-cardRoom {
  font-family: 'Special Elite', serif; font-size: 32px; color: #44403c;
  background: #fef3c7; padding: 12px 22px; border: 2px solid #d97706;
  text-align: center;
  white-space: nowrap;
}

/* ===== Attendance polaroid hero ===== */
.bhp-attendance {
  position: absolute; left: 140px; right: 140px; top: 2320px; height: 680px;
  background: #fef3c7;
  box-shadow: 0 18px 36px rgba(0,0,0,.5);
  transform: rotate(2deg);
  padding: 40px 40px 32px;
  border-top: 26px solid #d97706;
  position: absolute;
  z-index: 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.bhp-attendance::after {
  content: ''; position: absolute; top: -26px; left: 0; width: 200px; height: 26px;
  background: #d97706; border-radius: 8px 8px 0 0;
}
.bhp-attLbl {
  font-family: 'Special Elite', serif; font-size: 36px; letter-spacing: .25em; color: #78350f;
}
.bhp-attCheck {
  margin-top: 12px;
  animation: bhp-checkBob 3s ease-in-out infinite;
}
@keyframes bhp-checkBob { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.bhp-attPct {
  display: flex; align-items: baseline; margin-top: 4px;
}
.bhp-attPct b {
  font-family: 'Permanent Marker', cursive; font-size: 320px; color: #15803d; line-height: 1;
  text-shadow: 6px 6px 0 rgba(255,255,255,.5);
}
.bhp-attPct sup {
  font-family: 'Permanent Marker', cursive; font-size: 140px; color: #15803d;
}
.bhp-attDay {
  font-family: 'Indie Flower', cursive; font-size: 52px; color: #44403c; margin-top: 4px;
}

/* ===== Two-up: announcement + countdown ===== */
.bhp-twoUp {
  position: absolute; left: 80px; right: 80px; top: 3030px; height: 530px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 30px;
  z-index: 3;
}
.bhp-memo {
  background: #fef9c3;
  box-shadow: 0 12px 26px rgba(0,0,0,.4);
  transform: rotate(-1.4deg);
  padding: 56px 48px 40px;
  position: relative;
  display: flex; flex-direction: column; justify-content: center;
}
.bhp-memoTag {
  position: absolute; top: 20px; left: 36px;
  font-family: 'Special Elite', serif; font-size: 26px; letter-spacing: .25em; color: #92400e;
}
.bhp-memoMsg {
  font-family: 'Permanent Marker', cursive; font-size: 60px; color: #b91c1c; line-height: 1.1;
}

.bhp-ticket {
  background: #fff;
  box-shadow: 0 12px 26px rgba(0,0,0,.4);
  transform: rotate(2deg);
  text-align: center;
  border-left: 14px dashed #2563eb;
  padding: 36px 28px;
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
}
.bhp-ticket::before, .bhp-ticket::after {
  content: ''; position: absolute; top: 50%; width: 32px; height: 32px; border-radius: 50%;
  background: #c08457; transform: translateY(-50%);
}
.bhp-ticket::before { left: -16px; }
.bhp-ticket::after  { right: -16px; }
.bhp-ticketLbl  { font-family: 'Special Elite', serif; font-size: 30px; letter-spacing: .2em; color: #57534e; }
.bhp-ticketRow  { display: flex; align-items: baseline; gap: 22px; }
.bhp-ticketNum  { font-family: 'Permanent Marker', cursive; font-size: 200px; line-height: 1; color: #2563eb; }
.bhp-ticketUnit { font-family: 'Indie Flower', cursive; font-size: 64px; color: #57534e; }

/* ===== Ticker (bottom) ===== */
.bhp-ticker {
  position: absolute; left: 14px; right: 14px; bottom: 14px; height: 246px;
  background: #fff;
  border-top: 12px solid #1f2937;
  display: flex; align-items: center; overflow: hidden;
  box-shadow: 0 -6px 22px rgba(0,0,0,.3);
  z-index: 5;
}
.bhp-tickerStamp {
  flex: 0 0 auto; padding: 0 60px; height: 100%;
  background: #1f2937; color: #fef3c7;
  display: flex; align-items: center;
  font-family: 'Special Elite', serif; letter-spacing: .25em; font-size: 56px;
}
.bhp-tickerScroll {
  flex: 1; overflow: hidden; position: relative; height: 100%;
  display: flex; align-items: center;
}
.bhp-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'Indie Flower', cursive; font-size: 92px; color: #44403c;
  padding-left: 100%;
  animation: bhp-tickerScroll 60s linear infinite;
  will-change: transform;
}
.bhp-sep { color: #b91c1c; padding: 0 38px; }
@keyframes bhp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 16px; }
.aw-hotspot:hover { background-color: rgba(185, 28, 28, .1); box-shadow: inset 0 0 0 4px rgba(185, 28, 28, .55); }
.aw-hotspot:focus-visible { background-color: rgba(185, 28, 28, .18); box-shadow: inset 0 0 0 4px rgba(185, 28, 28, .85); }
`;
