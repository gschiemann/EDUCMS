'use client';

/**
 * GameStateContext — live-game-state provider for sport-bound widgets.
 *
 * Wraps the rendered scoreboard / ribbon / scorebug template so its
 * SCORE_HOME, SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT widgets
 * read live values from the same un-authed `GET /sports/board/:id`
 * endpoint that `/board/[gameId]/page.tsx` already polls.
 *
 * Like every other public sports surface (board / ribbon / scorebug),
 * this provider runs each polled snapshot through `applyCtsOverlay`
 * (apps/web/src/lib/cts-merge.ts) BEFORE storing it — so when a CTS
 * console is broadcasting, custom-template widgets render the live CTS
 * score / clock / segment / shot-clock / exclusions, and fall back to
 * operator-input columns the moment the CTS heartbeat goes stale. Without
 * this, a board built from a custom template would silently ignore the
 * CTS feed and show only the operator's manual inputs.
 *
 * Two render modes:
 *
 *   1. Inside a `<GameStateProvider gameId="...">` — widgets read real
 *      values from the polled state and tick the clock from anchor.
 *
 *   2. Outside the provider (e.g. the template builder canvas or a
 *      gallery thumbnail) — widgets read `placeholder` from their
 *      cfg and render sample text ("HOME 24", "Q3 07:42") so the
 *      operator can lay out the board.
 *
 * Cross-browser / Chromium-83 / NovaStar Taurus safe — no `inset`
 * shorthand, no flex `gap`, no `backdrop-filter`. Pure context + a
 * 750ms poll (same cadence as `/board/[gameId]`) so the scoreboard
 * stays in lockstep with whatever the operator pushes from the
 * control surface.
 *
 * ── RenderSurface + the "no-fake-data on a real screen" guard (Sports
 *    Wave S2, 2026-07-02) ──────────────────────────────────────────────
 * Root bug (docs/research/2026-07-02-sports-deep-pass/00-AUDIT.md P0-2):
 * every sport widget's "am I live?" signal was `useGameState() != null`
 * — true ONLY inside a real `<GameStateProvider>`, which mounts ONLY on
 * the `/board` `/ribbon` `/scorebug` routes (CustomScoreboardScene /
 * board/[gameId]/page.tsx). A sports preset scheduled to a screen through
 * the NORMAL playlist path (apps/web/src/app/player/page.tsx) renders
 * with NO provider at all — mode 2 above — so every widget fell back to
 * its builder-only SAMPLE (fabricated athletes/scores) on a real screen
 * in front of a real crowd. The bug wasn't in any one widget; it's that
 * "no provider" was being treated as "must be the builder," when it's
 * equally true of "a real screen with no game bound yet."
 *
 * Fix: `RenderSurfaceContext` tells `useGameState()` which of those two
 * cases it's actually in when there's no ambient provider:
 *
 *   - 'builder' (the default — set nowhere = builder canvas, gallery
 *     thumbnail, preview modal, every existing test that never wraps in
 *     a RenderSurfaceProvider) → `useGameState()` returns `null`, EXACTLY
 *     as before. Every widget's existing `state == null` branch (render
 *     the SAMPLE) fires unchanged — zero regression for anything that
 *     doesn't opt in below.
 *
 *   - 'player' (set ONLY by the two real screen-rendering surfaces —
 *     `apps/web/src/app/player/page.tsx` and
 *     `apps/web/src/components/player/TouchOverlay.tsx`, via the new
 *     `renderSurface="player"` prop on `WidgetPreview`) → with no
 *     ambient provider, `useGameState()` returns a stable, non-null
 *     PHANTOM_UNBOUND value (`snapshot: null`). Every sport widget
 *     already treats "provider present, `snapshot` null" as "live
 *     surface, no data yet" and renders its audited NEUTRAL / empty /
 *     "no live data" state (MainScoreboardWidget's `isLiveNoData`,
 *     SwimDiveWidgets' `noLiveData`, cts-fields.ts `displayOrNeutral`,
 *     etc.) — so this one change makes EVERY `useGameState()`-driven
 *     sport widget do the right thing on a real screen with an unbound
 *     game, without editing each widget's internals.
 *
 * A REAL `<GameStateProvider gameId>` (board/[gameId]/page.tsx,
 * CustomScoreboardScene, or the new per-zone `config.gameId` binding in
 * WidgetRenderer's WidgetPreview) always wins — the phantom fallback only
 * activates when there is truly no provider anywhere above the widget.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_URL } from '@/lib/api-url';
import { applyCtsOverlay } from '@/lib/cts-merge';
import { findSport } from '@cms/api-types';

export interface GameSnapshot {
  id: string;
  sport: string;
  status: string;
  segment: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeColor: string | null;
  awayColor: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string;
  stats: Record<string, unknown>;
  serverTime: number;
}

interface GameStateValue {
  snapshot: GameSnapshot | null;
  /** Clock value already projected forward from the snapshot anchor — ready to render. */
  liveClockMs: number;
}

const GameStateContext = createContext<GameStateValue | null>(null);

const POLL_MS = 750;

export function GameStateProvider({
  gameId,
  initial,
  children,
}: {
  gameId: string;
  /** Optional warm cache (e.g. SSR / sports-board-cache) — saves the cold-boot flash. */
  initial?: GameSnapshot | null;
  children: ReactNode;
}) {
  // Overlay the warm cache too (lazy initializers run once on mount), so
  // the cold-boot frame already shows CTS data when its heartbeat is fresh.
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(
    () => (initial ? applyCtsOverlay(initial) : null),
  );
  const [liveClockMs, setLiveClockMs] = useState<number>(
    () => (initial ? applyCtsOverlay(initial).clockMs : 0),
  );

  // Poll the un-authed scoreboard endpoint at the same 750ms cadence
  // the /board/[gameId] page uses, so a template-driven board stays
  // perfectly in sync with cues / score changes / clock toggles.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${encodeURIComponent(gameId)}`, {
          cache: 'no-store',
        });
        if (alive && res.ok) {
          const json = (await res.json()) as GameSnapshot;
          // Same CTS source-of-truth merge the board/ribbon/scorebug run:
          // fresh CTS heartbeat → its score/clock/segment/shot-clock/
          // exclusions win; stale/absent → operator-input columns win.
          setSnapshot(applyCtsOverlay(json));
        }
      } catch {
        // Network blip — keep last snapshot, next tick retries.
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

  // Clock projection — clockMs is the reading at clockUpdatedAt.
  // While clockRunning, advance/decrement locally so the clock ticks
  // smoothly between polls instead of jumping every 750ms.
  useEffect(() => {
    if (!snapshot) return;
    const def = findSport(snapshot.sport);
    const updatedAt = new Date(snapshot.clockUpdatedAt).getTime();
    const drift = snapshot.serverTime ? Date.now() - snapshot.serverTime : 0;
    const projectClock = () => {
      if (!snapshot.clockRunning) {
        setLiveClockMs(snapshot.clockMs);
        return;
      }
      const elapsed = Date.now() - updatedAt - drift;
      if (!def || def.clock.type === 'countup') {
        setLiveClockMs(snapshot.clockMs + Math.max(0, elapsed));
      } else {
        setLiveClockMs(Math.max(0, snapshot.clockMs - Math.max(0, elapsed)));
      }
    };
    projectClock();
    const id = setInterval(projectClock, 100);
    return () => clearInterval(id);
  }, [snapshot]);

  const value = useMemo<GameStateValue>(
    () => ({ snapshot, liveClockMs }),
    [snapshot, liveClockMs],
  );

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>;
}

/**
 * RenderSurface — 'builder' (default) or 'player'. See the file-header
 * comment above for the full rationale. Set ONLY by the two components
 * that render a REAL screen: `apps/web/src/app/player/page.tsx` and
 * `apps/web/src/components/player/TouchOverlay.tsx`, via
 * `<WidgetPreview renderSurface="player">`. Every other WidgetPreview
 * call site (builder canvas, gallery thumbnail, preview modal, App
 * Library config preview, and every test that renders a sport widget
 * directly) never sets this, so it defaults to 'builder' — identical
 * behavior to before this context existed.
 */
export type RenderSurface = 'builder' | 'player';

const RenderSurfaceContext = createContext<RenderSurface>('builder');

export function RenderSurfaceProvider({
  surface,
  children,
}: {
  surface: RenderSurface;
  children: ReactNode;
}) {
  return (
    <RenderSurfaceContext.Provider value={surface}>
      {children}
    </RenderSurfaceContext.Provider>
  );
}

export function useRenderSurface(): RenderSurface {
  return useContext(RenderSurfaceContext);
}

// A stable module-level object (not re-created per render) so widgets that
// key effects off `state`/`state?.snapshot` via referential checks don't
// see a "new" phantom state every render. Represents "on a real screen,
// but no game is bound to this widget/zone yet."
const PHANTOM_UNBOUND_STATE: GameStateValue = { snapshot: null, liveClockMs: 0 };

export function useGameState(): GameStateValue | null {
  const ambient = useContext(GameStateContext);
  // A real <GameStateProvider> anywhere above (board/[gameId] page,
  // CustomScoreboardScene, or a per-zone config.gameId wrap) always wins —
  // this is the actual live/CTS-merged snapshot, never phantom.
  const surface = useRenderSurface();
  if (ambient != null) return ambient;
  // No ambient provider: on a real player surface with no game bound,
  // return the non-null phantom so every widget's existing "provider
  // present, snapshot null" neutral/empty-state logic fires instead of
  // its builder-only SAMPLE. In the builder (default) keep returning
  // null, unchanged from before this context existed.
  return surface === 'player' ? PHANTOM_UNBOUND_STATE : null;
}

/**
 * True when a REAL `<GameStateProvider>` (not the phantom-unbound
 * fallback) is already mounted somewhere above — i.e. this render is
 * already inside board/[gameId]/page.tsx or CustomScoreboardScene, or a
 * previously-applied per-zone `config.gameId` wrap. WidgetRenderer's
 * WidgetPreview reads this before deciding whether to add its own
 * per-zone `<GameStateProvider gameId={config.gameId}>` wrap (S2-2) —
 * without it, a sports widget already bound by an ambient provider (the
 * normal /board /ribbon /scorebug case) could get double-wrapped by a
 * stale `config.gameId` left over from before the zone was bound
 * ambiently, silently overriding the real game the operator is running.
 */
export function useHasAmbientGameProvider(): boolean {
  return useContext(GameStateContext) != null;
}

/** Convert raw ms into "MM:SS" or "M:SS.t" depending on the sport's clock. */
export function fmtClock(ms: number, showTenths = false): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (showTenths) {
    const t = Math.floor((ms % 1000) / 100);
    return `${m}:${pad(s)}.${t}`;
  }
  return `${m}:${pad(s)}`;
}

/** Sport-aware segment label — "Q3", "Inning 5 ▲", "Set 2", "1st Half", etc. */
export function fmtSegment(sport: string, segment: number): string {
  const def = findSport(sport);
  if (!def) return `Period ${segment}`;
  const name = def.segment?.name ?? 'Period';
  // Common short forms.
  switch (name) {
    case 'Quarter':
      return `Q${segment}`;
    case 'Half':
      return segment === 1 ? '1st Half' : '2nd Half';
    case 'Period':
      return `P${segment}`;
    case 'Inning':
      return `Inning ${segment}`;
    case 'Set':
      return `Set ${segment}`;
    case 'Round':
      return `Round ${segment}`;
    default:
      return `${name} ${segment}`;
  }
}
