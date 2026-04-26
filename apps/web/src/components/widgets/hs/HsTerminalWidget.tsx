"use client";

/**
 * HsTerminalWidget — CRT-phosphor terminal lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/terminal.html
 * Ported via HsStage transform:scale pattern.
 *
 * Aesthetic: phosphor-green CRT monitor. Scanlines, radial vignette,
 * flicker animation. Every piece of text in monospace (JetBrains
 * Mono / VT323). Teacher card is framed as a `whoami --featured`
 * shell session; ticker is /var/log/syslog entries.
 *
 * Widgets wired (each editable via PropertiesPanel):
 *   - school / topbar  → host · path · session line
 *   - clock / weather  → top-right chips
 *   - greeting         → $ ./say-morning command + big VT323 banner + cursor
 *   - clockbig         → [ clock ] stat box
 *   - weatherd         → [ weatherd ] stat box
 *   - attendance       → [ attendance ] stat box
 *   - lunch            → [ lunch ] stat box
 *   - teacher          → whoami --featured card with key/value list
 *   - announcement     → [ ! priority ] WARN box
 *   - countdown        → [ countdown ] box with big VT323 number
 *   - events (×3)      → cron -l /var/school/events table
 *   - ticker           → /var/log/syslog bottom crawl
 */

import { HsStage } from './HsStage';

export interface HsTerminalConfig {
  schoolHost?: string;
  schoolPath?: string;
  schoolSession?: string;
  clockTime?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  greetingCmd?: string;
  greetingArg?: string;
  greetingHeadline?: string;
  greetingSubtitle?: string;
  clockbigVal?: string;
  clockbigCap?: string;
  weatherdVal?: string;
  weatherdCap?: string;
  attendanceVal?: string;
  attendanceCap?: string;
  lunchVal?: string;
  lunchCap?: string;
  teacherCmd?: string;
  teacherName?: string;
  teacherRole?: string;
  teacherRoom?: string;
  teacherYears?: string;
  teacherGroups?: string;
  teacherQuote?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  countdownValue?: string | number;
  countdownLabel?: string;
  countdownSub?: string;
  event1When?: string;
  event1Where?: string;
  event1Name?: string;
  event1Who?: string;
  event2When?: string;
  event2Where?: string;
  event2Name?: string;
  event2Who?: string;
  event3When?: string;
  event3Where?: string;
  event3Name?: string;
  event3Who?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

const DEFAULTS: Required<HsTerminalConfig> = {
  schoolHost: 'westridge-hs',
  schoolPath: '~/lobby/morning',
  schoolSession: 'session #2 · term spring-26',
  clockTime: '07:53:21',
  weatherTemp: '46°F',
  weatherCondition: 'clear',
  greetingCmd: './say-morning',
  greetingArg: '--to=everyone --loud',
  greetingHeadline: 'HELLO, WESTRIDGE.',
  greetingSubtitle: "okay — late passes reset, printers are up, the soda machine isn't. have a good one.",
  clockbigVal: '07:53',
  clockbigCap: 'tue · apr 21 · period 1 @ 08:05',
  weatherdVal: '46°F',
  weatherdCap: 'clear · hi 62 · lo 38 · wind 6mph',
  attendanceVal: '1217',
  attendanceCap: 'students checked in · 98.2%',
  lunchVal: 'chicken bowl',
  lunchCap: '+ salad bar · vegan option · $3.75',
  teacherCmd: 'whoami --featured',
  teacherName: 'ms.kowalski',
  teacherRole: 'teacher_of_week · ap physics',
  teacherRoom: '214 / science wing',
  teacherYears: "14 at WHS · alumna '02",
  teacherGroups: 'faculty, physics, science-olympiad-coach',
  teacherQuote: '"the answer is in the free-body diagram. draw the picture — every time. the math always follows."',
  announcementTag: 'pep rally scheduled',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD, GYM A',
  announcementBody: 'seniors front row. marching band enters from the south doors. return to 8th period when the bell rings. no backpacks in the gym.',
  announcementDate: 'today · 14:15 — 15:00 · gym-a',
  countdownValue: 41,
  countdownLabel: 'days until graduation',
  countdownSub: 'seniors — order caps by fri · 17:00',
  event1When: 'tue 15:30',
  event1Where: 'rm 102',
  event1Name: 'mathletes — regionals prep',
  event1Who: '@ms.devereaux',
  event2When: 'wed 19:00',
  event2Where: 'auditorium',
  event2Name: 'spring band concert — all grades',
  event2Who: '@mr.thornton',
  event3When: 'fri 19:00',
  event3Where: 'theater',
  event3Name: '"into the woods" — opening night',
  event3Who: '@ms.park',
  tickerTag: '/var/log/syslog',
  tickerMessage: '[info] bus-14 delayed 10m · [warn] printer rm-210 out of toner · [info] lost-and-found: silver earbuds · [info] ap psych study hall moved to library · [info] sports photos tomorrow — bring jerseys · ',
};

export function HsTerminalWidget({ config }: { config?: HsTerminalConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsTerminalConfig>;
  return (
    <HsStage
      stageStyle={{
        background: 'radial-gradient(ellipse at center, #0e2410 0%, #060f06 80%, #000 100%)',
        fontFamily: "'JetBrains Mono', monospace",
        color: '#9bff9b',
      }}
    >
      <style>{CSS}</style>
      <div className="hs-tm-scan" />
      <div className="hs-tm-vignette" />

      <div className="hs-tm-topbar">
        <div className="hs-tm-left">
          <span>
            <span className="hs-tm-dot" />
            <span className="hs-tm-host" data-field="schoolHost" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolHost}</span>
            <span className="hs-tm-sep">:</span>
            <span data-field="schoolPath" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolPath}</span>
            <span className="hs-tm-sep">$</span>
          </span>
          <span style={{ color: '#7adfff' }}>{c.schoolSession}</span>
        </div>
        <div className="hs-tm-right">
          <span data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</span>
          <span>
            <span className="hs-tm-on" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherTemp}</span> {c.weatherCondition}
          </span>
          <span className="hs-tm-on">UP 184d</span>
        </div>
      </div>

      <div className="hs-tm-prompt">
        <div className="hs-tm-line1">
          <span className="hs-tm-p">&gt; </span>
          <span data-field="greetingCmd" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingCmd}</span>{' '}
          <span className="hs-tm-arg" data-field="greetingArg" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingArg}</span>
        </div>
        <div className="hs-tm-banner">
          <span data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline}</span>
          <span className="hs-tm-cursor" />
        </div>
        <div className="hs-tm-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</div>
      </div>

      <div className="hs-tm-stats">
        <div className="hs-tm-stat" data-box="[ clock ]">
          <div className="hs-tm-big" data-field="clockbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigVal}</div>
          <div className="hs-tm-cap" data-field="clockbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigCap}</div>
        </div>
        <div className="hs-tm-stat" data-box="[ weatherd ]">
          <div className="hs-tm-big" data-field="weatherdVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherdVal}</div>
          <div className="hs-tm-cap" data-field="weatherdCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherdCap}</div>
        </div>
        <div className="hs-tm-stat" data-box="[ attendance ]">
          <div className="hs-tm-big" data-field="attendanceVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceVal}</div>
          <div className="hs-tm-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
        </div>
        <div className="hs-tm-stat" data-box="[ lunch ]">
          <div className="hs-tm-big" style={{ fontSize: 80, paddingTop: 24 }}>{c.lunchVal}</div>
          <div className="hs-tm-cap" data-field="lunchCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.lunchCap}</div>
        </div>
      </div>

      <div className="hs-tm-whoami">
        <div className="hs-tm-cmd">
          <span className="hs-tm-p">&gt; </span>
          <span data-field="teacherCmd" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherCmd}</span>
        </div>
        <div className="hs-tm-name" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherName}</div>
        <dl className="hs-tm-kv">
          <dt>role</dt><dd data-field="teacherRole" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherRole}</dd>
          <dt>room</dt><dd data-field="teacherRoom" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherRoom}</dd>
          <dt>years</dt><dd data-field="teacherYears" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherYears}</dd>
          <dt>groups</dt><dd data-field="teacherGroups" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherGroups}</dd>
        </dl>
        <div className="hs-tm-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherQuote}</div>
      </div>

      <div className="hs-tm-rightcol">
        <div className="hs-tm-box hs-tm-alert" data-box="[ ! priority ]">
          <div className="hs-tm-hd">&gt; WARN · {c.announcementTag}</div>
          <h3 className="hs-tm-alert-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
          <p className="hs-tm-alert-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
          <div className="hs-tm-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementDate}</div>
        </div>
        <div className="hs-tm-box" data-box="[ countdown ]">
          <div className="hs-tm-countdown">
            <div className="hs-tm-cd-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-tm-cd-lbl">
              <span data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</span>
              <span className="hs-tm-dim" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="hs-tm-events">
        <div className="hs-tm-evhead">
          <span>when</span><span>where</span><span>what</span><span>who</span>
        </div>
        {[
          { when: c.event1When, where: c.event1Where, name: c.event1Name, who: c.event1Who },
          { when: c.event2When, where: c.event2Where, name: c.event2Name, who: c.event2Who },
          { when: c.event3When, where: c.event3Where, name: c.event3Name, who: c.event3Who },
        ].map((e, i) => (
          <div key={i} className="hs-tm-evrow">
            <span className="hs-tm-evt">{e.when}</span>
            <span className="hs-tm-evd">{e.where}</span>
            <span className="hs-tm-evn">{e.name}</span>
            <span className="hs-tm-evl">{e.who}</span>
          </div>
        ))}
      </div>

      <div className="hs-tm-ticker">
        <div className="hs-tm-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-tm-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=VT323&display=swap');
.hs-tm-scan { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 2px, transparent 2px 4px); pointer-events: none; z-index: 3; }
.hs-tm-vignette { position: absolute; inset: 0; box-shadow: inset 0 0 400px rgba(0,0,0,.7); pointer-events: none; z-index: 2; }
.hs-tm-topbar { position: absolute; top: 40px; left: 40px; right: 40px; height: 80px; border: 3px solid #9bff9b; padding: 0 28px; display: flex; align-items: center; justify-content: space-between; font-size: 38px; letter-spacing: .08em; background: rgba(0,20,0,.4); }
.hs-tm-left { display: flex; gap: 36px; align-items: center; }
.hs-tm-host { color: #ffe37a; font-weight: 700; }
.hs-tm-sep { color: #4a7a4a; }
.hs-tm-right { display: flex; gap: 28px; color: #4a7a4a; font-weight: 500; }
.hs-tm-on { color: #9bff9b; }
.hs-tm-dot { width: 16px; height: 16px; background: #9bff9b; border-radius: 50%; display: inline-block; box-shadow: 0 0 20px #9bff9b; animation: hsTmPulse 1.8s infinite; margin-right: 12px; }
@keyframes hsTmPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.hs-tm-prompt { position: absolute; top: 160px; left: 40px; right: 40px; border: 3px solid #9bff9b; padding: 36px 44px; background: rgba(0,20,0,.35); }
.hs-tm-line1 { font-size: 36px; color: #4a7a4a; letter-spacing: .06em; }
.hs-tm-p { color: #9bff9b; }
.hs-tm-arg { color: #ffe37a; }
.hs-tm-banner { font-family: 'VT323', monospace; font-size: 260px; line-height: .88; color: #9bff9b; text-shadow: 0 0 40px rgba(155,255,155,.55), 0 0 80px rgba(155,255,155,.25); margin: 14px 0 8px; letter-spacing: -.01em; }
.hs-tm-cursor { display: inline-block; width: 60px; height: 220px; background: #9bff9b; vertical-align: middle; margin-left: 18px; animation: hsTmBlink 1s steps(2) infinite; box-shadow: 0 0 40px rgba(155,255,155,.7); }
@keyframes hsTmBlink { 50% { opacity: 0; } }
.hs-tm-sub { font-size: 40px; color: #9bff9b; opacity: .85; margin-top: 8px; letter-spacing: .03em; max-width: 3200px; }
.hs-tm-sub::before { content: '// '; color: #4a7a4a; }
.hs-tm-stats { position: absolute; top: 1020px; left: 40px; right: 40px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; }
.hs-tm-stat { border: 3px solid #9bff9b; padding: 24px 28px; background: rgba(0,20,0,.35); position: relative; }
.hs-tm-stat::before { content: attr(data-box); position: absolute; top: -20px; left: 30px; background: #081a08; padding: 0 14px; font-size: 22px; color: #ffe37a; letter-spacing: .2em; text-transform: uppercase; }
.hs-tm-big { font-family: 'VT323', monospace; font-size: 150px; line-height: .9; color: #9bff9b; text-shadow: 0 0 30px rgba(155,255,155,.5); margin: 2px 0; }
.hs-tm-cap { font-size: 28px; color: #4a7a4a; line-height: 1.3; }
.hs-tm-whoami { position: absolute; top: 1300px; left: 40px; width: 1700px; border: 3px solid #9bff9b; background: rgba(0,20,0,.35); padding: 24px 32px; }
.hs-tm-cmd { font-size: 32px; color: #4a7a4a; }
.hs-tm-name { font-family: 'VT323', monospace; font-size: 140px; line-height: .9; color: #ffe37a; text-shadow: 0 0 30px rgba(255,227,122,.5); margin: 18px 0 4px; }
.hs-tm-kv { display: grid; grid-template-columns: 240px 1fr; gap: 0 24px; margin: 14px 0 0; font-size: 32px; }
.hs-tm-kv dt { color: #4a7a4a; }
.hs-tm-kv dd { margin: 0; color: #9bff9b; }
.hs-tm-quote { border-left: 4px solid #ffe37a; padding-left: 22px; margin-top: 20px; font-size: 34px; color: #cfe9cf; font-style: italic; line-height: 1.35; }
.hs-tm-rightcol { position: absolute; top: 1300px; right: 40px; width: 2020px; display: grid; gap: 24px; }
.hs-tm-box { border: 3px solid #9bff9b; background: rgba(0,20,0,.35); padding: 24px 32px; position: relative; }
.hs-tm-box::before { content: attr(data-box); position: absolute; top: -20px; left: 30px; background: #081a08; padding: 0 14px; font-size: 22px; color: #ffe37a; letter-spacing: .2em; text-transform: uppercase; }
.hs-tm-alert { border-color: #ff7a7a; }
.hs-tm-alert::before { color: #ff7a7a; }
.hs-tm-hd { font-size: 30px; color: #ff7a7a; letter-spacing: .14em; }
.hs-tm-alert-h3 { font-family: 'VT323', monospace; font-size: 100px; line-height: .95; margin: 8px 0 0; color: #ffe37a; text-shadow: 0 0 30px rgba(255,227,122,.45); }
.hs-tm-alert-p { font-size: 28px; color: #cfe9cf; margin: 10px 0 0; line-height: 1.35; }
.hs-tm-when { font-size: 28px; color: #ff7a7a; margin-top: 10px; letter-spacing: .12em; }
.hs-tm-countdown { display: grid; grid-template-columns: auto 1fr; gap: 30px; align-items: center; }
.hs-tm-cd-val { font-family: 'VT323', monospace; font-size: 260px; line-height: .8; color: #ffe37a; text-shadow: 0 0 40px rgba(255,227,122,.6); }
.hs-tm-cd-lbl { font-size: 36px; color: #9bff9b; line-height: 1.2; }
.hs-tm-dim { color: #4a7a4a; display: block; font-size: 28px; margin-top: 8px; }
.hs-tm-events { position: absolute; bottom: 140px; left: 40px; right: 40px; height: 300px; border: 3px solid #9bff9b; background: rgba(0,20,0,.35); padding: 24px 32px; }
.hs-tm-events::before { content: '[ cron -l /var/school/events ]'; position: absolute; top: -20px; left: 30px; background: #081a08; padding: 0 14px; font-size: 22px; color: #ffe37a; letter-spacing: .14em; }
.hs-tm-evhead { font-size: 26px; color: #4a7a4a; letter-spacing: .14em; display: grid; grid-template-columns: 220px 260px 1fr 260px; padding-bottom: 8px; border-bottom: 2px solid rgba(155,255,155,.35); }
.hs-tm-evrow { display: grid; grid-template-columns: 220px 260px 1fr 260px; font-size: 32px; color: #9bff9b; padding: 10px 0; border-bottom: 1px dashed rgba(155,255,155,.22); }
.hs-tm-evrow:last-child { border-bottom: 0; }
.hs-tm-evt { color: #4a7a4a; }
.hs-tm-evd { color: #ffe37a; letter-spacing: .1em; }
.hs-tm-evn { color: #9bff9b; }
.hs-tm-evl { color: #7adfff; text-align: right; }
.hs-tm-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 80px; background: #9bff9b; color: #061506; display: flex; align-items: center; overflow: hidden; border-top: 3px solid #000; }
.hs-tm-tk-tag { background: #061506; color: #9bff9b; height: 100%; display: flex; align-items: center; padding: 0 34px; font-weight: 700; font-size: 28px; letter-spacing: .16em; flex-shrink: 0; }
.hs-tm-tk-msg { font-weight: 700; font-size: 28px; padding-left: 40px; white-space: nowrap; letter-spacing: .08em; animation: hsTmScroll 60s linear infinite; text-transform: uppercase; display: inline-flex; }
@keyframes hsTmScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
