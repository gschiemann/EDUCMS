"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsTerminalPortraitWidget — CRT-phosphor terminal lobby in 2160×3840
 * portrait. Companion to HsTerminalWidget (3840×2160 landscape). Same
 * configuration shape; the layout is re-flowed vertically as a stack
 * of terminal sessions.
 *
 * Aesthetic: phosphor-green CRT monitor. Scanlines, radial vignette,
 * flicker animation. VT323 + IBM Plex Mono throughout. Phosphor glow
 * via text-shadow on every primary text element.
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~  0– 600px : ASCII banner — host:path$ prompt, VT323 school name
 *                  with blinking cursor, uptime pill
 *   ~ 600–1280px : `$ whoami` teacher card — multi-line role/dept/email
 *                  /office-hours output styled as terminal output
 *   ~1280–2540px : `$ crontab -l` event log — full-width monospaced
 *                  table with [CRON] prefixes, /classrooms/A-203 paths,
 *                  dashed leader lines
 *   ~2540–3140px : `$ tail /var/log/announcements` — scrolling
 *                  announcement feed in monospace
 *   ~3140–3550px : `$ uname -a` facts strip — small system-info-style
 *                  key:value pairs (DAY, BLOCK, BUILDING)
 *   ~3550–3840px : full-width syslog ticker — [INFO]/[WARN] prefixes
 *
 * Every pixel size is FIXED at the 2160×3840 canvas. HsStage scales
 * the whole stage to whatever the actual viewport is. DO NOT regress
 * to vw / % units inside the stage — the editor and player will both
 * misrender if you do.
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

type Cfg = HsTerminalConfig;

const DEFAULTS: Required<Cfg> = {
  schoolHost: 'westridge-hs',
  schoolPath: '~/lobby/morning',
  schoolSession: 'session #2 · term spring-26',
  clockTime: '07:53:21',
  weatherTemp: '46°F',
  weatherCondition: 'clear',
  greetingCmd: './say-morning',
  greetingArg: '--to=everyone --loud',
  greetingHeadline: 'WESTRIDGE',
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
  event1Where: '/classrooms/a-203',
  event1Name: 'mathletes — regionals prep',
  event1Who: '@ms.devereaux',
  event2When: 'wed 19:00',
  event2Where: '/auditorium',
  event2Name: 'spring band concert — all grades',
  event2Who: '@mr.thornton',
  event3When: 'fri 19:00',
  event3Where: '/theater',
  event3Name: '"into the woods" — opening night',
  event3Who: '@ms.park',
  tickerTag: '/var/log/syslog',
  tickerMessage: '[INFO] bus-14 delayed 10m · [WARN] printer rm-210 out of toner · [INFO] lost-and-found: silver earbuds · [INFO] ap psych study hall moved to library · [INFO] sports photos tomorrow — bring jerseys · ',
};

export function HsTerminalPortraitWidget({ config }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const events = [
    { when: c.event1When, where: c.event1Where, name: c.event1Name, who: c.event1Who },
    { when: c.event2When, where: c.event2Where, name: c.event2Name, who: c.event2Who },
    { when: c.event3When, where: c.event3Where, name: c.event3Name, who: c.event3Who },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: 'radial-gradient(ellipse at center, #0e2410 0%, #060f06 80%, #000 100%)',
        fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
        color: '#9bff9b',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
      />
      <style>{CSS}</style>

      {/* CRT overlays */}
      <div className="hs-tp-scan" />
      <div className="hs-tp-vignette" />
      <div className="hs-tp-flicker" />

      {/* ============================ REGION 1: ASCII BANNER ~0-600 ============================ */}
      <div className="hs-tp-topbar">
        <div className="hs-tp-topbar-left">
          <span className="hs-tp-dot" />
          <span className="hs-tp-host" data-field="schoolHost" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolHost}
          </span>
          <span className="hs-tp-sep">:</span>
          <span data-field="schoolPath" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolPath}
          </span>
          <span className="hs-tp-sep">$</span>
        </div>
        <div className="hs-tp-topbar-right">
          <span className="hs-tp-uptime">UP 184d</span>
        </div>
      </div>

      <div className="hs-tp-banner-wrap">
        <div className="hs-tp-prompt-line">
          <span className="hs-tp-p">&gt; </span>
          <span data-field="greetingCmd" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingCmd}
          </span>{' '}
          <span className="hs-tp-arg" data-field="greetingArg" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingArg}
          </span>
        </div>
        <div className="hs-tp-banner">
          <span data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingHeadline}
          </span>
          <span className="hs-tp-cursor" />
        </div>
        <div className="hs-tp-session">
          <span style={{ color: '#7adfff' }} data-field="schoolSession">
            {c.schoolSession}
          </span>
          <span className="hs-tp-sep"> · </span>
          <span data-field="clockTime">{c.clockTime}</span>
          <span className="hs-tp-sep"> · </span>
          <span className="hs-tp-on" data-field="weatherTemp">{c.weatherTemp}</span>{' '}
          <span data-field="weatherCondition">{c.weatherCondition}</span>
        </div>
      </div>

      {/* ============================ REGION 2: $ whoami CARD ~600-1280 ============================ */}
      <div className="hs-tp-whoami" data-box="[ whoami --featured ]">
        <div className="hs-tp-cmdline">
          <span className="hs-tp-p">$ </span>
          <span data-field="teacherCmd" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherCmd}
          </span>
        </div>
        <div className="hs-tp-name" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherName}
        </div>
        <dl className="hs-tp-kv">
          <dt>role</dt>
          <dd data-field="teacherRole" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherRole}
          </dd>
          <dt>room</dt>
          <dd data-field="teacherRoom" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherRoom}
          </dd>
          <dt>years</dt>
          <dd data-field="teacherYears" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherYears}
          </dd>
          <dt>groups</dt>
          <dd data-field="teacherGroups" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherGroups}
          </dd>
        </dl>
        <div className="hs-tp-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherQuote}
        </div>
      </div>

      {/* ============================ REGION 3: $ crontab -l EVENTS ~1280-2540 ============================ */}
      <div className="hs-tp-events" data-box="[ crontab -l /var/school/events ]">
        <div className="hs-tp-cmdline">
          <span className="hs-tp-p">$ </span>
          <span>crontab -l</span>
        </div>

        <div className="hs-tp-evheader">
          <span className="hs-tp-evcol-pre">tag</span>
          <span className="hs-tp-evcol-when">when</span>
          <span className="hs-tp-evcol-name">what</span>
        </div>

        {events.map((e, i) => (
          <div key={i} className="hs-tp-evrow">
            <div className="hs-tp-evrow-line1">
              <span className="hs-tp-evpre">[CRON]</span>
              <span className="hs-tp-evwhen">{e.when}</span>
              <span className="hs-tp-evdash" aria-hidden="true">
                {' '}
                {'·'.repeat(28)}{' '}
              </span>
              <span className="hs-tp-evwho">{e.who}</span>
            </div>
            <div className="hs-tp-evrow-line2">
              <span className="hs-tp-evname">{e.name}</span>
              <span className="hs-tp-evpath">{e.where}</span>
            </div>
          </div>
        ))}

        <div className="hs-tp-countdown-row">
          <span className="hs-tp-cd-pre">[CRON] 0 0 * * *</span>
          <span className="hs-tp-cd-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.countdownValue}
          </span>
          <span className="hs-tp-cd-lbl">
            <span data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownLabel}
            </span>
            <span className="hs-tp-cd-sub" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownSub}
            </span>
          </span>
        </div>
      </div>

      {/* ============================ REGION 4: $ tail /var/log/announcements ~2540-3140 ============================ */}
      <div className="hs-tp-anno" data-box="[ tail -f /var/log/announcements ]">
        <div className="hs-tp-cmdline">
          <span className="hs-tp-p">$ </span>
          <span>tail -f /var/log/announcements</span>
        </div>

        <div className="hs-tp-anno-tag">
          <span className="hs-tp-warn">[WARN]</span>{' '}
          <span data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementTag}
          </span>
        </div>
        <h3
          className="hs-tp-anno-h3"
          data-field="announcementHeadline"
          style={{ whiteSpace: 'pre-wrap' as const }}
        >
          {c.announcementHeadline}
        </h3>
        <p className="hs-tp-anno-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementBody}
        </p>
        <div className="hs-tp-anno-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>
          &gt; {c.announcementDate}
        </div>
      </div>

      {/* ============================ REGION 5: $ uname -a FACTS STRIP ~3140-3550 ============================ */}
      <div className="hs-tp-uname" data-box="[ uname -a ]">
        <div className="hs-tp-cmdline">
          <span className="hs-tp-p">$ </span>
          <span>uname -a</span>
        </div>
        <div className="hs-tp-uname-grid">
          <div className="hs-tp-fact">
            <div className="hs-tp-fact-key">CLOCK</div>
            <div className="hs-tp-fact-val" data-field="clockbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.clockbigVal}
            </div>
            <div className="hs-tp-fact-sub" data-field="clockbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.clockbigCap}
            </div>
          </div>
          <div className="hs-tp-fact">
            <div className="hs-tp-fact-key">WEATHERD</div>
            <div className="hs-tp-fact-val" data-field="weatherdVal" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.weatherdVal}
            </div>
            <div className="hs-tp-fact-sub" data-field="weatherdCap" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.weatherdCap}
            </div>
          </div>
          <div className="hs-tp-fact">
            <div className="hs-tp-fact-key">ROLLCALL</div>
            <div className="hs-tp-fact-val" data-field="attendanceVal" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.attendanceVal}
            </div>
            <div className="hs-tp-fact-sub" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.attendanceCap}
            </div>
          </div>
          <div className="hs-tp-fact">
            <div className="hs-tp-fact-key">CHOW</div>
            <div className="hs-tp-fact-val hs-tp-fact-val-sm" data-field="lunchVal" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.lunchVal}
            </div>
            <div className="hs-tp-fact-sub" data-field="lunchCap" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.lunchCap}
            </div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 6: SYSLOG TICKER ~3550-3840 ============================ */}
      <div className="hs-tp-ticker">
        <div className="hs-tp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-tp-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.tickerMessage}
          </span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.tickerMessage}
          </span>
        </div>
      </div>

      {/* sub-pixel flicker overlay */}
      <div className="hs-tp-overlay" />
    </HsStage>
  );
}

/** Inlined CSS — every pixel is sized for the 2160×3840 portrait stage. */
const CSS = `
.hs-tp-scan {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 3px, transparent 3px 6px);
  pointer-events: none; z-index: 5;
  animation: hsTpScanDrift 9s linear infinite;
}
@keyframes hsTpScanDrift { from { background-position: 0 0; } to { background-position: 0 6px; } }
.hs-tp-vignette {
  position: absolute; inset: 0;
  box-shadow: inset 0 0 480px rgba(0,0,0,.78);
  pointer-events: none; z-index: 4;
}
.hs-tp-flicker {
  position: absolute; inset: 0;
  background: rgba(155,255,155,.02);
  pointer-events: none; z-index: 6;
  animation: hsTpFlicker 4.2s steps(2) infinite;
}
@keyframes hsTpFlicker {
  0%, 96%, 100% { opacity: 1; }
  97%, 98% { opacity: .55; }
  99% { opacity: .85; }
}
.hs-tp-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(155,255,155,.04) 0%, transparent 30%, transparent 70%, rgba(155,255,155,.04) 100%);
  pointer-events: none; z-index: 3;
}

/* ----- common terminal type ----- */
.hs-tp-p { color: #9bff9b; }
.hs-tp-sep { color: #4a7a4a; }
.hs-tp-arg { color: #ffe37a; }
.hs-tp-on { color: #9bff9b; }
.hs-tp-host { color: #ffe37a; font-weight: 700; }
.hs-tp-warn { color: #ff7a7a; font-weight: 700; letter-spacing: .12em; }
.hs-tp-dot {
  width: 22px; height: 22px; background: #9bff9b; border-radius: 50%;
  display: inline-block; margin-right: 18px;
  box-shadow: 0 0 28px #9bff9b;
  animation: hsTpPulse 1.8s infinite;
}
@keyframes hsTpPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

/* ----- REGION 1: top bar + ASCII banner ----- */
.hs-tp-topbar {
  position: absolute; top: 40px; left: 50px; right: 50px; height: 110px;
  border: 4px solid #9bff9b; padding: 0 36px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 46px; letter-spacing: .08em;
  background: rgba(0,20,0,.4);
  z-index: 2;
}
.hs-tp-topbar-left {
  display: flex; align-items: center; gap: 22px;
  color: #4a7a4a;
}
.hs-tp-uptime {
  color: #9bff9b; font-weight: 700;
  background: rgba(155,255,155,.12);
  border: 2px solid #9bff9b;
  padding: 8px 22px;
  text-shadow: 0 0 12px rgba(155,255,155,.5);
}

.hs-tp-banner-wrap {
  position: absolute; top: 190px; left: 50px; right: 50px; height: 380px;
  border: 4px solid #9bff9b;
  background: rgba(0,20,0,.4);
  padding: 32px 44px;
  z-index: 2;
}
.hs-tp-prompt-line {
  font-size: 42px; color: #4a7a4a; letter-spacing: .06em;
}
.hs-tp-banner {
  font-family: 'VT323', monospace;
  font-size: 280px; line-height: .9;
  color: #9bff9b;
  text-shadow:
    0 0 36px rgba(155,255,155,.65),
    0 0 80px rgba(155,255,155,.35),
    0 0 130px rgba(155,255,155,.15);
  margin-top: 6px;
  letter-spacing: -.005em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
}
.hs-tp-cursor {
  display: inline-block; width: 64px; height: 220px;
  background: #9bff9b; vertical-align: -28px;
  margin-left: 22px;
  box-shadow: 0 0 36px rgba(155,255,155,.8);
  animation: hsTpBlink 1s steps(2) infinite;
}
@keyframes hsTpBlink { 50% { opacity: 0; } }
.hs-tp-session {
  margin-top: 6px;
  font-size: 32px;
  color: #9bff9b; opacity: .85;
  letter-spacing: .08em;
}

/* ----- REGION 2: whoami teacher card ----- */
.hs-tp-whoami {
  position: absolute; top: 620px; left: 50px; right: 50px; height: 620px;
  border: 4px solid #9bff9b;
  background: rgba(0,20,0,.4);
  padding: 36px 48px;
  z-index: 2;
}
.hs-tp-whoami::before,
.hs-tp-events::before,
.hs-tp-anno::before,
.hs-tp-uname::before {
  content: attr(data-box);
  position: absolute; top: -22px; left: 36px;
  background: #081a08; padding: 0 18px;
  font-size: 28px; color: #ffe37a;
  letter-spacing: .2em; text-transform: uppercase;
  text-shadow: 0 0 12px rgba(255,227,122,.4);
}
.hs-tp-cmdline {
  font-size: 38px; color: #4a7a4a;
  letter-spacing: .05em;
}
.hs-tp-name {
  font-family: 'VT323', monospace;
  font-size: 180px; line-height: .9;
  color: #ffe37a;
  text-shadow:
    0 0 32px rgba(255,227,122,.55),
    0 0 80px rgba(255,227,122,.25);
  margin: 14px 0 18px;
}
.hs-tp-kv {
  display: grid; grid-template-columns: 280px 1fr;
  gap: 8px 28px; margin: 0;
  font-size: 36px;
}
.hs-tp-kv dt { color: #4a7a4a; }
.hs-tp-kv dd { margin: 0; color: #9bff9b; text-shadow: 0 0 10px rgba(155,255,155,.4); }
.hs-tp-quote {
  border-left: 6px solid #ffe37a;
  padding-left: 26px;
  margin-top: 24px;
  font-size: 36px;
  color: #cfe9cf; font-style: italic; line-height: 1.32;
}

/* ----- REGION 3: crontab -l events ----- */
.hs-tp-events {
  position: absolute; top: 1300px; left: 50px; right: 50px; height: 1180px;
  border: 4px solid #9bff9b;
  background: rgba(0,20,0,.4);
  padding: 36px 48px;
  z-index: 2;
}
.hs-tp-evheader {
  display: grid; grid-template-columns: 130px 220px 1fr;
  gap: 24px;
  font-size: 26px; color: #4a7a4a;
  letter-spacing: .18em; text-transform: uppercase;
  padding: 18px 0 14px;
  border-bottom: 2px dashed rgba(155,255,155,.35);
  margin-top: 14px;
}
.hs-tp-evcol-pre, .hs-tp-evcol-when, .hs-tp-evcol-name {}
.hs-tp-evrow {
  padding: 22px 0;
  border-bottom: 1px dashed rgba(155,255,155,.22);
}
.hs-tp-evrow-line1 {
  display: grid; grid-template-columns: 130px 220px 1fr 280px;
  gap: 18px;
  font-size: 36px; color: #9bff9b;
  align-items: baseline;
}
.hs-tp-evpre { color: #ffe37a; font-weight: 700; letter-spacing: .1em; }
.hs-tp-evwhen { color: #4a7a4a; }
.hs-tp-evdash {
  color: rgba(155,255,155,.32);
  letter-spacing: .15em;
  overflow: hidden; white-space: nowrap;
}
.hs-tp-evwho { color: #7adfff; text-align: right; letter-spacing: .04em; }
.hs-tp-evrow-line2 {
  display: grid; grid-template-columns: 1fr auto;
  gap: 24px; padding: 8px 0 0 130px;
  font-size: 40px;
  align-items: baseline;
}
.hs-tp-evname { color: #cfe9cf; line-height: 1.15; }
.hs-tp-evpath {
  color: #ffe37a;
  font-size: 30px;
  letter-spacing: .08em;
  text-transform: lowercase;
}

.hs-tp-countdown-row {
  display: grid; grid-template-columns: 320px auto 1fr;
  gap: 28px; align-items: center;
  margin-top: 28px; padding-top: 22px;
  border-top: 2px solid rgba(155,255,155,.35);
}
.hs-tp-cd-pre {
  color: #ffe37a; font-weight: 700; letter-spacing: .12em;
  font-size: 30px;
}
.hs-tp-cd-val {
  font-family: 'VT323', monospace;
  font-size: 220px; line-height: .8;
  color: #ffe37a;
  text-shadow: 0 0 40px rgba(255,227,122,.6);
}
.hs-tp-cd-lbl {
  font-size: 38px; color: #9bff9b;
  display: flex; flex-direction: column; gap: 6px;
  line-height: 1.15;
}
.hs-tp-cd-sub {
  color: #4a7a4a; font-size: 28px;
}

/* ----- REGION 4: announcements tail -f ----- */
.hs-tp-anno {
  position: absolute; top: 2540px; left: 50px; right: 50px; height: 560px;
  border: 4px solid #ff7a7a;
  background: rgba(40,8,8,.4);
  padding: 36px 48px;
  z-index: 2;
}
.hs-tp-anno::before { color: #ff7a7a; }
.hs-tp-anno-tag {
  margin-top: 14px;
  font-size: 32px; letter-spacing: .12em;
  color: #ff7a7a;
}
.hs-tp-anno-h3 {
  font-family: 'VT323', monospace;
  font-size: 110px; line-height: .98;
  margin: 12px 0 0;
  color: #ffe37a;
  text-shadow: 0 0 32px rgba(255,227,122,.5);
  text-transform: uppercase;
}
.hs-tp-anno-p {
  font-size: 32px; color: #cfe9cf;
  margin: 14px 0 0; line-height: 1.35;
}
.hs-tp-anno-when {
  font-size: 30px; color: #ff7a7a;
  margin-top: 18px; letter-spacing: .12em;
}

/* ----- REGION 5: uname -a facts strip ----- */
.hs-tp-uname {
  position: absolute; top: 3160px; left: 50px; right: 50px; height: 380px;
  border: 4px solid #9bff9b;
  background: rgba(0,20,0,.4);
  padding: 30px 44px;
  z-index: 2;
}
.hs-tp-uname-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-top: 18px;
}
.hs-tp-fact {
  border-left: 4px solid #9bff9b;
  padding: 4px 0 4px 20px;
  display: flex; flex-direction: column; gap: 6px;
}
.hs-tp-fact-key {
  font-size: 24px; color: #4a7a4a;
  letter-spacing: .22em; text-transform: uppercase;
}
.hs-tp-fact-val {
  font-family: 'VT323', monospace;
  font-size: 90px; line-height: .9;
  color: #9bff9b;
  text-shadow: 0 0 22px rgba(155,255,155,.55);
}
.hs-tp-fact-val-sm {
  font-size: 56px; line-height: 1; padding-top: 8px;
}
.hs-tp-fact-sub {
  font-size: 22px; color: #4a7a4a; line-height: 1.3;
}

/* ----- REGION 6: bottom syslog ticker ----- */
.hs-tp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 110px;
  background: #9bff9b; color: #061506;
  display: flex; align-items: center; overflow: hidden;
  border-top: 4px solid #000;
  z-index: 4;
}
.hs-tp-tk-tag {
  background: #061506; color: #9bff9b;
  height: 100%; display: flex; align-items: center;
  padding: 0 38px;
  font-weight: 700; font-size: 36px;
  letter-spacing: .16em;
  flex-shrink: 0;
}
.hs-tp-tk-msg {
  font-weight: 700; font-size: 36px;
  padding-left: 44px; white-space: nowrap;
  letter-spacing: .08em;
  text-transform: uppercase;
  animation: hsTpScroll 50s linear infinite;
  display: inline-flex;
}
@keyframes hsTpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
