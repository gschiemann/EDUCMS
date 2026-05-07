"use client";

/**
 * HsBlueprintWidget — Technical-drawing / grid-paper lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/blueprint.html
 *
 * Concept: architect blueprint. Cyan grid lines, title block header,
 * dimensioning callouts, sheet annotations (A-01, A-02, etc.),
 * revision-log ticker.
 */

import { HsStage } from './HsStage';

export interface HsBlueprintConfig {
  schoolCode?: string;
  schoolName?: string;
  brandLabel1?: string;
  brandProject?: string;
  clockLabel?: string;
  clockDate?: string;
  clockTime?: string;
  brandSheet?: string;
  brandRev?: string;
  greetingDimTop?: string;
  greetingDimLeft?: string;
  greetingEyebrow?: string;
  greetingHeadline?: string;
  greetingSubtitle?: string;
  clockbigLabel?: string;
  clockbigVal?: string;
  clockbigCap?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  attendanceValue?: string;
  attendanceCap?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownSub?: string;
  event0Time?: string; event0Code?: string; event0Name?: string; event0Room?: string; event0Who?: string;
  event1Time?: string; event1Code?: string; event1Name?: string; event1Room?: string; event1Who?: string;
  event2Time?: string; event2Code?: string; event2Name?: string; event2Room?: string; event2Who?: string;
  teacherNum?: string;
  teacherLabel?: string;
  teacherName?: string;
  teacherMeta?: string;
  teacherQuote?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

const DEFAULTS: Required<HsBlueprintConfig> = {
  schoolCode: 'WHS',
  schoolName: 'WESTRIDGE HIGH · EST 1956',
  brandLabel1: 'PROJECT · TITLE',
  brandProject: 'MORNING ASSEMBLY · DAILY BRIEF',
  clockLabel: 'DATE · TIME · STAMP',
  clockDate: '2026-04-21',
  clockTime: '07:53',
  brandSheet: 'A-01',
  brandRev: '142',
  greetingDimTop: 'W 2300 PX — FULL BLEED HEADLINE ELEVATION',
  greetingDimLeft: 'H 820 PX — CL DATUM',
  greetingEyebrow: 'DETAIL 01 · HELLO, WILDCATS',
  greetingHeadline: "LET'S BUILD A GOOD DAY.",
  greetingSubtitle: 'Doors open 7:55 · first period 8:05 · plans are fine but showing up on time is the actual load-bearing wall.',
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
  teacherQuote: '"The answer is in the free-body diagram. Draw the picture — every time. The math always follows."',
  announcementTag: '! NOTICE · BELL-SCHEDULE DEVIATION',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD, GYM A',
  announcementBody: 'Seniors front row · marching band enters from south doors · no backpacks in gym · return to 8th period at final bell.',
  announcementDate: 'SCHED · 14:15 — 15:00 · TODAY',
  tickerTag: 'REVISION LOG',
  tickerMessage: 'RFI-2261 · BUS 14 DELAY 10M · RFI-2262 · RM-210 TONER · RFI-2263 · AP PSYCH STUDY HALL → LIBRARY · RFI-2264 · LOST PROPERTY — SILVER EARBUDS · RFI-2265 · SPRING SPORTS PHOTOS TOMORROW · ',
};

export function HsBlueprintWidget({ config }: { config?: HsBlueprintConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsBlueprintConfig>;
  const events = [
    { time: c.event0Time, code: c.event0Code, name: c.event0Name, room: c.event0Room, who: c.event0Who },
    { time: c.event1Time, code: c.event1Code, name: c.event1Name, room: c.event1Room, who: c.event1Who },
    { time: c.event2Time, code: c.event2Code, name: c.event2Name, room: c.event2Room, who: c.event2Who },
  ];
  return (
    <HsStage
      stageStyle={{
        background: '#0f3a7a',
        backgroundImage:
          'linear-gradient(rgba(106,182,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(106,182,255,.18) 1px, transparent 1px), linear-gradient(rgba(106,182,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(106,182,255,.08) 1px, transparent 1px)',
        backgroundSize: '200px 200px, 200px 200px, 40px 40px, 40px 40px',
        fontFamily: "'Archivo', sans-serif",
        color: '#eaf3ff',
      }}
    >
      <style>{CSS}</style>

      <div className="hs-bp-titleblock">
        <div className="hs-bp-cell">
          <div className="hs-bp-logo">
            {c.schoolCode}
            <span className="hs-bp-logo-sub" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</span>
          </div>
        </div>
        <div className="hs-bp-cell">
          <div className="hs-bp-lbl" data-field="brandLabel1" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandLabel1}</div>
          <div className="hs-bp-val" data-field="brandProject" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandProject}</div>
        </div>
        <div className="hs-bp-cell">
          <div className="hs-bp-lbl" data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockLabel}</div>
          <div className="hs-bp-val" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <span data-field="clockDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockDate}</span> · <span data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</span>
          </div>
        </div>
        <div className="hs-bp-cell hs-bp-rev">
          <div className="hs-bp-lbl">SHEET · REV</div>
          <div className="hs-bp-val" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <span data-field="brandSheet" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandSheet}</span> · REV <span data-field="brandRev" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandRev}</span>
          </div>
        </div>
      </div>

      <div className="hs-bp-hero">
        <div className="hs-bp-dim hs-bp-dim-top"><span data-field="greetingDimTop" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingDimTop}</span></div>
        <div className="hs-bp-dim hs-bp-dim-left"><span data-field="greetingDimLeft" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingDimLeft}</span></div>
        <div className="hs-bp-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
        <h1 className="hs-bp-h1" data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline}</h1>
        <div className="hs-bp-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</div>
      </div>

      <div className="hs-bp-data">
        <div className="hs-bp-panel" data-sheet="A-01.1">
          <div className="hs-bp-kicker" data-field="clockbigLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigLabel}</div>
          <div className="hs-bp-big" data-field="clockbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigVal}</div>
          <div className="hs-bp-cap" data-field="clockbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigCap}</div>
        </div>
        <div className="hs-bp-panel" data-sheet="A-01.2">
          <div className="hs-bp-kicker">EXT. CONDITIONS</div>
          <div className="hs-bp-big" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherTemp}</div>
          <div className="hs-bp-cap" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherCondition}</div>
        </div>
        <div className="hs-bp-panel" data-sheet="A-01.3">
          <div className="hs-bp-kicker">PRESENT</div>
          <div className="hs-bp-big" data-field="attendanceValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceValue}</div>
          <div className="hs-bp-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
        </div>
        <div className="hs-bp-panel" data-sheet="A-01.4">
          <div className="hs-bp-kicker" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
          <div className="hs-bp-big" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
          <div className="hs-bp-cap" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
        </div>
      </div>

      <div className="hs-bp-sched">
        <div className="hs-bp-sched-head">
          <span>TIME</span><span>COURSE</span><span>SECTION</span><span>ROOM</span><span>INSTRUCTOR</span>
        </div>
        {events.map((e, i) => (
          <div key={i} className="hs-bp-sched-row">
            <span className="hs-bp-t">{e.time}</span>
            <span className="hs-bp-c">{e.code}</span>
            <span className="hs-bp-n">{e.name}</span>
            <span className="hs-bp-r">{e.room}</span>
            <span className="hs-bp-w">{e.who}</span>
          </div>
        ))}
      </div>

      <div className="hs-bp-specs">
        <div className="hs-bp-card hs-bp-spec" data-sheet="A-03 · FACULTY PROFILE">
          <div className="hs-bp-portrait"><div className="hs-bp-num" data-field="teacherNum" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherNum}</div></div>
          <div>
            <div className="hs-bp-kicker" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherLabel}</div>
            <h2 className="hs-bp-h2" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherName}</h2>
            <div className="hs-bp-meta" data-field="teacherMeta" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherMeta}</div>
            <div className="hs-bp-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherQuote}</div>
          </div>
        </div>
        <div className="hs-bp-card hs-bp-alert" data-sheet="A-04 · ADVISORY">
          <div className="hs-bp-kicker hs-bp-alert-kicker" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementTag}</div>
          <h3 className="hs-bp-alert-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
          <p className="hs-bp-alert-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
          <div className="hs-bp-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementDate}</div>
        </div>
      </div>

      <div className="hs-bp-ticker">
        <div className="hs-bp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-bp-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=JetBrains+Mono:wght@500;700&display=swap');
.hs-bp-titleblock { position: absolute; top: 40px; left: 40px; right: 40px; height: 180px; border: 3px solid #6ab6ff; display: grid; grid-template-columns: 360px 1fr 520px 360px; background: rgba(10,40,82,.6); }
.hs-bp-cell { border-right: 2px solid #6ab6ff; padding: 16px 24px; display: flex; flex-direction: column; justify-content: center; }
.hs-bp-cell:last-child { border-right: 0; }
.hs-bp-lbl { font-family: 'JetBrains Mono', monospace; font-size: 22px; letter-spacing: .2em; color: #6ab6ff; text-transform: uppercase; opacity: .85; }
.hs-bp-val { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 60px; color: #eaf3ff; letter-spacing: .02em; line-height: 1; margin-top: 8px; }
.hs-bp-logo { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 100px; color: #ffd84d; line-height: .9; letter-spacing: .02em; }
.hs-bp-logo-sub { display: block; font-family: 'JetBrains Mono', monospace; font-size: 18px; letter-spacing: .25em; color: #eaf3ff; margin-top: 6px; opacity: .8; font-weight: 500; }
.hs-bp-rev { background: #ffd84d; color: #0a2852; }
.hs-bp-rev .hs-bp-lbl { color: #0a2852; opacity: 1; }
.hs-bp-rev .hs-bp-val { color: #0a2852; font-size: 40px; }
.hs-bp-hero { position: absolute; top: 260px; left: 40px; width: 2300px; height: 820px; border: 3px solid #6ab6ff; background: rgba(10,40,82,.3); padding: 60px 80px; }
.hs-bp-hero::before { content: 'SHEET A-01'; position: absolute; top: -17px; left: 40px; background: #0f3a7a; padding: 0 16px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; letter-spacing: .26em; color: #ffd84d; text-transform: uppercase; }
.hs-bp-eyebrow { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; letter-spacing: .24em; color: #ffd84d; text-transform: uppercase; margin-bottom: 14px; }
.hs-bp-h1 { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 280px; line-height: .9; letter-spacing: -.02em; margin: 0; color: #eaf3ff; }
.hs-bp-sub { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 44px; color: #6ab6ff; line-height: 1.3; margin-top: 28px; max-width: 1900px; }
.hs-bp-dim { position: absolute; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; color: #ffd84d; letter-spacing: .16em; text-transform: uppercase; pointer-events: none; }
.hs-bp-dim-top { top: 20px; left: 80px; right: 80px; text-align: center; border-top: 1px dashed #ffd84d; padding-top: 12px; }
.hs-bp-dim-top::before, .hs-bp-dim-top::after { content: ''; position: absolute; top: -8px; width: 2px; height: 16px; background: #ffd84d; }
.hs-bp-dim-top::before { left: 0; }
.hs-bp-dim-top::after { right: 0; }
.hs-bp-dim-left { top: 80px; bottom: 80px; left: 20px; writing-mode: vertical-rl; text-align: center; border-left: 1px dashed #ffd84d; padding-left: 12px; display: flex; align-items: center; justify-content: center; }
.hs-bp-data { position: absolute; top: 260px; right: 40px; width: 1420px; height: 820px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 28px; }
.hs-bp-panel { border: 3px solid #6ab6ff; background: rgba(10,40,82,.45); padding: 28px 32px; position: relative; }
.hs-bp-panel::before { content: attr(data-sheet); position: absolute; top: -17px; left: 28px; background: #0f3a7a; padding: 0 14px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 20px; color: #ffd84d; letter-spacing: .24em; text-transform: uppercase; }
.hs-bp-kicker { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; color: #6ab6ff; letter-spacing: .2em; text-transform: uppercase; }
.hs-bp-big { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 200px; line-height: .9; color: #eaf3ff; letter-spacing: -.02em; margin-top: 8px; }
.hs-bp-cap { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 26px; color: #6ab6ff; margin-top: 8px; line-height: 1.25; }
.hs-bp-sched { position: absolute; top: 1110px; left: 40px; right: 40px; height: 420px; border: 3px solid #6ab6ff; background: rgba(10,40,82,.3); padding: 40px 56px; }
.hs-bp-sched::before { content: 'SHEET A-02 · SCHEDULE'; position: absolute; top: -17px; left: 40px; background: #0f3a7a; padding: 0 16px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; color: #ffd84d; letter-spacing: .24em; }
.hs-bp-sched-head { display: grid; grid-template-columns: 180px 200px 1fr 180px 240px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; color: #ffd84d; letter-spacing: .2em; text-transform: uppercase; border-bottom: 2px solid #6ab6ff; padding-bottom: 14px; margin-bottom: 10px; }
.hs-bp-sched-row { display: grid; grid-template-columns: 180px 200px 1fr 180px 240px; padding: 16px 0; border-bottom: 1px dashed rgba(106,182,255,.3); align-items: center; }
.hs-bp-sched-row:last-child { border-bottom: 0; }
.hs-bp-t { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 40px; color: #ffd84d; }
.hs-bp-c { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 30px; color: #6ab6ff; letter-spacing: .06em; }
.hs-bp-n { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 42px; color: #eaf3ff; letter-spacing: .02em; }
.hs-bp-r { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 34px; color: #ffd84d; }
.hs-bp-w { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 28px; color: #6ab6ff; }
.hs-bp-specs { position: absolute; top: 1560px; left: 40px; right: 40px; height: 480px; display: grid; grid-template-columns: 1.1fr 1fr; gap: 28px; }
.hs-bp-card { border: 3px solid #6ab6ff; background: rgba(10,40,82,.45); padding: 32px 40px; position: relative; }
.hs-bp-card::before { content: attr(data-sheet); position: absolute; top: -17px; left: 36px; background: #0f3a7a; padding: 0 14px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; color: #ffd84d; letter-spacing: .24em; }
.hs-bp-spec { display: grid; grid-template-columns: 320px 1fr; gap: 32px; align-items: start; }
.hs-bp-portrait { width: 320px; height: 380px; background: rgba(106,182,255,.12); border: 2px dashed #6ab6ff; position: relative; display: grid; place-items: center; }
.hs-bp-num { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 260px; color: #ffd84d; opacity: .4; line-height: .8; }
.hs-bp-h2 { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 100px; line-height: .9; color: #eaf3ff; margin: 6px 0 6px; letter-spacing: -.01em; }
.hs-bp-meta { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 22px; color: #6ab6ff; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 16px; }
.hs-bp-quote { font-family: 'Archivo', sans-serif; font-style: italic; font-weight: 500; font-size: 32px; color: #eaf3ff; line-height: 1.3; border-left: 3px solid #ffd84d; padding-left: 24px; }
.hs-bp-alert-kicker { color: #ff6a5e; }
.hs-bp-alert-h3 { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 80px; line-height: .95; color: #ffd84d; margin: 10px 0 0; letter-spacing: -.01em; }
.hs-bp-alert-p { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 28px; color: #6ab6ff; line-height: 1.3; margin: 14px 0 0; }
.hs-bp-when { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; color: #ff6a5e; margin-top: 14px; letter-spacing: .16em; text-transform: uppercase; }
.hs-bp-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 60px; background: #ffd84d; color: #0a2852; display: flex; align-items: center; overflow: hidden; border-top: 3px solid #0a2852; }
.hs-bp-tk-tag { background: #0a2852; color: #ffd84d; height: 100%; display: flex; align-items: center; padding: 0 30px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; letter-spacing: .24em; flex-shrink: 0; }
.hs-bp-tk-msg { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; white-space: nowrap; padding-left: 30px; letter-spacing: .14em; text-transform: uppercase; animation: hsBpScroll 55s linear infinite; display: inline-flex; }
@keyframes hsBpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
