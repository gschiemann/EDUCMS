"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsBroadcastPortraitWidget — Newsroom lower-thirds high-school lobby in
 * 2160×3840 portrait. Companion to HsBroadcastWidget (3840×2160 landscape).
 * Same configuration shape; the layout is re-flowed for vertical viewing
 * with five stacked regions plus a bottom news crawl.
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~   0– 600px : header bar — ON AIR red lamp + channel chip + station-clock
 *                   pill, full-width with grid scanlines bg
 *   ~ 600–1800px : FEATURED GUEST OF THE WEEK hero — anchor portrait CSS-art
 *                   on left, name + role + lower-third banner + quote on right
 *   ~1800–2700px : breaking-story card — NEWS DESK eyebrow + giant headline
 *                   + body + airdate stamp
 *   ~2700–3400px : 2-up — Forecast strip (3-day) + Coming-Up panel (3 stories)
 *   ~3400–3840px : yellow STORY DESK stamp + scrolling news crawl ticker
 *
 * Every pixel size is FIXED at the 2160×3840 canvas. HsStage scales the
 * whole stage to whatever the actual viewport is. DO NOT regress to
 * vw / % units inside the stage — the editor and player will both
 * misrender if you do.
 */

import { HsStage } from './HsStage';
import type { HsBroadcastConfig } from './HsBroadcastWidget';

type Cfg = HsBroadcastConfig;

const DEFAULTS: Required<Cfg> = {
  schoolChip: 'WHS',
  schoolName: 'WESTRIDGE HIGH',
  schoolSub: 'CAMPUS NEWS NETWORK',
  statusLabel: 'ON AIR · MORNING REPORT',
  greetingEyebrow: 'TOP STORY · TUESDAY',
  greetingHeadline: 'GOOD MORNING, WESTRIDGE.',
  greetingSubtitle: "Doors open at 7:45. First bell rings at 8:05. Let's make it a great one.",
  clockTime: '7:53',
  clockCaption: 'Tuesday, April 21 · AM Broadcast',
  weatherTemp: '46°',
  weatherCondition: '☀ CLEAR · HI 62°',
  teacherPortraitTag: '[ portrait ]',
  teacherLabel: 'FEATURED GUEST · TEACHER OF THE WEEK',
  teacherName: 'MS. KOWALSKI',
  teacherGrade: 'AP PHYSICS · ROOM 214 · 14 YEARS AT WHS',
  teacherQuote: '"The answer is in the free-body diagram. If you can draw it, you can solve it."',
  announcementTitle: '★ BREAKING · TODAY',
  announcementHeadline: 'COLLEGE FAIR IN THE GYM, 3rd PERIOD.',
  announcementBody: '48 schools, 60 programs, 3 food trucks. Pre-registered seniors go first — bring your pass.',
  announcementDate: '04.21 · 10:15 AM – 1:00 PM · MAIN GYM',
  event1When: 'MON · 3:30 PM',
  event1Name: 'Varsity Soccer vs. Central',
  event2When: 'WED · 7:00 PM',
  event2Name: 'Spring Band Concert',
  event3When: 'FRI · ALL DAY',
  event3Name: 'Prom Ticket Sales — Cafe',
  countdownLabel: 'DAYS TO PROM',
  countdownValue: 24,
  countdownUnit: 'DAYS · SAVE THE DATE',
  tickerTag: 'LATEST',
  tickerMessage: 'LUNCH TODAY · CHICKEN BOWL · SALAD BAR · VEGAN OPTION AVAILABLE  ●  SAT PRACTICE SIGN-UPS CLOSE FRIDAY  ●  LOST: SILVER EARBUDS IN LIBRARY — SEE FRONT OFFICE  ●  DRAMA CLUB AUDITIONS MONDAY 3:30 IN THE AUDITORIUM  ●  ',
};

export function HsBroadcastPortraitWidget({ config }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;

  const upcoming = [
    { when: c.event1When, name: c.event1Name, accent: '#ef2b2b' },
    { when: c.event2When, name: c.event2Name, accent: '#ffd83d' },
    { when: c.event3When, name: c.event3Name, accent: '#4ade80' },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: 'radial-gradient(ellipse at 50% -10%, #1a2545 0%, #0b1025 55%, #05070f 100%)',
        fontFamily: "'Inter', sans-serif",
        color: '#f3f5f9',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;900&family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@500;700&display=swap"
      />
      <style>{CSS}</style>

      {/* Scanline + signal-glow overlay (full stage) */}
      <div className="hs-bcp-scan" />
      <div className="hs-bcp-grid" />

      {/* ============================ REGION 1: HEADER BAR ~0-600 ============================ */}
      <div className="hs-bcp-netbar">
        <div className="hs-bcp-brandmark">
          <span className="hs-bcp-chip" data-field="schoolChip" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolChip}
          </span>
          <span className="hs-bcp-school" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolName}
          </span>
          <span className="hs-bcp-sub" data-field="schoolSub" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolSub}
          </span>
        </div>

        <div className="hs-bcp-onair">
          <div className="hs-bcp-onair-row">
            <span className="hs-bcp-lamp" />
            <span className="hs-bcp-onair-text">ON AIR</span>
          </div>
          <div className="hs-bcp-status" data-field="statusLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.statusLabel}
          </div>
        </div>

        <div className="hs-bcp-clockpill">
          <div className="hs-bcp-clockpill-lbl">LOCAL</div>
          <div className="hs-bcp-clockpill-val" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.clockTime}
          </div>
          <div className="hs-bcp-clockpill-cap" data-field="clockCaption" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.clockCaption}
          </div>
        </div>

        <svg className="hs-bcp-sat" viewBox="0 0 120 80">
          <circle cx="60" cy="60" r="6" fill="#ffd83d" />
          <path className="hs-bcp-arc" d="M60 60 Q30 30 10 50" />
          <path className="hs-bcp-arc hs-bcp-arc-2" d="M60 60 Q30 15 10 40" />
          <path className="hs-bcp-arc hs-bcp-arc-3" d="M60 60 Q30 0 10 30" />
          <path className="hs-bcp-arc" d="M60 60 Q90 30 110 50" />
        </svg>
      </div>

      {/* ============================ REGION 2: FEATURED GUEST HERO ~600-1800 ============================ */}
      <div className="hs-bcp-guest">
        <div className="hs-bcp-guest-tag" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherLabel}
        </div>

        <div className="hs-bcp-guest-row">
          <div className="hs-bcp-portrait">
            {/* CSS-art anchor portrait silhouette */}
            <div className="hs-bcp-anchor">
              <div className="hs-bcp-anchor-hair" />
              <div className="hs-bcp-anchor-head" />
              <div className="hs-bcp-anchor-shoulders" />
              <div className="hs-bcp-anchor-collar" />
            </div>
            <div className="hs-bcp-portrait-stripes" />
            <div className="hs-bcp-mono" data-field="teacherPortraitTag" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherPortraitTag}
            </div>
            <div className="hs-bcp-portrait-cam">CAM 1</div>
          </div>

          <div className="hs-bcp-guest-body">
            {/* Lower-third banner */}
            <div className="hs-bcp-lowerthird">
              <div className="hs-bcp-lt-bar" />
              <div className="hs-bcp-lt-content">
                <h2 className="hs-bcp-h2" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {c.teacherName}
                </h2>
                <div className="hs-bcp-meta" data-field="teacherGrade" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {c.teacherGrade}
                </div>
              </div>
            </div>

            <div className="hs-bcp-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherQuote}
            </div>

            <div className="hs-bcp-greeting">
              <span className="hs-bcp-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.greetingEyebrow}
              </span>
              <h1 className="hs-bcp-h1" data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.greetingHeadline}
              </h1>
              <div className="hs-bcp-subtitle" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.greetingSubtitle}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 3: BREAKING STORY CARD ~1800-2700 ============================ */}
      <div className="hs-bcp-breaking">
        <div className="hs-bcp-breaking-eyebrow">
          <span className="hs-bcp-tag" data-field="announcementTitle" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementTitle}
          </span>
          <span className="hs-bcp-newsdesk">NEWS DESK</span>
        </div>
        <h2 className="hs-bcp-brk-h2" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementHeadline}
        </h2>
        <p className="hs-bcp-brk-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementBody}
        </p>
        <div className="hs-bcp-brk-foot">
          <div className="hs-bcp-date" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementDate}
          </div>
          <div className="hs-bcp-countdown">
            <span className="hs-bcp-cd-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownValue}
            </span>
            <span className="hs-bcp-cd-stack">
              <span className="hs-bcp-cd-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.countdownLabel}
              </span>
              <span className="hs-bcp-cd-unit" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.countdownUnit}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ============================ REGION 4: 2-UP — FORECAST + COMING UP ~2700-3400 ============================ */}
      <div className="hs-bcp-twoup">
        <div className="hs-bcp-forecast">
          <h3 className="hs-bcp-panel-h3">FORECAST · 3-DAY</h3>
          <div className="hs-bcp-fc-row">
            <div className="hs-bcp-fc-day">
              <div className="hs-bcp-fc-dlabel">TODAY</div>
              <div className="hs-bcp-fc-icon">☀</div>
              <div className="hs-bcp-fc-temp" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.weatherTemp}
              </div>
              <div className="hs-bcp-fc-cond" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.weatherCondition}
              </div>
            </div>
            <div className="hs-bcp-fc-day">
              <div className="hs-bcp-fc-dlabel">WED</div>
              <div className="hs-bcp-fc-icon hs-bcp-fc-cloud">⛅</div>
              <div className="hs-bcp-fc-temp">58°</div>
              <div className="hs-bcp-fc-cond">PARTLY · HI 64°</div>
            </div>
            <div className="hs-bcp-fc-day">
              <div className="hs-bcp-fc-dlabel">THU</div>
              <div className="hs-bcp-fc-icon hs-bcp-fc-rain">☂</div>
              <div className="hs-bcp-fc-temp">52°</div>
              <div className="hs-bcp-fc-cond">RAIN · HI 60°</div>
            </div>
          </div>
        </div>

        <div className="hs-bcp-coming">
          <h3 className="hs-bcp-panel-h3">COMING UP · THIS WEEK</h3>
          <div className="hs-bcp-coming-list">
            {upcoming.map((ev, i) => (
              <div key={i} className="hs-bcp-cu-row">
                <div className="hs-bcp-cu-chip" style={{ background: ev.accent }}>
                  <span data-field={`event${i + 1}When`} style={{ whiteSpace: 'pre-wrap' as const }}>
                    {ev.when}
                  </span>
                </div>
                <div className="hs-bcp-cu-name" data-field={`event${i + 1}Name`} style={{ whiteSpace: 'pre-wrap' as const }}>
                  {ev.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============================ REGION 5: STORY DESK STAMP + CRAWL ~3400-3840 ============================ */}
      <div className="hs-bcp-stamp-row">
        <div className="hs-bcp-stamp">
          <div className="hs-bcp-stamp-eyebrow">CAMPUS NEWS NETWORK</div>
          <div className="hs-bcp-stamp-headline">STORY DESK</div>
          <div className="hs-bcp-stamp-sub">FILED · ON AIR · ARCHIVED</div>
        </div>
      </div>

      {/* News crawl pinned to absolute bottom */}
      <div className="hs-bcp-ticker">
        <div className="hs-bcp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-bcp-tk-track">
          <div className="hs-bcp-tk-msg">
            <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.tickerMessage}
            </span>
            <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.tickerMessage}
            </span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel is sized for the 2160×3840 portrait stage. */
const CSS = `
.hs-bcp-scan {
  position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.018) 0 2px, transparent 2px 5px), radial-gradient(ellipse at 70% 80%, rgba(239,43,43,.10), transparent 60%);
  z-index: 1;
}
.hs-bcp-grid {
  position: absolute; inset: 0; pointer-events: none; opacity: .25;
  background-image:
    linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 80px 80px;
  z-index: 1;
}

/* ============================ REGION 1: HEADER BAR ~0-600 ============================ */
.hs-bcp-netbar {
  position: absolute; top: 0; left: 0; right: 0; height: 600px;
  background: linear-gradient(180deg, #0a0f1a 0%, #0a0f1a 78%, rgba(10,15,26,.6) 100%);
  border-bottom: 6px solid #ef2b2b;
  padding: 60px 80px 40px;
  box-sizing: border-box;
  z-index: 5;
  display: grid;
  grid-template-rows: auto auto auto;
  gap: 32px;
}
.hs-bcp-brandmark {
  display: flex; align-items: center; gap: 28px; flex-wrap: wrap;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  letter-spacing: .04em; color: #fff;
}
.hs-bcp-chip {
  background: #ef2b2b; color: #fff; padding: 8px 26px 12px;
  font-size: 88px; letter-spacing: .14em; line-height: 1;
}
.hs-bcp-school {
  font-size: 96px; line-height: 1; text-transform: uppercase;
}
.hs-bcp-sub {
  font-family: 'JetBrains Mono', monospace; font-weight: 500;
  font-size: 38px; letter-spacing: .26em; color: #8a93a6;
  text-transform: uppercase; flex-basis: 100%;
  margin-top: -8px;
}

.hs-bcp-onair {
  display: grid; grid-template-columns: auto 1fr; align-items: center;
  gap: 32px; padding: 22px 36px;
  background: rgba(239,43,43,.08); border: 2px solid rgba(239,43,43,.5);
}
.hs-bcp-onair-row { display: flex; align-items: center; gap: 20px; }
.hs-bcp-lamp {
  width: 56px; height: 56px; border-radius: 50%; background: #ef2b2b;
  box-shadow: 0 0 0 12px rgba(239,43,43,.25), 0 0 32px rgba(239,43,43,.85);
  animation: hsBcpPulse 1.6s ease-in-out infinite;
}
@keyframes hsBcpPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(239,43,43,.6), 0 0 24px rgba(239,43,43,.5); }
  50% { box-shadow: 0 0 0 28px rgba(239,43,43,0), 0 0 48px rgba(239,43,43,.95); }
}
.hs-bcp-onair-text {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 96px; letter-spacing: .12em; color: #fff; line-height: 1;
}
.hs-bcp-status {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 56px; letter-spacing: .14em; color: #ffd83d;
  text-transform: uppercase; text-align: right;
}

.hs-bcp-clockpill {
  display: grid; grid-template-columns: auto auto 1fr; align-items: center;
  gap: 28px; padding: 18px 36px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
}
.hs-bcp-clockpill-lbl {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 28px; letter-spacing: .26em; color: #8a93a6;
  text-transform: uppercase;
}
.hs-bcp-clockpill-val {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 120px; line-height: .9; color: #fff; letter-spacing: -.01em;
  position: relative;
}
.hs-bcp-clockpill-val::after {
  content: ''; display: inline-block; width: 16px; height: 16px;
  background: #ef2b2b; border-radius: 50%; margin-left: 14px;
  vertical-align: middle;
  animation: hsBcpBlink 1s steps(2) infinite;
}
@keyframes hsBcpBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
.hs-bcp-clockpill-cap {
  font-family: 'Inter', sans-serif; font-weight: 600;
  font-size: 32px; color: #cbd5e1; text-align: right;
}

.hs-bcp-sat {
  position: absolute; right: 80px; top: 36px; width: 120px; height: 80px;
  opacity: .7; z-index: 6;
}
.hs-bcp-arc {
  fill: none; stroke: #ffd83d; stroke-width: 3;
  animation: hsBcpArc 2.2s ease-in-out infinite; opacity: .7;
}
.hs-bcp-arc-2 { animation-delay: .4s; }
.hs-bcp-arc-3 { animation-delay: .8s; }
@keyframes hsBcpArc { 0%,100% { opacity: .15; } 50% { opacity: .85; } }

/* ============================ REGION 2: FEATURED GUEST HERO ~600-1800 ============================ */
.hs-bcp-guest {
  position: absolute; top: 640px; left: 60px; right: 60px;
  height: 1140px;
  background: #f3f5f9; color: #0a0f1a;
  padding: 44px 56px;
  box-sizing: border-box;
  z-index: 3;
  box-shadow: 0 24px 56px rgba(0,0,0,.55);
}
.hs-bcp-guest::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 18px;
  background: #ef2b2b;
}
.hs-bcp-guest::after {
  content: ''; position: absolute; right: 0; top: 0; width: 6px; height: 100%;
  background: repeating-linear-gradient(0deg, #ef2b2b 0 24px, #0a0f1a 24px 48px);
}
.hs-bcp-guest-tag {
  display: inline-block;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  background: #0a0f1a; color: #fff; padding: 8px 24px 12px;
  font-size: 44px; letter-spacing: .18em; text-transform: uppercase;
}
.hs-bcp-guest-row {
  display: grid; grid-template-columns: 720px 1fr; gap: 56px;
  margin-top: 32px;
  align-items: start;
}

/* CSS-art anchor portrait */
.hs-bcp-portrait {
  width: 720px; height: 900px;
  background: linear-gradient(160deg, #4b6cb7 0%, #182848 70%, #0a0f1a 100%);
  position: relative; overflow: hidden;
  display: grid; place-items: end center;
  border: 6px solid #0a0f1a;
}
.hs-bcp-anchor {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 600px; height: 760px;
}
.hs-bcp-anchor-hair {
  position: absolute; left: 50%; top: 60px; transform: translateX(-50%);
  width: 360px; height: 220px;
  background: #1a1a1a;
  border-radius: 50% 50% 40% 40% / 65% 65% 35% 35%;
  box-shadow: 0 6px 0 rgba(0,0,0,.25);
}
.hs-bcp-anchor-head {
  position: absolute; left: 50%; top: 130px; transform: translateX(-50%);
  width: 300px; height: 380px;
  background: linear-gradient(180deg, #f4d4b3 0%, #d8a880 100%);
  border-radius: 50% 50% 40% 40% / 55% 55% 45% 45%;
}
.hs-bcp-anchor-shoulders {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 600px; height: 360px;
  background: linear-gradient(180deg, #0a0f1a 0%, #0a0f1a 100%);
  border-radius: 50% 50% 0 0 / 30% 30% 0 0;
}
.hs-bcp-anchor-collar {
  position: absolute; left: 50%; bottom: 280px; transform: translateX(-50%);
  width: 220px; height: 80px;
  background: #fff;
  clip-path: polygon(0 0, 50% 50%, 100% 0, 100% 100%, 0 100%);
}
.hs-bcp-portrait-stripes {
  position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 8px, transparent 8px 16px);
  z-index: 2;
}
.hs-bcp-mono {
  position: absolute; top: 24px; left: 24px; z-index: 3;
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 26px; color: #0a0f1a; background: #ffd83d;
  padding: 6px 14px; letter-spacing: .1em;
}
.hs-bcp-portrait-cam {
  position: absolute; bottom: 24px; right: 24px; z-index: 3;
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 28px; color: #fff; background: rgba(239,43,43,.9);
  padding: 6px 14px; letter-spacing: .14em;
}

/* Right column — lower-third + quote + greeting */
.hs-bcp-guest-body {
  display: flex; flex-direction: column; gap: 24px;
}
.hs-bcp-lowerthird {
  position: relative;
  background: linear-gradient(135deg, #ef2b2b 0%, #b51c1c 100%);
  color: #fff;
  padding: 26px 32px 26px 48px;
  box-shadow: 0 12px 24px rgba(0,0,0,.3);
  clip-path: polygon(0 0, 100% 0, 96% 100%, 0 100%);
}
.hs-bcp-lt-bar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 12px;
  background: #ffd83d;
}
.hs-bcp-lt-content { display: flex; flex-direction: column; gap: 4px; }
.hs-bcp-h2 {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 96px; line-height: .9; margin: 0;
  color: #fff; text-transform: uppercase; letter-spacing: -.01em;
}
.hs-bcp-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 500;
  font-size: 26px; color: #ffd83d; letter-spacing: .14em;
  text-transform: uppercase; margin-top: 4px;
}
.hs-bcp-quote {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 38px; color: #334155; font-style: italic; line-height: 1.25;
  border-left: 6px solid #ef2b2b; padding: 8px 0 8px 24px;
}
.hs-bcp-greeting { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
.hs-bcp-eyebrow {
  display: inline-block; align-self: flex-start;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  background: #0a0f1a; color: #ffd83d;
  padding: 8px 20px 10px;
  font-size: 30px; letter-spacing: .16em; text-transform: uppercase;
}
.hs-bcp-h1 {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 110px; line-height: .9; margin: 0;
  color: #0a0f1a; text-transform: uppercase; letter-spacing: -.01em;
}
.hs-bcp-subtitle {
  font-family: 'Inter', sans-serif; font-weight: 600;
  font-size: 30px; color: #334155; line-height: 1.25;
}

/* ============================ REGION 3: BREAKING STORY CARD ~1800-2700 ============================ */
.hs-bcp-breaking {
  position: absolute; top: 1820px; left: 60px; right: 60px;
  height: 860px;
  background: #0a0f1a;
  border: 1px solid rgba(255,255,255,.1);
  padding: 48px 56px;
  box-sizing: border-box;
  z-index: 3;
  box-shadow: 0 24px 56px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
}
.hs-bcp-breaking::before {
  content: ''; position: absolute; left: 0; top: 0; right: 0; height: 14px;
  background: repeating-linear-gradient(90deg, #ef2b2b 0 80px, #ffd83d 80px 160px);
}
.hs-bcp-breaking-eyebrow {
  display: flex; align-items: center; gap: 24px; margin-top: 6px;
}
.hs-bcp-tag {
  display: inline-block;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  background: #ffd83d; color: #0a0f1a; padding: 10px 24px 14px;
  font-size: 48px; letter-spacing: .14em; text-transform: uppercase;
}
.hs-bcp-newsdesk {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 32px; color: #8a93a6; letter-spacing: .26em;
  text-transform: uppercase;
}
.hs-bcp-brk-h2 {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 180px; line-height: .92; margin: 24px 0 24px;
  color: #fff; text-transform: uppercase; letter-spacing: -.01em;
}
.hs-bcp-brk-p {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 42px; color: #cbd5e1; margin: 0; line-height: 1.3;
  flex: 1;
}
.hs-bcp-brk-foot {
  display: grid; grid-template-columns: 1fr auto; align-items: center;
  gap: 32px; margin-top: 24px;
  padding-top: 24px; border-top: 2px dashed rgba(255,216,61,.3);
}
.hs-bcp-date {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 32px; color: #ffd83d; letter-spacing: .16em;
  text-transform: uppercase;
}
.hs-bcp-countdown {
  display: flex; align-items: center; gap: 20px;
  background: #ef2b2b; color: #fff; padding: 16px 28px;
  box-shadow: 0 8px 18px rgba(239,43,43,.4);
}
.hs-bcp-cd-val {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 130px; line-height: .85; letter-spacing: -.03em;
}
.hs-bcp-cd-stack { display: flex; flex-direction: column; gap: 4px; }
.hs-bcp-cd-lbl {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 24px; letter-spacing: .2em; text-transform: uppercase;
  opacity: .9;
}
.hs-bcp-cd-unit {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 28px; letter-spacing: .1em; text-transform: uppercase;
}

/* ============================ REGION 4: 2-UP — FORECAST + COMING UP ~2700-3400 ============================ */
.hs-bcp-twoup {
  position: absolute; top: 2720px; left: 60px; right: 60px;
  height: 660px;
  display: grid; grid-template-columns: 940px 1fr; gap: 40px;
  z-index: 3;
}
.hs-bcp-panel-h3 {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 30px; letter-spacing: .24em; text-transform: uppercase;
  color: #8a93a6; margin: 0 0 20px;
}

/* Forecast */
.hs-bcp-forecast {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1);
  border-top: 6px solid #ffd83d;
  padding: 32px 36px;
  box-sizing: border-box;
}
.hs-bcp-fc-row {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
  height: calc(100% - 50px);
}
.hs-bcp-fc-day {
  background: rgba(0,0,0,.3); padding: 24px 20px;
  border-left: 4px solid #ffd83d;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between;
}
.hs-bcp-fc-day:nth-child(2) { border-left-color: #cbd5e1; }
.hs-bcp-fc-day:nth-child(3) { border-left-color: #4ade80; }
.hs-bcp-fc-dlabel {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 26px; letter-spacing: .2em; color: #cbd5e1;
  text-transform: uppercase;
}
.hs-bcp-fc-icon {
  font-size: 100px; line-height: 1; color: #ffd83d;
}
.hs-bcp-fc-cloud { color: #cbd5e1; }
.hs-bcp-fc-rain { color: #4ade80; }
.hs-bcp-fc-temp {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 100px; line-height: .9; color: #fff; letter-spacing: -.02em;
}
.hs-bcp-fc-cond {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
  font-size: 22px; color: #ffd83d; letter-spacing: .08em;
  text-transform: uppercase;
}

/* Coming up */
.hs-bcp-coming {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1);
  border-top: 6px solid #ef2b2b;
  padding: 32px 36px;
  box-sizing: border-box;
}
.hs-bcp-coming-list {
  display: flex; flex-direction: column; gap: 14px;
  height: calc(100% - 50px);
}
.hs-bcp-cu-row {
  display: grid; grid-template-columns: 320px 1fr;
  align-items: center; gap: 20px;
  background: rgba(0,0,0,.3);
  padding: 16px 18px;
  flex: 1;
}
.hs-bcp-cu-chip {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 28px; color: #0a0f1a;
  padding: 14px 18px; text-align: center;
  letter-spacing: .12em; text-transform: uppercase;
}
.hs-bcp-cu-name {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 50px; line-height: .98; color: #fff;
  text-transform: uppercase; letter-spacing: -.005em;
}

/* ============================ REGION 5: STORY DESK STAMP + CRAWL ~3400-3840 ============================ */
.hs-bcp-stamp-row {
  position: absolute; left: 60px; right: 60px; bottom: 220px;
  height: 200px; z-index: 3;
}
.hs-bcp-stamp {
  position: relative; height: 100%;
  background: #ffd83d; color: #0a0f1a;
  padding: 24px 40px;
  box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: center;
  box-shadow: 0 16px 32px rgba(0,0,0,.5);
  transform: rotate(-1.2deg);
  border: 6px solid #0a0f1a;
}
.hs-bcp-stamp::before {
  content: ''; position: absolute; left: -6px; top: -6px; right: -6px; bottom: -6px;
  border: 2px solid rgba(10,15,26,.3); pointer-events: none;
}
.hs-bcp-stamp::after {
  content: ''; position: absolute; right: -28px; top: -28px;
  width: 110px; height: 110px;
  background: #ef2b2b; color: #fff;
  clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
  filter: drop-shadow(0 4px 8px rgba(0,0,0,.4));
}
.hs-bcp-stamp-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 28px; letter-spacing: .26em; color: #0a0f1a;
  text-transform: uppercase; opacity: .85;
}
.hs-bcp-stamp-headline {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 120px; line-height: .9;
  color: #0a0f1a; text-transform: uppercase; letter-spacing: -.01em;
  margin: 4px 0;
  text-shadow: 4px 4px 0 rgba(239,43,43,.35);
}
.hs-bcp-stamp-sub {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 26px; letter-spacing: .24em; color: #0a0f1a;
  text-transform: uppercase; opacity: .8;
}

/* Crawl ticker pinned to absolute bottom */
.hs-bcp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 140px;
  background: #0a0f1a; display: flex; align-items: center;
  border-top: 6px solid #ef2b2b; overflow: hidden; z-index: 5;
}
.hs-bcp-tk-tag {
  background: #ef2b2b; color: #fff;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
  font-size: 64px; letter-spacing: .14em; text-transform: uppercase;
  padding: 0 48px; height: 100%;
  display: flex; align-items: center; flex-shrink: 0;
}
.hs-bcp-tk-track {
  flex: 1; overflow: hidden; position: relative; height: 100%;
  display: flex; align-items: center;
}
.hs-bcp-tk-msg {
  font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
  font-size: 60px; color: #fff; letter-spacing: .04em;
  text-transform: uppercase;
  padding-left: 48px; white-space: nowrap;
  animation: hsBcpScroll 50s linear infinite;
  display: inline-flex;
}
@keyframes hsBcpScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
`;
