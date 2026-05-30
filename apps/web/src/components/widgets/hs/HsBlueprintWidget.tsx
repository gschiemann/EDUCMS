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

import { useRef } from 'react';
import { HsStage } from './HsStage';
import { useHsLiveClock, resolveHsClock, resolveHsDate } from './useHsLiveClock';
import { useHsLiveWeather, describeWmo } from './useHsLiveWeather';
import { useAutoFitText } from './useAutoFitText';
import { useTextStyleOverrides } from './useTextStyleOverrides';

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
  /** ZIP/postal code for weather lookup. Empty → IP geolocation. */
  weatherLocation?: string;
  /** 'imperial' (°F) or 'metric' (°C). Default: imperial. */
  weatherUnits?: 'imperial' | 'metric';
  /** IANA timezone (e.g. 'America/Los_Angeles'). Empty → browser tz. */
  clockTimezone?: string;
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
  /**
   * Per-field style overrides — keys match `data-field` attrs on the
   * rendered HTML. Operator-edited via the BuilderBottomBar's per-field
   * controls. BuilderZone applies them via scoped `!important` CSS
   * rules (apps/web/src/components/template-builder/BuilderZone.tsx
   * ~line 547). Empty / missing keys fall back to the CSS class
   * defaults baked into this widget.
   *
   * Schema matches the Canva-style toolbar: { fontSize, fontFamily,
   *   color, bold, italic, underline, strikethrough, bgColor }
   */
  __styles?: Record<string, {
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    bgColor?: string;
  }>;
}

export const DEFAULTS: Required<HsBlueprintConfig> = {
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
  weatherLocation: '',
  weatherUnits: 'imperial',
  clockTimezone: '',
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
  __styles: {},
};

export function HsBlueprintWidget({ config, live }: { config?: HsBlueprintConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsBlueprintConfig>;
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 2026-05-08 — auto-fit fallback. Text fields with `data-fit` get
  // their fontSize bsearched to fill their container without
  // overflowing. Manual `__styles[fieldName].fontSize` override (set via
  // BuilderBottomBar) always wins; BuilderZone's CSS injection lays
  // the override down with `!important` so the auto-fit's inline
  // fontSize loses cleanly.
  useAutoFitText(stageRef, c.__styles as any);
  useTextStyleOverrides(stageRef, c.__styles as any);
  // 2026-05-07 — live clock (see useHsLiveClock.ts).
  const now = useHsLiveClock(live !== false);
  const clock = resolveHsClock(c as any, now, (DEFAULTS as any).clockTime || '', (DEFAULTS as any).clockCaption || '');
  // 2026-05-07 — live date in Blueprint's "YYYY-MM-DD" technical-drawing
  // format ("2026-04-21"). Operator override wins; empty/default → live.
  const liveDate = resolveHsDate(c, now, DEFAULTS.clockDate, (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  // 2026-05-07 — live weather (Open-Meteo via useLiveTemplateData).
  // Format matches Blueprint's all-caps technical-drawing aesthetic.
  const w = useHsLiveWeather({
    live,
    location: c.weatherLocation,
    unitsCelsius: c.weatherUnits === 'metric',
    tempOverride: c.weatherTemp,
    conditionOverride: c.weatherCondition,
    defaultTemp: DEFAULTS.weatherTemp,
    defaultCondition: DEFAULTS.weatherCondition,
    formatTemp: (t) => `${t}°`,
    formatCondition: (wmo) => describeWmo(wmo).toUpperCase(),
  });
  const events = [
    { time: c.event0Time, code: c.event0Code, name: c.event0Name, room: c.event0Room, who: c.event0Who },
    { time: c.event1Time, code: c.event1Code, name: c.event1Name, room: c.event1Room, who: c.event1Who },
    { time: c.event2Time, code: c.event2Code, name: c.event2Name, room: c.event2Room, who: c.event2Who },
  ];
  return (
    <HsStage
      stageRef={stageRef}
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
            <span className="hs-bp-logo-sub" data-field="schoolName" data-fit data-fit-min="14" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</span>
          </div>
        </div>
        <div className="hs-bp-cell">
          <div className="hs-bp-lbl" data-field="brandLabel1" data-fit data-fit-min="16" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandLabel1}</div>
          <div className="hs-bp-val" data-field="brandProject" data-fit data-fit-min="32" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandProject}</div>
        </div>
        <div className="hs-bp-cell">
          <div className="hs-bp-lbl" data-field="clockLabel" data-fit data-fit-min="16" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockLabel}</div>
          <div className="hs-bp-val" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <span data-field="clockDate" style={{ whiteSpace: 'pre-wrap' as const }}>{liveDate}</span> · <span data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{clock.time}</span>
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
        <div className="hs-bp-eyebrow" data-field="greetingEyebrow" data-fit data-fit-min="24" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
        <h1 className="hs-bp-h1" data-field="greetingHeadline" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline}</h1>
        <div className="hs-bp-sub" data-field="greetingSubtitle" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</div>
      </div>

      <div className="hs-bp-data">
        <div className="hs-bp-panel" data-sheet="A-01.1">
          <div className="hs-bp-kicker" data-field="clockbigLabel" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigLabel}</div>
          <div className="hs-bp-big" data-field="clockbigVal" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{(!c.clockbigVal || c.clockbigVal === DEFAULTS.clockbigVal) ? clock.time : c.clockbigVal}</div>
          <div className="hs-bp-cap" data-field="clockbigCap" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{(!c.clockbigCap || c.clockbigCap === DEFAULTS.clockbigCap) ? clock.caption : c.clockbigCap}</div>
        </div>
        <div className="hs-bp-panel" data-sheet="A-01.2">
          <div className="hs-bp-kicker">EXT. CONDITIONS</div>
          <div className="hs-bp-big" data-field="weatherTemp" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{w.tempLabel}</div>
          <div className="hs-bp-cap" data-field="weatherCondition" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{w.conditionLabel}</div>
        </div>
        <div className="hs-bp-panel" data-sheet="A-01.3">
          <div className="hs-bp-kicker">PRESENT</div>
          <div className="hs-bp-big" data-field="attendanceValue" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceValue}</div>
          <div className="hs-bp-cap" data-field="attendanceCap" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
        </div>
        <div className="hs-bp-panel" data-sheet="A-01.4">
          <div className="hs-bp-kicker" data-field="countdownLabel" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
          <div className="hs-bp-big" data-field="countdownValue" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
          <div className="hs-bp-cap" data-field="countdownSub" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
        </div>
      </div>

      <div className="hs-bp-sched">
        <div className="hs-bp-sched-head">
          <span>TIME</span><span>COURSE</span><span>SECTION</span><span>ROOM</span><span>INSTRUCTOR</span>
        </div>
        {events.map((e, i) => (
          <div key={i} className="hs-bp-sched-row">
            {/* 2026-05-07 — added data-field for click-to-edit on every cell. */}
            {/* 2026-05-08 — auto-fit on the variable-content columns
                (course code, course name, instructor) — the time +
                room columns are always short and stay at design size. */}
            <span className="hs-bp-t" data-field={`event${i}Time`} style={{ whiteSpace: 'pre-wrap' as const }}>{e.time}</span>
            <span className="hs-bp-c" data-field={`event${i}Code`} data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{e.code}</span>
            <span className="hs-bp-n" data-field={`event${i}Name`} data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{e.name}</span>
            <span className="hs-bp-r" data-field={`event${i}Room`} style={{ whiteSpace: 'pre-wrap' as const }}>{e.room}</span>
            <span className="hs-bp-w" data-field={`event${i}Who`} data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{e.who}</span>
          </div>
        ))}
      </div>

      <div className="hs-bp-specs">
        <div className="hs-bp-card hs-bp-spec" data-sheet="A-03 · FACULTY PROFILE">
          <div className="hs-bp-portrait"><div className="hs-bp-num" data-field="teacherNum" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherNum}</div></div>
          <div>
            <div className="hs-bp-kicker" data-field="teacherLabel" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherLabel}</div>
            <h2 className="hs-bp-h2" data-field="teacherName" data-fit data-fit-min="40" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherName}</h2>
            <div className="hs-bp-meta" data-field="teacherMeta" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherMeta}</div>
            <div className="hs-bp-quote" data-field="teacherQuote" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherQuote}</div>
          </div>
        </div>
        <div className="hs-bp-card hs-bp-alert" data-sheet="A-04 · ADVISORY">
          <div className="hs-bp-kicker hs-bp-alert-kicker" data-field="announcementTag" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementTag}</div>
          <h3 className="hs-bp-alert-h3" data-field="announcementHeadline" data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
          <p className="hs-bp-alert-p" data-field="announcementBody" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
          <div className="hs-bp-when" data-field="announcementDate" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementDate}</div>
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
.hs-bp-titleblock { position: absolute; top: 40px; left: 40px; right: 40px; height: 200px; border: 3px solid #6ab6ff; display: grid; grid-template-columns: 420px 1fr 620px 420px; background: rgba(10,40,82,.6); }
.hs-bp-cell { border-right: 2px solid #6ab6ff; padding: 14px 28px; display: flex; flex-direction: column; justify-content: center; }
.hs-bp-cell:last-child { border-right: 0; }
.hs-bp-lbl { font-family: 'JetBrains Mono', monospace; font-size: 30px; letter-spacing: .2em; color: #6ab6ff; text-transform: uppercase; opacity: .85; }
.hs-bp-val { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 64px; color: #eaf3ff; letter-spacing: .02em; line-height: 1; margin-top: 6px; }
.hs-bp-logo { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 110px; color: #ffd84d; line-height: .9; letter-spacing: .02em; }
.hs-bp-logo-sub { display: block; font-family: 'JetBrains Mono', monospace; font-size: 28px; letter-spacing: .25em; color: #eaf3ff; margin-top: 6px; opacity: .8; font-weight: 500; }
.hs-bp-rev { background: #ffd84d; color: #0a2852; }
.hs-bp-rev .hs-bp-lbl { color: #0a2852; opacity: 1; }
.hs-bp-rev .hs-bp-val { color: #0a2852; font-size: 52px; }
.hs-bp-hero { position: absolute; top: 280px; left: 40px; width: 2300px; height: 800px; border: 3px solid #6ab6ff; background: rgba(10,40,82,.3); padding: 50px 70px; }
.hs-bp-hero::before { content: 'SHEET A-01'; position: absolute; top: -18px; left: 40px; background: #0f3a7a; padding: 0 14px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; letter-spacing: .26em; color: #ffd84d; text-transform: uppercase; }
.hs-bp-eyebrow { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 44px; letter-spacing: .24em; color: #ffd84d; text-transform: uppercase; margin-bottom: 16px; }
.hs-bp-h1 { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 280px; line-height: .88; letter-spacing: -.02em; margin: 0; color: #eaf3ff; }
.hs-bp-sub { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 52px; color: #6ab6ff; line-height: 1.2; margin-top: 24px; max-width: 1900px; }
.hs-bp-dim { position: absolute; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #ffd84d; letter-spacing: .16em; text-transform: uppercase; pointer-events: none; }
.hs-bp-dim-top { top: 18px; left: 80px; right: 80px; text-align: center; border-top: 1px dashed #ffd84d; padding-top: 10px; }
.hs-bp-dim-top::before, .hs-bp-dim-top::after { content: ''; position: absolute; top: -8px; width: 2px; height: 16px; background: #ffd84d; }
.hs-bp-dim-top::before { left: 0; }
.hs-bp-dim-top::after { right: 0; }
.hs-bp-dim-left { top: 80px; bottom: 80px; left: 18px; writing-mode: vertical-rl; text-align: center; border-left: 1px dashed #ffd84d; padding-left: 10px; display: flex; align-items: center; justify-content: center; }
.hs-bp-data { position: absolute; top: 280px; right: 40px; width: 1420px; height: 800px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 28px; }
.hs-bp-panel { border: 3px solid #6ab6ff; background: rgba(10,40,82,.45); padding: 24px 28px; position: relative; overflow: hidden; }
.hs-bp-panel::before { content: attr(data-sheet); position: absolute; top: -18px; left: 24px; background: #0f3a7a; padding: 0 12px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #ffd84d; letter-spacing: .24em; text-transform: uppercase; }
.hs-bp-kicker { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 34px; color: #6ab6ff; letter-spacing: .2em; text-transform: uppercase; }
.hs-bp-big { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 180px; line-height: .9; color: #eaf3ff; letter-spacing: -.02em; margin-top: 8px; }
.hs-bp-cap { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 38px; color: #6ab6ff; margin-top: 8px; line-height: 1.2; }
.hs-bp-sched { position: absolute; top: 1110px; left: 40px; right: 40px; height: 460px; border: 3px solid #6ab6ff; background: rgba(10,40,82,.3); padding: 36px 48px; }
.hs-bp-sched::before { content: 'SHEET A-02 · SCHEDULE'; position: absolute; top: -18px; left: 40px; background: #0f3a7a; padding: 0 14px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #ffd84d; letter-spacing: .24em; }
.hs-bp-sched-head { display: grid; grid-template-columns: 200px 240px 1fr 200px 320px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; color: #ffd84d; letter-spacing: .2em; text-transform: uppercase; border-bottom: 2px solid #6ab6ff; padding-bottom: 14px; margin-bottom: 8px; }
.hs-bp-sched-row { display: grid; grid-template-columns: 200px 240px 1fr 200px 320px; padding: 14px 0; border-bottom: 1px dashed rgba(106,182,255,.3); align-items: center; }
.hs-bp-sched-row:last-child { border-bottom: 0; }
.hs-bp-t { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 48px; color: #ffd84d; }
.hs-bp-c { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 34px; color: #6ab6ff; letter-spacing: .06em; }
.hs-bp-n { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 48px; color: #eaf3ff; letter-spacing: .02em; }
.hs-bp-r { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 40px; color: #ffd84d; }
.hs-bp-w { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 34px; color: #6ab6ff; }
.hs-bp-specs { position: absolute; top: 1600px; left: 40px; right: 40px; height: 472px; display: grid; grid-template-columns: 1.1fr 1fr; gap: 28px; }
.hs-bp-card { border: 3px solid #6ab6ff; background: rgba(10,40,82,.45); padding: 28px 36px; position: relative; overflow: hidden; }
.hs-bp-card::before { content: attr(data-sheet); position: absolute; top: -18px; left: 32px; background: #0f3a7a; padding: 0 12px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #ffd84d; letter-spacing: .24em; }
.hs-bp-spec { display: grid; grid-template-columns: 280px 1fr; gap: 28px; align-items: start; }
.hs-bp-portrait { width: 280px; height: 340px; background: rgba(106,182,255,.12); border: 2px dashed #6ab6ff; position: relative; display: grid; place-items: center; }
.hs-bp-num { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 220px; color: #ffd84d; opacity: .4; line-height: .8; }
.hs-bp-h2 { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 96px; line-height: .88; color: #eaf3ff; margin: 4px 0 4px; letter-spacing: -.01em; }
.hs-bp-meta { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 30px; color: #6ab6ff; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 12px; }
.hs-bp-quote { font-family: 'Archivo', sans-serif; font-style: italic; font-weight: 500; font-size: 42px; color: #eaf3ff; line-height: 1.2; border-left: 3px solid #ffd84d; padding-left: 22px; }
.hs-bp-alert-kicker { color: #ff6a5e; }
.hs-bp-alert-h3 { font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 84px; line-height: .95; color: #ffd84d; margin: 8px 0 0; letter-spacing: -.01em; }
.hs-bp-alert-p { font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 38px; color: #6ab6ff; line-height: 1.2; margin: 10px 0 0; }
.hs-bp-when { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #ff6a5e; margin-top: 12px; letter-spacing: .16em; text-transform: uppercase; }
.hs-bp-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 88px; background: #ffd84d; color: #0a2852; display: flex; align-items: center; overflow: hidden; border-top: 3px solid #0a2852; }
.hs-bp-tk-tag { background: #0a2852; color: #ffd84d; height: 100%; display: flex; align-items: center; padding: 0 36px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 40px; letter-spacing: .24em; flex-shrink: 0; }
.hs-bp-tk-msg { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 42px; white-space: nowrap; padding-left: 36px; letter-spacing: .14em; text-transform: uppercase; animation: hsBpScroll 55s linear infinite; display: inline-flex; }
@keyframes hsBpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
