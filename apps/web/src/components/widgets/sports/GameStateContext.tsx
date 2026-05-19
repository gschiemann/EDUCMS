'use client';

/**
 * GameStateContext — live-game-state provider for sport-bound widgets.
 *
 * Wraps the rendered scoreboard / ribbon / scorebug template so its
 * SCORE_HOME, SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT widgets
 * read live values from the same un-authed `GET /sports/board/:id`
 * endpoint that `/board/[gameId]/page.tsx` already polls.
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
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_URL } from '@/lib/api-url';
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
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(initial ?? null);
  const [liveClockMs, setLiveClockMs] = useState<number>(initial?.clockMs ?? 0);

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
          setSnapshot(json);
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

export function useGameState(): GameStateValue | null {
  return useContext(GameStateContext);
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
