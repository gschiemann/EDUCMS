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
 *
 * ── The clock contract (K-12 sports launch, K12-F17 + F40, 2026-09-27) ──
 * The widgets used to do their own clock math: the device's own clock
 * with a crude skew, a floor-rounding formatter, tenths whenever a widget
 * felt like it, and no freshness at all — so a widget board and the /board
 * route could read different seconds for the same instant, and a widget
 * kept running a clock the table may have stopped while its poll was dead.
 * The provider now runs the SAME contract as /board, /ribbon and /scorebug:
 *   • ONE server clock (lib/server-clock.ts). The poll samples it; every
 *     clock projects from `serverClock.now()`, never `Date.now()`.
 *   • ONE projection (@cms/api-types sports-clock.ts): the game clock via
 *     `projectGameClockMs`, every secondary countdown (shot clock, play
 *     clock, penalty timers) via `projectCountdownMs`, all at the one
 *     instant the provider hands out as `nowMs` — so every widget under a
 *     provider projects from the same moment in the same render.
 *   • ONE formatter: `formatSportClock(def, ms)` for the game clock (MM:SS
 *     rounding up; tenths only in a tenths sport's final minute) and
 *     `formatShotClockReading` (lib/game-clock-format.ts) for shot / play
 *     clocks — the digits the /board route paints.
 *   • ONE freshness contract (lib/sports-freshness.ts via useSportsLink):
 *     stale after 8 s without a good read, and while stale every clock
 *     HOLDS where it stood (the page's server clock is held with this
 *     provider's own hold, so it never releases another link's). `link`
 *     says which phase it is in; only 'live' may claim LIVE.
 *   • NEVER an older revision: a payload whose game revision is older than
 *     one already shown (another replica's one-second cache) is dropped.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_URL } from '@/lib/api-url';
// Trust wave Domain B (2026-08-06) — shared hardened poll engine
// (self-chaining, ETag/304 revalidation, jittered backoff) so this
// loop behaves identically to /board and /ribbon under load + outage.
import { startBoardPoll } from '@/lib/board-poll';
import { applyCtsOverlay } from '@/lib/cts-merge';
// K12-F17 / F40 — the same server clock, projection and freshness contract
// the /board, /ribbon and /scorebug routes run (see "The clock contract"
// above).
import { serverClock } from '@/lib/server-clock';
import { acceptRevision, type LinkPhase } from '@/lib/sports-freshness';
import { noteRevisionShown, useSportsLink } from '@/hooks/use-sports-link';
import { overtimeLabel, projectCountdownMs, projectGameClockMs, sportForGame } from '@cms/api-types';

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
  /**
   * K12-F01 — the rules profile the game runs and its rules snapshot, as the
   * public board payload carries them. Every widget derives the game's
   * definition with `sportForGame(snapshot)` (@cms/api-types sports-rules.ts)
   * — NFHS soccer counts down, NFHS wrestling names its overtime periods.
   * Absent / null = a game created before profiles (the classic rules).
   */
  rulesProfile?: string | null;
  rules?: unknown;
  /**
   * K12-F40 — the game revision this payload shows (Game.version) and when it
   * was committed. A payload OLDER than one already shown is never applied.
   * Absent from APIs that predate revisions (then every payload applies).
   */
  revision?: number;
  updatedAt?: string;
  /**
   * The game's roster as the PUBLIC board payload carries it (the
   * `/sports/board/:id` response spreads through `applyCtsOverlay`
   * untouched). Optional: a snapshot from any other source may omit it,
   * and the school's public-roster settings may have already removed
   * names / numbers / photos server-side. Lineup + player-card widgets
   * read it; nothing else should.
   */
  roster?: Array<{
    id?: string;
    team?: string;
    name?: string;
    number?: string | null;
    position?: string | null;
    photoUrl?: string | null;
    stats?: Record<string, unknown> | null;
  }> | null;
}

export interface GameStateValue {
  snapshot: GameSnapshot | null;
  /**
   * The game clock at `nowMs` — THE projection (`projectGameClockMs`) of the
   * snapshot's anchor on the page's server clock. Ready to format with
   * `formatSportClock`.
   */
  liveClockMs: number;
  /**
   * K12-F17 — the server-clock instant this provider projects every clock at.
   * Secondary countdowns (shot clock, play clock, penalty timers) project at
   * it too: `projectCountdownMs(anchor, nowMs)` (see `subClockMs`). It ticks
   * ten times a second while any clock of the game runs and HOLDS while the
   * link is stale (K12-F40). 0 when there is no game.
   */
  nowMs: number;
  /**
   * K12-F40 — this provider's link, the same phases every live surface uses:
   * connecting · live · stale · recovering · paused. Only `'live'` may claim
   * to be live (a LIVE pill, a pulsing dot).
   */
  link: LinkPhase;
}

const GameStateContext = createContext<GameStateValue | null>(null);

const POLL_MS = 750;
/** The /board route's clock cadence — tenths need ten frames a second. */
const CLOCK_TICK_MS = 100;

function isRunningAnchor(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { running?: unknown }).running === true;
}

/**
 * Does any clock of this game run right now — the game clock, or any
 * secondary countdown anchor in its stats (a shot clock, a play clock that
 * runs while the game clock is stopped, a penalty timer)? Only then does the
 * provider tick; a stopped board costs no timer.
 */
export function hasRunningClock(snapshot: GameSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.clockRunning) return true;
  const stats = snapshot.stats;
  if (!stats || typeof stats !== 'object') return false;
  for (const key of Object.keys(stats)) {
    const v = (stats as Record<string, unknown>)[key];
    if (isRunningAnchor(v)) return true;
    if (Array.isArray(v) && v.some(isRunningAnchor)) return true;
  }
  return false;
}

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

  // Last RAW (pre-overlay) snapshot — kept so a 304's server-time sample
  // can re-run the CTS freshness merge against un-overlaid fields.
  // Overlaying an already-overlaid snapshot would freeze decayed CTS
  // values in place as if they were operator inputs.
  const rawSnapshot = useRef<GameSnapshot | null>(initial ?? null);

  // K12-F40 — the newest game revision shown, and for WHICH game: revisions
  // are per game, so a zone re-bound to another game starts over.
  const shown = useRef<{ gameId: string; revision: number } | null>(
    initial && typeof initial.revision === 'number' ? { gameId, revision: initial.revision } : null,
  );

  // K12-F40 — the freshness contract. A good read (200 or 304) keeps the
  // link live; eight seconds without one and it goes stale, and every clock
  // under this provider HOLDS where it stood until the next good read. The
  // hold is this provider's own (server-clock.ts), so it never releases the
  // /board route's hold or another zone's.
  const link = useSportsLink({ holdClocks: true });
  const markGood = link.markGood;

  // Poll the un-authed scoreboard endpoint at the same 750ms cadence
  // the /board/[gameId] page uses, so a template-driven board stays
  // perfectly in sync with cues / score changes / clock toggles — now
  // through the shared hardened engine (self-chaining so slow responses
  // never overlap, If-None-Match/304 revalidation when the API offers
  // an ETag, jittered 1.5/3/5s backoff; see lib/board-poll.ts). Every good
  // poll also samples the page's server clock (K12-F17).
  useEffect(() => {
    return startBoardPoll({
      url: `${API_URL}/sports/board/${encodeURIComponent(gameId)}`,
      intervalMs: POLL_MS,
      onPayload: (payload) => {
        const json = payload as GameSnapshot;
        // Never apply an OLDER revision than one already shown — another
        // API replica's one-second board cache can answer with the score of
        // a second ago (the /board route's rule, lib/sports-freshness.ts).
        const prev = shown.current && shown.current.gameId === gameId ? shown.current.revision : null;
        if (!acceptRevision(prev, json.revision)) return;
        if (typeof json.revision === 'number') {
          if (json.revision !== prev) noteRevisionShown('widgets', json);
          shown.current = { gameId, revision: json.revision };
        }
        rawSnapshot.current = json;
        // Same CTS source-of-truth merge the board/ribbon/scorebug run:
        // fresh CTS heartbeat → its score/clock/segment/shot-clock/
        // exclusions win; stale/absent → operator-input columns win.
        setSnapshot(applyCtsOverlay(json));
      },
      // 304 — body unchanged; advance serverTime on the RAW snapshot and
      // re-merge, so CTS freshness keeps decaying honestly across a long
      // 304 run. (The server-clock sample itself is taken by the engine.)
      onServerTime: (n) => {
        const raw = rawSnapshot.current;
        if (!raw) return;
        const next = { ...raw, serverTime: n };
        rawSnapshot.current = next;
        setSnapshot(applyCtsOverlay(next));
      },
      // A good read — a 200 OR a 304 — keeps the link live.
      onStatus: (s) => {
        if (s.online) markGood();
      },
    });
  }, [gameId, markGood]);

  // THE instant every clock under this provider is projected at: the page's
  // server clock (never the device's), re-read ten times a second while any
  // clock of the game runs. While the link is stale the server clock is held,
  // so this stands still — and so does every clock projected from it.
  const [nowMs, setNowMs] = useState<number>(() => serverClock.now());
  useEffect(() => {
    if (!snapshot) return;
    const tick = () => setNowMs(serverClock.now());
    tick();
    if (!hasRunningClock(snapshot)) return;
    const id = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [snapshot]);

  // The game's own definition, rules profile included (K12-F01) — the same
  // lookup the /board route uses. An unknown sport runs no clock ('none'):
  // a reading nobody can define is shown as stored, never invented.
  const def = useMemo(() => (snapshot ? sportForGame(snapshot) : undefined), [snapshot]);
  const liveClockMs = snapshot ? projectGameClockMs(snapshot, def ? def.clock.type : 'none', nowMs) : 0;

  const phase = link.state.phase;
  const value = useMemo<GameStateValue>(
    () => ({ snapshot, liveClockMs, nowMs, link: phase }),
    [snapshot, liveClockMs, nowMs, phase],
  );

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>;
}

/**
 * A secondary countdown — a shot clock, a play clock, one penalty timer, all
 * stored as `{ ms, at, running }` — at the provider's instant, with THE
 * projection every surface uses. 0 with no provider or no anchor.
 */
export function subClockMs(state: GameStateValue | null | undefined, anchor: unknown): number {
  if (!state || !anchor || typeof anchor !== 'object') return 0;
  return projectCountdownMs(anchor as { ms?: unknown; at?: unknown; running?: unknown }, state.nowMs);
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
 *
 * MOVED 2026-09-11 to `../render-surface.tsx` and re-exported here, so the
 * fitness / restaurant / retail / bar packs can read the same signal without
 * importing this module's board-poll / cts-merge / api-types dependencies.
 * It is one context object shared by both packs — see that file's header.
 * Every existing `from './GameStateContext'` import keeps working unchanged.
 */
export { RenderSurfaceProvider, useRenderSurface, type RenderSurface } from '../render-surface';
import { useRenderSurface } from '../render-surface';

// A stable module-level object (not re-created per render) so widgets that
// key effects off `state`/`state?.snapshot` via referential checks don't
// see a "new" phantom state every render. Represents "on a real screen,
// but no game is bound to this widget/zone yet."
// No game, so no link: 'connecting' claims nothing (never 'live').
const PHANTOM_UNBOUND_STATE: GameStateValue = { snapshot: null, liveClockMs: 0, nowMs: 0, link: 'connecting' };

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

// `fmtClock` (floor MM:SS, tenths on request) is GONE (K12-F17, 2026-09-27):
// it made a widget read 7:41 where the /board route read 7:42 for the same
// instant. Every game clock is `formatSportClock(def, ms)` (@cms/api-types),
// every shot / play clock `formatShotClockReading(ms)` (lib/game-clock-format).

/**
 * Sport-aware segment label — "Q3", "Inning 5 ▲", "Set 2", "1st Half", etc.
 * Pass the game's `rules` (K12-F01): an overtime period reads the rules' own
 * name — "OT", "OT2", or NFHS wrestling's "SV" / "TB1" / "TB2" / "UTB".
 */
export function fmtSegment(sport: string, segment: number, rules?: unknown): string {
  const def = sportForGame({ sport, rules });
  if (!def) return `Period ${segment}`;
  const ot = def.segment.name === 'Inning' ? null : overtimeLabel(def, segment);
  if (ot) return ot;
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
