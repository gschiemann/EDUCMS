'use client';

/**
 * StadiumMeetBoardWidget — the flagship "Stadium Lane" swim-meet
 * broadcast board (S6, #288). Greg picked all 3 stadium designs on
 * 2026-07-03 as sports-scoreboard template options
 * (docs/design/proposals/2026-07-02-stadium-lane/README.md). This file
 * ships all three: v1 "Broadcast" — a byte-faithful port of
 * `stadium-lane-v1-broadcast.html`; v2 "Dual-Meet Duel", a byte-faithful
 * port of `stadium-lane-v2-duel.html`; and v3 "Record Chase", a
 * byte-faithful port of `stadium-lane-v3-chase.html` (all three reference
 * screenshots in the same folder), each wired to LIVE game data instead
 * of its mockup's hardcoded sample swimmers/scores.
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
 * ── Structure — router + sibling scenes ─────────────────────────────────
 * `StadiumMeetBoardWidget` is the router: it owns live-data plumbing
 * (GameStateContext read, no-fake-data guard, config normalization) and
 * dispatches to a per-`boardStyle` presentation component:
 *   - `StadiumBroadcastScene` (boardStyle: 'broadcast', v1) — the single-
 *     event lane leaderboard with pool-record + sponsor footer.
 *   - `StadiumDuelScene` (boardStyle: 'duel', v2) — the dual-meet team-
 *     score header with color-flood diagonal collision + per-swimmer
 *     delta-vs-leader column + a live-only ticker.
 *   - `StadiumChaseScene` (boardStyle: 'chase', v3) — a left rail with a
 *     giant race-clock readout + a configured pool-record-chase card
 *     (value/holder/progress-bar/gap) + a team-score chip, alongside a
 *     right ladder of place-ordered rows.
 * All three are selected by the same `cfg.boardStyle` switch. The
 * live-data mapping shared by all three (readResults → sorted/DQ'd rows,
 * team colors/names, no-fake-data guard) lives in the router, not
 * duplicated per style; each scene's file-header-adjacent comment block
 * documents ONLY the mapping unique to that scene (team scores + deltas +
 * the omitted "up next" clause for Duel; the race clock + record-chase
 * card for Chase).
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
  /** v1 'broadcast', v2 'duel', and v3 'chase' are all implemented — the
   *  three Stadium Lane designs Greg approved 2026-07-03. Named
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

/** Parses a result `mark` into milliseconds for delta math. Handles the
 *  formats real meet marks show up in: plain seconds ("51.90"), mm:ss.xx
 *  ("1:52.31"), and h:mm:ss.xx for distance events. Returns null for
 *  anything non-numeric (DQ/SCR/NS, blank, or an unrecognized shape) so
 *  callers can cleanly skip delta math instead of computing garbage. */
function parseMarkMs(mark: string): number | null {
  const m = mark.trim();
  if (!m || isDqMark(m)) return null;
  const parts = m.split(':');
  if (parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let seconds = 0;
  for (const n of nums) seconds = seconds * 60 + n;
  return Math.round(seconds * 1000);
}

/** Formats a millisecond delta back into the mockup's "+0.28" style —
 *  always 2 decimals, always seconds (deltas within one heat/event are
 *  sub-minute in practice; a larger gap just prints more digits before
 *  the decimal, never wraps to mm:ss, matching the mockup's plain-seconds
 *  delta column). */
function formatDeltaMs(deltaMs: number): string {
  return `+${(deltaMs / 1000).toFixed(2)}`;
}

/** Formats a raw mark string into the v3 mockup's trimmed "RACE CLOCK"
 *  style — the mockup shows "51.9" (one decimal), not the ladder's
 *  full-precision "51.90". Strips exactly one trailing zero off a
 *  2-decimal seconds value so "51.90"→"51.9" but "51.05"→"51.05" (no
 *  false precision loss when the trailing digit is meaningful). Only
 *  ever fed a leader's already-DQ-filtered mark (see StadiumChaseScene). */
function formatRaceClock(mark: string): string {
  const trimmed = mark.trim();
  const m = trimmed.match(/^(\d+)\.(\d)0$/);
  return m ? `${m[1]}.${m[2]}` : trimmed;
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
  homeTeam,
  awayTeam,
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
  homeTeam: string | null;
  awayTeam: string | null;
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
                    {/* Real bound team name (a dual meet's two schools) when the
                        game carries one; falls back to HOME/AWAY only when it
                        doesn't (e.g. no-data surface). Never fabricated. */}
                    {r.team === 'home' ? (homeTeam || 'HOME') : (awayTeam || 'AWAY')}
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
// StadiumDuelScene — v2 "Dual-Meet Duel". Faithful port of
// stadium-lane-v2-duel.html (docs/design/proposals/2026-07-02-stadium-lane/).
// Every pixel value below is taken directly from that mockup's CSS.
//
// ── Live-data mapping specific to this scene (shared plumbing — sorted
//    rows, DQ, lane chip colors — lives in the router above, same as v1) ──
//   - team SCORES ← snapshot.homeScore / snapshot.awayScore (real dual-meet
//     team points; NEVER fabricated — 0/0 renders honestly as "0"/"0" when
//     a meet hasn't scored yet, same as the mockup's two big numbers but
//     driven by the actual bound game instead of a hardcoded "96"/"74").
//   - team NAMES ← snapshot.homeTeam / snapshot.awayTeam, falling back to
//     HOME/AWAY only when the bound game has no name set (mirrors v1's
//     row-level team-name fallback).
//   - team-color floods ← snapshot.homeColor/awayColor for the two
//     diagonal-collision panels AND each row's left accent bar — the
//     mockup's fixed red/blue is decorative sample color, the real board
//     always reflects the bound game's actual colors.
//   - per-swimmer DELTA ← computed here from each row's parsed mark vs the
//     leader's (place===1) parsed mark. The leader always shows "—" (no
//     delta from yourself); DQ'd / unparseable marks show "—" too (there
//     is no meaningful gap to a time that doesn't exist). This is pure
//     arithmetic on the SAME live times already in `rows` — not a new
//     data field, so nothing here can be fabricated.
//   - bottom ticker's LIVE clause ← built from the current leader's name +
//     the live team-score gap (also pure derivation from data already on
//     the snapshot/rows — "D. OKAFOR WINS · CENTRAL LEADS BY 22" reads
//     just like the mockup's copy but is computed, not typed).
//   - bottom ticker's "UP NEXT" clause ← OMITTED. There is no schedule /
//     next-event field anywhere in the data model (same "no field exists"
//     rule v1 applies to its pool-record/sponsor footer) — rendering the
//     mockup's fabricated "EVENT 13 · BOYS 200M IM — 8 MIN" on a real
//     board would be exactly the kind of invented signal the no-fake-data
//     rule forbids. The ticker simply runs LIVE-clause-only, full width.
// ════════════════════════════════════════════════════════════════════
function StadiumDuelScene({
  headerText,
  rows,
  laneCount,
  dqReasons,
  homeColor,
  awayColor,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  bgColor,
}: {
  headerText: { eventLabel: string; eventTitle: string };
  rows: ResultEntry[];
  laneCount: number;
  dqReasons: Record<string, string>;
  homeColor: string | null;
  awayColor: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  bgColor: string;
}) {
  const hc = homeColor || '#dc2626';
  const ac = awayColor || '#2563eb';
  const homeInitials = (homeTeam || 'HOME').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'H';
  const awayInitials = (awayTeam || 'AWAY').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'A';

  const visibleRows = rows.slice(0, laneCount);
  const leader = visibleRows.find((r) => r.place === 1 && !isDqMark(r.mark)) || null;
  const leaderMs = leader ? parseMarkMs(leader.mark) : null;

  // LIVE ticker clause — derived purely from data already in `rows` /
  // `snapshot`, never fabricated. No leader yet (no results / all DQ) →
  // a neutral "LIVE" status instead of inventing a name.
  const scoreGap = homeScore != null && awayScore != null ? Math.abs(homeScore - awayScore) : null;
  const leadingSide = scoreGap != null && homeScore! !== awayScore! ? (homeScore! > awayScore! ? (homeTeam || 'HOME') : (awayTeam || 'AWAY')) : null;
  const liveClause = leader
    ? `${(leader.name || '').toUpperCase()} LEADS THE FIELD${leadingSide && scoreGap ? ` · ${leadingSide.toUpperCase()} LEADS BY ${scoreGap}` : ''}`
    : (leadingSide && scoreGap ? `${leadingSide.toUpperCase()} LEADS BY ${scoreGap}` : 'RESULTS UPDATING');

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, fontFamily: BODY_FONT, color: '#fff', background: bgColor, overflow: 'hidden' }}>
      {/* ── The DUEL: home/away color floods collide on a diagonal ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '56%', background: `linear-gradient(115deg, ${hc} 0%, ${hc} 45%, ${hc} 100%)`, clipPath: 'polygon(0 0, 100% 0, 72% 100%, 0 100%)' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '56%', background: `linear-gradient(245deg, ${ac} 0%, ${ac} 45%, ${ac} 100%)`, clipPath: 'polygon(28% 0, 100% 0, 100% 100%, 0 100%)' }} />
      <div style={{ position: 'absolute', top: 150, right: 0, bottom: 0, left: 0, background: 'linear-gradient(180deg, rgba(5,8,15,.30) 0%, rgba(5,8,15,.86) 26%, rgba(5,8,15,.94) 100%)' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.35, background: 'repeating-linear-gradient(115deg, rgba(255,255,255,.025) 0 2px, transparent 2px 18px)' }} />

      {/* ── Header: dual-meet team scores are the story ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 150, display: 'flex', alignItems: 'center', padding: '0 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 92, height: 92, borderRadius: 22, background: 'rgba(0,0,0,.3)', border: '3px solid rgba(255,255,255,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 40 }}>
            {homeInitials}
          </div>
          <div style={{ margin: '0 26px' }}>
            <b style={{ display: 'block', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 46, letterSpacing: 1 }}>{(homeTeam || 'HOME').toUpperCase()}</b>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 4, opacity: 0.8 }}>HOME</span>
          </div>
          <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 98, textShadow: '0 5px 0 rgba(0,0,0,.3)' }}>{homeScore ?? 0}</div>
        </div>
        <div style={{ margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 34, letterSpacing: 2 }}>{headerText.eventTitle}</div>
          {headerText.eventLabel && (
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 5, color: 'rgba(255,255,255,.85)', marginTop: 4 }}>{headerText.eventLabel}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', textAlign: 'right' }}>
          <div style={{ width: 92, height: 92, borderRadius: 22, background: 'rgba(0,0,0,.3)', border: '3px solid rgba(255,255,255,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 40 }}>
            {awayInitials}
          </div>
          <div style={{ margin: '0 26px' }}>
            <b style={{ display: 'block', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 46, letterSpacing: 1 }}>{(awayTeam || 'AWAY').toUpperCase()}</b>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 4, opacity: 0.8 }}>AWAY</span>
          </div>
          <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 98, textShadow: '0 5px 0 rgba(0,0,0,.3)' }}>{awayScore ?? 0}</div>
        </div>
      </div>

      {/* ── Rows: glass panels, times enormous, per-swimmer delta ── */}
      <div style={{ position: 'absolute', top: 172, bottom: 88, left: 44, right: 44, display: 'flex', flexDirection: 'column' }}>
        {visibleRows.map((r, i) => {
          const dq = isDqMark(r.mark);
          const isLeader = r.place === 1 && !dq;
          const reason = r.lane != null ? dqReasons[String(r.lane)] : undefined;
          const rowMs = dq ? null : parseMarkMs(r.mark);
          const delta = isLeader || rowMs == null || leaderMs == null ? '—' : formatDeltaMs(rowMs - leaderMs);
          const sideColor = r.team === 'home' ? hc : r.team === 'away' ? ac : '#64748b';
          const clubLabel = r.team === 'home' ? (homeTeam || 'HOME') : r.team === 'away' ? (awayTeam || 'AWAY') : null;
          const clubBg = r.team === 'home' ? 'rgba(239,68,68,.16)' : r.team === 'away' ? 'rgba(59,130,246,.16)' : 'rgba(255,255,255,.08)';
          const clubFg = r.team === 'home' ? '#fca5a5' : r.team === 'away' ? '#93c5fd' : '#cbd5e1';
          return (
            <div
              key={`${r.lane ?? i}-${i}`}
              style={{
                position: 'relative', flex: 1, margin: '6px 0', display: 'flex', alignItems: 'center',
                borderRadius: 18, background: 'rgba(13,18,32,.72)', border: '1px solid rgba(255,255,255,.09)',
                boxShadow: '0 10px 30px rgba(0,0,0,.35)', overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 14, background: sideColor }} />
              <div style={{ width: 150, textAlign: 'center', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 54, color: 'rgba(255,255,255,.9)' }}>
                {r.lane ?? '—'}
                <small style={{ display: 'block', fontSize: 14, fontWeight: 800, letterSpacing: 4, color: '#7e8aa6', fontFamily: BODY_FONT }}>LANE</small>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{
                  fontSize: 54, fontWeight: 800, textTransform: 'uppercase',
                  color: dq ? '#94a3b8' : '#ffffff', textDecoration: dq ? 'line-through' : 'none',
                }}>
                  {r.name || '—'}
                </b>
                {clubLabel && (
                  <span style={{ display: 'inline-block', marginLeft: 22, padding: '6px 16px', borderRadius: 999, fontSize: 20, fontWeight: 800, letterSpacing: 2, background: clubBg, color: clubFg, verticalAlign: 'middle' }}>
                    {clubLabel.toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#64748b', marginRight: 34, fontVariantNumeric: 'tabular-nums' }}>
                {delta}
              </div>
              <div style={{
                fontFamily: dq ? BODY_FONT : MONO_FONT, fontSize: dq ? 44 : 76, fontWeight: 800, marginRight: 34,
                fontVariantNumeric: 'tabular-nums', letterSpacing: dq ? undefined : -2,
                color: dq ? '#f87171' : (isLeader ? '#fde047' : '#ffffff'),
                textShadow: isLeader ? '0 0 26px rgba(253,224,71,.35)' : undefined,
              }}>
                {dq ? `DQ${reason ? ` — ${reason}` : ''}` : (r.mark || '—')}
              </div>
              <div style={{
                width: 104, height: 64, borderRadius: 12, marginRight: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 38,
                background: dq ? '#1a2337' : r.place === 1 ? 'linear-gradient(135deg,#f59e0b,#fbbf24)' : r.place === 2 ? 'linear-gradient(135deg,#94a3b8,#e2e8f0)' : r.place === 3 ? 'linear-gradient(135deg,#b45309,#f59e0b)' : '#1a2337',
                color: dq ? '#8ea0c2' : r.place === 1 ? '#3b2a00' : r.place === 2 ? '#1e293b' : r.place === 3 ? '#2f1c00' : '#8ea0c2',
              }}>
                {dq || !r.place ? '—' : r.place}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ticker: LIVE clause only — "UP NEXT" is omitted, no
          schedule/next-event field exists in the data model. ── */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 76, display: 'flex', alignItems: 'center', background: 'linear-gradient(90deg,#0b101d,#101728)', borderTop: '1px solid #202b47', padding: '0 48px', fontSize: 22, fontWeight: 800, letterSpacing: 1, color: '#9fb0d0' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', marginRight: 16, boxShadow: '0 0 12px rgba(34,197,94,.8)' }} />
        LIVE — <b style={{ color: '#fff', margin: '0 8px' }}>{liveClause}</b>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// StadiumChaseScene — v3 "Record Chase". Faithful port of
// stadium-lane-v3-chase.html (docs/design/proposals/2026-07-02-stadium-lane/).
// Every pixel value below is taken directly from that mockup's CSS.
//
// ── Live-data mapping specific to this scene (shared plumbing — sorted
//    rows, DQ, lane chip colors, team names — lives in the router above,
//    same as v1/v2) ──
//   - RACE CLOCK ← the mockup's giant "51.9" readout is the LEADER'S
//     finish time (place===1, non-DQ), the same honest signal v1/v2 use
//     for the gold leader glow — it is a completed result already on the
//     snapshot, not a fabricated running clock. No results yet (no
//     leader) → "—" rather than inventing a time. Trimmed to the
//     mockup's one-decimal style via formatRaceClock (never re-rounds a
//     genuinely 2-decimal-significant mark).
//   - POOL RECORD CHASE card ← NO record field exists anywhere in the
//     data model (same "no field exists" rule as v1's footer). Fully
//     operator-configured (recordLabel/recordValue/recordHolder/
//     recordDelta, reusing v1's exact config keys — one record concept,
//     one set of fields, across every Stadium Lane style). ANY of the
//     four blank still renders what's configured; ALL four blank omits
//     the whole card cleanly — never the mockup's fabricated "50.84 A.
//     WASHINGTON" sample on a real board.
//   - Progress bar fill ← computed ONLY from data already in hand: the
//     configured recordValue parsed as a mark vs the live leader's parsed
//     mark, clamped to [0,100]. Record pace = 100%; every ms slower than
//     the record shrinks the fill proportionally (leaderMs can never be
//     BELOW recordMs in a believable feed, but the clamp guards a
//     mistyped record too). If either mark fails to parse (blank record,
//     DQ leader, no leader) the bar is omitted rather than drawing a
//     meaningless width — the mockup's fixed 78% was decorative sample
//     data, never a computed ratio.
//   - Gap line ← derived purely from the SAME two parsed marks used for
//     the bar ("<LEADER NAME> FINISHED +<gap> OFF THE RECORD"), never
//     re-typed. If the leader is UNDER the record, the line reads a
//     genuine "NEW RECORD" celebration instead of a nonsensical negative
//     gap — still pure arithmetic on real data, not fabricated copy.
//   - Team chip ← snapshot.homeScore/awayScore + homeTeam/awayTeam (the
//     SAME real fields the mockup's fixed "CENTRAL 96 — WESTVIEW 74"
//     stands in for) with a real score-gap "TEAM LEAD" (or "TIED" at
//     0 gap) instead of the mockup's hardcoded "+22".
//   - Club label per row ← real team name (homeTeam/awayTeam by
//     entry.team), same as v1/v2's row-level fallback-to-HOME/AWAY rule.
// ════════════════════════════════════════════════════════════════════
function StadiumChaseScene({
  headerText,
  heatLabel,
  timeLabel,
  rows,
  laneCount,
  dqReasons,
  homeColor,
  awayColor,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  record,
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
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  record: { recordLabel: string; recordValue: string; recordHolder: string; recordDelta: string } | null;
  bgColor: string;
}) {
  const visibleRows = rows.slice(0, laneCount);
  const leader = visibleRows.find((r) => r.place === 1 && !isDqMark(r.mark)) || null;
  const leaderMs = leader ? parseMarkMs(leader.mark) : null;
  const raceClock = leader && leader.mark ? formatRaceClock(leader.mark) : '—';

  // Record-chase progress bar + gap line — computed ONLY when BOTH a
  // configured record value AND a real live leader mark parse cleanly.
  // Either missing → omit the bar/gap rather than draw a meaningless or
  // fabricated number (see file-header-adjacent comment above).
  const recordMs = record?.recordValue ? parseMarkMs(record.recordValue) : null;
  const chaseReady = recordMs != null && leaderMs != null && leaderMs > 0;
  const progressPct = chaseReady ? Math.max(0, Math.min(100, (recordMs! / leaderMs!) * 100)) : null;
  const gapLine = chaseReady
    ? (leaderMs! <= recordMs!
        ? `${(leader!.name || '').toUpperCase()} SET A NEW RECORD`
        : `${(leader!.name || '').toUpperCase()} FINISHED ${formatDeltaMs(leaderMs! - recordMs!)} OFF THE RECORD`)
    : null;

  const scoreGap = homeScore != null && awayScore != null ? homeScore - awayScore : null;
  const teamLeadLabel = scoreGap === 0 ? 'TIED' : 'TEAM LEAD';
  const teamLeadValue = scoreGap != null ? (scoreGap === 0 ? '—' : (scoreGap > 0 ? `+${scoreGap}` : `${scoreGap}`)) : '—';

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, fontFamily: BODY_FONT, color: '#fff', background: `radial-gradient(1000px 700px at 82% 20%, rgba(16,185,129,.14), transparent 60%), radial-gradient(900px 600px at 8% 90%, rgba(59,130,246,.10), transparent 60%), ${bgColor}`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.5, background: 'repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 4px)' }} />

      {/* ── Left rail: LIVE tag, event tower, giant race clock, record-chase card, team chip ── */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 560, padding: '52px 44px', background: 'linear-gradient(180deg,#0b1322 0%,#081020 100%)', borderRight: '1px solid #1c2740', boxSizing: 'border-box' }}>
        <div style={{ display: 'inline-block', background: '#10b981', color: '#032117', fontSize: 18, fontWeight: 800, letterSpacing: 3, padding: '9px 20px', borderRadius: 999 }}>
          ● LIVE{headerText.eventLabel ? ` — ${headerText.eventLabel.split(/\s*[·|]\s*/).pop()}` : ''}
        </div>
        <h1 style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 66, lineHeight: 1.02, margin: '26px 0 8px' }}>
          {headerText.eventTitle}
        </h1>
        {(heatLabel || headerText.eventLabel) && (
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#6ee7b7' }}>
            {headerText.eventLabel}{headerText.eventLabel && heatLabel ? ' · ' : ''}{heatLabel ? `HEAT ${heatLabel}` : ''}
          </div>
        )}

        <div style={{ margin: '52px 0 10px' }}>
          <small style={{ fontSize: 18, fontWeight: 800, letterSpacing: 4, color: '#7e8aa6' }}>RACE CLOCK</small>
          <b style={{
            display: 'block', fontFamily: MONO_FONT, fontSize: 150, fontWeight: 800, letterSpacing: -6, lineHeight: 1,
            fontVariantNumeric: 'tabular-nums', textShadow: raceClock !== '—' ? '0 0 40px rgba(16,185,129,.30)' : undefined,
          }}>
            {raceClock}
          </b>
        </div>

        {record && (
          // Mockup's sample record text was pre-typed in caps (no CSS
          // text-transform on .rec) — force uppercase on the label/holder/
          // gap line here (same rule v1's footer uses) so an
          // operator-typed mixed-case value still reads like the approved
          // design. The record VALUE (a time, e.g. "50.84") is left as
          // typed — numbers have no case.
          <div style={{ marginTop: 44, border: '2px dashed rgba(251,191,36,.5)', borderRadius: 18, padding: '22px 24px', background: 'rgba(251,191,36,.06)', textTransform: 'uppercase' }}>
            <small style={{ fontSize: 16, fontWeight: 800, letterSpacing: 3, color: '#fbbf24' }}>⚑ {record.recordLabel}</small>
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 8 }}>
              {record.recordValue && <b style={{ fontFamily: MONO_FONT, fontSize: 56, fontWeight: 800, textTransform: 'none' }}>{record.recordValue}</b>}
              {record.recordHolder && <span style={{ fontSize: 19, fontWeight: 700, color: '#cbd5e1', marginLeft: 16 }}>{record.recordHolder}</span>}
            </div>
            {progressPct != null && (
              <div style={{ height: 14, borderRadius: 7, background: '#1a2337', marginTop: 18, overflow: 'hidden' }}>
                <div style={{ display: 'block', height: '100%', width: `${progressPct}%`, borderRadius: 7, background: 'linear-gradient(90deg,#10b981,#fbbf24)' }} />
              </div>
            )}
            {(gapLine || record.recordDelta) && (
              <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, letterSpacing: 1, color: '#fde68a' }}>
                {gapLine || record.recordDelta}
              </div>
            )}
          </div>
        )}

        <div style={{ position: 'absolute', left: 44, right: 44, bottom: 44, display: 'flex', alignItems: 'center', background: '#0e1730', border: '1px solid #223052', borderRadius: 16, padding: '16px 22px', boxSizing: 'border-box' }}>
          <b style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 30 }}>
            {(homeTeam || 'HOME').toUpperCase()} {homeScore ?? 0} — {(awayTeam || 'AWAY').toUpperCase()} {awayScore ?? 0}
          </b>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <b style={{ display: 'block', fontSize: 38, color: '#6ee7b7' }}>{teamLeadValue}</b>
            <small style={{ display: 'block', fontSize: 13, fontWeight: 800, letterSpacing: 2, color: '#7e8aa6' }}>{teamLeadLabel}</small>
          </div>
        </div>
      </div>

      {/* ── Right: the ladder — place-ordered rows, huge mono times ──
          NOTE: deliberately top/bottom/left + `width: calc(100% - 560px)`
          instead of all four physical sides. Supplying top AND right AND
          bottom AND left together on one style object lets React's
          style-object → attribute-string serializer collapse them into
          the CSS positioning SHORTHAND in the rendered attribute — even
          though every individual property was authored as its own
          longhand key — and this app's Chromium-83 positioning-shorthand
          polyfill (apps/web/src/app/player/layout.tsx) matches ANY style
          string that STARTS WITH that shorthand's zero form (intended to
          catch the genuinely-all-zero full-bleed case) and force-
          `!important`-zeroes every side on it. A leading-zero-but-not-
          uniform value (e.g. this ladder's "top/right/bottom all zero,
          left 560") matches that same leading substring and gets
          silently zeroed too. That collapsed this ladder's left offset
          back to 0, stacking it directly on top of the rail (caught via
          the Playwright screenshot harness — see
          stadium-meet-board-chase-shot.spec.ts). Never give React all 4
          sides on the same element in a player-shipped widget; 3 sides +
          an explicit width/height (the same pattern the rail above and
          v1/v2's own scenes already use) is immune to both the shorthand
          collapse AND the underlying Chromium-83 parsing gap. */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 560, width: 'calc(100% - 560px)', padding: '44px 48px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 20 }}>
          <h2 style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 40, letterSpacing: 1 }}>
            RESULTS{heatLabel ? ` — HEAT ${heatLabel.split('/')[0]}` : ''}
          </h2>
          <span style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 800, letterSpacing: 3, color: '#7e8aa6' }}>
            PLACE ORDER{timeLabel ? ` · ${timeLabel}` : ''}
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {visibleRows.map((r, i) => {
            const dq = isDqMark(r.mark);
            const empty = !r.name && !r.mark;
            const reason = r.lane != null ? dqReasons[String(r.lane)] : undefined;
            const rankBg =
              !dq && r.place === 1 ? 'linear-gradient(160deg,#f59e0b,#fbbf24)'
              : !dq && r.place === 2 ? 'linear-gradient(160deg,#94a3b8,#e2e8f0)'
              : !dq && r.place === 3 ? 'linear-gradient(160deg,#b45309,#f59e0b)'
              : 'rgba(255,255,255,.05)';
            const rankFg = !dq && r.place === 1 ? '#3b2a00' : !dq && r.place === 2 ? '#1e293b' : !dq && r.place === 3 ? '#2f1c00' : '#fff';
            const tc = laneChipColor(r, homeColor, awayColor);
            const clubLabel = r.team === 'home' ? (homeTeam || 'HOME') : r.team === 'away' ? (awayTeam || 'AWAY') : null;
            return (
              <div
                key={`${r.lane ?? i}-${i}`}
                style={{
                  position: 'relative', flex: 1, margin: '6px 0', display: 'flex', alignItems: 'center',
                  borderRadius: 16, background: 'linear-gradient(90deg, rgba(255,255,255,.045), rgba(255,255,255,.015))',
                  border: '1px solid rgba(255,255,255,.07)', padding: '0 30px 0 0', overflow: 'hidden', opacity: empty ? 0.35 : 1,
                }}
              >
                <div style={{ width: 130, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 64, background: rankBg, color: rankFg, flex: 'none' }}>
                  {empty || dq || !r.place ? '—' : r.place}
                </div>
                <div style={{ flex: 1, paddingLeft: 30, minWidth: 0 }}>
                  <b style={{
                    display: 'block', fontSize: 50, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    textTransform: 'uppercase', color: dq ? '#8ea0c2' : '#ffffff', textDecoration: dq ? 'line-through' : 'none',
                  }}>
                    {empty ? '—' : (r.name || '—')}
                  </b>
                  {clubLabel && (
                    <small style={{ display: 'block', fontSize: 21, fontWeight: 800, letterSpacing: 3, color: '#7e8aa6', marginTop: 2 }}>
                      {clubLabel.toUpperCase()}
                    </small>
                  )}
                </div>
                <div style={{ width: 120, textAlign: 'center', marginRight: 12, flex: 'none' }}>
                  <b style={{ display: 'block', fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: 40, color: tc }}>{r.lane ?? '—'}</b>
                  <small style={{ fontSize: 13, fontWeight: 800, letterSpacing: 3, color: '#5b6884' }}>LANE</small>
                </div>
                <div style={{
                  fontFamily: MONO_FONT, fontWeight: 800, letterSpacing: dq ? undefined : -2, width: 360, textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums', flex: 'none',
                  fontSize: dq ? 44 : 70, color: dq ? '#f87171' : (r.place === 1 ? '#fde047' : '#ffffff'),
                }}>
                  {empty ? '—' : dq ? `DQ${reason ? ` · ${reason}` : ''}` : (r.mark || '—')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// StadiumMeetBoardWidget — router. Live-data plumbing + no-fake-data
// guard live here; style-specific presentation is a sibling scene
// (StadiumBroadcastScene / 'broadcast' + StadiumDuelScene / 'duel' +
// StadiumChaseScene / 'chase').
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
  // Default scene bg is per-style (each mockup's own base color); an
  // operator-set bgColor always wins regardless of style.
  const defaultBgColor = c.boardStyle === 'duel' ? '#07090f' : c.boardStyle === 'chase' ? '#05070c' : '#060a14';
  const bgColor = c.bgColor || defaultBgColor;

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

  // v1 'broadcast', v2 'duel', and v3 'chase' are all built now — every
  // typed boardStyle has a real scene; nothing falls back anymore.
  const boardStyle: 'broadcast' | 'duel' | 'chase' =
    c.boardStyle === 'duel' ? 'duel' : c.boardStyle === 'chase' ? 'chase' : 'broadcast';

  // Team scores — v2 'duel' and v3 'chase' both show a team-score chip
  // (v1's design has no score header at all). Real bound game's
  // homeScore/awayScore; builder sample uses the mockup's 96/74 so the
  // gallery tile demonstrates the moment, same "sample only off a real
  // screen" rule as every other field here.
  const homeScore = isLive ? (snapshot?.homeScore ?? 0) : 96;
  const awayScore = isLive ? (snapshot?.awayScore ?? 0) : 74;

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
          homeTeam={snapshot?.homeTeam ?? null}
          awayTeam={snapshot?.awayTeam ?? null}
          record={record}
          sponsor={sponsor}
          bgColor={bgColor}
        />
      )}
      {boardStyle === 'duel' && (
        <StadiumDuelScene
          headerText={headerText}
          rows={rows}
          laneCount={laneCount}
          dqReasons={dqReasons}
          homeColor={snapshot?.homeColor ?? null}
          awayColor={snapshot?.awayColor ?? null}
          homeTeam={snapshot?.homeTeam ?? null}
          awayTeam={snapshot?.awayTeam ?? null}
          homeScore={homeScore}
          awayScore={awayScore}
          bgColor={bgColor}
        />
      )}
      {boardStyle === 'chase' && (
        <StadiumChaseScene
          headerText={headerText}
          heatLabel={heatLabel}
          timeLabel={timeLabel}
          rows={rows}
          laneCount={laneCount}
          dqReasons={dqReasons}
          homeColor={snapshot?.homeColor ?? null}
          awayColor={snapshot?.awayColor ?? null}
          homeTeam={snapshot?.homeTeam ?? null}
          awayTeam={snapshot?.awayTeam ?? null}
          homeScore={homeScore}
          awayScore={awayScore}
          record={record}
          bgColor={bgColor}
        />
      )}
      {noLiveData && <BindGameCallout accent="#fbbf24" />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}
