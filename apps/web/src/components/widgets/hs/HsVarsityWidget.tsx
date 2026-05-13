"use client";

/**
 * HsVarsityWidget — Athletic-department lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/varsity.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Widgets wired in the scene (each editable via PropertiesPanel):
 *   - seal          → school initials + est year
 *   - deptbar       → department label + school name
 *   - greeting      → good-morning eyebrow + headline + subtitle
 *   - scoreboard    → game-of-the-week (home vs away)
 *   - stats (×4)    → clock, weather, season record, attendance
 *   - teacher       → coach / teacher of the week + portrait number
 *   - announcement  → tag + headline + body + date
 *   - countdown     → days number + label
 *   - events (×3)   → schedule cards
 *   - ticker        → bottom scrolling PA announcement
 *
 * Every shape is REAL — jersey chest, scoreboard card with
 * cut-corner crests, stat panels, trophy-style countdown, jersey
 * number behind the coach portrait, pennant sway animation. No
 * rounded rectangles with shadows. If the CI / gallery thumbnail
 * looks flat, something is wrong with the port, not the design.
 */

import { useRef } from 'react';
import { HsStage } from './HsStage';
import { useHsLiveClock, resolveHsClock } from './useHsLiveClock';
import { useHsLiveWeather, describeWmo } from './useHsLiveWeather';
import { useAutoFitText } from './useAutoFitText';
import { useTextStyleOverrides } from './useTextStyleOverrides';

export interface HsVarsityConfig {
  schoolInitials?: string;
  schoolEst?: string;
  schoolName?: string;
  department?: string;
  greetingEyebrow?: string;
  greetingHeadline?: string;
  greetingSubtitle?: string;
  scoreboardTag?: string;
  scoreboardSport?: string;
  homeTeam?: string;
  homeAbbr?: string;
  awayTeam?: string;
  awayAbbr?: string;
  scoreboardTime?: string;
  scoreboardWhere?: string;
  clockTime?: string;
  clockCaption?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  /** ZIP/postal code for weather lookup. Empty → IP geolocation. */
  weatherLocation?: string;
  /** 'imperial' (°F) or 'metric' (°C). Default: imperial. */
  weatherUnits?: 'imperial' | 'metric';
  /** IANA timezone (e.g. 'America/Los_Angeles'). Empty → browser tz. */
  clockTimezone?: string;
  recordValue?: string;
  recordCaption?: string;
  attendanceValue?: string;
  attendanceCaption?: string;
  teacherLabel?: string;
  teacherName?: string;
  teacherGrade?: string;
  teacherQuote?: string;
  teacherNumber?: string | number;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  countdownValue?: string | number;
  countdownLabel?: string;
  countdownSub?: string;
  event1Mark?: string;
  event1When?: string;
  event1Name?: string;
  event2Mark?: string;
  event2When?: string;
  event2Name?: string;
  event3Mark?: string;
  event3When?: string;
  event3Name?: string;
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
   * Schema: { fontSize, fontFamily, color, bold, italic, underline,
   *   strikethrough, bgColor }
   */
  _styles?: Record<string, {
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

export const DEFAULTS: Required<HsVarsityConfig> = {
  schoolInitials: 'WHS',
  schoolEst: 'EST. 1956',
  schoolName: 'WESTRIDGE WILDCATS',
  department: 'ATHLETIC DEPARTMENT',
  greetingEyebrow: 'GOOD MORNING, WILDCATS',
  greetingHeadline: 'GAME DAY.',
  greetingSubtitle: 'Pack the gym tonight. Wear red. Be loud.',
  scoreboardTag: 'GAME OF THE WEEK',
  scoreboardSport: 'BASKETBALL · VARSITY',
  homeTeam: 'WILDCATS',
  homeAbbr: 'WHS',
  awayTeam: 'TIGERS',
  awayAbbr: 'CEN',
  scoreboardTime: 'TONIGHT · 7:00 PM',
  scoreboardWhere: 'HOME · GYM A',
  clockTime: '7:53',
  clockCaption: 'Tuesday · 1st period @ 8:05',
  weatherTemp: '46°',
  weatherCondition: 'Clear skies · hi 62°',
  weatherLocation: '',
  weatherUnits: 'imperial',
  clockTimezone: '',
  recordValue: '14–2',
  recordCaption: 'League leaders · 8-game streak',
  attendanceValue: '1,217',
  attendanceCaption: 'Enrolled · 98.2% present',
  teacherLabel: 'COACH / TEACHER OF THE WEEK',
  teacherName: 'COACH RIVERA',
  teacherGrade: 'HEAD COACH · VARSITY BB · AP U.S. HISTORY',
  teacherQuote: '"We don\'t chase perfect. We chase ready. Be ready today."',
  teacherNumber: 14,
  announcementTag: '★ HEADS UP',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD · GYM A',
  announcementBody: 'Seniors front row. Marching band enters from the south doors. Return to 8th period when the bell rings.',
  announcementDate: 'TODAY · 2:15 PM — 3:00 PM',
  countdownValue: '03',
  countdownLabel: 'DAYS TO HOMECOMING',
  countdownSub: 'TICKETS AT THE STUDENT STORE',
  event1Mark: 'MON',
  event1When: '7:00 PM · FIELD',
  event1Name: 'Boys Soccer vs. Central',
  event2Mark: 'WED',
  event2When: '3:30 PM · TRACK',
  event2Name: 'Meet — 4 Schools Invite',
  event3Mark: 'FRI',
  event3When: '6:00 PM · GYM A',
  event3Name: 'Senior Night — Volleyball',
  tickerTag: 'PA SYSTEM',
  tickerMessage: 'SENIORS — CAP & GOWN PICKUP THIS WEEK IN THE COUNSELING OFFICE  ●  BUS 14 RUNNING 10 MIN LATE  ●  MATHLETES PRACTICE MOVED TO ROOM 102  ●  SPRING SPORTS PHOTOS TOMORROW — WEAR YOUR JERSEY  ●  ',
  _styles: {},
};

export function HsVarsityWidget({ config, live }: { config?: HsVarsityConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsVarsityConfig>;
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 2026-05-08 — auto-fit: shrinks fontSize on data-fit text elements
  // when their parent container would overflow. Manual `_styles[field].fontSize`
  // override always wins. BuilderZone's CSS injection paints the override
  // with !important so the auto-fit's inline fontSize loses cleanly.
  useAutoFitText(stageRef, c._styles as any);
  useTextStyleOverrides(stageRef, c._styles as any);
  // 2026-05-07 — live clock. Replaces the hardcoded "7:53" /
  // "Tuesday · 1st period @ 8:05" placeholder so the demo wall
  // shows real time on every screen. Operator can still override
  // clockTime / clockCaption to freeze for marketing screenshots.
  const now = useHsLiveClock(live !== false);
  const clock = resolveHsClock(c, now, DEFAULTS.clockTime, DEFAULTS.clockCaption);
  // 2026-05-07 — live weather. Format: '46°' + 'Clear skies · hi 62°'
  // sentence-case (Varsity's friendly stadium aesthetic). Live API
  // doesn't include high/low so condition collapses to just 'Clear skies'.
  const w = useHsLiveWeather({
    live,
    location: c.weatherLocation,
    unitsCelsius: c.weatherUnits === 'metric',
    tempOverride: c.weatherTemp,
    conditionOverride: c.weatherCondition,
    defaultTemp: DEFAULTS.weatherTemp,
    defaultCondition: DEFAULTS.weatherCondition,
    formatTemp: (t) => `${t}°`,
    formatCondition: (wmo) => `${describeWmo(wmo)} skies`,
  });
  return (
    <HsStage
      stageRef={stageRef}
      stageStyle={{
        background: 'linear-gradient(135deg, #0d1b3d 0%, #18306b 60%, #0a1432 100%)',
        fontFamily: "'Inter', sans-serif",
        color: '#fff',
      }}
    >
      <style>{CSS}</style>
      {/* Diagonal pitch stripe overlay */}
      <div className="hs-varsity-stripes" />

      {/* Seal (school initials + est year) */}
      <div className="hs-varsity-seal">
        <div>
          <span data-field="schoolInitials" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolInitials}</span>
          <br />
          <span className="hs-varsity-seal-est" data-field="schoolEst" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolEst}</span>
        </div>
      </div>

      {/* Pennants */}
      <div className="hs-varsity-pennants">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className="hs-varsity-pennant"
            style={{ background: i % 2 === 0 ? '#ffc42b' : '#e03b1c' }}
          />
        ))}
      </div>

      {/* Department bar */}
      <div className="hs-varsity-deptbar">
        <div className="hs-varsity-dept" data-field="department" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.department}</div>
        <div className="hs-varsity-name" data-field="schoolName" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</div>
      </div>

      {/* Jersey row: greeting + scoreboard */}
      <div className="hs-varsity-jersey">
        <div className="hs-varsity-chest">
          <div>
            <div className="hs-varsity-eyebrow" data-field="greetingEyebrow" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
            <h1 className="hs-varsity-h1" data-field="greetingHeadline" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline}</h1>
            <div className="hs-varsity-sub" data-field="greetingSubtitle" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</div>
          </div>
        </div>
        <div className="hs-varsity-score">
          <div className="hs-varsity-score-hdr">
            <div>
              <span className="hs-varsity-score-dot" />
              <span data-field="scoreboardTag" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.scoreboardTag}</span>
            </div>
            <div data-field="scoreboardSport" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.scoreboardSport}</div>
          </div>
          <div className="hs-varsity-matchup">
            <div className="hs-varsity-team hs-varsity-team-home">
              <div className="hs-varsity-crest" data-field="homeAbbr" style={{ whiteSpace: 'pre-wrap' as const }}>{c.homeAbbr}</div>
              <div className="hs-varsity-tname" data-field="homeTeam" data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>{c.homeTeam}</div>
            </div>
            <div className="hs-varsity-vs">VS</div>
            <div className="hs-varsity-team hs-varsity-team-away">
              <div className="hs-varsity-tname" data-field="awayTeam" data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>{c.awayTeam}</div>
              <div className="hs-varsity-crest hs-varsity-crest-away" data-field="awayAbbr" style={{ whiteSpace: 'pre-wrap' as const }}>{c.awayAbbr}</div>
            </div>
          </div>
          <div className="hs-varsity-time">
            <span data-field="scoreboardTime" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.scoreboardTime}</span> · <span className="hs-varsity-where" data-field="scoreboardWhere" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.scoreboardWhere}</span>
          </div>
        </div>
      </div>

      {/* Stats row: clock / weather / record / attendance */}
      <div className="hs-varsity-stats">
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">LOCAL TIME</div>
          <div className="hs-varsity-stat-val" data-field="clockTime" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{clock.time}</div>
          <div className="hs-varsity-stat-cap" data-field="clockCaption" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{clock.caption}</div>
        </div>
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">GAMETIME FORECAST</div>
          <div className="hs-varsity-stat-val" data-field="weatherTemp" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{w.tempLabel}</div>
          <div className="hs-varsity-stat-cap" data-field="weatherCondition" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{w.conditionLabel}</div>
        </div>
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">SEASON RECORD</div>
          <div className="hs-varsity-stat-val" data-field="recordValue" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.recordValue}</div>
          <div className="hs-varsity-stat-cap" data-field="recordCaption" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.recordCaption}</div>
        </div>
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">TODAY&apos;S ATTENDANCE</div>
          <div className="hs-varsity-stat-val" data-field="attendanceValue" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceValue}</div>
          <div className="hs-varsity-stat-cap" data-field="attendanceCaption" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCaption}</div>
        </div>
      </div>

      {/* Coach / teacher of the week */}
      <div className="hs-varsity-coach">
        <div className="hs-varsity-portrait">
          <div className="hs-varsity-jersey-num" data-field="teacherNumber" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherNumber}</div>
        </div>
        <div>
          <div className="hs-varsity-eyebrow hs-varsity-coach-eyebrow" data-field="teacherLabel" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherLabel}</div>
          <h2 className="hs-varsity-h2" data-field="teacherName" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherName}</h2>
          <div className="hs-varsity-meta" data-field="teacherGrade" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherGrade}</div>
          <div className="hs-varsity-quote" data-field="teacherQuote" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherQuote}</div>
        </div>
      </div>

      {/* Announcement + countdown column */}
      <div className="hs-varsity-colright">
        <div className="hs-varsity-anno">
          <div className="hs-varsity-anno-tag" data-field="announcementTag" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementTag}</div>
          <h3 className="hs-varsity-anno-h3" data-field="announcementHeadline" data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
          <p className="hs-varsity-anno-p" data-field="announcementBody" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
          <div className="hs-varsity-anno-when" data-field="announcementDate" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementDate}</div>
        </div>
        <div className="hs-varsity-countdown">
          <div className="hs-varsity-cd-num" data-field="countdownValue" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
          <div className="hs-varsity-cd-lbl">
            <span data-field="countdownLabel" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</span>
            <br />
            <span className="hs-varsity-cd-sub" data-field="countdownSub" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</span>
          </div>
        </div>
      </div>

      {/* Schedule strip */}
      <div className="hs-varsity-sched">
        {[
          { mark: c.event1Mark, when: c.event1When, name: c.event1Name },
          { mark: c.event2Mark, when: c.event2When, name: c.event2Name },
          { mark: c.event3Mark, when: c.event3When, name: c.event3Name },
        ].map((e, i) => (
          <div key={i} className="hs-varsity-sch">
            <div className="hs-varsity-sch-mark">{e.mark}</div>
            <div className="hs-varsity-sch-info">
              <div className="hs-varsity-sch-d">{e.when}</div>
              <div className="hs-varsity-sch-n">{e.name}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Ticker */}
      <div className="hs-varsity-ticker">
        <div className="hs-varsity-ticker-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-varsity-ticker-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — keeps every pixel value identical to scratch/design/hs/varsity.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Bungee&family=Inter:wght@500;700&display=swap');

.hs-varsity-stripes {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: repeating-linear-gradient(-12deg, transparent 0 240px, rgba(255,196,43,.06) 240px 480px);
  pointer-events: none;
}
.hs-varsity-seal {
  position: absolute; top: 60px; left: 60px; width: 240px; height: 240px; z-index: 5;
  font-family: 'Bungee', sans-serif; font-size: 36px;
  display: grid; place-items: center; text-align: center; line-height: 1;
  color: #0d1b3d; background: #ffc42b;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  box-shadow: 0 20px 40px rgba(0,0,0,.4);
}
.hs-varsity-seal-est { font-size: 32px; letter-spacing: .2em; margin-top: 10px; color: #6b5110; display: inline-block; }

.hs-varsity-pennants {
  position: absolute; top: 10px; right: 340px; width: 1200px; height: 80px; z-index: 4; pointer-events: none;
}
.hs-varsity-pennant {
  display: inline-block; width: 60px; height: 70px; margin-right: 12px;
  clip-path: polygon(0 0, 100% 0, 50% 100%); transform-origin: top center;
  animation: hsVarSway 3s ease-in-out infinite;
}
.hs-varsity-pennant:nth-child(2n) { animation-delay: -.5s; animation-duration: 2.6s; }
.hs-varsity-pennant:nth-child(3n) { animation-delay: -1.2s; animation-duration: 3.4s; }
@keyframes hsVarSway { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }

.hs-varsity-deptbar {
  position: absolute; top: 80px; left: 340px; right: 60px; height: 200px;
  display: flex; align-items: flex-start; flex-direction: column; gap: 12px;
}
.hs-varsity-dept {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 52px; letter-spacing: .22em; color: #ffc42b; text-transform: uppercase;
}
.hs-varsity-name {
  font-family: 'Bungee', sans-serif; font-size: 140px; line-height: .9;
  letter-spacing: -.01em; color: #fff;
  text-shadow: 8px 8px 0 #e03b1c, 14px 14px 0 rgba(0,0,0,.4);
}

.hs-varsity-jersey {
  position: absolute; top: 360px; left: 60px; right: 60px; height: 580px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
}
.hs-varsity-chest {
  background: linear-gradient(180deg, #f4efe2, #e8e0c8);
  color: #0d1b3d; padding: 48px 60px; position: relative;
  border: 8px solid #0d1b3d;
  display: flex; flex-direction: column; justify-content: space-between;
}
.hs-varsity-chest::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 24px; background: #ffc42b; }
.hs-varsity-eyebrow {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 62px; letter-spacing: .18em; text-transform: uppercase; color: #e03b1c;
  margin-top: 32px;
}
.hs-varsity-h1 {
  font-family: 'Bungee', sans-serif; font-size: 220px; line-height: .9;
  margin: 12px 0; color: #0d1b3d; letter-spacing: -.02em; text-transform: uppercase;
}
.hs-varsity-sub {
  font-family: 'Oswald', sans-serif; font-weight: 500;
  font-size: 78px; color: #334155; margin: 0; line-height: 1.15;
}

.hs-varsity-score {
  background: #0a0e1c; border: 8px solid #ffc42b; padding: 28px 40px; position: relative;
  display: flex; flex-direction: column; justify-content: space-between;
}
.hs-varsity-score-hdr {
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 60px; letter-spacing: .2em; text-transform: uppercase; color: #ffc42b;
}
.hs-varsity-score-dot {
  width: 20px; height: 20px; border-radius: 50%; background: #e03b1c;
  display: inline-block; margin-right: 10px;
  animation: hsVarBlink 1.4s steps(2) infinite;
}
@keyframes hsVarBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .2; } }
.hs-varsity-matchup {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px;
  padding: 20px 0 10px;
}
.hs-varsity-team { display: flex; align-items: center; gap: 20px; }
.hs-varsity-team-home { justify-content: flex-start; }
.hs-varsity-team-away { justify-content: flex-end; }
.hs-varsity-crest {
  width: 140px; height: 140px; background: #ffc42b; display: grid; place-items: center;
  font-family: 'Bungee', sans-serif; font-size: 54px; color: #0d1b3d;
  clip-path: polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%);
}
.hs-varsity-crest-away { background: #e03b1c; color: #fff; }
.hs-varsity-tname {
  font-family: 'Bungee', sans-serif; font-size: 82px; line-height: .9;
  color: #fff; letter-spacing: -.01em;
}
.hs-varsity-vs {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 80px; color: #ffc42b; padding: 0 20px;
}
.hs-varsity-time {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 70px; text-align: center; color: #fff;
  border-top: 3px dashed rgba(255,196,43,.3);
  padding-top: 18px; margin-top: 14px;
  letter-spacing: .06em; text-transform: uppercase;
}
.hs-varsity-where { color: #ffc42b; }

.hs-varsity-stats {
  position: absolute; top: 970px; left: 60px; right: 60px; height: 320px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px;
}
.hs-varsity-stat { background: #0a0e1c; border: 6px solid rgba(255,196,43,.3); padding: 20px 28px; position: relative; }
.hs-varsity-stat-lbl { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 56px; letter-spacing: .2em; color: #ffc42b; text-transform: uppercase; }
.hs-varsity-stat-val { font-family: 'Bungee', sans-serif; font-size: 140px; line-height: .9; color: #fff; margin-top: 8px; letter-spacing: -.01em; }
.hs-varsity-stat-cap { font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 62px; color: #cbd5e1; margin-top: 8px; line-height: 1.15; }

.hs-varsity-coach {
  position: absolute; top: 1320px; left: 60px; width: 1720px; height: 580px;
  background: #f4efe2; color: #0d1b3d; padding: 36px 48px;
  display: grid; grid-template-columns: 420px 1fr; gap: 48px; align-items: center;
  border: 8px solid #0d1b3d;
}
.hs-varsity-coach::before { content: ''; position: absolute; top: -8px; left: -8px; right: -8px; height: 28px; background: #e03b1c; }
.hs-varsity-portrait { width: 420px; height: 520px; background: #cbd5e1; display: grid; place-items: center; overflow: hidden; position: relative; }
.hs-varsity-portrait::after { content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: repeating-linear-gradient(45deg, rgba(13,27,61,.08) 0 8px, transparent 8px 16px); }
.hs-varsity-jersey-num { font-family: 'Bungee', sans-serif; font-size: 320px; color: #0d1b3d; line-height: .85; opacity: .25; }
.hs-varsity-coach-eyebrow { color: #e03b1c; margin-top: 0; font-size: 62px; }
.hs-varsity-h2 { font-family: 'Bungee', sans-serif; font-size: 160px; line-height: .9; margin: 12px 0 8px; color: #0d1b3d; text-transform: uppercase; }
.hs-varsity-meta { font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 64px; color: #475569; letter-spacing: .08em; text-transform: uppercase; }
.hs-varsity-quote { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 78px; color: #334155; margin-top: 22px; font-style: italic; line-height: 1.2; max-width: 1100px; }

.hs-varsity-colright {
  position: absolute; top: 1320px; right: 60px; width: 1940px; display: grid; gap: 24px;
}
.hs-varsity-anno { background: #0a0e1c; border-left: 14px solid #ffc42b; padding: 24px 36px; }
.hs-varsity-anno-tag { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 62px; letter-spacing: .2em; color: #ffc42b; text-transform: uppercase; }
.hs-varsity-anno-h3 { font-family: 'Bungee', sans-serif; font-size: 88px; line-height: .95; margin: 10px 0 0; color: #fff; text-transform: uppercase; }
.hs-varsity-anno-p { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 72px; color: #cbd5e1; margin: 12px 0 0; line-height: 1.2; }
.hs-varsity-anno-when { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 58px; color: #ffc42b; letter-spacing: .12em; text-transform: uppercase; margin-top: 14px; }
.hs-varsity-countdown { background: #e03b1c; border-left: 14px solid #ffc42b; padding: 24px 36px; display: flex; align-items: center; gap: 40px; }
.hs-varsity-cd-num { font-family: 'Bungee', sans-serif; font-size: 220px; line-height: .8; color: #fff; text-shadow: 8px 8px 0 #0d1b3d; }
.hs-varsity-cd-lbl { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 56px; color: #fff; letter-spacing: .14em; text-transform: uppercase; line-height: 1.1; }
.hs-varsity-cd-sub { font-size: 56px; opacity: .85; }

.hs-varsity-sched {
  position: absolute; bottom: 110px; left: 60px; right: 60px; height: 220px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
}
.hs-varsity-sch { background: #0a0e1c; border: 4px solid #ffc42b; padding: 16px 28px; display: flex; align-items: center; gap: 24px; }
.hs-varsity-sch-mark { font-family: 'Bungee', sans-serif; font-size: 96px; line-height: .85; color: #ffc42b; padding-right: 22px; border-right: 3px dashed rgba(255,255,255,.2); }
.hs-varsity-sch-d { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 56px; color: #ffc42b; letter-spacing: .14em; text-transform: uppercase; }
.hs-varsity-sch-n { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 70px; color: #fff; text-transform: uppercase; line-height: 1; margin-top: 6px; }

.hs-varsity-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 100px;
  background: #ffc42b; color: #0d1b3d;
  display: flex; align-items: center; overflow: hidden;
}
.hs-varsity-ticker-tag {
  background: #0d1b3d; color: #ffc42b;
  font-family: 'Bungee', sans-serif; font-size: 58px; padding: 0 36px; height: 100%;
  display: flex; align-items: center; flex-shrink: 0; letter-spacing: .16em;
}
.hs-varsity-ticker-msg {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 64px;
  padding-left: 30px; white-space: nowrap; letter-spacing: .1em; text-transform: uppercase;
  animation: hsVarScroll 45s linear infinite; display: inline-flex; gap: 0;
}
@keyframes hsVarScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
