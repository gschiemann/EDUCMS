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
 *  scales a fixed 1920×1080 scene to fit (letterboxed, never distorted). */
function ScaledScene({
  bgColor,
  children,
}: {
  bgColor: string;
  children: React.ReactNode;
}) {
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

  return (
    <ScaledScene bgColor={bgColor}>
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
            🏊 {headerText.toUpperCase()}
          </span>
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 26, fontWeight: 700, color: '#94a3b8', letterSpacing: 3, flex: 'none', marginLeft: 24 }}>
            {orderMode === 'place' ? 'RESULTS' : 'LANE ORDER'}
          </span>
        </div>

        {/* Column headers */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px', marginBottom: 8 }}>
          <div style={{ width: 110, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>LANE</div>
          <div style={{ flex: 1, fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 700, color: '#64748b', letterSpacing: 2 }}>SWIMMER / TEAM</div>
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
    </ScaledScene>
  );
}
