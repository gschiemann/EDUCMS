"use client";

/**
 * HsYearbookWidget — Editorial magazine-spread lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/yearbook.html
 * Ported via HsStage transform:scale pattern.
 *
 * Widgets wired in the scene:
 *   - school        → masthead title + issue line
 *   - clock         → folio-style time + caption
 *   - greeting      → eyebrow + big serif headline + italic lede
 *   - announcement  → editor's note card
 *   - weather       → TODAY card
 *   - countdown     → DAYS TO GRADUATION card (and mirror in footer)
 *   - feature       → photo block with caption (photo tag, number, title, body)
 *   - teacher       → featured portrait with quote + byline
 *   - events (×3)   → footer calendar cols
 *   - ticker        → WIRE · LATE bottom crawl
 */

import { HsStage } from './HsStage';

export interface HsYearbookConfig {
  schoolName?: string;
  schoolIssue?: string;
  schoolSection?: string;
  clockTime?: string;
  clockCaption?: string;
  greetingEyebrow?: string;
  greetingHeadline?: string;
  greetingSubtitle?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownUnit?: string;
  featurePhotoTag?: string;
  featureNum?: string;
  featureTitle?: string;
  featureBody?: string;
  teacherPhotoTag?: string;
  teacherLabel?: string;
  teacherName?: string;
  teacherGrade?: string;
  teacherQuote?: string;
  teacherByline?: string;
  folioPage?: string;
  event1When?: string;
  event1Name?: string;
  event2When?: string;
  event2Name?: string;
  event3When?: string;
  event3Name?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

const DEFAULTS: Required<HsYearbookConfig> = {
  schoolName: 'The Westridge Review',
  schoolIssue: 'VOL. LXIX · NO. 142 · APRIL 2026',
  schoolSection: 'CALENDAR · SECTION B',
  clockTime: '7:53 a.m.',
  clockCaption: 'Tuesday · April 21 · 46° clear',
  greetingEyebrow: 'MORNING EDITION · FEATURE',
  greetingHeadline: 'Today, we begin again.',
  greetingSubtitle: "A quiet hallway, a fresh notebook, a first-period bell you've heard a thousand times. The best mornings are the ones that feel exactly like this one.",
  announcementTag: "EDITOR'S NOTE",
  announcementHeadline: 'The yearbook deadline just moved up.',
  announcementBody: 'Senior portraits, club pages, and candid submissions due Friday, April 28 at 3:30 PM. Drop off in Room 217 or upload through the portal.',
  announcementDate: 'DEADLINE · FRI APR 28 · 3:30 PM',
  weatherTemp: '46°',
  weatherCondition: 'Clear skies · HI 62° · LO 38°',
  countdownLabel: 'DAYS TO GRADUATION',
  countdownValue: 41,
  countdownUnit: 'Seniors — caps ordered by Friday',
  featurePhotoTag: '[ photo · auditorium · april 18 ]',
  featureNum: '01',
  featureTitle: 'Spring musical opens Friday — "Into the Woods."',
  featureBody: 'Directed by Ms. Park and the theater tech crew. Three nights: Friday 7pm, Saturday 2pm & 7pm. Tickets $8 students · $12 general. Sensory-friendly matinee on Saturday.',
  teacherPhotoTag: '[ portrait · J. Kowalski ]',
  teacherLabel: 'FEATURED · TEACHER OF THE WEEK',
  teacherName: 'Ms. Kowalski',
  teacherGrade: 'AP PHYSICS · ROOM 214 · 14 YRS AT WHS',
  teacherQuote: '"The answer is in the free-body diagram. Draw the picture — every time. The math always follows."',
  teacherByline: 'PROFILE BY THE EDITORIAL STAFF · P. 12',
  folioPage: '— p. 01 —',
  event1When: 'MON · 3:30 PM',
  event1Name: 'Student government — open meeting, lib.',
  event2When: 'WED · 7:00 PM',
  event2Name: 'Spring band concert, auditorium.',
  event3When: 'FRI · 7:00 PM',
  event3Name: '"Into the Woods" opening night.',
  tickerTag: 'WIRE · LATE',
  tickerMessage: 'NEWS DESK ANNOUNCEMENT — BUS 14 RUNNING LATE, NEW DEPARTURE 7:58 AM · LUNCH TODAY: CHICKEN BOWL, SALAD BAR, VEGAN OPT · AP PSYCH STUDY HALL MOVED TO LIBRARY · LOST: SILVER EARBUDS — FRONT OFFICE · ',
};

export function HsYearbookWidget({ config }: { config?: HsYearbookConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsYearbookConfig>;
  return (
    <HsStage
      stageStyle={{
        background: '#f7f3ea',
        fontFamily: "'Inter', sans-serif",
        color: '#1a1a17',
      }}
    >
      <style>{CSS}</style>
      <div className="hs-yb-grain" />
      <div className="hs-yb-divider" />

      <div className="hs-yb-masthead">
        <div className="hs-yb-title" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</div>
        <div className="hs-yb-issue" data-field="schoolIssue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolIssue}</div>
      </div>

      <div className="hs-yb-clock">
        <div className="hs-yb-clock-t" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</div>
        <div className="hs-yb-clock-c" data-field="clockCaption" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockCaption}</div>
      </div>

      <div className="hs-yb-hero">
        <div className="hs-yb-eyebrow" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
        <h1 className="hs-yb-h1" data-field="greetingHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline}</h1>
        <p className="hs-yb-lede" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</p>
      </div>

      <div className="hs-yb-right">
        <div className="hs-yb-card">
          <div className="hs-yb-kicker" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementTag}</div>
          <h3 className="hs-yb-card-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
          <p className="hs-yb-cap" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
          <div className="hs-yb-kicker" style={{ marginTop: 14, color: '#b23b20' }}>{c.announcementDate}</div>
        </div>
        <div className="hs-yb-twin">
          <div className="hs-yb-card">
            <div className="hs-yb-kicker">TODAY</div>
            <div className="hs-yb-big" data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherTemp}</div>
            <div className="hs-yb-cap" data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherCondition}</div>
          </div>
          <div className="hs-yb-card">
            <div className="hs-yb-kicker" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
            <div className="hs-yb-big" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-yb-cap" data-field="countdownUnit" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownUnit}</div>
          </div>
        </div>
      </div>

      <div className="hs-yb-feature">
        <div className="hs-yb-photo">
          <div className="hs-yb-photo-tag" data-field="featurePhotoTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.featurePhotoTag}</div>
        </div>
        <div className="hs-yb-caption">
          <div className="hs-yb-num" data-field="featureNum" style={{ whiteSpace: 'pre-wrap' as const }}>{c.featureNum}</div>
          <div className="hs-yb-txt">
            <div className="hs-yb-ctitle" data-field="featureTitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.featureTitle}</div>
            <div className="hs-yb-cbody" data-field="featureBody" style={{ whiteSpace: 'pre-wrap' as const }}>{c.featureBody}</div>
          </div>
        </div>
      </div>

      <div className="hs-yb-featured">
        <div className="hs-yb-portrait">
          <div className="hs-yb-frame" data-field="teacherPhotoTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherPhotoTag}</div>
        </div>
        <div>
          <div className="hs-yb-kicker-red" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherLabel}</div>
          <h2 className="hs-yb-feat-h2" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherName}</h2>
          <div className="hs-yb-meta" data-field="teacherGrade" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherGrade}</div>
          <blockquote className="hs-yb-blockquote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherQuote}</blockquote>
          <div className="hs-yb-byline" data-field="teacherByline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherByline}</div>
        </div>
      </div>

      <div className="hs-yb-folio" data-field="folioPage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.folioPage}</div>

      <div className="hs-yb-footstrip">
        <div className="hs-yb-foothdr">
          <div className="hs-yb-foothdr-h">Upcoming, this week &amp; next.</div>
          <div className="hs-yb-foothdr-meta" data-field="schoolSection" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolSection}</div>
        </div>
        <div className="hs-yb-cols">
          <div className="hs-yb-col">
            <div className="hs-yb-col-d" data-field="event1When" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event1When}</div>
            <div className="hs-yb-col-n" data-field="event1Name" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event1Name}</div>
          </div>
          <div className="hs-yb-col">
            <div className="hs-yb-col-d" data-field="event2When" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event2When}</div>
            <div className="hs-yb-col-n" data-field="event2Name" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event2Name}</div>
          </div>
          <div className="hs-yb-col">
            <div className="hs-yb-col-d" data-field="event3When" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event3When}</div>
            <div className="hs-yb-col-n" data-field="event3Name" style={{ whiteSpace: 'pre-wrap' as const }}>{c.event3Name}</div>
          </div>
          <div className="hs-yb-count">
            <div className="hs-yb-count-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-yb-count-lbl" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
          </div>
        </div>
      </div>

      <div className="hs-yb-ticker">
        <div className="hs-yb-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-yb-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap');
.hs-yb-grain { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 30% 20%, rgba(0,0,0,.02), transparent 40%), radial-gradient(circle at 80% 70%, rgba(0,0,0,.03), transparent 50%), repeating-linear-gradient(0deg, rgba(0,0,0,.005) 0 2px, transparent 2px 4px); }
.hs-yb-divider { position: absolute; top: 80px; bottom: 80px; left: 50%; width: 1px; background: #d6cfbe; pointer-events: none; }
.hs-yb-masthead { position: absolute; top: 60px; left: 80px; right: 80px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #1a1a17; padding-bottom: 20px; }
.hs-yb-title { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 100px; line-height: .9; letter-spacing: -.01em; color: #1a1a17; font-style: italic; }
.hs-yb-issue { font-family: 'JetBrains Mono', monospace; font-size: 30px; color: #666; letter-spacing: .18em; text-transform: uppercase; }
.hs-yb-clock { position: absolute; top: 60px; right: 80px; text-align: right; }
.hs-yb-clock-t { font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic; font-size: 92px; line-height: .9; }
.hs-yb-clock-c { font-family: 'JetBrains Mono', monospace; font-size: 22px; color: #666; letter-spacing: .18em; text-transform: uppercase; margin-top: 4px; }
.hs-yb-hero { position: absolute; top: 200px; left: 80px; width: 1780px; }
.hs-yb-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 30px; color: #b23b20; letter-spacing: .22em; text-transform: uppercase; }
.hs-yb-h1 { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 290px; line-height: .9; margin: 16px 0 0; letter-spacing: -.02em; color: #1a1a17; }
.hs-yb-lede { font-family: 'Playfair Display', serif; font-weight: 700; font-style: italic; font-size: 62px; color: #333; margin-top: 40px; line-height: 1.2; max-width: 1640px; }
.hs-yb-right { position: absolute; top: 200px; right: 80px; width: 1740px; display: grid; gap: 28px; }
.hs-yb-card { background: #fff; border: 2px solid #1a1a17; padding: 28px 36px; position: relative; }
.hs-yb-kicker { font-family: 'JetBrains Mono', monospace; font-size: 26px; color: #666; letter-spacing: .22em; text-transform: uppercase; }
.hs-yb-kicker-red { font-family: 'JetBrains Mono', monospace; font-size: 28px; letter-spacing: .22em; color: #b23b20; text-transform: uppercase; }
.hs-yb-card-h3 { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 82px; line-height: 1; margin: 8px 0 0; letter-spacing: -.01em; }
.hs-yb-big { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 180px; line-height: .9; margin: 6px 0; }
.hs-yb-cap { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 30px; color: #555; }
.hs-yb-twin { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.hs-yb-feature { position: absolute; top: 1080px; left: 80px; width: 1780px; height: 700px; }
.hs-yb-photo { width: 100%; height: 500px; background: linear-gradient(135deg, #d6cfbe, #b0a897); position: relative; border: 2px solid #1a1a17; overflow: hidden; }
.hs-yb-photo::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(45deg, rgba(0,0,0,.06) 0 10px, transparent 10px 20px); }
.hs-yb-photo-tag { position: absolute; bottom: 20px; left: 20px; background: #fff; border: 2px solid #1a1a17; padding: 8px 16px; font-family: 'JetBrains Mono', monospace; font-size: 24px; letter-spacing: .14em; text-transform: uppercase; }
.hs-yb-caption { padding-top: 24px; display: flex; gap: 24px; align-items: flex-start; border-top: 2px solid #1a1a17; margin-top: 16px; }
.hs-yb-num { font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900; font-size: 92px; line-height: .8; color: #b23b20; flex-shrink: 0; }
.hs-yb-ctitle { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 52px; line-height: 1; color: #1a1a17; }
.hs-yb-cbody { font-family: 'Inter', sans-serif; font-weight: 400; font-size: 30px; color: #333; margin-top: 8px; line-height: 1.35; max-width: 1400px; }
.hs-yb-featured { position: absolute; top: 1080px; right: 80px; width: 1740px; height: 780px; background: #fff; border: 2px solid #1a1a17; padding: 32px; display: grid; grid-template-columns: 620px 1fr; gap: 36px; }
.hs-yb-portrait { width: 620px; height: 720px; background: linear-gradient(160deg, #d6cfbe, #a09680); position: relative; border: 2px solid #1a1a17; overflow: hidden; }
.hs-yb-portrait::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(-45deg, rgba(0,0,0,.05) 0 8px, transparent 8px 16px); }
.hs-yb-frame { position: absolute; bottom: 18px; left: 18px; background: #fff; border: 2px solid #1a1a17; padding: 6px 14px; font-family: 'JetBrains Mono', monospace; font-size: 22px; letter-spacing: .1em; }
.hs-yb-feat-h2 { font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic; font-size: 160px; line-height: .9; margin: 10px 0 0; color: #1a1a17; letter-spacing: -.01em; }
.hs-yb-meta { font-family: 'JetBrains Mono', monospace; font-size: 26px; color: #666; letter-spacing: .12em; margin-top: 12px; text-transform: uppercase; }
.hs-yb-blockquote { margin: 20px 0 0; font-family: 'Playfair Display', serif; font-weight: 700; font-style: italic; font-size: 46px; line-height: 1.25; color: #333; border-left: 4px solid #b23b20; padding-left: 28px; }
.hs-yb-byline { font-family: 'JetBrains Mono', monospace; font-size: 24px; color: #999; letter-spacing: .14em; margin-top: 16px; text-transform: uppercase; }
.hs-yb-folio { position: absolute; bottom: 320px; left: 80px; font-family: 'JetBrains Mono', monospace; font-size: 22px; letter-spacing: .18em; color: #999; text-transform: uppercase; }
.hs-yb-footstrip { position: absolute; bottom: 0; left: 0; right: 0; height: 280px; background: #1a1a17; color: #f7f3ea; padding: 24px 80px 0; box-sizing: border-box; }
.hs-yb-foothdr { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #f7f3ea; padding-bottom: 10px; margin-bottom: 18px; }
.hs-yb-foothdr-h { font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic; font-size: 56px; }
.hs-yb-foothdr-meta { font-family: 'JetBrains Mono', monospace; font-size: 24px; letter-spacing: .18em; color: #ccc; text-transform: uppercase; }
.hs-yb-cols { display: grid; grid-template-columns: repeat(3, 1fr) 1fr; gap: 40px; }
.hs-yb-col { border-left: 2px solid #f7f3ea; padding-left: 24px; }
.hs-yb-col:first-child { border-left: 0; padding-left: 0; }
.hs-yb-col-d { font-family: 'JetBrains Mono', monospace; font-size: 22px; letter-spacing: .18em; color: #b23b20; text-transform: uppercase; }
.hs-yb-col-n { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 44px; line-height: 1.05; margin-top: 6px; color: #f7f3ea; }
.hs-yb-count { text-align: right; }
.hs-yb-count-val { font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900; font-size: 140px; line-height: .9; color: #b23b20; }
.hs-yb-count-lbl { font-family: 'JetBrains Mono', monospace; font-size: 22px; letter-spacing: .18em; color: #ccc; text-transform: uppercase; }
.hs-yb-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 56px; background: #b23b20; color: #fff; display: flex; align-items: center; overflow: hidden; border-top: 2px solid #1a1a17; }
.hs-yb-tk-tag { background: #1a1a17; color: #f7f3ea; padding: 0 28px; height: 100%; display: flex; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 22px; letter-spacing: .2em; flex-shrink: 0; }
.hs-yb-tk-msg { font-family: 'JetBrains Mono', monospace; font-size: 24px; white-space: nowrap; letter-spacing: .16em; padding-left: 30px; animation: hsYbScroll 50s linear infinite; text-transform: uppercase; display: inline-flex; }
@keyframes hsYbScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
