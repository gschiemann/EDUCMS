'use client';

/**
 * StadiumMeetBoardWidget — the flagship "Stadium Lane" swim-meet
 * broadcast board (S6, #288). Greg picked all 3 stadium designs on
 * 2026-07-03 as sports-scoreboard template options
 * (docs/design/proposals/2026-07-02-stadium-lane/README.md); this file
 * ships v1 "Broadcast" — a byte-faithful port of
 * `stadium-lane-v1-broadcast.html` (reference screenshot in the same
 * folder), wired to LIVE game data instead of the mockup's hardcoded
 * sample swimmers.
 *
 * ── Why a NEW widget instead of reskinning SwimLaneGridWidget ─────────
 * SwimLaneGridWidget (SwimDiveWidgets.tsx — DO NOT EDIT, another agent
 * owns that file right now) is a dense operator-configurable grid: every
 * color is a PropertiesPanel field, rows are compact, and it deliberately
 * has no "broadcast moment" chrome (angled header, gold leader glow, pool
 * record footer, sponsor slot). The Stadium Lane design is a DIFFERENT
 * visual language — big Anton display type, angled blue header banner,
 * per-team-color lane washes, a footer strip for record chase + sponsor —
 * and per CLAUDE.md's Template Design Workflow, "if a pixel value is in
 * the mockup, keep it," not blend it into an existing component's knobs.
 *
 * ── Structure for v2/v3 (build later, not now) ─────────────────────────
 * `StadiumMeetBoardWidget` is the router: it owns live-data plumbing
 * (GameStateContext read, no-fake-data guard, config normalization) and
 * dispatches to a per-`boardStyle` presentation component. Only
 * `StadiumBroadcastScene` (boardStyle: 'broadcast', v1) is implemented.
 * When v2 "Dual-Meet Duel" and v3 "Record Chase" get built, they become
 * sibling `Stadium<X>Scene` components in this same file (or split out
 * if this file gets unwieldy), selected by the same `cfg.boardStyle` switch —
 * the live-data mapping below (readResults → sorted/DQ'd rows, team
 * colors, no-fake-data guard) is shared by all three, so it lives in the
 * router, not duplicated per style.
 *
 * ── Live data mapping (readResults → the mockup's rows) ────────────────
 * Reads `Game.stats.results` via the SAME `readResults` parser every
 * other meet-sport board uses (apps/web/src/components/widgets/v2/
 * _shared/sports-situational.tsx) — the console's MeetResultsSection
 * editor and this board can never disagree about the data shape.
 *   - lane row  ← ResultEntry { lane, name, team, mark, place }
 *   - sort      ← by `place` ascending (unplaced/0 sink to bottom), same
 *     as SwimLaneGridWidget's 'place' orderMode — the mockup's row order
 *     IS a results/leaderboard order (1st place D. OKAFOR shown first
 *     with the gold leader glow), not lane-number order.
 *   - DQ        ← mark is DQ/SCR/NS → mockup's struck-through name +
 *     red "DQ — <reason>" time cell. The reason after "DQ — " is
 *     free-typed by the operator (`dqReasons` config, keyed by lane) —
 *     there is no reason field on ResultEntry; blank renders "DQ" alone.
 *   - team chip ← snapshot.homeColor/awayColor (the REAL bound game's
 *     colors) when entry.team is 'home'/'away'; a neutral slate
 *     (#475569, matching SwimLaneGridWidget's teamColorFor default) when
 *     team is null. NEVER a fabricated per-swimmer color — the mockup's
 *     5 different lane colors were purely decorative variety, which
 *     would be fabricated signal on a real board.
 *   - header    ← stats.currentEvent (sports-situational.tsx's own
 *     reader) first, else the picked ResultEvent's `event` string, else
 *     operator override (`headerText`), else a neutral default.
 *   - heat/time pills ← operator-typed (`heatLabel`/`timeLabel`) — there
 *     is no heat-number or wall-clock field on ResultEntry/ResultEvent;
 *     display-as-typed, same "no schema change" rule as SwimRelayExchange
 *     legs. Blank hides the corresponding pill cleanly.
 *   - pool record + sponsor footer ← NO field exists anywhere in the data
 *     model for these. Operator-configured (`recordLabel`/`recordValue`/
 *     `recordHolder`/`recordDelta`, `sponsorLabel`/`sponsorName`) — when
 *     ALL of a group's fields are blank, that half of the footer (or the
 *     whole footer bar) is OMITTED, never the mockup's fabricated
 *     "50.84 A. WASHINGTON" / "RIVER DENTAL" sample values.
 *
 * ── No-fake-data guard (Sports Wave S2 pattern) ─────────────────────────
 * `useGameState()` is null on the builder canvas (renders the SAMPLE
 * heat, watermarked) — but on a real player surface
 * (`useRenderSurface() === 'player'`) with no game bound yet, it returns
 * the non-null PHANTOM_UNBOUND state, and this widget renders a
 * dignified "NO GAME BOUND" empty shell instead of any swimmer data,
 * exactly like SwimLaneGridWidget's BindGameCallout.
 *
 * ── Fonts ────────────────────────────────────────────────────────────
 * Anton (display headlines) + Inter (body/labels) + JetBrains Mono
 * (tabular race times) via a Google Fonts `<link>` injected into
 * `<head>` at module load — the SAME idempotent pattern
 * SportElementWidgets.tsx uses (`injectScoreboardFonts`), which is safe
 * on Chromium-83 (a `<link rel=stylesheet>` parses fine; no `@import`
 * CSSOM, no modern-only API) and never touches a React-owned DOM node
 * (CLAUDE.md cross-browser rule #6 — this only APPENDS, never removes).
 *
 * ── Chromium-83 / NovaStar Taurus safety (CLAUDE.md rule #10) ──────────
 * No `inset`/`inset-*` shorthand (physical top/right/bottom/left only),
 * no flex `gap` (margins instead), no `backdrop-filter`. Fixed
 * 1920×1080 natural scene + `useScaleToFit` transform:scale — the same
 * player-shipped board pattern as MainScoreboardWidget.tsx /
 * SwimDiveWidgets.tsx (re-declared locally per that file's own
 * convention: each sport-widget file owns its copy, no shared export).
 */

import { useEffect, useRef, useState } from 'react';
import { useGameState } from './GameStateContext';
import { readResults, type ResultEvent, type ResultEntry } from '../v2/_shared/sports-situational';
import type { BaseCfg, WidgetProps } from '../v2/_shared/types';

const DISPLAY_FONT = "'Anton', Impact, 'Bebas Neue', system-ui, sans-serif";
const BODY_FONT = "'Inter', system-ui, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'SF Mono', 'Roboto Mono', monospace";

// ── Google Fonts injection (Anton + Inter + JetBrains Mono) ───────────
// Idempotent module-level <link> append — mirrors SportElementWidgets.tsx's
// injectScoreboardFonts exactly (see that file's comment for the Chromium-83
// rationale). A separate link id from the scoreboard-tier fonts so both sets
// can coexist without either widget depending on the other's import order.
const STADIUM_FONTS_LINK_ID = 'stadium-lane-fonts';
const STADIUM_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@600;700;800&family=JetBrains+Mono:wght@700;800&display=swap';
function injectStadiumFonts() {
  if (typeof document === 'undefined') return; // SSR
  if (document.getElementById(STADIUM_FONTS_LINK_ID)) return; // already loaded
  const link = document.createElement('link');
  link.id = STADIUM_FONTS_LINK_ID;
  link.rel = 'stylesheet';
  link.href = STADIUM_FONTS_HREF;
  document.head.appendChild(link);
}
injectStadiumFonts();

// ── scale-to-fit (fixed 1920×1080 scene → any zone) — same primitive as
//    MainScoreboardWidget.tsx / SwimDiveWidgets.tsx. Re-declared locally
//    per that file's own convention (no shared export across sport-widget
//    files). ──────────────────────────────────────────────────────────
function useScaleToFit(naturalW: number, naturalH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / naturalW, h / naturalH));
    };
    compute();
    const r1 = requestAnimationFrame(compute);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, [naturalW, naturalH]);
  return { ref, scale };
}

function ScaledScene({ bgColor, children }: { bgColor: string; children: React.ReactNode }) {
  const { ref, scale } = useScaleToFit(1920, 1080);
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bgColor, overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 1920, height: 1080, flex: 'none',
          transform: `scale(${scale})`, transformOrigin: 'center center',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Same "NO GAME BOUND" callout copy/look as SwimLaneGridWidget's
 *  BindGameCallout (SwimDiveWidgets.tsx) — kept as a local copy since
 *  that file is fenced off from this build (another agent owns it right
 *  now), but the UX must read identically across every swim/dive/meet
 *  board so an operator never sees two different "not bound yet" styles. */
function BindGameCallout({ accent = '#fbbf24' }: { accent?: string }) {
  return (
    <div
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 6, pointerEvents: 'none',
      }}
    >
      <div style={{
        background: 'rgba(5,7,13,0.88)', border: `2px solid ${accent}`, borderRadius: 20,
        padding: '22px 44px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
      }}>
        <span style={{ fontFamily: BODY_FONT, fontWeight: 800, fontSize: 30, letterSpacing: 2, color: accent }}>
          NO GAME BOUND
        </span>
        <span style={{ fontFamily: BODY_FONT, fontWeight: 600, fontSize: 20, color: '#cbd5e1', marginTop: 8 }}>
          Bind a game in the score keeper to go live
        </span>
      </div>
    </div>
  );
}

function SampleWatermark() {
  return (
    <div style={{ position: 'absolute', bottom: 24, right: 32, background: 'rgba(0,0,0,0.55)', color: '#facc15', fontFamily: BODY_FONT, fontWeight: 800, fontSize: 18, letterSpacing: 4, padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(250,204,21,0.4)', zIndex: 6 }}>
      SAMPLE
    </div>
  );
}

// ── SAMPLE data — the mockup's exact 6-lane heat, so the builder tile /
//    gallery thumbnail is never blank. Byte-identical to
//    stadium-lane-v1-broadcast.html's hardcoded rows (CLAUDE.md: "if a
//    pixel value is in the mockup, keep it" extends to the sample copy
//    used to prove the design matches — this ONLY ever renders when
//    `state == null`, i.e. off a real screen). ──────────────────────────
const SAMPLE_EVENT: ResultEvent = {
  event: 'GIRLS 100M FREESTYLE — EVENT 12 — FINALS',
  entries: [
    { place: 1, name: 'D. OKAFOR', team: 'home', lane: 3, mark: '51.90' },
    { place: 2, name: 'M. CHEN', team: 'away', lane: 2, mark: '52.18' },
    { place: 3, name: 'T. NGUYEN', team: null, lane: 5, mark: '53.61' },
    { place: 4, name: 'S. PATEL', team: null, lane: 6, mark: '54.05' },
    { place: 5, name: 'J. RIVERA', team: null, lane: 1, mark: '55.42' },
    { place: 0, name: 'K. ANDERSON', team: null, lane: 7, mark: 'DQ' },
  ],
};
const SAMPLE_HEAT_LABEL = '3/4';
const SAMPLE_TIME_LABEL = '7:42 PM';
const SAMPLE_RECORD = {
  recordLabel: 'POOL RECORD',
  recordValue: '50.84',
  recordHolder: 'A. WASHINGTON 2024',
  recordDelta: '1.06 OFF THE PACE',
};
const SAMPLE_SPONSOR = { sponsorLabel: 'PRESENTED BY', sponsorName: 'RIVER DENTAL' };
const SAMPLE_DQ_REASON = 'FALSE START';

function pickEvent(events: ResultEvent[], eventFilter?: string): ResultEvent | null {
  if (events.length === 0) return null;
  if (eventFilter && eventFilter.trim()) {
    const match = events.find((e) => e.event.toLowerCase() === eventFilter.trim().toLowerCase());
    if (match) return match;
  }
  return events.reduce((best, e) => {
    const bo = best.order ?? -Infinity;
    const eo = e.order ?? -Infinity;
    return eo >= bo ? e : best;
  }, events[events.length - 1]);
}

function isDqMark(mark: string): boolean {
  const m = mark.trim().toUpperCase();
  return m === 'DQ' || m === 'SCR' || m === 'NS';
}

export interface StadiumMeetBoardCfg extends BaseCfg {
  /** v1 'broadcast' (only style implemented today) — v2 'duel' / v3
   *  'chase' are reserved for the sibling designs Greg also approved
   *  2026-07-03; selecting them today falls back to 'broadcast'. Named
   *  `boardStyle`, NOT `style` — `style` is BaseCfg's reserved
   *  WidgetStyle field (font/color/bg/padding/border/shadow/anim), and
   *  colliding with it would shadow every v2 widget's shared style
   *  system with an incompatible string type. */
  boardStyle?: 'broadcast' | 'duel' | 'chase';
  gameId?: string;
  headerText?: string;
  eventFilter?: string;
  /** Operator-typed — no heat-number field exists on ResultEvent/Entry. */
  heatLabel?: string;
  /** Operator-typed wall-clock pill — no schedule-time field on the meet
   *  data model. Blank hides the pill. */
  timeLabel?: string;
  /** Number of lane rows to render (matches the mockup's 6; operator's
   *  pool may run 6/8/10 lanes). */
  laneCount?: number;
  /** DQ reason text keyed by lane number — "7": "FALSE START". Blank/
   *  missing renders just "DQ" with no reason suffix. */
  dqReasons?: Record<string, string>;
  // ── Pool-record footer — NO field exists in the data model for this.
  //    All four blank omits the record half of the footer cleanly. ──────
  recordLabel?: string;
  recordValue?: string;
  recordHolder?: string;
  recordDelta?: string;
  // ── Sponsor slot — NO field exists in the data model for this. Both
  //    blank omits the sponsor half of the footer cleanly. ──────────────
  sponsorLabel?: string;
  sponsorName?: string;
  bgColor?: string;
}

/** Team-color chip: the REAL bound game's home/away color when the entry
 *  is attributed to a side; a neutral slate for unattributed lanes.
 *  NEVER a fabricated per-swimmer color (the mockup's decorative 5-color
 *  variety would be fabricated signal on a real board). */
function laneChipColor(entry: ResultEntry, homeColor: string | null, awayColor: string | null): string {
  if (entry.team === 'home') return homeColor || '#1d4ed8';
  if (entry.team === 'away') return awayColor || '#b91c1c';
  return '#334155';
}

// ════════════════════════════════════════════════════════════════════
// StadiumBroadcastScene — v1 "Broadcast". Faithful port of
// stadium-lane-v1-broadcast.html (see file header for the full mapping).
// Every pixel value below is taken directly from the mockup's CSS.
// ════════════════════════════════════════════════════════════════════
function StadiumBroadcastScene({
  headerText,
  heatLabel,
  timeLabel,
  rows,
  laneCount,
  dqReasons,
  homeColor,
  awayColor,
  record,
  sponsor,
  bgColor,
}: {
  headerText: { eventLabel: string; eventTitle: string };
  heatLabel: string;
  timeLabel: string;
  rows: ResultEntry[];
  laneCount: number;
  dqReasons: Record<string, string>;
  homeColor: string | null;
  awayColor: string | null;
  record: { recordLabel: string; recordValue: string; recordHolder: string; recordDelta: string } | null;
  sponsor: { sponsorLabel: string; sponsorName: string } | null;
  bgColor: string;
}) {
  const hasFooter = !!record || !!sponsor;
  // Mockup: .rows { top:180px; bottom:96px; left:40px; right:40px } — the
  // 96px bottom reserve only applies when the footer bar is present; with
  // no footer, rows extend to the scene bottom so the board never shows a
  // dead empty strip for a footer with nothing configured.
  const rowsBottom = hasFooter ? 96 : 24;

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, fontFamily: BODY_FONT, color: '#fff', background: `radial-gradient(1200px 600px at 50% -10%, rgba(37,99,235,.25), transparent 60%), linear-gradient(180deg,${bgColor} 0%,#060a14 55%)` }}>
      {/* faint diagonal texture overlay */}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.4, background: 'repeating-linear-gradient(105deg, rgba(255,255,255,.02) 0 2px, transparent 2px 16px)' }} />

      {/* ── Header — angled blue banner, event identity is HUGE ── */}
      <div
        style={{
          position: 'absolute', top: 0, right: 0, left: 0, height: 170,
          display: 'flex', alignItems: 'center',
          background: 'linear-gradient(90deg,#1d4ed8 0%,#2563eb 55%,#0ea5e9 100%)',
          padding: '0 56px',
          clipPath: 'polygon(0 0,100% 0,100% 78%,0 100%)',
        }}
      >
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'repeating-linear-gradient(115deg, rgba(255,255,255,.06) 0 40px, transparent 40px 80px)' }} />
        <div style={{ position: 'relative' }}>
          <span style={{ display: 'block', fontSize: 22, fontWeight: 800, letterSpacing: 6, color: '#bfdbfe', fontFamily: BODY_FONT }}>
            {headerText.eventLabel}
          </span>
          <h1 style={{ fontFamily: DISPLAY_FONT, fontSize: 74, letterSpacing: 1, lineHeight: 1, textShadow: '0 4px 0 rgba(0,0,0,.25)', margin: 0, fontWeight: 400 }}>
            {headerText.eventTitle}
          </h1>
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', textAlign: 'right', display: 'flex', alignItems: 'center' }}>
          {heatLabel && (
            <div style={{ background: 'rgba(3,10,25,.55)', border: '2px solid rgba(255,255,255,.35)', borderRadius: 16, padding: '14px 26px', marginLeft: 20, textAlign: 'center' }}>
              <b style={{ display: 'block', fontFamily: DISPLAY_FONT, fontSize: 44, fontWeight: 400 }}>{heatLabel}</b>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 3, color: '#bfdbfe' }}>HEAT</span>
            </div>
          )}
          {timeLabel && (() => {
            const [t, ampm] = timeLabel.trim().split(/\s+(?=[AaPp][Mm]$)/);
            return (
              <div style={{ background: 'rgba(3,10,25,.55)', border: '2px solid rgba(255,255,255,.35)', borderRadius: 16, padding: '14px 26px', marginLeft: 20, textAlign: 'center' }}>
                <b style={{ display: 'block', fontFamily: DISPLAY_FONT, fontSize: 44, fontWeight: 400 }}>{t}</b>
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 3, color: '#bfdbfe' }}>{ampm || ''}</span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Lane rows fill the canvas; type scales WITH the row ── */}
      <div style={{ position: 'absolute', top: 180, bottom: rowsBottom, left: 40, right: 40, display: 'flex', flexDirection: 'column' }}>
        {rows.slice(0, laneCount).map((r, i) => {
          const empty = !r.name && !r.mark;
          const dq = isDqMark(r.mark);
          const tc = laneChipColor(r, homeColor, awayColor);
          const isLeader = r.place === 1 && !dq;
          const reason = r.lane != null ? dqReasons[String(r.lane)] : undefined;
          return (
            <div
              key={`${r.lane ?? i}-${i}`}
              style={{
                position: 'relative', flex: 1, display: 'flex', alignItems: 'center',
                margin: '5px 0', borderRadius: 16,
                background: 'linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.02))',
                border: isLeader ? '1px solid rgba(251,191,36,.55)' : '1px solid rgba(255,255,255,.07)',
                boxShadow: isLeader ? '0 0 34px rgba(251,191,36,.16), inset 0 0 26px rgba(251,191,36,.05)' : undefined,
                overflow: 'hidden', opacity: empty ? 0.35 : 1,
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '38%', background: `linear-gradient(90deg, ${tc} 0%, transparent 100%)`, opacity: 0.5 }} />
              <div
                style={{
                  position: 'relative', width: 120, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: tc, fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 58, textShadow: '0 3px 0 rgba(0,0,0,.35)',
                  clipPath: 'polygon(0 0,100% 0,82% 100%,0 100%)',
                }}
              >
                {r.lane ?? '—'}
              </div>
              <div style={{ position: 'relative', flex: 1, paddingLeft: 34, display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
                <b style={{
                  fontSize: 52, fontWeight: 800, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  color: dq ? '#94a3b8' : '#ffffff', textDecoration: dq ? 'line-through' : 'none',
                  // Mockup's sample data was pre-typed in caps (no CSS
                  // text-transform) — a live console name typed in mixed
                  // case ("D. Okafor") must still read like the approved
                  // design, so force uppercase here rather than relying
                  // on operator input discipline.
                  textTransform: 'uppercase',
                }}>
                  {empty ? '—' : (r.name || '—')}
                </b>
                {r.team && (
                  <span style={{ fontSize: 26, fontWeight: 700, color: '#93a4c3', marginLeft: 22, letterSpacing: 2, whiteSpace: 'nowrap' }}>
                    {r.team === 'home' ? 'HOME' : 'AWAY'}
                  </span>
                )}
              </div>
              <div style={{
                position: 'relative', fontFamily: dq ? BODY_FONT : MONO_FONT, fontWeight: 800,
                letterSpacing: dq ? undefined : -1, marginRight: 30, fontVariantNumeric: 'tabular-nums',
                fontSize: dq ? 52 : 64, color: dq ? '#f87171' : '#ffffff',
              }}>
                {empty ? '—' : dq ? `DQ${reason ? ` — ${reason}` : ''}` : (r.mark || '—')}
              </div>
              <div style={{
                position: 'relative', width: 96, height: 96, borderRadius: '50%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', marginRight: 26,
                border: `4px solid ${dq ? '#2c3a57' : r.place === 1 ? '#fbbf24' : r.place === 2 ? '#cbd5e1' : r.place === 3 ? '#d97706' : '#2c3a57'}`,
                color: '#93a4c3',
                background: dq ? undefined
                  : r.place === 1 ? 'radial-gradient(circle at 35% 30%, rgba(251,191,36,.35), rgba(251,191,36,.08))'
                  : r.place === 2 ? 'rgba(203,213,225,.10)'
                  : r.place === 3 ? 'rgba(217,119,6,.12)'
                  : undefined,
              }}>
                <b style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 44, lineHeight: 1, color: r.place === 1 && !dq ? '#fde68a' : '#e8edf7' }}>
                  {empty || dq || !r.place ? '—' : r.place}
                </b>
                {!empty && !dq && r.place > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: r.place === 1 ? '#fbbf24' : undefined }}>PLACE</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer: record chase + sponsor. Config-or-omit — never the
          mockup's fabricated sample values on a real board. ── */}
      {hasFooter && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 88, display: 'flex', alignItems: 'center', background: '#04070f', borderTop: '1px solid #1b2540', padding: '0 56px' }}>
          {record && (
            // Mockup's sample footer text was pre-typed in caps (no CSS
            // text-transform on .rec) — force uppercase here too so an
            // operator-typed mixed-case record label/holder still reads
            // like the approved design.
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontWeight: 800, letterSpacing: 1, color: '#93a4c3', textTransform: 'uppercase' }}>
              <span style={{ color: '#fbbf24', marginRight: 16, fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 26, letterSpacing: 2 }}>
                ⚑ {record.recordLabel}
              </span>
              {record.recordValue && <span>{record.recordValue}</span>}
              {record.recordHolder && <b style={{ color: '#fff', margin: '0 10px', fontFamily: MONO_FONT }}>{record.recordHolder}</b>}
              {record.recordDelta && <span>{record.recordDelta}</span>}
            </div>
          )}
          {sponsor && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', fontSize: 20, fontWeight: 800, letterSpacing: 3, color: '#64748b', textTransform: 'uppercase' }}>
              {sponsor.sponsorLabel}
              {sponsor.sponsorName && (
                <div style={{ width: 150, height: 44, borderRadius: 8, marginLeft: 18, background: 'linear-gradient(90deg,#1f2a44,#2b3a5f)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY_FONT, fontWeight: 400, letterSpacing: 2, color: '#9fb2d8' }}>
                  {sponsor.sponsorName}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// StadiumMeetBoardWidget — router. Live-data plumbing + no-fake-data
// guard live here; style-specific presentation is a sibling scene
// (only StadiumBroadcastScene / 'broadcast' exists today).
// ════════════════════════════════════════════════════════════════════
export function StadiumMeetBoardWidget({ config }: WidgetProps<StadiumMeetBoardCfg>) {
  const c = config ?? {};
  // useGameState() itself reads useRenderSurface() internally — see
  // GameStateContext.tsx — so a real player surface with no game bound
  // returns the non-null PHANTOM_UNBOUND state (isLive=true, event=null)
  // rather than null (builder-only, isLive=false). No separate
  // useRenderSurface() call needed here.
  const state = useGameState();
  const isLive = state != null;
  const snapshot = state?.snapshot ?? null;
  const stats = (snapshot?.stats ?? {}) as Record<string, unknown>;
  const liveEvents = isLive ? readResults(stats) : [];
  const event = isLive ? pickEvent(liveEvents, c.eventFilter) : SAMPLE_EVENT;

  // No-fake-data guard: a real player surface with a phantom (unbound)
  // state and no results recorded yet renders the empty/bind shell, never
  // the sample heat — same rule as SwimLaneGridWidget's noLiveData.
  const noLiveData = isLive && !event;

  const laneCount = Math.max(1, Math.min(12, c.laneCount ?? (isLive ? 8 : SAMPLE_EVENT.entries.length)));
  const bgColor = c.bgColor || '#060a14';

  const rows: ResultEntry[] = noLiveData
    ? []
    : (event?.entries ?? []).slice().sort((a, b) => {
        const ap = a.place || 9999;
        const bp = b.place || 9999;
        if (ap !== bp) return ap - bp;
        return (a.lane || 0) - (b.lane || 0);
      });

  // Event header: stats.currentEvent (the console's own scalar field,
  // same reader sports-situational.tsx uses) wins when present; else the
  // picked ResultEvent's name; else the operator's headerText override;
  // else a neutral "not yet configured" label. Splits into a small-caps
  // eyebrow + a big title exactly like the mockup's <small>/<h1> pair —
  // heuristic: text before an em/en-dash or " - " becomes the eyebrow,
  // the rest (or the whole string if no separator) becomes the title.
  const rawHeader =
    (isLive ? String(stats.currentEvent || '').trim() : '') ||
    c.headerText ||
    event?.event ||
    (isLive ? '' : SAMPLE_EVENT.event);
  const splitHeader = (raw: string): { eventLabel: string; eventTitle: string } => {
    if (!raw) return { eventLabel: '', eventTitle: 'NO EVENT SET' };
    const parts = raw.split(/\s+[—–-]\s+/);
    if (parts.length >= 2) {
      return { eventLabel: parts[0].toUpperCase(), eventTitle: parts.slice(1).join(' — ').toUpperCase() };
    }
    return { eventLabel: '', eventTitle: raw.toUpperCase() };
  };
  const headerText = splitHeader(rawHeader);

  const heatLabel = isLive ? (c.heatLabel || '') : (c.heatLabel ?? SAMPLE_HEAT_LABEL);
  const timeLabel = isLive ? (c.timeLabel || '') : (c.timeLabel ?? SAMPLE_TIME_LABEL);
  const dqReasons = c.dqReasons || (isLive ? {} : { '7': SAMPLE_DQ_REASON });

  // Pool-record footer — config-or-omit. Any of the 4 fields present
  // renders the record half; all blank (and not the builder sample)
  // omits it. In the builder with no override, show the sample so the
  // gallery tile demonstrates the footer moment.
  const recordFieldsSet = !!(c.recordLabel || c.recordValue || c.recordHolder || c.recordDelta);
  const record = recordFieldsSet
    ? {
        recordLabel: c.recordLabel || 'RECORD',
        recordValue: c.recordValue || '',
        recordHolder: c.recordHolder || '',
        recordDelta: c.recordDelta || '',
      }
    : (!isLive ? SAMPLE_RECORD : null);

  const sponsorFieldsSet = !!(c.sponsorLabel || c.sponsorName);
  const sponsor = sponsorFieldsSet
    ? { sponsorLabel: c.sponsorLabel || 'PRESENTED BY', sponsorName: c.sponsorName || '' }
    : (!isLive ? SAMPLE_SPONSOR : null);

  // v2/v3 not built yet — any style other than 'broadcast' falls back to
  // it rather than rendering nothing (a not-yet-implemented style should
  // never blank the board).
  const boardStyle = c.boardStyle === 'duel' || c.boardStyle === 'chase' ? c.boardStyle : 'broadcast';

  return (
    <ScaledScene bgColor={bgColor}>
      {boardStyle === 'broadcast' && (
        <StadiumBroadcastScene
          headerText={headerText}
          heatLabel={heatLabel}
          timeLabel={timeLabel}
          rows={rows}
          laneCount={laneCount}
          dqReasons={dqReasons}
          homeColor={snapshot?.homeColor ?? null}
          awayColor={snapshot?.awayColor ?? null}
          record={record}
          sponsor={sponsor}
          bgColor={bgColor}
        />
      )}
      {/* v2 'duel' / v3 'chase' — reserved for the sibling Stadium Lane
          designs Greg also approved 2026-07-03. Rendering 'broadcast' as
          the fallback above until they're built. */}
      {noLiveData && <BindGameCallout accent="#fbbf24" />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}
