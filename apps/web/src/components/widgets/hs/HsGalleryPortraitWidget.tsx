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

import { useRef } from 'react';
import { HsStage } from './HsStage';
import { useHsLiveClock, resolveHsClock, resolveHsDate } from './useHsLiveClock';
import { useHsLiveWeather, describeWmo } from './useHsLiveWeather';
import { useAutoFitText } from './useAutoFitText';
import { useTextStyleOverrides } from './useTextStyleOverrides';
import { sceneCss } from '../scene-css';

export interface HsGalleryConfig {
  schoolName?: string;
  clockDate?: string;
  clockTime?: string;
  weatherCondition?: string;
  /** ZIP/postal code for weather lookup. Empty → IP geolocation. */
  weatherLocation?: string;
  /** 'imperial' (°F) or 'metric' (°C). Default: imperial. */
  weatherUnits?: 'imperial' | 'metric';
  /** IANA timezone (e.g. 'America/Los_Angeles'). Empty → browser tz. */
  clockTimezone?: string;
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
  /**
   * Per-field style overrides — keys match `data-field` attrs on the
   * rendered HTML. Operator-edited via the BuilderBottomBar's per-field
   * controls. BuilderZone applies them via scoped `!important` CSS
   * rules (apps/web/src/components/template-builder/BuilderZone.tsx
   * ~line 547). Empty / missing keys fall back to the CSS class
   * defaults baked into this widget.
   *
   * Schema: { fontSize, fontFamily, color, bold, italic, underline,
   *   strikethrough, bgColor }
   */
  __styles?: Record<string, {
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    bgColor?: string;
  }>;
}

type Cfg = HsGalleryConfig;

export const DEFAULTS: Omit<Required<Cfg>, '__styles'> = {
  schoolName: 'The Westridge High School Review',
  clockDate: 'Tuesday, April 21',
  clockTime: '7:53 a.m.',
  weatherCondition: 'Clear, 46°',
  weatherLocation: '',
  weatherUnits: 'imperial',
  clockTimezone: '',
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

export function HsGalleryPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<Cfg>;
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 2026-05-08 — auto-fit: shrinks fontSize on data-fit text elements
  // when their parent container would overflow. Manual `__styles[field].fontSize`
  // override always wins. BuilderZone's CSS injection paints the override
  // with !important so the auto-fit's inline fontSize loses cleanly.
  useAutoFitText(stageRef, c.__styles as any);
  useTextStyleOverrides(stageRef, c.__styles as any);
  // 2026-05-07 — live clock (see useHsLiveClock.ts).
  const now = useHsLiveClock(live !== false);
  const clock = resolveHsClock(c as any, now, (DEFAULTS as any).clockTime || '', (DEFAULTS as any).clockCaption || '');
  // 2026-05-07 — live date in long format ("Tuesday, April 21").
  const liveDate = resolveHsDate(c, now, DEFAULTS.clockDate, (d) =>
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  );
  // 2026-05-07 — live weather as combined 'Clear, 46°' string (matches landscape).
  const w = useHsLiveWeather({
    live,
    location: c.weatherLocation,
    unitsCelsius: c.weatherUnits === 'metric',
    tempOverride: '',
    conditionOverride: c.weatherCondition,
    defaultTemp: '',
    defaultCondition: DEFAULTS.weatherCondition,
    formatTemp: (t) => `${t}°`,
    formatCondition: (wmo, t) => `${describeWmo(wmo)}, ${t}°`,
  });
  const events = [
    { n: c.event0Num, name: c.event0Name, meta: c.event0Meta, time: c.event0Time, day: c.event0Day },
    { n: c.event1Num, name: c.event1Name, meta: c.event1Meta, time: c.event1Time, day: c.event1Day },
    { n: c.event2Num, name: c.event2Name, meta: c.event2Meta, time: c.event2Time, day: c.event2Day },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageRef={stageRef}
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
      <style>{sceneCss(CSS)}</style>

      {/* ============================ REGION 1: PLAQUE HEADER 100-880 ============================ */}
      <div className="hs-glp-mast">
        <div className="hs-glp-logo" data-field="schoolName" data-fit data-fit-min="40" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.schoolName}
        </div>
        <div className="hs-glp-mast-rule" />
        <div className="hs-glp-mast-meta">
          <span data-field="clockDate" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{liveDate}</span>
          <span className="hs-glp-mast-dot">·</span>
          <span className="hs-glp-mast-on" data-field="clockTime" style={{ whiteSpace: 'pre-wrap' as const }}>{clock.time}</span>
          <span className="hs-glp-mast-dot">·</span>
          <span data-field="weatherCondition" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>{w.conditionLabel}</span>
        </div>
      </div>

      <div className="hs-glp-plaque">
        <div className="hs-glp-num" data-field="greetingEyebrow" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingEyebrow}
        </div>
        <h1 className="hs-glp-h1">
          <span data-field="greetingHeadline1" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline1}</span>{' '}
          <em data-field="greetingHeadline2" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline2}</em>{' '}
          <span data-field="greetingHeadline3" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>{c.greetingHeadline3}</span>
        </h1>
        <p className="hs-glp-sub" data-field="greetingSubtitle" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingSubtitle}
        </p>
      </div>

      {/* ============================ REGION 2: FEATURED FRAME + ACQUISITION CARD 920-1700 ============================ */}
      <div className="hs-glp-feature-row">
        <div className="hs-glp-frame">
          <div className="hs-glp-frame-inner">
            <div className="hs-glp-frame-watermark">W</div>
          </div>
          <div className="hs-glp-frame-tag" data-field="teacherTag" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherTag}
          </div>
        </div>
        <div className="hs-glp-acq-card">
          <div className="hs-glp-acq-eyebrow">Acquisition</div>
          <div className="hs-glp-acq-no">No. MMXXVI</div>
          <div className="hs-glp-acq-date">APR · XXVII</div>
          <div className="hs-glp-acq-rule" />
          <div className="hs-glp-acq-tag" data-field="teacherLabel" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherLabel}
          </div>
          <div className="hs-glp-acq-name" data-field="teacherName" data-fit data-fit-min="40" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherName}
          </div>
          <div className="hs-glp-acq-meta" data-field="teacherMeta" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>
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
              {/* 2026-05-07 — added data-field for click-to-edit. */}
              <div className="hs-glp-n" data-field={`event${i}Num`} style={{ whiteSpace: 'pre-wrap' as const }}>{e.n}</div>
              <div className="hs-glp-card-body">
                <div className="hs-glp-title" data-field={`event${i}Name`} data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>{e.name}</div>
                <div className="hs-glp-meta" data-field={`event${i}Meta`} data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{e.meta}</div>
              </div>
              <div className="hs-glp-time">
                <span data-field={`event${i}Time`} style={{ whiteSpace: 'pre-wrap' as const }}>{e.time}</span>
                <span className="hs-glp-d" data-field={`event${i}Day`} data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{e.day}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============================ REGION 4: ARTIST STATEMENT + WALL LABELS 2820-3380 ============================ */}
      <div className="hs-glp-statement">
        <div className="hs-glp-statement-eyebrow">Artist&apos;s Statement</div>
        <div className="hs-glp-quote" data-field="teacherQuote" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherQuote}
        </div>
        <div className="hs-glp-byline" data-field="teacherByline" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.teacherByline}
        </div>

        <div className="hs-glp-wall">
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label">Local Time</div>
            <div className="hs-glp-wall-val" data-field="clockbigVal" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{(!c.clockbigVal || c.clockbigVal === DEFAULTS.clockbigVal) ? clock.time : c.clockbigVal}</div>
            <div className="hs-glp-wall-cap" data-field="clockbigCap" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{(!c.clockbigCap || c.clockbigCap === DEFAULTS.clockbigCap) ? clock.caption : c.clockbigCap}</div>
          </div>
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label">Today&apos;s Weather</div>
            <div className="hs-glp-wall-val" data-field="weatherbigVal" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherbigVal}</div>
            <div className="hs-glp-wall-cap" data-field="weatherbigCap" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.weatherbigCap}</div>
          </div>
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label">Present &amp; Accounted</div>
            <div className="hs-glp-wall-val" data-field="attendanceVal" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceVal}</div>
            <div className="hs-glp-wall-cap" data-field="attendanceCap" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.attendanceCap}</div>
          </div>
          <div className="hs-glp-wall-cell">
            <div className="hs-glp-wall-label" data-field="countdownLabel" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownLabel}</div>
            <div className="hs-glp-wall-val" data-field="countdownValue" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownValue}</div>
            <div className="hs-glp-wall-cap" data-field="countdownSub" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>{c.countdownSub}</div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 5: CURATOR'S NOTE ADVISORY 3420-3680 ============================ */}
      <div className="hs-glp-advisory">
        <div className="hs-glp-advisory-label" data-field="announcementTag" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementTag}
        </div>
        <h3 className="hs-glp-adv-h3" data-field="announcementHeadline" data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementHeadline}
        </h3>
        <p className="hs-glp-adv-p" data-field="announcementBody" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementBody}
        </p>
        <div className="hs-glp-adv-when" data-field="announcementDate" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.announcementDate}
        </div>
      </div>

      {/* ============================ REGION 6: HOURS STRIP 3700-3780 ============================ */}
      <div className="hs-glp-hours">
        <div className="hs-glp-h-line">
          <strong data-field="brandHours" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandHours}</strong>
          <span className="hs-glp-sep">·</span>
          <span data-field="brandSpan" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandSpan}</span>
          <span className="hs-glp-sep">·</span>
          <span data-field="brandClosed" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>{c.brandClosed}</span>
        </div>
        <div className="hs-glp-coda" data-field="brandCoda" data-fit data-fit-min="20" style={{ whiteSpace: 'pre-wrap' as const }}>
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
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  color: #8a8275; letter-spacing: .22em; text-transform: uppercase;
  display: flex; align-items: baseline; gap: 28px; flex-wrap: wrap;
}
.hs-glp-mast-on {
  color: #1a1814; border-bottom: 1px solid #a84630; padding-bottom: 4px;
}
.hs-glp-mast-dot { color: #2a2724; }

.hs-glp-plaque {
  position: absolute; top: 380px; left: 120px; right: 120px;
}
.hs-glp-num {
  font-family: 'EB Garamond', serif; font-size: 56px; letter-spacing: .3em;
  color: #8a8275; text-transform: uppercase; margin-bottom: 26px;
}
.hs-glp-h1 {
  font-family: 'EB Garamond', serif; font-weight: 400; font-size: 200px;
  line-height: .98; letter-spacing: -.02em; color: #1a1814; margin: 0;
}
.hs-glp-h1 em { font-style: italic; color: #a84630; }
.hs-glp-sub {
  font-family: 'EB Garamond', serif; font-size: 78px; line-height: 1.22;
  color: #1a1814; margin: 28px 0 0; max-width: 1900px; font-weight: 400;
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
  padding: 18px 28px;
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  letter-spacing: .2em; text-transform: uppercase;
  border-left: 4px solid #a84630;
}

.hs-glp-acq-card {
  height: 780px; padding: 44px 40px;
  background: #1a1814; color: #f5f1e8;
  display: flex; flex-direction: column;
  box-sizing: border-box;
}
.hs-glp-acq-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  letter-spacing: .3em; color: #c8a96a; text-transform: uppercase;
}
.hs-glp-acq-no {
  font-family: 'EB Garamond', serif; font-weight: 400; font-style: italic;
  font-size: 130px; line-height: .95; color: #f5f1e8;
  margin: 22px 0 10px; letter-spacing: -.01em;
}
.hs-glp-acq-date {
  font-family: 'EB Garamond', serif; font-size: 64px; color: #c8a96a;
  letter-spacing: .12em;
}
.hs-glp-acq-rule {
  height: 1px; background: #444038; margin: 36px 0 28px;
}
.hs-glp-acq-tag {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  letter-spacing: .22em; color: #a84630; text-transform: uppercase;
  margin-bottom: 22px; line-height: 1.3;
}
.hs-glp-acq-name {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 110px; line-height: .98; color: #f5f1e8; margin: 0 0 22px;
  letter-spacing: -.01em;
}
.hs-glp-acq-meta {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 58px;
  color: #c8a96a; letter-spacing: .18em; text-transform: uppercase;
  line-height: 1.3; margin-top: auto;
}

/* ----- REGION 3: Today's Programme 1740-2780 ----- */
.hs-glp-prog {
  position: absolute; top: 1740px; left: 120px; right: 120px;
}
.hs-glp-prog-rule {
  height: 1px; background: #2a2724; margin-bottom: 28px;
}
.hs-glp-prog-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 58px;
  letter-spacing: .3em; color: #8a8275; text-transform: uppercase;
}
.hs-glp-prog-h2 {
  font-family: 'EB Garamond', serif; font-weight: 400; font-size: 120px;
  line-height: 1; letter-spacing: -.02em; color: #1a1814; margin: 22px 0 44px;
}
.hs-glp-prog-h2 em { font-style: italic; color: #a84630; }

.hs-glp-acq-list {
  display: grid; gap: 36px;
}
.hs-glp-card {
  border-top: 1px solid #2a2724; padding-top: 32px;
  display: grid; grid-template-columns: 200px 1fr 320px;
  gap: 40px; align-items: start;
}
.hs-glp-n {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 140px; line-height: .85; color: #a84630; letter-spacing: -.02em;
}
.hs-glp-card-body { display: flex; flex-direction: column; gap: 14px; }
.hs-glp-title {
  font-family: 'EB Garamond', serif; font-weight: 500; font-size: 72px;
  line-height: 1.05; color: #1a1814; margin: 0;
}
.hs-glp-meta {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 58px;
  color: #8a8275; letter-spacing: .12em; text-transform: uppercase;
  line-height: 1.25;
}
.hs-glp-time {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 76px;
  color: #1a1814; text-align: right; line-height: 1;
}
.hs-glp-d {
  display: block; font-family: 'Inter', sans-serif; font-size: 52px;
  color: #8a8275; letter-spacing: .2em; text-transform: uppercase;
  margin-top: 10px; font-style: normal;
}

/* ----- REGION 4: artist statement + wall labels 2820-3380 ----- */
.hs-glp-statement {
  position: absolute; top: 2820px; left: 120px; right: 120px;
  border-top: 1px solid #2a2724; padding-top: 32px;
}
.hs-glp-statement-eyebrow {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 58px;
  letter-spacing: .3em; color: #8a8275; text-transform: uppercase;
  margin-bottom: 26px;
}
.hs-glp-quote {
  font-family: 'EB Garamond', serif; font-size: 82px; font-style: italic;
  color: #1a1814; line-height: 1.18;
  border-left: 3px solid #a84630; padding-left: 40px;
  max-width: 1900px;
}
.hs-glp-byline {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 58px;
  color: #8a8275; letter-spacing: .18em; text-transform: uppercase;
  margin-top: 26px; padding-left: 43px;
}
.hs-glp-wall {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px;
  margin-top: 28px;
  border-top: 1px solid #2a2724; padding-top: 22px;
}
.hs-glp-wall-cell {}
.hs-glp-wall-label {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  letter-spacing: .2em; color: #8a8275; text-transform: uppercase;
  margin-bottom: 14px; line-height: 1.2;
  min-height: 60px;
}
.hs-glp-wall-val {
  font-family: 'EB Garamond', serif; font-weight: 400; font-size: 108px;
  line-height: .9; color: #1a1814; letter-spacing: -.01em;
}
.hs-glp-wall-cap {
  font-family: 'EB Garamond', serif; font-style: italic; font-weight: 400;
  font-size: 58px; color: #1a1814; margin-top: 12px; line-height: 1.25;
  opacity: .75;
}

/* ----- REGION 5: Curator's Note advisory 3380-3700 ----- */
.hs-glp-advisory {
  position: absolute; top: 3320px; left: 120px; right: 120px;
  height: 360px;
  background: #1a1814; color: #f5f1e8;
  box-sizing: border-box;
  padding: 28px 44px;
  display: flex; flex-direction: column;
}
.hs-glp-advisory-label {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  letter-spacing: .22em; color: #a84630; text-transform: uppercase;
  margin-bottom: 14px;
}
.hs-glp-adv-h3 {
  font-family: 'EB Garamond', serif; font-weight: 500; font-size: 80px;
  line-height: 1; letter-spacing: -.01em; margin: 0 0 18px; color: #f5f1e8;
}
.hs-glp-adv-p {
  font-family: 'EB Garamond', serif; font-size: 56px; line-height: 1.22;
  color: #d9d2c3; margin: 0; font-weight: 400; flex: 1;
}
.hs-glp-adv-when {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  color: #a84630; letter-spacing: .18em; text-transform: uppercase;
  border-top: 1px solid #444038; padding-top: 16px; margin-top: auto;
}

/* ----- REGION 6: hours strip (above ticker) ----- */
.hs-glp-hours {
  position: absolute; bottom: 100px; left: 120px; right: 120px; height: 60px;
  border-top: 1px solid #2a2724; padding-top: 12px;
  display: flex; justify-content: space-between; align-items: center;
  overflow: hidden;
}
.hs-glp-h-line {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 48px;
  color: #8a8275; letter-spacing: .2em; text-transform: uppercase;
  display: flex; gap: 22px; align-items: baseline;
}
.hs-glp-h-line strong { color: #1a1814; font-weight: 600; }
.hs-glp-sep { color: #2a2724; }
.hs-glp-coda {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 58px;
  color: #a84630;
}

/* ----- ticker pinned to absolute bottom ----- */
.hs-glp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 100px;
  background: #1a1814; color: #f5f1e8;
  display: flex; align-items: center; overflow: hidden;
}
.hs-glp-tk-tag {
  background: #a84630; color: #f5f1e8;
  padding: 0 36px; height: 100%;
  display: flex; align-items: center;
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 52px;
  letter-spacing: .26em; flex-shrink: 0;
}
.hs-glp-tk-msg {
  font-family: 'EB Garamond', serif; font-style: italic; font-size: 62px;
  white-space: nowrap; padding-left: 40px;
  animation: hsGlpScroll 70s linear infinite; display: inline-flex;
}
@keyframes hsGlpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
