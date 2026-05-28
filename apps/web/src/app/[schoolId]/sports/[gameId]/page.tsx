'use client';

/**
 * VenueOS Sports — Sprint 13. The operator game-day control surface.
 *
 * Entirely data-driven off the SportDefinition for the game's sport:
 * the score increments, the clock model, the segment structure, the
 * stat fields, and the celebration cues all come from one declarative
 * object in @cms/api-types. Adding a sport adds controls here for free.
 *
 * Every action writes through useGameControl() which PATCHes the API
 * and pushes the updated game straight into the query cache, so the
 * console reacts instantly; the 4s poll behind it is a reconcile net.
 *
 * v4 redesign: sticky statebar + 4 mode tabs so the live console is a
 * single no-scroll screen. Setup / Roster / Highlights tabs hold the
 * pre-game and between-game content that is rarely touched during play.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  Play,
  Pause,
  RotateCcw,
  Minus,
  Plus,
  Tv,
  Check,
  MonitorPlay,
  Star,
  RectangleHorizontal,
  ImageIcon,
  Volume2,
  Radio,
  Keyboard,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useGame,
  useGameControl,
  useGameScreens,
  useShowGameOnScreens,
  useHideGameFromScreens,
  useGameRoster,
  useGameEvents,
  useUndoGameEvent,
  useSponsors,
  useUpdateSponsor,
  useTemplates,
  type SponsorInput,
} from '@/hooks/use-api';
import { findSport, PLAYER_STATS } from '@cms/api-types';
import type { SportDefinition, SportStatField } from '@cms/api-types';
import { computeCtsStatus, type CtsStatus } from '@/lib/cts-merge';
import { RosterPanel } from './RosterPanel';
// CtsCuePanel kept in the repo (./CtsCuePanel.tsx) but no longer
// rendered as its own tab — the existing Celebrations panel inside
// Run-game mode now drives the CTS orchestrator via the cue feed.
import { CueLaunchpad } from './CueLaunchpad';
import { SponsorPanel } from './SponsorPanel';
import { RibbonPanel } from './RibbonPanel';
import { RibbonPresetsPanel } from './RibbonPresetsPanel';
import { RibbonImagesPanel } from './RibbonImagesPanel';
import { SurfacePreview } from './SurfacePreview';
import { SurfaceHealthPills } from './SurfaceHealthPills';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { RecentEventsRail } from './RecentEventsRail';

// ── constants ──────────────────────────────────────────────────

const GAME_STATUSES: { key: string; label: string }[] = [
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'PRE_GAME', label: 'Pre-game' },
  { key: 'LIVE', label: 'Live' },
  { key: 'HALFTIME', label: 'Halftime' },
  { key: 'FINAL', label: 'Final' },
];

type ConsoleMode = 'run' | 'setup';

/**
 * ?view query param — splits the single Run console into role-scoped layouts.
 *   score  — scorekeeper tablet: scoreboard + clock + stats only
 *   show   — show-caller tablet: surfaces + full CueLaunchpad always-on
 *   pa     — PA / announcer phone: spotlight + roster (read-only score/clock)
 *   (unset) — full default: today's all-up behaviour for existing users
 */
type ConsoleView = 'score' | 'show' | 'pa' | '';

// ── clock helpers ──────────────────────────────────────────────

function fmtClock(ms: number): string {
  // 2026-05-27 — operator bug 046d73aa: "they need to be perfectly
  // in sync, there is a delay from when I start the game clock to
  // when the shot clock starts...click start on game clock starts
  // the shot clock at the exact same time".
  //
  // Diagnosis: server already syncs both clocks atomically — the same
  // `now` writes both clockUpdatedAt and shotClock.at in one
  // transaction via syncShotClockToGameClock (sports.service.ts:1565).
  // The drift Greg perceives is a DISPLAY rounding mismatch: this
  // game-clock formatter used floor while the shot clock at line ~1108
  // uses Math.ceil. With floor, "4:00" appears for the 999ms BEFORE
  // the clock truly hits 4:00 (display shows what's elapsed); with
  // ceil, "4:00" appears DURING the 999ms of partial fourth minute
  // (display shows what remains, matching the shot clock's "20" /
  // "19" / ... countdown). The pro convention for COUNTDOWN clocks
  // is ceil — so "0:00" only appears when the clock is genuinely
  // expired, not for the last 999ms before expiration. (Floor on
  // a countdown clock is the convention for showing elapsed time,
  // which is the wrong question to ask of a game clock that's
  // counting toward zero.)
  //
  // Net visual change: game clock now sticks at "4:20" for 1000ms
  // before ticking to "4:19" — identical pixel-on-screen duration
  // as before, just labeled one tick "later." At the end of a
  // segment, "0:01" shows for 999ms before the buzzer (matches what
  // any Daktronics All Sport / shot clock has done forever); the
  // shot clock at 0 lines up with the game clock at its true zero.
  const safe = Math.max(0, ms);
  const totalSec = Math.ceil(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
}

/** Live clock projected from the stored anchor, ticking every 100ms. */
function useLiveClock(game: any, def: SportDefinition | undefined): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!game || !def) return;
    const anchorAt = new Date(game.clockUpdatedAt).getTime();
    const project = () => {
      if (!game.clockRunning || def.clock.type === 'none') {
        setMs(game.clockMs);
        return;
      }
      const elapsed = Date.now() - anchorAt;
      if (def.clock.type === 'countup') setMs(game.clockMs + elapsed);
      else setMs(Math.max(0, game.clockMs - elapsed));
    };
    project();
    if (!game.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [game?.clockMs, game?.clockRunning, game?.clockUpdatedAt, def]);
  return ms;
}

// ── page ───────────────────────────────────────────────────────

export default function GameControlPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR']}
      fallback={
        <div className="text-center py-24 text-sm text-slate-500">
          You don&rsquo;t have permission to run a game.
        </div>
      }
    >
      <GameControl />
    </RoleGate>
  );
}

function GameControl() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const schoolId = String(params?.schoolId || '');
  const gameId = String(params?.gameId || '');

  // ?view=score|show|pa — role-scoped layout. Unset = full default.
  const rawView = searchParams?.get('view') ?? '';
  const view: ConsoleView = (
    rawView === 'score' || rawView === 'show' || rawView === 'pa' ? rawView : ''
  );

  const setView = (v: ConsoleView) => {
    const url = new URL(window.location.href);
    if (v) url.searchParams.set('view', v);
    else url.searchParams.delete('view');
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const { data: game, isLoading, error } = useGame(gameId);
  const ctl = useGameControl(gameId);
  const def = useMemo(() => (game ? findSport((game as any).sport) : undefined), [game]);
  const liveMs = useLiveClock(game, def);

  const [mode, setMode] = useState<ConsoleMode>('run');
  const [showCues, setShowCues] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [showPenalties, setShowPenalties] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── Keyboard shortcuts (Run mode only) ────────────────────────
  // Gates on mode === 'run' so Setup-mode typing is never intercepted.
  // Also no-ops when focus is on any editable element (input /
  // textarea / select / contentEditable) so the operator can type
  // in clock-edit fields without mis-scoring.
  //
  // Key map:
  //   Space      — toggle clock start/stop
  //   h          — home +1
  //   a          — away +1
  //   Shift+H    — home −1
  //   Shift+A    — away −1
  //   1–9        — fire cue tile N (by position in def.celebrations)
  //   u          — undo last event (POST .../events/last/undo via
  //                useUndoGameEvent; we undo the most-recent undoable
  //                event returned by useGameEvents)
  //   r          — reset clock (warn-and-confirm via window.confirm —
  //                HoldChip can't be driven programmatically)
  //   t          — timeout home
  //   Shift+T    — timeout away
  //   ?          — open shortcut cheat-sheet modal
  //   Escape     — close modal (handled in modal itself)
  //
  // We capture a ref to the latest game + ctl so the effect closure
  // never stales — the listener is re-registered only when mode changes.
  const latestGame = useRef<any>(null);
  const latestDef = useRef(def);
  useEffect(() => { latestGame.current = game; }, [game]);
  useEffect(() => { latestDef.current = def; }, [def]);

  // We need the event list so `u` can undo the most recent undoable event.
  // Use the same hook RecentEventsRail uses — share the query cache, zero
  // extra fetches.
  const { data: recentEvents } = useGameEvents(gameId);
  const undoEvent = useUndoGameEvent(gameId);

  useEffect(() => {
    if (mode !== 'run') return;

    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in a form element or contentEditable.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Don't intercept browser shortcuts (Cmd/Ctrl + key).
      if (e.metaKey || e.ctrlKey) return;

      // ? — open cheat sheet (Shift + /)
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      // Space — toggle clock
      if (e.key === ' ') {
        e.preventDefault();
        const g = latestGame.current;
        if (!g) return;
        ctl.clock.mutate({ action: g.clockRunning ? 'pause' : 'start' });
        return;
      }

      // h / Shift+H — home score +1 / −1
      if (e.key === 'h') {
        e.preventDefault();
        ctl.score.mutate({ team: 'home', delta: 1 });
        return;
      }
      if (e.key === 'H') {
        e.preventDefault();
        ctl.score.mutate({ team: 'home', delta: -1 });
        return;
      }

      // a / Shift+A — away score +1 / −1
      if (e.key === 'a') {
        e.preventDefault();
        ctl.score.mutate({ team: 'away', delta: 1 });
        return;
      }
      if (e.key === 'A') {
        e.preventDefault();
        ctl.score.mutate({ team: 'away', delta: -1 });
        return;
      }

      // u — undo most recent undoable event
      if (e.key === 'u') {
        e.preventDefault();
        const first = recentEvents?.find((ev) => ev.undoable);
        if (first && !undoEvent.isPending) {
          undoEvent.mutate(first.id);
        }
        return;
      }

      // r — reset clock to segment start (warn-and-confirm)
      if (e.key === 'r') {
        e.preventDefault();
        if (window.confirm('Reset clock to segment start?')) {
          ctl.clock.mutate({ action: 'reset' });
        }
        return;
      }

      // t / Shift+T — timeout home / away
      if (e.key === 't') {
        e.preventDefault();
        ctl.callTimeout.mutate({ team: 'home' });
        return;
      }
      if (e.key === 'T') {
        e.preventDefault();
        ctl.callTimeout.mutate({ team: 'away' });
        return;
      }

      // 1–9 — fire cue tile N (0-indexed: key '1' → index 0)
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const d = latestDef.current;
        if (!d) return;
        const idx = parseInt(e.key, 10) - 1;
        const cue = d.celebrations[idx];
        if (cue) {
          ctl.cue.mutate({ key: cue.key, target: 'ALL' as any });
        }
        return;
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ctl, recentEvents, undoEvent]);

  // Stream overlay URL — copy to clipboard for OBS / vMix browser source.
  const [copied, setCopied] = useState(false);
  const copyOverlayUrl = () => {
    const url = `${window.location.origin}/scorebug/${gameId}`;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => window.open(url, '_blank'));
    } else {
      window.open(url, '_blank');
    }
  };

  // External score-feed credentials — copy the machine-to-machine ingest URL +
  // token so a Sportzcast/console-reader/custom feed can push live score/clock
  // without a dashboard login. Token is server-generated (HMAC); we fetch it.
  const [feedCopied, setFeedCopied] = useState(false);
  const copyFeedUrl = async () => {
    try {
      const c = await apiFetch<{ ingestUrl: string; token: string; curlExample: string }>(
        `/sports/games/${gameId}/feed-credentials`,
      );
      const block =
        `VenueOS live score feed\n` +
        `POST to: ${c.ingestUrl}\n` +
        `Header:   x-feed-token: ${c.token}\n` +
        `Fields:   homeScore, awayScore, clockMs, clockRunning, segment (any subset)\n\n` +
        `Test:\n${c.curlExample}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(block);
        setFeedCopied(true);
        setTimeout(() => setFeedCopied(false), 2200);
      } else {
        window.prompt('Copy the score-feed details:', block);
      }
    } catch {
      window.alert('Could not load the score-feed credentials. Try again.');
    }
  };

  if (isLoading) {
    return <div className="text-center py-24 text-sm text-slate-400">Loading game…</div>;
  }
  if (error || !game) {
    return (
      <div className="text-center py-24 text-sm text-slate-500">
        Game not found.
        <div className="mt-3">
          <Button variant="outline" onClick={() => router.push(`/${schoolId}/sports`)}>
            Back to Game Day
          </Button>
        </div>
      </div>
    );
  }
  if (!def) {
    return (
      <div className="text-center py-24 text-sm text-slate-500">
        Unknown sport &ldquo;{(game as any).sport}&rdquo;.
      </div>
    );
  }

  const g: any = game;
  const homeColor = g.homeColor || '#4f46e5';
  const awayColor = g.awayColor || '#dc2626';
  const isLive = g.status === 'LIVE';

  return (
    // 2026-05-27 — Single pane of glass. DashboardLayout wraps every
    // page in <main className="overflow-y-auto p-4 sm:p-6 md:p-8 pb-24
    // md:pb-8"> with a max-w-7xl mx-auto child — that's where every
    // scroll-issue complaint comes from. We negative-margin out of all
    // of that, claim the full main content area, then `overflow-hidden`
    // pins everything inside the viewport so the bottom Home/Away/
    // Celebrate rows always stay visible on every screen size.
    //
    // Height math: main = 100dvh − TopToolbar (~64px). dvh (dynamic
    // viewport height) handles iOS Safari URL-bar collapse correctly;
    // vh would over-claim and clip during scroll. We don't subtract the
    // SuperAdminBanner because it only renders for SUPER_ADMIN — for
    // every customer-facing operator the chrome is exactly 64px.
    <div className="-m-4 sm:-m-6 md:-m-8 -mb-24 md:-mb-8 flex flex-col h-[calc(100dvh-64px)] overflow-hidden bg-white">

      {/* 2026-05-27 — Top toolbar + mode tabs MERGED into one row.
          Operator: "what is stream overlay, score feed do? if we
          dont need them maybe we can move the run game and setup
          buttons up there and remove another line so the screen can
          come up more...trying to make everything in one pane of
          glass with zero scrolling".
          Dropped Stream overlay (broadcast scorebug URL for OBS) +
          Score feed (machine-to-machine ingest URL) — neither needed
          for the CTS-driven water polo install; the CtsBridge IS the
          score feed. Both endpoints stay in the API so they can be
          re-surfaced when a streaming customer needs them. */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white">
        <button
          onClick={() => router.push(`/${schoolId}/sports`)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Game Day</span>
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <div className="flex gap-1 flex-1 overflow-x-auto">
          {(
            [
              { key: 'run', label: 'Run game', icon: '▶' },
              { key: 'setup', label: 'Set up', icon: '⚙' },
            ] as { key: ConsoleMode; label: string; icon: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setMode(tab.key);
                setShowCues(false);
                setShowHighlights(false);
                setShowPenalties(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors shrink-0 ${
                mode === tab.key
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.key === 'run' && isLive && (
                <span className="ml-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => window.open(`/ribbon/${gameId}`, '_blank')}
            title="Open the stadium ribbon / fascia board in a new tab"
          >
            <RectangleHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Ribbon</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => window.open(`/board/${gameId}`, '_blank')}
            title="Open the scoreboard in a new tab"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Scoreboard</span>
          </Button>
          {mode === 'run' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Show keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
              <span className="hidden sm:inline">Keys</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── mode panels ───────────────────────────────────────── */}

      {/* RUN MODE — 3-zone no-scroll live console + undo rail.
          The rail is a collapsible 320px right panel that polls
          GET /events?limit=25 every 2 s and surfaces per-row Undo. */}
      {mode === 'run' && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <RunMode
            gameId={gameId}
            g={g}
            def={def}
            liveMs={liveMs}
            homeColor={homeColor}
            awayColor={awayColor}
            ctl={ctl}
            view={view}
            onViewChange={setView}
            onShowCues={() => setShowCues(true)}
            onHighlights={() => setShowHighlights(true)}
            onPenalties={() => setShowPenalties(true)}
          />
          {/* RecentEventsRail hidden in show/pa views where the extra
              column would crowd the reduced-control layout */}
          {(view === '' || view === 'score') && (
            <RecentEventsRail gameId={gameId} />
          )}
        </div>
      )}

      {/* CUE POPUP — fire a cue without leaving the Run screen. The
          Run console stays mounted underneath; picking a cue fires it
          and the popup auto-closes straight back to the game. */}
      {mode === 'run' && showCues && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-3 sm:items-center sm:p-4"
          onClick={() => setShowCues(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Fire a cue</h2>
              <button
                onClick={() => setShowCues(false)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <CueLaunchpad gameId={gameId} def={def} onFired={() => setShowCues(false)} />
          </div>
        </div>
      )}

      {/* SETUP MODE */}
      {mode === 'setup' && (
        <div className="flex-1 overflow-auto bg-slate-50">
          <div className="max-w-4xl mx-auto p-4 space-y-4">
            {/* game status */}
            <Section title="Game status">
              <div className="flex flex-wrap gap-2">
                {GAME_STATUSES.map((s) =>
                  /* Destructive: FINAL ends real-time mutations — hold-to-confirm */
                  s.key === 'FINAL' ? (
                    <HoldChip
                      key={s.key}
                      label={s.label}
                      ariaLabel="Mark game Final — ends real-time scoring"
                      onConfirm={() => ctl.status.mutate({ status: s.key })}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        g.status === s.key
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    />
                  ) : (
                    <button
                      key={s.key}
                      onClick={() => ctl.status.mutate({ status: s.key })}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        g.status === s.key
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  )
                )}
              </div>
            </Section>

            {/* 2026-05-27 — Roster moved here. Operator: "move roster
                under the setup, it doesnt need its own tab". The
                pre-game flow is Setup → set status, pair screens,
                load roster, configure ribbon — adding the roster
                inline keeps everything in one scrollable workflow. */}
            <Section title="Team rosters">
              <RosterPanel
                gameId={gameId}
                homeTeam={g.homeTeam}
                awayTeam={g.awayTeam}
                statKeys={PLAYER_STATS[g.sport] || []}
              />
            </Section>

            {/* T2-4 — Starting-lineup intro choreography.
                Fires a 'pregame-intro' CUE that takes over the
                scoreboard with per-player slots (photo + name +
                number + stats). Home and away buttons side by side.
                Long-press / tap the down-arrow for audio URL or away
                team — simple split-button pattern. */}
            <Section title="Pregame intro">
              <PregameIntroPanel gameId={gameId} ctl={ctl} game={g} />
            </Section>

            <Section title="Put it on your screens">
              <ScreenPushPanel gameId={gameId} />
            </Section>

            {/* 2026-05-27 — Per-game celebration-pack picker. Operator:
                "lets add these but keep the other ones we did so we can
                have multiple and decide what we want....maybe during
                setup you add the ones you want to show for the run
                game section". Stored on Game.stats.celebrationPack so
                the choice travels with the game record + both surfaces
                (scoreboard + ribbon) read the same value. */}
            <Section title="Celebration pack">
              <CelebrationPackPicker
                value={
                  ((g.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v1'
                    ? 'v1'
                    : 'v2') as 'v1' | 'v2'
                }
                onChange={(p) =>
                  ctl.stats.mutate({
                    stats: { celebrationPack: p } as Record<string, unknown>,
                  })
                }
              />
            </Section>

            {/* 2026-05-27 — CTS feed status pill. The operator wants
                to know at a glance whether the Colorado Time Systems
                console is broadcasting AND being accepted by the API.
                Three states:
                  • fresh  — green ring, "CTS connected — receiving"
                             (the scoreboard + ribbon show CTS data)
                  • stale  — amber ring, "CTS stale — using operator
                             inputs" (the operator's chips in Run mode
                             are the source of truth)
                  • never  — slate, "CTS not configured" (no snapshot
                             ever arrived; manual entry only)
                The pill auto-refreshes off the same `Game.stats.cts`
                field the public surfaces read; no extra fetch. */}
            <Section title="CTS scoreboard console">
              <CtsConsoleStatus
                stats={(g.stats as Record<string, unknown> | undefined) || {}}
              />
            </Section>

            <Section title="Live preview">
              <SurfacePreview gameId={gameId} />
            </Section>

            <Section title="Ribbon content">
              <RibbonPresetsPanel gameId={gameId} />
            </Section>

            <Section title="Ribbon messages">
              <RibbonPanel gameId={gameId} />
            </Section>

            <Section title="Ribbon images">
              <RibbonImagesPanel gameId={gameId} />
            </Section>

            <Section title="Ribbon sponsors">
              <SponsorPanel />
            </Section>

            {def.shotClock && (
              <Section title="Shot clock">
                <ShotClockSetup gameId={gameId} current={(g.stats || {}) as Record<string, unknown>} config={def.shotClock} />
              </Section>
            )}

            <SponsorSchedulingSection />

            {/* Sprint 13 — operator can swap the Scoreboard / Ribbon /
                Scorebug template anytime, even mid-game. Empty value
                ("Default") clears the FK on the game; the surface
                falls back to the hardcoded built-in layout. */}
            <Section title="Layouts">
              <LayoutsPanel g={g} ctl={ctl} />
            </Section>

            {/* Cue / celebration presentation — configured here before
                the game; firing the cues happens from the Run screen. */}
            <PresentationSettingsSection gameId={gameId} def={def} ctl={ctl} />
          </div>
        </div>
      )}

      {/* ROSTER MODE block removed 2026-05-27 — operator: "move roster
          under the setup, it doesnt need its own tab". The Team
          Rosters Section is now part of the Setup-mode panel above. */}

      {/* CTS Cues tab REMOVED 2026-05-26 — operator feedback: "seems
          like we are recreating shit we already have when really we just
          need to organize this screen better". The existing Run-game
          tab's Celebrations panel (with FIRE TO Everywhere/Scoreboard/
          Ribbon toggle + per-sport cue tiles) now drives the CTS
          orchestrator on the ribbon. One panel, one cue button, the
          cinematic plays. CtsCuePanel.tsx kept in the repo for a
          potential future "advanced cinematics" surface but not
          wired into the console nav. */}

      {/* HIGHLIGHTS POPUP — spotlight a player without leaving Run. The
          Run console stays mounted underneath; tapping a player puts
          them on the scoreboard AND the ribbon (2026-05-27 — ribbon now
          consumes Game.spotlight too) and the popup auto-closes. */}
      {mode === 'run' && showHighlights && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-3 sm:items-center sm:p-4"
          onClick={() => setShowHighlights(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Player spotlight</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Shows on the scoreboard AND in the ribbon rotation until cleared.
                </p>
              </div>
              <button
                onClick={() => setShowHighlights(false)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <SpotlightControl
              gameId={gameId}
              current={g.spotlight}
              onDone={() => setShowHighlights(false)}
            />
          </div>
        </div>
      )}

      {/* PENALTY BOX POPUP — send a player to the box / release one
          without leaving the Run screen. Adding a penalty auto-closes
          back to the game; the live box list stays one tap away. */}
      {mode === 'run' && showPenalties && def.penaltyBox && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-3 sm:items-center sm:p-4"
          onClick={() => setShowPenalties(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">{def.penaltyBox.label}</h2>
              <button
                onClick={() => setShowPenalties(false)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <PenaltyBoxControl
              def={def}
              g={g}
              homeColor={homeColor}
              awayColor={awayColor}
              ctl={ctl}
              onAdded={() => setShowPenalties(false)}
            />
          </div>
        </div>
      )}

      {/* KEYBOARD SHORTCUT CHEAT-SHEET MODAL — triggered by ? key or
          the Keys toolbar button. Closes on Escape or backdrop click.
          Lists every shortcut + brief description for the operator.
          Cue tile rows are dynamic — driven by def.celebrations so the
          table stays correct as sport definitions change. */}
      {mode === 'run' && showShortcuts && (
        <ShortcutCheatSheet
          def={def}
          onClose={() => setShowShortcuts(false)}
        />
      )}
    </div>
  );
}

// ── StateBar ───────────────────────────────────────────────────

function StateBar({
  g,
  def,
  liveMs,
  homeColor,
  awayColor,
  isLive,
}: {
  g: any;
  def: SportDefinition;
  liveMs: number;
  homeColor: string;
  awayColor: string;
  isLive: boolean;
}) {
  // For baseball/softball show inning + half from stats; for others show the clock.
  const isInning = def.segment.name === 'Inning';
  const stats: Record<string, unknown> = g.stats || {};
  const half = String(stats.half || 'Top').toLowerCase().startsWith('b') ? '▼' : '▲';

  // 2026-05-27 — Operator: "your showing the team names 3 times on
  // that page, we only need them on the scoreboard not 3 places".
  // Dropped team names from StateBar — the interactive scoreboard
  // below shows them in the tile (proper team identity, like the
  // real scoreboard render). StateBar is just the live-status pill
  // now; the tabs row below it owns navigation between Setup/Run/
  // Roster. Background also lightened — this is a thin status strip,
  // not a control surface.
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-slate-200 bg-white sticky top-0 z-10">
      <div className="flex-1" />
      {isLive ? (
        <div className="flex items-center gap-1.5 text-[11px] font-black text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
          LIVE
        </div>
      ) : (
        <div className="text-[11px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full shrink-0 uppercase tracking-widest">
          {g.status || 'scheduled'}
        </div>
      )}
    </div>
  );
}

// ── RunMode ────────────────────────────────────────────────────

function RunMode({
  gameId,
  g,
  def,
  liveMs,
  homeColor,
  awayColor,
  ctl,
  view,
  onViewChange,
  onShowCues,
  onHighlights,
  onPenalties,
}: {
  gameId: string;
  g: any;
  def: SportDefinition;
  liveMs: number;
  homeColor: string;
  awayColor: string;
  ctl: ReturnType<typeof useGameControl>;
  view: ConsoleView;
  onViewChange: (v: ConsoleView) => void;
  onShowCues: () => void;
  onHighlights: () => void;
  onPenalties: () => void;
}) {
  const isBaseballSoftball = def.key === 'baseball' || def.key === 'softball';
  const stats: Record<string, unknown> = g.stats || {};
  // How many players are currently serving time — drives the tray
  // badge for the penalty-box sports (hockey, lacrosse, …).
  const penaltyCount = def.penaltyBox ? livePenalties(stats).length : 0;

  // Single-level undo for score changes — the #1 operator mis-tap.
  // We keep the exact last score mutation so Undo applies its inverse.
  const [lastAction, setLastAction] = useState<string>('');
  const [lastScore, setLastScore] = useState<{ team: 'home' | 'away'; delta: number } | null>(null);

  const scoreHome = (d: number) => {
    ctl.score.mutate({ team: 'home', delta: d });
    setLastAction(`${g.homeTeam} ${d > 0 ? '+' + d : d}`);
    setLastScore({ team: 'home', delta: d });
  };
  const scoreAway = (d: number) => {
    ctl.score.mutate({ team: 'away', delta: d });
    setLastAction(`${g.awayTeam} ${d > 0 ? '+' + d : d}`);
    setLastScore({ team: 'away', delta: d });
  };
  const undoScore = () => {
    if (!lastScore) return;
    ctl.score.mutate({ team: lastScore.team, delta: -lastScore.delta });
    setLastScore(null);
    setLastAction('');
  };

  // ── View-role switcher pill row ──────────────────────────────
  // Sits at the top of Run mode so any operator can switch their
  // tablet to the right role without leaving the live console.
  const VIEW_PILLS: { key: ConsoleView; label: string; title: string }[] = [
    { key: '',      label: 'Full',        title: 'All controls — default for single-operator mode' },
    { key: 'score', label: 'Scorekeeper', title: 'Score + clock only — hide cues, roster, ribbon' },
    { key: 'show',  label: 'Show Caller', title: 'Surfaces + full cue launchpad — hide score controls' },
    { key: 'pa',    label: 'PA / Announcer', title: 'Spotlight + roster only — phone-friendly' },
  ];

  // ── Layout booleans derived from view ────────────────────────
  // `show` view: no score/clock controls, full inline CueLaunchpad,
  //              always-on SurfacePreview thumbnails.
  // `score` view: no cues, no roster bar, no ribbon preview.
  // `pa` view: no score/clock controls, no cues, read-only spotlight + roster.
  // default: everything (today's behaviour).
  const showScoreboard    = view !== 'show' && view !== 'pa';
  const showClockControls = view !== 'show' && view !== 'pa';
  const showRibbonPreview = view !== 'score' && view !== 'pa';
  const showRosterBar     = view !== 'score';
  const showInlineCues    = view !== 'show' && view !== 'pa' && view !== 'score';
  const showInlineLaunchpad = view === 'show';
  const showSurfacePreviews = view === 'show';
  const showPaSpotlight   = view === 'pa';
  const showBottomTray    = showClockControls && (isBaseballSoftball || def.key === 'football');

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── View-role switcher ────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1 shrink-0">
          View
        </span>
        {VIEW_PILLS.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.title}
            onClick={() => onViewChange(p.key)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors shrink-0 ${
              view === p.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* T1-6 — Per-surface health pill row. Always visible regardless
          of view — status is universal information. */}
      <SurfaceHealthPills gameId={gameId} />

      {/* ── PA / Announcer view ───────────────────────────────── */}
      {showPaSpotlight && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PaAnnouncerView
            gameId={gameId}
            g={g}
            def={def}
            ctl={ctl}
            homeColor={homeColor}
            awayColor={awayColor}
            liveMs={liveMs}
          />
        </div>
      )}

      {/* ── Show Caller view ──────────────────────────────────── */}
      {showSurfacePreviews && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ShowCallerView gameId={gameId} def={def} ctl={ctl} g={g} />
        </div>
      )}

      {/* ── Score / Full views — scrollable scoreboard + ribbon ── */}
      {!showPaSpotlight && !showSurfacePreviews && (
        <>
          <div className="min-h-0 overflow-y-auto">
            {showScoreboard && (
              <RunInteractiveScoreboard
                g={g}
                def={def}
                liveMs={liveMs}
                homeColor={homeColor}
                awayColor={awayColor}
                ctl={ctl}
              />
            )}
            {showRibbonPreview && <RunRibbonPreview gameId={gameId} />}
          </div>

          {/* Pinned bottom: roster + cues + sport-specific tray */}
          <div className="shrink-0">
            {showRosterBar && (
              <RunInlineRosterBar
                gameId={gameId}
                g={g}
                def={def}
                ctl={ctl}
                homeColor={homeColor}
                awayColor={awayColor}
              />
            )}
            {showInlineCues && (
              <RunInlineCuesBar gameId={gameId} g={g} def={def} ctl={ctl} />
            )}
            {showBottomTray && (
              <div className="flex items-stretch gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
                {isBaseballSoftball && (
                  <BaseTrayBall stats={stats} onStat={(s) => ctl.stats.mutate({ stats: s })} />
                )}
                {def.key === 'football' && (
                  <PlayClockBtn
                    stats={stats}
                    onAction={(a, v) => ctl.playClock.mutate({ action: a, value: v })}
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Role-specific view layouts ─────────────────────────────────

/**
 * ShowCallerView — ?view=show
 *
 * The second tablet at the scorer's table (or a dedicated show-caller).
 * Layout:
 *   Top: ribbon + scoreboard surface thumbnails side-by-side (SurfacePreview).
 *   Middle: full CueLaunchpad always-on (not a popup).
 *   Bottom: spotlight roster bar.
 *
 * Score controls, clock controls, and stat fields are hidden — the
 * show-caller cannot accidentally crash the scoreboard with a bad tap.
 */
function ShowCallerView({
  gameId,
  def,
  ctl,
  g,
}: {
  gameId: string;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
  g: any;
}) {
  const homeColor = g.homeColor || '#4f46e5';
  const awayColor = g.awayColor || '#dc2626';
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Surface thumbnails — scoreboard + ribbon iframes */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
          Live surfaces
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Scoreboard preview */}
          <div className="bg-slate-900 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                ● Scoreboard
              </span>
              <button
                type="button"
                onClick={() => window.open(`/board/${gameId}`, '_blank')}
                className="text-[9px] font-bold text-slate-400 hover:text-white flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                Full view
              </button>
            </div>
            <div className="bg-black overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                src={`/board/${gameId}?nochrome=1`}
                title="Scoreboard preview"
                className="w-full h-full block border-0"
                style={{ pointerEvents: 'none' }}
              />
            </div>
          </div>
          {/* Ribbon preview */}
          <div className="bg-slate-900 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                ● Ribbon
              </span>
              <button
                type="button"
                onClick={() => window.open(`/ribbon/${gameId}`, '_blank')}
                className="text-[9px] font-bold text-slate-400 hover:text-white flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                Full view
              </button>
            </div>
            <div className="bg-black overflow-hidden" style={{ aspectRatio: '7.5 / 1', maxHeight: '120px' }}>
              <iframe
                src={`/ribbon/${gameId}?nochrome=1`}
                title="Ribbon preview"
                className="w-full h-full block border-0"
                style={{ pointerEvents: 'none' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Full cue launchpad — always-on, not a popup */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
          Fire a cue
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <CueLaunchpad gameId={gameId} def={def} onFired={() => {}} />
        </div>
      </div>

      {/* Spotlight roster bar for the show-caller */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
          Player spotlight
        </div>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <RunInlineRosterBar
            gameId={gameId}
            g={g}
            def={def}
            ctl={ctl}
            homeColor={homeColor}
            awayColor={awayColor}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * PaAnnouncerView — ?view=pa
 *
 * Phone-friendly view for the PA / announcer.
 * Layout:
 *   Top: current spotlight read-only card (name, number, position).
 *   Middle: read-only score + clock strip (no controls).
 *   Bottom: roster with one-tap spotlight activation (no cue firing,
 *           no score changes, no clock controls).
 *
 * All write controls are hidden — the announcer can spotlight a player
 * but cannot change the score, clock, or fire cues.
 */
function PaAnnouncerView({
  gameId,
  g,
  def,
  ctl,
  homeColor,
  awayColor,
  liveMs,
}: {
  gameId: string;
  g: any;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
  homeColor: string;
  awayColor: string;
  liveMs: number;
}) {
  const sp = g?.spotlight && typeof g.spotlight === 'object' ? g.spotlight : {};
  const onAir = !!(sp.visible && sp.title);

  return (
    <div className="flex flex-col gap-4 p-4 max-w-lg mx-auto">
      {/* Current spotlight — read-only status card */}
      <div
        className={`rounded-xl border-2 p-4 transition-colors ${
          onAir ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'
        }`}
      >
        <div className="text-[10px] font-black uppercase tracking-widest mb-1.5 text-slate-400">
          On air — spotlight
        </div>
        {onAir ? (
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <div className="min-w-0">
              <div className="text-lg font-black text-amber-900 truncate">{sp.title}</div>
              {sp.subtitle && (
                <div className="text-xs font-semibold text-amber-700 truncate">{sp.subtitle}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => ctl.spotlight.mutate({ clear: true })}
              className="shrink-0 rounded-lg bg-amber-200 hover:bg-amber-300 px-3 py-1.5 text-xs font-black text-amber-900 transition-colors"
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="text-sm text-slate-400 italic">No spotlight active — tap a player below.</div>
        )}
      </div>

      {/* Read-only score + clock strip */}
      <div className="rounded-xl border border-slate-200 bg-slate-950 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Home score */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {g.homeTeam || 'Home'}
            </span>
            <span
              className="text-4xl font-black tabular-nums"
              style={{ color: homeColor }}
            >
              {g.homeScore}
            </span>
          </div>
          {/* Clock */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {def.segment.name} {g.segment}
            </span>
            <span className="text-3xl font-black tabular-nums text-amber-400">
              {def.clock.type !== 'none' ? fmtClock(liveMs) : '—'}
            </span>
            {g.clockRunning && (
              <span className="text-[9px] font-black text-emerald-400 animate-pulse mt-0.5">
                ● running
              </span>
            )}
          </div>
          {/* Away score */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {g.awayTeam || 'Away'}
            </span>
            <span
              className="text-4xl font-black tabular-nums"
              style={{ color: awayColor }}
            >
              {g.awayScore}
            </span>
          </div>
        </div>
      </div>

      {/* Roster — one-tap spotlight only. Celebrations and penalties
          are hidden; the announcer's only write action is spotlight. */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
          Tap to spotlight
        </div>
        <PaRosterPicker gameId={gameId} g={g} ctl={ctl} homeColor={homeColor} awayColor={awayColor} />
      </div>
    </div>
  );
}

/**
 * PaRosterPicker — compact grid of players for the PA view.
 * Single tap spotlights the player; a second tap on the same
 * player clears the spotlight. No cues, no penalties.
 */
function PaRosterPicker({
  gameId,
  g,
  ctl,
  homeColor,
  awayColor,
}: {
  gameId: string;
  g: any;
  ctl: ReturnType<typeof useGameControl>;
  homeColor: string;
  awayColor: string;
}) {
  const roster = useGameRoster(gameId);
  const players: any[] = Array.isArray(roster.data) ? roster.data : [];
  const home = players.filter((p) => p.team !== 'away');
  const away = players.filter((p) => p.team === 'away');
  const sp = g?.spotlight && typeof g.spotlight === 'object' ? g.spotlight : {};
  const onAirTitle = sp.visible && typeof sp.title === 'string' ? sp.title.trim().toLowerCase() : '';

  if (players.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
        Add players in Setup → Team Rosters to enable one-tap spotlight.
      </div>
    );
  }

  const renderTeam = (list: any[], color: string, teamName: string, isHome: boolean) => (
    <div className="mb-3">
      <div
        className="text-[10px] font-black uppercase tracking-widest mb-1.5"
        style={{ color }}
      >
        {isHome ? 'Home' : 'Away'} — {teamName}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((p) => {
          const playerName = String(p.name || '').trim();
          const onAir = playerName.toLowerCase() === onAirTitle;
          return (
            <button
              key={p.id}
              type="button"
              disabled={ctl.spotlight.isPending}
              onClick={() => {
                if (onAir) ctl.spotlight.mutate({ clear: true });
                else
                  ctl.spotlight.mutate({
                    visible: true,
                    title: playerName,
                    photoUrl: p.photoUrl || undefined,
                    subtitle:
                      [p.number ? `#${p.number}` : null, p.position]
                        .filter(Boolean)
                        .join(' · ') || undefined,
                  });
              }}
              className={
                onAir
                  ? 'flex items-center gap-1 rounded-lg border-2 px-3 py-2 text-xs font-black transition-colors disabled:opacity-50 bg-amber-50 border-amber-400 text-amber-900'
                  : 'flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-slate-50 disabled:opacity-50 bg-white text-slate-700'
              }
              style={onAir ? {} : { borderColor: color }}
            >
              {onAir && <span className="text-[9px] font-black text-amber-600">●</span>}
              {p.number ? (
                <span className="font-black" style={{ color: onAir ? undefined : color }}>
                  #{p.number}
                </span>
              ) : null}
              <span>{playerName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      {renderTeam(home, homeColor, g.homeTeam || 'Home', true)}
      {away.length > 0 && renderTeam(away, awayColor, g.awayTeam || 'Away', false)}
    </div>
  );
}

// ── Run-mode inline components ─────────────────────────────────
//
// 2026-05-27 — Three components surfaced INLINE inside Run mode so
// the operator never has to scroll or open a modal to drive a live
// game: live preview, quick-pick highlights, quick-fire cues.
// The original modal popups (showHighlights / showCues) stay around
// for power-user features (custom-builder spotlight, multi-target
// cue picker) — these inline bars are the fast path.

/** 2026-05-27 — Interactive scoreboard at the top of Run mode.
 *  Operator: "make it like your controlling the game right from the
 *  scoreboard itself…integrate the buttons all where they make sense
 *  so we can get to a single pane of glass to controll the entire
 *  screen…we will need to port this all to a mobile version".
 *
 *  Layout: 3-column grid (home score | clock + segment | away
 *  score) on desktop, vertical stack on mobile. Looks like a real
 *  scoreboard, controls baked in:
 *    - Home/Away tiles: huge tabular-numeric score + +/- buttons
 *      sized for thumbs.
 *    - Clock tile: segment label with −/+ chips, big MM:SS, START
 *      /STOP button right under the time, reset + clock-nudge
 *      chips for fine adjustments. Shot clock embedded below if
 *      the sport has one (water polo, basketball, lacrosse).
 *
 *  Replaces the old RunLivePreview (side-by-side iframes) — the
 *  ribbon preview moves to its own row below this. */
function RunInteractiveScoreboard({
  g,
  def,
  liveMs,
  homeColor,
  awayColor,
  ctl,
}: {
  g: any;
  def: SportDefinition;
  liveMs: number;
  homeColor: string;
  awayColor: string;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const stats: Record<string, unknown> = g.stats || {};
  const running = !!g.clockRunning;
  const hasClock = def.clock.type !== 'none';
  const segLabel = segmentText(def, g);
  // T2-8: possession from the first-class column (Game.possession),
  // falling back to stats.possession for backward compat with existing rows.
  const possessionValue: string =
    typeof (g as any).possession === 'string' && (g as any).possession
      ? (g as any).possession
      : typeof stats.possession === 'string'
        ? stats.possession
        : '';
  // Only basketball and football have a possession concept in their sport defs.
  const hasPossession =
    def.stats.some((s) => s.key === 'possession') &&
    (def.key === 'basketball' || def.key === 'football');
  return (
    <div className="bg-black px-3 py-4 border-b-2 border-slate-800">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-stretch max-w-6xl mx-auto">
        {/* HOME tile — looks like the actual scoreboard rendering */}
        <ScoreTile
          team={g.homeTeam}
          color={homeColor}
          logoUrl={g.homeLogoUrl}
          score={g.homeScore}
          side="home"
          increments={def.score.increments}
          onScore={(d) => ctl.score.mutate({ team: 'home', delta: d })}
          def={def}
          stats={stats}
          onStat={(s) => ctl.stats.mutate({ stats: s })}
          onTimeout={() => ctl.callTimeout.mutate({ team: 'home' })}
        />

        {/* CLOCK + SEGMENT tile — looks like the center column of a
            real scoreboard (segment label up top, big clock, subtle
            controls underneath). No green/red traffic-light start
            button; just a slim chip. */}
        <div className="flex flex-col items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 pt-5 pb-3 min-h-[280px] min-w-[240px]">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            {/* Destructive: resets clock to segment start — hold-to-confirm */}
            <HoldChip
              label="−"
              ariaLabel="Previous segment"
              onConfirm={() => ctl.segment.mutate({ delta: -1 })}
              className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center justify-center text-sm font-bold border border-slate-700"
            />
            <span className="min-w-[80px] text-center text-amber-400 text-sm font-black tracking-widest">
              {segLabel}
            </span>
            {/* Destructive: resets clock to segment start — hold-to-confirm */}
            <HoldChip
              label="+"
              ariaLabel="Next segment"
              onConfirm={() => ctl.segment.mutate({ delta: 1 })}
              className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center justify-center text-sm font-bold border border-slate-700"
            />
          </div>
          {hasClock ? (
            <>
              <div
                className={`text-7xl sm:text-8xl font-black tabular-nums leading-none my-3 ${
                  running ? 'text-amber-400' : 'text-white'
                }`}
              >
                {fmtClock(liveMs)}
              </div>
              {/* Subtle clock controls — start/stop, reset, ±1s as a
                  single row of chips. No giant green-button START. */}
              <div className="flex items-center gap-1.5 mt-1">
                <button
                  type="button"
                  onClick={() => ctl.clock.mutate({ action: running ? 'pause' : 'start' })}
                  className={
                    running
                      ? 'h-8 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-sm transition-colors border border-amber-700 flex items-center gap-1'
                      : 'h-8 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold text-sm transition-colors border border-emerald-700 flex items-center gap-1'
                  }
                  title={running ? 'Stop clock' : 'Start clock'}
                >
                  {running ? <><Pause className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start</>}
                </button>
                {/* Destructive: resets clock to segment start — hold-to-confirm */}
                <HoldChip
                  ariaLabel="Reset clock to segment start"
                  onConfirm={() => ctl.clock.mutate({ action: 'reset' })}
                  className="h-8 w-8 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm transition-colors border border-slate-700 flex items-center justify-center"
                >
                  <RotateCcw className="h-3 w-3" />
                </HoldChip>
                <button
                  type="button"
                  onClick={() => ctl.clock.mutate({ action: 'set', ms: Math.max(0, liveMs - 1000) })}
                  className="h-8 px-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold text-xs transition-colors border border-slate-700"
                  title="−1s"
                >
                  −1s
                </button>
                <button
                  type="button"
                  onClick={() => ctl.clock.mutate({ action: 'set', ms: liveMs + 1000 })}
                  className="h-8 px-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold text-xs transition-colors border border-slate-700"
                  title="+1s"
                >
                  +1s
                </button>
              </div>
            </>
          ) : (
            <div className="text-2xl font-black text-white my-3">{segLabel}</div>
          )}
          {/* Shot clock — water polo, basketball, lacrosse */}
          {def.shotClock && <RunShotClockMini stats={stats} def={def} ctl={ctl} />}

          {/* T2-8: Possession arrow chip — basketball and football only.
              Directional arrow shows who has the ball; tap to flip.
              Reads from Game.possession (first-class column); writes via
              the dedicated setPossession mutation, not the generic stats PATCH.
              Only shown for sports that have a possession concept in their def. */}
          {hasPossession && (
            <PossessionArrowChip
              value={possessionValue}
              homeTeam={g.homeTeam}
              awayTeam={g.awayTeam}
              sportKey={def.key}
              onFlip={(team) => ctl.setPossession.mutate({ team })}
            />
          )}
        </div>

        {/* AWAY tile */}
        <ScoreTile
          team={g.awayTeam}
          color={awayColor}
          logoUrl={g.awayLogoUrl}
          score={g.awayScore}
          side="away"
          increments={def.score.increments}
          onScore={(d) => ctl.score.mutate({ team: 'away', delta: d })}
          def={def}
          stats={stats}
          onStat={(s) => ctl.stats.mutate({ stats: s })}
          onTimeout={() => ctl.callTimeout.mutate({ team: 'away' })}
        />
      </div>
    </div>
  );
}

/** One team's tile — visually mirrors the actual LED scoreboard
 *  rendering. Operator: "make the score board look like the actual
 *  score board…get rid of the crazy big red and green buttons".
 *
 *  Layout matches the BoardScene render shown in the Setup preview:
 *    1. Team logo (centered, large)
 *    2. Team name (white, regular weight)
 *    3. HOME / AWAY caption (small caps, muted)
 *    4. Huge score number in team color
 *    5. Small subtle +/- chips at the bottom — not the giant
 *       traffic-light buttons that "looked dumb".
 *
 *  Buttons are deliberately understated — the controls should feel
 *  like part of the scoreboard, not a tablet skinned on top of it. */
function ScoreTile({
  team,
  color,
  logoUrl,
  score,
  side,
  increments,
  onScore,
  def,
  stats,
  onStat,
  onTimeout,
}: {
  team: string;
  color: string;
  logoUrl?: string | null;
  score: number;
  side: 'home' | 'away';
  increments: number[];
  onScore: (delta: number) => void;
  def: SportDefinition;
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number | string>) => void;
  /** When provided, renders a dedicated Timeout button next to the
   *  timeout count — fires callTimeout instead of raw stat edit. */
  onTimeout?: (type?: 'full' | 'short') => void;
}) {
  // 2026-05-27 — Per-team stat rows inside the tile. Operator: "i
  // wanted that integrated into the score boards cleanly some how".
  // Filter the sport-def stats for ones that belong to this side
  // (homeShots / awayShots / homeExclusions / awayExclusions /
  // homeTimeouts / awayTimeouts for water polo; home/away fouls
  // and timeouts for basketball; etc.). Each renders as a compact
  // LABEL  −  VALUE  +  row at the bottom of the tile.
  const prefix = side === 'home' ? 'home' : 'away';
  const sideStats = (def.stats || []).filter(
    (s) =>
      s.type === 'number' &&
      s.key.toLowerCase().startsWith(prefix) &&
      // Skip clock-related stats — the clock tile owns those.
      !s.key.toLowerCase().includes('clock'),
  );
  const shortLabel = (label: string) =>
    label.replace(/^(Home|Away)\s+/i, '').replace(/Timeouts/i, 'T.O.');
  return (
    <div className="flex flex-col items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 pt-3 pb-2 min-h-[220px]">
      {/* Team logo — large, centered (matches BoardScene proportion) */}
      <div className="flex items-center justify-center h-20 w-20">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="max-h-20 max-w-20 object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
      </div>
      {/* Team name + side caption — white text, side small-caps muted */}
      <div className="flex flex-col items-center mt-3">
        <span className="text-xl font-bold text-white truncate max-w-full" title={team}>
          {team || '—'}
        </span>
        <span className="text-[10px] font-black tracking-widest text-slate-500 mt-0.5">
          {side === 'home' ? 'HOME' : 'AWAY'}
        </span>
      </div>
      {/* Big score number — focal point, in team color. Compressed
          slightly so the tile fits in viewport without scroll. */}
      <div
        className="text-6xl sm:text-7xl font-black tabular-nums leading-none my-2"
        style={{ color }}
      >
        {score}
      </div>
      {/* Subtle +/- chips — small, neutral, sport-aware. Sits at the
          bottom of the tile so the tile itself looks like a scoreboard
          panel with quiet controls underneath. */}
      <div className="flex items-center gap-1.5 mt-1">
        {increments.map((inc) => (
          <button
            key={`+${inc}`}
            type="button"
            onClick={() => onScore(inc)}
            className="h-8 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors border border-slate-700"
            title={`Add ${inc}`}
          >
            +{inc}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onScore(-1)}
          className="h-8 w-8 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold text-sm transition-colors border border-slate-700"
          title="Subtract 1 (fix a mis-tap)"
        >
          −
        </button>
      </div>
      {/* Per-team stat rows — Shots, Exclusions, Timeouts for water
          polo; fouls + timeouts for basketball; etc. Compact: small
          label on the left, −value+ stepper on the right.
          Timeout rows get an additional "T.O." chip that fires
          callTimeout (pause clock + decrement + CUE) atomically. */}
      {sideStats.length > 0 && (
        <div className="w-full mt-3 pt-3 border-t border-slate-800 space-y-1">
          {sideStats.map((s) => {
            const value = Number(stats[s.key]) || 0;
            const min = s.min ?? 0;
            const max = s.max ?? 99;
            const canDec = value > min;
            const canInc = value < max;
            const isTimeoutStat = s.key.toLowerCase().includes('timeout');
            const atZero = value <= 0;
            return (
              <div key={s.key} className="flex items-center justify-between text-xs">
                <span className="font-black uppercase tracking-widest text-slate-500 text-[10px]">
                  {shortLabel(s.label)}
                </span>
                <div className="flex items-center gap-1">
                  {/* Timeout button — fires callTimeout (pause + decrement + CUE).
                      Styled as a compact amber chip matching the chip style
                      used elsewhere on the page (shot-clock reset, etc.).
                      Disabled when no timeouts remain. */}
                  {isTimeoutStat && onTimeout && (
                    <button
                      type="button"
                      onClick={() => onTimeout()}
                      disabled={atZero}
                      className="h-6 px-2 rounded bg-amber-800 hover:bg-amber-700 text-amber-200 text-[10px] font-black border border-amber-700 disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wide"
                      title={atZero ? 'No timeouts remaining' : `Call ${side} timeout`}
                    >
                      T.O.
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onStat({ [s.key]: Math.max(min, value - 1) })}
                    disabled={!canDec}
                    className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-bold border border-slate-700 disabled:opacity-30"
                    title={`−1 ${s.label}`}
                  >
                    −
                  </button>
                  <span className="font-black tabular-nums text-white w-7 text-center text-sm">
                    {value}
                  </span>
                  <button
                    type="button"
                    onClick={() => onStat({ [s.key]: Math.min(max, value + 1) })}
                    disabled={!canInc}
                    className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-bold border border-slate-700 disabled:opacity-30"
                    title={`+1 ${s.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Shot-clock mini inside the clock tile. Compact horizontal:
 *  current value + reset-to-30 / reset-to-20 / start / stop.
 *
 *  2026-05-27 — Operator: "these buttons dont seem to do anything".
 *  Fixed the action/key wiring that was silently no-op'ing every
 *  click:
 *    - Reads from stats.shotClock.{ms,running,at} (Prisma JSON
 *      nesting), NOT stats.shotClockMs / stats.shotClockRunning
 *      (which never existed — the values land under .shotClock).
 *    - Reset buttons send action:'reset' with a value (sec), not
 *      action:'set' which the API never handled.
 *    - Stop sends action:'stop', not 'pause' (also not handled).
 *    - Projects live ms from the .at timestamp so the displayed
 *      countdown actually counts down between polls instead of
 *      sitting on whatever value the last write produced. */
function RunShotClockMini({
  stats,
  def,
  ctl,
}: {
  stats: Record<string, unknown>;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const sc = (stats.shotClock as Record<string, unknown> | undefined) || {};
  const storedMs = typeof sc.ms === 'number' ? (sc.ms as number) : 0;
  const shotRunning = !!sc.running;

  // 2026-05-27 — operator bug 97f54357: "the time clock and the game
  // clock are not in sync, the time clock can not move forward if the
  // game clock is paused".
  //
  // Root cause: liveMs below is computed AT RENDER TIME from
  // Date.now(). It needs the parent to re-render for the displayed
  // number to count down. The parent's useLiveClock (line ~97) only
  // sets up its 100ms setInterval when game.clockRunning === true —
  // so when the game clock pauses, the parent stops re-rendering,
  // and the shot clock display freezes even though the SHOT clock is
  // still running in the DB.
  //
  // Fix: this component drives its OWN 200ms ticker whenever the
  // shot clock is running, INDEPENDENT of the game clock state.
  // Forces a re-render → liveMs recomputes → display ticks down.
  // 200ms is fine for a clock that displays whole seconds — at most
  // 1 frame of latency on the visible value.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!shotRunning) return;
    const t = setInterval(() => forceTick((n) => (n + 1) | 0), 200);
    return () => clearInterval(t);
  }, [shotRunning]);

  // Project the live remaining time when the clock is running so the
  // 30-second countdown actually ticks. Same projection the live
  // BoardScene + ribbon scorebug do.
  let liveMs = storedMs;
  if (shotRunning) {
    const at = new Date(String(sc.at || '')).getTime();
    if (Number.isFinite(at)) {
      liveMs = Math.max(0, storedMs - (Date.now() - at));
    }
  }
  const sec = Math.max(0, Math.ceil(liveMs / 1000));
  const fullSec = def.shotClock?.full ?? 30;
  const shortSec = def.shotClock?.short ?? 20;
  return (
    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-700 w-full">
      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Shot</span>
      <span className="text-xl font-black tabular-nums text-amber-400 leading-none min-w-[28px] text-center">
        {sec}
      </span>
      <button
        type="button"
        onClick={() => ctl.shotClock.mutate({ action: 'reset', value: fullSec })}
        className="h-7 px-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold"
        title={`Reset to ${fullSec}`}
      >
        {fullSec}
      </button>
      <button
        type="button"
        onClick={() => ctl.shotClock.mutate({ action: 'reset', value: shortSec })}
        className="h-7 px-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold"
        title={`Reset to ${shortSec}`}
      >
        {shortSec}
      </button>
      <button
        type="button"
        onClick={() => ctl.shotClock.mutate({ action: shotRunning ? 'stop' : 'start' })}
        className={
          shotRunning
            ? 'h-7 px-2 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-black'
            : 'h-7 px-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black'
        }
        title={shotRunning ? 'Stop' : 'Start'}
      >
        {shotRunning ? '⏸' : '▶'}
      </button>
    </div>
  );
}

/** Ribbon iframe in its own row, below the interactive scoreboard.
 *  Wide-short strip showing what the ribbon LED is rendering right
 *  now — sponsors, score, spotlight overlay, celebration cues. */
function RunRibbonPreview({ gameId }: { gameId: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return (
      <div className="flex items-center justify-end px-4 py-1 bg-slate-100 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800"
        >
          ▾ Show ribbon preview
        </button>
      </div>
    );
  }
  return (
    <div className="bg-slate-900 border-b border-slate-300 px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
          ● Ribbon — live
        </span>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white"
        >
          ▴ Hide
        </button>
      </div>
      {/* 2026-05-27 — Ribbon stretches full viewport width. Operator:
          "make the ribbon stretch full screen when i have my window
          maximized…the more i can see the more it looks like the real
          ribbon". Edge-to-edge of the viewport (negative margins pull
          past the wrapper padding). Height is driven by the 7.5:1
          aspect ratio but capped at 220px so the bars below stay
          pinned to the viewport. `flex-shrink` lets the preview
          compress on smaller windows so the home/away/celebrate rows
          never get pushed below the fold. */}
      <div
        className="bg-black overflow-hidden -mx-3 sm:-mx-3 shrink"
        style={{ aspectRatio: '7.5 / 1', maxHeight: '140px' }}
      >
        <iframe
          src={`/ribbon/${gameId}?nochrome=1`}
          title="Ribbon preview"
          className="w-full h-full block border-0"
          style={{ pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}

/** 2026-05-27 — Roster bar with HOME + AWAY rows. Operator: "we need
 *  the home team spotlights and the away team so maybe two rows and
 *  then you only see the celebrations or penalties when you pick a
 *  name, it pops up a little window to selct what you want to
 *  activate, needs to be smooth quick and clear".
 *
 *  Each player tile is a SINGLE tap → opens a small popover with
 *  options for that player:
 *    - ★ Spotlight (toggles on / off — what was the old default tap)
 *    - Sport celebrations (GOAL, Save, Exclusion, Power Play for
 *      water polo). Fires with player as scorer attribution.
 *    - ⏱ Send to penalty box (for water polo / hockey / lacrosse).
 *    - ✕ Cancel
 *
 *  Spotlight is the FIRST option so intros (rapid spotlight switching
 *  between players) is still 2 taps — tap player, tap Spotlight. Same
 *  beat count as the old workflow but now penalty / celebration are
 *  also one tap away. */
function RunInlineRosterBar({
  gameId,
  g,
  def,
  ctl,
  homeColor,
  awayColor,
}: {
  gameId: string;
  g: any;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
  homeColor: string;
  awayColor: string;
}) {
  const roster = useGameRoster(gameId);
  const players: any[] = Array.isArray(roster.data) ? roster.data : [];
  const home = players.filter((p) => p.team !== 'away');
  const away = players.filter((p) => p.team === 'away');
  const sp = g?.spotlight && typeof g.spotlight === 'object' ? g.spotlight : {};
  const onAirTitle = sp.visible && typeof sp.title === 'string' ? sp.title.trim().toLowerCase() : '';
  const [activePlayer, setActivePlayer] = useState<any | null>(null);

  if (players.length === 0) {
    return (
      <div className="px-4 py-2 border-t border-slate-200 bg-amber-50 text-[11px] text-amber-700">
        ★ Add players in the Roster tab to enable one-tap spotlight.
      </div>
    );
  }

  const renderRow = (
    label: string,
    color: string,
    list: any[],
    isHome: boolean,
  ) => (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <div className="flex flex-col leading-tight shrink-0 w-20">
        <span
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color }}
        >
          {isHome ? 'HOME' : 'AWAY'}
        </span>
        <span className="text-[10px] text-slate-500 truncate">{label}</span>
      </div>
      <div className="flex gap-1.5 flex-wrap overflow-x-auto">
        {list.length === 0 ? (
          <span className="text-[11px] text-slate-400 italic">No roster yet</span>
        ) : (
          list.map((p) => {
            const playerName = String(p.name || '').trim();
            const onAir = playerName.toLowerCase() === onAirTitle;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePlayer(p)}
                disabled={ctl.spotlight.isPending || ctl.cue.isPending}
                title={onAir ? 'On air — tap for actions' : `Tap to spotlight or celebrate ${p.name}`}
                className={
                  onAir
                    ? 'flex items-center gap-1 rounded-md border-2 px-2 py-1 ring-2 transition-colors disabled:opacity-50 shrink-0 bg-amber-50 ring-amber-300'
                    : 'flex items-center gap-1 rounded-md border bg-white px-2 py-1 transition-colors hover:bg-slate-50 disabled:opacity-50 shrink-0'
                }
                style={onAir ? { borderColor: '#f59e0b' } : { borderColor: color }}
              >
                {onAir && <span className="text-[9px] font-black text-amber-700">●</span>}
                {p.number ? (
                  <span className="text-[10px] font-black" style={{ color }}>
                    #{p.number}
                  </span>
                ) : null}
                <span
                  className={
                    onAir
                      ? 'text-xs font-bold text-amber-900'
                      : 'text-xs font-semibold text-slate-700'
                  }
                >
                  {p.name}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="border-t border-slate-200 bg-slate-50">
      {renderRow(g.homeTeam || 'Home', homeColor, home, true)}
      <div className="border-t border-slate-100" />
      {renderRow(g.awayTeam || 'Away', awayColor, away, false)}
      {activePlayer && (
        <PlayerActionMenu
          player={activePlayer}
          spotlight={sp}
          def={def}
          ctl={ctl}
          color={
            activePlayer.team === 'away' ? awayColor : homeColor
          }
          onClose={() => setActivePlayer(null)}
        />
      )}
    </div>
  );
}

/** Player action menu — appears when the operator taps a player tile.
 *  Centered modal with the actions stacked vertically for fat-finger
 *  speed. Spotlight is the primary action (top, biggest). Sport
 *  celebrations + penalty come next. Tap outside or ✕ to dismiss.
 *
 *  Each action also CLOSES the menu so the operator gets back to the
 *  roster quickly — keeping the intro-switching tempo intact. */
function PlayerActionMenu({
  player,
  spotlight,
  def,
  ctl,
  color,
  onClose,
}: {
  player: any;
  spotlight: any;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
  color: string;
  onClose: () => void;
}) {
  const playerName = String(player.name || '').trim() || 'Player';
  const onAir =
    spotlight.visible &&
    typeof spotlight.title === 'string' &&
    spotlight.title.trim().toLowerCase() === playerName.toLowerCase();

  const buildSpotlightPayload = () => ({
    visible: true,
    title: playerName,
    photoUrl: player.photoUrl || undefined,
    subtitle:
      [player.number ? `#${player.number}` : null, player.position].filter(Boolean).join(' · ') ||
      undefined,
    lines: Object.entries(player.stats || {})
      .slice(0, 4)
      .map(([label, value]) => ({ label: String(label), value: String(value) })),
  });

  const onToggleSpotlight = () => {
    if (onAir) ctl.spotlight.mutate({ clear: true });
    else ctl.spotlight.mutate(buildSpotlightPayload());
    onClose();
  };
  const onFire = (cueKey: string) => {
    // 2026-05-27 — Operator: "i want their name mixed into the
    // celebration animation, not just poping up a standard spotlight
    // after the celebration". Removed the auto-spotlight side effect.
    // The cinematic ALREADY renders the player's name + number as
    // part of its lower-third (water polo goal shows "SCORED BY #99
    // GREG SCHIEMANN" in gold; deck cues swap sub2 to the scorer
    // line). The post-celebration spotlight overlay was redundant and
    // visually competed with the cinematic. Operator can still
    // explicitly spotlight from the same popover with the ★ button.
    ctl.cue.mutate({
      key: cueKey,
      target: 'ALL' as any,
      scorerName: playerName,
      scorerNumber: player.number ? String(player.number) : undefined,
      scorerPhotoUrl: player.photoUrl || undefined,
      scorerId: player.id || undefined,
    });
    onClose();
  };
  const onPenalty = () => {
    // Append a penalty to the game's stats.penalties array.
    const currentStats = (ctl as any)._game?.stats || {};
    const current = Array.isArray(currentStats.penalties) ? currentStats.penalties : [];
    const pb = def.penaltyBox;
    const sec = pb?.presets?.[0]?.sec || 20;
    const next = [
      ...current,
      {
        id: `pen-${Date.now()}`,
        team: player.team === 'away' ? 'away' : 'home',
        label: pb?.presets?.[0]?.label || `Penalty :${sec}`,
        player: playerName,
        number: player.number || '',
        ms: sec * 1000,
        running: true,
        at: new Date().toISOString(),
      },
    ];
    ctl.stats.mutate({ stats: { penalties: next } });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — player identity with team color stripe */}
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-100">
          <div
            className="h-10 w-1.5 rounded-full shrink-0"
            style={{ background: color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-base font-black text-slate-900 truncate">
              {player.number ? `#${player.number} ` : ''}
              {playerName}
            </div>
            {player.position && (
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {player.position}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Spotlight — primary action, biggest tile, toggles on/off */}
        <button
          type="button"
          onClick={onToggleSpotlight}
          className={
            onAir
              ? 'w-full h-12 rounded-lg bg-amber-100 border-2 border-amber-500 text-amber-900 font-black text-sm hover:bg-amber-200 transition-colors mb-2'
              : 'w-full h-12 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black text-sm transition-colors mb-2'
          }
        >
          {onAir ? '● ON AIR — Tap to clear spotlight' : '★ Spotlight on board + ribbon'}
        </button>

        {/* Sport celebrations — fires with player attribution */}
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {def.celebrations.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onFire(c.key)}
              className="h-11 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>{c.emoji}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        {/* Penalty — sports with a penalty box only */}
        {def.penaltyBox && (
          <button
            type="button"
            onClick={onPenalty}
            className="w-full h-11 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition-colors mb-1"
          >
            ⏱ {def.penaltyBox.presets?.[0]?.label || 'Send to penalty box'}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs transition-colors mt-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Quick-fire cue tiles always visible in Run mode. The full launchpad
 *  (target picker, custom cues) stays available behind the Cues
 *  button in the bottom tray; this inline bar is the one-tap path
 *  for the sport's built-in celebrations, broadcasting to ALL
 *  surfaces by default.
 *
 *  2026-05-27 — when a player is currently spotlit, every cue fired
 *  through this bar attaches that player as the scorer. So if the
 *  operator has Greg on the spotlight and taps GOAL, the cinematic
 *  fires with "GOAL!  SCORED BY #99 GREG SCHIEMANN" and his cap
 *  number. No spotlight → cue fires generic.
 */
function RunInlineCuesBar({
  gameId,
  g,
  def,
  ctl,
}: {
  gameId: string;
  g: any;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const roster = useGameRoster(gameId);
  const players: any[] = Array.isArray(roster.data) ? roster.data : [];
  const sp = g?.spotlight && typeof g.spotlight === 'object' ? g.spotlight : {};
  const spotName =
    sp.visible && typeof sp.title === 'string' ? sp.title.trim().toLowerCase() : '';
  const scorerPlayer = spotName
    ? players.find((p) => String(p?.name || '').trim().toLowerCase() === spotName) || null
    : null;
  const scorerLabel = scorerPlayer
    ? `${scorerPlayer.number ? `#${scorerPlayer.number} ` : ''}${scorerPlayer.name}`
    : sp.title || '';

  const [lastFiredKey, setLastFiredKey] = useState<string>('');
  // T2-6 — target chip: which surfaces receive the cue from the fast
  // path. Persists for the session (local state, not sessionStorage —
  // page reloads are rare mid-game and state loss is low-consequence).
  const [cueTarget, setCueTarget] = useState<'ALL' | 'BOARD' | 'RIBBON'>('ALL');

  const fire = (key: string) => {
    ctl.cue.mutate({
      key,
      target: cueTarget as any,
      // T2-6 — when firing to the ribbon only, signal the ribbon page
      // to use the tight 2.5s RibbonCelebrationStrip instead of the
      // full 4500ms cinematic. The server also sets this automatically
      // when target === 'RIBBON', but include it here for clarity.
      ...(cueTarget === 'RIBBON' ? { ribbonStrip: true } : {}),
      // If a player is on the spotlight, attribute the cue to them so
      // the cinematic shows "SCORED BY #12 SMITH". scorerPlayer is the
      // roster row (with .number, .photoUrl, .id); if the operator
      // only has a custom-built spotlight (no matching roster entry),
      // fall back to the spotlight title only.
      scorerName: scorerPlayer?.name || (sp.title || undefined),
      scorerNumber: scorerPlayer?.number ? String(scorerPlayer.number) : undefined,
      scorerPhotoUrl: scorerPlayer?.photoUrl || sp.photoUrl || undefined,
      scorerId: scorerPlayer?.id || undefined,
    });
    setLastFiredKey(key);
    setTimeout(() => setLastFiredKey((k) => (k === key ? '' : k)), 1500);
  };

  // T2-6 chip config — label, value, description for the title attr.
  const targetChips: Array<{
    value: 'ALL' | 'BOARD' | 'RIBBON';
    label: string;
    title: string;
  }> = [
    { value: 'ALL',    label: 'All',    title: 'Fire to every surface (scoreboard + ribbon + scorebug)' },
    { value: 'BOARD',  label: 'Board',  title: 'Fire to the scoreboard only — ribbon stays on its rotation' },
    { value: 'RIBBON', label: 'Ribbon', title: 'Fire a tight 2.5s text-crawl to the ribbon only — board is unaffected' },
  ];

  return (
    <div className="px-4 py-2 border-t border-slate-200 bg-indigo-50">
      {/* T2-6 — target chip row: All / Board / Ribbon */}
      <div className="flex items-center mb-1.5" style={{ marginBottom: 6 }}>
        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 shrink-0" style={{ marginRight: 8 }}>
          Send to
        </span>
        <div className="flex" style={{ marginRight: 0 }}>
          {targetChips.map((chip) => {
            const active = cueTarget === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                title={chip.title}
                onClick={() => setCueTarget(chip.value)}
                className={
                  active
                    ? 'px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide rounded-full bg-indigo-600 text-white border border-indigo-600 transition-colors shrink-0'
                    : 'px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-100 transition-colors shrink-0'
                }
                style={{ marginRight: 4 }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        {cueTarget === 'RIBBON' && (
          <span className="text-[9px] text-indigo-400 italic" style={{ marginLeft: 6 }}>
            2.5s crawl
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex flex-col leading-tight shrink-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">
            ⊞ Celebrate
          </span>
          <span className="text-[10px] text-indigo-500">
            {scorerLabel ? (
              <>
                Will attribute to <strong className="text-indigo-700">{scorerLabel}</strong>
              </>
            ) : cueTarget === 'ALL' ? (
              'Fires on every screen'
            ) : cueTarget === 'BOARD' ? (
              'Scoreboard only'
            ) : (
              'Ribbon only — tight crawl'
            )}
          </span>
        </div>
        <div className="flex gap-1.5 flex-wrap overflow-x-auto">
          {def.celebrations.map((c) => {
            const justFired = lastFiredKey === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => fire(c.key)}
                disabled={ctl.cue.isPending}
                title={
                  scorerLabel
                    ? `Fire ${c.label} → ${cueTarget} — attributed to ${scorerLabel}`
                    : `Fire ${c.label} → ${cueTarget}`
                }
                className={
                  justFired
                    ? 'flex items-center gap-1 rounded-md bg-indigo-600 text-white px-3 py-1.5 font-bold text-xs ring-2 ring-indigo-300 transition-colors shrink-0'
                    : 'flex items-center gap-1 rounded-md bg-white border border-indigo-300 px-3 py-1.5 font-bold text-xs text-indigo-700 hover:bg-indigo-100 transition-colors shrink-0 disabled:opacity-50'
                }
              >
                <span>{c.emoji}</span>
                <span>{c.label}</span>
                {justFired && <span className="text-[9px] font-black">✓ FIRED</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Penalty box ────────────────────────────────────────────────

/** A penalty as the operator console sees it — projected live off
 *  its stored anchor, expired ones dropped, soonest-out first. */
type LivePenalty = {
  id: string;
  team: 'home' | 'away';
  label: string;
  player: string;
  ms: number;
};

/** Project every penalty in a game's stats to its live remaining
 *  time. Operator-side — no server-skew correction (a few hundred ms
 *  is invisible on a control surface; the scoreboard projects with
 *  skew correction for the crowd). */
function livePenalties(stats: Record<string, unknown>): LivePenalty[] {
  const raw = Array.isArray(stats.penalties) ? (stats.penalties as unknown[]) : [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => {
      let ms = Math.max(0, Number(p.ms) || 0);
      if (p.running) {
        const at = new Date(String(p.at || '')).getTime();
        if (Number.isFinite(at)) ms = Math.max(0, ms - (Date.now() - at));
      }
      return {
        id: String(p.id || ''),
        team: p.team === 'away' ? ('away' as const) : ('home' as const),
        label: String(p.label || ''),
        player: String(p.player || ''),
        ms,
      };
    })
    .filter((p) => p.id && p.ms > 0)
    .sort((a, b) => a.ms - b.ms);
}

/** MM:SS, ceil to the second — a penalty reads "0:01" right up to
 *  the instant it clears. */
function fmtBoxTime(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * PenaltyBoxControl — the popup body. Pick the team, optionally the
 * player number, then tap a duration to send them to the box; that
 * auto-closes back to the game. The active box lists everyone
 * serving time with a live countdown and a Release button (a
 * power-play goal ends a minor early).
 */
function PenaltyBoxControl({
  def,
  g,
  homeColor,
  awayColor,
  ctl,
  onAdded,
}: {
  def: SportDefinition;
  g: any;
  homeColor: string;
  awayColor: string;
  ctl: ReturnType<typeof useGameControl>;
  onAdded: () => void;
}) {
  const box = def.penaltyBox!;
  const [team, setTeam] = useState<'home' | 'away'>('home');
  const [player, setPlayer] = useState('');

  // Tick so the active-box countdowns stay live while the popup is open.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const stats: Record<string, unknown> = g.stats || {};
  const live = livePenalties(stats);

  const add = (preset: { label: string; sec: number }) => {
    ctl.penalties.mutate({
      action: 'add',
      team,
      lenSec: preset.sec,
      label: preset.label,
      player: player.trim(),
    });
    setPlayer('');
    onAdded();
  };

  return (
    <div className="space-y-4">
      {/* which team */}
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-500">Penalty against</div>
        <div className="grid grid-cols-2 gap-2">
          {(['home', 'away'] as const).map((t) => {
            const sel = team === t;
            const c = t === 'home' ? homeColor : awayColor;
            const nm = t === 'home' ? g.homeTeam : g.awayTeam;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTeam(t)}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                  sel ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
                style={sel ? { background: c, borderColor: c } : { borderColor: '#e2e8f0' }}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c }} />
                <span className="truncate">{nm}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* player number */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-500">
          Player number <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <Input
          value={player}
          onChange={(e) => setPlayer(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          inputMode="numeric"
          placeholder="e.g. 12"
          className="w-28 text-center text-lg font-bold"
        />
      </div>

      {/* duration → fires the add, then auto-closes */}
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-500">
          Tap a duration to send the player to the box
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {box.presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => add(p)}
              className="flex flex-col items-center justify-center rounded-xl bg-rose-600 px-2 py-3 text-white transition-colors hover:bg-rose-700"
            >
              <span className="text-base font-black tabular-nums">
                {fmtBoxTime(p.sec * 1000)}
              </span>
              <span className="text-[11px] font-semibold text-rose-100">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* the active box */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">
            In the box ({live.length})
          </span>
          {live.length > 0 && (
            <button
              type="button"
              onClick={() => ctl.penalties.mutate({ action: 'clear' })}
              className="text-xs font-semibold text-slate-400 hover:text-rose-600"
            >
              Clear all
            </button>
          )}
        </div>
        {live.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
            The box is empty.
          </div>
        ) : (
          <div className="space-y-2">
            {live.map((p) => {
              const c = p.team === 'home' ? homeColor : awayColor;
              const nm = p.team === 'home' ? g.homeTeam : g.awayTeam;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">{nm}</span>
                    {p.player ? (
                      <span className="ml-1.5 font-black text-slate-900">#{p.player}</span>
                    ) : null}
                    {p.label ? <span className="ml-1.5 text-slate-400">{p.label}</span> : null}
                  </span>
                  <span
                    className={`text-lg font-black tabular-nums ${
                      p.ms <= 10_000 ? 'text-rose-600' : 'text-slate-900'
                    }`}
                  >
                    {fmtBoxTime(p.ms)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      ctl.penalties.mutate({ action: 'remove', penaltyId: p.id })
                    }
                    className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-rose-100 hover:text-rose-700"
                  >
                    Release
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Penalty clocks run and freeze with the game clock — start the clock and
        every penalty counts down with it. &ldquo;Release&rdquo; pulls a player
        out early (a power-play goal ends a minor).
      </p>
    </div>
  );
}

// ── TeamZone ───────────────────────────────────────────────────

function TeamZone({
  label,
  score,
  color,
  side,
  increments,
  onScore,
  def,
  stats,
  onStat,
}: {
  label: string;
  score: number;
  color: string;
  side: 'home' | 'away';
  increments: number[];
  onScore: (d: number) => void;
  def: SportDefinition;
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number | string>) => void;
}) {
  const isHome = side === 'home';
  const isBaseballSoftball = def.key === 'baseball' || def.key === 'softball';

  // Which stats belong to this zone?
  // Home zone: shared stats + home-specific (fouls, etc.)
  // Away zone: away-team stats only (hits, errors for baseball)
  // For simplicity: home zone shows all shared stats, away shows away-specific ones.
  // The actual field list comes from the sport def; we label by key prefix convention.
  const zoneStats = def.stats.filter((s) => {
    if (isBaseballSoftball) {
      // For baseball the count is in the tray; zone shows hits/errors split by side
      if (isHome) return ['hits', 'lob'].includes(s.key);
      return ['hits_away', 'errors'].includes(s.key);
    }
    // For basketball/football/etc: home zone shows shared stats
    if (isHome) return !s.key.startsWith('away_');
    return s.key.startsWith('away_');
  });

  // Initial letter of the team for the logo avatar
  const initial = label.trim().charAt(0).toUpperCase();

  return (
    <div
      className={`flex-1 flex flex-col p-4 ${isHome ? 'border-r border-slate-200' : ''}`}
      style={{
        backgroundColor: `${color}10`,
        borderTop: `4px solid ${color}`,
      }}
    >
      {/* zone header — team identity + side label.
          2026-05-27 — score number + score buttons were here previously
          but lived in two other places (StateBar + the new
          RunInteractiveScoreboard). Operator: "the score shows 4 times
          in this little area, we need just one on the score board and
          one on the ribbon score". This zone is now stat-tray-only;
          all score control lives in the interactive scoreboard up top. */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-black text-lg shrink-0"
          style={{ backgroundColor: color }}
        >
          {initial}
        </span>
        <span className="text-lg font-black truncate" style={{ color }}>
          {label}
        </span>
        <span className="ml-auto text-[10px] font-black tracking-widest text-slate-400">
          {isHome ? 'HOME' : 'AWAY'}
        </span>
      </div>

      {/* quick-stat chips — sport-specific inline controls */}
      {!isBaseballSoftball && def.stats.length > 0 && (
        <QuickStatChips def={def} stats={stats} onStat={onStat} side={side} />
      )}

      {/* baseball: show hits/errors for each side */}
      {isBaseballSoftball && zoneStats.length > 0 && (
        <div className="flex gap-2 mt-auto">
          {zoneStats.map((s) => (
            <StatChip
              key={s.key}
              label={s.label}
              value={stats[s.key]}
              onAdd={() => {
                const cur = typeof stats[s.key] === 'number' ? (stats[s.key] as number) : 0;
                onStat({ [s.key]: cur + 1 });
              }}
              onSub={() => {
                const cur = typeof stats[s.key] === 'number' ? (stats[s.key] as number) : 0;
                onStat({ [s.key]: Math.max(0, cur - 1) });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── QuickStatChips ─────────────────────────────────────────────
// Renders the sport-aware quick-stat row inside a team zone.
// Basketball: fouls, bonus, possession. Football: down, distance, etc.
// Each chip is a compact tap-to-increment / label display.

function QuickStatChips({
  def,
  stats,
  onStat,
  side,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number | string>) => void;
  side: 'home' | 'away';
}) {
  // Football gets a dedicated control set — the down selector, TYPED
  // yardage fields, and a possession toggle — in the home zone only.
  if (def.key === 'football') {
    return side === 'home' ? (
      <FootballControls def={def} stats={stats} onStat={onStat} />
    ) : null;
  }

  // Every other sport: the home zone shows each shared stat with the
  // RIGHT control for its shape — a Home/Away toggle for possession &
  // serve, a type-in for wide-range numbers (you never tap +1 thirty
  // times), a +/- stepper only for genuinely small ranges.
  if (side !== 'home') return null;
  const fields = def.stats.filter(
    (s) => !s.key.startsWith('away_') && !s.key.startsWith('home_'),
  );
  if (fields.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-auto">
      {fields.map((s) => {
        // possession / serve — who has the ball or the serve.
        if (s.key === 'possession' || s.key === 'serving') {
          return (
            <PossessionToggle
              key={s.key}
              label={s.key === 'serving' ? 'Serve' : 'Poss'}
              value={stats[s.key]}
              onSet={(v) => onStat({ [s.key]: v })}
            />
          );
        }
        // other free-text fields want a picker (a later pass) — skip
        // rather than render a broken numeric stepper on them.
        if (s.type === 'text') return null;
        // wide-range number → type-in; the operator should never tap
        // +1 dozens of times to reach a value.
        if ((s.max ?? 0) - (s.min ?? 0) > 8) {
          return (
            <StatNumberField
              key={s.key}
              label={s.label}
              value={stats[s.key]}
              min={s.min ?? 0}
              max={s.max ?? 999}
              onCommit={(n) => onStat({ [s.key]: n })}
            />
          );
        }
        // small bounded range → +/- stepper chip.
        return (
          <StatChip
            key={s.key}
            label={s.label}
            value={stats[s.key]}
            onAdd={() => {
              const cur = typeof stats[s.key] === 'number' ? (stats[s.key] as number) : 0;
              onStat({ [s.key]: Math.min(cur + 1, s.max ?? 9999) });
            }}
            onSub={() => {
              const cur = typeof stats[s.key] === 'number' ? (stats[s.key] as number) : 0;
              onStat({ [s.key]: Math.max(cur - 1, s.min ?? 0) });
            }}
          />
        );
      })}
    </div>
  );
}

// ── FootballControls ───────────────────────────────────────────
// Football's home-zone control set: the down selector, TYPED yardage
// fields (To Go / Ball On — you never tap "+1" fifteen times to set
// "1st & 15"), and a possession toggle that lights the 🏈 marker on
// the scoreboard.
function FootballControls({
  def,
  stats,
  onStat,
}: {
  def: SportDefinition;
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number | string>) => void;
}) {
  const distF = def.stats.find((s) => s.key === 'distance');
  const ballF = def.stats.find((s) => s.key === 'ballOn');
  return (
    <div className="flex flex-wrap gap-2 mt-auto">
      <CompactDownControl
        value={Number(stats.down) || 1}
        onSet={(n) => onStat({ down: n })}
      />
      {/* one-tap new series — the most common down/distance change */}
      <button
        type="button"
        onClick={() => onStat({ down: 1, distance: 10 })}
        title="New series — set 1st & 10 in one tap"
        className="flex flex-col items-center justify-center rounded-xl bg-emerald-600 px-3 py-1.5 text-white transition-colors hover:bg-emerald-700"
      >
        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-200">
          New set
        </span>
        <span className="text-lg font-black leading-tight tabular-nums">1st &amp; 10</span>
      </button>
      <StatNumberField
        label="To Go"
        value={stats.distance}
        min={distF?.min ?? 0}
        max={distF?.max ?? 99}
        onCommit={(n) => onStat({ distance: n })}
      />
      <StatNumberField
        label="Ball On"
        value={stats.ballOn}
        min={ballF?.min ?? 0}
        max={ballF?.max ?? 99}
        onCommit={(n) => onStat({ ballOn: n })}
      />
      <PossessionToggle
        label="Ball"
        value={stats.possession}
        onSet={(v) => onStat({ possession: v })}
      />
    </div>
  );
}

// ── StatNumberField ────────────────────────────────────────────
// A compact TYPE-IN number control — for stats with a wide range
// (yards to go, yard line) where a +/- stepper would mean tapping
// dozens of times. Brings up the numeric keypad on a touch console;
// clamps the entry to the stat's min/max on commit.
function StatNumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: unknown;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const live =
    value === undefined || value === null || value === '' ? '' : String(value);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const commit = () => {
    if (!editing) return;
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
    setEditing(false);
  };
  return (
    <div className="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-3 py-1.5">
      <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={editing ? text : live}
        onFocus={() => {
          setText(live);
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        placeholder="—"
        className="w-12 bg-transparent text-center text-lg font-black text-slate-900 tabular-nums leading-tight outline-none"
      />
    </div>
  );
}

// ── PossessionArrowChip ────────────────────────────────────────
// T2-8: First-class possession indicator between the two score tiles.
// Shows a directional arrow (◀ HOME POSS ▶ / ◀ AWAY POSS ▶) or a
// neutral "POSS?" state when possession is unset. Tapping flips to the
// other team. Calls ctl.setPossession (writes Game.possession column,
// not stats.possession). Basketball shows the alternating-possession
// arrow label; football shows the ball emoji.
function PossessionArrowChip({
  value,
  homeTeam,
  awayTeam,
  sportKey,
  onFlip,
}: {
  value: string;
  homeTeam: string;
  awayTeam: string;
  sportKey: string;
  onFlip: (team: 'home' | 'away') => void;
}) {
  const poss = value.trim().toLowerCase();
  const isHome = poss === 'home';
  const isAway = poss === 'away';
  const isNone = !isHome && !isAway;
  // Basketball uses the arrow; football uses the ball emoji.
  const indicator = sportKey === 'football' ? '🏈' : '◀▶';
  const arrowLeft = sportKey === 'football' ? '🏈' : '◀';
  const arrowRight = sportKey === 'football' ? '🏈' : '▶';
  const label = sportKey === 'football' ? 'BALL' : 'POSS';

  const flip = () => {
    if (isHome) onFlip('away');
    else onFlip('home');
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={
        isNone
          ? 'Set possession — tap to assign'
          : `${isHome ? homeTeam : awayTeam} has possession — tap to flip`
      }
      title={isNone ? 'Tap to set possession' : `Tap to give possession to ${isHome ? awayTeam : homeTeam}`}
      className={`mt-2 flex flex-col items-center rounded-xl border px-4 py-2 transition-colors select-none ${
        isNone
          ? 'border-slate-700 bg-slate-800 text-slate-500 hover:bg-slate-700'
          : 'border-indigo-600 bg-indigo-900 text-indigo-200 hover:bg-indigo-800'
      }`}
    >
      <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase mb-0.5">
        {label}
      </span>
      {isNone ? (
        <span className="text-sm font-black tabular-nums text-slate-500">{indicator}</span>
      ) : (
        <div className="flex items-center gap-1.5">
          {isHome && (
            <span className="text-sm font-black text-indigo-300">{arrowLeft}</span>
          )}
          <span className="text-xs font-black text-white uppercase truncate max-w-[80px]">
            {isHome ? homeTeam : awayTeam}
          </span>
          {isAway && (
            <span className="text-sm font-black text-indigo-300">{arrowRight}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ── PossessionToggle ───────────────────────────────────────────
// Home / Away segmented control for who has the ball. Sets the
// `possession` stat, which lights the 🏈 marker on the scoreboard.
function PossessionToggle({
  label,
  value,
  onSet,
}: {
  label: string;
  value: unknown;
  onSet: (v: string) => void;
}) {
  const v = String(value || '').trim().toLowerCase();
  const opt = (key: 'home' | 'away', lbl: string) => (
    <button
      type="button"
      onClick={() => onSet(key)}
      aria-pressed={v === key}
      className={`rounded-md px-2 py-0.5 text-xs font-black transition-colors ${
        v === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {lbl}
    </button>
  );
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1.5">
      <span className="text-[9px] font-black tracking-widest text-slate-400 mr-1">
        {label.toUpperCase()}
      </span>
      {opt('home', 'Home')}
      {opt('away', 'Away')}
    </div>
  );
}

// ── StatChip ───────────────────────────────────────────────────

function StatChip({
  label,
  value,
  onAdd,
  onSub,
}: {
  label: string;
  value: unknown;
  onAdd: () => void;
  onSub: () => void;
}) {
  const display = value === undefined || value === null ? '0' : String(value);
  return (
    <button
      type="button"
      onClick={onAdd}
      onContextMenu={(e) => { e.preventDefault(); onSub(); }}
      title={`${label}: tap to add, right-click to subtract`}
      className="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
    >
      <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase">
        {label}
      </span>
      <span className="text-lg font-black text-slate-900 tabular-nums leading-tight">
        {display}
      </span>
    </button>
  );
}

// ── CompactDownControl ─────────────────────────────────────────

function CompactDownControl({ value, onSet }: { value: number; onSet: (n: number) => void }) {
  const d = value >= 1 && value <= 4 ? value : 1;
  const labels = ['1st', '2nd', '3rd', '4th'];
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1.5">
      <span className="text-[9px] font-black tracking-widest text-slate-400 mr-1">DOWN</span>
      {labels.map((lbl, i) => (
        <button
          key={lbl}
          type="button"
          onClick={() => onSet(i + 1)}
          aria-pressed={i + 1 === d}
          className={`rounded-md px-1.5 py-0.5 text-xs font-black transition-colors ${
            i + 1 === d
              ? 'bg-indigo-600 text-white'
              : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
  );
}

// ── BaseTrayBall ───────────────────────────────────────────────
// Baseball / softball bottom tray: Ball, Strike / Foul / Out buttons.

function BaseTrayBall({
  stats,
  onStat,
}: {
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number>) => void;
}) {
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const balls = num(stats.balls);
  const strikes = num(stats.strikes);
  const outs = num(stats.outs);
  return (
    <>
      <button
        type="button"
        onClick={() => onStat({ balls: balls + 1 })}
        className="flex-1 h-14 rounded-xl bg-red-600 text-white font-black text-lg hover:bg-red-700 transition-colors"
      >
        Ball
      </button>
      <button
        type="button"
        onClick={() => onStat({ strikes: strikes + 1 })}
        className="flex-1 h-14 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-sm hover:bg-slate-100 transition-colors flex flex-col items-center justify-center"
      >
        <span>Strike</span>
        <span className="text-[10px] text-slate-400">· Foul · Out</span>
      </button>
      {/* live count indicator */}
      <div className="flex flex-col items-center justify-center bg-white border border-slate-200 rounded-xl px-3 h-14 shrink-0">
        <span className="text-[9px] font-black tracking-widest text-slate-400">COUNT</span>
        <span className="text-xl font-black text-slate-900 tabular-nums">
          {balls}–{strikes}
        </span>
        <span className="text-[9px] text-slate-400">{outs} out</span>
      </div>
    </>
  );
}

// ── ShotClockBtn ───────────────────────────────────────────────
// Basketball shot-clock tray control — the live value + start/stop and
// reset-to-full / reset-to-short (14 for a 24s clock, 20 for a 30s).
function ShotClockBtn({
  stats,
  onAction,
  shortReset,
}: {
  stats: Record<string, unknown>;
  onAction: (action: string, value?: number) => void;
  shortReset?: number;
}) {
  const sc =
    stats && typeof stats.shotClock === 'object' && stats.shotClock
      ? (stats.shotClock as Record<string, unknown>)
      : {};
  const len = Number(sc.len) || 0;
  const anchorMs = Math.max(0, Number(sc.ms) || 0);
  const anchorAt = String(sc.at || '');
  const running = !!sc.running;
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const at = new Date(anchorAt).getTime();
    const project = () => {
      if (!running || !Number.isFinite(at)) {
        setMs(anchorMs);
        return;
      }
      setMs(Math.max(0, anchorMs - (Date.now() - at)));
    };
    project();
    if (!running) return;
    const t = setInterval(project, 200);
    return () => clearInterval(t);
  }, [anchorMs, anchorAt, running]);
  if (len <= 0) return null;

  // Short reset comes from the sport's shotClock.short when provided
  // (water polo 20, lacrosse 60); otherwise derive from the length.
  const short = shortReset && shortReset < len ? shortReset : len === 24 ? 14 : len === 30 ? 20 : len;
  const secs = ms <= 5000 ? (ms / 1000).toFixed(1) : String(Math.ceil(ms / 1000));
  return (
    <div className="flex items-stretch gap-1.5 shrink-0">
      <div className="flex flex-col items-center justify-center px-2.5 h-14 rounded-xl bg-white border border-slate-200">
        <span className="text-[9px] font-black tracking-widest text-slate-400">SHOT</span>
        <span
          className={`text-xl font-black tabular-nums leading-tight ${
            ms <= 5000 ? 'text-red-600' : 'text-slate-900'
          }`}
        >
          {secs}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onAction(running ? 'stop' : 'start')}
        aria-label={running ? 'Stop shot clock' : 'Start shot clock'}
        className="h-14 w-11 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-100 transition-colors"
      >
        {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => onAction('reset', len)}
        className="h-14 px-3 rounded-xl bg-indigo-600 text-white font-black text-base hover:bg-indigo-700 transition-colors"
      >
        {len}
      </button>
      {short !== len && (
        <button
          type="button"
          onClick={() => onAction('reset', short)}
          className="h-14 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-base hover:bg-slate-100 transition-colors"
        >
          {short}
        </button>
      )}
    </div>
  );
}

// ── PlayClockBtn ───────────────────────────────────────────────
// Football play-clock tray control — the live 40/25 countdown with
// start/stop and reset-to-40 (normal) / reset-to-25 (after a stoppage).
function PlayClockBtn({
  stats,
  onAction,
}: {
  stats: Record<string, unknown>;
  onAction: (action: string, value?: number) => void;
}) {
  const pc =
    stats && typeof stats.playClock === 'object' && stats.playClock
      ? (stats.playClock as Record<string, unknown>)
      : {};
  const armed = String(pc.at || '') !== '';
  const anchorMs = Math.max(0, Number(pc.ms) || 0);
  const anchorAt = String(pc.at || '');
  const running = !!pc.running;
  const [ms, setMs] = useState(anchorMs);
  useEffect(() => {
    const at = new Date(anchorAt).getTime();
    const project = () => {
      if (!running || !Number.isFinite(at)) {
        setMs(anchorMs);
        return;
      }
      setMs(Math.max(0, anchorMs - (Date.now() - at)));
    };
    project();
    if (!running) return;
    const t = setInterval(project, 200);
    return () => clearInterval(t);
  }, [anchorMs, anchorAt, running]);

  const secs = !armed
    ? '40'
    : ms <= 5000
      ? (ms / 1000).toFixed(1)
      : String(Math.ceil(ms / 1000));
  return (
    <div className="flex items-stretch gap-1.5 shrink-0">
      <div className="flex flex-col items-center justify-center px-2.5 h-14 rounded-xl bg-white border border-slate-200">
        <span className="text-[9px] font-black tracking-widest text-slate-400">PLAY</span>
        <span
          className={`text-xl font-black tabular-nums leading-tight ${
            armed && ms <= 5000 ? 'text-red-600' : 'text-slate-900'
          }`}
        >
          {secs}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onAction(running ? 'stop' : 'start')}
        aria-label={running ? 'Stop play clock' : 'Start play clock'}
        className="h-14 w-11 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-100 transition-colors"
      >
        {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => onAction('reset', 40)}
        className="h-14 px-3 rounded-xl bg-indigo-600 text-white font-black text-base hover:bg-indigo-700 transition-colors"
      >
        40
      </button>
      <button
        type="button"
        onClick={() => onAction('reset', 25)}
        className="h-14 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-base hover:bg-slate-100 transition-colors"
      >
        25
      </button>
    </div>
  );
}

// ── ShotClockSetup ─────────────────────────────────────────────
// Set-up picker for the shot-clock length — Pro 24 / College 30 /
// HS 35 / Off. Pro, college, and HS differ; many HS states run none.
function ShotClockSetup({
  gameId,
  current,
  config,
}: {
  gameId: string;
  current: Record<string, unknown>;
  config?: { full: number; short: number; options: number[] };
}) {
  const ctl = useGameControl(gameId);
  const sc =
    current && typeof current.shotClock === 'object' && current.shotClock
      ? (current.shotClock as Record<string, unknown>)
      : {};
  const len = Number(sc.len) || 0;
  const HINTS: Record<number, string> = {
    0: 'No shot clock.',
    14: '14s — offensive-rebound short reset.',
    20: '20s — water polo short reset (rebound / corner).',
    24: '24s — pro basketball (NBA / WNBA / FIBA).',
    30: '30s — college basketball / water polo full reset.',
    35: '35s — high-school basketball where adopted.',
    60: '60s — lacrosse re-start in the offensive half.',
    80: '80s — NCAA men’s lacrosse full reset.',
  };
  // Options come from the sport definition; fall back to the classic
  // basketball set so an undefined config never empties the picker.
  const opts = config?.options ?? [0, 24, 30, 35];
  const OPTS = opts.map((v) => ({ v, label: v === 0 ? 'Off' : `${v}s`, hint: HINTS[v] ?? `${v}s shot clock.` }));
  return (
    <div>
      <p className="text-xs text-slate-400 mb-2">
        Shot-clock length for this game. Pro, college, and high school each
        differ — and many HS states run none at all.
      </p>
      <div className="flex gap-1.5">
        {OPTS.map((o) => (
          <button
            key={o.v}
            type="button"
            title={o.hint}
            onClick={() => ctl.shotClock.mutate({ action: 'configure', value: o.v })}
            className={`flex-1 rounded-md border px-2 py-2 text-sm font-bold transition-colors ${
              len === o.v
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 text-slate-600 hover:border-indigo-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {OPTS.find((o) => o.v === len)?.hint}
      </p>
    </div>
  );
}

// ── PregameIntroPanel ─────────────────────────────────────────
// T2-4 — Starting-lineup choreography trigger.
// Appears in Setup mode below Team Rosters. Fires a 'pregame-intro'
// CUE that takes over the scoreboard with per-player slots.
// Two buttons: "Home lineup" and "Away lineup". An optional text input
// lets the operator paste an audio URL (intro music). Only shown when
// there are players in the roster; uses the query-param trigger path
// for the ?intro= shortcut documented in the task spec.
function PregameIntroPanel({
  gameId,
  ctl,
  game,
}: {
  gameId: string;
  ctl: ReturnType<typeof useGameControl>;
  game: { homeTeam: string; awayTeam: string };
}) {
  const [audioUrl, setAudioUrl] = useState('');
  const [showAudio, setShowAudio] = useState(false);
  const [fired, setFired] = useState<'home' | 'away' | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Query-param trigger — ?intro=home|away fires on mount (tablet UX).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const intro = p.get('intro');
    if (intro === 'home' || intro === 'away') {
      ctl.firePregameIntro.mutate({ team: intro });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fire = (team: 'home' | 'away') => {
    ctl.firePregameIntro.mutate(
      { team, audioUrl: audioUrl || undefined },
      {
        onSuccess: () => {
          setFired(team);
          if (firedTimer.current) clearTimeout(firedTimer.current);
          firedTimer.current = setTimeout(() => setFired(null), 3000);
        },
      },
    );
  };

  useEffect(() => () => { if (firedTimer.current) clearTimeout(firedTimer.current); }, []);

  const busy = ctl.firePregameIntro.isPending;
  const succeeded = (team: 'home' | 'away') => fired === team;

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        Takes over the scoreboard with a per-player slot (photo + name + number + stats). Add players in Team Rosters first.
      </p>

      <div className="flex" style={{ marginBottom: 8 }}>
        {/* Home intro button */}
        <button
          type="button"
          disabled={busy}
          onClick={() => fire('home')}
          className={`flex-1 rounded-l-xl border-y border-l px-4 py-3 text-sm font-bold transition-colors ${
            succeeded('home')
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
          }`}
        >
          {succeeded('home') ? '✓ Sent!' : `🎤 ${game.homeTeam} Intro`}
        </button>

        {/* Away intro button */}
        <button
          type="button"
          disabled={busy}
          onClick={() => fire('away')}
          className={`flex-1 rounded-r-xl border-y border-r px-4 py-3 text-sm font-bold transition-colors ${
            succeeded('away')
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200'
          }`}
          style={{ borderLeft: '1px solid #e2e8f0' }}
        >
          {succeeded('away') ? '✓ Sent!' : `🎤 ${game.awayTeam} Intro`}
        </button>
      </div>

      {/* Audio URL toggle — collapsed by default to keep the panel clean */}
      <button
        type="button"
        onClick={() => setShowAudio((v) => !v)}
        className="text-xs text-indigo-500 hover:text-indigo-700 underline"
      >
        {showAudio ? 'Hide intro music URL' : 'Add intro music URL (optional)'}
      </button>

      {showAudio && (
        <div style={{ marginTop: 8 }}>
          <input
            type="url"
            placeholder="https://…/intro-music.mp3"
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Plays once when the intro starts. Stops automatically when the intro ends.
          </p>
        </div>
      )}
    </div>
  );
}

// ── TrayClockBtn ───────────────────────────────────────────────
// Clock start/stop/segment button row for sports with a game clock.

function TrayClockBtn({
  game,
  def,
  liveMs,
  onAction,
}: {
  game: any;
  def: SportDefinition;
  liveMs: number;
  onAction: (action: string, ms?: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [setText, setSetText] = useState('');

  const commitSet = () => {
    const ms = parseClock(setText);
    if (ms !== null) {
      onAction('set', ms);
      setSetText('');
    }
    setEditing(false);
  };

  return (
    <>
      {/* start/stop */}
      {game.clockRunning ? (
        <button
          type="button"
          onClick={() => onAction('pause')}
          className="flex-1 h-14 rounded-xl bg-red-600 text-white font-black text-lg flex items-center justify-center gap-2 hover:bg-red-700 transition-colors"
        >
          <Pause className="h-5 w-5" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onAction('start')}
          className="flex-1 h-14 rounded-xl bg-green-600 text-white font-black text-lg flex items-center justify-center gap-2 hover:bg-green-700 transition-colors"
        >
          <Play className="h-5 w-5" />
          Start
        </button>
      )}

      {/* segment − / label / + */}
      <button
        type="button"
        onClick={() => onAction('reset')}
        title="Reset clock"
        className="h-14 w-12 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-100 transition-colors"
      >
        <RotateCcw className="h-4 w-4" />
      </button>

      {/* clock set */}
      {editing ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={setText}
            onChange={(e) => setSetText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitSet(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="MM:SS"
            className="w-20 h-14 text-center text-lg font-black"
          />
          <Button size="sm" onClick={commitSet} disabled={parseClock(setText) === null}>
            Set
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setEditing(true); setSetText(fmtClock(liveMs)); }}
          className="h-14 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-lg tabular-nums hover:bg-slate-100 transition-colors"
          title="Tap to set clock"
        >
          {fmtClock(liveMs)}
        </button>
      )}
    </>
  );
}

// ── segment text ───────────────────────────────────────────────

function segmentText(def: SportDefinition, g: any): string {
  const n = g.segment;
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  if (def.segment.name === 'Inning') {
    const half = String((g.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}#${n}`;
  }
  return `${def.segment.name} ${n}`;
}

// ── Game-day Presentation Settings ────────────────────────────

interface PresentationSponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  active: boolean;
}

function PresentationSettingsSection({
  gameId,
  def,
  ctl,
}: {
  gameId: string;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const { data: sponsorsData } = useSponsors();
  const sponsors: PresentationSponsor[] = Array.isArray(sponsorsData)
    ? (sponsorsData as PresentationSponsor[]).filter((s) => s.active)
    : [];

  const [audioUrl, setAudioUrl] = useState('');
  const [sponsorId, setSponsorId] = useState('');
  const [target, setTarget] = useState<'ALL' | 'BOARD' | 'RIBBON'>('ALL');
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedSponsor = sponsors.find((s) => s.id === sponsorId) ?? null;

  const fire = (key: string) => {
    const body: {
      key: string;
      target: string;
      audioUrl?: string;
      sponsorName?: string;
      sponsorLogoUrl?: string;
    } = { key, target };
    if (audioUrl.trim()) body.audioUrl = audioUrl.trim();
    if (selectedSponsor) {
      body.sponsorName = selectedSponsor.name;
      if (selectedSponsor.logoUrl) body.sponsorLogoUrl = selectedSponsor.logoUrl;
    }
    ctl.cue.mutate(body);
    setFired(`builtin:${key}`);
    if (firedTimer.current) clearTimeout(firedTimer.current);
    firedTimer.current = setTimeout(() => setFired(null), 1500);
  };

  const TARGETS: { key: 'ALL' | 'BOARD' | 'RIBBON'; label: string }[] = [
    { key: 'ALL', label: 'Everywhere' },
    { key: 'BOARD', label: 'Scoreboard' },
    { key: 'RIBBON', label: 'Ribbon' },
  ];

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
      <h2 className="text-sm font-bold text-slate-900 mb-3">Celebrations</h2>
      <p className="text-xs text-slate-400 mb-3">
        Tap a celebration to fire it. The sound clip and co-brand sponsor below are
        included in every cue sent from here.
      </p>

      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
          Fire to
        </p>
        <div className="flex gap-1.5">
          {TARGETS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTarget(t.key)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                target === t.key
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-indigo-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 mb-4">
        {def.celebrations.map((c) => {
          const tileId = `builtin:${c.key}`;
          const isFired = fired === tileId;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => fire(c.key)}
              className={`overflow-hidden rounded-xl border-2 transition-all ${
                isFired
                  ? 'border-green-500 scale-95'
                  : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
              }`}
            >
              <div className="flex h-16 items-center justify-center bg-slate-100">
                <span className="text-3xl">{c.emoji}</span>
              </div>
              <div className="truncate px-2 py-1.5 text-center text-xs font-semibold text-slate-700">
                {isFired ? 'Fired!' : c.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 p-3 space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Celebration settings
        </p>
        <div>
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5" />
            Celebration sound URL
          </label>
          <Input
            className="mt-1"
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="https://example.com/airhorn.mp3"
            maxLength={2048}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            A sound clip URL (mp3/ogg). Played on every fired celebration — leave blank for no
            sound.
          </p>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Co-brand celebrations with</label>
          <select
            value={sponsorId}
            onChange={(e) => setSponsorId(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">None — no sponsor overlay</option>
            {sponsors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedSponsor && (
            <p className="text-[11px] text-slate-400 mt-1">
              &ldquo;{selectedSponsor.name}&rdquo; name
              {selectedSponsor.logoUrl ? ' and logo' : ''} included in every fired cue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sponsor Scheduling ─────────────────────────────────────────

interface ScheduledSponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  active: boolean;
  weight: number;
  flightStartAt?: string | null;
  flightEndAt?: string | null;
  frequencyCapPerHour?: number | null;
}

function SponsorSchedulingSection() {
  const { data, isLoading } = useSponsors();
  const update = useUpdateSponsor();
  const sponsors: ScheduledSponsor[] = Array.isArray(data) ? (data as ScheduledSponsor[]) : [];

  if (isLoading) return null;
  if (sponsors.length === 0) return null;

  return (
    <Section title="Sponsor ad scheduling">
      <p className="text-xs text-slate-400 mb-3">
        Set flight windows and per-hour frequency caps for each sponsor. Higher rotation weight
        means the brand comes around more often per loop.
      </p>
      <div className="space-y-2">
        {sponsors.map((s) => (
          <SponsorScheduleRow
            key={s.id}
            sponsor={s}
            onSave={(vals) => update.mutate({ id: s.id, data: vals })}
          />
        ))}
      </div>
    </Section>
  );
}

function SponsorScheduleRow({
  sponsor,
  onSave,
}: {
  sponsor: ScheduledSponsor;
  onSave: (vals: SponsorInput) => void;
}) {
  const toDateValue = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
  const toIso = (dateVal: string) => (dateVal ? new Date(dateVal).toISOString() : null);

  const [active, setActive] = useState(sponsor.active);
  const [weight, setWeight] = useState(sponsor.weight ?? 1);
  const [flightStart, setFlightStart] = useState(toDateValue(sponsor.flightStartAt));
  const [flightEnd, setFlightEnd] = useState(toDateValue(sponsor.flightEndAt));
  const [freqCap, setFreqCap] = useState<string>(
    sponsor.frequencyCapPerHour != null ? String(sponsor.frequencyCapPerHour) : '',
  );
  const [dirty, setDirty] = useState(false);

  const mark = () => setDirty(true);

  const save = () => {
    const capNum = freqCap.trim() === '' ? null : Number(freqCap);
    onSave({
      active,
      weight,
      flightStartAt: toIso(flightStart),
      flightEndAt: toIso(flightEnd),
      frequencyCapPerHour: capNum != null && Number.isFinite(capNum) ? capNum : null,
    });
    setDirty(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2 mb-2.5">
        {sponsor.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sponsor.logoUrl}
            alt=""
            className="h-8 w-8 rounded object-contain bg-slate-50 ring-1 ring-slate-100 shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        ) : null}
        <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{sponsor.name}</span>
        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked);
              mark();
            }}
            className="h-4 w-4 accent-indigo-600 cursor-pointer"
          />
          <span className="text-xs font-medium text-slate-600">Active</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
        <div>
          <label className="font-semibold text-slate-500">Rotation weight — {weight}</label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={weight}
            onChange={(e) => {
              setWeight(Number(e.target.value));
              mark();
            }}
            className="w-full mt-1 accent-indigo-600 cursor-pointer"
          />
        </div>
        <div>
          <label className="font-semibold text-slate-500">Max per hour</label>
          <Input
            type="number"
            className="mt-1"
            value={freqCap}
            min={1}
            placeholder="Uncapped"
            onChange={(e) => {
              setFreqCap(e.target.value);
              mark();
            }}
          />
          <p className="text-[11px] text-slate-400 mt-0.5">Leave blank for uncapped.</p>
        </div>
        <div>
          <label className="font-semibold text-slate-500">Flight start</label>
          <input
            type="date"
            value={flightStart}
            onChange={(e) => {
              setFlightStart(e.target.value);
              mark();
            }}
            className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="font-semibold text-slate-500">Flight end</label>
          <input
            type="date"
            value={flightEnd}
            onChange={(e) => {
              setFlightEnd(e.target.value);
              mark();
            }}
            className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {dirty && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" onClick={save}>
            Save
          </Button>
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-600 font-semibold"
            onClick={() => {
              setActive(sponsor.active);
              setWeight(sponsor.weight ?? 1);
              setFlightStart(toDateValue(sponsor.flightStartAt));
              setFlightEnd(toDateValue(sponsor.flightEndAt));
              setFreqCap(
                sponsor.frequencyCapPerHour != null ? String(sponsor.frequencyCapPerHour) : '',
              );
              setDirty(false);
            }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

// ── HoldChip — hold-to-confirm for destructive game-console actions ──
//
// Reuses the exact same press-and-hold mechanic as the mobile panic page
// (apps/web/src/app/panic/page.tsx) scaled down to small inline chips.
// 800 ms hold → animated SVG ring fills → release-at-complete = fire;
// release-early = no-op. setPointerCapture prevents finger drift from
// cancelling the hold.
//
// Usage:
//   <HoldChip label="−" ariaLabel="Previous segment" onConfirm={() => ...} />
//   <HoldChip label="Final" ariaLabel="Mark game Final — hold to confirm"
//             onConfirm={() => ...} className="px-4 py-2 ..." />
//
// Constraints (CLAUDE.md rule #10): no `inset` shorthand or `inset-0`
// Tailwind class. All absolute positioning uses top-0 right-0 bottom-0
// left-0 long-hand.
const HOLD_CHIP_MS = 800;

function HoldChip({
  label,
  ariaLabel,
  onConfirm,
  className,
  children,
}: {
  label?: string;
  ariaLabel: string;
  onConfirm: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liveMsg, setLiveMsg] = useState('');
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearHold = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    setHolding(false);
    setProgress(0);
  };

  const startHold = () => {
    setHolding(true);
    setProgress(0);
    setLiveMsg(`Hold to confirm: ${ariaLabel}`);
    const startTime = Date.now();
    progressTimerRef.current = setInterval(() => {
      const pct = Math.min(((Date.now() - startTime) / HOLD_CHIP_MS) * 100, 100);
      setProgress(pct);
    }, 30);
    holdTimerRef.current = setTimeout(() => {
      clearHold();
      setLiveMsg('');
      onConfirm();
    }, HOLD_CHIP_MS);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* older WebView */ }
    startHold();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.repeat) return;
    e.preventDefault();
    startHold();
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    clearHold();
  };

  // Circumference for r=10 circle: 2π×10 ≈ 62.8
  const CIRC = 62.8;

  return (
    <>
      {/* SR live region — announces the hold prompt to screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMsg}
      </div>
      <button
        type="button"
        aria-label={`${ariaLabel}. Hold to confirm.`}
        onPointerDown={handlePointerDown}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={clearHold}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative select-none overflow-hidden ${className ?? ''}`}
        style={{ touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
      >
        {/* Animated ring — absolute overlay using long-hand sides (CLAUDE.md rule #10) */}
        <svg
          className="absolute top-0 right-0 bottom-0 left-0 w-full h-full -rotate-90 pointer-events-none"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12" cy="12" r="10"
            fill="none"
            className="stroke-current opacity-20"
            strokeWidth="2"
          />
          <circle
            cx="12" cy="12" r="10"
            fill="none"
            className="stroke-current"
            strokeWidth="2"
            strokeDasharray={CIRC}
            strokeDashoffset={holding ? CIRC - (CIRC * progress) / 100 : CIRC}
            strokeLinecap="round"
          />
        </svg>
        {/* Content */}
        <span className="relative" style={{ zIndex: 1 }}>
          {children ?? label}
        </span>
      </button>
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
      <h2 className="text-sm font-bold text-slate-900 mb-3">{title}</h2>
      {children}
    </div>
  );
}

/**
 * 2026-05-27 — CTS feed status pill. Reads `Game.stats.cts.lastUpdateAt`
 * (written by the API when the CTS bridge POSTs a snapshot) and renders
 * one of three states. Reuses the same freshness math as the public
 * surfaces (apps/web/src/lib/cts-merge.ts) so the operator's pill and
 * the rendered scoreboard never disagree about who is the source of
 * truth.
 *
 * Polls 1 Hz internally so the pill flips to "stale" the moment a CTS
 * outage exceeds the 5 s window. No network call — it re-reads from
 * React Query's already-fresh game record via the parent's `stats` prop.
 */
function CtsConsoleStatus({ stats }: { stats: Record<string, unknown> }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // 1 Hz tick — enough to flip fresh→stale within a second of the
    // 5 s heartbeat window expiring, cheap enough to never matter.
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Use the BROWSER's clock as the "serverTime" reference. The cts
  // lastUpdateAt is a server timestamp; using Date.now() is correct
  // because we only care about how long ago the heartbeat arrived.
  // The 5 s threshold is generous enough to absorb any reasonable
  // clock skew on the operator's laptop.
  const status: CtsStatus = computeCtsStatus(stats, Date.now());
  // intentionally read `tick` so the effect's setState triggers a re-render
  void tick;

  const ring: Record<CtsStatus['kind'], string> = {
    fresh: 'ring-2 ring-green-500 bg-green-50',
    stale: 'ring-2 ring-amber-400 bg-amber-50',
    never: 'ring-1 ring-slate-300 bg-slate-50',
  };
  const dot: Record<CtsStatus['kind'], string> = {
    fresh: 'bg-green-500 animate-pulse',
    stale: 'bg-amber-500',
    never: 'bg-slate-400',
  };
  const text: Record<CtsStatus['kind'], string> = {
    fresh: 'text-green-900',
    stale: 'text-amber-900',
    never: 'text-slate-600',
  };
  const ageText =
    status.kind === 'fresh' && status.ageMs !== null
      ? `${Math.max(0, Math.round(status.ageMs / 1000))}s ago`
      : status.kind === 'stale' && status.ageMs !== null
        ? `${Math.max(0, Math.round(status.ageMs / 1000))}s ago`
        : null;

  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${ring[status.kind]}`}>
      <span className={`inline-block h-3 w-3 rounded-full ${dot[status.kind]}`} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-bold ${text[status.kind]}`}>{status.label}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          {status.kind === 'fresh'
            ? `Scoreboard + ribbon are reading from the CTS console${ageText ? ` · last snapshot ${ageText}` : ''}.`
            : status.kind === 'stale'
              ? `No CTS snapshot in the last 5 s${ageText ? ` (${ageText})` : ''} — your manual chips win.`
              : 'Open a player kiosk with ?cts=1&game=<id>&feedToken=<token> to start the live feed.'}
        </div>
      </div>
    </div>
  );
}

// ── Sprint 13 — Layouts panel ────────────────────────────────────
// Lets the operator hot-swap the Scoreboard / Ribbon / Scorebug
// template at any time (pre-game, mid-game, after-game). Empty value
// (the "Default" option) PATCHes the FK to null on the API and the
// surface falls back to the hardcoded built-in layout. Operator
// makes the choice on the game-create form too; this panel is for
// changing it later. Surfaces update within the next 750ms poll.

function LayoutsPanel({
  g,
  ctl,
}: {
  g: any;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const { data: templates } = useTemplates();
  const list: Array<{
    id: string;
    name: string;
    isSystem?: boolean;
    category?: string;
    screenWidth?: number;
    screenHeight?: number;
  }> = Array.isArray(templates) ? (templates as any[]) : [];

  // Local "saving" state per dropdown so the operator gets feedback;
  // the optimistic writeBack in useGameControl makes the dropdown
  // value snap immediately, but the spinner reassures on a slow link.
  const [saving, setSaving] = useState<string | null>(null);
  const save = async (field: 'scoreboard' | 'ribbon' | 'scorebug', value: string) => {
    setSaving(field);
    try {
      await ctl.details.mutateAsync({
        [`${field}TemplateId`]: value || null,
      } as any);
    } finally {
      setSaving(null);
    }
  };

  // 2026-05-26 — filter each surface's dropdown to ONLY templates
  // matching that surface's aspect ratio + category. Operator
  // (2026-05-26) called out: "why are our updated cues not loaded?
  // im kicking them off from the sports menu but they are all the
  // old cues and not the new ones we worked forever on" — root
  // cause was the operator never picked the new "CTS Water Polo
  // Ribbon" template out of the 100+ entries in the unfiltered
  // dropdown, so the RIBBON surface stayed on Default + the legacy
  // sport-celebration animations played instead of the cinematic
  // CEL_* library. Filtering surfaces only RIBBON templates in the
  // RIBBON dropdown so they can't miss it.
  function aspectMatches(t: typeof list[number], surface: 'scoreboard' | 'ribbon' | 'scorebug'): boolean {
    const w = t.screenWidth || 1920;
    const h = t.screenHeight || 1080;
    const ratio = w / Math.max(h, 1);
    // Honor explicit category first.
    const cat = (t.category || '').toUpperCase();
    if (surface === 'ribbon')    return cat === 'RIBBON'    || ratio >= 5;
    if (surface === 'scorebug')  return cat === 'SCOREBUG'  || (ratio >= 3 && ratio < 5);
    // Scoreboard = everything else: 16:9 video walls, custom-canvas
    // boards, plus operator-created mixed-aspect designs.
    return cat === 'SCOREBOARD' || ratio < 3;
  }

  const ROW: Array<{
    field: 'scoreboard' | 'ribbon' | 'scorebug';
    label: string;
    hint: string;
    current: string;
    suggested?: string;
    suggestedName?: string;
  }> = [
    {
      field: 'scoreboard',
      label: 'Scoreboard',
      hint: 'The big LED video wall — /board/' + g.id,
      current: g.scoreboardTemplateId || '',
    },
    {
      field: 'ribbon',
      label: 'Ribbon',
      hint: 'Perimeter ribbon panel chain — /ribbon/' + g.id,
      current: g.ribbonTemplateId || '',
      // Sports-vertical default — auto-suggest CTS Water Polo Ribbon.
      // Future: pick the right preset per sport once we have ribbons
      // for football / basketball / etc.
      suggested: 'sports-cts-water-polo-ribbon',
      suggestedName: 'CTS Water Polo Ribbon (cinematic celebrations)',
    },
    {
      field: 'scorebug',
      label: 'Scorebug',
      hint: 'OBS broadcast overlay — /scorebug/' + g.id,
      current: g.scorebugTemplateId || '',
    },
  ];

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">
        Pick a custom template per surface. Operator can swap layouts anytime —
        the surface updates within ~750ms. Leave on Default to use the built-in layout.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ROW.map((r) => {
          const filtered = list.filter((t) => aspectMatches(t, r.field));
          const onDefault = !r.current;
          const suggestionAvailable = r.suggested && filtered.some((t) => t.id === r.suggested);
          const showSuggestion = onDefault && suggestionAvailable;
          return (
            <div key={r.field}>
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {r.label}
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm bg-white"
                value={r.current}
                disabled={saving === r.field}
                onChange={(e) => save(r.field, e.target.value)}
              >
                <option value="">Default — built-in layout</option>
                {filtered.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.isSystem ? '★ ' : ''}
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-slate-400">{r.hint}</p>
              {showSuggestion && (
                <button
                  type="button"
                  onClick={() => save(r.field, r.suggested!)}
                  disabled={saving === r.field}
                  className="mt-2 w-full px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  Use “{r.suggestedName}” →
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* Big call-out when ribbon is on Default — this is the source of
          the "old cues firing" + "sponsor content tiny" issue. Tell
          the operator EXACTLY what to do. */}
      {!g.ribbonTemplateId && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
          <strong className="text-amber-950">💡 Heads-up — your Ribbon is on Default.</strong>
          {' '}On Default, celebrations fire the BUILT-IN water-polo animations
          (small text, no sponsor co-brand, no cinematic). To get the new
          cinematic GOOOOAL / hockey red-lamp / lacrosse stick-up scenes
          plus sponsor + roster auto-rotations and the CTS bridge, pick{' '}
          <strong>“CTS Water Polo Ribbon”</strong> from the Ribbon dropdown above —
          or hit the blue button under Ribbon to one-click switch.
        </div>
      )}
    </div>
  );
}

function ScreenPushPanel({ gameId }: { gameId: string }) {
  const { data: screens, isLoading } = useGameScreens(gameId);
  const show = useShowGameOnScreens(gameId);
  const hide = useHideGameFromScreens(gameId);

  const list: any[] = Array.isArray(screens) ? screens : [];
  const showingCount = list.filter((s) => s.showing).length;
  const busy = show.isPending || hide.isPending;

  // A screen is owned by one game. Pushing to a screen another game is
  // already using takes an explicit, confirmed take-over (force) — so
  // two operators can't silently overwrite each other's screen.
  const pushTo = (
    s: { id: string; name: string; showingOther?: boolean; otherGame?: string | null },
    surface: string,
  ) => {
    if (s.showingOther) {
      const ok = window.confirm(
        `"${s.name}" is showing ${s.otherGame || 'another game'}.\n\n` +
          `Take it over and show THIS game instead?`,
      );
      if (!ok) return;
      show.mutate({ screenIds: [s.id], surface, force: true });
      return;
    }
    show.mutate({ screenIds: [s.id], surface });
  };

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading screens…</p>;
  }
  if (list.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No paired screens in this venue yet. Pair a display first, then come back to put the
        scoreboard or ribbon on it.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">
          Pick what each screen shows — the full scoreboard, the LED ribbon, or off. An emergency
          alert always overrides it.
        </p>
        {showingCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => hide.mutate(undefined)}
            className="shrink-0"
          >
            All off ({showingCount})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {list.map((s) => {
          const current: string = s.showing ? s.surface || 'BOARD' : 'OFF';
          return (
            <div key={s.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                    s.status === 'ONLINE' ? 'bg-green-500' : 'bg-slate-300'
                  }`}
                />
                <span className="text-sm font-semibold text-slate-800 truncate flex-1">
                  {s.name}
                </span>
                {current !== 'OFF' ? (
                  <span className="text-[11px] font-bold text-green-600 shrink-0">● On air</span>
                ) : s.showingOther ? (
                  <span className="text-[11px] text-amber-600 shrink-0">other game</span>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <SurfaceBtn
                  label="Scoreboard"
                  icon={MonitorPlay}
                  active={current === 'BOARD'}
                  disabled={busy}
                  onClick={() => pushTo(s, 'BOARD')}
                />
                <SurfaceBtn
                  label="Ribbon"
                  icon={RectangleHorizontal}
                  active={current === 'RIBBON'}
                  disabled={busy}
                  onClick={() => pushTo(s, 'RIBBON')}
                />
                <SurfaceBtn
                  label="Off"
                  active={current === 'OFF'}
                  disabled={busy}
                  onClick={() => hide.mutate([s.id])}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SurfaceBtn({
  label,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
        active ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {label}
    </button>
  );
}

// ── SpotlightControl ───────────────────────────────────────────

function SpotlightControl({
  gameId,
  current,
  onDone,
}: {
  gameId: string;
  current: any;
  /** Called after a spotlight is shown or hidden — lets a host popup auto-close. */
  onDone?: () => void;
}) {
  const ctl = useGameControl(gameId);
  const sp = current && typeof current === 'object' ? current : {};
  const [title, setTitle] = useState<string>(sp.title || '');
  const [photoUrl, setPhotoUrl] = useState<string>(sp.photoUrl || '');
  const [subtitle, setSubtitle] = useState<string>(sp.subtitle || '');
  const seed: Array<{ label?: string; value?: string }> = Array.isArray(sp.lines) ? sp.lines : [];
  const [lines, setLines] = useState(
    [0, 1, 2, 3].map((i) => ({ label: seed[i]?.label || '', value: seed[i]?.value || '' })),
  );
  const onAir = !!(sp.visible && sp.title);

  const roster = useGameRoster(gameId);
  const players: any[] = Array.isArray(roster.data) ? roster.data : [];
  const [pickerOpen, setPickerOpen] = useState(false);

  const setLine = (i: number, key: 'label' | 'value', val: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));

  const show = () => {
    if (!title.trim()) return;
    ctl.spotlight.mutate({
      visible: true,
      title: title.trim(),
      photoUrl: photoUrl.trim() || undefined,
      subtitle: subtitle.trim() || undefined,
      lines: lines.filter((l) => l.label.trim() || l.value.trim()),
    });
    onDone?.();
  };
  const remove = () => {
    ctl.spotlight.mutate({ clear: true });
    onDone?.();
  };

  // One-tap spotlight straight from a roster player — builds the
  // payload from the player and fires it, no form round-trip.
  // 2026-05-27 — TOGGLE behavior. Operator: "when i engage a highlight,
  // it should stay highlighted and i should be able to click again to
  // remove them, i need to be able to quickly click from one player to
  // another during the intros". So:
  //   - Click an UN-spotlit player → spotlight them.
  //   - Click the player who is CURRENTLY spotlit → clear.
  //   - Click a DIFFERENT player while one is spotlit → switch directly.
  // Comparing on normalized name (case- and whitespace-insensitive)
  // because the title in storage may differ in capitalization from
  // the roster entry.
  const showPlayer = (p: any) => {
    const playerName = String(p.name || '').trim() || 'Player';
    const currentlySpotlit =
      sp.visible &&
      typeof sp.title === 'string' &&
      sp.title.trim().toLowerCase() === playerName.toLowerCase();
    if (currentlySpotlit) {
      ctl.spotlight.mutate({ clear: true });
      // Don't auto-close on a clear — operator may want to spotlight
      // someone else right after; keep the picker open for rapid
      // intro / mid-game switching.
      return;
    }
    ctl.spotlight.mutate({
      visible: true,
      title: playerName,
      photoUrl: p.photoUrl || undefined,
      subtitle:
        [p.number ? `#${p.number}` : null, p.position].filter(Boolean).join(' · ') ||
        undefined,
      lines: Object.entries(p.stats || {})
        .slice(0, 4)
        .map(([label, value]) => ({ label: String(label), value: String(value) })),
    });
    // Don't auto-close on switch either — the new highlight is visible
    // on the live preview that operator can see; closing forces a re-
    // open for the next switch, which kills the intro-flow tempo.
  };

  /** True when `p` is the currently-spotlit player. Used by the
   *  picker UI to highlight the active tile so the operator can see
   *  at a glance who's "on air". */
  const isPlayerOnAir = (p: any): boolean => {
    if (!sp.visible || !sp.title) return false;
    const playerName = String(p.name || '').trim();
    return sp.title.trim().toLowerCase() === playerName.toLowerCase();
  };

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">
        Feature a player or a promo on the scoreboard — photo, title, and up to four stat lines.
        {onAir && <span className="ml-1 font-bold text-green-600">● On the board now</span>}
      </p>
      {players.length > 0 && (
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-500">
            Tap a player to put them on the board — tap again to clear, or tap another to switch.
          </label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {players.map((p) => {
              const onAir = isPlayerOnAir(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => showPlayer(p)}
                  disabled={ctl.spotlight.isPending}
                  title={onAir ? 'On air — tap to clear' : 'Tap to put on air'}
                  className={
                    onAir
                      ? 'flex items-center gap-1.5 rounded-lg border-2 border-amber-500 bg-amber-100 px-2.5 py-1.5 ring-2 ring-amber-300 transition-colors disabled:opacity-50'
                      : 'flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50'
                  }
                >
                  {onAir && <span className="text-[10px] font-black text-amber-700">● ON AIR</span>}
                  {p.number ? (
                    <span className="text-[11px] font-black text-slate-400">#{p.number}</span>
                  ) : null}
                  <span className={onAir ? 'text-sm font-bold text-amber-900' : 'text-sm font-semibold text-slate-800'}>
                    {p.name}
                  </span>
                  {p.team === 'away' ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      away
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Or build a custom highlight (a promo, a milestone) below.
          </p>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500">Title</label>
          <Input
            className="mt-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mookie Betts  ·  or  ·  $2 Hot Dog Night"
            maxLength={80}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Subtitle</label>
          <Input
            className="mt-1"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="#50 · Right Field"
            maxLength={80}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="text-xs font-semibold text-slate-500">Photo</label>
        <div className="mt-1 flex items-center gap-2">
          {photoUrl.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photoUrl}
              src={photoUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon className="h-4 w-4" />
            Choose
          </Button>
          <Input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="…or paste a URL"
            maxLength={2048}
          />
        </div>
      </div>
      {pickerOpen && (
        <AssetPicker
          kind="image"
          title="Choose spotlight photo"
          onPick={(url) => {
            setPhotoUrl(url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div className="mt-3">
        <label className="text-xs font-semibold text-slate-500">Stat lines</label>
        <div className="mt-1 grid sm:grid-cols-2 gap-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="w-24"
                value={l.label}
                onChange={(e) => setLine(i, 'label', e.target.value)}
                placeholder="Stat"
                maxLength={24}
              />
              <Input
                value={l.value}
                onChange={(e) => setLine(i, 'value', e.target.value)}
                placeholder="Value"
                maxLength={24}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          onClick={show}
          disabled={!title.trim() || ctl.spotlight.isPending}
          className="gap-1.5"
        >
          <Star className="h-4 w-4" />
          Put on the board
        </Button>
        {onAir && (
          <Button variant="outline" onClick={remove} disabled={ctl.spotlight.isPending}>
            Remove from board
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Unused import guard (StatField kept for possible future use) ─
// StatField was used in the old scrolling layout for the stats
// section inside the live-control group. In the v4 layout the same
// data is surfaced via StatChip / QuickStatChips in the team zones.
// Keeping it here avoids a "declared but never used" TS error while
// the hook signature types still reference SportStatField.
function _StatField({
  field,
  value,
  onCommit,
}: {
  field: SportStatField;
  value: unknown;
  onCommit: (v: number | string) => void;
}) {
  const [local, setLocal] = useState<string>(
    value === undefined || value === null ? '' : String(value),
  );
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setLocal(value === undefined || value === null ? '' : String(value));
    }
  }, [value]);

  const commit = () => {
    if (field.type === 'number') {
      let n = parseInt(local, 10);
      if (Number.isNaN(n)) n = field.min ?? 0;
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      setLocal(String(n));
      onCommit(n);
    } else {
      onCommit(local);
    }
  };

  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{field.label}</label>
      <Input
        className="mt-1"
        type={field.type === 'number' ? 'number' : 'text'}
        value={local}
        min={field.min}
        max={field.max}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
// Suppress "declared but never read" for the guard above.
void _StatField;

// ── Celebration pack picker ────────────────────────────────────
//
// 2026-05-27 — Two visual packs ship today; the operator picks per
// game. v1 is the cinematic library that's been running on the
// scoreboard + the new horizontal "RibbonCelebrationStrip" on the
// ribbon. v2 is the new combined-engine pack (engine.js +
// cues-waterpolo.js) — same canvas engine renders both 1920×1080
// scoreboard and 2400×256 ribbon from a single set of cue files.
//
// Adding a v3 / v4 is purely additive: register the keys in
// celebration-assets.ts, drop assets in public/celebrations/<pack>/,
// add an option below.
function CelebrationPackPicker({
  value,
  onChange,
}: {
  value: 'v1' | 'v2';
  onChange: (pack: 'v1' | 'v2') => void;
}) {
  const options: { key: 'v1' | 'v2'; name: string; desc: string }[] = [
    {
      key: 'v2',
      name: 'Stadium v2 (default)',
      desc: 'Sophisticated FINA water polo canvas engine — same cue plays brand-matched on both the scoreboard and ribbon. Water polo has full v2 art; other sports gracefully fall back to Classic.',
    },
    {
      key: 'v1',
      name: 'Classic',
      desc: 'Older marquee scoreboard cinematics + horizontal ribbon strip. Only choose if you specifically want the legacy art.',
    },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`text-left rounded-xl p-4 border-2 transition-colors ${
              active
                ? 'bg-indigo-50 border-indigo-500'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`font-bold text-sm ${active ? 'text-indigo-700' : 'text-slate-900'}`}>
                {opt.name}
              </span>
              {active && (
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">
                  Selected
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 leading-snug">{opt.desc}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── ShortcutCheatSheet ─────────────────────────────────────────
//
// Keyboard shortcut reference modal. Triggered by the '?' key or the
// Keys toolbar button. Closes on Escape or backdrop click.
//
// Lists static shortcuts first (clock, score, undo, clock reset,
// timeouts, modal), then dynamic cue rows driven by def.celebrations
// so the table stays correct as sport definitions evolve.
//
// Chromium-83 (Taurus): no `inset-*` / `inset: 0` — all absolute
// positioning uses top-0 right-0 bottom-0 left-0 longhand.
// Modal itself is dashboard-only (never runs on Taurus player), but
// following the rule keeps the codebase consistent.
function ShortcutCheatSheet({
  def,
  onClose,
}: {
  def: SportDefinition | undefined;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  type Row = { keys: string; desc: string };

  const STATIC_ROWS: Row[] = [
    { keys: 'Space', desc: 'Start / stop clock (toggle)' },
    { keys: 'h', desc: 'Home team +1' },
    { keys: 'a', desc: 'Away team +1' },
    { keys: 'Shift + H', desc: 'Home team −1' },
    { keys: 'Shift + A', desc: 'Away team −1' },
    { keys: 'u', desc: 'Undo last event' },
    { keys: 'r', desc: 'Reset clock to segment start (confirms first)' },
    { keys: 't', desc: 'Call timeout — home' },
    { keys: 'Shift + T', desc: 'Call timeout — away' },
    { keys: '?', desc: 'Open / close this shortcuts panel' },
    { keys: 'Esc', desc: 'Close this panel' },
  ];

  const cueRows: Row[] = (def?.celebrations ?? [])
    .slice(0, 9)
    .map((c, i) => ({
      keys: String(i + 1),
      desc: `Fire cue: ${c.emoji ? `${c.emoji} ` : ''}${c.label}`,
    }));

  const allRows = [...STATIC_ROWS, ...cueRows];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed top-0 left-0 right-0 bottom-0 z-[9000] flex items-center justify-center p-4 bg-slate-900/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Keyboard shortcuts</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Shortcut rows */}
        <div className="overflow-y-auto max-h-[70vh] divide-y divide-slate-50">
          {allRows.map((row) => (
            <div key={row.keys} className="flex items-center gap-3 px-5 py-2.5">
              <kbd className="shrink-0 min-w-[72px] text-center bg-slate-100 border border-slate-200 rounded px-2 py-0.5 text-xs font-mono font-bold text-slate-700">
                {row.keys}
              </kbd>
              <span className="text-sm text-slate-700">{row.desc}</span>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
          <p className="text-[11px] text-slate-400">
            Shortcuts are active in Run mode only and do nothing when typing in a text field.
          </p>
        </div>
      </div>
    </div>
  );
}
