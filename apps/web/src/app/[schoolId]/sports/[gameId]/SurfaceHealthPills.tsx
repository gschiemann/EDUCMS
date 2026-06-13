'use client';

/**
 * SurfaceHealthPills — T1-6 (render-proof, audit P1 — 2026-06-13)
 *
 * A fixed horizontal pill row pinned inside the Run-mode top area.
 * Each pill represents one screen paired to the tenant, showing:
 *   - Colored status dot (+ shape/icon for color-blind parity per CLAUDE.md §18)
 *   - Surface-kind icon (board / ribbon / concourse / off)
 *   - Screen name (truncated)
 *   - Age sub-text ("Scoreboard", "Frozen", "Off", "Offline")
 *
 * ── Why this is render-PROOF (the audit P1 fix) ─────────────────
 * The pill used to read ONLY the raw device `Screen.status`
 * (ONLINE/OFFLINE), which is derived from `lastPingAt` — "is the box
 * TCP-reachable + JS alive," NOT "are pixels painting." A kiosk whose
 * renderer wedged (crashed React tree / black/frozen frame) keeps
 * answering the heartbeat, so it stayed GREEN for 5-7 minutes after the
 * board actually died — the operator was told all was well while the
 * crowd watched a dead screen.
 *
 * Now we join the SERVER's render-proof verdict (`renderHealth` /
 * `renderStale`) — already computed by deriveRenderHealth and already
 * shipped on the `GET /screens` fleet list the dashboard polls every
 * 10 s via useScreens() — into each pill by screen id. A surface showing
 * the game but no longer painting flips out of GREEN to a distinct
 * `frozen` pill within ~90 s of the freeze (the render-proof window) +
 * one 10 s poll — instead of 5-7 minutes. Green is earned ONLY by
 * positive, recent paint proof; the "no proof yet" case (older player
 * build / fresh pair) shows a distinct `live-unverified` pill rather
 * than a false GREEN. Pure status logic lives in `./surface-health`.
 *
 * Data source: useGameScreens() (game→screen assignment, polls 10 s) +
 * useScreens() (fleet render-proof, polls 10 s). No new server endpoints.
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
import {
  MonitorPlay,
  RectangleHorizontal,
  Monitor,
  WifiOff,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import { useGameScreens, useScreens } from '@/hooks/use-api';
import { SurfacePreview } from './SurfacePreview';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import {
  toPillStatus,
  type PillStatus,
  type RenderProofSignal,
} from './surface-health';

// ── Pill status model ──────────────────────────────────────────

interface PillData {
  id: string;
  name: string;
  status: PillStatus;
  surface: string | null;  // 'BOARD' | 'RIBBON' | 'SCOREBUG' | null
  otherGame: string | null;
  /** Seconds since the surface last proved a paint — drives the "Frozen Ns"
   *  sub-text on a frozen pill so the operator sees how long it's been dark. */
  renderStaleSeconds: number | null;
}

// ── Status visual descriptors ──────────────────────────────────

const STATUS_DOT: Record<PillStatus, string> = {
  'online-showing':  'bg-green-500',
  'live-unverified': 'bg-green-500',
  'frozen':          'bg-red-500',
  'online-off':      'bg-slate-400',
  'showing-other':   'bg-amber-400',
  'offline':         'bg-red-500',
  'unknown':         'bg-slate-600',
};

/** Color-blind-safe symbol beside the dot (shape / letter, not just hue). */
const STATUS_SYMBOL: Record<PillStatus, string> = {
  'online-showing':  '●',  // filled circle — "live, painting"
  'live-unverified': '◐',  // half-filled — "live but no paint proof yet"
  'frozen':          '❄',  // snowflake — "reachable but FROZEN, not painting"
  'online-off':      '○',  // empty circle — "ready but off"
  'showing-other':   '⚠',  // warning triangle — "occupied"
  'offline':         '✕',  // cross — "dead / unreachable"
  'unknown':         '?',  // question mark
};

const STATUS_SYMBOL_COLOR: Record<PillStatus, string> = {
  'online-showing':  'text-green-500',
  'live-unverified': 'text-green-400',
  'frozen':          'text-red-500',
  'online-off':      'text-slate-400',
  'showing-other':   'text-amber-400',
  'offline':         'text-red-500',
  'unknown':         'text-slate-600',
};

const STATUS_RING: Record<PillStatus, string> = {
  'online-showing':  'border-green-700 bg-green-950/60',
  // Slightly desaturated green ring so "live but unverified" reads as
  // distinct from a proof-backed live pill at a glance.
  'live-unverified': 'border-emerald-800 bg-emerald-950/40',
  'frozen':          'border-red-800 bg-red-950/60',
  'online-off':      'border-slate-700 bg-slate-800/60',
  'showing-other':   'border-amber-700 bg-amber-950/60',
  'offline':         'border-red-800 bg-red-950/60',
  'unknown':         'border-slate-700 bg-slate-900/60',
};

function statusLabel(p: PillData): string {
  switch (p.status) {
    case 'online-showing':
      return surfaceLabel(p.surface);
    case 'live-unverified':
      // Reachable + assigned, but the player hasn't proven a paint yet.
      return 'Live · no proof';
    case 'frozen':
      return p.renderStaleSeconds != null
        ? `Frozen ${formatStale(p.renderStaleSeconds)}`
        : 'Frozen';
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

/** "Frozen 95s" / "Frozen 4m" — compact age of the last proven paint. */
function formatStale(seconds: number): string {
  if (seconds < 120) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

/** Full hover tooltip for a pill — spells out the render-proof verdict. */
function pillTooltip(p: PillData): string {
  switch (p.status) {
    case 'online-showing':
      return `${p.name} · On air (${surfaceLabel(p.surface)}) — painting normally`;
    case 'live-unverified':
      return `${p.name} · On air (${surfaceLabel(p.surface)}) — reachable, no render proof yet`;
    case 'frozen':
      return p.renderStaleSeconds != null
        ? `${p.name} · FROZEN — reachable but no frame painted in ${formatStale(p.renderStaleSeconds)}`
        : `${p.name} · FROZEN — reachable but not painting`;
    case 'showing-other':
      return `${p.name} · Showing ${p.otherGame ?? 'another game'}`;
    case 'offline':
      return `${p.name} · Offline`;
    default:
      return `${p.name} · Not showing this game`;
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
  if (status === 'offline')         return <WifiOff className={cls} />;
  if (status === 'frozen')          return <AlertTriangle className={cls} />;
  if (status === 'live-unverified') return <HelpCircle className={cls} />;
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
  useOverlayLock(); // hide mobile tab bar so the drawer's controls clear it
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
            <>
              {/* Render-proof warning. The iframe below is the operator's
                  OWN live mirror of the surface — it will look perfect even
                  when the PHYSICAL screen is wedged. So when render-proof
                  says the screen stopped painting, say so loudly: don't let
                  a healthy-looking preview reassure the operator about a dead
                  board in the building. */}
              {screen.status === 'frozen' && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-700 bg-red-950/70 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-red-200">
                      Screen looks frozen
                      {screen.renderStaleSeconds != null
                        ? ` — no frame painted in ${formatStale(screen.renderStaleSeconds)}`
                        : ''}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-red-300/80">
                      The screen is still reachable but has stopped advancing its
                      picture — the crowd may be seeing a stuck or black frame.
                      The preview below is your own live mirror, not the screen
                      itself. Check the physical display or restart the player.
                    </p>
                  </div>
                </div>
              )}
              {screen.status === 'live-unverified' && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/70 bg-amber-950/40 p-3">
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-amber-200">
                      Live, but render not yet confirmed
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-300/80">
                      The screen is reachable and assigned this game, but the
                      player hasn&apos;t reported a painted frame yet (older
                      build or just connected). It should confirm within a
                      minute.
                    </p>
                  </div>
                </div>
              )}
              <SurfacePreview gameId={gameId} />
            </>
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
  // The fleet list carries the SERVER's render-proof verdict per screen
  // (renderHealth / renderStale / renderStaleSeconds). Same 10 s poll cadence
  // as useGameScreens — and React Query dedupes the shared ['screens'] query,
  // so adding this consumer costs no extra network. This is the render-proof
  // signal that makes a dead board drop out of green in SECONDS, not minutes.
  const { data: fleet } = useScreens();

  // Track only the active screen ID; re-derive its live PillData from the
  // freshly-polled list below so the open drawer reflects a freeze that
  // happens WHILE it's open (instead of a stale click-time snapshot).
  const [activeId, setActiveId] = useState<string | null>(null);

  // screenId → render-proof signal, from the fleet list.
  const proofById = new Map<string, RenderProofSignal>();
  if (Array.isArray(fleet)) {
    for (const f of fleet as any[]) {
      if (f && typeof f.id === 'string') {
        proofById.set(f.id, {
          renderHealth: f.renderHealth ?? null,
          renderStale: f.renderStale ?? null,
          renderStaleSeconds: f.renderStaleSeconds ?? null,
        });
      }
    }
  }

  const screens: PillData[] = (() => {
    if (!Array.isArray(data)) return [];
    return (data as any[]).map((s) => {
      const proof = proofById.get(s.id) ?? null;
      return {
        id:         s.id,
        name:       s.name,
        status:     toPillStatus(
          { status: s.status, showing: s.showing, showingOther: s.showingOther },
          proof,
        ),
        surface:    s.surface ?? null,
        otherGame:  s.otherGame ?? null,
        renderStaleSeconds: proof?.renderStaleSeconds ?? null,
      };
    });
  })();

  const activeScreen = activeId ? screens.find((s) => s.id === activeId) ?? null : null;

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
            onClick={() => setActiveId((prev) => (prev === s.id ? null : s.id))}
            aria-pressed={activeId === s.id}
            title={pillTooltip(s)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors shrink-0 ${STATUS_RING[s.status]} ${
              activeId === s.id
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
            {/* Surface badge for any pill assigned to this game — green when
                proven painting / unverified, RED when frozen. */}
            {(s.status === 'online-showing' ||
              s.status === 'live-unverified' ||
              s.status === 'frozen') && (
              <span
                className={`text-[9px] font-black ml-0.5 ${
                  s.status === 'frozen' ? 'text-red-400' : 'text-green-400'
                }`}
              >
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
          onClose={() => setActiveId(null)}
        />
      )}
    </>
  );
}
