'use client';

/**
 * RecentEventsRail — collapsible 320px right panel in Run mode.
 *
 * Polls GET /sports/games/:id/events?limit=25 every 2 s. Each row
 * shows: timestamp, segment label from the event payload, action
 * summary, and an Undo button (disabled for non-undoable rows).
 *
 * Clicking Undo POST /sports/games/:id/events/:eventId/undo —
 * the response invalidates both the events list and the game cache
 * so the scoreboard updates immediately.
 *
 * Chromium-83 (Taurus): no `inset-*`, no `gap-*` on flex without
 * per-child margins, no `backdrop-filter` without a fallback solid
 * bg. Physical longhand Tailwind classes only.
 */

import { useState } from 'react';
import { ChevronRight, ChevronLeft, RotateCcw, Loader2 } from 'lucide-react';
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
 * Falls back to the segment number if the payload doesn't carry
 * segment info (old events pre-dating the undo rail).
 */
function segLabel(payload: Record<string, unknown>): string {
  const seg = payload.segment ?? payload.prevSegment;
  if (typeof seg !== 'number') return '';
  return `Seg ${seg}`;
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
      if (action === 'expired') return 'Clock  ⏹ expired (system)';
      if (action === 'auto-advance') return 'Clock  ⏭ auto-advance (system)';
      return `Clock  ${action}`;
    }
    case 'SEGMENT': {
      if (p.auto) return `Segment auto-advance → ${p.segment}`;
      return `Segment → ${p.segment}`;
    }
    case 'STAT': {
      const stats = p.stats as Record<string, unknown> | undefined;
      if (stats && typeof stats === 'object') {
        const keys = Object.keys(stats).filter((k) => k !== 'penalties' && k !== 'shotClock');
        if (keys.length === 1) {
          return `Stat  ${keys[0]} = ${stats[keys[0]]}`;
        }
        return `Stats updated (${keys.length} fields)`;
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
      return 'Ribbon messages updated';
    case 'INGEST':
      return 'Score ingest (external feed)';
    case 'AUTO_CELEBRATE':
      return `Auto-celebrate  ${String(p.enabled ? 'on' : 'off')}`;
    default:
      return ev.type.replace(/_/g, ' ').toLowerCase();
  }
}

// ── component ─────────────────────────────────────────────────

export function RecentEventsRail({ gameId }: { gameId: string }) {
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

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center justify-start pt-4 bg-slate-900 border-l border-slate-700"
        style={{ width: 36, minHeight: 0, flexShrink: 0 }}
      >
        <button
          onClick={() => setCollapsed(false)}
          className="text-slate-400 hover:text-white rounded p-1"
          title="Show event log"
          aria-label="Expand event log"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {/* Rotated label so the operator knows what's here */}
        <span
          className="text-slate-500 text-xs font-medium mt-3 select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Event log
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-slate-900 border-l border-slate-700"
      style={{ width: 320, minHeight: 0, flexShrink: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 shrink-0">
        <span className="text-slate-200 text-xs font-semibold tracking-wide uppercase">
          Event log
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-slate-400 hover:text-white rounded p-1"
          title="Collapse event log"
          aria-label="Collapse event log"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Event list — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </div>
        )}

        {!isLoading && (!events || events.length === 0) && (
          <p className="text-slate-500 text-xs text-center px-4 py-6">
            No events yet. Actions appear here as you run the game.
          </p>
        )}

        {!isLoading &&
          events &&
          events.map((ev) => {
            const isUndoing = undoingId === ev.id;
            const canUndo = ev.undoable && !undoingId;
            const summary = eventSummary(ev);
            const segStr = segLabel(ev.payload);

            return (
              <div
                key={ev.id}
                className={`px-3 py-2 border-b border-slate-800 ${ev.undoable ? 'bg-slate-900' : 'bg-slate-950/50'}`}
              >
                {/* Top row: time + segment */}
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-slate-500 text-xs font-mono">
                    {fmtTime(ev.createdAt)}
                    {segStr && (
                      <span className="ml-1.5 text-slate-600">{segStr}</span>
                    )}
                  </span>
                  {/* Undo button */}
                  {ev.undoable && (
                    <button
                      disabled={!canUndo}
                      onClick={() => handleUndo(ev.id)}
                      className={`flex items-center text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${
                        canUndo
                          ? 'text-indigo-400 hover:text-indigo-200 hover:bg-indigo-900/40'
                          : 'text-slate-600 cursor-not-allowed'
                      }`}
                      title="Undo this action"
                      aria-label={`Undo: ${summary}`}
                    >
                      {isUndoing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="h-3 w-3 mr-0.5" />
                          Undo
                        </>
                      )}
                    </button>
                  )}
                  {!ev.undoable && ev.nonUndoableReason === 'type' && (
                    <span className="text-slate-700 text-xs">—</span>
                  )}
                  {!ev.undoable && ev.nonUndoableReason === 'system' && (
                    <span className="text-slate-700 text-xs italic">system</span>
                  )}
                </div>

                {/* Summary row */}
                <p
                  className={`text-xs leading-snug truncate ${ev.undoable ? 'text-slate-300' : 'text-slate-500'}`}
                  title={summary}
                >
                  {summary}
                </p>
              </div>
            );
          })}
      </div>
    </div>
  );
}
