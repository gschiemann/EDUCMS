"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsGalleryPortraitWidget — Museum-catalog high-school lobby in 2160×3840
 * portrait. Companion to HsGalleryWidget (3840×2160 landscape). Same
 * configuration shape; the layout is re-flowed for vertical viewing
 * with six stacked regions plus a bottom docent ticker.
 *
 * Concept: museum exhibition broadside. Italic EB Garamond, hairline
 * rules, generous whitespace, a Roman-numeral acquisitions list, an
 * artist-statement teacher quote with a maroon left rule, a small
 * dark Curator's Note advisory card, and an italic Docent's Note
 * crawl across the bottom.
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~  100– 880 : plaque header — italic EB Garamond museum nameplate,
 *                  hairline + metadata row (date / time / weather), then
 *                  exhibition number, three-line italic headline, italic
 *                  subtitle paragraph.
 *   ~  920–1700 : featured artwork frame — gilt-bordered "current
 *                  exhibit" canvas with a watermark monogram + a tag pill,
 *                  paired with a dark acquisition card (No. MMXXVI ·
 *                  APR XXVII, teacher of the week label + name + meta).
 *   ~ 1740–2780 : Today's Programme — italic eyebrow + hand-set headline +
 *                  a Roman-numeral list of three events (I/II/III) styled
 *                  as catalog rows with hairline rules, time + day on
 *                  the right.
 *   ~ 2820–3380 : artist statement — italic teacher quote with maroon
 *                  left rule, attribution underneath, plus a four-cell
 *                  wall-label stat row (Local Time / Weather / Attendance
 *                  / Countdown).
 *   ~ 3420–3680 : Curator's Note — small dark bordered advisory card,
 *                  ADVISORY eyebrow + body + when-line.
 *   ~ 3700–3780 : hours strip — Galleries Open · M-F · Closed weekends
 *                  · italic coda in maroon.
 *   ~ 3780–3840 : docent ticker — italic crawl pinned to absolute bottom.
 *
 * Every pixel size is FIXED at the 2160×3840 canvas. HsStage scales
 * the whole stage to whatever the actual viewport is. DO NOT regress
 * to vw / % units inside the stage — the editor and player will both
 * misrender if you do.
 */

import { HsStage } from './HsStage';

export interface HsGalleryConfig {
  schoolName?: string;
  clockDate?: string;
  clockTime?: string;
  weatherCondition?: string;
  greetingEyebrow?: string;
  greetingHeadline1?: string;
  greetingHeadline2?: string;
  greetingHeadline3?: string;
  greetingSubtitle?: string;
  event0Num?: string; event0Name?: string; event0Meta?: string; event0Time?: string; event0Day?: string;
  event1Num?: string; event1Name?: string; event1Meta?: string; event1Time?: string; event1Day?: string;
  event2Num?: string; event2Name?: string; event2Meta?: string; event2Time?: string; event2Day?: string;
  clockbigVal?: string;
  clockbigCap?: string;
  weatherbigVal?: string;
  weatherbigCap?: string;
  attendanceVal?: string;
  attendanceCap?: string;
  countdownLabel?: string;
  countdownValue?: string | number;
  countdownSub?: string;
  teacherTag?: string;
  teacherLabel?: string;
  teacherName?: string;
  teacherMeta?: string;
  teacherQuote?: string;
  teacherByline?: string;
  announcementTag?: string;
  announcementHeadline?: string;
  announcementBody?: string;
  announcementDate?: string;
  brandHours?: string;
  brandSpan?: string;
  brandClosed?: string;
  brandCoda?: string;
  tickerTag?: string;
  tickerMessage?: string;
}

type Cfg = HsGalleryConfig;

const DEFAULTS: Required<Cfg> = {
  schoolName: 'The Westridge High School Review',
  clockDate: 'Tuesday, April 21',
  clockTime: '7:53 a.m.',
  weatherCondition: 'Clear, 46°',
  greetingEyebrow: 'Exhibition No. 142 · Spring 2026',
  greetingHeadline1: 'Today,',
  greetingHeadline2: 'as ever,',
  greetingHeadline3: 'begins here.',
  greetingSubtitle: 'A morning arrangement of bells, books, and bright fluorescent halls — curated daily by the students, faculty, and custodial staff of Westridge High School.',
  event0Num: 'I.', event0Name: 'Student Government — Open Meeting', event0Meta: 'Library · All Grades Welcome · Snacks Provided', event0Time: '3:30', event0Day: 'Today',
  event1Num: 'II.', event1Name: 'Spring Band Concert', event1Meta: 'Auditorium · All Grades · $5 Suggested Donation', event1Time: '7:00', event1Day: 'Wednesday',
  event2Num: 'III.', event2Name: '"Into the Woods" — Opening Night', event2Meta: 'Theater · Directed by Ms. Park · Tix at Door', event2Time: '7:00', event2Day: 'Friday',
  clockbigVal: '7:53',
  clockbigCap: 'First period begins at eight-oh-five',
  weatherbigVal: '46°',
  weatherbigCap: 'Clear skies, high of sixty-two',
  attendanceVal: '1,217',
  attendanceCap: 'Ninety-eight point two percent',
  countdownLabel: 'Days Until Commencement',
  countdownValue: 41,
  countdownSub: 'Seniors: caps ordered by Friday afternoon',
  teacherTag: 'Plate 14 · Kowalski, J.',
  teacherLabel: 'Teacher of the Week · Resident Faculty',
  teacherName: 'Ms. Kowalski',
  teacherMeta: 'AP Physics · Room 214 · Est. 2012',
  teacherQuote: '"The answer is in the free-body diagram. Draw the picture — every time. The math always follows."',
  teacherByline: 'Interviewed by the Editorial Staff · Page 12',
  announcementTag: "Curator's Note · Today",
  announcementHeadline: 'Pep Rally, 7th Period — Gymnasium A.',
  announcementBody: 'Seniors seated first. The marching band will enter from the southern doors. Please return to 8th period promptly at the final bell. Backpacks may not be brought into the gym.',
  announcementDate: '2:15 p.m. — 3:00 p.m. · Today',
  brandHours: 'Galleries Open',
  brandSpan: 'Monday — Friday, 7:30 to 3:30',
  brandClosed: 'Closed Weekends & Holidays',
  brandCoda: '— Admission is free & always has been.',
  tickerTag: "Docent's Note",
  tickerMessage: 'Bus 14 delayed ten minutes · Lunch today: chicken bowl, salad bar, vegan option · AP Psychology study hall moved to the library · Lost: silver earbuds — inquire at the front office · Spring sports photos tomorrow; please wear your jerseys ·  ',
};

export function HsGalleryPortraitWidget({ config }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const events = [
    { n: c.event0Num, name: c.event0Name, meta: c.event0Meta, time: c.event0Time, day: c.event0Day },
    { n: c.event1Num, name: c.event1Name, meta: c.event1Meta, time: c.event1Time, day: c.event1Day },
    { n: c.event2Num, name: c.event2Name, meta: c.event2Meta, time: c.event2Time, day: c.event2Day },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#f5f1e8',
        fontFamily: "'Inter', sans-serif",
        color: '#1a1814',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500;600&display=swap"
      />
      <style>{CSS}</style>

      {/* ============================ REGION 1: PLAQUE HEADER 100-880 ============================ */}
      <div className="hs-glp-mast">
        <div className="hs-glp-logo" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.schoolName}
        </div>
        <div className="hs-glp-mast-rule" />
        <div className="hs-glp-mast-meta">
          <span data-field="clockDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockDate}</span>
          <span className="hs-glp-mast-dot">·</span>
          <span className="hs-glp-mast-on" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</span>
          <span className="hs-glp-mast-dot">·</span>
          <span data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherCondition}</span>
        </div>
      </div>

      <div className="hs-glp-plaque">
        <div className="hs-glp-num" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingEyebrow}
        </div>
        <h1 className="hs-glp-h1">
          <span data-field="greetingHeadline1" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline1}</span>{' '}
          <em data-field="greetingHeadline2" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline2}</em>{' '}
          <span data-field="greetingHeadline3" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline3}</span>
        </h1>
        <p className="hs-glp-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingSubtitle}
        </p>
      </div>

      {/* ============================ REGION 2: FEATURED FRAME + ACQUISITION CARD 920-1700 ============================ */}
      <div className="hs-glp-feature-row">
        <div className="hs-glp-frame">
          <div className="hs-glp-frame-inner">
            <div className="hs-glp-frame-watermark">W</div>
          </div>
          <div className="hs-glp-frame-tag" data-field="teacherTag" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherTag}
          </div>
        </div>
        <div className="hs-glp-acq-card">
          <div className="hs-glp-acq-eyebrow">Acquisition</div>
          <div className="hs-glp-acq-no">No. MMXXVI</div>
          <div className="hs-glp-acq-date">APR · XXVII</div>
          <div className="hs-glp-acq-rule" />
          <div className="hs-glp-acq-tag" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherLabel}
          </div>
          <div className="hs-glp-acq-name" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherName}
          </div>
          <div className="hs-glp-acq-meta" data-field="teacherMeta" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherMeta}
          </div>
        </div>
      </div>

      {/* ============================ REGION 3: TODAY'S PROGRAMME 1740-2780 ============================ */}
      <div className="hs-glp-prog">
        <div className="hs-glp-prog-rule" />
        <div className="hs-glp-prog-eyebrow">Today&apos;s Programme</div>
        <h2 className="hs-glp-prog-h2">
          A few <em>arrangements</em> &amp; <em>acquisitions.</em>
        </h2>

        <div className="hs-glp-acq-list">
          {events.map((e, i) => (
            <div key={i} className="hs-glp-card">
              <div className="hs-glp-n">{e.n}</div>
              <div className="hs-glp-card-body">
                <div className="hs-glp-title">{e.name}</div>
                <div className="hs-glp-meta">{e.meta}</div>
              </div>
              <div className="hs-glp-time">
                <span>{e.time}</span>
                <span className="hs-glp-d">{e.day}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============================ REGION 4: ARTIST STATEMENT + WALL LABELS 2820-3380 ============================ */}
      <div className="hs-glp-statement">
        <div className="hs-glp-statement-eyebrow">Artist&apos;s Statement</div>
        <div className="hs-glp-quote" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherQuote}
        </div>
        <div className="hs-glp-byline" data-field="teacherByline" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherByline}
        </div>

        <div className="hs-glp-wall">
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label">Local Time</div>
            <div className="hs-glp-wall-val" data-field="clockbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigVal}</div>
            <div className="hs-glp-wall-cap" data-field="clockbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigCap}</div>
          </div>
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label">Today&apos;s Weather</div>
            <div className="hs-glp-wall-val" data-field="weatherbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherbigVal}</div>
            <div className="hs-glp-wall-cap" data-field="weatherbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherbigCap}</div>
          </div>
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label">Present &amp; Accounted</div>
            <div className="hs-glp-wall-val" data-field="attendanceVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceVal}</div>
            <div className="hs-glp-wall-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
          </div>
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
            <div className="hs-glp-wall-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-glp-wall-cap" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 5: CURATOR'S NOTE ADVISORY 3420-3680 ============================ */}
      <div className="hs-glp-advisory">
        <div className="hs-glp-advisory-label" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementTag}
        </div>
        <h3 className="hs-glp-adv-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementHeadline}
        </h3>
        <p className="hs-glp-adv-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementBody}
        </p>
        <div className="hs-glp-adv-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementDate}
        </div>
      </div>

      {/* ============================ REGION 6: HOURS STRIP 3700-3780 ============================ */}
      <div className="hs-glp-hours">
        <div className="hs-glp-h-line">
          <strong data-field="brandHours" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandHours}</strong>
          <span className="hs-glp-sep">·</span>
          <span data-field="brandSpan" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandSpan}</span>
          <span className="hs-glp-sep">·</span>
          <span data-field="brandClosed" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandClosed}</span>
        </div>
        <div className="hs-glp-coda" data-field="brandCoda" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.brandCoda}
        </div>
      </div>

      {/* ============================ REGION 6b: DOCENT TICKER pinned to bottom ============================ */}
      <div className="hs-glp-ticker">
        <div className="hs-glp-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-glp-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel is sized for the 2160×3840 portrait stage. */
const CSS = `
/* ----- REGION 1: plaque header 100-880 ----- */
.hs-glp-mast {
  position: absolute; top: 100px; left: 120px; right: 120px;
}
.hs-glp-logo {
  font-family: 'EB Garamond', serif; font-weight: 400; font-style: italic;
  font-size: 124px; line-height: 1.02; letter-spacing: -.01em; color: #1a1814;
}
.hs-glp-mast-rule {
  height: 1px; background: #2a2724; margin: 36px 0 26px;
}
.hs-glp-mast-meta {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  color: #8a8275; letter-spacing: .24em; text-transform: uppercase;
  display: flex; align-items: baseline; gap: 22px;
}
.hs-glp-mast-on {
  color: #1a1814; border-bottom: 1px solid #a84630; padding-bottom: 4px;
}
.hs-glp-mast-dot { color: #2a2724; }

.hs-glp-plaque {
  position: absolute; top: 380px; left: 120px; right: 120px;
}
.hs-glp-num {
  font-family: 'EB Garamond', serif; font-size: 36px; letter-spacing: .3em;
  color: #8a8275; text-transform: uppercase; margin-bottom: 22px;
}
.hs-glp-h1 {
  font-family: 'EB Garamond', serif; font-weight: 400; font-size: 200px;
  line-height: .98; letter-spacing: -.02em; color: #1a1814; margin: 0;
}
.hs-glp-h1 em { font-style: italic; color: #a84630; }
.hs-glp-sub {
  font-family: 'EB Garamond', serif; font-size: 44px; line-height: 1.32;
  color: #1a1814; margin: 28px 0 0; max-width: 1820px; font-weight: 400;
  font-style: italic; opacity: .82;
}

/* ----- REGION 2: featured frame + acquisition card 920-1700 ----- */
.hs-glp-feature-row {
  position: absolute; top: 920px; left: 120px; right: 120px;
  display: grid; grid-template-columns: 1180px 1fr; gap: 60px;
}
.hs-glp-frame {
  position: relative;
  width: 1180px; height: 780px;
  padding: 28px;
  background:
    linear-gradient(135deg, #c8a96a 0%, #b08a40 50%, #c8a96a 100%);
  box-shadow: 0 24px 48px rgba(0,0,0,.35), inset 0 0 0 6px #8c6a2a;
  box-sizing: border-box;
}
.hs-glp-frame-inner {
  width: 100%; height: 100%;
  background:
    radial-gradient(circle at 35% 35%, rgba(255,255,255,.18), transparent 55%),
    repeating-linear-gradient(45deg, rgba(0,0,0,.03) 0 12px, transparent 12px 24px),
    linear-gradient(160deg, #2a2520 0%, #443a30 50%, #1a1610 100%);
  position: relative; overflow: hidden;
  display: grid; place-items: center;
  box-shadow: inset 0 0 60px rgba(0,0,0,.55);
}
.hs-glp-frame-watermark {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 560px; line-height: .8; color: rgba(245,241,232,.07);
  letter-spacing: -.06em;
}
.hs-glp-frame-tag {
  position: absolute; bottom: 56px; left: 56px; right: 56px;
  background: #f5f1e8; color: #1a1814;
  padding: 14px 24px;
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px;
  letter-spacing: .22em; text-transform: uppercase;
  border-left: 4px solid #a84630;
}

.hs-glp-acq-card {
  height: 780px; padding: 44px 40px;
  background: #1a1814; color: #f5f1e8;
  display: flex; flex-direction: column;
  box-sizing: border-box;
}
.hs-glp-acq-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 24px;
  letter-spacing: .3em; color: #c8a96a; text-transform: uppercase;
}
.hs-glp-acq-no {
  font-family: 'EB Garamond', serif; font-weight: 400; font-style: italic;
  font-size: 110px; line-height: .95; color: #f5f1e8;
  margin: 22px 0 8px; letter-spacing: -.01em;
}
.hs-glp-acq-date {
  font-family: 'EB Garamond', serif; font-size: 50px; color: #c8a96a;
  letter-spacing: .12em;
}
.hs-glp-acq-rule {
  height: 1px; background: #444038; margin: 36px 0 28px;
}
.hs-glp-acq-tag {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px;
  letter-spacing: .24em; color: #a84630; text-transform: uppercase;
  margin-bottom: 18px; line-height: 1.4;
}
.hs-glp-acq-name {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 90px; line-height: .98; color: #f5f1e8; margin: 0 0 18px;
  letter-spacing: -.01em;
}
.hs-glp-acq-meta {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px;
  color: #c8a96a; letter-spacing: .2em; text-transform: uppercase;
  line-height: 1.5; margin-top: auto;
}

/* ----- REGION 3: Today's Programme 1740-2780 ----- */
.hs-glp-prog {
  position: absolute; top: 1740px; left: 120px; right: 120px;
}
.hs-glp-prog-rule {
  height: 1px; background: #2a2724; margin-bottom: 28px;
}
.hs-glp-prog-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 26px;
  letter-spacing: .3em; color: #8a8275; text-transform: uppercase;
}
.hs-glp-prog-h2 {
  font-family: 'EB Garamond', serif; font-weight: 400; font-size: 100px;
  line-height: 1; letter-spacing: -.02em; color: #1a1814; margin: 22px 0 50px;
}
.hs-glp-prog-h2 em { font-style: italic; color: #a84630; }

.hs-glp-acq-list {
  display: grid; gap: 32px;
}
.hs-glp-card {
  border-top: 1px solid #2a2724; padding-top: 28px;
  display: grid; grid-template-columns: 180px 1fr 260px;
  gap: 36px; align-items: start;
}
.hs-glp-n {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 120px; line-height: .85; color: #a84630; letter-spacing: -.02em;
}
.hs-glp-card-body { display: flex; flex-direction: column; gap: 10px; }
.hs-glp-title {
  font-family: 'EB Garamond', serif; font-weight: 500; font-size: 56px;
  line-height: 1.05; color: #1a1814; margin: 0;
}
.hs-glp-meta {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 24px;
  color: #8a8275; letter-spacing: .14em; text-transform: uppercase;
  line-height: 1.4;
}
.hs-glp-time {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 50px;
  color: #1a1814; text-align: right; line-height: 1;
}
.hs-glp-d {
  display: block; font-family: 'Inter', sans-serif; font-size: 22px;
  color: #8a8275; letter-spacing: .2em; text-transform: uppercase;
  margin-top: 8px; font-style: normal;
}

/* ----- REGION 4: artist statement + wall labels 2820-3380 ----- */
.hs-glp-statement {
  position: absolute; top: 2820px; left: 120px; right: 120px;
  border-top: 1px solid #2a2724; padding-top: 32px;
}
.hs-glp-statement-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 26px;
  letter-spacing: .3em; color: #8a8275; text-transform: uppercase;
  margin-bottom: 22px;
}
.hs-glp-quote {
  font-family: 'EB Garamond', serif; font-size: 56px; font-style: italic;
  color: #1a1814; line-height: 1.25;
  border-left: 3px solid #a84630; padding-left: 36px;
  max-width: 1820px;
}
.hs-glp-byline {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px;
  color: #8a8275; letter-spacing: .2em; text-transform: uppercase;
  margin-top: 22px; padding-left: 39px;
}
.hs-glp-wall {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px;
  margin-top: 40px;
  border-top: 1px solid #2a2724; padding-top: 26px;
}
.hs-glp-wall-cell {}
.hs-glp-wall-label {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 18px;
  letter-spacing: .22em; color: #8a8275; text-transform: uppercase;
  margin-bottom: 12px; line-height: 1.3;
  min-height: 44px;
}
.hs-glp-wall-val {
  font-family: 'EB Garamond', serif; font-weight: 400; font-size: 96px;
  line-height: .9; color: #1a1814; letter-spacing: -.01em;
}
.hs-glp-wall-cap {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 22px; color: #1a1814; margin-top: 10px; line-height: 1.3;
  opacity: .7;
}

/* ----- REGION 5: Curator's Note advisory 3420-3680 ----- */
.hs-glp-advisory {
  position: absolute; top: 3420px; left: 120px; right: 120px;
  height: 260px;
  background: #1a1814; color: #f5f1e8;
  box-sizing: border-box;
  padding: 36px 44px;
  display: flex; flex-direction: column;
}
.hs-glp-advisory-label {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px;
  letter-spacing: .24em; color: #a84630; text-transform: uppercase;
  margin-bottom: 12px;
}
.hs-glp-adv-h3 {
  font-family: 'EB Garamond', serif; font-weight: 500; font-size: 60px;
  line-height: 1; letter-spacing: -.01em; margin: 0 0 16px; color: #f5f1e8;
}
.hs-glp-adv-p {
  font-family: 'EB Garamond', serif; font-size: 26px; line-height: 1.32;
  color: #d9d2c3; margin: 0; font-weight: 400;
}
.hs-glp-adv-when {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px;
  color: #a84630; letter-spacing: .2em; text-transform: uppercase;
  border-top: 1px solid #444038; padding-top: 14px; margin-top: auto;
}

/* ----- REGION 6: hours strip 3700-3780 ----- */
.hs-glp-hours {
  position: absolute; top: 3700px; left: 120px; right: 120px; height: 80px;
  border-top: 1px solid #2a2724; padding-top: 18px;
  display: flex; justify-content: space-between; align-items: center;
}
.hs-glp-h-line {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px;
  color: #8a8275; letter-spacing: .22em; text-transform: uppercase;
  display: flex; gap: 18px; align-items: baseline;
}
.hs-glp-h-line strong { color: #1a1814; font-weight: 600; }
.hs-glp-sep { color: #2a2724; }
.hs-glp-coda {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 28px;
  color: #a84630;
}

/* ----- ticker pinned to absolute bottom ----- */
.hs-glp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 60px;
  background: #1a1814; color: #f5f1e8;
  display: flex; align-items: center; overflow: hidden;
}
.hs-glp-tk-tag {
  background: #a84630; color: #f5f1e8;
  padding: 0 30px; height: 100%;
  display: flex; align-items: center;
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 18px;
  letter-spacing: .3em; flex-shrink: 0;
}
.hs-glp-tk-msg {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 28px;
  white-space: nowrap; padding-left: 36px;
  animation: hsGlpScroll 70s linear infinite; display: inline-flex;
}
@keyframes hsGlpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
