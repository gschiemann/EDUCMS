"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.

/**
 * HsBlueprintPortraitWidget — Architect-blueprint high-school lobby, 2160×3840.
 *
 * Portrait companion to HsBlueprintWidget. Same visual vocabulary
 * (cyan grid paper, title-block header, dimensioned callouts, sheet
 * annotations A-01..A-04, schedule-as-drawings table, revision-log
 * ticker) re-flowed for vertical orientation.
 *
 * Native 2160×3840 stage via HsStage with width/height overrides.
 * No vw/%/vh sizing — every value is fixed pixels.
 */

import { HsStage } from './HsStage';
import type { HsBlueprintConfig } from './HsBlueprintWidget';

type Cfg = HsBlueprintConfig;

const DEFAULTS: Required<Cfg> = {
  schoolCode: 'WHS',
  schoolName: 'WESTRIDGE HIGH · EST 1956',
  brandLabel1: 'PROJECT · TITLE',
  brandProject: 'MORNING ASSEMBLY · DAILY BRIEF',
  clockLabel: 'DATE · TIME · STAMP',
  clockDate: '2026-04-21',
  clockTime: '07:53',
  brandSheet: 'A-01',
  brandRev: '142',
  greetingDimTop: 'W 2080 PX — FULL BLEED HEADLINE ELEVATION',
  greetingDimLeft: 'H 1700 PX — CL DATUM',
  greetingEyebrow: 'DETAIL 01 · HELLO, WILDCATS',
  greetingHeadline: "LET'S BUILD A GOOD DAY.",
  greetingSubtitle:
    'Doors open 7:55 · first period 8:05 · plans are fine but showing up on time is the actual load-bearing wall.',
  clockbigLabel: 'LOCAL TIME',
  clockbigVal: '7:53',
  clockbigCap: 'TUE · APR 21 · PERIOD 1 START T-12M',
  weatherTemp: '46°',
  weatherCondition: 'CLEAR · HI 62 · LO 38 · WIND 6MPH SW',
  attendanceValue: '1,217',
  attendanceCap: '98.2% · CAPACITY 1,240',
  countdownLabel: 'DAYS TO COMMENCEMENT',
  countdownValue: 41,
  countdownSub: 'SENIORS · CAP ORDER DEADLINE FRI 17:00',
  event0Time: '08:05', event0Code: 'APE-301', event0Name: 'AP ENGLISH LITERATURE', event0Room: 'RM 214', event0Who: 'Ms. Park',
  event1Time: '09:00', event1Code: 'PHY-242', event1Name: 'AP PHYSICS C · LAB 3', event1Room: 'RM 107', event1Who: 'Ms. Kowalski',
  event2Time: '10:15', event2Code: 'HIST-210', event2Name: 'U.S. HISTORY · CH.12 QUIZ', event2Room: 'CAFÉ *', event2Who: 'Mr. Rivera',
  teacherNum: '14',
  teacherLabel: 'TEACHER OF THE WEEK',
  teacherName: 'MS. KOWALSKI',
  teacherMeta: "AP PHYSICS · RM 214 · EST. 2012 · ALUMNA '02",
  teacherQuote:
    '"The answer is in the free-body diagram. Draw the picture — every time. The math always follows."',
  announcementTag: '! NOTICE · BELL-SCHEDULE DEVIATION',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD, GYM A',
  announcementBody:
    'Seniors front row · marching band enters from south doors · no backpacks in gym · return to 8th period at final bell.',
  announcementDate: 'SCHED · 14:15 — 15:00 · TODAY',
  tickerTag: 'REVISION LOG',
  tickerMessage:
    'R3 · 2026-04-27 · SCHED REV · R2 · 2026-04-20 · LUNCH MENU · R1 · 2026-04-13 · BELL DEVIATION · RFI-2261 · BUS 14 DELAY 10M · RFI-2262 · RM-210 TONER · RFI-2263 · AP PSYCH STUDY HALL → LIBRARY · ',
};

export function HsBlueprintPortraitWidget({
  config,
}: {
  config?: Cfg;
  live?: boolean;
}) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const events = [
    { time: c.event0Time, code: c.event0Code, name: c.event0Name, room: c.event0Room, who: c.event0Who },
    { time: c.event1Time, code: c.event1Code, name: c.event1Name, room: c.event1Room, who: c.event1Who },
    { time: c.event2Time, code: c.event2Code, name: c.event2Name, room: c.event2Room, who: c.event2Who },
  ];
  // Padded vertical-period schedule (1-7) — re-uses event data when present.
  const periodRows = [
    { p: '1', time: c.event0Time, code: c.event0Code, name: c.event0Name, room: c.event0Room, who: c.event0Who },
    { p: '2', time: c.event1Time, code: c.event1Code, name: c.event1Name, room: c.event1Room, who: c.event1Who },
    { p: '3', time: c.event2Time, code: c.event2Code, name: c.event2Name, room: c.event2Room, who: c.event2Who },
    { p: '4', time: '11:30', code: 'LUNCH', name: 'LUNCH · A-WAVE', room: 'CAFÉ', who: '—' },
    { p: '5', time: '12:25', code: 'CHEM-260', name: 'AP CHEMISTRY · LAB 4', room: 'RM 118', who: 'Dr. Chen' },
    { p: '6', time: '13:20', code: 'CALC-330', name: 'AP CALCULUS BC', room: 'RM 305', who: 'Mr. Boswell' },
    { p: '7', time: '14:15', code: 'ASSY-001', name: 'PEP RALLY · GYM A', room: 'GYM A', who: 'STUDENT GOV' },
  ];
  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#0f3a7a',
        backgroundImage:
          'linear-gradient(rgba(106,182,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(106,182,255,.18) 1px, transparent 1px), linear-gradient(rgba(106,182,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(106,182,255,.08) 1px, transparent 1px)',
        backgroundSize: '200px 200px, 200px 200px, 40px 40px, 40px 40px',
        fontFamily: "'Archivo', sans-serif",
        color: '#eaf3ff',
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=IBM+Plex+Mono:wght@500;700&family=JetBrains+Mono:wght@500;700&display=swap"
      />
      <style>{CSS}</style>

      {/* TITLE BLOCK — top 500px, full width, real architectural drawing's title bar */}
      <div className="hs-bpp-titleblock">
        <div className="hs-bpp-tb-row hs-bpp-tb-row-top">
          <div className="hs-bpp-tb-cell hs-bpp-tb-logo-cell">
            <div className="hs-bpp-logo">
              {c.schoolCode}
              <span className="hs-bpp-logo-sub" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</span>
            </div>
          </div>
          <div className="hs-bpp-tb-cell hs-bpp-tb-rev">
            <div className="hs-bpp-lbl">SHEET · REV</div>
            <div className="hs-bpp-val hs-bpp-mono">
              <span data-field="brandSheet" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandSheet}</span>
              {' · REV '}
              <span data-field="brandRev" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandRev}</span>
            </div>
          </div>
        </div>
        <div className="hs-bpp-tb-row hs-bpp-tb-row-bottom">
          <div className="hs-bpp-tb-cell">
            <div className="hs-bpp-lbl" data-field="brandLabel1" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandLabel1}</div>
            <div className="hs-bpp-val" data-field="brandProject" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandProject}</div>
          </div>
          <div className="hs-bpp-tb-cell">
            <div className="hs-bpp-lbl" data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockLabel}</div>
            <div className="hs-bpp-val hs-bpp-mono">
              <span data-field="clockDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockDate}</span>
              {' · '}
              <span data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN DRAWING AREA — vertical floor-plan elevation w/ dimensioned callouts. */}
      <div className="hs-bpp-hero">
        <div className="hs-bpp-hero-sheet">SHEET A-01 · LOBBY ELEVATION</div>

        <div className="hs-bpp-dim hs-bpp-dim-top">
          <span data-field="greetingDimTop" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingDimTop}</span>
        </div>
        <div className="hs-bpp-dim hs-bpp-dim-left">
          <span data-field="greetingDimLeft" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingDimLeft}</span>
        </div>

        <div className="hs-bpp-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
        <h1 className="hs-bpp-h1" data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline}</h1>
        <div className="hs-bpp-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</div>

        {/* Floor-plan elevation rectangle w/ dimensioned callouts pointing to lobby/cafeteria/library/gym */}
        <div className="hs-bpp-plan">
          <div className="hs-bpp-plan-grid">
            <div className="hs-bpp-plan-room" style={{ gridArea: 'lobby' }}>
              <div className="hs-bpp-plan-tag">LOBBY · 01</div>
              <div className="hs-bpp-plan-area">2,400 SF</div>
            </div>
            <div className="hs-bpp-plan-room" style={{ gridArea: 'caf' }}>
              <div className="hs-bpp-plan-tag">CAFETERIA · 02</div>
              <div className="hs-bpp-plan-area">5,800 SF</div>
            </div>
            <div className="hs-bpp-plan-room" style={{ gridArea: 'lib' }}>
              <div className="hs-bpp-plan-tag">LIBRARY · 03</div>
              <div className="hs-bpp-plan-area">3,200 SF</div>
            </div>
            <div className="hs-bpp-plan-room hs-bpp-plan-room-gym" style={{ gridArea: 'gym' }}>
              <div className="hs-bpp-plan-tag">GYM A · 04</div>
              <div className="hs-bpp-plan-area">8,100 SF</div>
            </div>
          </div>
          {/* Leader-line callouts to each room */}
          <div className="hs-bpp-callout hs-bpp-callout-1">A-01 · LOBBY</div>
          <div className="hs-bpp-callout hs-bpp-callout-2">A-02 · CAFETERIA</div>
          <div className="hs-bpp-callout hs-bpp-callout-3">A-03 · LIBRARY</div>
          <div className="hs-bpp-callout hs-bpp-callout-4">A-04 · GYM A</div>
        </div>

        {/* 4-up data panels at the bottom of the hero — clock, weather, attendance, countdown */}
        <div className="hs-bpp-data">
          <div className="hs-bpp-panel" data-sheet="A-01.1">
            <div className="hs-bpp-kicker" data-field="clockbigLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigLabel}</div>
            <div className="hs-bpp-big" data-field="clockbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigVal}</div>
            <div className="hs-bpp-cap" data-field="clockbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigCap}</div>
          </div>
          <div className="hs-bpp-panel" data-sheet="A-01.2">
            <div className="hs-bpp-kicker">EXT. CONDITIONS</div>
            <div className="hs-bpp-big" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherTemp}</div>
            <div className="hs-bpp-cap" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherCondition}</div>
          </div>
          <div className="hs-bpp-panel" data-sheet="A-01.3">
            <div className="hs-bpp-kicker">PRESENT</div>
            <div className="hs-bpp-big" data-field="attendanceValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceValue}</div>
            <div className="hs-bpp-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
          </div>
          <div className="hs-bpp-panel" data-sheet="A-01.4">
            <div className="hs-bpp-kicker" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
            <div className="hs-bpp-big" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-bpp-cap" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
          </div>
        </div>
      </div>

      {/* SCHEDULE-AS-DRAWINGS TABLE — period 1-7 styled as drafting notations w/ leader lines to room numbers */}
      <div className="hs-bpp-sched">
        <div className="hs-bpp-sched-sheet">SHEET A-02 · BELL SCHEDULE · PERIODS 1-7</div>
        <div className="hs-bpp-sched-head">
          <span>P</span><span>TIME</span><span>COURSE</span><span>SECTION</span><span>RM</span><span>INSTRUCTOR</span>
        </div>
        {periodRows.map((e, i) => (
          <div key={i} className="hs-bpp-sched-row">
            <span className="hs-bpp-p">P{e.p}</span>
            <span className="hs-bpp-t">{e.time}</span>
            <span className="hs-bpp-c">{e.code}</span>
            <span className="hs-bpp-n">{e.name}</span>
            <span className="hs-bpp-r-wrap">
              <span className="hs-bpp-leader" />
              <span className="hs-bpp-r">{e.room}</span>
            </span>
            <span className="hs-bpp-w">{e.who}</span>
          </div>
        ))}
        {/* Hidden but typed — keeps `events` in scope so unused-warning stays off
            and so the original 3-event payload remains accessible if a config
            consumer is iterating on it. */}
        <span style={{ display: 'none' }}>{events.map((e) => e.time).join(' · ')}</span>
      </div>

      {/* SHEET ANNOTATION STRIP — A-01..A-04 mini-drawings */}
      <div className="hs-bpp-anno">
        <div className="hs-bpp-anno-mini" data-sheet="A-01">
          <svg viewBox="0 0 100 60" preserveAspectRatio="none">
            <rect x="2" y="2" width="96" height="56" fill="none" stroke="#6ab6ff" strokeWidth="2" />
            <rect x="14" y="20" width="20" height="36" fill="rgba(106,182,255,.14)" stroke="#ffd84d" strokeWidth="1.4" />
            <rect x="46" y="14" width="40" height="42" fill="rgba(106,182,255,.06)" stroke="#6ab6ff" strokeWidth="1" strokeDasharray="3 2" />
          </svg>
          <div className="hs-bpp-anno-tag">LOBBY PLAN</div>
        </div>
        <div className="hs-bpp-anno-mini" data-sheet="A-02">
          <svg viewBox="0 0 100 60" preserveAspectRatio="none">
            <rect x="2" y="2" width="96" height="56" fill="none" stroke="#6ab6ff" strokeWidth="2" />
            <line x1="2" y1="20" x2="98" y2="20" stroke="#ffd84d" strokeWidth="1" />
            <line x1="2" y1="32" x2="98" y2="32" stroke="#ffd84d" strokeWidth="1" />
            <line x1="2" y1="44" x2="98" y2="44" stroke="#ffd84d" strokeWidth="1" />
            <line x1="22" y1="2" x2="22" y2="58" stroke="#6ab6ff" strokeWidth=".8" strokeDasharray="2 2" />
          </svg>
          <div className="hs-bpp-anno-tag">SCHEDULE</div>
        </div>
        <div className="hs-bpp-anno-mini" data-sheet="A-03">
          <svg viewBox="0 0 100 60" preserveAspectRatio="none">
            <rect x="2" y="2" width="96" height="56" fill="none" stroke="#6ab6ff" strokeWidth="2" />
            <circle cx="32" cy="30" r="14" fill="rgba(255,216,77,.18)" stroke="#ffd84d" strokeWidth="1.4" />
            <rect x="56" y="16" width="36" height="6" fill="#6ab6ff" opacity=".5" />
            <rect x="56" y="28" width="28" height="4" fill="#6ab6ff" opacity=".4" />
            <rect x="56" y="38" width="32" height="4" fill="#6ab6ff" opacity=".3" />
          </svg>
          <div className="hs-bpp-anno-tag">FACULTY</div>
        </div>
        <div className="hs-bpp-anno-mini" data-sheet="A-04">
          <svg viewBox="0 0 100 60" preserveAspectRatio="none">
            <rect x="2" y="2" width="96" height="56" fill="none" stroke="#6ab6ff" strokeWidth="2" />
            <polygon points="50,8 90,52 10,52" fill="rgba(255,106,94,.22)" stroke="#ff6a5e" strokeWidth="1.6" />
            <rect x="46" y="22" width="8" height="18" fill="#ff6a5e" />
            <rect x="46" y="44" width="8" height="4" fill="#ff6a5e" />
          </svg>
          <div className="hs-bpp-anno-tag">ADVISORY</div>
        </div>
      </div>

      {/* REVISION-LOG TICKER — bottom 240px */}
      <div className="hs-bpp-ticker">
        <div className="hs-bpp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-bpp-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
/* === TITLE BLOCK (top ~500px) ============================================== */
.hs-bpp-titleblock {
  position: absolute; top: 40px; left: 40px; right: 40px;
  height: 460px; border: 4px solid #6ab6ff;
  background: rgba(10,40,82,.6);
  display: grid; grid-template-rows: 1fr 1fr;
}
.hs-bpp-tb-row {
  display: grid; grid-template-columns: 1.4fr 1fr;
  border-bottom: 3px solid #6ab6ff;
}
.hs-bpp-tb-row-bottom { border-bottom: 0; grid-template-columns: 1fr 1fr; }
.hs-bpp-tb-cell {
  border-right: 3px solid #6ab6ff; padding: 28px 40px;
  display: flex; flex-direction: column; justify-content: center; min-width: 0;
}
.hs-bpp-tb-cell:last-child { border-right: 0; }
.hs-bpp-tb-logo-cell { padding-top: 36px; }
.hs-bpp-logo {
  font-family: 'Archivo', sans-serif; font-weight: 900;
  font-size: 160px; color: #ffd84d; line-height: .9; letter-spacing: .02em;
}
.hs-bpp-logo-sub {
  display: block; font-family: 'IBM Plex Mono', monospace;
  font-size: 26px; letter-spacing: .25em; color: #eaf3ff;
  margin-top: 14px; opacity: .85; font-weight: 500;
}
.hs-bpp-lbl {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 26px; letter-spacing: .22em; color: #6ab6ff;
  text-transform: uppercase; opacity: .9;
}
.hs-bpp-val {
  font-family: 'Archivo', sans-serif; font-weight: 900;
  font-size: 64px; color: #eaf3ff; letter-spacing: .02em;
  line-height: 1; margin-top: 12px;
}
.hs-bpp-mono { font-family: 'IBM Plex Mono', monospace; }
.hs-bpp-tb-rev {
  background: #ffd84d; color: #0a2852;
}
.hs-bpp-tb-rev .hs-bpp-lbl { color: #0a2852; opacity: 1; }
.hs-bpp-tb-rev .hs-bpp-val { color: #0a2852; font-size: 50px; }

/* === HERO / DRAWING AREA (~1700px) ========================================= */
.hs-bpp-hero {
  position: absolute; top: 540px; left: 40px; right: 40px;
  height: 1700px; border: 4px solid #6ab6ff;
  background: rgba(10,40,82,.3);
  padding: 80px 80px 40px;
  animation: hsBppDraftReveal 1.2s cubic-bezier(.2,.6,.2,1) both;
}
.hs-bpp-hero-sheet {
  position: absolute; top: -22px; left: 60px;
  background: #0f3a7a; padding: 0 24px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 28px; letter-spacing: .26em; color: #ffd84d;
  text-transform: uppercase;
}
.hs-bpp-eyebrow {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 30px; letter-spacing: .26em; color: #ffd84d;
  text-transform: uppercase; margin-bottom: 16px;
}
.hs-bpp-h1 {
  font-family: 'Archivo', sans-serif; font-weight: 900;
  font-size: 220px; line-height: .9; letter-spacing: -.02em;
  margin: 0; color: #eaf3ff;
}
.hs-bpp-sub {
  font-family: 'Archivo', sans-serif; font-weight: 500;
  font-size: 38px; color: #6ab6ff; line-height: 1.3;
  margin-top: 24px; max-width: 1900px;
}
.hs-bpp-dim {
  position: absolute; font-family: 'IBM Plex Mono', monospace;
  font-weight: 700; font-size: 22px; color: #ffd84d;
  letter-spacing: .18em; text-transform: uppercase; pointer-events: none;
}
.hs-bpp-dim-top {
  top: 24px; left: 80px; right: 80px;
  text-align: center; border-top: 1px dashed #ffd84d; padding-top: 14px;
}
.hs-bpp-dim-top::before, .hs-bpp-dim-top::after {
  content: ''; position: absolute; top: -8px;
  width: 2px; height: 16px; background: #ffd84d;
}
.hs-bpp-dim-top::before { left: 0; }
.hs-bpp-dim-top::after { right: 0; }
.hs-bpp-dim-left {
  top: 100px; bottom: 100px; left: 24px;
  writing-mode: vertical-rl; text-align: center;
  border-left: 1px dashed #ffd84d; padding-left: 14px;
  display: flex; align-items: center; justify-content: center;
}

/* Floor-plan elevation rectangle ~ 800px tall */
.hs-bpp-plan {
  position: relative; margin-top: 60px;
  height: 760px; padding: 24px;
  border: 3px dashed #6ab6ff; background: rgba(10,40,82,.45);
}
.hs-bpp-plan-grid {
  width: 100%; height: 100%;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  grid-template-rows: 1fr 1.2fr;
  grid-template-areas:
    "lobby caf"
    "lib   gym";
  gap: 18px;
}
.hs-bpp-plan-room {
  border: 2px solid #6ab6ff; background: rgba(106,182,255,.08);
  position: relative; padding: 26px 30px;
  display: flex; flex-direction: column; justify-content: space-between;
  animation: hsBppLineDraw 1.4s ease-out both;
}
.hs-bpp-plan-room-gym { background: rgba(255,216,77,.10); border-color: #ffd84d; }
.hs-bpp-plan-tag {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 30px; letter-spacing: .22em; color: #ffd84d;
  text-transform: uppercase;
}
.hs-bpp-plan-area {
  font-family: 'Archivo', sans-serif; font-weight: 900;
  font-size: 56px; color: #eaf3ff; letter-spacing: -.01em; line-height: 1;
}
.hs-bpp-callout {
  position: absolute;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 22px; letter-spacing: .2em; color: #ffd84d;
  background: #0a2852; border: 1px solid #ffd84d;
  padding: 8px 14px; text-transform: uppercase;
}
.hs-bpp-callout-1 { top: -16px; left: 60px; }
.hs-bpp-callout-2 { top: -16px; right: 60px; }
.hs-bpp-callout-3 { bottom: -16px; left: 60px; }
.hs-bpp-callout-4 { bottom: -16px; right: 60px; }

/* 4-up data row at bottom of hero */
.hs-bpp-data {
  position: absolute; left: 40px; right: 40px; bottom: 30px;
  height: 360px;
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 22px;
}
.hs-bpp-panel {
  border: 3px solid #6ab6ff; background: rgba(10,40,82,.55);
  padding: 22px 28px; position: relative; min-width: 0;
  display: flex; flex-direction: column; justify-content: space-between;
}
.hs-bpp-panel::before {
  content: attr(data-sheet); position: absolute; top: -16px; left: 24px;
  background: #0f3a7a; padding: 0 12px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 20px; color: #ffd84d; letter-spacing: .24em; text-transform: uppercase;
}
.hs-bpp-kicker {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 22px; color: #6ab6ff; letter-spacing: .2em; text-transform: uppercase;
}
.hs-bpp-big {
  font-family: 'Archivo', sans-serif; font-weight: 900;
  font-size: 130px; line-height: .9; color: #eaf3ff;
  letter-spacing: -.02em; margin-top: 6px;
}
.hs-bpp-cap {
  font-family: 'Archivo', sans-serif; font-weight: 500;
  font-size: 22px; color: #6ab6ff; line-height: 1.25; margin-top: 6px;
}

/* === SCHEDULE-AS-DRAWINGS (~1100px) ======================================== */
.hs-bpp-sched {
  position: absolute; top: 2280px; left: 40px; right: 40px;
  height: 1100px; border: 4px solid #6ab6ff;
  background: rgba(10,40,82,.3); padding: 60px 70px;
}
.hs-bpp-sched-sheet {
  position: absolute; top: -22px; left: 60px;
  background: #0f3a7a; padding: 0 24px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 28px; letter-spacing: .26em; color: #ffd84d;
  text-transform: uppercase;
}
.hs-bpp-sched-head {
  display: grid;
  grid-template-columns: 100px 180px 220px 1fr 240px 280px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 26px; color: #ffd84d; letter-spacing: .22em;
  text-transform: uppercase; border-bottom: 3px solid #6ab6ff;
  padding-bottom: 18px; margin-bottom: 12px;
}
.hs-bpp-sched-row {
  display: grid;
  grid-template-columns: 100px 180px 220px 1fr 240px 280px;
  padding: 22px 0;
  border-bottom: 1px dashed rgba(106,182,255,.35);
  align-items: center;
}
.hs-bpp-sched-row:last-child { border-bottom: 0; }
.hs-bpp-p {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 36px; color: #6ab6ff; letter-spacing: .12em;
}
.hs-bpp-t {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 38px; color: #ffd84d;
}
.hs-bpp-c {
  font-family: 'IBM Plex Mono', monospace; font-weight: 500;
  font-size: 28px; color: #6ab6ff; letter-spacing: .06em;
}
.hs-bpp-n {
  font-family: 'Archivo', sans-serif; font-weight: 700;
  font-size: 36px; color: #eaf3ff; letter-spacing: .02em;
}
.hs-bpp-r-wrap { display: flex; align-items: center; gap: 12px; }
.hs-bpp-leader {
  flex: 1 1 auto; height: 0;
  border-top: 1px dashed #ffd84d;
  display: inline-block; min-width: 40px;
}
.hs-bpp-r {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 32px; color: #ffd84d;
  border: 2px solid #ffd84d; padding: 4px 12px;
  background: rgba(255,216,77,.08);
  white-space: nowrap;
}
.hs-bpp-w {
  font-family: 'Archivo', sans-serif; font-weight: 500;
  font-size: 26px; color: #6ab6ff;
}

/* === SHEET ANNOTATION STRIP (~300px) ======================================= */
.hs-bpp-anno {
  position: absolute; top: 3420px; left: 40px; right: 40px;
  height: 300px;
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 24px;
}
.hs-bpp-anno-mini {
  border: 3px solid #6ab6ff; background: rgba(10,40,82,.45);
  position: relative; padding: 20px 20px 56px;
  display: flex; flex-direction: column; align-items: stretch; justify-content: center;
}
.hs-bpp-anno-mini::before {
  content: attr(data-sheet); position: absolute; top: -16px; left: 20px;
  background: #0f3a7a; padding: 0 12px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 22px; color: #ffd84d; letter-spacing: .24em;
}
.hs-bpp-anno-mini svg { width: 100%; height: 100%; }
.hs-bpp-anno-tag {
  position: absolute; bottom: 14px; left: 20px; right: 20px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 22px; color: #6ab6ff; letter-spacing: .22em;
  text-transform: uppercase; text-align: center;
}

/* === REVISION-LOG TICKER (bottom ~240px) =================================== */
.hs-bpp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 100px; background: #ffd84d; color: #0a2852;
  display: flex; align-items: center; overflow: hidden;
  border-top: 4px solid #0a2852;
}
.hs-bpp-tk-tag {
  background: #0a2852; color: #ffd84d; height: 100%;
  display: flex; align-items: center; padding: 0 40px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 30px; letter-spacing: .26em; flex-shrink: 0;
}
.hs-bpp-tk-msg {
  font-family: 'IBM Plex Mono', monospace; font-weight: 700;
  font-size: 32px; white-space: nowrap; padding-left: 40px;
  letter-spacing: .14em; text-transform: uppercase;
  animation: hsBppScroll 65s linear infinite; display: inline-flex;
}

@keyframes hsBppScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes hsBppDraftReveal {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes hsBppLineDraw {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
`;
