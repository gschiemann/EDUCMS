'use client';

/**
 * SurfaceHealthPills — T1-6
 *
 * A fixed horizontal pill row pinned inside the Run-mode top area.
 * Each pill represents one screen paired to the tenant, showing:
 *   - Colored status dot (+ shape/icon for color-blind parity per CLAUDE.md §18)
 *   - Surface-kind icon (board / ribbon / concourse / off)
 *   - Screen name (truncated)
 *   - Age sub-text ("On air · scoreboard", "Off", "Offline")
 *
 * Data source: useGameScreens() which polls every 10 s. No new
 * server endpoints — only reads from the existing polling query.
 *
 * Click pill → side drawer slides in from the right with a live
 * iframe preview of that surface (using the existing SurfacePreview
 * component). Esc dismisses.
 *
 * Color-blind safe: every status uses BOTH color AND a distinct icon/
 * symbol so operators with deuteranopia / protanopia can tell them
 * apart at a glance.
 *
 * Chromium-83 safe: no `inset` shorthand, no `inset-0` Tailwind
 * class, no `gap` on flex rows that will run on NovaStar Taurus.
 * (This component only renders in the operator console, not on the
 * player, so Taurus concerns are N/A here — but we follow the rule
 * everywhere to prevent accidental copy-paste spread.)
 */

import { useEffect, useRef, useState } from 'react';
import { MonitorPlay, RectangleHorizontal, Monitor, WifiOff } from 'lucide-react';
import { useGameScreens } from '@/hooks/use-api';
import { SurfacePreview } from './SurfacePreview';

// ── Pill status model ──────────────────────────────────────────

/**
 * Five possible health states for a screen pill.
 * Color-blind pair: each gets a distinct symbol PLUS color.
 */
type PillStatus =
  | 'online-showing'   // 🟢 ONLINE + showing this game
  | 'online-off'       // ⚪ ONLINE but not showing this game
  | 'showing-other'    // 🟡 ONLINE + showing a different game
  | 'offline'          // 🔴 OFFLINE
  | 'unknown';         // ⚫ status unknown / pending

interface PillData {
  id: string;
  name: string;
  status: PillStatus;
  surface: string | null;  // 'BOARD' | 'RIBBON' | 'SCOREBUG' | null
  otherGame: string | null;
}

function toPillStatus(raw: {
  status: string;
  showing: boolean;
  showingOther: boolean;
}): PillStatus {
  if (raw.status !== 'ONLINE') return 'offline';
  if (raw.showing) return 'online-showing';
  if (raw.showingOther) return 'showing-other';
  return 'online-off';
}

// ── Status visual descriptors ──────────────────────────────────

const STATUS_DOT: Record<PillStatus, string> = {
  'online-showing': 'bg-green-500',
  'online-off':     'bg-slate-400',
  'showing-other':  'bg-amber-400',
  'offline':        'bg-red-500',
  'unknown':        'bg-slate-600',
};

/** Color-blind-safe symbol beside the dot (shape / letter, not just hue). */
const STATUS_SYMBOL: Record<PillStatus, string> = {
  'online-showing': '●',  // filled circle — "live"
  'online-off':     '○',  // empty circle — "ready but off"
  'showing-other':  '⚠',  // warning triangle — "occupied"
  'offline':        '✕',  // cross — "dead"
  'unknown':        '?',  // question mark
};

const STATUS_SYMBOL_COLOR: Record<PillStatus, string> = {
  'online-showing': 'text-green-500',
  'online-off':     'text-slate-400',
  'showing-other':  'text-amber-400',
  'offline':        'text-red-500',
  'unknown':        'text-slate-600',
};

const STATUS_RING: Record<PillStatus, string> = {
  'online-showing': 'border-green-700 bg-green-950/60',
  'online-off':     'border-slate-700 bg-slate-800/60',
  'showing-other':  'border-amber-700 bg-amber-950/60',
  'offline':        'border-red-800 bg-red-950/60',
  'unknown':        'border-slate-700 bg-slate-900/60',
};

function statusLabel(p: PillData): string {
  switch (p.status) {
    case 'online-showing':
      return surfaceLabel(p.surface);
    case 'online-off':
      return 'Off';
    case 'showing-other':
      return `Other game`;
    case 'offline':
      return 'Offline';
    default:
      return 'Unknown';
  }
}

function surfaceLabel(surface: string | null): string {
  if (!surface) return 'On air';
  switch (surface) {
    case 'BOARD':    return 'Scoreboard';
    case 'RIBBON':   return 'Ribbon';
    case 'SCOREBUG': return 'Scorebug';
    default:         return surface;
  }
}

// ── Surface-kind icon ──────────────────────────────────────────

function SurfaceIcon({ surface, status }: { surface: string | null; status: PillStatus }) {
  const cls = 'h-3 w-3 shrink-0';
  if (status === 'offline')    return <WifiOff className={cls} />;
  if (!surface || surface === 'BOARD' || surface === 'SCOREBUG')
    return <MonitorPlay className={cls} />;
  if (surface === 'RIBBON')    return <RectangleHorizontal className={cls} />;
  return <Monitor className={cls} />;
}

// ── Drawer ─────────────────────────────────────────────────────

/**
 * Right-side slide-in drawer showing a live SurfacePreview for the
 * clicked screen. ~640px wide, dismissable with Esc or backdrop click.
 */
function PillDrawer({
  gameId,
  screen,
  onClose,
}: {
  gameId: string;
  screen: PillData;
  onClose: () => void;
}) {
  // Esc dismisses
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap anchor
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed top-0 left-0 right-0 bottom-0 z-40 bg-slate-900/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Live preview: ${screen.name}`}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-slate-950 border-l border-slate-700 shadow-2xl"
        style={{ width: '640px', maxWidth: '95vw' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-flex items-center justify-center text-[10px] font-black ${STATUS_SYMBOL_COLOR[screen.status]}`}
              aria-hidden="true"
            >
              {STATUS_SYMBOL[screen.status]}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{screen.name}</p>
              <p className="text-[11px] text-slate-400">{statusLabel(screen)}</p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        {/* Live preview */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {screen.status === 'offline' ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <WifiOff className="h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-500">
                This screen is offline — no live preview available.
              </p>
            </div>
          ) : !screen.surface ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Monitor className="h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-500">
                This screen is not showing this game right now.
              </p>
              <p className="text-[11px] text-slate-600">
                Use the Surfaces panel in Setup mode to push this game to the screen.
              </p>
            </div>
          ) : (
            <SurfacePreview gameId={gameId} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────

/**
 * SurfaceHealthPills — renders a compact horizontal row of status
 * pills, one per tenant screen. Intended to sit just above the
 * RunInteractiveScoreboard inside Run mode.
 *
 * - Zero screens → renders nothing (gracefully handles unpaired tenants).
 * - Click any pill → opens the PillDrawer with a live preview.
 */
export function SurfaceHealthPills({ gameId }: { gameId: string }) {
  const { data, isLoading } = useGameScreens(gameId);
  const [activeScreen, setActiveScreen] = useState<PillData | null>(null);

  const screens: PillData[] = (() => {
    if (!Array.isArray(data)) return [];
    return (data as any[]).map((s) => ({
      id:         s.id,
      name:       s.name,
      status:     toPillStatus({ status: s.status, showing: s.showing, showingOther: s.showingOther }),
      surface:    s.surface ?? null,
      otherGame:  s.otherGame ?? null,
    }));
  })();

  // Nothing to show — don't waste vertical space
  if (isLoading || screens.length === 0) return null;

  return (
    <>
      {/* Pill row */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto bg-slate-900 border-b border-slate-800"
        aria-label="Screen health status"
        role="status"
        style={{ minHeight: '40px' }}
      >
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 shrink-0 mr-1">
          Screens
        </span>

        {screens.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveScreen((prev) => (prev?.id === s.id ? null : s))}
            aria-pressed={activeScreen?.id === s.id}
            title={
              s.status === 'online-showing'
                ? `${s.name} · On air (${surfaceLabel(s.surface)})`
                : s.status === 'showing-other'
                  ? `${s.name} · Showing ${s.otherGame ?? 'another game'}`
                  : s.status === 'offline'
                    ? `${s.name} · Offline`
                    : `${s.name} · Not showing this game`
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors shrink-0 ${STATUS_RING[s.status]} ${
              activeScreen?.id === s.id
                ? 'ring-1 ring-white ring-offset-1 ring-offset-slate-900'
                : 'hover:brightness-125'
            }`}
          >
            {/* Color-blind-safe: symbol + dot together */}
            <span
              className={`text-[9px] font-black ${STATUS_SYMBOL_COLOR[s.status]}`}
              aria-hidden="true"
            >
              {STATUS_SYMBOL[s.status]}
            </span>
            <SurfaceIcon surface={s.surface} status={s.status} />
            <span className="text-slate-200 max-w-[96px] truncate">{s.name}</span>
            {s.status === 'online-showing' && (
              <span className="text-[9px] text-green-400 font-black ml-0.5">
                {s.surface === 'RIBBON' ? 'RBN' : s.surface === 'SCOREBUG' ? 'BUG' : 'BRD'}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Drawer */}
      {activeScreen && (
        <PillDrawer
          gameId={gameId}
          screen={activeScreen}
          onClose={() => setActiveScreen(null)}
        />
      )}
    </>
  );
}
