"use client";

// APPROVED 2026-04-27 — REAL 4K portrait, 2160x3840 native canvas via HsStage. DO NOT regress to vw/% units.
/**
 * HsYearbookPortraitWidget — Editorial magazine-spread lobby in 2160×3840
 * portrait. Companion to HsYearbookWidget (3840×2160 landscape). Same
 * configuration shape; the layout is re-flowed for vertical viewing as
 * a single-column magazine page (cream paper, deep ink, illuminated
 * drop caps, hairline rules).
 *
 * Layout regions (top→bottom inside the 2160×3840 stage):
 *   ~   0–700px : full-width serif masthead — giant Playfair title,
 *                 vol / issue / date line, hairline divider rule
 *   ~ 700–1400px: featured photo article — vintage-halftone photo
 *                 frame, photo tag chip, italic caption + byline
 *   ~1400–2500px: lede article with illuminated drop cap — huge red
 *                 italic drop cap, two-column italic body
 *   ~2500–3100px: pull-quote portrait card — portrait tile on left,
 *                 big italic pull-quote on right + attribution
 *   ~3100–3600px: "This week" calendar folio — 4–5 italic event rows
 *                 each with a date badge
 *   ~3600–3840px: wire ticker (gold rule above, italic crawl)
 *
 * Every pixel size is FIXED at the 2160×3840 canvas. HsStage scales
 * the whole stage to whatever the actual viewport is. DO NOT regress
 * to vw / % units inside the stage — the editor and player will both
 * misrender if you do.
 */

import { useRef } from 'react';
import { HsStage } from './HsStage';
import { useHsLiveClock, resolveHsClock } from './useHsLiveClock';
import { useHsLiveWeather, describeWmo } from './useHsLiveWeather';
import { useAutoFitText } from './useAutoFitText';
import { useTextStyleOverrides } from './useTextStyleOverrides';

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
  /** ZIP/postal code for weather lookup. Empty → IP geolocation. */
  weatherLocation?: string;
  /** 'imperial' (°F) or 'metric' (°C). Default: imperial. */
  weatherUnits?: 'imperial' | 'metric';
  /** IANA timezone (e.g. 'America/Los_Angeles'). Empty → browser tz. */
  clockTimezone?: string;
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

type Cfg = HsYearbookConfig;

export const DEFAULTS: Omit<Required<Cfg>, '__styles'> = {
  schoolName: 'Westridge Weekly',
  schoolIssue: 'VOL. LXIX · NO. 142 · TUESDAY, APRIL 21, 2026',
  schoolSection: 'CALENDAR · SECTION B',
  clockTime: '7:53 a.m.',
  clockCaption: 'Tuesday · April 21 · 46° clear',
  greetingEyebrow: 'MORNING EDITION · FEATURE',
  greetingHeadline: 'Today, we begin again.',
  greetingSubtitle: "A quiet hallway, a fresh notebook, a first-period bell you've heard a thousand times. The best mornings are the ones that feel exactly like this one — the building waking up, the lights coming on row by row, the smell of coffee from the front office, and the soft echo of the first lockers opening down the east wing.",
  announcementTag: "EDITOR'S NOTE",
  announcementHeadline: 'The yearbook deadline just moved up.',
  announcementBody: 'Senior portraits, club pages, and candid submissions due Friday, April 28 at 3:30 PM. Drop off in Room 217 or upload through the portal.',
  announcementDate: 'DEADLINE · FRI APR 28 · 3:30 PM',
  weatherTemp: '46°',
  weatherCondition: 'Clear skies · HI 62° · LO 38°',
  weatherLocation: '',
  weatherUnits: 'imperial',
  clockTimezone: '',
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
  event1Name: 'Student government — open meeting, library.',
  event2When: 'WED · 7:00 PM',
  event2Name: 'Spring band concert, auditorium.',
  event3When: 'FRI · 7:00 PM',
  event3Name: '"Into the Woods" opening night.',
  tickerTag: 'WIRE · LATE',
  tickerMessage: 'NEWS DESK ANNOUNCEMENT — BUS 14 RUNNING LATE, NEW DEPARTURE 7:58 AM · LUNCH TODAY: CHICKEN BOWL, SALAD BAR, VEGAN OPT · AP PSYCH STUDY HALL MOVED TO LIBRARY · LOST: SILVER EARBUDS — FRONT OFFICE · ',
};

export function HsYearbookPortraitWidget({ config, live }: { config?: Cfg; live?: boolean }) {
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
  // 2026-05-07 — live weather (matches landscape).
  const w = useHsLiveWeather({
    live,
    location: c.weatherLocation,
    unitsCelsius: c.weatherUnits === 'metric',
    tempOverride: c.weatherTemp,
    conditionOverride: c.weatherCondition,
    defaultTemp: DEFAULTS.weatherTemp,
    defaultCondition: DEFAULTS.weatherCondition,
    formatTemp: (t) => `${t}°`,
    formatCondition: (wmo) => `${describeWmo(wmo)} skies`,
  });

  // Lede split into two columns. We hand-split on a sentence boundary so
  // the right column starts cleanly — kept here so the layout is stable
  // regardless of the configured copy.
  const ledeText = c.greetingSubtitle || '';
  const split = Math.max(0, Math.floor(ledeText.length * 0.55));
  const breakAt = ledeText.indexOf(' ', split);
  const ledeLeft = breakAt > 0 ? ledeText.slice(0, breakAt) : ledeText;
  const ledeRight = breakAt > 0 ? ledeText.slice(breakAt + 1) : '';

  const events = [
    { when: c.event1When, name: c.event1Name },
    { when: c.event2When, name: c.event2Name },
    { when: c.event3When, name: c.event3Name },
  ];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageRef={stageRef}
      stageStyle={{
        background: '#f7f3ea',
        fontFamily: "'Inter', sans-serif",
        color: '#1a1614',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&family=Lora:ital,wght@0,400;0,500;1,400;1,500&family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <style>{CSS}</style>

      {/* Paper grain overlay (full stage) */}
      <div className="hs-ybp-grain" />

      {/* ============================ REGION 1: MASTHEAD ~0-700 ============================ */}
      <div className="hs-ybp-mast">
        <div className="hs-ybp-mast-top">
          <span className="hs-ybp-mast-side">EST. 1957</span>
          <span className="hs-ybp-mast-side hs-ybp-mast-side-r" data-field="schoolSection" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolSection}
          </span>
        </div>
        <div className="hs-ybp-title" data-field="schoolName" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.schoolName}
        </div>
        <div className="hs-ybp-mast-rule" />
        <div className="hs-ybp-mast-bottom">
          <span data-field="schoolIssue" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.schoolIssue}
          </span>
          <span className="hs-ybp-mast-time" data-field="clockTime" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
            {clock.time}
          </span>
        </div>
      </div>

      {/* ============================ REGION 2: FEATURED PHOTO ~700-1400 ============================ */}
      <div className="hs-ybp-feat">
        <div className="hs-ybp-feat-photo">
          <div className="hs-ybp-feat-photo-tag" data-field="featurePhotoTag" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.featurePhotoTag}
          </div>
        </div>
        <div className="hs-ybp-feat-cap">
          <div className="hs-ybp-feat-num" data-field="featureNum" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.featureNum}
          </div>
          <div className="hs-ybp-feat-cap-body">
            <div className="hs-ybp-feat-title" data-field="featureTitle" data-fit data-fit-min="36" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.featureTitle}
            </div>
            <div className="hs-ybp-feat-body" data-field="featureBody" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.featureBody}
            </div>
            <div className="hs-ybp-feat-byline">{c.announcementTag} · {c.announcementDate}</div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 3: LEDE WITH DROP CAP ~1400-2500 ============================ */}
      <div className="hs-ybp-lede">
        <div className="hs-ybp-eyebrow" data-field="greetingEyebrow" data-fit data-fit-min="24" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingEyebrow}
        </div>
        <h1 className="hs-ybp-h1" data-field="greetingHeadline" data-fit data-fit-min="80" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.greetingHeadline}
        </h1>
        <div className="hs-ybp-lede-rule" />
        <div className="hs-ybp-lede-cols">
          <div className="hs-ybp-lede-col">
            <span className="hs-ybp-dropcap">{(ledeText.trim()[0] || 'A')}</span>
            <span data-field="greetingSubtitle" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
              {ledeLeft.trim().slice(1)}
            </span>
          </div>
          <div className="hs-ybp-lede-col">
            <span data-field="greetingSubtitle" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
              {ledeRight}
            </span>
          </div>
        </div>
        <div className="hs-ybp-lede-folio">
          <span data-field="folioPage" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.folioPage}
          </span>
          <span className="hs-ybp-lede-folio-sep">·</span>
          <span data-field="weatherTemp" style={{ whiteSpace: 'pre-wrap' as const }}>
            {w.tempLabel}
          </span>
          <span className="hs-ybp-lede-folio-sep">·</span>
          <span data-field="weatherCondition" data-fit data-fit-min="16" style={{ whiteSpace: 'pre-wrap' as const }}>
            {w.conditionLabel}
          </span>
        </div>
      </div>

      {/* ============================ REGION 4: PULL-QUOTE PORTRAIT ~2500-3100 ============================ */}
      <div className="hs-ybp-pull">
        <div className="hs-ybp-pull-portrait">
          <div className="hs-ybp-pull-frame" data-field="teacherPhotoTag" data-fit data-fit-min="18" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherPhotoTag}
          </div>
        </div>
        <div className="hs-ybp-pull-body">
          <div className="hs-ybp-pull-tag" data-field="teacherLabel" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherLabel}
          </div>
          <div className="hs-ybp-pull-name" data-field="teacherName" data-fit data-fit-min="60" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherName}
          </div>
          <div className="hs-ybp-pull-meta" data-field="teacherGrade" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherGrade}
          </div>
          <blockquote className="hs-ybp-pull-quote" data-field="teacherQuote" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherQuote}
          </blockquote>
          <div className="hs-ybp-pull-byline" data-field="teacherByline" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
            {c.teacherByline}
          </div>
        </div>
      </div>

      {/* ============================ REGION 5: CALENDAR FOLIO ~3100-3600 ============================ */}
      <div className="hs-ybp-cal">
        <div className="hs-ybp-cal-hdr">
          <div className="hs-ybp-cal-h">This week, in italic.</div>
          <div className="hs-ybp-cal-meta">
            <span data-field="countdownValue" data-fit data-fit-min="40" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownValue}
            </span>
            <span className="hs-ybp-cal-meta-lbl" data-field="countdownLabel" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownLabel}
            </span>
          </div>
        </div>
        <div className="hs-ybp-cal-rule" />
        <div className="hs-ybp-cal-list">
          {events.map((ev, i) => (
            <div key={i} className="hs-ybp-cal-row">
              <div className="hs-ybp-cal-badge">
                <span data-field={`event${i + 1}When`} data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
                  {ev.when}
                </span>
              </div>
              <div className="hs-ybp-cal-name" data-field={`event${i + 1}Name`} data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
                {ev.name}
              </div>
              <div className="hs-ybp-cal-folio">{String(i + 1).padStart(2, '0')}</div>
            </div>
          ))}
          <div className="hs-ybp-cal-row hs-ybp-cal-row-cd">
            <div className="hs-ybp-cal-badge hs-ybp-cal-badge-cd">
              <span data-field="countdownLabel" data-fit data-fit-min="22" style={{ whiteSpace: 'pre-wrap' as const }}>
                {c.countdownLabel}
              </span>
            </div>
            <div className="hs-ybp-cal-name" data-field="countdownUnit" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
              {c.countdownUnit}
            </div>
            <div className="hs-ybp-cal-folio">04</div>
          </div>
        </div>
      </div>

      {/* ============================ REGION 6: WIRE TICKER ~3600-3840 ============================ */}
      <div className="hs-ybp-wire-rule" />
      <div className="hs-ybp-ticker">
        <div className="hs-ybp-tk-tag" data-field="tickerTag" data-fit data-fit-min="28" style={{ whiteSpace: 'pre-wrap' as const }}>
          {c.tickerTag}
        </div>
        <div className="hs-ybp-tk-msg">
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
.hs-ybp-grain {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; pointer-events: none;
  background:
    radial-gradient(circle at 30% 20%, rgba(0,0,0,.025), transparent 40%),
    radial-gradient(circle at 80% 70%, rgba(0,0,0,.035), transparent 50%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.005) 0 2px, transparent 2px 4px);
}

/* ================== REGION 1: MASTHEAD ================== */
.hs-ybp-mast {
  position: absolute; top: 80px; left: 80px; right: 80px; height: 580px;
  z-index: 3;
}
.hs-ybp-mast-top {
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: 'JetBrains Mono', monospace; font-size: 48px;
  letter-spacing: .2em; color: #6b5d4d; text-transform: uppercase;
  border-bottom: 1px solid #c9beac; padding-bottom: 16px;
}
.hs-ybp-mast-side-r { color: #b23b20; }
.hs-ybp-title {
  font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic;
  font-size: 360px; line-height: .85;
  letter-spacing: -.025em; color: #1a1614;
  text-align: center; margin-top: 28px;
}
.hs-ybp-mast-rule {
  height: 6px; background: #1a1614; margin: 30px 0 14px;
  position: relative;
}
.hs-ybp-mast-rule::before {
  content: ''; position: absolute; left: 0; right: 0; top: -10px;
  height: 1px; background: #1a1614;
}
.hs-ybp-mast-bottom {
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: 'JetBrains Mono', monospace; font-size: 48px;
  letter-spacing: .18em; color: #6b5d4d; text-transform: uppercase;
}
.hs-ybp-mast-time {
  font-family: 'Playfair Display', serif; font-weight: 700; font-style: italic;
  font-size: 64px; color: #1a1614; letter-spacing: -.005em;
  text-transform: none;
}

/* ================== REGION 2: FEATURED PHOTO ================== */
.hs-ybp-feat {
  position: absolute; top: 720px; left: 80px; right: 80px;
  height: 660px; z-index: 3;
  display: flex; flex-direction: column; gap: 22px;
  overflow: hidden;
}
.hs-ybp-feat-photo {
  width: 100%; height: 320px; flex-shrink: 0;
  background: linear-gradient(135deg, #d6cfbe 0%, #b0a897 60%, #8a8170 100%);
  border: 3px solid #1a1614;
  position: relative; overflow: hidden;
  box-shadow: 0 16px 32px rgba(0,0,0,.18);
}
.hs-ybp-feat-photo::before {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background:
    repeating-radial-gradient(circle at 22% 38%, rgba(26,22,20,.12) 0 2px, transparent 2px 6px),
    repeating-radial-gradient(circle at 70% 64%, rgba(26,22,20,.10) 0 2px, transparent 2px 7px);
  mix-blend-mode: multiply;
}
.hs-ybp-feat-photo::after {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: repeating-linear-gradient(45deg, rgba(0,0,0,.06) 0 4px, transparent 4px 9px);
}
.hs-ybp-feat-photo-tag {
  position: absolute; bottom: 22px; left: 22px;
  background: #f7f3ea; border: 2px solid #1a1614;
  padding: 12px 26px;
  font-family: 'JetBrains Mono', monospace; font-size: 52px;
  letter-spacing: .12em; text-transform: uppercase; color: #1a1614;
  z-index: 2;
}
.hs-ybp-feat-cap {
  display: flex; gap: 32px; align-items: flex-start;
  border-top: 3px solid #1a1614; padding-top: 22px;
}
.hs-ybp-feat-num {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 144px; line-height: .8; color: #b23b20; flex-shrink: 0;
}
.hs-ybp-feat-cap-body { display: flex; flex-direction: column; gap: 14px; }
.hs-ybp-feat-title {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 78px; line-height: 1.02; letter-spacing: -.01em; color: #1a1614;
}
.hs-ybp-feat-body {
  font-family: 'Lora', serif; font-weight: 400;
  font-size: 64px; line-height: 1.2; color: #3b342c;
}
.hs-ybp-feat-byline {
  font-family: 'JetBrains Mono', monospace; font-size: 52px;
  letter-spacing: .18em; color: #b23b20; text-transform: uppercase;
  margin-top: 6px;
}

/* ================== REGION 3: LEDE WITH DROP CAP ================== */
.hs-ybp-lede {
  position: absolute; top: 1420px; left: 80px; right: 80px;
  height: 1060px; z-index: 3;
}
.hs-ybp-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-size: 58px;
  color: #b23b20; letter-spacing: .2em; text-transform: uppercase;
}
.hs-ybp-h1 {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 200px; line-height: .92; margin: 18px 0 0;
  letter-spacing: -.02em; color: #1a1614;
}
.hs-ybp-lede-rule {
  height: 1px; background: #1a1614; margin: 32px 0 28px;
  position: relative;
}
.hs-ybp-lede-rule::after {
  content: ''; position: absolute; left: 0; right: 0; top: 6px;
  height: 1px; background: #1a1614;
}
.hs-ybp-lede-cols {
  display: grid; grid-template-columns: 1fr 1fr; gap: 54px;
  font-family: 'Lora', serif; font-style: italic; font-weight: 400;
  font-size: 72px; line-height: 1.25; color: #2a241f;
}
.hs-ybp-lede-col { position: relative; }
.hs-ybp-dropcap {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 220px; line-height: .82; color: #b23b20;
  float: left; margin: 8px 16px 0 0; letter-spacing: -.02em;
  text-shadow: 4px 4px 0 rgba(178,59,32,.12);
}
.hs-ybp-lede-folio {
  position: absolute; bottom: 0; left: 0; right: 0;
  display: flex; justify-content: center; gap: 22px; align-items: baseline;
  font-family: 'JetBrains Mono', monospace; font-size: 32px;
  letter-spacing: .22em; color: #6b5d4d; text-transform: uppercase;
  border-top: 1px solid #c9beac; padding-top: 18px;
}
.hs-ybp-lede-folio-sep { color: #b23b20; }

/* ================== REGION 4: PULL-QUOTE PORTRAIT ================== */
.hs-ybp-pull {
  position: absolute; top: 2520px; left: 80px; right: 80px;
  height: 560px; z-index: 3;
  background: #fff; border: 3px solid #1a1614;
  display: grid; grid-template-columns: 460px 1fr;
  padding: 28px; gap: 36px;
  box-shadow: 0 16px 32px rgba(0,0,0,.15);
}
.hs-ybp-pull-portrait {
  width: 460px; height: 504px;
  background: linear-gradient(160deg, #d6cfbe 0%, #a09680 70%, #6e6856 100%);
  border: 3px solid #1a1614;
  position: relative; overflow: hidden;
}
.hs-ybp-pull-portrait::before {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background:
    radial-gradient(circle at 50% 40%, rgba(247,243,234,.55) 0 80px, transparent 110px),
    radial-gradient(ellipse at 50% 78%, rgba(26,22,20,.35) 0 120px, transparent 200px);
  mix-blend-mode: overlay;
}
.hs-ybp-pull-portrait::after {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: repeating-linear-gradient(-45deg, rgba(0,0,0,.06) 0 4px, transparent 4px 9px);
}
.hs-ybp-pull-frame {
  position: absolute; bottom: 18px; left: 18px;
  background: #f7f3ea; border: 2px solid #1a1614;
  padding: 10px 18px;
  font-family: 'JetBrains Mono', monospace; font-size: 48px;
  letter-spacing: .1em; text-transform: uppercase; color: #1a1614;
  z-index: 2;
}
.hs-ybp-pull-body {
  display: flex; flex-direction: column; justify-content: flex-start;
  padding-top: 6px;
}
.hs-ybp-pull-tag {
  font-family: 'JetBrains Mono', monospace; font-size: 52px;
  letter-spacing: .2em; color: #b23b20; text-transform: uppercase;
}
.hs-ybp-pull-name {
  font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic;
  font-size: 140px; line-height: .9; margin-top: 12px;
  color: #1a1614; letter-spacing: -.01em;
}
.hs-ybp-pull-meta {
  font-family: 'JetBrains Mono', monospace; font-size: 58px;
  letter-spacing: .12em; color: #6b5d4d; text-transform: uppercase;
  margin-top: 14px;
}
.hs-ybp-pull-quote {
  margin: 24px 0 0;
  font-family: 'Playfair Display', serif; font-weight: 700; font-style: italic;
  font-size: 78px; line-height: 1.18; color: #2a241f;
  border-left: 6px solid #b23b20; padding-left: 30px;
}
.hs-ybp-pull-byline {
  font-family: 'JetBrains Mono', monospace; font-size: 52px;
  letter-spacing: .12em; color: #999088; text-transform: uppercase;
  margin-top: auto; padding-top: 18px;
}

/* ================== REGION 5: CALENDAR FOLIO ================== */
.hs-ybp-cal {
  position: absolute; top: 3140px; left: 80px; right: 80px;
  height: 460px; z-index: 3;
}
.hs-ybp-cal-hdr {
  display: flex; justify-content: space-between; align-items: baseline;
}
.hs-ybp-cal-h {
  font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic;
  font-size: 80px; line-height: 1; color: #1a1614; letter-spacing: -.01em;
}
.hs-ybp-cal-meta {
  font-family: 'JetBrains Mono', monospace; font-size: 52px;
  letter-spacing: .18em; color: #6b5d4d; text-transform: uppercase;
  display: flex; align-items: baseline; gap: 18px;
}
.hs-ybp-cal-meta > :first-child {
  font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic;
  font-size: 92px; line-height: .9; color: #b23b20;
  letter-spacing: -.02em; text-transform: none;
}
.hs-ybp-cal-meta-lbl { max-width: 240px; text-align: right; line-height: 1.2; }
.hs-ybp-cal-rule {
  height: 3px; background: #1a1614; margin: 16px 0 18px; position: relative;
}
.hs-ybp-cal-rule::after {
  content: ''; position: absolute; left: 0; right: 0; top: 7px;
  height: 1px; background: #1a1614;
}
.hs-ybp-cal-list { display: flex; flex-direction: column; gap: 10px; }
.hs-ybp-cal-row {
  display: grid; grid-template-columns: 280px 1fr 80px;
  align-items: center; gap: 28px;
  padding: 14px 0;
  border-bottom: 1px solid #c9beac;
}
.hs-ybp-cal-badge {
  background: #1a1614; color: #f7f3ea;
  padding: 16px 22px;
  font-family: 'JetBrains Mono', monospace; font-size: 48px;
  letter-spacing: .16em; text-transform: uppercase;
  text-align: center;
}
.hs-ybp-cal-badge-cd {
  background: #b23b20;
  font-size: 48px; line-height: 1.1;
}
.hs-ybp-cal-name {
  font-family: 'Playfair Display', serif; font-weight: 700; font-style: italic;
  font-size: 72px; line-height: 1.05; color: #1a1614;
}
.hs-ybp-cal-folio {
  font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic;
  font-size: 68px; color: #b23b20; text-align: right; line-height: 1;
}
.hs-ybp-cal-row-cd .hs-ybp-cal-name { color: #2a241f; font-style: italic; }

/* ================== REGION 6: WIRE TICKER ================== */
.hs-ybp-wire-rule {
  position: absolute; left: 0; right: 0; bottom: 100px;
  height: 4px; background: #b23b20; z-index: 4;
}
.hs-ybp-wire-rule::before {
  content: ''; position: absolute; left: 0; right: 0; top: -8px;
  height: 1px; background: #b23b20;
}
.hs-ybp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 100px;
  background: #1a1614; color: #f7f3ea;
  display: flex; align-items: center; overflow: hidden; z-index: 5;
  border-top: 2px solid #b23b20;
}
.hs-ybp-tk-tag {
  background: #b23b20; color: #f7f3ea;
  padding: 0 40px; height: 100%;
  display: flex; align-items: center; flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace; font-size: 52px;
  letter-spacing: .2em; text-transform: uppercase;
}
.hs-ybp-tk-msg {
  font-family: 'Playfair Display', serif; font-weight: 700; font-style: italic;
  font-size: 62px; padding-left: 44px; white-space: nowrap;
  letter-spacing: .04em; text-transform: uppercase;
  animation: hsYbpScroll 60s linear infinite;
  display: inline-flex;
}
@keyframes hsYbpScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
