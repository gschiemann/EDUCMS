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
 */

import { useMemo, useState } from 'react';
import { Plus, Minus, ChevronRight, Undo2 } from 'lucide-react';
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
  const [lastSaved, setLastSaved] = useState<{ event: string; prevResults: typeof savedResults } | null>(null);

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

  const nextHeat = () => {
    const fresh = buildHeatResult(eventText, hasHeatField ? heatText : '', rows, Date.now());
    if (fresh.entries.length === 0) return; // nothing to save — no-op, avoid junk history rows
    const merged = mergeHeatResult(savedResults, fresh);

    // Snapshot for the one-tap Undo affordance below (client-side only —
    // reverts stats.results to what it was before this save, same
    // ctl.stats.mutate path, no new endpoint).
    setLastSaved({ event: fresh.event, prevResults: savedResults });

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

  const undoLastSave = () => {
    if (!lastSaved) return;
    ctl.stats.mutate({ stats: { results: lastSaved.prevResults } });
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
