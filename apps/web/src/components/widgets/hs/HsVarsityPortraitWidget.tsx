"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsVarsityPortraitWidget — Athletic-department lobby in 2160×3840
 * portrait. Companion to HsVarsityWidget (3840×2160 landscape). Same
 * configuration shape; the layout is re-flowed for vertical viewing
 * with five stacked regions plus a bottom highlight ticker.
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~  0–700px : pennant bunting strip + giant varsity-letter seal +
 *                department label + chunky stadium nickname
 *   ~700–1600 : scoreboard hero (FRIDAY NIGHT vs RIVAL, animated bulb,
 *                home/away crests, time + venue line)
 *   ~1600–2500: athlete-of-the-week trading-card (jersey-number portrait,
 *                name + sport + stat citation in a quote)
 *   ~2500–3400: varsity schedule list — five game rows, each a stat-
 *                card style (sport-day mark, time + venue, opponent name)
 *   ~3400–3840: highlight-reel ticker (scrolling box scores)
 *
 * Every pixel size is FIXED at the 2160×3840 canvas. HsStage scales
 * the whole stage to whatever the actual viewport is. DO NOT regress
 * to vw / % units inside the stage — the editor and player will both
 * misrender if you do.
 */

import { HsStage } from './HsStage';

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
  event4Mark?: string;
  event4When?: string;
  event4Name?: string;
  event5Mark?: string;
  event5When?: string;
  event5Name?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

type Cfg = HsVarsityConfig;

const DEFAULTS: Required<Cfg> = {
  schoolInitials: 'WHS',
  schoolEst: 'EST. 1956',
  schoolName: 'WILDCATS',
  department: 'WESTRIDGE ATHLETICS',
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
  recordValue: '14–2',
  recordCaption: 'League leaders · 8-game streak',
  attendanceValue: '1,217',
  attendanceCaption: 'Enrolled · 98.2% present',
  teacherLabel: 'ATHLETE OF THE WEEK',
  teacherName: 'JORDAN RIVERA',
  teacherGrade: 'SR · GUARD · VARSITY BASKETBALL',
  teacherQuote: '"28 pts, 9 rebounds, 6 assists at Central. Career night, league-best line."',
  teacherNumber: 14,
  announcementTag: '★ HEADS UP',
  announcementHeadline: 'PEP RALLY — 7TH PERIOD · GYM A',
  announcementBody: 'Seniors front row. Marching band enters from the south doors.',
  announcementDate: 'TODAY · 2:15 PM — 3:00 PM',
  countdownValue: '03',
  countdownLabel: 'DAYS TO HOMECOMING',
  countdownSub: 'TICKETS AT THE STUDENT STORE',
  event1Mark: 'MON',
  event1When: '7:00 PM · FIELD',
  event1Name: 'Boys Soccer vs. Central',
  event2Mark: 'TUE',
  event2When: '6:30 PM · GYM B',
  event2Name: 'Girls Volleyball vs. North',
  event3Mark: 'WED',
  event3When: '3:30 PM · TRACK',
  event3Name: 'Track Meet — 4 Schools Invite',
  event4Mark: 'THU',
  event4When: '4:00 PM · POOL',
  event4Name: 'Swim & Dive vs. Lakeside',
  event5Mark: 'FRI',
  event5When: '6:00 PM · GYM A',
  event5Name: 'Senior Night — Varsity BB',
  tickerTag: 'HIGHLIGHT REEL',
  tickerMessage: '🏈 FOOTBALL W 21-14 vs LIONS  ●  🏀 BOYS HOOPS L 58-62 @ EAST  ●  ⚽ SOCCER W 3-1 vs ROOSEVELT  ●  🏐 VOLLEYBALL W 3-0 vs CENTRAL  ●  🏊 SWIM 2ND OF 6 @ INVITATIONAL  ●  🏃 TRACK MIRA SET 800m SCHOOL RECORD  ●  ',
};

export function HsVarsityPortraitWidget({ config }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const games = [
    { mark: c.event1Mark, when: c.event1When, name: c.event1Name },
    { mark: c.event2Mark, when: c.event2When, name: c.event2Name },
    { mark: c.event3Mark, when: c.event3When, name: c.event3Name },
    { mark: c.event4Mark, when: c.event4When, name: c.event4Name },
    { mark: c.event5Mark, when: c.event5When, name: c.event5Name },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: 'linear-gradient(180deg, #0d1b3d 0%, #18306b 55%, #0a1432 100%)',
        fontFamily: "'Inter', sans-serif",
        color: '#fff',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Bungee&family=Black+Ops+One&family=Oswald:wght@500;700&family=Inter:wght@500;700&display=swap"
      />
      <style>{CSS}</style>

      {/* Diagonal pitch stripe overlay (full stage) */}
      <div className="hs-vp-stripes" />

      {/* ============================ REGION 1: HEADER ~0-700 ============================ */}
      <div className="hs-vp-pennants">
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="hs-vp-pennant"
            style={{ background: i % 2 === 0 ? '#ffc42b' : '#e03b1c' }}
          />
        ))}
      </div>

      <div className="hs-vp-dept" data-field="department" style={{ whiteSpace: 'pre-wrap' as const }}>
        {c.department}
      </div>

      <div className="hs-vp-letter">
        <div className="hs-vp-letter-shape">
          <span data-field="schoolInitials" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolInitials}
          </span>
        </div>
        <div className="hs-vp-letter-est" data-field="schoolEst" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.schoolEst}
        </div>
      </div>

      <div className="hs-vp-name" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>
        {c.schoolName}
      </div>

      {/* ============================ REGION 2: SCOREBOARD ~700-1600 ============================ */}
      <div className="hs-vp-score">
        <div className="hs-vp-score-hdr">
          <div>
            <span className="hs-vp-score-bulb" />
            <span className="hs-vp-score-bulb" />
            <span className="hs-vp-score-bulb" />
            <span data-field="scoreboardTag" style={{ whiteSpace: 'pre-wrap' as const, marginLeft: 14 }}>
              {c.scoreboardTag}
            </span>
            <span className="hs-vp-score-bulb" style={{ marginLeft: 14 }} />
            <span className="hs-vp-score-bulb" />
            <span className="hs-vp-score-bulb" />
          </div>
          <div className="hs-vp-score-sport" data-field="scoreboardSport" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.scoreboardSport}
          </div>
        </div>
        <div className="hs-vp-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingEyebrow}
        </div>
        <h1 className="hs-vp-h1" data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingHeadline}
        </h1>

        <div className="hs-vp-matchup">
          <div className="hs-vp-team">
            <div className="hs-vp-crest" data-field="homeAbbr" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.homeAbbr}
            </div>
            <div className="hs-vp-tname" data-field="homeTeam" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.homeTeam}
            </div>
          </div>
          <div className="hs-vp-vs">VS</div>
          <div className="hs-vp-team">
            <div className="hs-vp-crest hs-vp-crest-away" data-field="awayAbbr" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.awayAbbr}
            </div>
            <div className="hs-vp-tname" data-field="awayTeam" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.awayTeam}
            </div>
          </div>
        </div>

        <div className="hs-vp-time">
          <span data-field="scoreboardTime" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.scoreboardTime}
          </span>
          <span className="hs-vp-where-sep"> · </span>
          <span className="hs-vp-where" data-field="scoreboardWhere" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.scoreboardWhere}
          </span>
        </div>
      </div>

      {/* ============================ REGION 3: ATHLETE CARD ~1600-2500 ============================ */}
      <div className="hs-vp-card">
        <div className="hs-vp-card-tag" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherLabel}
        </div>
        <div className="hs-vp-card-row">
          <div className="hs-vp-portrait">
            <div className="hs-vp-jersey-num" data-field="teacherNumber" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherNumber}
            </div>
          </div>
          <div className="hs-vp-card-body">
            <h2 className="hs-vp-h2" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherName}
            </h2>
            <div className="hs-vp-meta" data-field="teacherGrade" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherGrade}
            </div>
            <div className="hs-vp-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.teacherQuote}
            </div>
            <div className="hs-vp-statline">
              <div className="hs-vp-statbox">
                <div className="hs-vp-statbox-val" data-field="recordValue" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {c.recordValue}
                </div>
                <div className="hs-vp-statbox-lbl">RECORD</div>
              </div>
              <div className="hs-vp-statbox">
                <div className="hs-vp-statbox-val" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {c.weatherTemp}
                </div>
                <div className="hs-vp-statbox-lbl">GAMETIME</div>
              </div>
              <div className="hs-vp-statbox">
                <div className="hs-vp-statbox-val" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {c.clockTime}
                </div>
                <div className="hs-vp-statbox-lbl">LOCAL</div>
              </div>
              <div className="hs-vp-statbox">
                <div className="hs-vp-statbox-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {c.countdownValue}
                </div>
                <div className="hs-vp-statbox-lbl">DAYS</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 4: SCHEDULE LIST ~2500-3400 ============================ */}
      <div className="hs-vp-sched">
        <div className="hs-vp-sched-hdr">
          <div className="hs-vp-sched-tag">VARSITY · THIS WEEK</div>
          <div className="hs-vp-sched-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.greetingSubtitle}
          </div>
        </div>
        <div className="hs-vp-sched-list">
          {games.map((g, i) => (
            <div key={i} className="hs-vp-row">
              <div className="hs-vp-row-mark">
                <span className="hs-vp-row-day">{g.mark}</span>
              </div>
              <div className="hs-vp-row-body">
                <div className="hs-vp-row-when">{g.when}</div>
                <div className="hs-vp-row-name">{g.name}</div>
              </div>
              <div className="hs-vp-row-num">{String(i + 1).padStart(2, '0')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============================ REGION 5: HIGHLIGHT TICKER ~3400-3840 ============================ */}
      <div className="hs-vp-foot">
        <div className="hs-vp-anno">
          <div className="hs-vp-anno-tag" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementTag}
          </div>
          <h3 className="hs-vp-anno-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementHeadline}
          </h3>
          <p className="hs-vp-anno-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementBody}
          </p>
          <div className="hs-vp-anno-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.announcementDate}
          </div>
        </div>
      </div>

      {/* Ticker pinned to absolute bottom */}
      <div className="hs-vp-ticker">
        <div className="hs-vp-ticker-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-vp-ticker-msg">
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
.hs-vp-stripes {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(-12deg, transparent 0 240px, rgba(255,196,43,.06) 240px 480px);
  pointer-events: none;
}

/* ----- REGION 1: header ----- */
.hs-vp-pennants {
  position: absolute; top: 24px; left: 0; right: 0; height: 90px; z-index: 4;
  display: flex; justify-content: center; pointer-events: none;
}
.hs-vp-pennant {
  display: inline-block; width: 70px; height: 80px; margin-right: 16px;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  transform-origin: top center;
  animation: hsVpSway 3s ease-in-out infinite;
  filter: drop-shadow(0 6px 8px rgba(0,0,0,.35));
}
.hs-vp-pennant:nth-child(2n) { animation-delay: -.5s; animation-duration: 2.6s; }
.hs-vp-pennant:nth-child(3n) { animation-delay: -1.2s; animation-duration: 3.4s; }
@keyframes hsVpSway { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }

.hs-vp-dept {
  position: absolute; top: 150px; left: 0; right: 0; text-align: center;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 64px; letter-spacing: .26em; color: #ffc42b; text-transform: uppercase;
  z-index: 5;
}

.hs-vp-letter {
  position: absolute; top: 240px; left: 50%; transform: translateX(-50%);
  width: 380px; text-align: center; z-index: 6;
}
.hs-vp-letter-shape {
  width: 380px; height: 360px; background: #ffc42b; color: #0d1b3d;
  font-family: 'Bungee', sans-serif; font-size: 200px;
  display: grid; place-items: center; line-height: 1;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  box-shadow: 0 24px 48px rgba(0,0,0,.55), inset 0 0 0 12px #e03b1c;
  margin: 0 auto;
}
.hs-vp-letter-est {
  margin-top: 20px;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 32px; letter-spacing: .3em; color: #ffc42b;
}

.hs-vp-name {
  position: absolute; top: 660px; left: 0; right: 0; text-align: center;
  font-family: 'Black Ops One', 'Bungee', sans-serif;
  font-size: 200px; line-height: .9; letter-spacing: .02em;
  color: #fff; text-transform: uppercase;
  text-shadow: 12px 12px 0 #e03b1c, 22px 22px 0 rgba(0,0,0,.45);
  z-index: 5;
}

/* ----- REGION 2: scoreboard ----- */
.hs-vp-score {
  position: absolute; top: 920px; left: 60px; right: 60px;
  height: 880px;
  background: #0a0e1c; border: 12px solid #ffc42b;
  padding: 44px 56px; z-index: 3;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 48px rgba(0,0,0,.5), inset 0 0 0 4px #0d1b3d;
}
.hs-vp-score-hdr {
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 40px; letter-spacing: .22em; text-transform: uppercase; color: #ffc42b;
}
.hs-vp-score-sport { color: #ffc42b; opacity: .9; }
.hs-vp-score-bulb {
  display: inline-block; width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffe488, #e03b1c);
  margin-right: 8px; box-shadow: 0 0 14px rgba(224,59,28,.7);
  animation: hsVpBulb 1.4s steps(2) infinite;
}
.hs-vp-score-bulb:nth-child(2n) { animation-delay: -.4s; }
.hs-vp-score-bulb:nth-child(3n) { animation-delay: -.7s; }
@keyframes hsVpBulb { 0%,49% { opacity: 1; } 50%,100% { opacity: .25; } }

.hs-vp-eyebrow {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 44px; letter-spacing: .22em; text-transform: uppercase;
  color: #e03b1c; margin-top: 28px;
}
.hs-vp-h1 {
  font-family: 'Bungee', sans-serif; font-size: 200px; line-height: .9;
  margin: 6px 0 14px; color: #fff; letter-spacing: -.02em; text-transform: uppercase;
  text-shadow: 6px 6px 0 #e03b1c;
}

.hs-vp-matchup {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px;
  padding: 22px 0 14px; flex: 1;
}
.hs-vp-team { display: flex; flex-direction: column; align-items: center; gap: 18px; }
.hs-vp-crest {
  width: 220px; height: 220px; background: #ffc42b; display: grid; place-items: center;
  font-family: 'Bungee', sans-serif; font-size: 84px; color: #0d1b3d;
  clip-path: polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%);
  box-shadow: 0 12px 24px rgba(0,0,0,.5);
}
.hs-vp-crest-away { background: #e03b1c; color: #fff; }
.hs-vp-tname {
  font-family: 'Bungee', sans-serif; font-size: 76px; line-height: .9;
  color: #fff; letter-spacing: -.01em; text-align: center;
}
.hs-vp-vs {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 96px;
  color: #ffc42b; padding: 0 16px;
  text-shadow: 4px 4px 0 #e03b1c;
}

.hs-vp-time {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 56px; text-align: center; color: #fff;
  border-top: 4px dashed rgba(255,196,43,.35);
  padding-top: 22px; margin-top: 18px;
  letter-spacing: .08em; text-transform: uppercase;
}
.hs-vp-where { color: #ffc42b; }
.hs-vp-where-sep { color: rgba(255,196,43,.5); }

/* ----- REGION 3: athlete-of-the-week trading card ----- */
.hs-vp-card {
  position: absolute; top: 1840px; left: 60px; right: 60px;
  height: 900px;
  background: #f4efe2; color: #0d1b3d;
  border: 12px solid #0d1b3d; padding: 44px 56px;
  z-index: 3;
  box-shadow: 0 28px 56px rgba(0,0,0,.55);
}
.hs-vp-card::before {
  content: ''; position: absolute;
  top: -12px; left: -12px; right: -12px; height: 36px;
  background: #e03b1c;
}
.hs-vp-card::after {
  content: ''; position: absolute;
  bottom: -12px; left: -12px; right: -12px; height: 12px;
  background: repeating-linear-gradient(90deg, #ffc42b 0 30px, #e03b1c 30px 60px);
}
.hs-vp-card-tag {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 38px; letter-spacing: .26em; text-transform: uppercase;
  color: #e03b1c; margin-top: 20px;
}
.hs-vp-card-row {
  display: grid; grid-template-columns: 540px 1fr; gap: 56px;
  align-items: center; margin-top: 24px;
}
.hs-vp-portrait {
  width: 540px; height: 660px; background: #cbd5e1;
  display: grid; place-items: center;
  position: relative; overflow: hidden;
  border: 8px solid #0d1b3d;
  box-shadow: inset 0 0 0 6px #ffc42b, 0 16px 32px rgba(0,0,0,.4);
}
.hs-vp-portrait::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, rgba(13,27,61,.10) 0 10px, transparent 10px 20px);
}
.hs-vp-jersey-num {
  font-family: 'Bungee', sans-serif; font-size: 420px;
  color: #0d1b3d; line-height: .85; opacity: .35;
  position: relative; z-index: 1;
}
.hs-vp-card-body { display: flex; flex-direction: column; gap: 12px; }
.hs-vp-h2 {
  font-family: 'Bungee', sans-serif; font-size: 130px; line-height: .9;
  margin: 0; color: #0d1b3d; text-transform: uppercase; letter-spacing: -.01em;
}
.hs-vp-meta {
  font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 38px;
  color: #475569; letter-spacing: .12em; text-transform: uppercase;
}
.hs-vp-quote {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 36px;
  color: #334155; font-style: italic; line-height: 1.3;
  border-left: 8px solid #e03b1c; padding-left: 24px;
}
.hs-vp-statline {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 8px;
}
.hs-vp-statbox {
  background: #0d1b3d; color: #fff; padding: 16px 12px; text-align: center;
  border-bottom: 6px solid #ffc42b;
}
.hs-vp-statbox-val {
  font-family: 'Bungee', sans-serif; font-size: 64px; line-height: 1;
  color: #ffc42b;
}
.hs-vp-statbox-lbl {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 22px; letter-spacing: .22em; color: #cbd5e1;
  margin-top: 6px; text-transform: uppercase;
}

/* ----- REGION 4: schedule list ----- */
.hs-vp-sched {
  position: absolute; top: 2780px; left: 60px; right: 60px;
  height: 720px; z-index: 3;
}
.hs-vp-sched-hdr {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 24px; padding: 0 8px;
}
.hs-vp-sched-tag {
  font-family: 'Bungee', sans-serif; font-size: 56px; color: #ffc42b;
  letter-spacing: .04em; text-transform: uppercase;
  text-shadow: 4px 4px 0 #e03b1c;
}
.hs-vp-sched-sub {
  font-family: 'Oswald', sans-serif; font-weight: 500;
  font-size: 32px; color: #cbd5e1; letter-spacing: .08em;
  text-transform: uppercase; max-width: 1100px; text-align: right;
}
.hs-vp-sched-list {
  display: flex; flex-direction: column; gap: 14px;
}
.hs-vp-row {
  display: grid; grid-template-columns: 220px 1fr 120px;
  align-items: center; gap: 28px;
  background: #0a0e1c; border: 4px solid #ffc42b;
  padding: 18px 32px; height: 110px;
  position: relative;
}
.hs-vp-row::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 8px;
  background: #e03b1c;
}
.hs-vp-row-mark {
  background: #ffc42b; color: #0d1b3d;
  display: grid; place-items: center; height: 90px;
  clip-path: polygon(0 0, 100% 0, 90% 100%, 0 100%);
}
.hs-vp-row-day {
  font-family: 'Bungee', sans-serif; font-size: 64px; line-height: 1;
}
.hs-vp-row-body { display: flex; flex-direction: column; gap: 4px; }
.hs-vp-row-when {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 28px; color: #ffc42b; letter-spacing: .18em;
  text-transform: uppercase;
}
.hs-vp-row-name {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 44px; color: #fff;
  text-transform: uppercase; line-height: 1.02;
}
.hs-vp-row-num {
  font-family: 'Bungee', sans-serif; font-size: 78px; color: #e03b1c;
  text-align: right; line-height: 1;
  text-shadow: 4px 4px 0 rgba(0,0,0,.35);
}

/* ----- REGION 5: footer (announcement strip + ticker) ----- */
.hs-vp-foot {
  position: absolute; left: 60px; right: 60px;
  bottom: 80px; height: 280px; z-index: 3;
}
.hs-vp-anno {
  background: #0a0e1c; border-left: 18px solid #ffc42b;
  padding: 26px 36px; height: 100%;
  display: flex; flex-direction: column;
}
.hs-vp-anno-tag {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 32px; letter-spacing: .22em; color: #ffc42b; text-transform: uppercase;
}
.hs-vp-anno-h3 {
  font-family: 'Bungee', sans-serif; font-size: 70px; line-height: .95;
  margin: 8px 0 0; color: #fff; text-transform: uppercase;
}
.hs-vp-anno-p {
  font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 30px; color: #cbd5e1; margin: 10px 0 0;
}
.hs-vp-anno-when {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 30px; color: #ffc42b; letter-spacing: .14em;
  text-transform: uppercase; margin-top: auto;
}

/* ----- ticker pinned to absolute bottom ----- */
.hs-vp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
  background: #ffc42b; color: #0d1b3d;
  display: flex; align-items: center; overflow: hidden; z-index: 5;
}
.hs-vp-ticker-tag {
  background: #0d1b3d; color: #ffc42b;
  font-family: 'Bungee', sans-serif; font-size: 32px;
  padding: 0 36px; height: 100%;
  display: flex; align-items: center; flex-shrink: 0; letter-spacing: .18em;
}
.hs-vp-ticker-msg {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 32px;
  padding-left: 36px; white-space: nowrap; letter-spacing: .12em;
  text-transform: uppercase;
  animation: hsVpScroll 60s linear infinite;
  display: inline-flex; gap: 0;
}
@keyframes hsVpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
