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
  tickerTag?: string;
  tickerMessage?: string;
}

const DEFAULTS: Required<HsVarsityConfig> = {
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
};

export function HsVarsityWidget({ config }: { config?: HsVarsityConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsVarsityConfig>;
  return (
    <HsStage
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
          <span>{c.schoolInitials}</span>
          <br />
          <span className="hs-varsity-seal-est">{c.schoolEst}</span>
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
        <div className="hs-varsity-dept">{c.department}</div>
        <div className="hs-varsity-name">{c.schoolName}</div>
      </div>

      {/* Jersey row: greeting + scoreboard */}
      <div className="hs-varsity-jersey">
        <div className="hs-varsity-chest">
          <div>
            <div className="hs-varsity-eyebrow">{c.greetingEyebrow}</div>
            <h1 className="hs-varsity-h1">{c.greetingHeadline}</h1>
            <div className="hs-varsity-sub">{c.greetingSubtitle}</div>
          </div>
        </div>
        <div className="hs-varsity-score">
          <div className="hs-varsity-score-hdr">
            <div>
              <span className="hs-varsity-score-dot" />
              <span>{c.scoreboardTag}</span>
            </div>
            <div>{c.scoreboardSport}</div>
          </div>
          <div className="hs-varsity-matchup">
            <div className="hs-varsity-team hs-varsity-team-home">
              <div className="hs-varsity-crest">{c.homeAbbr}</div>
              <div className="hs-varsity-tname">{c.homeTeam}</div>
            </div>
            <div className="hs-varsity-vs">VS</div>
            <div className="hs-varsity-team hs-varsity-team-away">
              <div className="hs-varsity-tname">{c.awayTeam}</div>
              <div className="hs-varsity-crest hs-varsity-crest-away">{c.awayAbbr}</div>
            </div>
          </div>
          <div className="hs-varsity-time">
            <span>{c.scoreboardTime}</span> · <span className="hs-varsity-where">{c.scoreboardWhere}</span>
          </div>
        </div>
      </div>

      {/* Stats row: clock / weather / record / attendance */}
      <div className="hs-varsity-stats">
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">LOCAL TIME</div>
          <div className="hs-varsity-stat-val">{c.clockTime}</div>
          <div className="hs-varsity-stat-cap">{c.clockCaption}</div>
        </div>
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">GAMETIME FORECAST</div>
          <div className="hs-varsity-stat-val">{c.weatherTemp}</div>
          <div className="hs-varsity-stat-cap">{c.weatherCondition}</div>
        </div>
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">SEASON RECORD</div>
          <div className="hs-varsity-stat-val">{c.recordValue}</div>
          <div className="hs-varsity-stat-cap">{c.recordCaption}</div>
        </div>
        <div className="hs-varsity-stat">
          <div className="hs-varsity-stat-lbl">TODAY&apos;S ATTENDANCE</div>
          <div className="hs-varsity-stat-val">{c.attendanceValue}</div>
          <div className="hs-varsity-stat-cap">{c.attendanceCaption}</div>
        </div>
      </div>

      {/* Coach / teacher of the week */}
      <div className="hs-varsity-coach">
        <div className="hs-varsity-portrait">
          <div className="hs-varsity-jersey-num">{c.teacherNumber}</div>
        </div>
        <div>
          <div className="hs-varsity-eyebrow hs-varsity-coach-eyebrow">{c.teacherLabel}</div>
          <h2 className="hs-varsity-h2">{c.teacherName}</h2>
          <div className="hs-varsity-meta">{c.teacherGrade}</div>
          <div className="hs-varsity-quote">{c.teacherQuote}</div>
        </div>
      </div>

      {/* Announcement + countdown column */}
      <div className="hs-varsity-colright">
        <div className="hs-varsity-anno">
          <div className="hs-varsity-anno-tag">{c.announcementTag}</div>
          <h3 className="hs-varsity-anno-h3">{c.announcementHeadline}</h3>
          <p className="hs-varsity-anno-p">{c.announcementBody}</p>
          <div className="hs-varsity-anno-when">{c.announcementDate}</div>
        </div>
        <div className="hs-varsity-countdown">
          <div className="hs-varsity-cd-num">{c.countdownValue}</div>
          <div className="hs-varsity-cd-lbl">
            <span>{c.countdownLabel}</span>
            <br />
            <span className="hs-varsity-cd-sub">{c.countdownSub}</span>
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
        <div className="hs-varsity-ticker-tag">{c.tickerTag}</div>
        <div className="hs-varsity-ticker-msg">
          <span>{c.tickerMessage}</span>
          <span>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — keeps every pixel value identical to scratch/design/hs/varsity.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Bungee&family=Inter:wght@500;700&display=swap');

.hs-varsity-stripes {
  position: absolute; inset: 0;
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
.hs-varsity-seal-est { font-size: 18px; letter-spacing: .2em; margin-top: 10px; color: #6b5110; display: inline-block; }

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
  font-size: 44px; letter-spacing: .2em; text-transform: uppercase; color: #e03b1c;
  margin-top: 32px;
}
.hs-varsity-h1 {
  font-family: 'Bungee', sans-serif; font-size: 220px; line-height: .9;
  margin: 12px 0; color: #0d1b3d; letter-spacing: -.02em; text-transform: uppercase;
}
.hs-varsity-sub {
  font-family: 'Oswald', sans-serif; font-weight: 500;
  font-size: 44px; color: #334155; margin: 0; line-height: 1.2;
}

.hs-varsity-score {
  background: #0a0e1c; border: 8px solid #ffc42b; padding: 28px 40px; position: relative;
  display: flex; flex-direction: column; justify-content: space-between;
}
.hs-varsity-score-hdr {
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 36px; letter-spacing: .22em; text-transform: uppercase; color: #ffc42b;
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
  width: 130px; height: 130px; background: #ffc42b; display: grid; place-items: center;
  font-family: 'Bungee', sans-serif; font-size: 48px; color: #0d1b3d;
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
  font-size: 52px; text-align: center; color: #fff;
  border-top: 3px dashed rgba(255,196,43,.3);
  padding-top: 18px; margin-top: 14px;
  letter-spacing: .08em; text-transform: uppercase;
}
.hs-varsity-where { color: #ffc42b; }

.hs-varsity-stats {
  position: absolute; top: 970px; left: 60px; right: 60px; height: 240px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px;
}
.hs-varsity-stat { background: #0a0e1c; border: 6px solid rgba(255,196,43,.3); padding: 20px 28px; position: relative; }
.hs-varsity-stat-lbl { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 30px; letter-spacing: .22em; color: #ffc42b; text-transform: uppercase; }
.hs-varsity-stat-val { font-family: 'Bungee', sans-serif; font-size: 120px; line-height: .9; color: #fff; margin-top: 8px; letter-spacing: -.01em; }
.hs-varsity-stat-cap { font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 30px; color: #cbd5e1; margin-top: 4px; }

.hs-varsity-coach {
  position: absolute; top: 1240px; left: 60px; width: 1720px; height: 620px;
  background: #f4efe2; color: #0d1b3d; padding: 36px 48px;
  display: grid; grid-template-columns: 420px 1fr; gap: 48px; align-items: center;
  border: 8px solid #0d1b3d;
}
.hs-varsity-coach::before { content: ''; position: absolute; top: -8px; left: -8px; right: -8px; height: 28px; background: #e03b1c; }
.hs-varsity-portrait { width: 420px; height: 520px; background: #cbd5e1; display: grid; place-items: center; overflow: hidden; position: relative; }
.hs-varsity-portrait::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(45deg, rgba(13,27,61,.08) 0 8px, transparent 8px 16px); }
.hs-varsity-jersey-num { font-family: 'Bungee', sans-serif; font-size: 320px; color: #0d1b3d; line-height: .85; opacity: .25; }
.hs-varsity-coach-eyebrow { color: #e03b1c; margin-top: 0; font-size: 36px; }
.hs-varsity-h2 { font-family: 'Bungee', sans-serif; font-size: 150px; line-height: .9; margin: 10px 0 6px; color: #0d1b3d; text-transform: uppercase; }
.hs-varsity-meta { font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 36px; color: #475569; letter-spacing: .1em; text-transform: uppercase; }
.hs-varsity-quote { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 34px; color: #334155; margin-top: 20px; font-style: italic; line-height: 1.3; max-width: 1100px; }

.hs-varsity-colright {
  position: absolute; top: 1240px; right: 60px; width: 1940px; display: grid; gap: 24px;
}
.hs-varsity-anno { background: #0a0e1c; border-left: 14px solid #ffc42b; padding: 24px 36px; }
.hs-varsity-anno-tag { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 30px; letter-spacing: .22em; color: #ffc42b; text-transform: uppercase; }
.hs-varsity-anno-h3 { font-family: 'Bungee', sans-serif; font-size: 68px; line-height: .95; margin: 8px 0 0; color: #fff; text-transform: uppercase; }
.hs-varsity-anno-p { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px; color: #cbd5e1; margin: 10px 0 0; }
.hs-varsity-anno-when { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 28px; color: #ffc42b; letter-spacing: .14em; text-transform: uppercase; margin-top: 10px; }
.hs-varsity-countdown { background: #e03b1c; border-left: 14px solid #ffc42b; padding: 24px 36px; display: flex; align-items: center; gap: 40px; }
.hs-varsity-cd-num { font-family: 'Bungee', sans-serif; font-size: 220px; line-height: .8; color: #fff; text-shadow: 8px 8px 0 #0d1b3d; }
.hs-varsity-cd-lbl { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 48px; color: #fff; letter-spacing: .14em; text-transform: uppercase; line-height: 1.1; }
.hs-varsity-cd-sub { font-size: 28px; opacity: .85; }

.hs-varsity-sched {
  position: absolute; bottom: 80px; left: 60px; right: 60px; height: 160px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
}
.hs-varsity-sch { background: #0a0e1c; border: 4px solid #ffc42b; padding: 16px 28px; display: flex; align-items: center; gap: 24px; }
.hs-varsity-sch-mark { font-family: 'Bungee', sans-serif; font-size: 80px; line-height: .85; color: #ffc42b; padding-right: 22px; border-right: 3px dashed rgba(255,255,255,.2); }
.hs-varsity-sch-d { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 28px; color: #ffc42b; letter-spacing: .16em; text-transform: uppercase; }
.hs-varsity-sch-n { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 44px; color: #fff; text-transform: uppercase; line-height: 1.05; margin-top: 4px; }

.hs-varsity-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 60px;
  background: #ffc42b; color: #0d1b3d;
  display: flex; align-items: center; overflow: hidden;
}
.hs-varsity-ticker-tag {
  background: #0d1b3d; color: #ffc42b;
  font-family: 'Bungee', sans-serif; font-size: 28px; padding: 0 30px; height: 100%;
  display: flex; align-items: center; flex-shrink: 0; letter-spacing: .18em;
}
.hs-varsity-ticker-msg {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 28px;
  padding-left: 30px; white-space: nowrap; letter-spacing: .12em; text-transform: uppercase;
  animation: hsVarScroll 45s linear infinite; display: inline-flex; gap: 0;
}
@keyframes hsVarScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
