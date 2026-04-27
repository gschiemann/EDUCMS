"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas. DO NOT regress to vw/% units.
//
// Portrait companion to StorybookHallwayWidget. The landscape uses a center-spine 2-page-spread.
// For portrait we drop the spine — single tall illuminated parchment page reads better at hallway
// distance. Storybook chapter aesthetic preserved: parchment cream, illuminated drop caps,
// decorative serif typography (Cinzel + EB Garamond), ribbon bookmark, gold-leaf accents,
// page-numbered footer with running ticker.
//
// Same Cfg shape as the landscape variant so THEMED_WIDGET_FIELDS / hotspot editor "just works."
// Outer wrapper measures parent and applies transform: scale(N) so the fixed 2160×3840 stage
// fits any container. Fixed pixels only inside the stage.

import { useEffect, useMemo, useRef, useState } from 'react';

type Row = { num?: string; time?: string; name?: string; room?: string; highlight?: boolean };

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

const CANVAS_W = 2160;
const CANVAS_H = 3840;

export function StorybookHallwayPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
      { num: 'I',   time: '8:15',  name: 'Homeroom & Morning Meeting',   room: 'Rm 12' },
      { num: 'II',  time: '9:05',  name: 'Mathematics with Mrs. Chen',    room: 'Rm 14' },
      { num: 'III', time: '10:00', name: 'Reading Workshop · Mrs. Hill',  room: 'Rm 12', highlight: true },
      { num: 'IV',  time: '11:00', name: 'Science — States of Matter',    room: 'Rm 21' },
      { num: 'V',   time: '11:50', name: 'Lunch & Recess',                room: 'Cafe' },
      { num: 'VI',  time: '12:35', name: 'Art with Ms. Greene',           room: 'Rm 9' },
      { num: 'VII', time: '1:30',  name: 'Physical Education',            room: 'Gym' },
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
      'Once upon a Tuesday, the bell did chime',
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
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=EB+Garamond:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Pinyon+Script&family=Tangerine:wght@400;700&display=swap"
      />
      <style>{CSS_SHP}</style>

      <div
        className="shp-book"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Single-page parchment frame (no center spine — portrait variant). */}
        <div className="shp-pageFrame" />

        {/* Decorative scrollwork corners. */}
        <div className="shp-corner shp-tl"><svg viewBox="0 0 110 110"><path d="M3 3 Q 55 3 55 55 M3 3 Q 3 55 55 55 M16 16 Q 42 16 42 42 M16 16 Q 16 42 42 42 M28 28 Q 36 28 36 36 M28 28 Q 28 36 36 36" /></svg></div>
        <div className="shp-corner shp-tr"><svg viewBox="0 0 110 110"><path d="M3 3 Q 55 3 55 55 M3 3 Q 3 55 55 55 M16 16 Q 42 16 42 42 M16 16 Q 16 42 42 42 M28 28 Q 36 28 36 36 M28 28 Q 28 36 36 36" /></svg></div>
        <div className="shp-corner shp-bl"><svg viewBox="0 0 110 110"><path d="M3 3 Q 55 3 55 55 M3 3 Q 3 55 55 55 M16 16 Q 42 16 42 42 M16 16 Q 16 42 42 42 M28 28 Q 36 28 36 36 M28 28 Q 28 36 36 36" /></svg></div>
        <div className="shp-corner shp-br"><svg viewBox="0 0 110 110"><path d="M3 3 Q 55 3 55 55 M3 3 Q 3 55 55 55 M16 16 Q 42 16 42 42 M16 16 Q 16 42 42 42 M28 28 Q 36 28 36 36 M28 28 Q 28 36 36 36" /></svg></div>

        {/* Ribbon bookmark — pinned top-right, drapes down. */}
        <div className="shp-ribbon">
          <div className="shp-ribbonBody" />
          <div className="shp-ribbonTail" />
        </div>

        {/* HEADER — illuminated chapter title with giant decorative drop cap. */}
        <div className="shp-header">
          <div className="shp-chapter"><span data-field="chapter" style={{ whiteSpace: 'pre-wrap' }}>{c.chapter || 'In which we begin our day'}</span></div>
          <h1 className="shp-titleRow">
            <span className="shp-dropCap" aria-hidden="true">H</span>
            <span className="shp-titleText" data-field="title" style={{ whiteSpace: 'pre-wrap' }}>{c.title || 'ALLWAY'}</span>
          </h1>
          <div className="shp-sub"><span data-field="subtitle" style={{ whiteSpace: 'pre-wrap' }}>{c.subtitle || 'every day, a new adventure'}</span></div>
          <div className="shp-headerOrnament">❦ &nbsp; ✦ &nbsp; ❦</div>
        </div>

        {/* SCHEDULE — chapter list with serif typography + page-number leader dots. */}
        <div className="shp-schedule">
          <h2 className="shp-schH"><span data-field="scheduleTitle" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleTitle || "Today's Schedule"}</span></h2>
          <div className="shp-schSub"><span data-field="scheduleSub" style={{ whiteSpace: 'pre-wrap' }}>{c.scheduleSub || 'period by period, hour by hour'}</span></div>
          <div className="shp-rows">
            {rows.slice(0, 8).map((r, i) => (
              <div key={i} className={`shp-row${r.highlight ? ' shp-hl' : ''}`}>
                <div className="shp-num">{r.num || ''}</div>
                <div className="shp-rowBody">
                  <div className="shp-rowName">
                    <span className="shp-chapterPrefix">Chapter {r.num || ''}:</span>
                    <span className="shp-name">{r.name || ''}</span>
                  </div>
                  <div className="shp-leader" aria-hidden="true" />
                  <div className="shp-rowMeta">
                    <span className="shp-room">{r.room || ''}</span>
                    <span className="shp-time">{r.time || ''}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ATTENDANCE — full-width illuminated parchment card. */}
        <div className="shp-attendance">
          <div className="shp-attTop"><span data-field="attendanceTopLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceTopLabel || "Today's Roll Call"}</span></div>
          <div className="shp-attPct">
            <b data-field="attendancePct" style={{ whiteSpace: 'pre-wrap' }}>{c.attendancePct ?? 97}</b>
            <sup>%</sup>
          </div>
          <div className="shp-attBot"><span data-field="attendanceBotLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.attendanceBotLabel || '— a fine showing —'}</span></div>
          <div className="shp-attMiniRow">
            <div className="shp-mini">
              <div className="shp-miniLbl"><span data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.clockLabel || 'the hour'}</span></div>
              <div className="shp-miniVal">{hh}:{mm} {ampm}</div>
            </div>
            <div className="shp-miniDiv">⚜</div>
            <div className="shp-mini">
              <div className="shp-miniLbl"><span data-field="weatherDesc" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherDesc || 'the weather'}</span></div>
              <div className="shp-miniVal"><span data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' }}>{c.weatherTemp || '42°'}</span></div>
            </div>
          </div>
        </div>

        {/* ANNOUNCEMENT + COUNTDOWN — 2-up. */}
        <div className="shp-twoUp">
          <div className="shp-ann">
            <div className="shp-annLbl"><span data-field="annLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.annLabel || 'An announcement —'}</span></div>
            <div className="shp-annMsg"><span data-field="annMsg" style={{ whiteSpace: 'pre-wrap' }}>{c.annMsg || "Assembly in the gymnasium, Friday at two o'clock — all classes welcome!"}</span></div>
          </div>
          <div className="shp-ctd">
            <div className="shp-hourglass" aria-hidden="true">⧗</div>
            <div className="shp-ctdLbl"><span data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' }}>{c.countdownLabel || 'until field day'}</span></div>
            <div className="shp-ctdNum">{days}</div>
            <div className="shp-ctdUnit"><span data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' }}>{unit}</span></div>
          </div>
        </div>

        {/* PAGE-NUMBERED FOOTER + RUNNING TICKER. */}
        <div className="shp-pgnum shp-pgL"><span data-field="pageNumLeft" style={{ whiteSpace: 'pre-wrap' }}>{c.pageNumLeft || '— xiv —'}</span></div>
        <div className="shp-pgnum shp-pgR"><span data-field="pageNumRight" style={{ whiteSpace: 'pre-wrap' }}>{c.pageNumRight || '— xv —'}</span></div>

        <div className="shp-ticker">
          <div className="shp-stamp"><span data-field="tickerStamp" style={{ whiteSpace: 'pre-wrap' }}>{(c.tickerStamp || 'A WORD FROM THE HALLS').toUpperCase()}</span></div>
          <div className="shp-scroll">
            <span
              className="shp-scrollText"
              style={{ animationDuration: `${tickerDurationSec(c.tickerSpeed, 64)}s` }}
            >
              {tickerSegments.map((seg, i) => (
                <span key={i}>
                  {i > 0 && <span className="shp-sep"> · </span>}
                  {seg}
                </span>
              ))}
            </span>
          </div>
        </div>

        {/* Hotspots — operator clicks land in the right region. */}
        {!isLive && (
          <>
            <Hotspot section="header"       x={120}  y={120}  w={1920} h={580} />
            <Hotspot section="schedule"     x={120}  y={780}  w={1920} h={1280} />
            <Hotspot section="attendance"   x={120}  y={2120} w={1920} h={680} />
            <Hotspot section="clock"        x={250}  y={2580} w={620}  h={200} />
            <Hotspot section="weather"      x={1290} y={2580} w={620}  h={200} />
            <Hotspot section="announcement" x={120}  y={2860} w={1170} h={620} />
            <Hotspot section="countdown"    x={1310} y={2860} w={730}  h={620} />
            <Hotspot section="ticker"       x={0}    y={3680} w={2160} h={160} />
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

const CSS_SHP = `
.shp-book {
  position: relative;
  font-family: 'EB Garamond', serif; color: #3d2410;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(180, 130, 70, .10) 0%, transparent 55%),
    radial-gradient(ellipse at 70% 80%, rgba(120, 70, 30, .08) 0%, transparent 50%),
    linear-gradient(180deg, #f5f0dc 0%, #ecdfb5 50%, #f5f0dc 100%);
  overflow: hidden;
}
/* Old-book paper grain — fine horizontal lines + foxing flecks. */
.shp-book::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    repeating-linear-gradient(0deg, transparent 0 5px, rgba(120,53,15,.022) 5px 6px),
    radial-gradient(circle at 18% 32%, rgba(140, 80, 30, .08) 0 8px, transparent 9px),
    radial-gradient(circle at 82% 67%, rgba(140, 80, 30, .06) 0 12px, transparent 13px),
    radial-gradient(circle at 42% 88%, rgba(140, 80, 30, .07) 0 6px, transparent 7px);
  mix-blend-mode: multiply;
}
/* Vignette — darker at the edges, like a fragile old page. */
.shp-book::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 240px rgba(120,53,15,.45);
}

/* Single-page double-border frame (no center spine). */
.shp-pageFrame {
  position: absolute; inset: 56px;
  border: 5px solid #8b5a2b;
  pointer-events: none;
}
.shp-pageFrame::before {
  content: ''; position: absolute; inset: 18px;
  border: 2px solid #b78551;
}
.shp-pageFrame::after {
  content: ''; position: absolute; inset: 30px;
  border: 1px solid #8b5a2b;
  opacity: .55;
}

.shp-corner { position: absolute; width: 140px; height: 140px; pointer-events: none; z-index: 4; }
.shp-corner svg { width: 100%; height: 100%; fill: none; stroke: #8b5a2b; stroke-width: 2.4; opacity: .85; }
.shp-corner.shp-tl { top: 70px;  left: 70px; }
.shp-corner.shp-tr { top: 70px;  right: 70px; transform: scaleX(-1); }
.shp-corner.shp-bl { bottom: 70px; left: 70px; transform: scaleY(-1); }
.shp-corner.shp-br { bottom: 70px; right: 70px; transform: scale(-1,-1); }

/* Ribbon bookmark — drapes from the top edge down past the title. */
.shp-ribbon {
  position: absolute; top: 0; right: 220px; width: 120px; height: 480px;
  z-index: 5; pointer-events: none;
  filter: drop-shadow(0 6px 12px rgba(0,0,0,.35));
}
.shp-ribbonBody {
  position: absolute; top: 0; left: 0; width: 120px; height: 420px;
  background: linear-gradient(180deg, #b91c1c 0%, #991b1b 50%, #7f1d1d 100%);
  box-shadow: inset 8px 0 14px rgba(0,0,0,.25), inset -8px 0 14px rgba(255,255,255,.1);
}
.shp-ribbonTail {
  position: absolute; top: 420px; left: 0; width: 120px; height: 60px;
  background: linear-gradient(180deg, #7f1d1d 0%, #5b1212 100%);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 60%, 0 100%);
}

/* HEADER — illuminated title block. */
.shp-header {
  position: absolute; top: 220px; left: 180px; right: 180px;
  text-align: center; z-index: 3;
}
.shp-chapter {
  font-family: 'Pinyon Script', cursive; font-size: 96px;
  color: #8b5a2b; line-height: 1; letter-spacing: .01em;
}
.shp-chapter::before { content: '~ '; }
.shp-chapter::after  { content: ' ~'; }
.shp-titleRow {
  margin: 28px 0 8px; padding: 0;
  display: flex; align-items: flex-end; justify-content: center; gap: 14px;
  line-height: 1;
}
.shp-dropCap {
  font-family: 'Cinzel', serif; font-weight: 900;
  font-size: 360px; line-height: .82;
  color: #b91c1c;
  text-shadow:
    0 0 8px rgba(218, 165, 32, .7),
    4px 4px 0 #8b5a2b,
    8px 8px 0 rgba(218, 165, 32, .35);
  background: linear-gradient(180deg, #d4a017 0%, #b91c1c 50%, #7f1d1d 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(3px 3px 0 #8b5a2b) drop-shadow(0 0 18px rgba(218, 165, 32, .55));
  animation: shp-dropCapShimmer 5s ease-in-out infinite;
}
@keyframes shp-dropCapShimmer {
  0%, 100% { filter: drop-shadow(3px 3px 0 #8b5a2b) drop-shadow(0 0 18px rgba(218, 165, 32, .55)); }
  50%      { filter: drop-shadow(3px 3px 0 #8b5a2b) drop-shadow(0 0 32px rgba(255, 215, 0, .85)); }
}
.shp-titleText {
  font-family: 'Cinzel', serif; font-weight: 700;
  font-size: 220px; letter-spacing: .14em; line-height: .9;
  color: #3d2410;
  text-shadow: 4px 4px 0 rgba(180, 130, 70, .35);
}
.shp-sub {
  font-family: 'Tangerine', cursive; font-weight: 700;
  font-size: 96px; color: #8b5a2b; line-height: 1; margin-top: 12px;
}
.shp-headerOrnament {
  margin-top: 18px;
  font-family: 'Cinzel', serif; font-size: 48px;
  color: #b78551; letter-spacing: .3em;
}

/* SCHEDULE — chapter list with leader dots. */
.shp-schedule {
  position: absolute; top: 880px; left: 180px; right: 180px; height: 1180px;
  display: flex; flex-direction: column; z-index: 3;
  border-top: 1px solid #8b5a2b; padding-top: 32px;
}
.shp-schedule::before {
  content: ''; position: absolute; left: 0; right: 0; top: 8px; height: 1px; background: #b78551;
}
.shp-schH {
  margin: 0; font-family: 'Cinzel', serif; font-weight: 700; font-size: 88px;
  color: #3d2410; text-align: center; line-height: 1; letter-spacing: .08em;
}
.shp-schSub {
  text-align: center; font-family: 'Tangerine', cursive; font-weight: 700;
  font-size: 72px; color: #8b5a2b; line-height: 1; margin-top: 6px; margin-bottom: 22px;
}
.shp-rows { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.shp-row {
  flex: 1 1 0; min-height: 0;
  display: flex; align-items: center; gap: 28px;
  padding: 6px 12px;
  border-bottom: 1px dashed rgba(139,90,43,.4);
  position: relative;
}
.shp-row:last-child { border-bottom: none; }
.shp-num {
  width: 100px; height: 100px; flex: 0 0 100px;
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 52px; color: #f5f0dc;
  background: radial-gradient(circle at 30% 30%, #b78551 0%, #8b5a2b 70%);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 4px #f5f0dc, inset 0 0 0 5px #8b5a2b, 0 4px 8px rgba(0,0,0,.18);
}
.shp-rowBody {
  flex: 1; display: flex; align-items: baseline; min-width: 0;
}
.shp-rowName {
  display: flex; align-items: baseline; gap: 14px; min-width: 0;
}
.shp-chapterPrefix {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 36px;
  color: #8b5a2b; letter-spacing: .04em; flex: 0 0 auto;
}
.shp-name {
  font-family: 'EB Garamond', serif; font-weight: 500; font-size: 50px;
  color: #3d2410; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.shp-leader {
  flex: 1; height: 1px; min-width: 40px; margin: 0 18px;
  border-bottom: 3px dotted rgba(139,90,43,.55);
  align-self: flex-end; transform: translateY(-12px);
}
.shp-rowMeta {
  flex: 0 0 auto; display: flex; align-items: baseline; gap: 22px;
}
.shp-room {
  font-family: 'Tangerine', cursive; font-weight: 700; font-size: 60px;
  color: #8b5a2b; line-height: 1;
}
.shp-time {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 42px;
  color: #b91c1c; letter-spacing: .04em;
}
.shp-row.shp-hl {
  background: linear-gradient(90deg, rgba(252,211,77,.55) 0%, rgba(252,211,77,.25) 80%, transparent 100%);
  box-shadow: inset 8px 0 0 #d4a017;
}
.shp-row.shp-hl .shp-name { color: #7c2d12; font-weight: 700; }

/* ATTENDANCE — full-width illuminated parchment card. */
.shp-attendance {
  position: absolute; top: 2120px; left: 180px; right: 180px; height: 680px;
  padding: 36px 60px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border: 5px double #8b5a2b;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(255, 248, 220, .8) 0%, rgba(245, 240, 220, .55) 70%),
    rgba(255, 248, 225, .5);
  box-shadow:
    inset 0 0 0 10px #f5f0dc,
    inset 0 0 0 11px #8b5a2b,
    inset 0 0 0 16px #f5f0dc,
    inset 0 0 0 18px #b78551;
  z-index: 3;
}
.shp-attendance::before {
  content: '❦'; position: absolute; top: 36px; left: 56px;
  color: #8b5a2b; font-size: 60px;
}
.shp-attendance::after {
  content: '❦'; position: absolute; bottom: 36px; right: 56px;
  color: #8b5a2b; font-size: 60px;
}
.shp-attTop {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 60px;
  color: #3d2410; letter-spacing: .12em; line-height: 1;
  text-align: center;
}
.shp-attPct {
  display: flex; align-items: baseline; line-height: .85;
  margin: 8px 0 4px;
}
.shp-attPct b {
  font-family: 'Cinzel', serif; font-weight: 900; font-size: 320px;
  color: #15803d; line-height: .85;
  text-shadow: 6px 6px 0 rgba(218, 165, 32, .35);
  background: linear-gradient(180deg, #16a34a 0%, #15803d 60%, #14532d 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(4px 4px 0 #14532d);
}
.shp-attPct sup {
  font-family: 'Cinzel', serif; font-weight: 900; font-size: 140px;
  color: #15803d;
}
.shp-attBot {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 48px;
  color: #5d3a1a; line-height: 1;
}
.shp-attMiniRow {
  display: flex; align-items: center; justify-content: center; gap: 50px;
  margin-top: 18px;
}
.shp-mini {
  display: flex; flex-direction: column; align-items: center; line-height: 1;
}
.shp-miniLbl {
  font-family: 'Tangerine', cursive; font-weight: 700; font-size: 56px;
  color: #8b5a2b;
}
.shp-miniVal {
  font-family: 'Cinzel', serif; font-weight: 700; font-size: 70px;
  color: #3d2410; margin-top: 4px; letter-spacing: .04em;
}
.shp-miniDiv {
  font-family: 'Cinzel', serif; font-size: 70px; color: #b78551;
}

/* TWO-UP: announcement + countdown. */
.shp-twoUp {
  position: absolute; top: 2860px; left: 180px; right: 180px; height: 620px;
  display: grid; grid-template-columns: 1.6fr 1fr; gap: 40px;
  z-index: 3;
}
.shp-ann {
  position: relative;
  padding: 36px 44px 36px 90px;
  background: linear-gradient(180deg, rgba(245, 240, 220, .35) 0%, rgba(250,236,198,.7) 100%);
  border: 3px double #8b5a2b;
  box-shadow: inset 0 0 0 5px #f5f0dc, inset 0 0 0 6px #b78551;
  display: flex; flex-direction: column; justify-content: center;
}
.shp-ann::before {
  content: '✶'; position: absolute; top: 36px; left: 36px;
  color: #b91c1c; font-size: 56px;
}
.shp-annLbl {
  font-family: 'Pinyon Script', cursive; font-size: 80px;
  color: #8b5a2b; line-height: 1;
}
.shp-annMsg {
  font-family: 'EB Garamond', serif; font-weight: 500; font-size: 64px;
  color: #3d2410; line-height: 1.08; margin-top: 14px;
}
.shp-ctd {
  position: relative;
  padding: 32px 28px;
  text-align: center;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(255, 248, 220, .85) 0%, rgba(245, 240, 220, .5) 70%);
  border: 3px double #8b5a2b;
  box-shadow: inset 0 0 0 5px #f5f0dc, inset 0 0 0 6px #b78551;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.shp-hourglass {
  font-family: 'Cinzel', serif; font-size: 90px;
  color: #b91c1c; line-height: 1;
  text-shadow: 0 0 16px rgba(218, 165, 32, .6);
  animation: shp-hourglassFlip 4s ease-in-out infinite;
}
@keyframes shp-hourglassFlip {
  0%, 45%   { transform: rotate(0); }
  50%, 95%  { transform: rotate(180deg); }
  100%      { transform: rotate(360deg); }
}
.shp-ctdLbl {
  font-family: 'Pinyon Script', cursive; font-size: 64px;
  color: #8b5a2b; line-height: 1; margin-top: 4px;
}
.shp-ctdNum {
  font-family: 'Cinzel', serif; font-weight: 900; font-size: 200px;
  color: #b91c1c; line-height: .9; margin: 6px 0;
  text-shadow: 4px 4px 0 #8b5a2b;
  background: linear-gradient(180deg, #d4a017 0%, #b91c1c 60%, #7f1d1d 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(3px 3px 0 #8b5a2b);
}
.shp-ctdUnit {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 44px;
  color: #5d3a1a; line-height: 1;
}

/* PAGE NUMBERS — pinned just above ticker. */
.shp-pgnum {
  position: absolute; bottom: 200px; z-index: 3;
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 44px;
  color: #8b5a2b; letter-spacing: .04em;
}
.shp-pgnum.shp-pgL { left: 200px; }
.shp-pgnum.shp-pgR { right: 200px; }

/* TICKER — full-width, pinned bottom. */
.shp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  background: linear-gradient(180deg, #3d2410 0%, #2a1a0a 100%);
  color: #f5f0dc;
  display: flex; align-items: center; overflow: hidden;
  border-top: 8px double #8b5a2b;
  z-index: 6;
}
.shp-stamp {
  flex: 0 0 auto; padding: 0 56px; height: 100%;
  background: linear-gradient(180deg, #b78551 0%, #8b5a2b 100%);
  color: #f5f0dc;
  display: flex; align-items: center;
  font-family: 'Cinzel', serif; font-weight: 700;
  letter-spacing: .3em; font-size: 36px;
  border-right: 6px double #f5f0dc;
}
.shp-scroll { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.shp-scrollText {
  display: inline-block; white-space: nowrap;
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 500;
  font-size: 76px; color: #f5f0dc;
  padding-left: 100%;
  animation: shp-tickerScroll 64s linear infinite;
  will-change: transform;
}
.shp-sep { color: #d4a017; padding: 0 32px; }
@keyframes shp-tickerScroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }

/* Hotspot styling — matches landscape variant. */
.aw-hotspot { outline: none; transition: box-shadow .15s ease, background-color .15s ease; border-radius: 18px; }
.aw-hotspot:hover { background-color: rgba(139, 90, 43, .1); box-shadow: inset 0 0 0 4px rgba(139, 90, 43, .55); }
.aw-hotspot:focus-visible { background-color: rgba(139, 90, 43, .18); box-shadow: inset 0 0 0 4px rgba(139, 90, 43, .85); }
`;
