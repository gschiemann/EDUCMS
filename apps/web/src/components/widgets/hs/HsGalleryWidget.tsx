"use client";

/**
 * HsGalleryWidget — Museum wall-label lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-23 — matches scratch/design/hs/gallery.html
 *
 * Concept: museum catalog page. Generous whitespace, hairline rules,
 * Roman-numeral event list, italic pull-quote as "artist statement."
 *
 * Widgets wired:
 *   - school/clock/weather (masthead navigation)
 *   - greeting (plaque with italic accent word)
 *   - events 0..2 (Roman-numeral acquisitions list)
 *   - clockbig / weatherbig / attendance / countdown (wall-label stat row)
 *   - teacher (portrait + artist statement)
 *   - announcement (Curator's Note — dark panel)
 *   - brand.hours / brand.span / brand.closed / brand.coda (footer)
 *   - ticker (Docent's Note — italic crawl)
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

const DEFAULTS: Required<HsGalleryConfig> = {
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

export function HsGalleryWidget({ config }: { config?: HsGalleryConfig }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsGalleryConfig>;
  return (
    <HsStage
      stageStyle={{
        background: '#f5f1e8',
        fontFamily: "'Inter', sans-serif",
        color: '#1a1814',
      }}
    >
      <style>{CSS}</style>

      <div className="hs-gl-mast">
        <div className="hs-gl-logo" data-field="schoolName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.schoolName}</div>
        <div className="hs-gl-nav">
          <span data-field="clockDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockDate}</span>
          <span className="hs-gl-nav-on" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockTime}</span>
          <span data-field="weatherCondition" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherCondition}</span>
        </div>
      </div>

      <div className="hs-gl-plaque">
        <div className="hs-gl-num" data-field="greetingEyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingEyebrow}</div>
        <h1 className="hs-gl-h1">
          <span data-field="greetingHeadline1" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline1}</span> <em data-field="greetingHeadline2" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline2}</em> <span data-field="greetingHeadline3" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline3}</span>
        </h1>
        <p className="hs-gl-sub" data-field="greetingSubtitle" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingSubtitle}</p>
      </div>

      <div className="hs-gl-acq">
        {[
          { n: c.event0Num, name: c.event0Name, meta: c.event0Meta, time: c.event0Time, day: c.event0Day },
          { n: c.event1Num, name: c.event1Name, meta: c.event1Meta, time: c.event1Time, day: c.event1Day },
          { n: c.event2Num, name: c.event2Name, meta: c.event2Meta, time: c.event2Time, day: c.event2Day },
        ].map((e, i) => (
          <div key={i} className="hs-gl-card">
            <div className="hs-gl-n">{e.n}</div>
            <div>
              <div className="hs-gl-title">{e.name}</div>
              <div className="hs-gl-meta">{e.meta}</div>
            </div>
            <div className="hs-gl-time"><span>{e.time}</span><span className="hs-gl-d">{e.day}</span></div>
          </div>
        ))}
      </div>

      <div className="hs-gl-wall">
        <div>
          <div className="hs-gl-label">Local Time</div>
          <div className="hs-gl-val" data-field="clockbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigVal}</div>
          <div className="hs-gl-cap" data-field="clockbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.clockbigCap}</div>
        </div>
        <div>
          <div className="hs-gl-label">Today&apos;s Weather</div>
          <div className="hs-gl-val" data-field="weatherbigVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherbigVal}</div>
          <div className="hs-gl-cap" data-field="weatherbigCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherbigCap}</div>
        </div>
        <div>
          <div className="hs-gl-label">Present &amp; Accounted For</div>
          <div className="hs-gl-val" data-field="attendanceVal" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceVal}</div>
          <div className="hs-gl-cap" data-field="attendanceCap" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
        </div>
        <div>
          <div className="hs-gl-label" data-field="countdownLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
          <div className="hs-gl-val" data-field="countdownValue" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
          <div className="hs-gl-cap" data-field="countdownSub" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
        </div>
      </div>

      <div className="hs-gl-feature">
        <div className="hs-gl-portrait">
          <div className="hs-gl-tag" data-field="teacherTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherTag}</div>
        </div>
        <div className="hs-gl-text">
          <div className="hs-gl-label" data-field="teacherLabel" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherLabel}</div>
          <h2 className="hs-gl-h2" data-field="teacherName" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherName}</h2>
          <div className="hs-gl-teacher-meta" data-field="teacherMeta" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherMeta}</div>
          <div className="hs-gl-statement" data-field="teacherQuote" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherQuote}</div>
          <div className="hs-gl-byline" data-field="teacherByline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.teacherByline}</div>
        </div>
      </div>

      <div className="hs-gl-advisory">
        <div className="hs-gl-advisory-label" data-field="announcementTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementTag}</div>
        <h3 className="hs-gl-adv-h3" data-field="announcementHeadline" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementHeadline}</h3>
        <p className="hs-gl-adv-p" data-field="announcementBody" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementBody}</p>
        <div className="hs-gl-adv-when" data-field="announcementDate" style={{ whiteSpace: 'pre-wrap' as const }}>{c.announcementDate}</div>
      </div>

      <div className="hs-gl-hours">
        <div className="hs-gl-h">
          <strong data-field="brandHours" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandHours}</strong> <span className="hs-gl-sep">·</span> <span data-field="brandSpan" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandSpan}</span> <span className="hs-gl-sep">·</span> <span data-field="brandClosed" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandClosed}</span>
        </div>
        <div className="hs-gl-coda" data-field="brandCoda" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandCoda}</div>
      </div>

      <div className="hs-gl-ticker">
        <div className="hs-gl-tk-tag" data-field="tickerTag" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerTag}</div>
        <div className="hs-gl-tk-msg">
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
          <span data-field="tickerMessage" style={{ whiteSpace: 'pre-wrap' as const }}>{c.tickerMessage}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,700;1,400&family=Inter:wght@400;500;600&display=swap');
.hs-gl-mast { position: absolute; top: 80px; left: 120px; right: 120px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #2a2724; padding-bottom: 30px; }
.hs-gl-logo { font-family: 'EB Garamond', serif; font-weight: 400; font-style: italic; font-size: 80px; letter-spacing: -.01em; color: #1a1814; }
.hs-gl-nav { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 24px; color: #8a8275; letter-spacing: .24em; text-transform: uppercase; display: flex; gap: 60px; }
.hs-gl-nav-on { color: #1a1814; border-bottom: 1px solid #a84630; padding-bottom: 4px; }
.hs-gl-plaque { position: absolute; top: 230px; left: 120px; width: 1820px; }
.hs-gl-num { font-family: 'EB Garamond', serif; font-size: 36px; letter-spacing: .3em; color: #8a8275; text-transform: uppercase; margin-bottom: 30px; }
.hs-gl-h1 { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 280px; line-height: .95; letter-spacing: -.02em; color: #1a1814; margin: 0; }
.hs-gl-h1 em { font-style: italic; color: #a84630; }
.hs-gl-sub { font-family: 'EB Garamond', serif; font-size: 56px; line-height: 1.35; color: #1a1814; margin-top: 40px; max-width: 1600px; font-weight: 400; }
.hs-gl-acq { position: absolute; top: 230px; right: 120px; width: 1680px; display: grid; gap: 40px; }
.hs-gl-card { border-top: 1px solid #2a2724; padding-top: 28px; display: grid; grid-template-columns: 180px 1fr 240px; gap: 40px; align-items: start; }
.hs-gl-n { font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400; font-size: 100px; line-height: .85; color: #a84630; letter-spacing: -.02em; }
.hs-gl-title { font-family: 'EB Garamond', serif; font-weight: 500; font-size: 56px; line-height: 1.1; color: #1a1814; margin: 0 0 10px; }
.hs-gl-meta { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 24px; color: #8a8275; letter-spacing: .14em; text-transform: uppercase; line-height: 1.4; }
.hs-gl-time { font-family: 'EB Garamond', serif; font-style: italic; font-size: 44px; color: #1a1814; text-align: right; line-height: 1; }
.hs-gl-d { display: block; font-family: 'Inter', sans-serif; font-size: 22px; color: #8a8275; letter-spacing: .2em; text-transform: uppercase; margin-top: 6px; font-style: normal; }
.hs-gl-wall { position: absolute; top: 1280px; left: 120px; right: 120px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 60px; border-top: 1px solid #2a2724; padding-top: 36px; }
.hs-gl-label { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px; letter-spacing: .24em; color: #8a8275; text-transform: uppercase; margin-bottom: 14px; }
.hs-gl-val { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 150px; line-height: .9; color: #1a1814; letter-spacing: -.01em; }
.hs-gl-val em { font-style: italic; color: #a84630; }
.hs-gl-cap { font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400; font-size: 32px; color: #1a1814; margin-top: 12px; line-height: 1.3; opacity: .7; }
.hs-gl-feature { position: absolute; bottom: 200px; left: 120px; width: 2100px; height: 620px; display: grid; grid-template-columns: 520px 1fr; gap: 60px; border-top: 1px solid #2a2724; padding-top: 40px; }
.hs-gl-portrait { width: 520px; height: 580px; background: linear-gradient(160deg, #d8cfba, #b5a88d); position: relative; overflow: hidden; }
.hs-gl-portrait::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 35% 35%, rgba(0,0,0,.1), transparent 40%), repeating-linear-gradient(35deg, rgba(0,0,0,.03) 0 10px, transparent 10px 20px); }
.hs-gl-tag { position: absolute; bottom: 24px; left: 24px; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px; color: #1a1814; background: #f5f1e8; padding: 8px 16px; letter-spacing: .2em; text-transform: uppercase; z-index: 1; }
.hs-gl-text .hs-gl-label { margin-bottom: 22px; }
.hs-gl-h2 { font-family: 'EB Garamond', serif; font-weight: 400; font-style: italic; font-size: 160px; line-height: .92; margin: 0 0 14px; color: #1a1814; letter-spacing: -.02em; }
.hs-gl-teacher-meta { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 26px; color: #8a8275; letter-spacing: .22em; text-transform: uppercase; line-height: 1.4; margin-bottom: 28px; }
.hs-gl-statement { font-family: 'EB Garamond', serif; font-size: 44px; font-style: italic; color: #1a1814; line-height: 1.3; max-width: 1400px; border-left: 2px solid #a84630; padding-left: 32px; }
.hs-gl-byline { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px; color: #8a8275; letter-spacing: .2em; text-transform: uppercase; margin-top: 22px; }
.hs-gl-advisory { position: absolute; bottom: 200px; right: 120px; width: 1220px; height: 620px; background: #1a1814; color: #f5f1e8; box-sizing: border-box; padding: 48px 56px; border-top: 1px solid #2a2724; }
.hs-gl-advisory-label { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px; letter-spacing: .24em; color: #a84630; text-transform: uppercase; margin-bottom: 18px; }
.hs-gl-adv-h3 { font-family: 'EB Garamond', serif; font-weight: 500; font-size: 92px; line-height: 1; letter-spacing: -.01em; margin: 0 0 24px; color: #f5f1e8; }
.hs-gl-adv-p { font-family: 'EB Garamond', serif; font-size: 36px; line-height: 1.35; color: #d9d2c3; margin: 0 0 24px; font-weight: 400; }
.hs-gl-adv-when { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 24px; color: #a84630; letter-spacing: .2em; text-transform: uppercase; border-top: 1px solid #444038; padding-top: 20px; }
.hs-gl-hours { position: absolute; bottom: 80px; left: 120px; right: 120px; height: 80px; border-top: 1px solid #2a2724; padding-top: 24px; display: flex; justify-content: space-between; align-items: center; }
.hs-gl-h { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px; color: #8a8275; letter-spacing: .22em; text-transform: uppercase; }
.hs-gl-h strong { color: #1a1814; font-weight: 600; }
.hs-gl-sep { color: #2a2724; }
.hs-gl-coda { font-family: 'EB Garamond', serif; font-style: italic; font-size: 32px; color: #a84630; }
.hs-gl-ticker { position: absolute; bottom: 0; left: 0; right: 0; height: 60px; background: #1a1814; color: #f5f1e8; display: flex; align-items: center; overflow: hidden; }
.hs-gl-tk-tag { background: #a84630; color: #f5f1e8; padding: 0 30px; height: 100%; display: flex; align-items: center; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px; letter-spacing: .3em; flex-shrink: 0; }
.hs-gl-tk-msg { font-family: 'EB Garamond', serif; font-style: italic; font-size: 30px; white-space: nowrap; padding-left: 36px; animation: hsGlScroll 70s linear infinite; display: inline-flex; }
@keyframes hsGlScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
