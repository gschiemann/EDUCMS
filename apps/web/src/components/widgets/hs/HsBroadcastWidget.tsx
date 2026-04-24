"use client";

/**
 * HsBroadcastWidget — Campus news-desk lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/broadcast.html
 * Ported via HsStage transform:scale pattern.
 *
 * Widgets wired in the scene:
 *   - school        → brandmark chip + school name + network sub
 *   - status        → ON AIR indicator with pulsing dot
 *   - greeting      → eyebrow + big headline + subtitle
 *   - clock         → LOCAL TIME panel with pulsing dot on time
 *   - weather       → FORECAST panel with temp + condition icon
 *   - teacher       → Featured guest / teacher-of-the-week card
 *   - announcement  → ★ BREAKING story card
 *   - events (×3)   → schedule cards with color-coded left border
 *   - countdown     → DAYS TO PROM big number
 *   - ticker        → LATEST crawl at the bottom
 */

import { HsStage } from './HsStage';

export interface HsBroadcastConfig {
  schoolChip?: string;
  schoolName?: string;
  schoolSub?: string;
  statusLabel?: string;
  greetingEyebrow?: string;
  greetingHeadline?: string;
  greetingSubtitle?: string;
  clockTime?: string;
  clockCaption?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  teacherPortraitTag?: string;
  teacherLabel?: string;
  teacherName?: string;
  teacherGrade?: string;
  teacherQuote?: string;
  announcementTitle?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  event1When?: string;
  event1Name?: string;
  event2When?: string;
  event2Name?: string;
  event3When?: string;
  event3Name?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownUnit?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

const DEFAULTS: Required<HsBroadcastConfig> = {
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

export function HsBroadcastWidget({ config }: { config?: HsBroadcastConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsBroadcastConfig>;
  return (
    <HsStage
      stageStyle={{
        background: 'radial-gradient(ellipse at 50% -10%, #1a2545 0%, #0b1025 55%, #05070f 100%)',
        fontFamily: "'Inter', sans-serif",
        color: '#f3f5f9',
      }}
    >
      <style>{CSS}</style>
      <div className="hs-bc-scan" />

      <div className="hs-bc-netbar">
        <div className="hs-bc-brandmark">
          <span className="hs-bc-chip">{c.schoolChip}</span>
          <span>{c.schoolName}</span>
          <span className="hs-bc-sub">{c.schoolSub}</span>
        </div>
        <div className="hs-bc-live">
          <span className="hs-bc-dot" />
          <span>{c.statusLabel}</span>
        </div>
      </div>

      <svg className="hs-bc-sat" viewBox="0 0 120 80">
        <circle cx="60" cy="60" r="6" fill="#ffd83d" />
        <path className="hs-bc-arc" d="M60 60 Q30 30 10 50" />
        <path className="hs-bc-arc hs-bc-arc-2" d="M60 60 Q30 15 10 40" />
        <path className="hs-bc-arc hs-bc-arc-3" d="M60 60 Q30 0 10 30" />
        <path className="hs-bc-arc" d="M60 60 Q90 30 110 50" />
      </svg>

      <div className="hs-bc-headline">
        <div>
          <span className="hs-bc-eyebrow">{c.greetingEyebrow}</span>
          <h1 className="hs-bc-h1">{c.greetingHeadline}</h1>
          <div className="hs-bc-subtitle">{c.greetingSubtitle}</div>
        </div>
        <div className="hs-bc-panel-col">
          <div className="hs-bc-panel hs-bc-clock">
            <h3>LOCAL TIME</h3>
            <div className="hs-bc-big">{c.clockTime}</div>
            <div className="hs-bc-cap">{c.clockCaption}</div>
          </div>
          <div className="hs-bc-panel hs-bc-weather">
            <h3>FORECAST</h3>
            <div className="hs-bc-row">
              <div className="hs-bc-big">{c.weatherTemp}</div>
              <div className="hs-bc-ico">{c.weatherCondition}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="hs-bc-guest">
        <div className="hs-bc-portrait">
          <div className="hs-bc-mono">{c.teacherPortraitTag}</div>
        </div>
        <div>
          <span className="hs-bc-guest-eyebrow">{c.teacherLabel}</span>
          <h2 className="hs-bc-h2">{c.teacherName}</h2>
          <div className="hs-bc-meta">{c.teacherGrade}</div>
          <div className="hs-bc-quote">{c.teacherQuote}</div>
        </div>
      </div>

      <div className="hs-bc-breaking">
        <span className="hs-bc-tag">{c.announcementTitle}</span>
        <h2 className="hs-bc-brk-h2">{c.announcementHeadline}</h2>
        <p className="hs-bc-brk-p">{c.announcementBody}</p>
        <div className="hs-bc-date">{c.announcementDate}</div>
      </div>

      <div className="hs-bc-schedule">
        <div className="hs-bc-ev">
          <div className="hs-bc-when">{c.event1When}</div>
          <div className="hs-bc-what">{c.event1Name}</div>
        </div>
        <div className="hs-bc-ev hs-bc-ev-2">
          <div className="hs-bc-when">{c.event2When}</div>
          <div className="hs-bc-what">{c.event2Name}</div>
        </div>
        <div className="hs-bc-ev hs-bc-ev-3">
          <div className="hs-bc-when">{c.event3When}</div>
          <div className="hs-bc-what">{c.event3Name}</div>
        </div>
        <div className="hs-bc-countdown">
          <div className="hs-bc-cd-lbl">{c.countdownLabel}</div>
          <div className="hs-bc-cd-val">{c.countdownValue}</div>
          <div className="hs-bc-cd-unit">{c.countdownUnit}</div>
        </div>
      </div>

      <div className="hs-bc-ticker">
        <div className="hs-bc-tk-tag">{c.tickerTag}</div>
        <div className="hs-bc-tk-track">
          <div className="hs-bc-tk-msg">
            <span>{c.tickerMessage}</span>
            <span>{c.tickerMessage}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;900&family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@500;700&display=swap');
.hs-bc-scan { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 2px, transparent 2px 5px), radial-gradient(ellipse at 70% 90%, rgba(239,43,43,.12), transparent 60%); }
.hs-bc-netbar { position: absolute; top: 0; left: 0; right: 0; height: 120px; background: linear-gradient(180deg, #0a0f1a, #0a0f1a 80%, rgba(10,15,26,0)); display: flex; align-items: center; justify-content: space-between; padding: 0 80px; box-sizing: border-box; z-index: 5; }
.hs-bc-brandmark { display: flex; align-items: center; gap: 24px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 64px; letter-spacing: .04em; color: #fff; }
.hs-bc-chip { background: #ef2b2b; color: #fff; padding: 6px 20px 8px; font-size: 44px; letter-spacing: .12em; }
.hs-bc-sub { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px; letter-spacing: .24em; color: #8a93a6; text-transform: uppercase; }
.hs-bc-live { display: flex; align-items: center; gap: 18px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 48px; letter-spacing: .12em; color: #fff; }
.hs-bc-dot { width: 28px; height: 28px; border-radius: 50%; background: #ef2b2b; box-shadow: 0 0 0 6px rgba(239,43,43,.25); animation: hsBcPulse 1.8s ease-in-out infinite; }
@keyframes hsBcPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,43,43,.6); } 50% { box-shadow: 0 0 0 18px rgba(239,43,43,0); } }
.hs-bc-headline { position: absolute; top: 220px; left: 80px; right: 80px; display: grid; grid-template-columns: 3fr 2fr; gap: 60px; }
.hs-bc-eyebrow { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; background: #ef2b2b; color: #fff; padding: 10px 24px 12px; font-size: 44px; letter-spacing: .14em; text-transform: uppercase; }
.hs-bc-h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 260px; line-height: .9; margin: 16px 0 0; letter-spacing: -.01em; color: #fff; text-transform: uppercase; }
.hs-bc-subtitle { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 44px; color: #cbd5e1; margin-top: 24px; max-width: 1400px; line-height: 1.2; }
.hs-bc-panel-col { display: grid; gap: 28px; }
.hs-bc-panel { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); padding: 24px 32px; position: relative; }
.hs-bc-panel h3 { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .2em; text-transform: uppercase; color: #8a93a6; margin: 0 0 10px; }
.hs-bc-big { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 140px; line-height: .9; color: #fff; letter-spacing: -.01em; }
.hs-bc-cap { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 28px; color: #cbd5e1; margin-top: 6px; }
.hs-bc-clock .hs-bc-big::after { content: ''; display: inline-block; width: 14px; height: 14px; background: #ef2b2b; border-radius: 50%; margin-left: 14px; vertical-align: middle; animation: hsBcBlink 1s steps(2) infinite; }
@keyframes hsBcBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
.hs-bc-weather .hs-bc-row { display: flex; align-items: flex-end; gap: 20px; }
.hs-bc-weather .hs-bc-big { font-size: 160px; }
.hs-bc-ico { font-family: 'Barlow Condensed', sans-serif; font-size: 56px; color: #ffd83d; }
.hs-bc-guest { position: absolute; top: 1080px; left: 80px; width: 1820px; background: #f3f5f9; color: #0a0f1a; padding: 40px 48px; display: grid; grid-template-columns: 360px 1fr; gap: 48px; align-items: center; }
.hs-bc-guest::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 16px; background: #ef2b2b; }
.hs-bc-portrait { width: 360px; height: 360px; background: linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%); position: relative; overflow: hidden; display: grid; place-items: center; }
.hs-bc-portrait::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(45deg, rgba(0,0,0,.04) 0 6px, transparent 6px 12px); }
.hs-bc-mono { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; color: #0a0f1a; background: #fff; padding: 6px 12px; z-index: 1; position: relative; }
.hs-bc-guest-eyebrow { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; background: #0a0f1a; color: #fff; padding: 6px 18px; font-size: 32px; letter-spacing: .18em; text-transform: uppercase; }
.hs-bc-h2 { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 150px; line-height: .9; margin: 10px 0 6px; color: #0a0f1a; text-transform: uppercase; }
.hs-bc-meta { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 28px; color: #475569; letter-spacing: .1em; text-transform: uppercase; }
.hs-bc-quote { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 36px; color: #334155; margin-top: 18px; line-height: 1.25; font-style: italic; }
.hs-bc-breaking { position: absolute; top: 1080px; right: 80px; width: 1780px; background: #0a0f1a; border: 1px solid rgba(255,255,255,.08); padding: 36px 40px; }
.hs-bc-tag { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; background: #ffd83d; color: #0a0f1a; padding: 8px 20px 10px; font-size: 36px; letter-spacing: .14em; text-transform: uppercase; }
.hs-bc-brk-h2 { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 110px; line-height: .95; margin: 12px 0 10px; color: #fff; text-transform: uppercase; }
.hs-bc-brk-p { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 34px; color: #cbd5e1; margin: 0; line-height: 1.3; }
.hs-bc-date { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #ffd83d; letter-spacing: .16em; margin-top: 20px; text-transform: uppercase; }
.hs-bc-schedule { position: absolute; top: 1560px; left: 80px; right: 80px; display: grid; grid-template-columns: repeat(3, 1fr) 620px; gap: 32px; }
.hs-bc-ev { background: rgba(255,255,255,.03); border-left: 6px solid #ef2b2b; padding: 24px 28px; }
.hs-bc-ev-2 { border-left-color: #ffd83d; }
.hs-bc-ev-3 { border-left-color: #4ade80; }
.hs-bc-when { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #94a3b8; letter-spacing: .14em; text-transform: uppercase; }
.hs-bc-what { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 68px; line-height: .95; color: #fff; margin-top: 10px; text-transform: uppercase; }
.hs-bc-countdown { background: #ef2b2b; padding: 28px 36px; color: #fff; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
.hs-bc-cd-lbl { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .2em; text-transform: uppercase; opacity: .9; }
.hs-bc-cd-val { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 280px; line-height: .85; letter-spacing: -.03em; }
.hs-bc-cd-unit { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 56px; letter-spacing: .1em; text-transform: uppercase; margin-top: -20px; }
.hs-bc-ticker { position: absolute; left: 0; right: 0; bottom: 0; height: 120px; background: #0a0f1a; display: flex; align-items: center; border-top: 4px solid #ef2b2b; overflow: hidden; }
.hs-bc-tk-tag { background: #ef2b2b; color: #fff; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 52px; letter-spacing: .14em; text-transform: uppercase; padding: 0 40px; height: 100%; display: flex; align-items: center; flex-shrink: 0; }
.hs-bc-tk-track { flex: 1; overflow: hidden; position: relative; height: 100%; display: flex; align-items: center; }
.hs-bc-tk-msg { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 52px; color: #fff; letter-spacing: .04em; text-transform: uppercase; padding-left: 40px; white-space: nowrap; animation: hsBcScroll 40s linear infinite; display: inline-flex; }
@keyframes hsBcScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.hs-bc-sat { position: absolute; right: 80px; top: 40px; width: 120px; height: 80px; opacity: .7; z-index: 4; }
.hs-bc-arc { fill: none; stroke: #ffd83d; stroke-width: 3; animation: hsBcArc 2.2s ease-in-out infinite; opacity: .7; }
.hs-bc-arc-2 { animation-delay: .4s; }
.hs-bc-arc-3 { animation-delay: .8s; }
@keyframes hsBcArc { 0%,100% { opacity: .15; } 50% { opacity: .85; } }
`;
