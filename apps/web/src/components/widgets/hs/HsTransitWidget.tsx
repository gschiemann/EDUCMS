"use client";

/**
 * HsTransitWidget — Airport/subway departure-board lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/transit.html
 * Ported via HsStage transform:scale pattern.
 *
 * Concept: classes become "departures" — split-flap rows with time,
 * course code, destination (subject), gate (room), teacher, and
 * colored status chip (BOARDING / ON TIME / RM CHANGE / SCHEDULED /
 * OPEN SEATS).
 *
 * Widgets wired (each editable via PropertiesPanel):
 *   - school / brand  → airport-code chip + station name + meta
 *   - clock           → amber 7-segment time + date/tz
 *   - greeting        → "NOW BOARDING · PERIOD 1" hero with gate
 *   - weather         → OUTSIDE panel (temp + condition + status)
 *   - dep.0..4        → 5 class "departure" rows
 *   - teacher         → FLIGHT CREW spotlight
 *   - announcement    → ATTENTION PASSENGERS advisory
 *   - countdown       → NEXT LEG countdown
 *   - ticker          → PA · ALL TERMINALS bottom crawl
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

const DEFAULTS: Required<HsTransitConfig> = {
  schoolCode: 'WHS',
  brandStation: 'WESTRIDGE HIGH · MAIN TERMINAL',
  brandMeta: 'GRADES 9–12 · TERM SPRING 2026 · ON TIME 94%',
  clockTime: '07:53',
  clockDate: 'TUE · APR 21',
  clockTz: 'LOCAL · UTC-05:00',
  greetingEyebrow: 'NOW BOARDING · PERIOD 1',
  greetingHeadline: 'HAVE A GREAT DAY, WILDCATS.',
  greetingSubtitle: 'Doors open at 7:55 · late bell at 8:05 · report to first period before the second bell.',
  greetingGate: '1A',
  weatherTemp: '46°F',
  weatherCondition: 'CLEAR · HI 62°',
  weatherStatus: 'ON TIME',
  dep0Time: '08:05', dep0Code: 'APE-301', dep0Dest: 'AP ENGLISH LIT', dep0Note: 'essay drafts due · bring laptop', dep0Room: '214', dep0Teacher: 'Ms. Park', dep0Status: 'BOARDING',
  dep1Time: '09:00', dep1Code: 'PHY-242', dep1Dest: 'AP PHYSICS C', dep1Note: 'lab 3 — frictionless carts', dep1Room: '107', dep1Teacher: 'Ms. Kowalski', dep1Status: 'ON TIME',
  dep2Time: '10:15', dep2Code: 'HIST-210', dep2Dest: 'U.S. HISTORY', dep2Note: 'chapter 12 quiz · 25 min', dep2Room: 'CAFÉ', dep2Teacher: 'Mr. Rivera', dep2Status: 'RM CHANGE',
  dep3Time: '11:30', dep3Code: 'ART-150', dep3Dest: 'CERAMICS II', dep3Note: 'kiln open · wear apron', dep3Room: 'B-12', dep3Teacher: 'Ms. Okafor', dep3Status: 'SCHEDULED',
  dep4Time: '13:45', dep4Code: 'MUSIC-220', dep4Dest: 'CONCERT BAND', dep4Note: 'rehearsal for spring concert', dep4Room: 'AUD', dep4Teacher: 'Mr. Thornton', dep4Status: 'OPEN SEATS',
  teacherLabel: 'FLIGHT CREW · SPOTLIGHT',
  teacherName: 'MS. KOWALSKI',
  teacherMeta: 'AP PHYSICS · RM 214 · 14 YRS AT WHS',
  teacherQuote: '"The answer is in the free-body diagram. Draw the picture — every time. The math always follows."',
  teacherNum: '14',
  announcementTag: 'ATTENTION PASSENGERS',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD · GYM A',
  announcementBody: 'Seniors board first · marching band enters from south doors · no backpacks in gym · return to 8th period when the final bell sounds.',
  announcementDate: 'DEPART 14:15 · ARRIVE 15:00',
  countdownLabel: 'DAYS TO GRADUATION',
  countdownValue: 41,
  countdownSub: 'Seniors — cap & gown pickup by Fri 17:00',
  tickerTag: 'PA · ALL TERMINALS',
  tickerMessage: 'BUS 14 DELAYED 10 MIN — NEW ARRIVAL 07:58  ●  LUNCH TODAY: CHICKEN BOWL, SALAD BAR, VEGAN OPT  ●  AP PSYCH STUDY HALL MOVED TO LIBRARY  ●  LOST: SILVER EARBUDS — FRONT OFFICE  ●  ',
};

function statusClass(s: string): string {
  const up = (s || '').toUpperCase();
  if (up.includes('BOARD') || up.includes('NOW')) return 'hs-tr-st-now';
  if (up.includes('ON TIME')) return 'hs-tr-st-soon';
  if (up.includes('DELAY') || up.includes('CHANGE')) return 'hs-tr-st-delay';
  if (up.includes('OPEN')) return 'hs-tr-st-open';
  return 'hs-tr-st-sched';
}

export function HsTransitWidget({ config }: { config?: HsTransitConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsTransitConfig>;
  const deps = [
    { time: c.dep0Time, code: c.dep0Code, dest: c.dep0Dest, note: c.dep0Note, room: c.dep0Room, teacher: c.dep0Teacher, status: c.dep0Status },
    { time: c.dep1Time, code: c.dep1Code, dest: c.dep1Dest, note: c.dep1Note, room: c.dep1Room, teacher: c.dep1Teacher, status: c.dep1Status },
    { time: c.dep2Time, code: c.dep2Code, dest: c.dep2Dest, note: c.dep2Note, room: c.dep2Room, teacher: c.dep2Teacher, status: c.dep2Status },
    { time: c.dep3Time, code: c.dep3Code, dest: c.dep3Dest, note: c.dep3Note, room: c.dep3Room, teacher: c.dep3Teacher, status: c.dep3Status },
    { time: c.dep4Time, code: c.dep4Code, dest: c.dep4Dest, note: c.dep4Note, room: c.dep4Room, teacher: c.dep4Teacher, status: c.dep4Status },
  ];
  return (
    <HsStage
      stageStyle={{
        background: 'radial-gradient(ellipse at 60% 20%, #1c2744 0%, #0a0f1c 70%)',
        fontFamily: "'Inter', sans-serif",
        color: '#fff',
      }}
    >
      <style>{CSS}</style>

      <div className="hs-tr-mast">
        <div className="hs-tr-code">{c.schoolCode}</div>
        <div className="hs-tr-name">
          <div className="hs-tr-line1">{c.brandStation}</div>
          <div className="hs-tr-line2">{c.brandMeta}</div>
        </div>
        <div className="hs-tr-clock">
          <div className="hs-tr-clock-t">{c.clockTime}</div>
          <div className="hs-tr-clock-meta">
            <span>{c.clockDate}</span>
            <br />
            <span>{c.clockTz}</span>
          </div>
        </div>
      </div>

      <div className="hs-tr-boarding">
        <div className="hs-tr-side">
          <div className="hs-tr-side-tag">ROOM</div>
          <div className="hs-tr-side-gate">{c.greetingGate}</div>
        </div>
        <div className="hs-tr-mid">
          <div className="hs-tr-eyebrow">{c.greetingEyebrow}</div>
          <h1 className="hs-tr-h1">{c.greetingHeadline}</h1>
          <div className="hs-tr-sub">{c.greetingSubtitle}</div>
        </div>
        <div className="hs-tr-rightp">
          <div><span className="hs-tr-k">OUTSIDE</span><br /><span className="hs-tr-v">{c.weatherTemp}</span></div>
          <div><span className="hs-tr-k">CONDITIONS</span><br /><span className="hs-tr-v" style={{ fontSize: 36 }}>{c.weatherCondition}</span></div>
          <div className="hs-tr-status">{c.weatherStatus}</div>
        </div>
      </div>

      <div className="hs-tr-board">
        <div className="hs-tr-head">
          <span>TIME</span><span>COURSE</span><span>DESTINATION</span><span>ROOM</span><span>TEACHER</span><span>STATUS</span>
        </div>
        {deps.map((d, i) => (
          <div key={i} className="hs-tr-row">
            <span className="hs-tr-t">{d.time}</span>
            <span className="hs-tr-rcode">{d.code}</span>
            <span className="hs-tr-dest">
              {d.dest}
              <span className="hs-tr-dest-sub">{d.note}</span>
            </span>
            <span className="hs-tr-gate">{d.room}</span>
            <span className="hs-tr-room">{d.teacher}</span>
            <span><span className={'hs-tr-st ' + statusClass(d.status)}>{d.status}</span></span>
          </div>
        ))}
      </div>

      <div className="hs-tr-lower">
        <div className="hs-tr-panel" data-label="TEACHER OF THE WEEK">
          <div className="hs-tr-teacher">
            <div className="hs-tr-photo"><div className="hs-tr-num">{c.teacherNum}</div></div>
            <div>
              <div className="hs-tr-teacher-eb">{c.teacherLabel}</div>
              <h2 className="hs-tr-h2">{c.teacherName}</h2>
              <div className="hs-tr-teacher-meta">{c.teacherMeta}</div>
              <div className="hs-tr-quote">{c.teacherQuote}</div>
            </div>
          </div>
        </div>
        <div className="hs-tr-panel hs-tr-alert" data-label="ADVISORY">
          <div className="hs-tr-alert-tag">{c.announcementTag}</div>
          <h3 className="hs-tr-alert-h3">{c.announcementHeadline}</h3>
          <p className="hs-tr-alert-p">{c.announcementBody}</p>
          <div className="hs-tr-alert-when">{c.announcementDate}</div>
        </div>
        <div className="hs-tr-panel hs-tr-count" data-label="NEXT LEG">
          <div className="hs-tr-cd-lbl">{c.countdownLabel}</div>
          <div className="hs-tr-cd-v">{c.countdownValue}</div>
          <div className="hs-tr-cd-until">{c.countdownSub}</div>
        </div>
      </div>

      <div className="hs-tr-ticker">
        <div className="hs-tr-tk-tag">{c.tickerTag}</div>
        <div className="hs-tr-tk-msg">
          <span>{c.tickerMessage}</span>
          <span>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=JetBrains+Mono:wght@500;700&family=Inter:wght@500;700&display=swap');
.hs-tr-mast { position: absolute; top: 40px; left: 40px; right: 40px; height: 140px; background: #000; border: 4px solid #ffb020; display: grid; grid-template-columns: 200px 1fr auto; align-items: center; }
.hs-tr-code { background: #ffb020; color: #000; height: 100%; display: grid; place-items: center; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 120px; letter-spacing: .02em; }
.hs-tr-name { padding: 0 40px; display: flex; flex-direction: column; gap: 4px; }
.hs-tr-line1 { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 72px; letter-spacing: .04em; color: #fff; line-height: 1; }
.hs-tr-line2 { font-family: 'JetBrains Mono', monospace; font-size: 28px; letter-spacing: .2em; color: #6b7a93; margin-top: 8px; text-transform: uppercase; }
.hs-tr-clock { padding: 0 40px; display: flex; gap: 40px; align-items: center; }
.hs-tr-clock-t { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 96px; line-height: 1; color: #ffb020; letter-spacing: .02em; text-shadow: 0 0 20px rgba(255,176,32,.35); }
.hs-tr-clock-meta { font-family: 'JetBrains Mono', monospace; font-size: 24px; color: #6b7a93; letter-spacing: .14em; line-height: 1.3; text-transform: uppercase; }
.hs-tr-boarding { position: absolute; top: 220px; left: 40px; right: 40px; height: 400px; background: linear-gradient(180deg, #141d36, #0b1223); border: 4px solid #ffb020; display: grid; grid-template-columns: 340px 1fr 420px; }
.hs-tr-side { background: #ffb020; color: #000; display: flex; flex-direction: column; justify-content: center; align-items: center; font-family: 'Oswald', sans-serif; font-weight: 700; text-align: center; gap: 10px; }
.hs-tr-side-tag { font-size: 36px; letter-spacing: .25em; text-transform: uppercase; }
.hs-tr-side-gate { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 160px; line-height: .9; letter-spacing: .02em; }
.hs-tr-mid { padding: 28px 48px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.hs-tr-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 32px; letter-spacing: .2em; color: #ffb020; text-transform: uppercase; }
.hs-tr-h1 { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 200px; line-height: .9; letter-spacing: .01em; color: #fff; margin: 6px 0 0; text-transform: uppercase; }
.hs-tr-sub { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 36px; color: #c7d2e4; margin-top: 10px; line-height: 1.25; }
.hs-tr-rightp { display: flex; flex-direction: column; justify-content: center; border-left: 2px dashed rgba(255,176,32,.3); padding: 28px 40px; gap: 10px; }
.hs-tr-k { font-family: 'JetBrains Mono', monospace; font-size: 24px; letter-spacing: .2em; color: #6b7a93; text-transform: uppercase; }
.hs-tr-v { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 64px; color: #fff; line-height: 1; }
.hs-tr-status { margin-top: 14px; display: inline-block; align-self: flex-start; padding: 10px 22px; background: #58e07a; color: #000; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 36px; letter-spacing: .18em; text-transform: uppercase; }
.hs-tr-board { position: absolute; top: 660px; left: 40px; right: 40px; background: #000; border: 4px solid #ffb020; }
.hs-tr-head { display: grid; grid-template-columns: 200px 320px 1fr 200px 220px 240px; background: #ffb020; color: #000; padding: 16px 28px; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 34px; letter-spacing: .2em; text-transform: uppercase; }
.hs-tr-row { display: grid; grid-template-columns: 200px 320px 1fr 200px 220px 240px; padding: 22px 28px; border-bottom: 2px solid #141d36; align-items: center; }
.hs-tr-row:nth-child(odd) { background: #080e1c; }
.hs-tr-row:last-child { border-bottom: 0; }
.hs-tr-t { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 70px; color: #fff; letter-spacing: .02em; }
.hs-tr-rcode { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 46px; color: #ffb020; letter-spacing: .08em; }
.hs-tr-dest { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 60px; color: #fff; letter-spacing: .02em; text-transform: uppercase; line-height: 1; }
.hs-tr-dest-sub { display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px; color: #6b7a93; text-transform: none; letter-spacing: .05em; margin-top: 6px; }
.hs-tr-gate { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 72px; color: #ffb020; letter-spacing: .04em; }
.hs-tr-room { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 32px; color: #c7d2e4; }
.hs-tr-st { display: inline-block; padding: 8px 20px; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .16em; text-transform: uppercase; }
.hs-tr-st-now { background: #58e07a; color: #000; }
.hs-tr-st-soon { background: #ffb020; color: #000; }
.hs-tr-st-delay { background: #ff5b5b; color: #000; animation: hsTrPulse 1.6s infinite; }
.hs-tr-st-open { background: #5ea8ff; color: #000; }
.hs-tr-st-sched { background: #1e2a48; color: #9cb3d8; }
@keyframes hsTrPulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
.hs-tr-lower { position: absolute; bottom: 160px; left: 40px; right: 40px; height: 440px; display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 28px; }
.hs-tr-panel { background: #0b1223; border: 4px solid #ffb020; padding: 28px 36px; position: relative; display: flex; flex-direction: column; gap: 10px; }
.hs-tr-panel::before { content: attr(data-label); position: absolute; top: -18px; left: 24px; background: #ffb020; color: #000; padding: 4px 18px; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 26px; letter-spacing: .22em; text-transform: uppercase; }
.hs-tr-teacher { display: grid; grid-template-columns: 280px 1fr; gap: 32px; }
.hs-tr-photo { width: 280px; height: 340px; background: linear-gradient(135deg, #1e2a48, #0b1223); border: 3px solid #ffb020; position: relative; overflow: hidden; display: grid; place-items: center; }
.hs-tr-num { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 220px; color: #ffb020; opacity: .35; line-height: .8; }
.hs-tr-teacher-eb { font-family: 'JetBrains Mono', monospace; font-size: 26px; color: #ffb020; letter-spacing: .2em; text-transform: uppercase; }
.hs-tr-h2 { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 100px; color: #fff; letter-spacing: .02em; line-height: .95; margin: 6px 0 0; text-transform: uppercase; }
.hs-tr-teacher-meta { font-family: 'JetBrains Mono', monospace; font-size: 24px; color: #6b7a93; letter-spacing: .12em; margin-top: 10px; text-transform: uppercase; }
.hs-tr-quote { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px; color: #c7d2e4; font-style: italic; line-height: 1.35; margin-top: 16px; }
.hs-tr-alert-tag { font-family: 'JetBrains Mono', monospace; font-size: 24px; letter-spacing: .2em; color: #ff5b5b; text-transform: uppercase; }
.hs-tr-alert-h3 { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 72px; color: #fff; line-height: .95; margin: 6px 0 0; text-transform: uppercase; }
.hs-tr-alert-p { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px; color: #c7d2e4; margin: 10px 0 0; line-height: 1.3; }
.hs-tr-alert-when { font-family: 'JetBrains Mono', monospace; font-size: 24px; color: #ffb020; letter-spacing: .14em; margin-top: 12px; text-transform: uppercase; }
.hs-tr-cd-lbl { font-family: 'JetBrains Mono', monospace; font-size: 24px; color: #ffb020; letter-spacing: .2em; text-transform: uppercase; }
.hs-tr-cd-v { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 280px; line-height: .85; color: #fff; letter-spacing: -.01em; text-shadow: 0 0 40px rgba(255,176,32,.25); }
.hs-tr-cd-until { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 30px; color: #6b7a93; letter-spacing: .06em; margin-top: 4px; }
.hs-tr-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 80px; background: #ffb020; color: #000; display: flex; align-items: center; overflow: hidden; border-top: 4px solid #000; }
.hs-tr-tk-tag { background: #000; color: #ffb020; height: 100%; display: flex; align-items: center; padding: 0 34px; font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 32px; letter-spacing: .2em; flex-shrink: 0; }
.hs-tr-tk-msg { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 36px; padding-left: 40px; white-space: nowrap; letter-spacing: .14em; text-transform: uppercase; animation: hsTrScroll 55s linear infinite; display: inline-flex; }
@keyframes hsTrScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
