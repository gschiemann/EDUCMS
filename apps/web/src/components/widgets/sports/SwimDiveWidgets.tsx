'use client';

/**
 * SwimDiveWidgets — the flagship swim/dive board widgets (2026-07-01
 * swim/dive sport split — see `docs/research/2026-06-30-swim-dive-
 * scoreboards/00-REPORT.md`).
 *
 * Operator ask (verbatim, 2026-06-30): "find out what scoreboards do for
 * swimming competitions... lanes and shit that we need to show where each
 * swimmer is. And you grouped diving into the same sport but wouldn't that
 * be totally different? SEPARATE it."
 *
 * Two widgets, two data models — never conflate them:
 *
 *   • <SwimLaneGridWidget />  — SWIMMING is a lane/heat/time sport. One row
 *     per lane: lane #, swimmer/team, seed/live time (`mark`), place. No
 *     judges, no DD. Reads the SAME `MeetResult`/`ResultEntry` structured
 *     stat (`Game.stats.results`) every other meet sport already writes —
 *     `entry.lane` was already an optional field there, so NO schema
 *     change was needed to add lanes.
 *
 *   • <DiveLeaderboardWidget /> — DIVING is a judged sport. No lanes, no
 *     clock, no splits: divers are ranked by running judged total across a
 *     fixed dive list. Same `MeetResult` shape, but rendered as a
 *     place/diver/team/total/dives-done leaderboard, not a lane grid.
 *
 * Both:
 *   - read `Game.stats.results` via the shared `readResults` parser
 *     (apps/web/src/components/widgets/v2/_shared/sports-situational.tsx)
 *     so the console's MeetResultsSection editor and every board surface
 *     agree on one data contract;
 *   - ship a sensible SAMPLE heat/field so the builder tile is never blank
 *     (CLAUDE.md template-design workflow: no placeholders-as-content);
 *   - fixed 1920×1080 scene + `useScaleToFit` transform:scale (the
 *     player-shipped board pattern — MainScoreboardWidget.tsx);
 *   - Chromium-83 / NovaStar Taurus safe: no `inset`/`inset-*` shorthand
 *     (long-hand top/right/bottom/left only), no flex `gap` (margins),
 *     no `backdrop-filter` (solid panel backgrounds).
 *   - every text/color field is operator-editable via PropertiesPanel
 *     (see the SWIM_LANE_GRID / DIVE_LEADERBOARD cases there) — brand
 *     colors resolve through ColorField's "Brand primary/accent" presets.
 *
 * 2026-07-01 DEPTH PASS (docs/research/2026-06-30-swim-dive-scoreboards/
 * 00-REPORT.md parts A3/A4/A8/B4/B5) adds four more widgets, same file,
 * same ScaledScene/editable/Taurus-safe/sample-data patterns:
 *
 *   • <SwimRelayExchangeWidget /> (SWIM_RELAY_EXCHANGE, report A4) — a
 *     relay lane's 4 legs: leg name, per-leg split, cumulative time, and
 *     exchange/takeoff time. A negative exchange is an automatic DQ
 *     (illegal early takeoff) — flagged in red.
 *   • <SwimSplitsPanelWidget />   (SWIM_SPLITS_PANEL, report A8) — the
 *     per-length split table for ONE focused lane: length #, split
 *     (subtractive) + cumulative, with an optional pace-vs-record delta.
 *   • <SwimRecordLineWidget />    (SWIM_RECORD_LINE, report A3/A8) — the
 *     record/pace reference bar: record type (WR/AR/NR/pool/meet), time +
 *     holder, live on/off-pace delta, and a "RECORD" flash when broken.
 *   • <DiveJudgesPanelWidget />   (DIVE_JUDGES_PANEL, report B4/B5) — the
 *     row of judge scores (3/5/7 judges) for the CURRENT dive, dropped
 *     high/low greyed out, dive code + Degree of Difficulty (DD), and the
 *     computed dive score (sum of kept scores × DD).
 *
 * None of these need a new data source. The relay/splits/record widgets
 * hold their per-widget config as operator-typed sample/override rows
 * (`legs[]` / `lengths[]`) rather than a new structured Game.stats key —
 * consistent with CLAUDE.md's "no Prisma migration" rule and with how
 * every other meet-sport board here renders `mark` as a free-form
 * display-as-typed string. The judges panel reads the SAME scalar
 * `Game.stats` sport-stat keys `SituationalRow`'s diving branch already
 * reads (`currentDiver`, `diveCode`, `dd` — sports-situational.tsx) plus
 * a new `judgeScores` array, so this widget and the broadcast strip can
 * never disagree about whose dive is on the board.
 */

import { useEffect, useRef, useState } from 'react';
import { useGameState } from './GameStateContext';
import { readResults, type ResultEvent, type ResultEntry } from '../v2/_shared/sports-situational';
import type { BaseCfg, WidgetProps } from '../v2/_shared/types';

const DISPLAY_FONT = "var(--font-fredoka), 'Fredoka', 'Baloo 2', system-ui, sans-serif";
const MONO_FONT = "'DM Mono', 'SF Mono', 'Roboto Mono', monospace";

// ── scale-to-fit (fixed 1920×1080 scene → any zone) — same primitive as
//    MainScoreboardWidget.tsx / RibbonScorebugWidgets.tsx. Re-declared
//    locally (each sport-widget file owns its copy; there's no shared
//    export) rather than importing across files that don't share one. ──
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

/** Outer scaffold every board in this file shares: measures its zone,
 *  scales a fixed natural-size scene to fit (letterboxed, never distorted).
 *  Defaults to the original 1920×1080 landscape base — every existing
 *  caller (relay/splits/record/judges panels) is byte-identical.
 *
 *  P1-10 (2026-07-02) — `naturalW`/`naturalH` are additive so
 *  SwimLaneGridWidget/DiveLeaderboardWidget can opt into a 960×1080
 *  PORTRAIT natural size when the board page detects a tall canvas (a
 *  960×1080 LED wall). Without this, a portrait wall scaled the landscape
 *  1920×1080 scene down to Math.min(960/1920, 1080/1080)=0.5× — a ~540px
 *  half-dark letterboxed strip at half text size. The row content below is
 *  already a flex column of full-width rows (no landscape-only layout
 *  assumptions), so it reflows cleanly into a taller/narrower canvas. */
function ScaledScene({
  bgColor,
  children,
  naturalW = 1920,
  naturalH = 1080,
}: {
  bgColor: string;
  children: React.ReactNode;
  naturalW?: number;
  naturalH?: number;
}) {
  const { ref, scale } = useScaleToFit(naturalW, naturalH);
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
          width: naturalW, height: naturalH, flex: 'none',
          transform: `scale(${scale})`, transformOrigin: 'center center',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * BindGameCallout — the S2-1 (2026-07-02) "no-fake-data on a real screen"
 * banner. Rendered ON TOP of an already-empty/neutral board shell (never
 * instead of it — the chrome underneath still shows team-color-neutral
 * lanes/panels) whenever a widget is on a real player surface
 * (RenderSurfaceContext === 'player') with a GameStateProvider mounted
 * but no game bound / no results yet. Shared by every widget in this
 * file so the copy + look stays identical across swim/dive boards.
 */
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
        <span style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 30, letterSpacing: 2, color: accent }}>
          NO GAME BOUND
        </span>
        <span style={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: 20, color: '#cbd5e1', marginTop: 8 }}>
          Bind a game in the score keeper to go live
        </span>
      </div>
    </div>
  );
}

/**
 * SampleWatermark — the S2-1 (2026-07-02) builder/preview tag. Shown ONLY
 * when `state == null` (no GameStateContext of any kind above this
 * widget — genuinely the builder canvas / gallery thumbnail / preview
 * modal rendering the fabricated SAMPLE data). A real screen always has
 * at least the phantom-unbound state (RenderSurfaceContext), so this can
 * never appear there — see GameStateContext.tsx.
 */
function SampleWatermark() {
  return (
    <div style={{ position: 'absolute', bottom: 24, right: 32, background: 'rgba(0,0,0,0.55)', color: '#facc15', fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, letterSpacing: 4, padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(250,204,21,0.4)', zIndex: 6 }}>
      SAMPLE
    </div>
  );
}

// ── SAMPLE data — an 8-lane heat + a 6-diver field, so the builder tile
//    and gallery thumbnail are alive, never blank. ─────────────────────
const SAMPLE_SWIM_EVENT: ResultEvent = {
  event: 'EVENT 12 — BOYS 100 FREESTYLE — HEAT 3 OF 4',
  entries: [
    { place: 0, name: 'J. RIVERA', team: 'home', lane: 1, mark: '55.42' },
    { place: 2, name: 'M. CHEN', team: 'away', lane: 2, mark: '52.18' },
    { place: 1, name: 'D. OKAFOR', team: 'home', lane: 3, mark: '51.90' },
    { place: 0, name: '', team: null, lane: 4, mark: '' },
    { place: 3, name: 'T. NGUYEN', team: 'away', lane: 5, mark: '53.61' },
    { place: 4, name: 'S. PATEL', team: 'home', lane: 6, mark: '54.05' },
    { place: 0, name: 'K. ANDERSON', team: 'away', lane: 7, mark: 'DQ' },
    { place: 0, name: '', team: null, lane: 8, mark: '' },
  ],
};

const SAMPLE_DIVE_EVENT: ResultEvent = {
  event: 'GIRLS 1M SPRINGBOARD — FINAL',
  entries: [
    { place: 1, name: 'A. WASHINGTON', team: 'home', mark: '312.45' },
    { place: 2, name: 'L. FISCHER', team: 'away', mark: '298.10' },
    { place: 3, name: 'R. TANAKA', team: 'home', mark: '284.75' },
    { place: 4, name: 'B. COLE', team: 'away', mark: '271.20' },
    { place: 5, name: 'E. MARTIN', team: 'home', mark: '259.90' },
    { place: 6, name: 'G. SILVA', team: 'away', mark: '243.55' },
  ],
};

/** Pick the event this widget should render: operator's `cfg.eventFilter`
 *  (exact event-name match) wins; else the highest `order`; else the
 *  last array entry — same "current event" heuristic MeetResultsBox
 *  uses on the /board page, so this widget and the board never disagree
 *  about which event is "live" right now. */
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

function teamColorFor(entry: ResultEntry, homeColor: string, awayColor: string): string {
  return entry.team === 'home' ? homeColor : entry.team === 'away' ? awayColor : '#475569';
}

// ════════════════════════════════════════════════════════════════════
// SWIM_LANE_GRID — the "lanes and shit" board.
// ════════════════════════════════════════════════════════════════════

export interface SwimLaneGridCfg extends BaseCfg {
  headerText?: string;
  headerColor?: string;
  bgColor?: string;
  panelColor?: string;
  laneColColor?: string;
  homeColor?: string;
  awayColor?: string;
  textColor?: string;
  /** 'lane' = rows sorted by physical lane (the "grid" spectators read);
   *  'place' = rows sorted by finish rank (the "results list"). Real
   *  consoles (Daktronics OmniSport) offer exactly this toggle. */
  orderMode?: 'lane' | 'place';
  /** Exact event-name match to pin this widget to one event when the
   *  operator is tracking multiple heats in `stats.results`. Blank =
   *  auto-pick the current (highest-order / latest) event. */
  eventFilter?: string;
  /** Number of lane rows to render — matches the operator's pool
   *  (6/8/10 lanes are the common HS/college configurations). */
  laneCount?: number;
  /**
   * 2026-07-01 — track & field parity gap fix (#270a). The lane grid
   * generalizes to any running event with a lane assignment (the swim
   * research's Part C: "lanes × athlete/time/place" is sport-agnostic).
   * These two fields are internal caller-set config (the board page sets
   * them per-sport), NOT new operator-facing PropertiesPanel controls —
   * both default to the original swimming copy so every existing board
   * renders byte-identical when unset.
   */
  athleteLabel?: string;
  iconEmoji?: string;
  /**
   * P1-10 (2026-07-02) — internal caller-set flag (the board page sets this
   * from its own viewport check), NOT a new operator-facing PropertiesPanel
   * control — same "config swap, not a new component" pattern as
   * athleteLabel/iconEmoji above. When true, the scene's natural size is
   * 960×1080 (portrait) instead of 1920×1080 (landscape) so a real portrait
   * LED wall gets full-canvas lane rows instead of a letterboxed strip.
   * Unset/false renders byte-identical to before.
   */
  portrait?: boolean;
}

export function SwimLaneGridWidget({ config }: WidgetProps<SwimLaneGridCfg>) {
  const c = config ?? {};
  const state = useGameState();
  const isLive = state != null;
  const stats = (state?.snapshot?.stats ?? {}) as Record<string, unknown>;
  const liveEvents = readResults(stats);
  const event = isLive ? pickEvent(liveEvents, c.eventFilter) : SAMPLE_SWIM_EVENT;

  const bgColor = c.bgColor || '#050b16';
  const panelColor = c.panelColor || '#0c1830';
  const laneColColor = c.laneColColor || '#1e3a8a';
  const homeColor = c.homeColor || '#1e3a8a';
  const awayColor = c.awayColor || '#b91c1c';
  const textColor = c.textColor || '#ffffff';
  const laneCount = Math.max(1, Math.min(12, c.laneCount ?? 8));
  const orderMode = c.orderMode === 'place' ? 'place' : 'lane';
  // #270a — track & field reuse: caller (the board page) sets these to
  // 🏃 / "ATHLETE / TEAM" for track_and_field; every other caller is
  // unset and gets the original swimming copy, so no existing board
  // changes.
  const iconEmoji = c.iconEmoji || '🏊';
  const athleteLabel = c.athleteLabel || 'SWIMMER / TEAM';

  // On a live surface with no results recorded yet, render an empty lane
  // shell (no fabricated names/times) instead of the sample heat — same
  // no-fake-data rule MainScoreboardWidget follows for score/clock.
  const noLiveData = isLive && !event;
  const rows: ResultEntry[] = noLiveData
    ? Array.from({ length: laneCount }, (_, i) => ({ place: 0, name: '', team: null, lane: i + 1, mark: '' }))
    : (event?.entries ?? []).slice();

  // Fill any missing lanes up to laneCount with blank rows so the grid
  // always shows a full pool, not just the lanes with data.
  const laneNums = new Set(rows.map((r) => r.lane).filter((l): l is number => !!l));
  for (let ln = 1; ln <= laneCount; ln++) {
    if (!laneNums.has(ln)) rows.push({ place: 0, name: '', team: null, lane: ln, mark: '' });
  }

  const sorted = rows
    .filter((r) => (r.lane ?? 0) <= laneCount || rows.every((x) => !x.lane))
    .sort((a, b) => {
      if (orderMode === 'place') {
        const ap = a.place || 9999;
        const bp = b.place || 9999;
        if (ap !== bp) return ap - bp;
        return (a.lane || 0) - (b.lane || 0);
      }
      return (a.lane || 0) - (b.lane || 0);
    })
    .slice(0, laneCount);

  const headerText = c.headerText || event?.event || 'HEAT — LANE ASSIGNMENTS';
  const placeText = (p: number): string => (p > 0 ? String(p) : '—');
  const naturalW = c.portrait ? 960 : 1920;

  return (
    <ScaledScene bgColor={bgColor} naturalW={naturalW} naturalH={1080}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 40, display: 'flex', flexDirection: 'column' }}>
        {/* Header — event / heat title */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: panelColor, borderRadius: 14, padding: '18px 32px',
            marginBottom: 20, border: `2px solid ${laneColColor}`,
          }}
        >
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 42, fontWeight: 800, color: c.headerColor || '#fbbf24', letterSpacing: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {iconEmoji} {headerText.toUpperCase()}
          </span>
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 700, color: '#94a3b8', letterSpacing: 3, flex: 'none', marginLeft: 24 }}>
            {orderMode === 'place' ? 'RESULTS' : 'LANE ORDER'}
          </span>
        </div>

        {/* Column headers */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px', marginBottom: 8 }}>
          <div style={{ width: 110, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>LANE</div>
          <div style={{ flex: 1, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>{athleteLabel}</div>
          <div style={{ width: 260, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>TIME</div>
          <div style={{ width: 140, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>PLACE</div>
        </div>

        {/* Lane rows */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {sorted.map((r, i) => {
            const empty = !r.name && !r.mark;
            const teamColor = teamColorFor(r, homeColor, awayColor);
            const isDq = r.mark.toUpperCase() === 'DQ' || r.mark.toUpperCase() === 'SCR' || r.mark.toUpperCase() === 'NS';
            return (
              <div
                key={`${r.lane ?? i}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', flex: 1, minHeight: 0,
                  background: i % 2 === 0 ? panelColor : 'transparent',
                  borderRadius: 10,
                  marginTop: 4,
                  paddingLeft: 24, paddingRight: 24,
                  opacity: empty ? 0.35 : 1,
                }}
              >
                <div style={{ width: 110, display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 10, background: laneColColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 900, color: '#ffffff',
                  }}>
                    {r.lane ?? '—'}
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div style={{ width: 8, height: 34, borderRadius: 4, background: teamColor, marginRight: 18, flex: 'none' }} />
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 700, color: textColor, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {empty ? '—' : r.name || '—'}
                  </span>
                </div>
                <div style={{ width: 260, textAlign: 'right' }}>
                  <span style={{
                    fontFamily: MONO_FONT, fontSize: 32, fontWeight: 700,
                    color: isDq ? '#ef4444' : textColor, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {empty ? '—' : r.mark || '—'}
                  </span>
                </div>
                <div style={{ width: 140, textAlign: 'right' }}>
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 32, fontWeight: 900, color: r.place === 1 ? '#fbbf24' : '#94a3b8' }}>
                    {empty ? '—' : placeText(r.place)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* "Bind a game" callout (S2-1, 2026-07-02) — real screen, no
          results recorded yet. The lane grid above is already an empty
          shell (blank names/times); this banner tells the operator why. */}
      {noLiveData && <BindGameCallout accent={c.headerColor || '#fbbf24'} />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}

// ════════════════════════════════════════════════════════════════════
// DIVE_LEADERBOARD — judged running-total leaderboard. NO lanes, NO
// clock, NO splits — a fundamentally different data model from swimming
// (2026-06-30 operator ask: "wouldn't that be totally different?
// SEPARATE it").
// ════════════════════════════════════════════════════════════════════

export interface DiveLeaderboardCfg extends BaseCfg {
  headerText?: string;
  headerColor?: string;
  bgColor?: string;
  panelColor?: string;
  accentColor?: string;
  homeColor?: string;
  awayColor?: string;
  textColor?: string;
  eventFilter?: string;
  /** Total dives in the list (HS dual = 6, HS championship = 11) — used
   *  only for the "X of N dives" readout; the leaderboard always shows
   *  every diver on `stats.results`. */
  divesInList?: number;
  /** P1-10 (2026-07-02) — same internal caller-set portrait flag as
   *  SwimLaneGridWidget.portrait: 960×1080 natural size instead of
   *  1920×1080 when the board page is on a portrait wall. Unset/false
   *  renders byte-identical to before. */
  portrait?: boolean;
}

export function DiveLeaderboardWidget({ config }: WidgetProps<DiveLeaderboardCfg>) {
  const c = config ?? {};
  const state = useGameState();
  const isLive = state != null;
  const stats = (state?.snapshot?.stats ?? {}) as Record<string, unknown>;
  const liveEvents = readResults(stats);
  const event = isLive ? pickEvent(liveEvents, c.eventFilter) : SAMPLE_DIVE_EVENT;
  const noLiveData = isLive && !event;

  const bgColor = c.bgColor || '#0a0714';
  const panelColor = c.panelColor || '#160f28';
  const accentColor = c.accentColor || '#a78bfa';
  const homeColor = c.homeColor || '#1e3a8a';
  const awayColor = c.awayColor || '#b91c1c';
  const textColor = c.textColor || '#ffffff';
  const divesInList = c.divesInList && c.divesInList > 0 ? c.divesInList : undefined;

  const rows: ResultEntry[] = noLiveData ? [] : (event?.entries ?? []).slice().sort((a, b) => (a.place || 9999) - (b.place || 9999));
  const headerText = c.headerText || event?.event || 'DIVING — RUNNING TOTALS';
  const naturalW = c.portrait ? 960 : 1920;

  return (
    <ScaledScene bgColor={bgColor} naturalW={naturalW} naturalH={1080}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 40, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: panelColor, borderRadius: 14, padding: '18px 32px',
            marginBottom: 20, border: `2px solid ${accentColor}`,
          }}
        >
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 42, fontWeight: 800, color: c.headerColor || '#fbbf24', letterSpacing: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            🤿 {headerText.toUpperCase()}
          </span>
          {divesInList && (
            <span style={{ fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 700, color: '#94a3b8', letterSpacing: 2, flex: 'none', marginLeft: 24 }}>
              {divesInList} DIVES
            </span>
          )}
        </div>

        {/* Column headers */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px', marginBottom: 8 }}>
          <div style={{ width: 110, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>PLACE</div>
          <div style={{ flex: 1, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>DIVER / TEAM</div>
          <div style={{ width: 300, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>TOTAL</div>
        </div>

        {/* Diver rows */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {rows.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 700, color: '#475569',
            }}>
              NO RESULTS YET
            </div>
          )}
          {rows.map((r, i) => {
            const teamColor = teamColorFor(r, homeColor, awayColor);
            const isFirst = r.place === 1;
            return (
              <div
                key={`${r.place}-${r.name}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', flex: 1, minHeight: 0,
                  background: isFirst ? `${accentColor}26` : (i % 2 === 0 ? panelColor : 'transparent'),
                  borderRadius: 10,
                  marginTop: 4,
                  paddingLeft: 24, paddingRight: 24,
                }}
              >
                <div style={{ width: 110 }}>
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 36, fontWeight: 900, color: isFirst ? '#fbbf24' : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                    {r.place > 0 ? r.place : '—'}
                  </span>
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div style={{ width: 8, height: 34, borderRadius: 4, background: teamColor, marginRight: 18, flex: 'none' }} />
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 700, color: textColor, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {r.name || '—'}
                  </span>
                </div>
                <div style={{ width: 300, textAlign: 'right' }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 34, fontWeight: 800, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
                    {r.mark || '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* "Bind a game" callout (S2-1, 2026-07-02) — distinct from "NO
          RESULTS YET" above: this fires only when there's no game bound
          AT ALL (no GameStateProvider snapshot), not when a bound meet
          simply hasn't posted a result yet. */}
      {noLiveData && <BindGameCallout accent={c.headerColor || '#fbbf24'} />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}

// ════════════════════════════════════════════════════════════════════
// SWIM_RELAY_EXCHANGE — one relay lane's 4 legs (report A4): leg name,
// per-leg split, cumulative time, exchange/takeoff time. A negative
// exchange is an automatic DQ (illegal early takeoff) — flag it in red.
// Relay-leg data has no home in the MeetResult/ResultEntry contract (no
// per-leg array field), so this widget's rows are operator-typed config
// (`legs[]`), same "display-as-typed, no schema change" rule the rest of
// this file's `mark` field already follows. The header still auto-picks
// from `stats.results` (event/heat context), same as the other boards.
// ════════════════════════════════════════════════════════════════════

export interface SwimRelayLeg {
  /** leg order label — "Leg 1 (Back)", "Leg 2 (Breast)", etc. */
  legName: string;
  /** swimmer name for this leg — display-as-typed. */
  swimmer: string;
  /** this leg's split (subtractive) — free-form ("28.14"). */
  split: string;
  /** cumulative relay time through this leg — free-form ("28.14"). */
  cumulative: string;
  /** exchange / takeoff reaction time. A leading "-" = illegal early
   *  takeoff (automatic DQ) — flagged in red. Blank = not yet exchanged. */
  exchange: string;
}

export interface SwimRelayExchangeCfg extends BaseCfg {
  headerText?: string;
  headerColor?: string;
  bgColor?: string;
  panelColor?: string;
  laneColColor?: string;
  homeColor?: string;
  awayColor?: string;
  textColor?: string;
  eventFilter?: string;
  /** Which lane this relay-exchange board is tracking (display only —
   *  legs are operator-entered, not pulled from a lane row). */
  laneNumber?: number;
  /** Relay team name / school — display-as-typed. */
  teamName?: string;
  legs?: SwimRelayLeg[];
}

const SAMPLE_RELAY_LEGS: SwimRelayLeg[] = [
  { legName: 'LEG 1 — BACK', swimmer: 'D. OKAFOR', split: '27.80', cumulative: '27.80', exchange: '0.18' },
  { legName: 'LEG 2 — BREAST', swimmer: 'M. CHEN', split: '31.42', cumulative: '59.22', exchange: '0.21' },
  { legName: 'LEG 3 — FLY', swimmer: 'T. NGUYEN', split: '28.95', cumulative: '1:28.17', exchange: '-0.04' },
  { legName: 'LEG 4 — FREE', swimmer: 'J. RIVERA', split: '26.60', cumulative: '1:54.77', exchange: '' },
];

function isIllegalExchange(exchange: string): boolean {
  const t = exchange.trim();
  return t.startsWith('-') && t !== '-' && t !== '';
}

export function SwimRelayExchangeWidget({ config }: WidgetProps<SwimRelayExchangeCfg>) {
  const c = config ?? {};
  const state = useGameState();
  const isLive = state != null;
  const stats = (state?.snapshot?.stats ?? {}) as Record<string, unknown>;
  const liveEvents = readResults(stats);
  const event = isLive ? pickEvent(liveEvents, c.eventFilter) : null;

  const bgColor = c.bgColor || '#050b16';
  const panelColor = c.panelColor || '#0c1830';
  const laneColColor = c.laneColColor || '#1e3a8a';
  const homeColor = c.homeColor || '#1e3a8a';
  const awayColor = c.awayColor || '#b91c1c';
  const textColor = c.textColor || '#ffffff';
  const laneNumber = typeof c.laneNumber === 'number' ? c.laneNumber : 3;

  // Legs are always operator-config (there's no live per-leg feed yet) —
  // sample rows only when the operator hasn't entered any AND we're in
  // the builder. On a real screen (isLive) with no operator-typed legs,
  // render blank leg slots instead of SAMPLE_RELAY_LEGS' fabricated
  // swimmer names (S2-1, 2026-07-02 — the same class of bug as the
  // lane grid / dive leaderboard: this widget's SAMPLE was previously
  // "operator hasn't typed legs" regardless of surface, which meant a
  // real, unbound screen showed invented swimmers with zero operator
  // action).
  const hasTypedLegs = Array.isArray(c.legs) && c.legs.length > 0;
  const noLiveData = isLive && !hasTypedLegs;
  const legs: SwimRelayLeg[] = hasTypedLegs
    ? (c.legs as SwimRelayLeg[])
    : isLive
      ? Array.from({ length: 4 }, (_, i) => ({ legName: `LEG ${i + 1}`, swimmer: '', split: '', cumulative: '', exchange: '' }))
      : SAMPLE_RELAY_LEGS;
  const teamName = c.teamName || (isLive ? '' : 'HOME RELAY A');
  const headerText = c.headerText || event?.event || 'RELAY EXCHANGE';

  return (
    <ScaledScene bgColor={bgColor}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 40, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: panelColor, borderRadius: 14, padding: '18px 32px',
            marginBottom: 20, border: `2px solid ${laneColColor}`,
          }}
        >
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 40, fontWeight: 800, color: c.headerColor || '#fbbf24', letterSpacing: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            🏊 {headerText.toUpperCase()}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', flex: 'none', marginLeft: 24 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 10, background: laneColColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 900, color: '#ffffff', marginRight: 16,
            }}>
              {laneNumber}
            </div>
            <span style={{ fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 800, color: textColor, maxWidth: 380, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {teamName || '—'}
            </span>
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px', marginBottom: 8 }}>
          <div style={{ flex: 1, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>LEG / SWIMMER</div>
          <div style={{ width: 200, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>SPLIT</div>
          <div style={{ width: 220, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>CUMULATIVE</div>
          <div style={{ width: 200, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>EXCHANGE</div>
        </div>

        {/* Leg rows */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {legs.slice(0, 4).map((leg, i) => {
            const illegal = isIllegalExchange(leg.exchange || '');
            return (
              <div
                key={`${leg.legName}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', flex: 1, minHeight: 0,
                  background: i % 2 === 0 ? panelColor : 'transparent',
                  borderRadius: 10, marginTop: 4,
                  paddingLeft: 24, paddingRight: 24,
                  border: illegal ? '2px solid #ef4444' : '2px solid transparent',
                }}
              >
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, color: i % 2 === 0 ? homeColor : awayColor, letterSpacing: 1 }}>
                    {(leg.legName || `LEG ${i + 1}`).toUpperCase()}
                  </span>
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 700, color: textColor, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {leg.swimmer || '—'}
                  </span>
                </div>
                <div style={{ width: 200, textAlign: 'right' }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 30, fontWeight: 700, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
                    {leg.split || '—'}
                  </span>
                </div>
                <div style={{ width: 220, textAlign: 'right' }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 30, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
                    {leg.cumulative || '—'}
                  </span>
                </div>
                <div style={{ width: 200, textAlign: 'right' }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 28, fontWeight: 800, color: illegal ? '#ef4444' : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                    {illegal ? `${leg.exchange} DQ` : (leg.exchange || '—')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {noLiveData && <BindGameCallout accent={c.headerColor || '#fbbf24'} />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}

// ════════════════════════════════════════════════════════════════════
// SWIM_SPLITS_PANEL — per-length split table for ONE focused lane/heat
// (report A8): length #, split (subtractive) + cumulative, optional
// pace-vs-record delta row. Same "operator-typed rows" pattern as the
// relay board above — per-length data has no home in ResultEntry.
// ════════════════════════════════════════════════════════════════════

export interface SwimSplitRow {
  /** length number within the race (1, 2, 3, …). */
  length: number;
  /** this length's split (subtractive) — free-form ("28.14"). */
  split: string;
  /** cumulative elapsed time through this length — free-form. */
  cumulative: string;
  /** optional pace vs. record delta for this length — free-form
   *  ("+0.42" behind pace, "-0.10" ahead of pace). Blank = hide the row. */
  paceDelta?: string;
}

export interface SwimSplitsPanelCfg extends BaseCfg {
  headerText?: string;
  headerColor?: string;
  bgColor?: string;
  panelColor?: string;
  accentColor?: string;
  textColor?: string;
  eventFilter?: string;
  /** Swimmer/lane this split panel is focused on — display-as-typed. */
  swimmerName?: string;
  laneNumber?: number;
  /** Show the optional pace-vs-record delta column. */
  showPaceDelta?: boolean;
  splits?: SwimSplitRow[];
}

const SAMPLE_SPLITS: SwimSplitRow[] = [
  { length: 1, split: '25.40', cumulative: '25.40', paceDelta: '-0.12' },
  { length: 2, split: '26.10', cumulative: '51.50', paceDelta: '-0.05' },
  { length: 3, split: '26.55', cumulative: '1:18.05', paceDelta: '+0.08' },
  { length: 4, split: '26.90', cumulative: '1:44.95', paceDelta: '+0.15' },
];

export function SwimSplitsPanelWidget({ config }: WidgetProps<SwimSplitsPanelCfg>) {
  const c = config ?? {};
  const state = useGameState();
  const isLive = state != null;
  const stats = (state?.snapshot?.stats ?? {}) as Record<string, unknown>;
  const liveEvents = readResults(stats);
  const event = isLive ? pickEvent(liveEvents, c.eventFilter) : null;

  const bgColor = c.bgColor || '#050b16';
  const panelColor = c.panelColor || '#0c1830';
  const accentColor = c.accentColor || '#38bdf8';
  const textColor = c.textColor || '#ffffff';
  const showPaceDelta = c.showPaceDelta !== false;
  const laneNumber = typeof c.laneNumber === 'number' ? c.laneNumber : undefined;

  // Same S2-1 fix as the relay board above: SAMPLE_SPLITS is invented
  // race data — only show it in the builder. A real, unbound screen
  // gets blank length rows instead.
  const hasTypedSplits = Array.isArray(c.splits) && c.splits.length > 0;
  const noLiveData = isLive && !hasTypedSplits;
  const splits: SwimSplitRow[] = hasTypedSplits
    ? (c.splits as SwimSplitRow[])
    : isLive
      ? Array.from({ length: 4 }, (_, i) => ({ length: i + 1, split: '', cumulative: '' }))
      : SAMPLE_SPLITS;
  const swimmerName = c.swimmerName || (isLive ? '' : 'D. OKAFOR');
  const headerText = c.headerText || event?.event || 'SPLIT TIMES';

  return (
    <ScaledScene bgColor={bgColor}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 40, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: panelColor, borderRadius: 14, padding: '18px 32px',
            marginBottom: 20, border: `2px solid ${accentColor}`,
          }}
        >
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 40, fontWeight: 800, color: c.headerColor || '#fbbf24', letterSpacing: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            🏊 {headerText.toUpperCase()}
          </span>
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 800, color: textColor, flex: 'none', marginLeft: 24 }}>
            {laneNumber ? `LANE ${laneNumber} — ` : ''}{(swimmerName || '—').toUpperCase()}
          </span>
        </div>

        {/* Column headers */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px', marginBottom: 8 }}>
          <div style={{ width: 140, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>LENGTH</div>
          <div style={{ flex: 1, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>SPLIT</div>
          <div style={{ width: 260, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>CUMULATIVE</div>
          {showPaceDelta && (
            <div style={{ width: 220, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2, textAlign: 'right' }}>VS. PACE</div>
          )}
        </div>

        {/* Length rows */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {splits.map((row, i) => {
            const delta = (row.paceDelta || '').trim();
            const ahead = delta.startsWith('-');
            const behind = delta.startsWith('+');
            return (
              <div
                key={`${row.length}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', flex: 1, minHeight: 0,
                  background: i % 2 === 0 ? panelColor : 'transparent',
                  borderRadius: 10, marginTop: 4, paddingLeft: 24, paddingRight: 24,
                }}
              >
                <div style={{ width: 140 }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: 10, background: accentColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: 900, color: '#04121f',
                  }}>
                    {row.length}
                  </div>
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 32, fontWeight: 700, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
                    {row.split || '—'}
                  </span>
                </div>
                <div style={{ width: 260, textAlign: 'right' }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 32, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
                    {row.cumulative || '—'}
                  </span>
                </div>
                {showPaceDelta && (
                  <div style={{ width: 220, textAlign: 'right' }}>
                    <span style={{
                      fontFamily: MONO_FONT, fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                      color: delta ? (ahead ? '#22c55e' : behind ? '#ef4444' : textColor) : '#475569',
                    }}>
                      {delta || '—'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {noLiveData && <BindGameCallout accent={c.headerColor || '#fbbf24'} />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}

// ════════════════════════════════════════════════════════════════════
// SWIM_RECORD_LINE — record/pace reference bar (report A3/A8): record
// type (WR/AR/NR/pool/meet), record time + holder, live on/off-pace
// delta, and a "RECORD" flash state when the live/finish time beats the
// reference. A slim bar widget (not a full scene grid) meant to sit
// above/below a SWIM_LANE_GRID or SWIM_SPLITS_PANEL on the same board.
// ════════════════════════════════════════════════════════════════════

export interface SwimRecordLineCfg extends BaseCfg {
  /** WR / AR / NR / US OPEN / POOL / MEET — display-as-typed label. */
  recordType?: string;
  recordTime?: string;
  recordHolder?: string;
  /** Current live/finish time being compared to the record — blank =
   *  hide the delta and just show the reference line. */
  liveTime?: string;
  /** Live on/off-pace delta — free-form ("-0.22" ahead, "+0.35" behind). */
  liveDelta?: string;
  /** Flip on when the record has been broken — flashes a RECORD badge. */
  recordBroken?: boolean;
  bgColor?: string;
  panelColor?: string;
  accentColor?: string;
  textColor?: string;
  recordBrokenColor?: string;
}

/**
 * nofake-sweep (2026-07-03, docs/research/2026-07-02-sports-deep-pass/
 * 06-OVERNIGHT-REVIEW.md P1): this is the one widget in the file that
 * never called useGameState() — every sibling (SwimLaneGridWidget,
 * DiveLeaderboardWidget, SwimRelayExchangeWidget, SwimSplitsPanelWidget,
 * DiveJudgesPanelWidget) does. The record/holder fields ARE intentionally
 * operator-typed free-form text (no live producer — same design as
 * SwimRelayExchangeWidget's legs, per commit 43beb7ce's own doc comment),
 * but that's a config-shape decision, not a render-surface exemption:
 * SwimRelayExchangeWidget is built the identical way and still gates its
 * SAMPLE_RELAY_LEGS on isLive. This widget's hardcoded '48.42' /
 * 'D. OKAFOR, 2024' defaults were shown unconditionally, including on a
 * real player surface with nothing typed in — gate them the same way.
 */
export function SwimRecordLineWidget({ config }: WidgetProps<SwimRecordLineCfg>) {
  const c = config ?? {};
  const state = useGameState();
  const isLive = state != null;
  const bgColor = c.bgColor || 'transparent';
  const panelColor = c.panelColor || '#0c1830';
  const accentColor = c.accentColor || '#fbbf24';
  const textColor = c.textColor || '#ffffff';
  const recordBrokenColor = c.recordBrokenColor || '#22c55e';

  const hasTypedRecord = !!(c.recordTime || c.recordHolder);
  const noLiveData = isLive && !hasTypedRecord;
  const recordType = (c.recordType || (noLiveData ? '' : 'POOL RECORD')).toUpperCase();
  const recordTime = c.recordTime || (noLiveData ? '—' : '48.42');
  const recordHolder = c.recordHolder || (noLiveData ? '' : 'D. OKAFOR, 2024');
  const liveTime = c.liveTime ?? '';
  const liveDelta = (c.liveDelta || '').trim();
  const ahead = liveDelta.startsWith('-');
  const behind = liveDelta.startsWith('+');
  const broken = !!c.recordBroken;

  return (
    <ScaledScene bgColor={bgColor}>
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          display: 'flex', alignItems: 'center', padding: '0 48px',
        }}
      >
        <div
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: broken ? `${recordBrokenColor}33` : panelColor,
            border: `3px solid ${broken ? recordBrokenColor : accentColor}`,
            borderRadius: 18, padding: '22px 40px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{
              fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 900, letterSpacing: 2,
              color: broken ? recordBrokenColor : accentColor, marginRight: 24,
            }}>
              🏆 {recordType}
            </span>
            <span style={{ fontFamily: MONO_FONT, fontSize: 46, fontWeight: 800, color: textColor, fontVariantNumeric: 'tabular-nums', marginRight: 24 }}>
              {recordTime}
            </span>
            <span style={{ fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 700, color: '#94a3b8' }}>
              {recordHolder}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {broken ? (
              <span style={{
                fontFamily: DISPLAY_FONT, fontSize: 34, fontWeight: 900, letterSpacing: 2,
                color: '#04120a', background: recordBrokenColor, borderRadius: 12, padding: '10px 24px',
              }}>
                RECORD!
              </span>
            ) : (
              <>
                {liveTime && (
                  <span style={{ fontFamily: MONO_FONT, fontSize: 40, fontWeight: 800, color: textColor, fontVariantNumeric: 'tabular-nums', marginRight: 20 }}>
                    {liveTime}
                  </span>
                )}
                {liveDelta && (
                  <span style={{
                    fontFamily: MONO_FONT, fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    color: ahead ? '#22c55e' : behind ? '#ef4444' : textColor,
                  }}>
                    {ahead ? '▼' : behind ? '▲' : ''} {liveDelta} {ahead ? 'AHEAD' : behind ? 'BEHIND' : 'PACE'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}

// ════════════════════════════════════════════════════════════════════
// DIVE_JUDGES_PANEL — the row of judge scores for the CURRENT dive
// (report B4/B5): 3/5/7 judges, dropped high/low greyed out, dive code +
// Degree of Difficulty (DD), computed dive score (sum of kept × DD).
// Reads the SAME scalar Game.stats keys SituationalRow's diving branch
// already reads (currentDiver / diveCode / dd — sports-situational.tsx)
// plus a new `judgeScores` number array, so this widget and the
// broadcast strip never disagree about whose dive is on the board.
// ════════════════════════════════════════════════════════════════════

/** Drop-high/drop-low rule by panel size (report B2):
 *  3 judges → keep all 3 (no drops); 5 → drop 1 high + 1 low, sum
 *  middle 3; 7 → drop 2 high + 2 low, sum middle 3. Any other panel
 *  size (operator typo) falls back to "keep all" rather than guessing.
 *  Exported (S3-1, 2026-07-03 sports deep-pass Wave S3) so the console's
 *  diving judge pad (sports/[gameId]/page.tsx) computes the SAME award
 *  the board will render — one function, not a second copy that could
 *  drift from this one. */
export function keptIndices(scores: number[]): Set<number> {
  const n = scores.length;
  const indexed = scores.map((v, i) => ({ v, i }));
  const sorted = [...indexed].sort((a, b) => a.v - b.v);
  let dropLo = 0;
  let dropHi = 0;
  if (n === 5) { dropLo = 1; dropHi = 1; }
  else if (n === 7) { dropLo = 2; dropHi = 2; }
  // n === 3 (or any other size) → no drops.
  const dropped = new Set<number>();
  for (let k = 0; k < dropLo; k++) dropped.add(sorted[k].i);
  for (let k = 0; k < dropHi; k++) dropped.add(sorted[n - 1 - k].i);
  const kept = new Set<number>();
  for (let i = 0; i < n; i++) if (!dropped.has(i)) kept.add(i);
  return kept;
}

/** Dive score = sum of kept judge scores × DD (report B2). Returns null
 *  when there aren't enough valid inputs to compute a real number.
 *  Exported for the same reason as {@link keptIndices} — S3-1's console
 *  judge pad reuses this exact math for the "Award" computation. */
export function computeDiveScore(scores: number[], dd: number): number | null {
  if (scores.length === 0 || !Number.isFinite(dd) || dd <= 0) return null;
  const kept = keptIndices(scores);
  let sum = 0;
  kept.forEach((i) => { sum += scores[i]; });
  return Math.round(sum * dd * 10) / 10;
}

export interface DiveJudgesPanelCfg extends BaseCfg {
  headerColor?: string;
  bgColor?: string;
  panelColor?: string;
  accentColor?: string;
  textColor?: string;
  droppedColor?: string;
  /** Sample/override diver + dive info — live surfaces read
   *  stats.currentDiver / stats.diveCode / stats.dd / stats.judgeScores
   *  instead, matching SituationalRow's diving branch. */
  diverName?: string;
  diveCode?: string;
  diveGroup?: string;
  dd?: number;
  judgeScores?: number[];
}

const SAMPLE_JUDGE_SCORES = [7, 7.5, 8, 7.5, 8];

export function DiveJudgesPanelWidget({ config }: WidgetProps<DiveJudgesPanelCfg>) {
  const c = config ?? {};
  const state = useGameState();
  const isLive = state != null;
  // Distinct from `noLiveData` below ("a dive isn't happening right
  // now") — this is "no game has EVER been bound to this widget"
  // (real screen, GameStateProvider mounted, but the phantom-unbound
  // state or a fresh provider with no snapshot yet). S2-1, 2026-07-02.
  const noGameBound = isLive && !state?.snapshot;
  const stats = (state?.snapshot?.stats ?? {}) as Record<string, unknown>;

  const bgColor = c.bgColor || '#0a0714';
  const panelColor = c.panelColor || '#160f28';
  const accentColor = c.accentColor || '#a78bfa';
  const textColor = c.textColor || '#ffffff';
  const droppedColor = c.droppedColor || '#4b3f66';

  // Live surfaces read the scalar Game.stats keys the console's diving
  // panel writes (same keys SituationalRow's diving branch reads); no
  // live data yet → an empty shell (no fabricated diver), matching the
  // no-fake-data rule the rest of this file follows. Off-live (builder
  // tile / no GameStateProvider) → config override, else sample dive.
  const liveDiver = String(stats.currentDiver || '').trim();
  const liveCode = String(stats.diveCode || '').trim();
  const liveDd = Number(stats.dd);
  const liveScoresRaw = stats.judgeScores;
  const liveScores = Array.isArray(liveScoresRaw)
    ? liveScoresRaw.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];

  const noLiveData = isLive && !liveDiver && liveScores.length === 0;

  const diverName = isLive ? liveDiver : (c.diverName ?? 'A. WASHINGTON');
  const diveCode = isLive ? liveCode : (c.diveCode ?? '305C');
  // S3-3 (2026-07-03, P0-3 follow-up): `diveGroup` (the dive's plain-
  // English name, e.g. "Reverse 1½ Somersault Tuck") has no live scalar
  // producer — it's not one of the console's stats.currentDiver/diveCode/
  // dd/judgeScores keys, so there's nothing to READ live, only an
  // operator-typed PropertiesPanel override to fall back to. Before this
  // fix the fabricated sample string rendered unconditionally regardless
  // of surface — a real, bound meet with no diveGroup configured showed
  // an invented dive name to the crowd. Same no-fake-data rule as
  // diverName/diveCode/dd above: on a live surface, an operator override
  // is real data and renders; the SAMPLE string only shows in the
  // builder/preview (matching the file's SampleWatermark contract).
  const diveGroup = isLive ? (c.diveGroup?.trim() || '') : (c.diveGroup ?? 'REVERSE 1½ SOMERSAULT TUCK');
  const dd = isLive ? (Number.isFinite(liveDd) ? liveDd : 0) : (c.dd ?? 2.7);
  const scores: number[] = isLive
    ? liveScores
    : (Array.isArray(c.judgeScores) && c.judgeScores.length > 0 ? c.judgeScores : SAMPLE_JUDGE_SCORES);

  const kept = keptIndices(scores);
  const diveScore = computeDiveScore(scores, dd);
  const panelSize = scores.length;

  return (
    <ScaledScene bgColor={bgColor}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 40, display: 'flex', flexDirection: 'column' }}>
        {/* Header — diver + dive info */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: panelColor, borderRadius: 14, padding: '18px 32px',
            marginBottom: 24, border: `2px solid ${accentColor}`,
          }}
        >
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 40, fontWeight: 800, color: c.headerColor || '#fbbf24', letterSpacing: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            🤿 {noLiveData ? 'WARM-UPS' : (diverName || '—').toUpperCase()}
          </span>
          {!noLiveData && (
            <span style={{ fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 700, color: '#94a3b8', letterSpacing: 2, flex: 'none', marginLeft: 24, textAlign: 'right' }}>
              {diveCode ? diveCode.toUpperCase() : '—'}{dd ? ` · DD ${dd.toFixed(1)}` : ''}
            </span>
          )}
        </div>

        {noLiveData ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 700, color: '#475569',
          }}>
            NO DIVE IN PROGRESS
          </div>
        ) : (
          <>
            {diveGroup && (
              <div style={{ fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, marginBottom: 20, textAlign: 'center' }}>
                {diveGroup.toUpperCase()}
              </div>
            )}

            {/* Judge score chips */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {scores.map((score, i) => {
                const isKept = kept.has(i);
                return (
                  <div
                    key={i}
                    style={{
                      width: 130, height: 150, borderRadius: 18, marginLeft: i === 0 ? 0 : 20,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      background: isKept ? panelColor : 'transparent',
                      border: `3px solid ${isKept ? accentColor : droppedColor}`,
                      opacity: isKept ? 1 : 0.5,
                    }}
                  >
                    <span style={{ fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: 700, color: '#64748b', letterSpacing: 1, marginBottom: 8 }}>
                      J{i + 1}
                    </span>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 44, fontWeight: 800, color: isKept ? textColor : '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                      {score.toFixed(1)}
                    </span>
                    {!isKept && (
                      <span style={{ fontFamily: DISPLAY_FONT, fontSize: 13, fontWeight: 800, color: '#f59e0b', letterSpacing: 1, marginTop: 6 }}>
                        DROPPED
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Panel size + computed dive score */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
              <span style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>
                {panelSize}-JUDGE PANEL
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span style={{ fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: 700, color: '#94a3b8', letterSpacing: 2, marginRight: 16 }}>
                  DIVE SCORE
                </span>
                <span style={{ fontFamily: MONO_FONT, fontSize: 56, fontWeight: 900, color: accentColor, fontVariantNumeric: 'tabular-nums' }}>
                  {diveScore !== null ? diveScore.toFixed(1) : '—'}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      {noGameBound && <BindGameCallout accent={c.headerColor || '#fbbf24'} />}
      {!isLive && <SampleWatermark />}
    </ScaledScene>
  );
}
