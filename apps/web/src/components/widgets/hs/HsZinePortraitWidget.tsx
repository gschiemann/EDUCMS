"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsZinePortraitWidget — DIY photocopied-zine high-school lobby in
 * 2160×3840 portrait. Companion to HsZineWidget (3840×2160 landscape).
 * Same configuration shape verbatim; layout is re-flowed for vertical
 * viewing as a stack of cut-and-paste sheets on a beige photocopy
 * background, with washi-tape strips, marker scribbles, rotated
 * polaroids, ransom-letter banner, and a xeroxwire ticker.
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~   0–600px : ransom-letter school-name banner — each glyph cut from
 *                  a different font, individually rotated, on a long
 *                  yellow washi-tape strip plus a typewritten subhead
 *   ~ 600–1500  : "ABOUT THIS WEEK" zine sheet — paper grain, marker
 *                  headline, yellow highlighter swipe, handwriting body
 *   ~1500–2580  : 2×2 grid of rotated polaroid event cards — each
 *                  tilted 3–7°, washi-tape corner, marker caption
 *   ~2580–3340  : "WHO'S WHO" featured-student polaroid (large), with
 *                  marker arrow callouts + handwritten scribbles
 *   ~3340–3760  : small ransom-letter announcement card
 *   ~3760–3840  : XEROXWIRE ticker — marker stamp + scrolling text,
 *                  yellow highlight underline
 *
 * Every pixel is FIXED at the 2160×3840 canvas. HsStage scales to
 * whatever the actual viewport is. DO NOT regress to vw / % units
 * inside the stage — the editor and player both misrender if you do.
 */

import { HsStage } from './HsStage';

export interface HsZineConfig {
  schoolName?: string;
  schoolSub?: string;
  brandStamp1?: string;
  brandStamp2?: string;
  brandStamp3?: string;
  greetingEyebrow?: string;
  greetingHeadline1?: string;
  greetingHeadline2?: string;
  greetingHeadline3?: string;
  greetingSubtitle?: string;
  teacherCaption?: string;
  teacherSub?: string;
  attendanceValue?: string;
  attendanceCap?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownSub?: string;
  event0When?: string;
  event0Name?: string;
  event1When?: string;
  event1Name?: string;
  event2When?: string;
  event2Name?: string;
  countdownBigValue?: string | number;
  countdownBigLabel?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  clockLabel?: string;
  clockTime?: string;
  weatherCondition?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

type Cfg = HsZineConfig;

const DEFAULTS: Required<Cfg> = {
  schoolName: 'WESTRIDGE!',
  schoolSub: 'vol. 142 · morning edition · photocopied by hand · free',
  brandStamp1: '★ WILDCATS FOREVER',
  brandStamp2: '// issue 142',
  brandStamp3: '4/21 · tue · 7:53am',
  greetingEyebrow: '// hi everybody,',
  greetingHeadline1: 'BE',
  greetingHeadline2: 'LOUD',
  greetingHeadline3: 'TODAY.',
  greetingSubtitle:
    "the bell rings at 8:05. bring a pen. eat something. tell somebody good morning. you've got this — we all do. xo — the zine kids.",
  teacherCaption: 'MS. KOWALSKI!!',
  teacherSub: '>> teacher of the week · ap physics · rm 214 <<',
  attendanceValue: '1,217',
  attendanceCap: '98.2% · nice work',
  countdownLabel: '// grad in',
  countdownValue: 41,
  countdownSub: 'days & counting!!',
  event0When: 'MON 3:30',
  event0Name: 'stu. gov. open mtg · library',
  event1When: 'WED 7pm',
  event1Name: 'spring band concert · aud.',
  event2When: 'FRI 7pm',
  event2Name: '"into the woods" — opening!',
  countdownBigValue: 41,
  countdownBigLabel: "DAYS 'TIL GRAD!!",
  announcementTag: 'URGENT & COOL',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD · GYM A',
  announcementBody:
    'seniors front row! marching band enters south doors. no backpacks in gym. go back to 8th when the bell rings. be loud!',
  announcementDate: '→ today · 2:15 to 3:00 ←',
  clockLabel: '// right now',
  clockTime: '7:53',
  weatherCondition: 'tue · apr 21 · 46° · clear · high 62°',
  tickerTag: 'xeroxwire',
  tickerMessage:
    'bus 14 running late !! · lunch: chicken bowl, salad bar, vegan opt · ap psych → library · LOST: silver earbuds — front desk · sports photos tmrw bring your jersey · submit to the zine rm 217 · ',
};

/** Pre-computed per-glyph rotations + font choices for the ransom banner.
 * Keeping it deterministic (not Math.random in render) so SSR + CSR match
 * and the layout doesn't shift between hydration passes. */
const RANSOM_FONTS = [
  "'Bungee', sans-serif",
  "'Permanent Marker', cursive",
  "'Special Elite', monospace",
  "'Archivo Black', sans-serif",
  "'Bungee', sans-serif",
  "'Permanent Marker', cursive",
  "'Special Elite', monospace",
  "'Archivo Black', sans-serif",
  "'Bungee', sans-serif",
  "'Permanent Marker', cursive",
  "'Special Elite', monospace",
  "'Archivo Black', sans-serif",
];
const RANSOM_ROTS = [-6, 4, -3, 7, -2, 5, -4, 6, -3, 4, -5, 3];
const RANSOM_BG = ['#fff', '#ffd84d', '#fff', '#2dbce6', '#fff', '#ffd84d', '#fff', '#fff', '#ffd84d', '#fff', '#2dbce6', '#fff'];

export function HsZinePortraitWidget({ config }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const ransomChars = String(c.schoolName).split('');

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#f2ecd9',
        backgroundImage:
          'radial-gradient(circle at 18% 22%, rgba(0,0,0,.05), transparent 40%), radial-gradient(circle at 82% 78%, rgba(0,0,0,.06), transparent 42%), radial-gradient(circle at 50% 55%, rgba(0,0,0,.03), transparent 50%), repeating-linear-gradient(0deg, rgba(0,0,0,.025) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,.015) 0 1px, transparent 1px 4px)',
        fontFamily: "'Courier Prime', monospace",
        color: '#15120d',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bungee&family=Caveat:wght@600;700&family=Courier+Prime:wght@400;700&family=Permanent+Marker&family=Special+Elite&display=swap"
      />
      <style>{CSS}</style>

      {/* photocopy streak overlay */}
      <div className="hs-zp-streaks" />

      {/* ============ REGION 1: RANSOM-LETTER BANNER ~0-600 ============ */}
      <div className="hs-zp-banner">
        <div className="hs-zp-tape-strip" />
        <div className="hs-zp-ransom" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>
          {ransomChars.map((ch, i) => (
            <span
              key={i}
              className="hs-zp-letter"
              style={{
                fontFamily: RANSOM_FONTS[i % RANSOM_FONTS.length],
                background: RANSOM_BG[i % RANSOM_BG.length],
                transform: `rotate(${RANSOM_ROTS[i % RANSOM_ROTS.length]}deg)`,
              }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        <div className="hs-zp-banner-sub" data-field="schoolSub" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.schoolSub}
        </div>
        <div className="hs-zp-stamps">
          <span className="hs-zp-stamp" data-field="brandStamp1" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.brandStamp1}
          </span>
          <span className="hs-zp-stamp hs-zp-stamp-ink2" data-field="brandStamp2" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.brandStamp2}
          </span>
          <span className="hs-zp-stamp hs-zp-stamp-cyan" data-field="brandStamp3" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.brandStamp3}
          </span>
        </div>
      </div>

      {/* ============ REGION 2: ABOUT THIS WEEK SHEET ~600-1500 ============ */}
      <div className="hs-zp-sheet">
        {/* washi tape on corners */}
        <div className="hs-zp-tape hs-zp-tape-tl" />
        <div className="hs-zp-tape hs-zp-tape-tr" />

        <div className="hs-zp-sheet-tag">// ABOUT THIS WEEK</div>
        <div className="hs-zp-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingEyebrow}
        </div>
        <h1 className="hs-zp-h1">
          <span data-field="greetingHeadline1" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingHeadline1}
          </span>{' '}
          <em data-field="greetingHeadline2" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingHeadline2}
          </em>{' '}
          <span data-field="greetingHeadline3" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingHeadline3}
          </span>
        </h1>
        <p className="hs-zp-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingSubtitle}
        </p>

        {/* dual stat cards row at sheet bottom */}
        <div className="hs-zp-stats">
          <div className="hs-zp-stat hs-zp-stat-a">
            <div className="hs-zp-lbl">// here today</div>
            <div className="hs-zp-val" data-field="attendanceValue" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.attendanceValue}
            </div>
            <div className="hs-zp-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.attendanceCap}
            </div>
          </div>
          <div className="hs-zp-stat hs-zp-stat-b">
            <div className="hs-zp-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownLabel}
            </div>
            <div className="hs-zp-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownValue}
            </div>
            <div className="hs-zp-cap" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownSub}
            </div>
          </div>
        </div>
      </div>

      {/* ============ REGION 3: 2x2 POLAROID EVENT GRID ~1500-2580 ============ */}
      <div className="hs-zp-grid">
        <div className="hs-zp-pol hs-zp-pol-a">
          <div className="hs-zp-pol-tape" />
          <div className="hs-zp-pic" />
          <div className="hs-zp-when" data-field="event0When" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.event0When}
          </div>
          <div className="hs-zp-name" data-field="event0Name" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.event0Name}
          </div>
        </div>
        <div className="hs-zp-pol hs-zp-pol-b">
          <div className="hs-zp-pol-tape" />
          <div className="hs-zp-pic" />
          <div className="hs-zp-when" data-field="event1When" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.event1When}
          </div>
          <div className="hs-zp-name" data-field="event1Name" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.event1Name}
          </div>
        </div>
        <div className="hs-zp-pol hs-zp-pol-c">
          <div className="hs-zp-pol-tape" />
          <div className="hs-zp-pic" />
          <div className="hs-zp-when" data-field="event2When" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.event2When}
          </div>
          <div className="hs-zp-name" data-field="event2Name" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.event2Name}
          </div>
        </div>
        <div className="hs-zp-pol hs-zp-pol-count">
          <div className="hs-zp-pol-tape" />
          <div className="hs-zp-num" data-field="countdownBigValue" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.countdownBigValue}
          </div>
          <div className="hs-zp-lb" data-field="countdownBigLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.countdownBigLabel}
          </div>
        </div>
      </div>

      {/* ============ REGION 4: WHO'S WHO FEATURED POLAROID ~2580-3340 ============ */}
      <div className="hs-zp-feature">
        <div className="hs-zp-feature-section-tag">// WHO'S WHO</div>

        <div className="hs-zp-poster">
          <div className="hs-zp-poster-tape" />
          <div className="hs-zp-poster-img" />
          <div className="hs-zp-poster-caption">
            <span data-field="teacherCaption" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherCaption}
            </span>
            <span className="hs-zp-poster-sub" data-field="teacherSub" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherSub}
            </span>
          </div>

          {/* marker arrow callouts */}
          <div className="hs-zp-callout hs-zp-callout-1">
            <div className="hs-zp-callout-text">teacher of the week!!</div>
            <svg className="hs-zp-arrow hs-zp-arrow-1" viewBox="0 0 200 120" preserveAspectRatio="none">
              <path
                d="M 10 20 Q 60 10 100 50 Q 140 80 180 100"
                fill="none"
                stroke="#c1281a"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path d="M 170 90 L 180 100 L 168 105" fill="none" stroke="#c1281a" strokeWidth="6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="hs-zp-callout hs-zp-callout-2">
            <svg className="hs-zp-arrow hs-zp-arrow-2" viewBox="0 0 200 120" preserveAspectRatio="none">
              <path
                d="M 190 20 Q 140 10 100 50 Q 60 80 20 100"
                fill="none"
                stroke="#15120d"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path d="M 30 90 L 20 100 L 32 105" fill="none" stroke="#15120d" strokeWidth="6" strokeLinecap="round" />
            </svg>
            <div className="hs-zp-callout-text hs-zp-callout-text-r">★ AP physics rules ★</div>
          </div>
          <div className="hs-zp-scribble">!!</div>
        </div>

        {/* clock card to the right of the poster sub-block */}
        <div className="hs-zp-fc">
          <div className="hs-zp-fc-lbl" data-field="clockLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.clockLabel}
          </div>
          <div className="hs-zp-fc-v" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.clockTime}
          </div>
          <div className="hs-zp-fc-c" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.weatherCondition}
          </div>
        </div>
      </div>

      {/* ============ REGION 5: RANSOM-LETTER ANNOUNCEMENT ~3340-3760 ============ */}
      <div className="hs-zp-alert">
        <div className="hs-zp-alert-tag" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementTag}
        </div>
        <h3 className="hs-zp-alert-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementHeadline}
        </h3>
        <p className="hs-zp-alert-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementBody}
        </p>
        <div className="hs-zp-alert-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementDate}
        </div>
      </div>

      {/* ============ REGION 6: XEROXWIRE TICKER ~3760-3840 ============ */}
      <div className="hs-zp-ticker">
        <div className="hs-zp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-zp-tk-msg">
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
.hs-zp-streaks {
  position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(90deg, transparent 36%, rgba(0,0,0,.05) 60%, transparent 80%),
    linear-gradient(90deg, transparent 8%, rgba(0,0,0,.06) 13%, transparent 18%),
    linear-gradient(180deg, transparent 70%, rgba(0,0,0,.04) 78%, transparent 86%);
  z-index: 1;
}

/* ----- REGION 1: ransom banner ~0-600 ----- */
.hs-zp-banner {
  position: absolute; top: 60px; left: 80px; right: 80px; height: 540px;
  display: flex; flex-direction: column; align-items: center;
  z-index: 4;
}
.hs-zp-tape-strip {
  position: absolute; top: 50px; left: -40px; right: -40px; height: 360px;
  background: rgba(255,216,77,.78);
  transform: rotate(-1.5deg);
  box-shadow: 0 4px 8px rgba(0,0,0,.18);
  z-index: -1;
}
.hs-zp-ransom {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
  gap: 6px; padding-top: 80px; max-width: 100%;
  animation: hsZpJitter 6s ease-in-out infinite;
}
.hs-zp-letter {
  display: inline-grid; place-items: center;
  font-size: 220px; line-height: .85;
  width: 180px; height: 220px;
  color: #15120d; padding: 0 6px;
  text-transform: uppercase;
  box-shadow: 4px 4px 0 rgba(0,0,0,.18), inset 0 0 0 4px rgba(0,0,0,.12);
  letter-spacing: -.02em;
}
.hs-zp-banner-sub {
  font-family: 'Special Elite', monospace; font-size: 36px;
  color: #15120d; letter-spacing: .12em;
  margin-top: 24px; transform: rotate(-.6deg);
  background: rgba(255,255,255,.5); padding: 6px 16px;
}
.hs-zp-stamps {
  display: flex; gap: 24px; margin-top: 18px;
}
.hs-zp-stamp {
  font-family: 'Special Elite', monospace; font-size: 26px;
  letter-spacing: .16em; color: #c1281a; padding: 8px 18px;
  border: 3px solid #c1281a; transform: rotate(3deg);
  text-transform: uppercase; background: rgba(255,255,255,.5);
}
.hs-zp-stamp-ink2 { color: #15120d; border-color: #15120d; transform: rotate(-2deg); }
.hs-zp-stamp-cyan { color: #2dbce6; border-color: #2dbce6; transform: rotate(1deg); }

@keyframes hsZpJitter {
  0%,100% { transform: translateX(0) rotate(-.4deg); }
  33% { transform: translateX(-2px) rotate(.2deg); }
  66% { transform: translateX(3px) rotate(-.6deg); }
}

/* ----- REGION 2: about this week sheet ~600-1500 ----- */
.hs-zp-sheet {
  position: absolute; top: 660px; left: 80px; right: 80px;
  height: 800px;
  background: #fff;
  background-image:
    radial-gradient(circle at 30% 40%, rgba(0,0,0,.025), transparent 40%),
    radial-gradient(circle at 70% 80%, rgba(0,0,0,.03), transparent 38%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.018) 0 1px, transparent 1px 3px);
  padding: 56px 64px 56px;
  box-shadow: 8px 10px 0 rgba(0,0,0,.13), 0 0 0 1px rgba(0,0,0,.08);
  transform: rotate(-.5deg);
  z-index: 3;
  animation: hsZpWobble 10s ease-in-out infinite;
}
.hs-zp-tape {
  position: absolute; width: 220px; height: 56px;
  background: rgba(255,216,77,.82);
  box-shadow: 0 3px 6px rgba(0,0,0,.18);
  z-index: 2;
}
.hs-zp-tape-tl { top: -22px; left: 140px; transform: rotate(-7deg); }
.hs-zp-tape-tr { top: -18px; right: 160px; background: rgba(45,188,230,.78); transform: rotate(5deg); }
.hs-zp-sheet-tag {
  font-family: 'Permanent Marker', cursive; font-size: 38px;
  color: #2dbce6; transform: rotate(-1.5deg); letter-spacing: .04em;
}
.hs-zp-eyebrow {
  font-family: 'Permanent Marker', cursive; font-size: 50px;
  color: #c1281a; transform: rotate(-1deg);
  margin-top: 12px; display: inline-block;
}
.hs-zp-h1 {
  font-family: 'Archivo Black', sans-serif;
  font-size: 280px; line-height: .9;
  letter-spacing: -.02em; color: #15120d;
  margin: 14px 0 0; text-transform: uppercase;
}
.hs-zp-h1 em {
  color: #c1281a; font-style: normal;
  background: #ffd84d;
  padding: 0 16px;
  position: relative;
  box-decoration-break: clone;
}
.hs-zp-sub {
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 56px; line-height: 1.15; color: #15120d;
  margin-top: 28px; max-width: 1900px;
}
.hs-zp-stats {
  position: absolute; left: 64px; right: 64px; bottom: 40px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 28px;
}
.hs-zp-stat {
  background: #fff; padding: 20px 26px;
  border: 3px solid #15120d;
  box-shadow: 4px 4px 0 rgba(0,0,0,.13);
}
.hs-zp-stat-a { transform: rotate(-1deg); }
.hs-zp-stat-b { transform: rotate(1.2deg); background: #ffd84d; }
.hs-zp-lbl {
  font-family: 'Special Elite', monospace; font-size: 24px;
  letter-spacing: .18em; color: #c1281a; text-transform: uppercase;
}
.hs-zp-val {
  font-family: 'Archivo Black', sans-serif; font-size: 130px;
  line-height: .9; color: #15120d; margin-top: 4px;
}
.hs-zp-cap {
  font-family: 'Courier Prime', monospace; font-weight: 700;
  font-size: 22px; color: #15120d; margin-top: 4px;
}

@keyframes hsZpWobble {
  0%,100% { transform: rotate(-.5deg); }
  50% { transform: rotate(.1deg); }
}

/* ----- REGION 3: 2x2 polaroid grid ~1500-2580 ----- */
.hs-zp-grid {
  position: absolute; top: 1540px; left: 80px; right: 80px;
  height: 1020px;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
  gap: 60px;
  z-index: 3;
}
.hs-zp-pol {
  background: #fff; padding: 24px 24px 56px;
  box-shadow: 8px 8px 0 rgba(0,0,0,.16);
  position: relative;
}
.hs-zp-pol-a { transform: rotate(-3deg); }
.hs-zp-pol-b { transform: rotate(4deg); }
.hs-zp-pol-c { transform: rotate(-5deg); }
.hs-zp-pol-count {
  background: #c1281a; color: #fff;
  padding: 36px 32px; transform: rotate(6deg);
  text-align: center;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
}
.hs-zp-pol-tape {
  position: absolute; top: -22px; left: 38%;
  width: 200px; height: 50px;
  background: rgba(255,216,77,.82);
  transform: rotate(-5deg);
  box-shadow: 0 3px 6px rgba(0,0,0,.18);
}
.hs-zp-pol-count .hs-zp-pol-tape { background: rgba(45,188,230,.85); }
.hs-zp-pic {
  width: 100%; height: 360px;
  background: linear-gradient(135deg, #999, #333);
  filter: contrast(1.5) grayscale(1);
  position: relative; overflow: hidden;
}
.hs-zp-pic::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 2px, rgba(0,0,0,.1) 2px 4px);
  mix-blend-mode: multiply;
}
.hs-zp-when {
  font-family: 'Permanent Marker', cursive; font-size: 56px;
  color: #c1281a; margin-top: 18px; line-height: 1;
}
.hs-zp-name {
  font-family: 'Special Elite', monospace; font-size: 32px;
  color: #15120d; margin-top: 8px; line-height: 1.2;
}
.hs-zp-num {
  font-family: 'Archivo Black', sans-serif; font-size: 320px;
  line-height: .85; color: #fff;
  text-shadow: 6px 6px 0 rgba(0,0,0,.32);
}
.hs-zp-lb {
  font-family: 'Permanent Marker', cursive; font-size: 44px;
  color: #fff; line-height: 1.1; margin-top: 14px;
}

/* ----- REGION 4: who's who featured polaroid ~2580-3340 ----- */
.hs-zp-feature {
  position: absolute; top: 2620px; left: 80px; right: 80px;
  height: 720px; z-index: 3;
}
.hs-zp-feature-section-tag {
  font-family: 'Permanent Marker', cursive; font-size: 44px;
  color: #2dbce6; transform: rotate(-1.5deg);
  letter-spacing: .04em; margin-bottom: 16px;
}
.hs-zp-poster {
  width: 1240px; background: #e8e2d0;
  padding: 32px 32px 36px; position: relative;
  transform: rotate(-1.5deg);
  box-shadow: 8px 8px 0 rgba(0,0,0,.15);
}
.hs-zp-poster-tape {
  position: absolute; top: -22px; left: 100px;
  width: 200px; height: 56px;
  background: rgba(193,40,26,.78);
  transform: rotate(-5deg);
  box-shadow: 0 3px 6px rgba(0,0,0,.18);
}
.hs-zp-poster-img {
  width: 100%; height: 460px;
  background: #444;
  background-image:
    radial-gradient(circle at 35% 30%, #888 0 70px, transparent 70px),
    radial-gradient(circle at 35% 30%, transparent 0 60px, #222 60px 160px, transparent 160px),
    linear-gradient(180deg, #666 0%, #333 100%);
  filter: contrast(1.6) grayscale(1);
  position: relative; overflow: hidden;
}
.hs-zp-poster-img::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 3px, rgba(0,0,0,.15) 3px 5px);
  mix-blend-mode: multiply;
}
.hs-zp-poster-caption {
  font-family: 'Permanent Marker', cursive; font-size: 60px;
  color: #15120d; transform: rotate(-1deg);
  margin-top: 22px; line-height: 1;
}
.hs-zp-poster-sub {
  display: block; font-family: 'Special Elite', monospace;
  font-size: 26px; color: #c1281a;
  margin-top: 12px; letter-spacing: .12em;
  transform: rotate(0deg);
}

/* marker callouts on the featured poster */
.hs-zp-callout { position: absolute; pointer-events: none; }
.hs-zp-callout-1 {
  top: 60px; right: -260px; width: 320px;
}
.hs-zp-callout-2 {
  bottom: 100px; right: -300px; width: 340px;
}
.hs-zp-callout-text {
  font-family: 'Permanent Marker', cursive; font-size: 42px;
  color: #c1281a; transform: rotate(-4deg);
  line-height: 1; padding: 0 4px;
}
.hs-zp-callout-text-r {
  color: #15120d; transform: rotate(3deg);
}
.hs-zp-arrow {
  width: 200px; height: 120px;
  margin-top: 8px; display: block;
}
.hs-zp-arrow-2 { margin-bottom: 8px; }
.hs-zp-scribble {
  position: absolute; top: -40px; right: -40px;
  font-family: 'Permanent Marker', cursive;
  font-size: 200px; color: #c1281a;
  transform: rotate(15deg); line-height: 1;
}

.hs-zp-fc {
  position: absolute; top: 80px; right: 0;
  width: 760px; background: #ffd84d;
  padding: 32px 40px;
  border: 4px solid #15120d;
  transform: rotate(2.5deg);
  box-shadow: 8px 8px 0 rgba(0,0,0,.15);
}
.hs-zp-fc-lbl {
  font-family: 'Special Elite', monospace; font-size: 26px;
  letter-spacing: .18em; color: #c1281a; text-transform: uppercase;
}
.hs-zp-fc-v {
  font-family: 'Archivo Black', sans-serif; font-size: 200px;
  line-height: .9; color: #15120d;
}
.hs-zp-fc-c {
  font-family: 'Courier Prime', monospace; font-weight: 700;
  font-size: 28px; color: #15120d; margin-top: 6px;
}

/* ----- REGION 5: ransom-letter announcement ~3340-3760 ----- */
.hs-zp-alert {
  position: absolute; bottom: 100px; left: 80px; right: 80px;
  height: 380px;
  padding: 40px 56px;
  background: #fff;
  border: 4px solid #15120d;
  box-shadow: 8px 8px 0 rgba(0,0,0,.16);
  transform: rotate(-.6deg);
  z-index: 3;
}
.hs-zp-alert::before {
  content: '!!'; position: absolute;
  top: -42px; left: -34px;
  font-family: 'Archivo Black', sans-serif;
  font-size: 110px; color: #c1281a;
  background: #ffd84d;
  width: 110px; height: 110px;
  display: grid; place-items: center;
  border: 4px solid #15120d;
  transform: rotate(-10deg);
  line-height: 1;
}
.hs-zp-alert-tag {
  font-family: 'Permanent Marker', cursive; font-size: 44px;
  color: #c1281a; transform: rotate(-1deg);
  display: inline-block; margin-bottom: 8px;
}
.hs-zp-alert-h3 {
  font-family: 'Archivo Black', sans-serif; font-size: 92px;
  line-height: .95; letter-spacing: -.01em;
  color: #15120d; margin: 0; text-transform: uppercase;
}
.hs-zp-alert-p {
  font-family: 'Special Elite', monospace; font-size: 32px;
  line-height: 1.3; color: #15120d;
  margin: 16px 0 0;
}
.hs-zp-alert-when {
  font-family: 'Permanent Marker', cursive; font-size: 36px;
  color: #c1281a; margin-top: 10px;
}

/* ----- REGION 6: xeroxwire ticker ~3760-3840 ----- */
.hs-zp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
  background: #15120d; color: #f2ecd9;
  display: flex; align-items: center; overflow: hidden;
  z-index: 5;
  border-top: 6px solid #ffd84d;
}
.hs-zp-tk-tag {
  background: #c1281a; color: #fff;
  height: 100%;
  display: flex; align-items: center;
  padding: 0 38px;
  font-family: 'Permanent Marker', cursive; font-size: 38px;
  letter-spacing: .14em; text-transform: lowercase;
  flex-shrink: 0;
  box-shadow: inset 0 -6px 0 #ffd84d;
}
.hs-zp-tk-msg {
  font-family: 'Special Elite', monospace; font-size: 34px;
  padding-left: 40px; white-space: nowrap; letter-spacing: .08em;
  animation: hsZpScroll 60s linear infinite;
  display: inline-flex;
  text-decoration: underline; text-decoration-color: #ffd84d;
  text-decoration-thickness: 6px; text-underline-offset: 6px;
}
@keyframes hsZpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
