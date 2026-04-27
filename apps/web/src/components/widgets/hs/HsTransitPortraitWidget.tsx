"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsTransitPortraitWidget — Airport/subway departure-board lobby in 2160×3840
 * portrait. Companion to HsTransitWidget (3840×2160 landscape). Same
 * configuration shape; the layout is re-flowed for vertical viewing
 * with a stacked airport-terminal layout: header, featured-flight card,
 * full departures table, flight-crew spotlight, advisory, and a PA
 * ticker pinned to the bottom.
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~   0–600 : airport-style mast — code chip, station name, status
 *                indicator, amber 7-segment clock pill
 *   ~ 600–1300: FLIGHT INFO TODAY — featured-flight card with destination,
 *                gate, teacher, departure time, status chip
 *   ~1300–2800: scrolling departures-board table (7 rows / class periods)
 *                with PERIOD · CLASS · GATE · CREW · DEPART · STATUS
 *   ~2800–3300: TODAY'S CREW teacher spotlight — full-width split-flap card
 *   ~3300–3600: ADVISORY card with PA-style copy
 *   ~3600–3840: PA · ALL TERMINALS scrolling ticker
 *
 * Every pixel size is FIXED at the 2160×3840 canvas. HsStage scales
 * the whole stage to whatever the actual viewport is. DO NOT regress
 * to vw / % units inside the stage — the editor and player will both
 * misrender if you do.
 */

import { HsStage } from './HsStage';

export interface HsTransitConfig {
  schoolCode?: string;
  brandStation?: string;
  brandMeta?: string;
  clockTime?: string;
  clockDate?: string;
  clockTz?: string;
  greetingEyebrow?: string;
  greetingHeadline?: string;
  greetingSubtitle?: string;
  greetingGate?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  weatherStatus?: string;
  dep0Time?: string; dep0Code?: string; dep0Dest?: string; dep0Note?: string; dep0Room?: string; dep0Teacher?: string; dep0Status?: string;
  dep1Time?: string; dep1Code?: string; dep1Dest?: string; dep1Note?: string; dep1Room?: string; dep1Teacher?: string; dep1Status?: string;
  dep2Time?: string; dep2Code?: string; dep2Dest?: string; dep2Note?: string; dep2Room?: string; dep2Teacher?: string; dep2Status?: string;
  dep3Time?: string; dep3Code?: string; dep3Dest?: string; dep3Note?: string; dep3Room?: string; dep3Teacher?: string; dep3Status?: string;
  dep4Time?: string; dep4Code?: string; dep4Dest?: string; dep4Note?: string; dep4Room?: string; dep4Teacher?: string; dep4Status?: string;
  dep5Time?: string; dep5Code?: string; dep5Dest?: string; dep5Note?: string; dep5Room?: string; dep5Teacher?: string; dep5Status?: string;
  dep6Time?: string; dep6Code?: string; dep6Dest?: string; dep6Note?: string; dep6Room?: string; dep6Teacher?: string; dep6Status?: string;
  teacherLabel?: string;
  teacherName?: string;
  teacherMeta?: string;
  teacherQuote?: string;
  teacherNum?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownSub?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

type Cfg = HsTransitConfig;

const DEFAULTS: Required<Cfg> = {
  schoolCode: 'WHS',
  brandStation: 'WESTRIDGE INTERNATIONAL',
  brandMeta: 'GRADES 9–12 · TERM SPRING 2026 · ON TIME 94%',
  clockTime: '07:53',
  clockDate: 'TUE · APR 21',
  clockTz: 'LOCAL · UTC-05:00',
  greetingEyebrow: 'NOW BOARDING · PERIOD 1',
  greetingHeadline: 'HAVE A GREAT DAY, WILDCATS.',
  greetingSubtitle: 'Doors open 7:55 · late bell 8:05 · report to first period before the second bell.',
  greetingGate: '1A',
  weatherTemp: '46°F',
  weatherCondition: 'CLEAR · HI 62°',
  weatherStatus: 'ON TIME',
  dep0Time: '08:05', dep0Code: 'APE-301', dep0Dest: 'AP ENGLISH LIT', dep0Note: 'essay drafts due · bring laptop', dep0Room: '214', dep0Teacher: 'Ms. Park', dep0Status: 'BOARDING',
  dep1Time: '09:00', dep1Code: 'PHY-242', dep1Dest: 'AP PHYSICS C', dep1Note: 'lab 3 — frictionless carts', dep1Room: '107', dep1Teacher: 'Ms. Kowalski', dep1Status: 'ON TIME',
  dep2Time: '10:15', dep2Code: 'HIST-210', dep2Dest: 'U.S. HISTORY', dep2Note: 'chapter 12 quiz · 25 min', dep2Room: 'CAFÉ', dep2Teacher: 'Mr. Rivera', dep2Status: 'RM CHANGE',
  dep3Time: '11:30', dep3Code: 'ART-150', dep3Dest: 'CERAMICS II', dep3Note: 'kiln open · wear apron', dep3Room: 'B-12', dep3Teacher: 'Ms. Okafor', dep3Status: 'SCHEDULED',
  dep4Time: '13:45', dep4Code: 'MUSIC-220', dep4Dest: 'CONCERT BAND', dep4Note: 'rehearsal for spring concert', dep4Room: 'AUD', dep4Teacher: 'Mr. Thornton', dep4Status: 'OPEN SEATS',
  dep5Time: '14:30', dep5Code: 'CHEM-110', dep5Dest: 'CHEMISTRY I', dep5Note: 'titration lab · goggles required', dep5Room: '202', dep5Teacher: 'Dr. Nguyen', dep5Status: 'ON TIME',
  dep6Time: '15:15', dep6Code: 'PE-099', dep6Dest: 'CONDITIONING', dep6Note: 'mile run · indoor backup if rain', dep6Room: 'GYM B', dep6Teacher: 'Coach Reyes', dep6Status: 'SCHEDULED',
  teacherLabel: 'TODAY\'S CREW · SPOTLIGHT',
  teacherName: 'MS. KOWALSKI',
  teacherMeta: 'AP PHYSICS · RM 214 · 14 YRS AT WHS',
  teacherQuote: '"The answer is in the free-body diagram. Draw the picture — every time. The math always follows."',
  teacherNum: '14',
  announcementTag: '*PASSENGER ANNOUNCEMENT*',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD · GYM A',
  announcementBody: 'Seniors board first · marching band enters from south doors · no backpacks in gym.',
  announcementDate: 'DEPART 14:15 · ARRIVE 15:00',
  countdownLabel: 'DAYS TO GRADUATION',
  countdownValue: 41,
  countdownSub: 'Seniors — cap & gown pickup by Fri 17:00',
  tickerTag: 'PA · ALL TERMINALS',
  tickerMessage: 'BUS 14 DELAYED 10 MIN — NEW ARRIVAL 07:58  ●  LUNCH TODAY: CHICKEN BOWL, SALAD BAR, VEGAN OPT  ●  AP PSYCH STUDY HALL MOVED TO LIBRARY  ●  LOST: SILVER EARBUDS — FRONT OFFICE  ●  ',
};

function statusClass(s: string): string {
  const up = (s || '').toUpperCase();
  if (up.includes('BOARD') || up.includes('NOW')) return 'hs-trp-st-now';
  if (up.includes('ON TIME')) return 'hs-trp-st-soon';
  if (up.includes('DELAY') || up.includes('CHANGE')) return 'hs-trp-st-delay';
  if (up.includes('OPEN')) return 'hs-trp-st-open';
  return 'hs-trp-st-sched';
}

export function HsTransitPortraitWidget({ config }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const deps = [
    { time: c.dep0Time, code: c.dep0Code, dest: c.dep0Dest, note: c.dep0Note, room: c.dep0Room, teacher: c.dep0Teacher, status: c.dep0Status },
    { time: c.dep1Time, code: c.dep1Code, dest: c.dep1Dest, note: c.dep1Note, room: c.dep1Room, teacher: c.dep1Teacher, status: c.dep1Status },
    { time: c.dep2Time, code: c.dep2Code, dest: c.dep2Dest, note: c.dep2Note, room: c.dep2Room, teacher: c.dep2Teacher, status: c.dep2Status },
    { time: c.dep3Time, code: c.dep3Code, dest: c.dep3Dest, note: c.dep3Note, room: c.dep3Room, teacher: c.dep3Teacher, status: c.dep3Status },
    { time: c.dep4Time, code: c.dep4Code, dest: c.dep4Dest, note: c.dep4Note, room: c.dep4Room, teacher: c.dep4Teacher, status: c.dep4Status },
    { time: c.dep5Time, code: c.dep5Code, dest: c.dep5Dest, note: c.dep5Note, room: c.dep5Room, teacher: c.dep5Teacher, status: c.dep5Status },
    { time: c.dep6Time, code: c.dep6Code, dest: c.dep6Dest, note: c.dep6Note, room: c.dep6Room, teacher: c.dep6Teacher, status: c.dep6Status },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: 'radial-gradient(ellipse at 50% 0%, #1c2744 0%, #0a0f1c 60%)',
        fontFamily: "'Inter', sans-serif",
        color: '#fff',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=JetBrains+Mono:wght@500;700&family=Inter:wght@500;700&display=swap"
      />
      <style>{CSS}</style>

      {/* Subtle scanline / amber haze overlay */}
      <div className="hs-trp-scan" />

      {/* ============================ REGION 1: MAST ~0-600 ============================ */}
      <div className="hs-trp-mast">
        <div className="hs-trp-code" data-field="schoolCode" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.schoolCode}
        </div>
        <div className="hs-trp-name">
          <div className="hs-trp-line1" data-field="brandStation" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.brandStation}
          </div>
          <div className="hs-trp-line2" data-field="brandMeta" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.brandMeta}
          </div>
          <div className="hs-trp-status-row">
            <span className="hs-trp-status-pip" />
            <span className="hs-trp-status-txt" data-field="weatherStatus" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.weatherStatus}
            </span>
            <span className="hs-trp-sep">·</span>
            <span className="hs-trp-cond" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.weatherCondition}
            </span>
            <span className="hs-trp-sep">·</span>
            <span className="hs-trp-temp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.weatherTemp}
            </span>
          </div>
        </div>
        <div className="hs-trp-clock">
          <div className="hs-trp-clock-t" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.clockTime}
          </div>
          <div className="hs-trp-clock-meta">
            <span data-field="clockDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockDate}</span>
            <br />
            <span data-field="clockTz" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTz}</span>
          </div>
        </div>
      </div>

      {/* ============================ REGION 2: FEATURED FLIGHT ~600-1300 ============================ */}
      <div className="hs-trp-boarding">
        <div className="hs-trp-board-tag">FLIGHT INFO · TODAY</div>
        <div className="hs-trp-board-grid">
          <div className="hs-trp-side">
            <div className="hs-trp-side-tag">GATE</div>
            <div className="hs-trp-side-gate" data-field="greetingGate" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.greetingGate}
            </div>
          </div>
          <div className="hs-trp-mid">
            <div className="hs-trp-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.greetingEyebrow}
            </div>
            <h1 className="hs-trp-h1" data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.greetingHeadline}
            </h1>
            <div className="hs-trp-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.greetingSubtitle}
            </div>
            <div className="hs-trp-board-foot">
              <span className={'hs-trp-st ' + statusClass(c.dep0Status)}>{c.dep0Status}</span>
              <span className="hs-trp-board-depart">DEPART {c.dep0Time}</span>
              <span className="hs-trp-board-crew">CREW · {c.dep0Teacher}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 3: DEPARTURES TABLE ~1300-2800 ============================ */}
      <div className="hs-trp-board">
        <div className="hs-trp-head">
          <span>TIME</span>
          <span>CLASS</span>
          <span>DESTINATION</span>
          <span>GATE</span>
          <span>CREW</span>
          <span>STATUS</span>
        </div>
        {deps.map((d, i) => (
          <div key={i} className="hs-trp-row">
            <span className="hs-trp-t">{d.time}</span>
            <span className="hs-trp-rcode">{d.code}</span>
            <span className="hs-trp-dest">
              {d.dest}
              <span className="hs-trp-dest-sub">{d.note}</span>
            </span>
            <span className="hs-trp-gate">{d.room}</span>
            <span className="hs-trp-room">{d.teacher}</span>
            <span><span className={'hs-trp-st ' + statusClass(d.status)}>{d.status}</span></span>
          </div>
        ))}
      </div>

      {/* ============================ REGION 4: FLIGHT CREW SPOTLIGHT ~2800-3300 ============================ */}
      <div className="hs-trp-panel hs-trp-crew" data-label="TODAY'S CREW">
        <div className="hs-trp-teacher">
          <div className="hs-trp-photo">
            <div className="hs-trp-num" data-field="teacherNum" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherNum}
            </div>
          </div>
          <div className="hs-trp-teacher-body">
            <div className="hs-trp-teacher-eb" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherLabel}
            </div>
            <h2 className="hs-trp-h2" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherName}
            </h2>
            <div className="hs-trp-teacher-meta" data-field="teacherMeta" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherMeta}
            </div>
            <div className="hs-trp-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherQuote}
            </div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 5: ADVISORY ~3300-3600 ============================ */}
      <div className="hs-trp-panel hs-trp-alert" data-label="ADVISORY">
        <div className="hs-trp-alert-row">
          <div className="hs-trp-alert-body">
            <div className="hs-trp-alert-tag" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.announcementTag}
            </div>
            <h3 className="hs-trp-alert-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.announcementHeadline}
            </h3>
            <p className="hs-trp-alert-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.announcementBody}
            </p>
            <div className="hs-trp-alert-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.announcementDate}
            </div>
          </div>
          <div className="hs-trp-cd">
            <div className="hs-trp-cd-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownLabel}
            </div>
            <div className="hs-trp-cd-v" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownValue}
            </div>
            <div className="hs-trp-cd-until" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownSub}
            </div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 6: PA TICKER ~3600-3840 ============================ */}
      <div className="hs-trp-ticker">
        <div className="hs-trp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-trp-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.tickerMessage}
          </span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.tickerMessage}
          </span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel is sized for the 2160×3840 portrait stage. */
const CSS = `
.hs-trp-scan {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255,176,32,.025) 0 2px, transparent 2px 4px);
  pointer-events: none; z-index: 1;
}

/* ----- REGION 1: mast ----- */
.hs-trp-mast {
  position: absolute; top: 40px; left: 40px; right: 40px; height: 520px;
  background: #000; border: 6px solid #ffb020;
  display: grid; grid-template-rows: 280px 240px;
  z-index: 3;
}
.hs-trp-code {
  position: absolute; top: 0; left: 0; width: 360px; height: 280px;
  background: #ffb020; color: #000;
  display: grid; place-items: center;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 200px; letter-spacing: .02em; line-height: 1;
}
.hs-trp-name {
  position: absolute; top: 0; left: 360px; right: 0; height: 280px;
  padding: 40px 56px;
  display: flex; flex-direction: column; justify-content: center; gap: 14px;
}
.hs-trp-line1 {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 92px; letter-spacing: .04em; color: #fff; line-height: 1;
  text-transform: uppercase;
}
.hs-trp-line2 {
  font-family: 'JetBrains Mono', monospace; font-size: 32px;
  letter-spacing: .2em; color: #6b7a93; text-transform: uppercase;
}
.hs-trp-status-row {
  display: flex; align-items: center; gap: 14px;
  font-family: 'JetBrains Mono', monospace; font-size: 28px;
  color: #c7d2e4; letter-spacing: .12em; text-transform: uppercase;
}
.hs-trp-status-pip {
  width: 22px; height: 22px; border-radius: 50%; background: #58e07a;
  box-shadow: 0 0 16px #58e07a; animation: hsTrpPulse 1.6s infinite;
}
.hs-trp-status-txt { color: #58e07a; font-weight: 700; }
.hs-trp-sep { color: #6b7a93; }
.hs-trp-cond { color: #c7d2e4; }
.hs-trp-temp { color: #ffb020; font-weight: 700; }
.hs-trp-clock {
  position: absolute; bottom: 0; left: 0; right: 0; height: 240px;
  border-top: 4px dashed rgba(255,176,32,.3);
  display: grid; grid-template-columns: 1fr auto;
  padding: 0 56px; align-items: center; gap: 60px;
}
.hs-trp-clock-t {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 200px; line-height: 1; color: #ffb020;
  letter-spacing: .02em;
  text-shadow: 0 0 36px rgba(255,176,32,.45);
}
.hs-trp-clock-meta {
  font-family: 'JetBrains Mono', monospace; font-size: 32px;
  color: #6b7a93; letter-spacing: .16em; line-height: 1.4;
  text-transform: uppercase; text-align: right;
}

/* ----- REGION 2: featured flight ----- */
.hs-trp-boarding {
  position: absolute; top: 600px; left: 40px; right: 40px;
  height: 660px;
  background: linear-gradient(180deg, #141d36, #0b1223);
  border: 6px solid #ffb020;
  z-index: 3;
}
.hs-trp-board-tag {
  position: absolute; top: -22px; left: 40px;
  background: #ffb020; color: #000;
  padding: 6px 24px;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 32px; letter-spacing: .26em; text-transform: uppercase;
}
.hs-trp-board-grid {
  display: grid; grid-template-columns: 460px 1fr;
  height: 100%;
}
.hs-trp-side {
  background: #ffb020; color: #000;
  display: flex; flex-direction: column;
  justify-content: center; align-items: center;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  text-align: center; gap: 14px;
}
.hs-trp-side-tag {
  font-size: 48px; letter-spacing: .25em; text-transform: uppercase;
}
.hs-trp-side-gate {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 280px; line-height: .9; letter-spacing: .02em;
}
.hs-trp-mid {
  padding: 40px 56px;
  display: flex; flex-direction: column; justify-content: center; gap: 12px;
}
.hs-trp-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-size: 38px;
  letter-spacing: .2em; color: #ffb020; text-transform: uppercase;
}
.hs-trp-h1 {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 130px; line-height: .92; letter-spacing: .01em;
  color: #fff; margin: 6px 0 0; text-transform: uppercase;
}
.hs-trp-sub {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 36px; color: #c7d2e4; margin-top: 14px; line-height: 1.25;
}
.hs-trp-board-foot {
  display: flex; align-items: center; gap: 24px; margin-top: 22px;
  font-family: 'JetBrains Mono', monospace; font-size: 28px;
  color: #6b7a93; letter-spacing: .14em; text-transform: uppercase;
  flex-wrap: wrap;
}
.hs-trp-board-depart { color: #ffb020; font-weight: 700; }
.hs-trp-board-crew { color: #c7d2e4; }

/* ----- REGION 3: departures table ----- */
.hs-trp-board {
  position: absolute; top: 1300px; left: 40px; right: 40px;
  background: #000; border: 6px solid #ffb020;
  z-index: 3;
}
.hs-trp-head {
  display: grid;
  grid-template-columns: 200px 280px 1fr 180px 280px 240px;
  background: #ffb020; color: #000;
  padding: 18px 28px; gap: 16px;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 32px; letter-spacing: .2em; text-transform: uppercase;
  align-items: center;
}
.hs-trp-row {
  display: grid;
  grid-template-columns: 200px 280px 1fr 180px 280px 240px;
  padding: 26px 28px; gap: 16px;
  border-bottom: 2px solid #141d36;
  align-items: center;
  animation: hsTrpFlip 8s ease-in-out infinite;
  transform-origin: center top;
}
.hs-trp-row:nth-child(odd) { background: #080e1c; }
.hs-trp-row:nth-child(2) { animation-delay: -1.2s; }
.hs-trp-row:nth-child(3) { animation-delay: -2.4s; }
.hs-trp-row:nth-child(4) { animation-delay: -3.6s; }
.hs-trp-row:nth-child(5) { animation-delay: -4.8s; }
.hs-trp-row:nth-child(6) { animation-delay: -6.0s; }
.hs-trp-row:nth-child(7) { animation-delay: -7.2s; }
.hs-trp-row:last-child { border-bottom: 0; }
@keyframes hsTrpFlip {
  0%, 92%, 100% { transform: rotateX(0); }
  94% { transform: rotateX(-12deg); }
  96% { transform: rotateX(0); }
}
.hs-trp-t {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 60px; color: #fff; letter-spacing: .02em;
}
.hs-trp-rcode {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 40px; color: #ffb020; letter-spacing: .08em;
}
.hs-trp-dest {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 50px; color: #fff; letter-spacing: .02em;
  text-transform: uppercase; line-height: 1;
}
.hs-trp-dest-sub {
  display: block;
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 24px; color: #6b7a93; text-transform: none;
  letter-spacing: .05em; margin-top: 6px;
}
.hs-trp-gate {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 60px; color: #ffb020; letter-spacing: .04em;
}
.hs-trp-room {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 28px; color: #c7d2e4;
}
.hs-trp-st {
  display: inline-block; padding: 8px 18px;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 26px; letter-spacing: .14em; text-transform: uppercase;
}
.hs-trp-st-now { background: #58e07a; color: #000; }
.hs-trp-st-soon { background: #ffb020; color: #000; }
.hs-trp-st-delay { background: #ff5b5b; color: #000; animation: hsTrpPulse 1.6s infinite; }
.hs-trp-st-open { background: #5ea8ff; color: #000; }
.hs-trp-st-sched { background: #1e2a48; color: #9cb3d8; }
@keyframes hsTrpPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }

/* ----- shared panel chrome ----- */
.hs-trp-panel {
  position: absolute; left: 40px; right: 40px;
  background: #0b1223; border: 6px solid #ffb020;
  padding: 36px 44px;
  z-index: 3;
}
.hs-trp-panel::before {
  content: attr(data-label);
  position: absolute; top: -22px; left: 32px;
  background: #ffb020; color: #000;
  padding: 6px 24px;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 32px; letter-spacing: .26em; text-transform: uppercase;
}

/* ----- REGION 4: flight crew spotlight ----- */
.hs-trp-crew {
  top: 2820px; height: 460px;
}
.hs-trp-teacher {
  display: grid; grid-template-columns: 360px 1fr; gap: 40px;
  height: 100%;
}
.hs-trp-photo {
  width: 360px; height: 380px;
  background: linear-gradient(135deg, #1e2a48, #0b1223);
  border: 4px solid #ffb020;
  display: grid; place-items: center; overflow: hidden;
}
.hs-trp-num {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 280px; color: #ffb020; opacity: .35; line-height: .8;
}
.hs-trp-teacher-body {
  display: flex; flex-direction: column; justify-content: center; gap: 6px;
}
.hs-trp-teacher-eb {
  font-family: 'JetBrains Mono', monospace; font-size: 28px;
  color: #ffb020; letter-spacing: .2em; text-transform: uppercase;
}
.hs-trp-h2 {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 110px; color: #fff; letter-spacing: .02em;
  line-height: .95; margin: 6px 0 0; text-transform: uppercase;
}
.hs-trp-teacher-meta {
  font-family: 'JetBrains Mono', monospace; font-size: 28px;
  color: #6b7a93; letter-spacing: .12em; margin-top: 12px;
  text-transform: uppercase;
}
.hs-trp-quote {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 32px; color: #c7d2e4; font-style: italic;
  line-height: 1.3; margin-top: 16px;
  border-left: 6px solid #ffb020; padding-left: 22px;
}

/* ----- REGION 5: advisory + countdown ----- */
.hs-trp-alert {
  top: 3320px; height: 280px;
  border-left: 14px solid #ff5b5b;
}
.hs-trp-alert-row {
  display: grid; grid-template-columns: 1fr 320px; gap: 36px;
  height: 100%;
}
.hs-trp-alert-body { display: flex; flex-direction: column; gap: 6px; }
.hs-trp-alert-tag {
  font-family: 'JetBrains Mono', monospace; font-size: 26px;
  letter-spacing: .2em; color: #ff5b5b; text-transform: uppercase;
}
.hs-trp-alert-h3 {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 60px; color: #fff; line-height: .95;
  margin: 4px 0 0; text-transform: uppercase;
}
.hs-trp-alert-p {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 26px; color: #c7d2e4; margin: 8px 0 0; line-height: 1.3;
}
.hs-trp-alert-when {
  font-family: 'JetBrains Mono', monospace; font-size: 24px;
  color: #ffb020; letter-spacing: .14em; margin-top: auto;
  text-transform: uppercase;
}
.hs-trp-cd {
  display: flex; flex-direction: column; align-items: flex-end;
  justify-content: center;
  border-left: 2px dashed rgba(255,176,32,.3);
  padding-left: 32px; text-align: right;
}
.hs-trp-cd-lbl {
  font-family: 'JetBrains Mono', monospace; font-size: 22px;
  color: #ffb020; letter-spacing: .2em; text-transform: uppercase;
}
.hs-trp-cd-v {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 180px; line-height: .85; color: #fff;
  letter-spacing: -.01em;
  text-shadow: 0 0 30px rgba(255,176,32,.3);
}
.hs-trp-cd-until {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 22px; color: #6b7a93; letter-spacing: .06em;
  margin-top: 4px; max-width: 280px;
}

/* ----- REGION 6: PA ticker ----- */
.hs-trp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
  background: #ffb020; color: #000;
  display: flex; align-items: center; overflow: hidden;
  border-top: 6px solid #000;
  z-index: 5;
}
.hs-trp-tk-tag {
  background: #000; color: #ffb020;
  height: 100%;
  display: flex; align-items: center;
  padding: 0 36px;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 34px; letter-spacing: .2em;
  flex-shrink: 0;
}
.hs-trp-tk-msg {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 38px;
  padding-left: 40px; white-space: nowrap;
  letter-spacing: .14em; text-transform: uppercase;
  animation: hsTrpScroll 60s linear infinite;
  display: inline-flex;
}
@keyframes hsTrpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
