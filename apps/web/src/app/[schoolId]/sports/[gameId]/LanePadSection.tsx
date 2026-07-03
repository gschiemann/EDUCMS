'use client';

/**
 * LanePadSection — the meet LANE PAD (task #271, 2026-07-01 launch sprint
 * Day 2). Replaces the generic free-text `MeetResultsSection` grid for
 * LANE sports (swimming, the legacy combined swimming_diving, and
 * track_and_field) with a pre-filled 8-lane grid built for real-meet
 * entry speed: [Lane#] [Name] [Time/Mark] [computed Place] [DQ|SCR chips],
 * roster auto-fill, auto-computed place, and one-tap heat advance.
 *
 * Diving, golf, cross_country, gymnastics, competitive_cheer keep the
 * original `MeetResultsSection` list editor — they aren't lane sports
 * (diving is one-at-a-time off a board; the others have no lane concept
 * at all). See `isLaneMeetSport` — the SAME predicate the mount site in
 * `page.tsx` uses to pick this component over `MeetResultsSection`, so
 * there is exactly one place that decides "is this a lane sport."
 *
 * Every write goes through the EXISTING `ctl.stats.mutate({ stats: {...} })`
 * path — same mutation `MeetResultsSection` and every other console control
 * already use (PATCH /sports/games/:id/stats, merged server-side, validated
 * by `sanitizeResults`). No new endpoint, no schema change.
 *
 * Mobile-first (CLAUDE.md mobile-perf standard): no new pollers (roster
 * comes from the existing `useGameRoster` query, already shared with
 * <RosterPanel> via the React Query cache), no backdrop-blur, thumb-sized
 * (44px+) tap targets on every control.
 *
 * ── S1-2/S1-3 (2026-07-02 sports deep-pass audit, findings P1-4/P1-5) ──
 *
 * P1-4 — "wall board shows NOTHING mid-heat": every lane row lived in
 * local React state; only `nextHeat()` ever wrote `stats.results`, so the
 * natatorium board sat ONE HEAT BEHIND for the entire duration of manual
 * entry (the common case — CTS auto-timing is the only live path). Fix:
 * a debounced (~800ms after the last mark/name edit) PROVISIONAL commit of
 * the current grid, written under the SAME event label `nextHeat()` would
 * use. Because `mergeHeatResult` already dedupes by exact `event ===`
 * match, each debounce tick just REPLACES the prior provisional row in
 * place, and `nextHeat()`'s final save (same label) naturally supersedes
 * it — no separate "provisional" flag, no `sanitizeResults` schema change
 * (it reconstructs each `MeetResult` field-by-field and drops unknown top-
 * level keys, so a bolted-on `provisional: true` would be silently
 * stripped on persist — confirmed by reading the sanitizer). The board's
 * `SwimLaneGridWidget` already renders whatever `stats.results` holds with
 * no provisional-vs-final distinction, so this needs zero widget changes.
 *
 * P1-5 — Undo used to revert `stats.results` but never restored the local
 * `rows` grid `nextHeat()` had already cleared — a correction ("wait, lane
 * 4 was actually DQ") meant retyping the whole just-saved heat by hand.
 * Fix: `lastSaved` now also snapshots `rows` immediately before the clear;
 * `undoLastSave()` restores BOTH `stats.results` and the local grid.
 *
 * ── #292 (2026-07-02 overnight adversarial review, P1) ──────────────────
 *
 * The provisional publish above and `nextHeat()`'s finalize save are two
 * independent, unserialized `ctl.stats.mutate` calls against the SAME
 * `PATCH /sports/games/:id/stats` endpoint, which does a WHOLE-ARRAY
 * replace of `stats.results` server-side (not an element merge). If the
 * network reorders so the provisional's write reaches the server AFTER
 * the finalize's, the finalized heat's marks/DQ/SCR are silently
 * overwritten by the stale provisional snapshot — `cancelProvisionalTimer()`
 * only cancels a timer that hasn't fired YET; it cannot un-send a request
 * the timer already dispatched moments earlier.
 *
 * Fix: `pendingProvisional` captures the in-flight provisional PATCH's
 * PROMISE (via `ctl.stats.mutateAsync`, called at the exact moment the
 * debounce fires) in a ref. Every finalize/revert path (`nextHeat()`,
 * `undoLastSave()`) now does, in order: (1) `cancelProvisionalTimer()` —
 * stop a not-yet-fired timer from ever starting a new request, (2)
 * `await` whatever provisional PATCH is already in flight (swallowing its
 * error — a failed provisional is not this path's problem to surface),
 * THEN (3) dispatch the finalize/undo PATCH. Because step 2 blocks until
 * the server has actually applied the provisional, the finalize request
 * physically cannot be sent before the provisional's — no wire reorder is
 * possible, with no new endpoint, no flag, no schema change.
 *
 * One subtlety: `stats`/`savedResults` at the top of this component are
 * derived from the `g` PROP, which is a render-time snapshot — awaiting
 * the provisional promise does NOT itself cause this component to
 * re-render with fresh props. But `useGameControl`'s `stats` mutation
 * (use-api.ts) already writes the confirmed server response into the
 * React Query cache via its `onSuccess: writeBack` — synchronously, before
 * the `mutateAsync` promise the drain awaits actually resolves. So
 * `nextHeat()` re-reads the baseline via `qc.getQueryData(gameKey)`
 * (same `['sports-game', gameId]` key `useGame`/`useGameControl` use)
 * immediately after the drain, rather than trusting the stale `stats`
 * closure — that guarantees the finalize save merges onto the
 * provisional's own result, not a snapshot from before it landed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, ChevronRight, Undo2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGameControl, useGameRoster, type RosterPlayer } from '@/hooks/use-api';
import { sanitizeResults, type MeetResult, type SportDefinition } from '@cms/api-types';
import {
  DEFAULT_LANE_COUNT,
  MAX_LANE_COUNT,
  MIN_LANE_COUNT,
  applyRosterToLanes,
  buildHeatResult,
  computePlaces,
  formatLaneEventLabel,
  makeLaneRows,
  mergeHeatResult,
  type LaneRow,
  type LaneRosterEntry,
} from './lane-pad';

/** Read + validate `stats.results` the SAME way the API's `updateStats`
 *  gate does (`sanitizeResults`), so this component works from the exact
 *  bounded `MeetResult[]` shape it will write back — no separate reader
 *  type (`sports-situational.tsx`'s `readResults`) that could drift from
 *  what actually persists. */
function readSavedResults(stats: Record<string, unknown>): MeetResult[] {
  return sanitizeResults(stats.results);
}

/** Lane sports — the same set `page.tsx` uses to pick this component over
 *  `MeetResultsSection`. Diving is EXCLUDED (judged, one-at-a-time, no
 *  lanes) even though it shares the LEADERBOARD mode + judged-results
 *  grid with gymnastics/cheer. Kept in one place so board / console / any
 *  future surface never disagree about "is this a lane sport." */
export function isLaneMeetSport(sportKey: string): boolean {
  return sportKey === 'swimming' || sportKey === 'swimming_diving' || sportKey === 'track_and_field';
}

function rosterToLaneEntries(roster: RosterPlayer[]): LaneRosterEntry[] {
  return roster.map((p) => {
    const laneRaw = p.stats?.lane;
    const lane = typeof laneRaw === 'string' ? parseInt(laneRaw, 10) : Number(laneRaw);
    return {
      name: p.name,
      team: p.team === 'home' || p.team === 'away' ? p.team : null,
      lane: Number.isFinite(lane) ? lane : null,
    };
  });
}

/** The subset of the Game record this component actually reads — kept
 *  narrow (rather than importing the console's full `any`-typed `g`
 *  convention) so a typo in a field name this component doesn't use can't
 *  silently type-check. */
interface LanePadGame {
  stats?: Record<string, unknown> | null;
  homeTeam?: string;
  awayTeam?: string;
}

export function LanePadSection({
  gameId,
  g,
  def,
  ctl,
}: {
  gameId: string;
  g: LanePadGame;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const stats: Record<string, unknown> = g.stats || {};
  const savedResults = readSavedResults(stats);

  // #292 — same query key `useGame`/`useGameControl` (use-api.ts) use for
  // this game. Read directly from the cache (never written here — only
  // read) so `nextHeat()` can re-baseline onto the provisional's own
  // server-confirmed write after draining it, instead of the stale `g`
  // prop this render closed over. See the #292 comment block above.
  const qc = useQueryClient();
  const gameKey = ['sports-game', gameId];

  // Roster join — same convention as the CTS ingest (SwimRosterEntry /
  // RosterPlayer.stats.lane), shared React Query cache with <RosterPanel>
  // so mounting this never fires an extra fetch.
  const { data: rosterData } = useGameRoster(gameId);
  const rosterEntries = useMemo(() => {
    const roster: RosterPlayer[] = Array.isArray(rosterData) ? rosterData : [];
    return rosterToLaneEntries(roster);
  }, [rosterData]);

  // Track & field has no `heat` scalar stat (only swimming does) — the
  // event header degrades to event-only, matching `GameScopeStatEditor`'s
  // per-sport stat list (packages/api-types/src/sports.ts).
  const hasHeatField = def.stats.some((s) => s.key === 'heat');

  const currentEvent = String(stats.currentEvent ?? '');
  const heat = String(stats.heat ?? '');

  const [laneCount, setLaneCount] = useState(DEFAULT_LANE_COUNT);
  const [rows, setRows] = useState<LaneRow[]>(() => makeLaneRows(DEFAULT_LANE_COUNT));
  const [eventText, setEventText] = useState(currentEvent);
  const [heatText, setHeatText] = useState(heat);
  // S1-3 (P1-5): `prevRows` snapshots the grid AS TYPED, immediately before
  // `nextHeat()` clears it — `undoLastSave()` restores this alongside
  // `stats.results`, so Undo brings back the actual typed times, not just
  // a blank re-rolled-from-roster grid.
  const [lastSaved, setLastSaved] = useState<{
    event: string;
    prevResults: typeof savedResults;
    prevRows: LaneRow[];
  } | null>(null);

  // Auto-fill roster names into blank lanes once the roster arrives (or the
  // grid is resized) — never clobbers a name the operator already typed.
  // Adjusted DURING RENDER via a state-tracked "last applied roster" key
  // (React's documented pattern for "derive state from a prop change" —
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-
  // state-when-a-prop-changes) rather than a useEffect: calling setState
  // synchronously inside an effect body forces an extra commit+paint before
  // the fill appears, and refs can't be read during render (React 19 lint).
  // A plain useState guard bails out in the SAME render pass instead.
  const [appliedRosterKey, setAppliedRosterKey] = useState<string | null>(null);
  const rosterKey = `${rosterEntries.length}:${laneCount}:${rosterEntries.map((r) => `${r.lane}=${r.name}`).join(',')}`;
  if (rosterEntries.length > 0 && appliedRosterKey !== rosterKey) {
    setAppliedRosterKey(rosterKey);
    const filled = applyRosterToLanes(rows, rosterEntries);
    if (filled.some((r, i) => r.name !== rows[i]?.name)) {
      setRows(filled);
    }
  }

  const placedRows = useMemo(() => computePlaces(rows), [rows]);

  // ── S1-2 (P1-4): debounced provisional mid-heat publish ────────────
  // `savedResults` is re-derived fresh from `g.stats` every render (via
  // `readSavedResults` at the top of this component) — a "latest" ref
  // lets the debounce callback merge against the current server baseline
  // WITHOUT depending on it in the effect below. Depending on it directly
  // would retrigger the effect every time the provisional write's own
  // `writeBack` lands (S1-1) and changes `g.stats.results`, resetting the
  // debounce and firing an identical write again 800ms later — an
  // infinite idle ping-pong of redundant PATCHes.
  const savedResultsRef = useRef(savedResults);
  savedResultsRef.current = savedResults;
  // Cleared by `nextHeat()`/`undoLastSave()` so a debounce timer scheduled
  // against the JUST-CLEARED heat can never land after the grid has
  // already reset to a fresh (blank) next heat or been undone.
  const provisionalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelProvisionalTimer = () => {
    if (provisionalTimer.current) {
      clearTimeout(provisionalTimer.current);
      provisionalTimer.current = null;
    }
  };
  // #292 — the in-flight provisional PATCH's own promise, captured the
  // instant the debounce fires (mutateAsync, not mutate — mutate discards
  // the promise, which is exactly what let the race happen). Any finalize
  // or revert path awaits this BEFORE sending its own PATCH, guaranteeing
  // the provisional's write reaches the server first. Never rejects visibly
  // to a waiter — a failed provisional is caught at its own dispatch site.
  const pendingProvisional = useRef<Promise<unknown> | null>(null);
  /** Cancel any not-yet-fired timer, then wait out whatever provisional
   *  PATCH is already in flight. Call this before EVERY finalize/revert
   *  PATCH (`nextHeat()`, `undoLastSave()`) — see the #292 comment above
   *  the component for why both steps are required. */
  const drainProvisional = async () => {
    cancelProvisionalTimer();
    if (pendingProvisional.current) {
      try {
        await pendingProvisional.current;
      } catch {
        // A failed provisional write is not this caller's problem — the
        // finalize/undo PATCH below is about to establish the true state
        // regardless of whether the provisional succeeded.
      }
    }
  };
  useEffect(() => {
    cancelProvisionalTimer();
    provisionalTimer.current = setTimeout(() => {
      provisionalTimer.current = null;
      const provisional = buildHeatResult(eventText, hasHeatField ? heatText : '', rows, Date.now());
      // Nothing typed yet (blank/freshly-reset grid) — no-op, exactly like
      // `nextHeat()`'s own empty-entries guard. Never write junk history.
      if (provisional.entries.length === 0) return;
      const merged = mergeHeatResult(savedResultsRef.current, provisional);
      // mutateAsync (not mutate) so `drainProvisional()` has a promise to
      // await — see the #292 comment above the component. Swallow the
      // rejection here too so an unawaited provisional failure never
      // surfaces as an unhandled rejection.
      const inFlight = ctl.stats.mutateAsync({ stats: { results: merged } }).catch(() => {});
      pendingProvisional.current = inFlight;
      inFlight.finally(() => {
        // Only clear if nobody replaced it with a NEWER provisional while
        // this one was in flight.
        if (pendingProvisional.current === inFlight) pendingProvisional.current = null;
      });
      // No local `lastSaved` bookkeeping here — Undo is scoped to the
      // OPERATOR-INITIATED "Next heat" save (a provisional mid-heat
      // publish auto-corrects itself on the very next keystroke or gets
      // superseded outright by the real Next-heat save under the same
      // event label; there's nothing distinct for Undo to revert to).
    }, 800);
    return cancelProvisionalTimer;
    // savedResultsRef (not savedResults) is the intentional read here —
    // see the comment above this effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, eventText, heatText, hasHeatField, ctl.stats]);

  const updateRow = (lane: number, patch: Partial<LaneRow>) => {
    setRows((prev) => prev.map((r) => (r.lane === lane ? { ...r, ...patch } : r)));
  };

  const resize = (delta: number) => {
    const next = Math.max(MIN_LANE_COUNT, Math.min(MAX_LANE_COUNT, laneCount + delta));
    if (next === laneCount) return;
    setLaneCount(next);
    setRows((prev) => {
      if (next > prev.length) {
        const extra = Array.from({ length: next - prev.length }, (_, i) => ({
          lane: prev.length + i + 1,
          name: '',
          mark: '',
        }));
        return [...prev, ...extra];
      }
      return prev.slice(0, next);
    });
  };

  const commitEventHeader = () => {
    const patch: Record<string, unknown> = {};
    if (eventText.trim() !== currentEvent) patch.currentEvent = eventText.trim();
    if (hasHeatField && heatText.trim() !== heat) patch.heat = heatText.trim();
    if (Object.keys(patch).length > 0) ctl.stats.mutate({ stats: patch });
  };

  const nextHeat = async () => {
    // #292 — cancel any pending provisional debounce BEFORE building the
    // final result (a timer scheduled a moment ago against THIS heat's
    // rows must never fire after the grid resets below), THEN wait out
    // whatever provisional PATCH the timer already dispatched. Only once
    // the server has applied that provisional write can the finalize PATCH
    // be sent — otherwise a wire reorder could let the provisional's stale
    // snapshot land AFTER (and clobber) this finalize save.
    await drainProvisional();
    const fresh = buildHeatResult(eventText, hasHeatField ? heatText : '', rows, Date.now());
    if (fresh.entries.length === 0) return; // nothing to save — no-op, avoid junk history rows
    // Re-read the latest server-confirmed results straight from the React
    // Query cache AFTER draining — the just-applied provisional (if any)
    // already landed there via `writeBack` (use-api.ts), but this
    // component's OWN `g`/`stats` props are a render-time snapshot that
    // won't reflect it until the parent re-renders. Falls back to the
    // prop-derived `savedResults` if the cache entry is ever missing
    // (e.g. under a test harness that never seeded it).
    const cachedGame = qc.getQueryData<{ stats?: Record<string, unknown> } | undefined>(gameKey);
    const baseline = cachedGame?.stats ? readSavedResults(cachedGame.stats) : savedResults;
    const merged = mergeHeatResult(baseline, fresh);

    // Snapshot for the one-tap Undo affordance below (client-side only —
    // reverts stats.results to what it was before this save, same
    // ctl.stats.mutate path, no new endpoint). S1-3: also snapshots the
    // TYPED rows (not just the persisted result) so Undo restores the
    // actual grid the operator had, not a blank re-roll.
    setLastSaved({ event: fresh.event, prevResults: baseline, prevRows: rows });

    const patch: Record<string, unknown> = { results: merged };
    // Advance the heat number automatically when it's a plain integer —
    // the operator's most common next action after "Next heat" is typing
    // the next heat number anyway; auto-incrementing removes a tap. Event
    // text is left untouched (heats within the same event are the common
    // case; the operator edits the event field directly when it changes).
    if (hasHeatField) {
      const heatNum = parseInt(heatText.trim(), 10);
      patch.heat = Number.isFinite(heatNum) && heatNum > 0 ? String(heatNum + 1) : heatText.trim();
    }
    ctl.stats.mutate({ stats: patch });
    if (hasHeatField) {
      const heatNum = parseInt(heatText.trim(), 10);
      setHeatText(Number.isFinite(heatNum) && heatNum > 0 ? String(heatNum + 1) : heatText);
    }

    // Fresh grid for the next heat, re-seeded from roster (a new heat
    // usually means new swimmers/lane assignments).
    setRows(applyRosterToLanes(makeLaneRows(laneCount), rosterEntries));
  };

  const undoLastSave = async () => {
    if (!lastSaved) return;
    // S1-3 (P1-5) / #292: a pending provisional debounce (armed the instant
    // the fresh next-heat grid picked up any roster auto-fill / a stray
    // edit) must not resurrect the just-undone save moments later — same
    // drain-before-write discipline as `nextHeat()`.
    await drainProvisional();
    ctl.stats.mutate({ stats: { results: lastSaved.prevResults } });
    setRows(lastSaved.prevRows);
    setLastSaved(null);
  };

  const headerLabel = formatLaneEventLabel(eventText, hasHeatField ? heatText : '');
  const anyEntries = rows.some((r) => r.name.trim() || r.mark.trim() || r.dq || r.scr);

  return (
    <div className="bg-slate-950 border-t border-slate-800 px-3 py-4 sm:px-4">
      <div className="max-w-4xl mx-auto">
        {/* Event / heat header — writes the existing currentEvent/heat
            scalar stats (GameScopeStatEditor owns the SAME keys elsewhere
            in the console; this header is the fast-path during a heat). */}
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-white">
              Meet lane pad
            </h3>
            <p className="text-[11px] text-slate-400">
              {headerLabel} — auto-place from fastest time. Type a mark, tab to the next lane.
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => resize(-1)}
              disabled={laneCount <= MIN_LANE_COUNT}
              aria-label="Remove a lane"
              className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-300 flex items-center justify-center disabled:opacity-30 active:bg-slate-700 hover:bg-slate-800"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-16 text-center text-xs font-black text-slate-300 tabular-nums">
              {laneCount} lanes
            </span>
            <button
              type="button"
              onClick={() => resize(1)}
              disabled={laneCount >= MAX_LANE_COUNT}
              aria-label="Add a lane"
              className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-300 flex items-center justify-center disabled:opacity-30 active:bg-slate-700 hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase mb-0.5">Event</span>
            <input
              type="text"
              value={eventText}
              onChange={(e) => setEventText(e.target.value)}
              onBlur={commitEventHeader}
              onKeyDown={(e) => { if (e.key === 'Enter') { commitEventHeader(); e.currentTarget.blur(); } }}
              placeholder="100 Free"
              className="min-h-[44px] w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-sm font-bold text-white outline-none focus:border-indigo-500"
            />
          </label>
          {hasHeatField && (
            <label className="flex flex-col">
              <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase mb-0.5">Heat</span>
              <input
                type="text"
                inputMode="numeric"
                value={heatText}
                onChange={(e) => setHeatText(e.target.value)}
                onBlur={commitEventHeader}
                onKeyDown={(e) => { if (e.key === 'Enter') { commitEventHeader(); e.currentTarget.blur(); } }}
                placeholder="1"
                className="min-h-[44px] w-20 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-sm font-bold text-white outline-none focus:border-indigo-500 text-center"
              />
            </label>
          )}
        </div>

        {/* Column headers */}
        <div className="hidden sm:flex items-center gap-2 px-1 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <span className="w-10 text-center">Lane</span>
          <span className="flex-1">Name</span>
          <span className="w-16 text-center">Side</span>
          <span className="w-28 text-center">Time / Mark</span>
          <span className="w-14 text-center">Place</span>
          <span className="w-24 text-center">Status</span>
        </div>

        <div className="space-y-1.5">
          {placedRows.map((row) => (
            <div
              key={row.lane}
              className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-1.5"
            >
              <span className="flex h-9 w-9 sm:w-10 shrink-0 items-center justify-center rounded-md bg-indigo-950 text-sm font-black text-indigo-300 tabular-nums">
                {row.lane}
              </span>
              <Input
                value={row.name}
                onChange={(e) => updateRow(row.lane, { name: e.target.value })}
                placeholder="Swimmer / relay name"
                className="min-h-[44px] flex-1 min-w-[120px] text-sm bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
              />
              <div className="flex w-16 shrink-0 gap-0.5">
                {([
                  { v: 'home' as const, l: 'H' },
                  { v: 'away' as const, l: 'A' },
                  { v: null, l: '–' },
                ]).map((opt) => (
                  <button
                    key={String(opt.v)}
                    type="button"
                    onClick={() => updateRow(row.lane, { team: opt.v })}
                    title={opt.v === 'home' ? g.homeTeam : opt.v === 'away' ? g.awayTeam : 'Neutral'}
                    className={`min-h-[44px] flex-1 rounded-md text-xs font-black transition-colors ${
                      row.team === opt.v ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
              <Input
                value={row.mark}
                onChange={(e) => updateRow(row.lane, { mark: e.target.value, dq: false, scr: false })}
                disabled={row.dq || row.scr}
                placeholder="1:52.31"
                inputMode="decimal"
                className="min-h-[44px] w-28 shrink-0 text-center text-sm font-bold tabular-nums bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 disabled:opacity-40"
              />
              <Input
                value={row.placeOverride ? String(row.placeOverride) : row.computedPlace ? String(row.computedPlace) : ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  updateRow(row.lane, { placeOverride: v ? Math.max(1, Math.min(99, parseInt(v, 10))) : undefined });
                }}
                inputMode="numeric"
                placeholder="—"
                title="Auto-computed from fastest time — type to override"
                className={`min-h-[44px] w-14 shrink-0 text-center text-sm font-black tabular-nums bg-slate-900 border-slate-700 ${
                  row.placeOverride ? 'text-amber-400' : 'text-emerald-400'
                }`}
              />
              <div className="flex w-24 shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => updateRow(row.lane, { dq: !row.dq, scr: false })}
                  aria-pressed={!!row.dq}
                  className={`min-h-[44px] flex-1 rounded-md text-[11px] font-black transition-colors ${
                    row.dq ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400 active:bg-slate-600 hover:bg-slate-700'
                  }`}
                >
                  DQ
                </button>
                <button
                  type="button"
                  onClick={() => updateRow(row.lane, { scr: !row.scr, dq: false })}
                  aria-pressed={!!row.scr}
                  className={`min-h-[44px] flex-1 rounded-md text-[11px] font-black transition-colors ${
                    row.scr ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 active:bg-slate-600 hover:bg-slate-700'
                  }`}
                >
                  SCR
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Next heat — saves the current grid into stats.results (same
            MeetResult contract the CTS feed and the old list editor both
            write) and starts a fresh, roster-refilled grid. Not gated
            behind a hold-to-confirm: it's additive (appends/updates one
            history row), not destructive — Undo reverts it in one tap. */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">
            {savedResults.length > 0
              ? `${savedResults.length} heat${savedResults.length === 1 ? '' : 's'} recorded this meet.`
              : 'No heats recorded yet.'}
          </div>
          <div className="flex items-center gap-2">
            {lastSaved && (
              <Button
                type="button"
                variant="outline"
                onClick={undoLastSave}
                className="min-h-[44px] gap-1.5 border-slate-700 bg-slate-900 text-slate-300 active:bg-slate-700 hover:bg-slate-800"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo {lastSaved.event}
              </Button>
            )}
            <Button
              type="button"
              onClick={nextHeat}
              disabled={!anyEntries}
              className="min-h-[44px] gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-black"
            >
              Next heat
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
