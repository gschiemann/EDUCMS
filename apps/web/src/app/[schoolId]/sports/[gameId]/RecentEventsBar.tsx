'use client';

/**
 * RecentEventsBar — full-width "run of show" strip docked UNDER the Run
 * console.
 *
 * Replaces the old right-hand RecentEventsRail, which rendered as a 320px
 * column that overflowed off the right edge on narrower windows (it sat on
 * top of the scoreboard + screen chips) and used a dark theme that clashed
 * with the light console. This version is a horizontal strip that spans the
 * full width below the controls: events flow newest-first left→right as
 * compact, color-coded chips; hovering a chip reveals an Undo affordance for
 * undoable rows. Collapsible to a slim header bar.
 *
 * Polls GET /sports/games/:id/events?limit=25 every 2 s (shared React Query
 * cache with the console). Undo POST /events/:id/undo invalidates the events
 * + game cache so the scoreboard updates immediately.
 *
 * This is an OPERATOR console surface (tablet / desktop browser), NOT a
 * Taurus LED player surface, so modern CSS is fine — but we keep physical
 * longhand + margin-based spacing (no `gap` / `inset`) to match the file's
 * prior convention and stay trivially Chromium-83-safe.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Loader2, ScrollText } from 'lucide-react';
import { useGameEvents, useUndoGameEvent, type GameEventRow } from '@/hooks/use-api';

// ── helpers ───────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

/**
 * Derive a human-readable segment label from the event payload.
 * Falls back to empty if the payload doesn't carry segment info.
 */
function segLabel(payload: Record<string, unknown>): string {
  const seg = payload.segment ?? payload.prevSegment;
  if (typeof seg !== 'number') return '';
  return `Seg ${seg}`;
}

/**
 * A scannable accent color per event class so the operator can read the
 * run-of-show at a glance (goal = green, save = blue, exclusion = amber, …).
 */
function eventTone(ev: GameEventRow): string {
  const p = ev.payload;
  const key = String(p.key || p.cueId || '').toLowerCase();
  if (ev.type === 'SCORE') return 'bg-emerald-400';
  if (ev.type === 'CUE') {
    if (key.includes('goal') || key.includes('score') || key.includes('touchdown') || key === 'td') return 'bg-emerald-400';
    if (key.includes('save') || key.includes('block') || key.includes('stop')) return 'bg-sky-400';
    if (key.includes('exclus') || key.includes('penal') || key.includes('foul')) return 'bg-amber-400';
    if (key.includes('power')) return 'bg-violet-400';
    return 'bg-indigo-400';
  }
  if (ev.type === 'PENALTY') return 'bg-amber-400';
  if (ev.type === 'STATUS') return 'bg-indigo-400';
  if (ev.type === 'SEGMENT') return 'bg-slate-400';
  if (ev.type === 'CLOCK') return 'bg-slate-300';
  if (ev.type === 'AUTO_CELEBRATE') return 'bg-violet-400';
  return 'bg-slate-300';
}

/**
 * Summarise an event in one short phrase for the operator.
 */
function eventSummary(ev: GameEventRow): string {
  const p = ev.payload;

  // Undo marker rows
  if (p.undoOf) {
    return `↩ Undid ${String(p.originalType || ev.type).replace('UNDO_', '')}`;
  }

  switch (ev.type) {
    case 'SCORE': {
      if (String(p.team) === 'set') {
        return `Score set  ${p.homeScore ?? '?'} – ${p.awayScore ?? '?'}`;
      }
      const team = String(p.team) === 'away' ? 'Away' : 'Home';
      const d = Number(p.delta);
      const sign = d >= 0 ? '+' : '';
      return `${team} ${sign}${d}  →  ${p.homeScore ?? '?'} – ${p.awayScore ?? '?'}`;
    }
    case 'CLOCK': {
      const action = String(p.action || '');
      if (action === 'start') return 'Clock  ▶ start';
      if (action === 'pause') return 'Clock  ⏸ pause';
      if (action === 'reset') return 'Clock  ↺ reset';
      if (action === 'set') {
        const ms = Number(p.clockMs);
        if (Number.isFinite(ms)) {
          const sec = Math.round(ms / 1000);
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          return `Clock set  ${m}:${String(s).padStart(2, '0')}`;
        }
      }
      if (action === 'expired') return 'Clock  ⏹ expired';
      if (action === 'auto-advance') return 'Clock  ⏭ auto-advance';
      return `Clock  ${action}`;
    }
    case 'SEGMENT': {
      if (p.auto) return `Segment auto → ${p.segment}`;
      return `Segment → ${p.segment}`;
    }
    case 'STAT': {
      const stats = p.stats as Record<string, unknown> | undefined;
      if (stats && typeof stats === 'object') {
        const keys = Object.keys(stats).filter((k) => k !== 'penalties' && k !== 'shotClock');
        if (keys.length === 1) {
          return `Stat  ${keys[0]} = ${stats[keys[0]]}`;
        }
        return `Stats (${keys.length})`;
      }
      return 'Stat update';
    }
    case 'CUE':
      return `Cue  ${String(p.key || p.cueId || 'custom')}`;
    case 'PENALTY':
      return `Penalty  ${String(p.action || '')}`;
    case 'STATUS':
      return `Status → ${String(p.status || '')}`;
    case 'RIBBON':
      return 'Ribbon updated';
    case 'INGEST':
      return 'Score ingest';
    case 'AUTO_CELEBRATE':
      return `Auto-celebrate  ${String(p.enabled ? 'on' : 'off')}`;
    default:
      return ev.type.replace(/_/g, ' ').toLowerCase();
  }
}

// ── component ─────────────────────────────────────────────────

export function RecentEventsBar({ gameId }: { gameId: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: events, isLoading } = useGameEvents(gameId);
  const undo = useUndoGameEvent(gameId);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const handleUndo = async (eventId: string) => {
    if (undoingId) return;
    setUndoingId(eventId);
    try {
      await undo.mutateAsync(eventId);
    } finally {
      setUndoingId(null);
    }
  };

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white">
      {/* Header: label + live dot + collapse toggle */}
      <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
        <div className="flex items-center text-slate-500">
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wider">
            Event log
          </span>
          <span
            className="ml-2 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
            title="Live — updates every 2s"
            aria-hidden
          />
          {!isLoading && events && events.length > 0 && (
            <span className="ml-2 text-[11px] tabular-nums text-slate-400">
              {events.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title={collapsed ? 'Show event log' : 'Hide event log'}
          aria-label={collapsed ? 'Expand event log' : 'Collapse event log'}
        >
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Horizontal run-of-show strip — newest first, left→right */}
      {!collapsed && (
        <div
          className="flex items-stretch overflow-x-auto px-3 pb-2"
          style={{ scrollbarWidth: 'thin' }}
        >
          {isLoading && (
            <div className="flex items-center py-3 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}

          {!isLoading && (!events || events.length === 0) && (
            <p className="py-3 text-xs text-slate-400">
              No events yet — actions appear here as you run the game.
            </p>
          )}

          {!isLoading &&
            events &&
            events.map((ev) => {
              const isUndoing = undoingId === ev.id;
              const summary = eventSummary(ev);
              const segStr = segLabel(ev.payload);
              const tone = eventTone(ev);

              return (
                <div
                  key={ev.id}
                  className="group relative mr-2 flex shrink-0 flex-col justify-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 transition-colors hover:border-slate-300 hover:bg-white"
                  title={`${fmtTime(ev.createdAt)}${segStr ? ` · ${segStr}` : ''} — ${summary}`}
                >
                  {/* time row */}
                  <div className="flex items-center">
                    <span className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} aria-hidden />
                    <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">
                      {fmtTime(ev.createdAt)}
                      {segStr && <span className="ml-1 text-slate-300">{segStr}</span>}
                    </span>
                  </div>
                  {/* summary row */}
                  <span
                    className={`mt-0.5 whitespace-nowrap text-xs font-medium ${
                      ev.undoable ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {summary}
                  </span>

                  {/* hover-to-undo (undoable rows only) */}
                  {ev.undoable && (
                    <button
                      disabled={!!undoingId}
                      onClick={() => handleUndo(ev.id)}
                      className="absolute right-1 top-1 flex items-center rounded bg-white px-1 py-0.5 text-[10px] font-semibold text-indigo-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity hover:text-indigo-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                      title="Undo this action"
                      aria-label={`Undo: ${summary}`}
                    >
                      {isUndoing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="mr-0.5 h-3 w-3" />
                          Undo
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
