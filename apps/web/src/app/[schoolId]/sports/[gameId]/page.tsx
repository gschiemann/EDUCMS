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
  Keyboard,
  Copy,
  Upload,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { RoleGate } from '@/components/RoleGate';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
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
import { findSport, formatScore, parseScoreInput, PLAYER_STATS } from '@cms/api-types';
import type { SportDefinition, SportStatField } from '@cms/api-types';
import { computeCtsStatus, type CtsStatus } from '@/lib/cts-merge';
import QRCode from 'qrcode';
import { RosterPanel } from './RosterPanel';
import { LeadersPanel } from './LeadersPanel';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
// CtsCuePanel kept in the repo (./CtsCuePanel.tsx) but no longer
// rendered as its own tab — the existing Celebrations panel inside
// Run-game mode now drives the CTS orchestrator via the cue feed.
import { CueLaunchpad } from './CueLaunchpad';
import { SponsorPanel } from './SponsorPanel';
import {
  FREQ_TIERS,
  FREQ_TIER_WEIGHT,
  weightToTier,
  CAP_PRESETS,
  capLabel,
} from './sponsor-frequency';
import { RibbonPanel } from './RibbonPanel';
import { RibbonPresetsPanel } from './RibbonPresetsPanel';
import { RibbonImagesPanel } from './RibbonImagesPanel';
import { SurfacePreview } from './SurfacePreview';
import { ConsoleScoreboardCelebration } from './ConsoleScoreboardCelebration';
import { SurfaceHealthPills } from './SurfaceHealthPills';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { RecentEventsBar } from './RecentEventsBar';

// ── constants ──────────────────────────────────────────────────

/**
 * Role-view QR — generated CLIENT-SIDE via the bundled `qrcode` lib (same
 * pure-client pattern as the screen-pairing QR in screens/page.tsx and the
 * MFA card). We do NOT round-trip the URL through a third-party QR image
 * service: the role link carries the tenant slug + game id, and the repo is
 * public — keep it local + privacy-preserving.
 */
function RoleViewQr({ url, label }: { url: string; label: string }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 180, margin: 1 })
      .then((d) => { if (alive) setDataUrl(d); })
      .catch(() => { if (alive) setDataUrl(''); });
    return () => { alive = false; };
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return dataUrl ? (
    <img src={dataUrl} alt={`QR code to open the ${label} view`} className="h-[72px] w-[72px] shrink-0 rounded-md bg-white" />
  ) : (
    <div className="h-[72px] w-[72px] shrink-0 rounded-md bg-slate-100" aria-hidden />
  );
}

// item A (2026-06-20) — GAME_STATUSES removed: the old Setup stepper that mapped
// it is gone. Live state transitions now live in RunStatusControl (which inlines
// its own per-state button set), and Setup shows a read-only status chip.

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
  // Hide the mobile tab bar while any Run-screen popup is open so its
  // bottom-sheet footer (items-end on mobile) clears the bottom of the
  // screen. The Shortcut cheat-sheet + PlayerActionMenu register their
  // own locks within their own components.
  useOverlayLock(showCues || showHighlights || showPenalties);

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
  // Use the same hook RecentEventsBar uses — share the query cache, zero
  // extra fetches.
  const { data: recentEvents } = useGameEvents(gameId);
  const undoEvent = useUndoGameEvent(gameId);

  // item 0 (2026-06-20) — sponsors power the Setup-checklist "Ready" badge.
  // Shared React Query cache with SponsorPanel, so no extra fetch.
  const { data: sponsorsList } = useSponsors();

  // item A/0 — land a SCHEDULED/PRE-GAME game in Setup and a live game in Run,
  // ONCE on first load (a ref guards it so it never fights manual tab clicks).
  // Before this, every game opened in Run regardless of state.
  const didInitMode = useRef(false);
  useEffect(() => {
    const st = (game as any)?.status;
    if (didInitMode.current || !st) return;
    didInitMode.current = true;
    setMode(st === 'SCHEDULED' || st === 'PRE_GAME' ? 'setup' : 'run');
  }, [game]);

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

  // Stream-overlay URL — copy to clipboard for an OBS / vMix / Hudl
  // Browser Source. Points at the full-canvas /overlay route (the
  // broadcast variant that pins the bug inside a fixed 1920×1080 canvas
  // so it renders identically at 720p / 1080p / 4K output). Same live
  // game state as the in-venue board → the stream + board never disagree.
  const [copied, setCopied] = useState(false);
  const copyOverlayUrl = () => {
    const url = `${window.location.origin}/overlay/${gameId}?surface=stream`;
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

  // item A/0 — the single primary action: go live (Scheduled→LIVE via the same
  // unified status mutation the old stepper used) THEN open Run; once live, it
  // just opens Run. Routing on mutation success so the operator never lands in
  // Run before the state actually flipped.
  const onLive = () => {
    if (g.status === 'SCHEDULED' || g.status === 'PRE_GAME') {
      ctl.status.mutate({ status: 'LIVE' }, { onSuccess: () => setMode('run') });
    } else {
      setMode('run');
    }
  };
  // item 0 — positive "Ready ✓" badges for the two Setup sections with a clear
  // signal (a custom layout chosen; an active sponsor). Optional sections never
  // show a "needs attention" state — a game only needs two teams to go live.
  const displaysReady = !!(g.scoreboardTemplateId || g.ribbonTemplateId);
  const sponsorsReady = Array.isArray(sponsorsList) && sponsorsList.some((s: any) => s?.active);

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
              onClick={copyOverlayUrl}
              title="Copy the transparent stream-overlay URL — add it as a Browser Source in OBS / vMix / Hudl (1920×1080). Same live game state as the in-venue board."
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Stream'}</span>
            </Button>
          )}
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

      {/* RUN MODE — 3-zone no-scroll live console with a full-width
          run-of-show strip docked UNDERNEATH (RecentEventsBar). The bar
          replaced the old 320px right rail, which overflowed off the
          right edge on narrower windows. Column layout: the console fills
          the available height; the bar is a fixed-height strip at the
          bottom that polls GET /events?limit=25 every 2 s and surfaces
          per-row Undo on hover. */}
      {mode === 'run' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
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
              onHighlights={() => setShowHighlights(true)}
              onPenalties={() => setShowPenalties(true)}
            />
          </div>
          {/* Hidden in show / pa views where the strip would crowd the
              reduced-control layout. */}
          {(view === '' || view === 'score') && (
            <RecentEventsBar gameId={gameId} sport={(g as any)?.sport} />
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

      {/* SETUP MODE
          ─────────────────────────────────────────────────────────
          Clean 6-section layout (2026-05-27 UX reorg):
            1  Game basics    — status + segment override
            2  Teams          — roster + pregame intro
            3  Displays       — screen push + layouts + live preview
            4  Ribbon         — presets + messages + images (all ribbon config together)
            5  Sponsors       — manage sponsors + flight/frequency scheduling (both sponsor pieces in one place)
            6  Show settings  — celebration pack + sound/co-brand + CTS status + shot clock
          ──────────────────────────────────────────────────────── */}
      {mode === 'setup' && (
        <div className="flex-1 overflow-auto bg-slate-50">
          <div className="max-w-4xl mx-auto p-4 space-y-4">

            {/* ── 1. GAME BASICS ─────────────────────────────────
                Status pill row — the one place to move the game
                between SCHEDULED → PRE_GAME → LIVE → HALFTIME →
                FINAL. FINAL requires a hold-to-confirm (destructive:
                ends all real-time mutations). */}
            {/* item A/0 (2026-06-20) — Setup is a pre-game checklist now. The
                old 5-state stepper is GONE from here (Setup is always
                "Scheduled", so it was a dead/confusing control); a read-only
                status chip sits here, the single Go-Live action is at the
                bottom, and live state changes (Halftime/Final) live in Run. */}
            <Section title="Tonight&rsquo;s game">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-base">
                  <span className="font-extrabold text-slate-900">{g.homeTeam}</span>
                  <span className="text-slate-400 text-sm">vs</span>
                  <span className="font-extrabold text-slate-900">{g.awayTeam}</span>
                </div>
                <span
                  aria-live="polite"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest border bg-slate-100 text-slate-600 border-slate-200 shrink-0"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  {String(g.status || 'SCHEDULED').replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2.5">
                Set everything below before the game, then tap{' '}
                <span className="font-semibold text-slate-500">Go Live</span> at the bottom.
                During the game, change states (Halftime, Final) from the{' '}
                <span className="font-semibold text-slate-500">Run game</span> tab.
              </p>
            </Section>

            {/* ── 2. TEAMS ────────────────────────────────────────
                Roster management (add/edit/remove players, upload
                headshots, bulk CSV import) lives here.
                Pregame intro choreography sits right below — it
                consumes the roster, so the two belong together.
                The pre-game flow is: build roster → fire intros →
                go live. */}
            <Section title="Teams &amp; roster">
              <RosterPanel
                gameId={gameId}
                homeTeam={g.homeTeam}
                awayTeam={g.awayTeam}
                statKeys={PLAYER_STATS[g.sport] || []}
              />
            </Section>

            {/* T2-4 — Starting-lineup intro choreography.
                Fires a 'pregame-intro' CUE that takes over the
                scoreboard with per-player slots. Adjacent to the
                roster because it directly consumes it. */}
            <Section title="Pregame intro">
              <PregameIntroPanel gameId={gameId} ctl={ctl} game={g} />
            </Section>

            {/* Leaders — read-only stat leaders + auto player-of-the-game,
                computed server-side off the roster (single source of truth:
                GET /sports/board/:id). One-tap "Spotlight this player" reuses
                the console spotlight mutation. Gated behind SPORTS_PLAYER_STATS;
                sits next to the roster it derives from. */}
            {isFeatureEnabled(FLAGS.SPORTS_PLAYER_STATS) && (
              <Section title="Leaders &amp; player of the game">
                <LeadersPanel gameId={gameId} homeTeam={g.homeTeam} awayTeam={g.awayTeam} />
              </Section>
            )}

            {/* ── 3. DISPLAYS ─────────────────────────────────────
                Everything about what's actually showing on screens:
                  • which screen shows what (scoreboard / ribbon / off)
                  • which templates are loaded on each surface
                  • live preview of the scoreboard + ribbon together
                Layouts and preview are co-located — pick the layout,
                see it immediately in the preview below it. */}
            <Section title="Displays &amp; layouts" done={displaysReady}>
              {/* item C (2026-06-16) — plain-English intro so "per-surface
                  template" stops being jargon. */}
              <p className="text-xs text-slate-400 mb-3">
                Every screen at your venue can show a different design — your main
                Scoreboard, the LED Ribbon, or a broadcast Scorebug. Below: choose what
                shows on each screen, pick the design it uses, and preview it live.
              </p>
              <div className="space-y-5">
                {/* Screen push — assign each physical display */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Screen assignment
                  </p>
                  <p className="text-xs text-slate-400 mb-2">
                    Which physical display shows what — the Scoreboard, the Ribbon, or off.
                  </p>
                  <ScreenPushPanel gameId={gameId} />
                </div>

                {/* Layout picker — scoreboard / ribbon / scorebug templates */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    The design each screen shows
                  </p>
                  <p className="text-xs text-slate-400 mb-2">
                    Pick a look for each surface — a Scoreboard design, a Ribbon design,
                    and (if you livestream) a Scorebug overlay.
                  </p>
                  <LayoutsPanel g={g} ctl={ctl} />
                </div>

                {/* Live preview — iframes of scoreboard + ribbon */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Live preview
                  </p>
                  <SurfacePreview gameId={gameId} />
                </div>
              </div>
            </Section>

            {/* ── 4. RIBBON ──────────────────────────────────────
                All four ribbon-config panels in one place:
                  • Presets — which content tiles ride the reel
                    (score, clock, sport situation, messages, sponsors,
                    images) + scroll speed
                  • Messages — custom text crawl lines
                  • Images — full-bleed sponsor / promo slides
                Previously these were scattered with unrelated settings
                between them. Now it is one mental model: "what the
                ribbon shows and how". */}
            <Section title="Ribbon">
              {/* item E2/F (2026-06-16) — explain what the ribbon shows and how. */}
              <p className="text-xs text-slate-400 mb-3">
                The LED ribbon is the long, thin board that loops content around your venue.
                Below: choose what rides the loop and how fast, add crowd shout-outs, and
                drop in your own graphics.
              </p>
              <div className="space-y-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    What rides the reel &amp; how fast
                  </p>
                  <p className="text-xs text-slate-400 mb-2">
                    Turn each tile on or off — score, clock, the sport situation, messages,
                    sponsors — and set how fast the loop scrolls.
                  </p>
                  <RibbonPresetsPanel gameId={gameId} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Crowd messages
                  </p>
                  <p className="text-xs text-slate-400 mb-2">
                    Shout-outs that scroll on the ribbon — e.g. &ldquo;Welcome Parents,
                    Section 104!&rdquo; or &ldquo;Senior Night — thank you, Class of 2026.&rdquo;
                  </p>
                  <RibbonPanel gameId={gameId} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Your graphics &amp; logos
                  </p>
                  <p className="text-xs text-slate-400 mb-2">
                    Full-screen slides of your OWN images — school logo, &ldquo;Go Tigers&rdquo;,
                    senior-night photos. Paid sponsor ads live in the Sponsors section below so
                    we can track plays for billing.
                  </p>
                  <RibbonImagesPanel gameId={gameId} />
                </div>
              </div>
            </Section>

            {/* ── 5. SPONSORS ────────────────────────────────────
                Both sponsor management surfaces in one card:
                  • SponsorPanel — add/edit/remove brands, upload logos,
                    weight sliders, enable/disable, proof-of-play report
                  • SponsorSchedulingSection — flight dates + per-hour
                    frequency caps per brand
                Previously SponsorPanel was "Ribbon sponsors" and
                SponsorSchedulingSection was a separate "Sponsor ad
                scheduling" card — same data, two places. */}
            <Section title="Sponsors" done={sponsorsReady}>
              <div className="space-y-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Brands &amp; logos
                  </p>
                  <SponsorPanel />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Flight dates &amp; frequency caps
                  </p>
                  <SponsorSchedulingInner />
                </div>
              </div>
            </Section>

            {/* ── 6. SHOW SETTINGS ───────────────────────────────
                Pre-game configuration for the show itself:
                  • Celebration pack — which visual library fires on goals
                  • Celebration sound + co-brand — audio URL and which
                    sponsor to overlay on every celebration cue
                  • Shot clock (sport-conditional)
                  • CTS console status — is the scoreboard console
                    broadcasting? Shows green/amber/slate status pill
                Note: the "Celebrations" panel here lets the operator
                TEST fire cues from Setup, but the primary cue surface
                is the Run mode inline bar. This is configuration /
                pre-game rehearsal, not live ops. */}
            <Section title="Show settings">
              <div className="space-y-5">
                {/* Celebration pack */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Celebration animation pack
                  </p>
                  <CelebrationPackPicker
                    value={
                      // 2026-05-28: default to v2 (the good FINA water polo art).
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
                </div>

                {/* Celebration sound + sponsor co-brand */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Celebration sound &amp; co-brand
                  </p>
                  <PresentationSettingsSection gameId={gameId} def={def} ctl={ctl} />
                </div>

                {/* Shot clock — only for sports that have one */}
                {def.shotClock && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                      Shot clock
                    </p>
                    <ShotClockSetup
                      gameId={gameId}
                      current={(g.stats || {}) as Record<string, unknown>}
                      config={def.shotClock}
                    />
                  </div>
                )}

                {/* CTS console status — is the scoreboard console
                    broadcasting? Auto-refreshes 1 Hz from the game
                    record; no extra fetch. */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    CTS scoreboard console
                  </p>
                  {/* item K (2026-06-16) — plain-English explainer so a non-CTS
                      venue isn't staring at a cryptic status pill. */}
                  <p className="text-xs text-slate-400 mb-2">
                    Optional. If you have a physical scoreboard console (a CTS box) wired
                    to VenueOS, it feeds live score &amp; clock here automatically — no
                    typing. Most venues leave this off and run the game from this screen;
                    the pill below just shows whether a console is currently sending.
                  </p>
                  <CtsConsoleStatus
                    stats={(g.stats as Record<string, unknown> | undefined) || {}}
                  />
                </div>

                {/* External score feed — the generic HMAC ingest path.
                    Any machine that can POST JSON (Sportzcast box, a
                    console reader, a custom script) can push live score /
                    clock to this game without a dashboard login. The
                    "Copy feed URL" button fetches a server-minted token
                    from /sports/games/:id/feed-credentials and copies the
                    ingest URL + token + a ready-to-run curl example.
                    2026-05-28: re-surfaced — the handler existed but had
                    no button (the toolbar entry was dropped for the
                    CTS-only water-polo install). */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    External score feed
                  </p>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs text-slate-500 mb-3">
                      Push live score &amp; clock from a Sportzcast box, console
                      reader, or any script that can POST JSON. Copy the
                      authenticated ingest URL + token below — no dashboard
                      login needed on the sending machine.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={copyFeedUrl}
                      title="Copy the machine-to-machine ingest URL + token (HMAC-authenticated)"
                    >
                      {feedCopied ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      <span>{feedCopied ? 'Copied feed URL + token' : 'Copy feed URL'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            </Section>

            {/* item A/0 — the checklist's single primary action. Go-Live runs
                the Scheduled→LIVE transition via the same unified status
                mutation, then opens Run. */}
            <GoLiveBar g={g} onLive={onLive} />

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
  onHighlights: () => void;
  onPenalties: () => void;
}) {
  const isBaseballSoftball = def.key === 'baseball' || def.key === 'softball';
  const stats: Record<string, unknown> = g.stats || {};
  // How many players are currently serving time — drives the tray
  // badge for the penalty-box sports (hockey, lacrosse, …).
  const penaltyCount = def.penaltyBox ? livePenalties(stats).length : 0;

  // ── "Send this view to another device" share sheet ───────────
  // The multi-operator differentiator: a second person (PA in the
  // booth, a kid running the ribbon) joins by opening a role-scoped
  // URL on their own phone. We surface a copy-link + QR for each
  // role view so nobody has to type a URL by hand. State is local to
  // RunMode — the sheet is a lightweight popover, no parent plumbing.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState<ConsoleView | null>(null);

  // NOTE (2026-06-15 console-UX): the old single-shot in-memory undo
  // state (lastAction/lastScore/scoreHome/scoreAway/undoScore) was
  // removed here. It was self-referential dead code — never consumed by
  // ScoreTile (which calls ctl.score.mutate directly) or any render
  // path. The authoritative undo is now the server-backed per-row Undo
  // in <RecentEventsBar> (POST /events/:id/undo), which survives reloads
  // and multi-operator sessions. Per CLAUDE.md §9, no dead code that
  // looks like a feature.

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
  // Sports whose live tray carries a per-player counter / one-tap macro.
  const isBasketball      = def.key === 'basketball';
  const isWaterPolo       = def.key === 'water_polo';
  // The judged per-apparatus / per-routine sports — these get an
  // event = apparatus / round variant of the meet results grid where the
  // "mark" is a decimal judged score (Vault 9.850, Routine 285.5).
  const isJudgedResults   = def.key === 'gymnastics' || def.key === 'competitive_cheer';
  // LEADERBOARD sports (track / swim / cross-country / golf) + the judged
  // sports all use the meet-results grid (finish order or apparatus scores).
  const showResultsGrid   = (def.mode === 'LEADERBOARD' || isJudgedResults) && view !== 'pa';
  const showBottomTray    =
    showClockControls &&
    (isBaseballSoftball || def.key === 'football' || isBasketball || isWaterPolo);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── View-role switcher + live action rail ─────────────────
          The switcher pills changed a tablet's role (Scorekeeper /
          Show Caller / PA). The right-hand rail carries the
          always-available live actions every operator reaches for
          mid-game: Cues (the full launchpad), Spotlight (the sponsor-
          activation moment), the penalty box, and "Send to device"
          (hand a role view to a second operator's phone). All targets
          are ≥44px so a wet-fingered volunteer can't fat-finger them. */}
      <div className="flex items-center gap-1.5 px-3 sm:px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0 overflow-x-auto">
        {/* Clearer than the old tiny 11px "VIEW" — an icon + an
            explicit verb so a first-timer knows this row switches roles. */}
        <span
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1 shrink-0"
          title="Switch what this device shows — hand each role to a different operator"
        >
          <Tv className="h-4 w-4 text-slate-400" />
          <span className="hidden sm:inline">Switch view</span>
        </span>
        {VIEW_PILLS.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.title}
            onClick={() => onViewChange(p.key)}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-colors shrink-0 ${
              view === p.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-700'
            }`}
          >
            {p.label}
          </button>
        ))}

        {/* ── Live action rail (right) ──────────────────────────── */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {/* Cues live inline where they're needed — the Full view has the
              inline cue bar and Show Caller has the always-on launchpad;
              Scorekeeper/PA intentionally hide cues. The old top-level
              "Cues" button duplicated all of that, so it was removed
              (2026-06-16, operator feedback). */}

          {/* SPOTLIGHT — the custom promo / player Spotlight. Same orphan
              as Cues: onHighlights was passed in but never invoked. This
              is the sponsor-activation moment ADs sell, so it gets a
              first-class trigger. (2026-06-15 console-UX P1) */}
          <button
            type="button"
            onClick={onHighlights}
            title="Spotlight a player or sponsor on the scoreboard AND the ribbon"
            className="min-h-[44px] px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-colors shrink-0 flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:border-amber-400 hover:text-amber-700"
          >
            <Star className="h-4 w-4" />
            <span className="hidden sm:inline">Spotlight</span>
          </button>

          {/* Penalty-box (exclusion) manager — open the box list to release
              a player early (power-play goal), add, or clear. Gated to sports
              that have a box (water polo / hockey / lacrosse). The onPenalties
              callback wiring landed 2026-06-11 (sports-venue audit P0). */}
          {def.penaltyBox && (
            <button
              type="button"
              title={`${def.penaltyBox.label} — add / release early / clear exclusions`}
              onClick={onPenalties}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-colors shrink-0 flex items-center gap-1.5 ${
                penaltyCount > 0
                  ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-amber-400 hover:text-amber-700'
              }`}
            >
              <span aria-hidden>⏱</span>
              <span className="hidden sm:inline">{def.penaltyBox.label}</span>
              {penaltyCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-5 px-1 rounded-full bg-amber-950 text-amber-50 text-[11px] tabular-nums">
                  {penaltyCount}
                </span>
              )}
            </button>
          )}

          {/* SEND TO DEVICE — the multi-operator differentiator. Opens a
              sheet with a copy-link + QR for each role view so a second
              operator (PA in the booth, a kid on the ribbon) joins from
              their own phone without typing a URL. (2026-06-15 console-UX) */}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            title="Send a role view (Scorekeeper / Show Caller / PA) to another phone or tablet"
            className="min-h-[44px] px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-colors shrink-0 flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Send to device</span>
          </button>
        </div>
      </div>

      {/* ── SEND TO DEVICE sheet ──────────────────────────────────
          A second operator opens one of these role-scoped URLs on their
          own phone and instantly joins the same live game in the right
          role. We render a tap-to-copy link + a QR (generated client-side
          via the bundled qrcode lib — see RoleViewQr) for each view.
          Backdrop click / ✕ closes. */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-3 sm:items-center sm:p-4"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Send a view to another device</h2>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-[12px] text-slate-500">
              Hand one of these to a second operator — they open it on their
              own phone and join this live game in that role. No login menu,
              no typing a URL.
            </p>
            <div className="space-y-2.5">
              {VIEW_PILLS.map((p) => {
                // Build an absolute, role-scoped URL for this game. `Full`
                // (key '') drops the param so it's a clean console link.
                const base =
                  typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
                const url = p.key ? `${base}?view=${p.key}` : base;
                return (
                  <div
                    key={p.key || 'full'}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5"
                  >
                    <RoleViewQr url={url} label={p.label} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold text-slate-900">{p.label}</div>
                      <div className="truncate text-[11px] text-slate-400">{p.title}</div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard?.writeText(url);
                            setShareCopied(p.key);
                            setTimeout(
                              () => setShareCopied((cur) => (cur === p.key ? null : cur)),
                              1800,
                            );
                          } catch {
                            /* clipboard blocked (insecure ctx) — QR still works */
                          }
                        }}
                        className="mt-1.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
                      >
                        {shareCopied === p.key ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied link
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> Copy link
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* item A (2026-06-20) — the live game-state control lives HERE in Run
          (state changes belong with the live game). Reuses the unified status
          mutation, so the status cinematics + horn (T1-5) and durable undo
          (T1-2) fire on every transition. Setup no longer carries a stepper. */}
      <RunStatusControl g={g} ctl={ctl} />

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

      {/* ── Score / Full views — scoreboard fills, control rows pinned ──
          2026-06-15 — this wrapper was missing `flex-1` (its PA/Show-view
          siblings above have it), so it sized to its CONTENT instead of the
          remaining height and pushed the pinned roster/cues/tray rows off the
          bottom of the viewport — THE reason the operator had to scroll
          up/down mid-game. With flex-1 + min-h-0 the scoreboard claims exactly
          the leftover space and the control rows stay pinned + always visible;
          only the scoreboard area itself scrolls, and only if it can't fit. */}
      {!showPaSpotlight && !showSurfacePreviews && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {showScoreboard && (
              // relative wrapper so the celebration overlay can sit ON the
              // interactive scoreboard — the operator sees a fired cue play
              // right here, not only on the ribbon preview / popped-out board.
              <div className="relative">
                <RunInteractiveScoreboard
                  g={g}
                  def={def}
                  liveMs={liveMs}
                  homeColor={homeColor}
                  awayColor={awayColor}
                  ctl={ctl}
                />
                <ConsoleScoreboardCelebration
                  gameId={gameId}
                  sport={def.key}
                  pack={
                    g?.stats?.celebrationPack === 'v2' ||
                    def.key === 'basketball' ||
                    def.key === 'water_polo' ||
                    def.key === 'water-polo'
                      ? 'v2'
                      : 'v1'
                  }
                />
              </div>
            )}
            {/* Meet results / per-apparatus grid. Leaderboard sports have
                no team-tile scoring worth touching during a meet — finish
                order IS the scoreboard — so the operator records places
                + marks here. Gymnastics / cheer use the same grid in a
                per-apparatus mode (event = apparatus, mark = judged score). */}
            {showResultsGrid && (
              <MeetResultsSection
                g={g}
                def={def}
                ctl={ctl}
                judged={isJudgedResults}
              />
            )}
          </div>

          {/* Pinned bottom (always visible, no scroll): ribbon preview FIRST
              so the operator always sees what's on the LED ribbon, then the
              collapsible roster + cues + sport tray. Moving the ribbon out of
              the scrolling region is what lets the scoreboard AND the ribbon
              both stay on screen without scrolling. (2026-06-16 operator fb) */}
          <div className="shrink-0">
            {showRibbonPreview && <RunRibbonPreview gameId={gameId} />}
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
              <div className="flex flex-wrap items-stretch gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
                {isBaseballSoftball && (
                  <>
                    <BaseTrayBall
                      stats={stats}
                      onStat={(s) => ctl.stats.mutate({ stats: s })}
                      onAdvanceHalf={() => advanceBaseballHalf(def, g, ctl)}
                    />
                    {/* One-tap home-run macro — picks runs (1-4), applies the
                        score delta to the batting team AND fires the matching
                        cinematic (home run / grand slam). Solves the ambiguous
                        +1/+2/+3 delta that can't auto-celebrate. */}
                    <HomeRunMacro g={g} def={def} ctl={ctl} stats={stats} />
                  </>
                )}
                {isBasketball && (
                  <PlayerFoulStepper gameId={gameId} g={g} ctl={ctl} stats={stats} />
                )}
                {isWaterPolo && (
                  <PlayerExclusionStepper gameId={gameId} g={g} ctl={ctl} stats={stats} />
                )}
                {def.key === 'football' && (
                  <>
                    {/* Down & distance + Ball On + possession — the live
                        football control set. Was dead code (only reachable
                        through the never-rendered TeamZone); now mounted in
                        the operator's bottom tray. (audit: console P0) */}
                    <FootballControls
                      def={def}
                      stats={stats}
                      onStat={(s) => ctl.stats.mutate({ stats: s })}
                    />
                    <PlayClockBtn
                      stats={stats}
                      onAction={(a, v) => ctl.playClock.mutate({ action: a, value: v })}
                    />
                  </>
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
              {formatScore(def, g.homeScore)}
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
              {formatScore(def, g.awayScore)}
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
/** Manual game-clock entry — type an exact M:SS to set/correct the clock,
 *  like every pro scoreboard console. We only had ±1s nudges before; the
 *  operator asked to "type exactly how much time left to fix it." Uses the
 *  same `set` action the nudges use; parseClock accepts M:SS … MMM:SS. */
function ClockTypeIn({ liveMs, onSet }: { liveMs: number; onSet: (ms: number) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const begin = () => { setText(fmtClock(liveMs)); setOpen(true); };
  const commit = () => {
    const ms = parseClock(text);
    if (ms != null) onSet(ms);
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={begin}
        className="min-h-[44px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 font-bold text-sm transition-colors border border-slate-700"
        title="Type an exact time (M:SS) to correct the clock"
      >
        ⌨ Set time
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="M:SS"
        aria-label="Set clock time, minutes colon seconds"
        className="w-20 min-h-[44px] text-center text-xl font-black tabular-nums rounded-lg bg-slate-950 border border-amber-500 text-white outline-none"
      />
      <button
        type="button"
        onClick={commit}
        className="min-h-[44px] px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-black text-sm"
      >
        Set
      </button>
    </span>
  );
}

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
          onSetAbsolute={(scaled) => ctl.score.mutate({ homeScore: scaled })}
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
            {/* Destructive: resets clock to segment start — hold-to-confirm.
                For Inning sports (baseball / softball) the chips walk the
                half (Top→Bot→next-inning-Top) instead of jumping a whole
                inning, so the operator can advance the half from the
                scoreboard header too. (audit: console P0) */}
            <HoldChip
              label="−"
              ariaLabel="Previous segment"
              onConfirm={() =>
                def.segment.name === 'Inning'
                  ? retreatBaseballHalf(def, g, ctl)
                  : ctl.segment.mutate({ delta: -1 })
              }
              className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 flex items-center justify-center text-lg font-bold border border-slate-700"
            />
            <span className="min-w-[80px] text-center text-amber-400 text-sm font-black tracking-widest">
              {segLabel}
            </span>
            {/* Destructive: resets clock to segment start — hold-to-confirm */}
            <HoldChip
              label="+"
              ariaLabel="Next segment"
              onConfirm={() =>
                def.segment.name === 'Inning'
                  ? advanceBaseballHalf(def, g, ctl)
                  : ctl.segment.mutate({ delta: 1 })
              }
              className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 flex items-center justify-center text-lg font-bold border border-slate-700"
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
              {/* Clock controls — start/stop, reset, ±1s. Start/Stop is the
                  primary control so it's the widest; all are ≥44px so the
                  operator can't fat-finger Reset (hold-to-confirm) when they
                  meant Stop. (2026-06-15 console-UX P0) */}
              <div className="flex items-center gap-1.5 mt-1 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => ctl.clock.mutate({ action: running ? 'pause' : 'start' })}
                  className={
                    running
                      ? 'min-h-[44px] px-4 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-amber-400 font-bold text-base transition-colors border border-amber-700 flex items-center gap-1.5'
                      : 'min-h-[44px] px-4 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-emerald-400 font-bold text-base transition-colors border border-emerald-700 flex items-center gap-1.5'
                  }
                  title={running ? 'Stop clock' : 'Start clock'}
                >
                  {running ? <><Pause className="h-4 w-4" /> Stop</> : <><Play className="h-4 w-4" /> Start</>}
                </button>
                {/* Destructive: resets clock to segment start — hold-to-confirm */}
                <HoldChip
                  ariaLabel="Reset clock to segment start"
                  onConfirm={() => ctl.clock.mutate({ action: 'reset' })}
                  className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 transition-colors border border-slate-700 flex items-center justify-center"
                >
                  <RotateCcw className="h-4 w-4" />
                </HoldChip>
                <button
                  type="button"
                  onClick={() => ctl.clock.mutate({ action: 'set', ms: Math.max(0, liveMs - 1000) })}
                  className="min-h-[44px] min-w-[44px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 font-bold text-sm transition-colors border border-slate-700"
                  title="−1s"
                >
                  −1s
                </button>
                <button
                  type="button"
                  onClick={() => ctl.clock.mutate({ action: 'set', ms: liveMs + 1000 })}
                  className="min-h-[44px] min-w-[44px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 font-bold text-sm transition-colors border border-slate-700"
                  title="+1s"
                >
                  +1s
                </button>
                {/* Manual time entry — type an exact M:SS to correct the clock. */}
                <ClockTypeIn
                  liveMs={liveMs}
                  onSet={(ms) => ctl.clock.mutate({ action: 'set', ms })}
                />
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
          onSetAbsolute={(scaled) => ctl.score.mutate({ awayScore: scaled })}
          def={def}
          stats={stats}
          onStat={(s) => ctl.stats.mutate({ stats: s })}
          onTimeout={() => ctl.callTimeout.mutate({ team: 'away' })}
        />
      </div>

      {/* Game-scope live data editor — the single most important live
          datum for many sports lives in a scope:'game' text/number
          field that had NO editor anywhere in the console before:
          cheer Division, track/swim Current Event, XC Lead Runner,
          gymnastics Current Apparatus, golf Current Hole, volleyball
          Serving. This row makes every one editable in Run mode.
          (audit: console P0 cheer + meet-sports, P1 gymnastics) */}
      <GameScopeStatEditor def={def} g={g} ctl={ctl} />

      {/* Volleyball / pickleball one-tap "End set → next set" macro:
          credits the set win to the leader, zeroes both point scores,
          fires the setWin cue, and advances the segment — all in one
          action so the operator never carries a stale score into the
          next set. (audit: console P1 — volleyball set advance) */}
      {def.clock.type === 'none' &&
        def.score.unit === 'points' &&
        (def.segment.name === 'Set' || def.segment.name === 'Game') && (
          <EndSetMacro def={def} g={g} ctl={ctl} />
        )}
    </div>
  );
}

// ── GameScopeStatEditor ────────────────────────────────────────
// The live-data editor for scope:'game' stats that have no dedicated
// tray/chip control. Text fields → labeled text input (or a Home/Away
// toggle for serve/possession); wide-range numbers → type-in; small
// ranges → +/- stepper. Keys already owned by the football/baseball
// trays or the possession arrow chip are excluded so a stat is never
// editable in two places. (audit: console P0 cheer + meet sports;
// P1 gymnastics apparatus)
//
// The keys this surfaced for the first time, per sport:
//   competitive_cheer  → Division (text)
//   track_and_field    → Current Event (text)
//   swimming_diving    → Current Event (text)
//   cross_country      → Lead Runner (text), Finishers (number)
//   gymnastics         → Current Apparatus (text)
//   golf               → Current Hole (number)
//   volleyball         → Serving (home/away)
const GAME_STAT_TRAY_OWNED = new Set([
  // football tray
  'down',
  'distance',
  'ballOn',
  // baseball tray
  'balls',
  'strikes',
  'outs',
  'half',
  'on1B',
  'on2B',
  'on3B',
  // possession arrow chip (basketball / football)
  'possession',
]);

function GameScopeStatEditor({
  def,
  g,
  ctl,
}: {
  def: SportDefinition;
  g: any;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const stats: Record<string, unknown> = g.stats || {};
  const fields = (def.stats || []).filter(
    (s) => s.scope === 'game' && !GAME_STAT_TRAY_OWNED.has(s.key),
  );
  if (fields.length === 0) return null;
  return (
    <div className="max-w-6xl mx-auto mt-3 flex flex-wrap items-end gap-3 px-1">
      {fields.map((s) => {
        // Serve / possession-style home-away picker.
        if (s.key === 'serving') {
          return (
            <GameScopeToggle
              key={s.key}
              label={s.label}
              value={stats[s.key]}
              homeTeam={g.homeTeam}
              awayTeam={g.awayTeam}
              onSet={(v) => ctl.stats.mutate({ stats: { [s.key]: v } })}
            />
          );
        }
        if (s.type === 'text') {
          return (
            <GameScopeText
              key={s.key}
              label={s.label}
              value={stats[s.key]}
              onCommit={(v) => ctl.stats.mutate({ stats: { [s.key]: v } })}
            />
          );
        }
        // number — wide range gets a type-in, small range a stepper.
        // StatNumberField / StatChip render their own label caption.
        const range = (s.max ?? 0) - (s.min ?? 0);
        if (range > 8) {
          return (
            <StatNumberField
              key={s.key}
              label={s.label}
              value={stats[s.key]}
              min={s.min ?? 0}
              max={s.max ?? 999}
              onCommit={(n) => ctl.stats.mutate({ stats: { [s.key]: n } })}
            />
          );
        }
        const cur = typeof stats[s.key] === 'number' ? (stats[s.key] as number) : 0;
        return (
          <StatChip
            key={s.key}
            label={s.label}
            value={stats[s.key]}
            onAdd={() => ctl.stats.mutate({ stats: { [s.key]: Math.min(cur + 1, s.max ?? 9999) } })}
            onSub={() => ctl.stats.mutate({ stats: { [s.key]: Math.max(cur - 1, s.min ?? 0) } })}
          />
        );
      })}
    </div>
  );
}

// A labeled free-text editor for a game-scope text stat (Division,
// Current Event, Lead Runner, Current Apparatus, …). Commits on
// blur / Enter; shows the live value when idle.
function GameScopeText({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: unknown;
  onCommit: (v: string) => void;
}) {
  const live = value === undefined || value === null ? '' : String(value);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const commit = () => {
    if (!editing) return;
    onCommit(text.trim());
    setEditing(false);
  };
  return (
    <label className="flex flex-col">
      <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase mb-0.5">
        {label}
      </span>
      <input
        type="text"
        value={editing ? text : live}
        onFocus={() => {
          setText(live);
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
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
        className="h-9 min-w-[140px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-sm font-bold text-white outline-none focus:border-indigo-500"
      />
    </label>
  );
}

// Home/Away picker for a game-scope text stat that stores 'home' /
// 'away' (volleyball Serving). Mirrors PossessionToggle but writes the
// raw stat string.
function GameScopeToggle({
  label,
  value,
  homeTeam,
  awayTeam,
  onSet,
}: {
  label: string;
  value: unknown;
  homeTeam?: string;
  awayTeam?: string;
  onSet: (v: string) => void;
}) {
  const cur = String(value || '').toLowerCase();
  const opt = (side: 'home' | 'away', name?: string) => (
    <button
      type="button"
      onClick={() => onSet(cur === side ? '' : side)}
      aria-pressed={cur === side}
      className={`h-9 px-3 rounded-lg text-sm font-black transition-colors border ${
        cur === side
          ? 'bg-indigo-600 text-white border-indigo-700'
          : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'
      }`}
    >
      {(name || side).slice(0, 10)}
    </button>
  );
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase mb-0.5">
        {label}
      </span>
      <div className="flex items-stretch gap-1">
        {opt('home', homeTeam)}
        {opt('away', awayTeam)}
      </div>
    </div>
  );
}

// ── EndSetMacro ────────────────────────────────────────────────
// Volleyball / pickleball: one tap to close the current set. Credits
// the set/game-won stat to whichever side led, zeroes both point
// scores (so a stale score never carries into the next set), fires the
// setWin celebration cue, and advances the segment. (audit: console
// P1 — advancing a set never zeroed the points). Safe + idempotent
// regardless of any server-side auto-zero (config+api domain) landing.
function EndSetMacro({
  def,
  g,
  ctl,
}: {
  def: SportDefinition;
  g: any;
  ctl: ReturnType<typeof useGameControl>;
}) {
  const stats: Record<string, unknown> = g.stats || {};
  const home = Number(g.homeScore) || 0;
  const away = Number(g.awayScore) || 0;
  // The set/game-won counter key, if the sport tracks one.
  const setKeyHome = def.stats.some((s) => s.key === 'homeSets')
    ? 'homeSets'
    : def.stats.some((s) => s.key === 'homeGames')
      ? 'homeGames'
      : null;
  const setKeyAway = setKeyHome === 'homeSets' ? 'awaySets' : setKeyHome === 'homeGames' ? 'awayGames' : null;
  // The win cue is 'setWin' (volleyball) or 'gameWin' (pickleball) — fire
  // whichever the sport declares, if either.
  const winCueKey = def.celebrations.some((c) => c.key === 'setWin')
    ? 'setWin'
    : def.celebrations.some((c) => c.key === 'gameWin')
      ? 'gameWin'
      : null;

  const endSet = () => {
    if (home === away) return; // tie can't end a set — guard the no-op
    const winner: 'home' | 'away' = home > away ? 'home' : 'away';
    // 1. Credit the set/game win to the leader (if the sport counts them).
    if (setKeyHome && setKeyAway) {
      const curWon = Number(stats[winner === 'home' ? setKeyHome : setKeyAway]) || 0;
      ctl.stats.mutate({ stats: { [winner === 'home' ? setKeyHome : setKeyAway]: curWon + 1 } });
    }
    // 2. Zero both point scores via the dedicated score mutation (records
    //    a SCORE GameEvent for the undo rail).
    ctl.score.mutate({ homeScore: 0, awayScore: 0 });
    // 3. Fire the set/game-won celebration cue if the sport has one.
    if (winCueKey) ctl.cue.mutate({ key: winCueKey, target: 'ALL' });
    // 4. Advance to the next set / game.
    ctl.segment.mutate({ delta: 1 });
  };

  const tied = home === away;
  return (
    <div className="max-w-6xl mx-auto mt-3 flex justify-center px-1">
      <button
        type="button"
        onClick={endSet}
        disabled={tied}
        title={
          tied
            ? 'Scores are level — a set ends with a leader'
            : 'End this set: credit the winner, reset points, fire the cue, advance the set'
        }
        className="h-10 px-4 rounded-xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <Check className="h-4 w-4" />
        End {def.segment.name} → next {def.segment.name}
      </button>
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
  onSetAbsolute,
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
  /** Absolute-set callback — used by judged sports (gymnastics / cheer)
   *  whose total is a decimal you can't reach by +1 chips. Receives the
   *  already-scaled int from parseScoreInput, passed straight to setScore. */
  onSetAbsolute?: (scaled: number) => void;
  def: SportDefinition;
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number | string>) => void;
  /** When provided, renders a dedicated Timeout button next to the
   *  timeout count — fires callTimeout instead of raw stat edit. */
  onTimeout?: (type?: 'full' | 'short') => void;
}) {
  // Judged sports carry a decimal team total (gymnastics 195.825, cheer
  // 285.5) stored as a scaled int. The +/- chips can't reach a decimal,
  // so those sports get an absolute decimal-entry field instead.
  const isJudged = typeof def.scoreDecimals === 'number' && def.scoreDecimals > 0;
  const [scoreDraft, setScoreDraft] = useState('');
  // When not actively editing, mirror the live score into the field.
  const [editingScore, setEditingScore] = useState(false);
  const liveScoreText = formatScore(def, score);
  const commitScore = () => {
    setEditingScore(false);
    const text = scoreDraft.trim();
    if (text === '') return; // empty → leave score unchanged
    onSetAbsolute?.(parseScoreInput(def, text));
  };
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
      // Per-team number AND text stats (e.g. golf homePar/awayPar are
      // text — they had no editor anywhere before). (audit: console P0)
      (s.type === 'number' || s.type === 'text') &&
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
        {liveScoreText}
      </div>
      {isJudged ? (
        // Judged sports — type the team's absolute total (e.g. 195.825).
        // Increment chips make no sense at 3-decimal precision, so the
        // operator enters the full score and commits it.
        <div className="flex items-center gap-1.5 mt-1">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${side === 'home' ? 'Home' : 'Away'} team total`}
            value={editingScore ? scoreDraft : liveScoreText}
            onFocus={() => {
              setEditingScore(true);
              setScoreDraft(liveScoreText);
            }}
            onChange={(e) => setScoreDraft(e.target.value)}
            onBlur={commitScore}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="min-h-[56px] w-32 rounded-xl bg-slate-800 text-center text-white font-bold text-xl transition-colors border border-slate-700 focus:border-amber-500 focus:outline-none tabular-nums"
            title="Type the team's total score, then Enter"
          />
        </div>
      ) : (
        /* Score chips — the BIGGEST, most-tapped control on the
           console. Scoring is the one thing a volunteer does every few
           seconds, so the +N chips are ≥56px tall (well above the 44px
           touch floor) and the −1 fix-a-mistake chip is ≥44px but visually
           quieter so it can't be confused with a scoring tap during live
           play. (2026-06-15 console-UX P0 — thumb-sized targets) */
        <div className="flex items-center gap-2 mt-1 w-full justify-center flex-wrap">
          {increments.map((inc) => (
            <button
              key={`+${inc}`}
              type="button"
              onClick={() => onScore(inc)}
              className="min-h-[56px] min-w-[56px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white font-black text-xl transition-colors border border-slate-700"
              title={`Add ${inc}`}
            >
              +{inc}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onScore(-1)}
            className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-400 font-bold text-lg transition-colors border border-slate-700"
            title="Subtract 1 (fix a mis-tap)"
            aria-label="Subtract one point"
          >
            −
          </button>
        </div>
      )}
      {/* Per-team stat rows — Shots, Exclusions, Timeouts for water
          polo; fouls + timeouts for basketball; etc. Compact: small
          label on the left, −value+ stepper on the right.
          Timeout rows get an additional "T.O." chip that fires
          callTimeout (pause clock + decrement + CUE) atomically. */}
      {sideStats.length > 0 && (
        <div className="w-full mt-3 pt-3 border-t border-slate-800 space-y-1">
          {sideStats.map((s) => {
            const min = s.min ?? 0;
            const max = s.max ?? 99;
            const isText = s.type === 'text';
            // Ride-time advantage is entered in seconds but is far easier
            // to set as mm:ss than by tapping +/-1 up to 600. (audit P1)
            const isRideTime = s.key.toLowerCase().includes('ridetime');
            // A wide range (ride time 0-600, etc.) can't be set with a
            // +/-1 stepper — give it a type-in instead. (audit P1)
            const wideRange = !isText && max - min > 8;

            // ── per-team text stat (e.g. golf homePar/awayPar) ──
            if (isText) {
              return (
                <div key={s.key} className="flex items-center justify-between text-xs gap-2">
                  <span className="font-black uppercase tracking-widest text-slate-500 text-[10px] shrink-0">
                    {shortLabel(s.label)}
                  </span>
                  <SideTeamText
                    value={stats[s.key]}
                    onCommit={(v) => onStat({ [s.key]: v })}
                  />
                </div>
              );
            }

            const value = Number(stats[s.key]) || 0;

            // ── basketball bonus badge ──
            // The board/ribbon/situational all read team-foul bonus off the
            // SAME thresholds (>=7 BONUS, >=10 DOUBLE BONUS). Surface it in the
            // console so the operator sees bonus state on the fouls row without
            // reading the board. (audit P2). Console is not a player surface, so
            // Tailwind utilities are fine here.
            const isFoulStat = s.key.toLowerCase().endsWith('fouls');
            const bonusBadge =
              def.key === 'basketball' && isFoulStat
                ? value >= 10
                  ? 'DOUBLE BONUS'
                  : value >= 7
                    ? 'BONUS'
                    : null
                : null;
            const BonusChip = bonusBadge ? (
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-black uppercase tracking-wider border border-amber-500/40"
                title="Team is in the bonus — opponent shoots free throws on the next foul"
              >
                {bonusBadge}
              </span>
            ) : null;

            // ── ride-time mm:ss control ──
            if (isRideTime) {
              return (
                <div key={s.key} className="flex items-center justify-between text-xs gap-2">
                  <span className="font-black uppercase tracking-widest text-slate-500 text-[10px] shrink-0">
                    {shortLabel(s.label).replace(/\(S\)/i, '').trim()}
                  </span>
                  <SideRideTime
                    seconds={value}
                    maxSeconds={max}
                    onCommit={(secs) => onStat({ [s.key]: secs })}
                  />
                </div>
              );
            }

            // ── wide-range number type-in ──
            if (wideRange) {
              return (
                <div key={s.key} className="flex items-center justify-between text-xs gap-2">
                  <span className="font-black uppercase tracking-widest text-slate-500 text-[10px] shrink-0 flex items-center">
                    {shortLabel(s.label)}
                    {BonusChip}
                  </span>
                  <SideNumberTypeIn
                    value={value}
                    min={min}
                    max={max}
                    onCommit={(n) => onStat({ [s.key]: n })}
                  />
                </div>
              );
            }

            // ── small-range +/- stepper (the original control) ──
            const canDec = value > min;
            const canInc = value < max;
            const isTimeoutStat = s.key.toLowerCase().includes('timeout');
            const atZero = value <= 0;
            return (
              <div key={s.key} className="flex items-center justify-between text-xs">
                <span className="font-black uppercase tracking-widest text-slate-500 text-[10px]">
                  {shortLabel(s.label)}
                </span>
                <div className="flex items-center gap-1.5">
                  {/* Timeout button — fires callTimeout (pause + decrement + CUE).
                      Styled as an amber chip matching the chip style used
                      elsewhere on the page (shot-clock reset, etc.). Sized to
                      the 44px touch floor. Disabled when no timeouts remain.
                      (2026-06-15 console-UX P0) */}
                  {isTimeoutStat && onTimeout && (
                    <button
                      type="button"
                      onClick={() => onTimeout()}
                      disabled={atZero}
                      className="min-h-[44px] px-3 rounded-lg bg-amber-800 hover:bg-amber-700 text-amber-200 text-xs font-black border border-amber-700 disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wide"
                      title={atZero ? 'No timeouts remaining' : `Call ${side} timeout`}
                    >
                      T.O.
                    </button>
                  )}
                  {/* Per-team stat steppers — ≥44px so two adjacent ones can't
                      be mis-tapped with a wet finger during live play. */}
                  <button
                    type="button"
                    onClick={() => onStat({ [s.key]: Math.max(min, value - 1) })}
                    disabled={!canDec}
                    className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-lg font-bold border border-slate-700 disabled:opacity-30"
                    title={`−1 ${s.label}`}
                    aria-label={`Decrease ${s.label}`}
                  >
                    −
                  </button>
                  <span className="font-black tabular-nums text-white w-9 text-center text-base">
                    {value}
                  </span>
                  <button
                    type="button"
                    onClick={() => onStat({ [s.key]: Math.min(max, value + 1) })}
                    disabled={!canInc}
                    className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-lg font-bold border border-slate-700 disabled:opacity-30"
                    title={`+1 ${s.label}`}
                    aria-label={`Increase ${s.label}`}
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

// ── ScoreTile per-team field editors (dark theme) ──────────────
// Compact controls used inside the dark ScoreTile for per-team stats
// that a +/-1 stepper can't reasonably set.

// Free-text per-team stat (golf homePar / awayPar). Commits on
// blur / Enter. (audit: console P0 — golf vs-par was uneditable)
function SideTeamText({
  value,
  onCommit,
}: {
  value: unknown;
  onCommit: (v: string) => void;
}) {
  const live = value === undefined || value === null ? '' : String(value);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const commit = () => {
    if (!editing) return;
    onCommit(text.trim());
    setEditing(false);
  };
  return (
    <input
      type="text"
      value={editing ? text : live}
      onFocus={() => {
        setText(live);
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
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
      className="min-h-[44px] w-20 rounded-lg bg-slate-800 border border-slate-700 px-2 text-sm font-black text-white tabular-nums text-center outline-none focus:border-indigo-500"
    />
  );
}

// Wide-range per-team number type-in (clamps to min/max on commit).
function SideNumberTypeIn({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const commit = () => {
    if (!editing) return;
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
    setEditing(false);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={editing ? text : String(value)}
      onFocus={() => {
        setText(String(value));
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
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
      className="min-h-[44px] w-14 rounded-lg bg-slate-800 border border-slate-700 px-2 text-sm font-black text-white tabular-nums text-center outline-none focus:border-indigo-500"
    />
  );
}

// mm:ss entry for wrestling ride-time advantage. Stores seconds; the
// operator types a familiar 1:12 instead of tapping 72 times. (audit P1)
function SideRideTime({
  seconds,
  maxSeconds,
  onCommit,
}: {
  seconds: number;
  maxSeconds: number;
  onCommit: (secs: number) => void;
}) {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const commit = () => {
    if (!editing) return;
    // Parse "m:ss" or a bare seconds count.
    const t = text.trim();
    let secs = 0;
    if (t.includes(':')) {
      const [m, s] = t.split(':');
      secs = (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0);
    } else {
      secs = parseInt(t, 10) || 0;
    }
    onCommit(Math.max(0, Math.min(maxSeconds, secs)));
    setEditing(false);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={editing ? text : fmt(seconds)}
      onFocus={() => {
        setText(fmt(seconds));
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value.replace(/[^0-9:]/g, '').slice(0, 5))}
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
      placeholder="0:00"
      title="Ride-time advantage (m:ss)"
      className="min-h-[44px] w-16 rounded-lg bg-slate-800 border border-slate-700 px-2 text-sm font-black text-white tabular-nums text-center outline-none focus:border-indigo-500"
    />
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
    // Shot-clock controls bumped to the 44px touch floor (2026-06-15
    // console-UX P0) — reset-to-full / reset-to-short / start-stop are all
    // live-play taps, so they can't be 28px chips a wet finger misses.
    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-700 w-full flex-wrap justify-center">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Shot</span>
      <span className="text-2xl font-black tabular-nums text-amber-400 leading-none min-w-[32px] text-center">
        {sec}
      </span>
      <button
        type="button"
        onClick={() => ctl.shotClock.mutate({ action: 'reset', value: fullSec })}
        className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-sm font-bold"
        title={`Reset to ${fullSec}`}
      >
        {fullSec}
      </button>
      <button
        type="button"
        onClick={() => ctl.shotClock.mutate({ action: 'reset', value: shortSec })}
        className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-sm font-bold"
        title={`Reset to ${shortSec}`}
      >
        {shortSec}
      </button>
      <button
        type="button"
        onClick={() => ctl.shotClock.mutate({ action: shotRunning ? 'stop' : 'start' })}
        className={
          shotRunning
            ? 'min-h-[44px] min-w-[44px] px-3 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-base font-black'
            : 'min-h-[44px] min-w-[44px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-base font-black'
        }
        title={shotRunning ? 'Stop' : 'Start'}
        aria-label={shotRunning ? 'Stop shot clock' : 'Start shot clock'}
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
  // Roster is COLLAPSED by default — like every pro console. Daktronics/CTS
  // show no roster on the control surface at all; GameChanger/ScoreVision
  // open it on demand. A 24-player wall pinned open shoved the ribbon below
  // the fold and forced scrolling. Collapsed → the scoreboard + ribbon fit
  // with no scroll; the operator expands to one-tap spotlight. (2026-06-16)
  const [expanded, setExpanded] = useState(false);

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
    <div className="flex items-start gap-3 px-4 py-2">
      <div className="flex flex-col leading-tight shrink-0 w-24 pt-1">
        <span
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color }}
        >
          {isHome ? 'HOME' : 'AWAY'}
        </span>
        <span className="text-[11px] font-semibold text-slate-600 truncate" title={label}>
          {label}
        </span>
      </div>
      {list.length === 0 ? (
        <span className="text-[11px] text-slate-400 italic pt-1.5">No roster yet</span>
      ) : (
        // Tidy aligned grid (auto-fill columns) instead of a ragged
        // full-width wrap of wide name-pills — the cap number is a solid
        // team-colored badge, the name truncates, every chip is the same
        // size, so 12+ players read as an organised roster, not a wall.
        // (2026-06-16 operator feedback — "teams look a mess"). This is the
        // console (operator browser), not a Taurus player surface, so the
        // CSS grid + gap are fine here.
        <div
          className="grid flex-1 gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
        >
          {list.map((p) => {
            const playerName = String(p.name || '').trim();
            const onAir = playerName.toLowerCase() === onAirTitle;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePlayer(p)}
                disabled={ctl.spotlight.isPending || ctl.cue.isPending}
                title={onAir ? 'On air — tap for actions' : `Tap to spotlight or celebrate ${p.name}`}
                className={`flex items-center gap-2 rounded-lg border py-1 pl-1 pr-2 text-left transition-colors disabled:opacity-50 ${
                  onAir
                    ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <span
                  className="flex h-[26px] min-w-[26px] shrink-0 items-center justify-center rounded-md px-1 text-[12px] font-black tabular-nums text-white"
                  style={{ backgroundColor: onAir ? '#f59e0b' : color }}
                >
                  {p.number ?? '–'}
                </span>
                <span
                  className={`truncate text-[12px] font-semibold ${
                    onAir ? 'text-amber-900' : 'text-slate-700'
                  }`}
                >
                  {playerName || 'Player'}
                </span>
                {onAir && (
                  <span className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-wide text-amber-600">
                    On air
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="border-t border-slate-200 bg-slate-50">
      {/* Thin header bar — collapsed by default. Tap to reveal the roster
          grid for one-tap spotlight; collapse again to give the scoreboard
          + ribbon the full height (no scroll). When collapsed we still show
          a peek of the home cap numbers so it doesn't feel empty. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-slate-100/70"
      >
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 shrink-0">
          Players
        </span>
        <span className="text-[11px] font-semibold text-slate-400 shrink-0">
          {players.length} on roster · tap to spotlight
        </span>
        {!expanded && (
          <span className="ml-auto hidden items-center gap-1.5 overflow-hidden sm:flex">
            {home.slice(0, 8).map((p) => (
              <span
                key={p.id}
                className="flex h-5 min-w-[20px] items-center justify-center rounded px-1 text-[10px] font-black tabular-nums text-white"
                style={{ backgroundColor: homeColor }}
              >
                {p.number ?? '–'}
              </span>
            ))}
            {home.length > 8 && (
              <span className="text-[10px] font-bold text-slate-400">
                +{home.length - 8}
              </span>
            )}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-slate-100">
          {renderRow(g.homeTeam || 'Home', homeColor, home, true)}
          <div className="border-t border-slate-100" />
          {renderRow(g.awayTeam || 'Away', awayColor, away, false)}
        </div>
      )}
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
  useOverlayLock(); // hide mobile tab bar so the action sheet clears it
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
    // Add a timed exclusion/penalty through the server's append-and-
    // re-anchor endpoint (it reads the STORED box, prunes expired entries,
    // then APPENDS). Previously broken: it read a phantom `ctl._game` (never
    // set → always undefined), so `current` was always [] and it OVERWROTE
    // stats.penalties with a single entry — wiping everyone already in the
    // box. That broke THE water-polo exclusion mechanic (a 2nd exclusion
    // erased the 1st). 2026-06-11 sports-venue audit P0.
    const preset = def.penaltyBox?.presets?.[0];
    const sec = preset?.sec || 20;
    ctl.penalties.mutate({
      action: 'add',
      team: player.team === 'away' ? 'away' : 'home',
      lenSec: sec,
      label: preset?.label || `Penalty :${sec}`,
      // Server stores the jersey/cap number (digits only); water-polo
      // exclusions are tracked by cap #, which is what the box list shows.
      player: String(player.number || ''),
    });
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

        {/* Sport celebrations — fires with player attribution. Scoring cues
            (autoPoints) are ONE-TAP MACROS (2026-06-12): the tap fires the
            named cinematic AND records the points — the operator no longer
            fires a cue then separately taps +1 (which used to double-fire
            the celebration; the server's 10s per-team mutex now suppresses
            the score's auto-fire, so exactly one cinematic plays). */}
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {def.celebrations.map((c) => {
            const pts =
              Array.isArray(c.autoPoints) && c.autoPoints.length > 0 ? c.autoPoints[0] : 0;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  onFire(c.key);
                  if (pts > 0) {
                    ctl.score.mutate({
                      team: player.team === 'away' ? 'away' : 'home',
                      delta: pts,
                    });
                  }
                }}
                className="h-11 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>{c.emoji}</span>
                <span>
                  {c.label}
                  {pts > 0 ? ` +${pts}` : ''}
                </span>
              </button>
            );
          })}
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

/** A player the operator can attribute a cue to (subset of a roster row). */
type ScorerPick = {
  id?: string;
  name?: string;
  number?: string | number | null;
  position?: string | null;
  photoUrl?: string | null;
  team?: string | null;
};

/**
 * Does this celebration show an individual player's name (→ pop the scorer
 * picker), or is it a team / situational cue that fires immediately?
 * Water polo: goal / save / exclusion → picker; power play / horn → instant.
 * Generalizes across sports: most celebrations are individual, so we deny-list
 * the clearly-team ones and status transitions.
 */
function cueWantsScorer(key: string): boolean {
  const k = (key || '').toLowerCase().replace(/[_\s-]/g, '');
  const TEAM_CUES = new Set([
    'horn', 'powerplay', 'penaltykill', 'timeout', 'setwin', 'pregameintro',
  ]);
  if (TEAM_CUES.has(k)) return false;
  if (k.startsWith('status')) return false;
  return true;
}

/** Quick-fire cue tiles always visible in Run mode. The full launchpad
 *  (target picker, custom cues) stays available behind the Cues
 *  button in the bottom tray; this inline bar is the one-tap path
 *  for the sport's built-in celebrations, broadcasting to ALL
 *  surfaces by default.
 *
 *  2026-06-04 — cue → player-picker flow (operator: "click the cue, then
 *  it pops a player list and you click the player so it all happens almost
 *  instantly"). Tapping a name-cue (goal, save, exclusion…) pops a fast
 *  roster picker; the tapped player is baked into the cinematic as the
 *  scorer ("#7 RIVERA"). Team / situational cues (power play, horn) fire
 *  immediately. With no roster, every cue fires immediately.
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
  // The currently-spotlit player (if any) is pre-highlighted in the scorer
  // picker so a one-tap confirm is possible when the operator already has
  // someone on the spotlight.
  const scorerPlayer = spotName
    ? players.find((p) => String(p?.name || '').trim().toLowerCase() === spotName) || null
    : null;

  const [lastFiredKey, setLastFiredKey] = useState<string>('');
  // T2-6 — target chip: which surfaces receive the cue from the fast
  // path. Persists for the session (local state, not sessionStorage —
  // page reloads are rare mid-game and state loss is low-consequence).
  const [cueTarget, setCueTarget] = useState<'ALL' | 'BOARD' | 'RIBBON'>('ALL');
  // 2026-06-04 — cue → player-picker. When set, the scorer picker is open
  // for this cue key, awaiting the operator's player tap before firing.
  const [pendingCue, setPendingCue] = useState<string | null>(null);

  const fireWithScorer = (key: string, player: ScorerPick | null) => {
    ctl.cue.mutate({
      key,
      target: cueTarget as any,
      // T2-6 — when firing to the ribbon only, signal the ribbon page
      // to use the tight 2.5s RibbonCelebrationStrip instead of the
      // full 4500ms cinematic. The server also sets this automatically
      // when target === 'RIBBON', but include it here for clarity.
      ...(cueTarget === 'RIBBON' ? { ribbonStrip: true } : {}),
      // Attribute the cue to the picked player so the cinematic bakes in
      // "#7 RIVERA" with the REAL name + cap number. A null player (the
      // operator skipped, or a team cue) fires clean with no name line.
      scorerName: player?.name || undefined,
      scorerNumber: player?.number != null && player.number !== '' ? String(player.number) : undefined,
      scorerPhotoUrl: player?.photoUrl || undefined,
      scorerId: player?.id || undefined,
    });
    setLastFiredKey(key);
    setTimeout(() => setLastFiredKey((k) => (k === key ? '' : k)), 1500);
  };

  // Tile tap. Name cues (goal, save, exclusion…) pop the scorer picker so
  // the operator taps the player and it fires instantly with that name.
  // Team / situational cues — and any cue when there's no roster yet —
  // fire immediately with no name.
  const onCueTap = (key: string) => {
    if (cueWantsScorer(key) && players.length > 0) setPendingCue(key);
    else fireWithScorer(key, null);
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
            {players.length > 0 ? (
              <>Tap a play → pick the scorer</>
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
                onClick={() => onCueTap(c.key)}
                disabled={ctl.cue.isPending}
                title={
                  cueWantsScorer(c.key) && players.length > 0
                    ? `${c.label} → pick the player, then it fires to ${cueTarget}`
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

      {/* 2026-06-04 — the scorer picker. Tapping a name cue opens this;
          the operator taps the player and the cue fires INSTANTLY with
          that name baked into the cinematic. */}
      {pendingCue && (
        <CueScorerPicker
          cueLabel={def.celebrations.find((c) => c.key === pendingCue)?.label || 'Cue'}
          players={players}
          spotlitName={scorerPlayer?.name || (typeof sp.title === 'string' ? sp.title : '')}
          homeColor={g?.homeColor}
          awayColor={g?.awayColor}
          homeName={g?.homeTeam}
          awayName={g?.awayTeam}
          onPick={(player) => {
            fireWithScorer(pendingCue, player);
            setPendingCue(null);
          }}
          onClose={() => setPendingCue(null)}
        />
      )}
    </div>
  );
}

/**
 * CueScorerPicker — the fast roster popup that turns "fire a cue" into
 * "fire a cue FOR this player". Mobile-first big tap tiles, home + away
 * sections, the currently-spotlit player pre-highlighted for a one-tap
 * confirm, and a prominent "No player" escape so it's never more than one
 * extra tap. Tapping a player fires immediately and closes.
 */
function CueScorerPicker({
  cueLabel,
  players,
  spotlitName,
  homeColor,
  awayColor,
  homeName,
  awayName,
  onPick,
  onClose,
}: {
  cueLabel: string;
  players: any[];
  spotlitName?: string;
  homeColor?: string | null;
  awayColor?: string | null;
  homeName?: string | null;
  awayName?: string | null;
  onPick: (player: ScorerPick | null) => void;
  onClose: () => void;
}) {
  useOverlayLock(); // hide the mobile tab bar so the sheet clears it
  const spot = (spotlitName || '').trim().toLowerCase();
  const home = players.filter((p) => p?.team !== 'away');
  const away = players.filter((p) => p?.team === 'away');

  const Section = ({
    label,
    color,
    list,
  }: {
    label: string;
    color: string;
    list: any[];
  }) => {
    if (!list.length) return null;
    return (
      <div className="mb-3 last:mb-0">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-3 w-1.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-500 truncate">
            {label}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {list.map((p) => {
            const name = String(p?.name || '').trim();
            const onAir = !!spot && name.toLowerCase() === spot;
            return (
              <button
                key={p?.id || `${p?.team}-${p?.number}-${name}`}
                type="button"
                onClick={() =>
                  onPick({
                    id: p?.id,
                    name,
                    number: p?.number ?? '',
                    position: p?.position ?? '',
                    photoUrl: p?.photoUrl ?? null,
                    team: p?.team ?? null,
                  })
                }
                className={
                  onAir
                    ? 'flex items-center gap-2 rounded-lg border-2 border-amber-500 bg-amber-50 px-2.5 py-2 text-left transition-colors'
                    : 'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors'
                }
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-black text-white"
                  style={{ background: color }}
                >
                  {p?.number != null && p?.number !== '' ? p.number : '–'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-900">
                    {name || 'Unnamed'}
                  </span>
                  {p?.position && (
                    <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {p.position}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-3 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900 truncate">{cueLabel}</div>
            <div className="text-[11px] font-semibold text-slate-400">Who gets the call? Tap a player.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>

        {/* No-player escape — always one tap to fire clean. */}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mb-3 w-full rounded-lg bg-slate-100 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors"
        >
          ⚡ Fire now — no player
        </button>

        <Section label={homeName || 'Home'} color={homeColor || '#4f46e5'} list={home} />
        <Section label={awayName || 'Away'} color={awayColor || '#e11d48'} list={away} />
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

// NOTE — the legacy TeamZone + QuickStatChips components were removed
// here (audit: console). They were DEAD CODE: TeamZone was never
// rendered (the live console uses RunInteractiveScoreboard), and
// QuickStatChips was reachable only from TeamZone — so the football
// down/distance/Ball-On controls inside it (FootballControls) never
// reached the operator. FootballControls is now mounted directly in
// the football bottom tray; per-team stats render in ScoreTile; and
// game-scope text/number stats render in GameScopeStatEditor.

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

// ── advanceBaseballHalf ────────────────────────────────────────
// One-tap half-inning advance for baseball / softball. The half model:
//   Top → Bottom  (same inning — flip the half, clear the count + bases)
//   Bottom → Top  (next inning — bump the segment, clear the count + bases)
// The segment `+` chip calls this for Inning sports so the operator
// walks Top→Bot→next-inning-Top instead of only bumping the inning
// number. The bottom-tray "Top/Bot" pill also calls it. (audit: console P0)
function advanceBaseballHalf(
  def: SportDefinition,
  g: any,
  ctl: ReturnType<typeof useGameControl>,
) {
  const stats: Record<string, unknown> = g.stats || {};
  const cur = String(stats.half || '').toUpperCase();
  const goingToBottom = cur !== 'BOT' && cur !== 'BOTTOM';
  // Clear the count + bases at every half change (a new half is a
  // fresh frame). The half label uses 'Top' / 'Bot' so the board's
  // segment label reads "Top #3" / "Bot #3".
  const reset: Record<string, number | string> = {
    half: goingToBottom ? 'Bot' : 'Top',
    balls: 0,
    strikes: 0,
    outs: 0,
    on1B: 0,
    on2B: 0,
    on3B: 0,
  };
  ctl.stats.mutate({ stats: reset });
  // Going from Bottom back to Top means a new inning — bump the segment.
  if (!goingToBottom) {
    ctl.segment.mutate({ delta: 1 });
  }
}

// Reverse of advanceBaseballHalf — the segment `−` chip. Bottom→Top
// (same inning); Top→Bottom of the previous inning (segment-1).
function retreatBaseballHalf(
  def: SportDefinition,
  g: any,
  ctl: ReturnType<typeof useGameControl>,
) {
  const stats: Record<string, unknown> = g.stats || {};
  const cur = String(stats.half || '').toUpperCase();
  const isBottom = cur === 'BOT' || cur === 'BOTTOM';
  const reset: Record<string, number | string> = {
    half: isBottom ? 'Top' : 'Bot',
    balls: 0,
    strikes: 0,
    outs: 0,
    on1B: 0,
    on2B: 0,
    on3B: 0,
  };
  ctl.stats.mutate({ stats: reset });
  // Top → previous inning's Bottom — step the segment back.
  if (!isBottom) {
    ctl.segment.mutate({ delta: -1 });
  }
}

// ── BaseTrayBall ───────────────────────────────────────────────
// Baseball / softball bottom tray: Ball / Strike / Foul / Out, the
// Top/Bottom half toggle, and the three base-runner toggles. Foul is a
// no-op at 2 strikes (it must NOT register a 3rd strike → false
// strikeout). "Out" retires the batter via the outs stat — the API
// rolls the side over at 3 outs — instead of faking a strikeout.
// (audit: console P0 — half toggle + Out + base runners; P1 — Foul guard)

function BaseTrayBall({
  stats,
  onStat,
  onAdvanceHalf,
}: {
  stats: Record<string, unknown>;
  onStat: (s: Record<string, number>) => void;
  onAdvanceHalf: () => void;
}) {
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const balls = num(stats.balls);
  const strikes = num(stats.strikes);
  const outs = num(stats.outs);
  const half = String(stats.half || '').toUpperCase();
  const isBottom = half === 'BOT' || half === 'BOTTOM';
  const bases: { key: 'on1B' | 'on2B' | 'on3B'; label: string }[] = [
    { key: 'on1B', label: '1B' },
    { key: 'on2B', label: '2B' },
    { key: 'on3B', label: '3B' },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => onStat({ balls: Math.min(3, balls + 1) })}
        className="flex-1 min-w-[64px] h-14 rounded-xl bg-red-600 text-white font-black text-lg hover:bg-red-700 transition-colors"
      >
        Ball
      </button>
      <button
        type="button"
        onClick={() => onStat({ strikes: Math.min(2, strikes + 1) })}
        className="flex-1 min-w-[64px] h-14 rounded-xl bg-slate-800 text-white font-black text-lg hover:bg-slate-700 transition-colors"
      >
        Strike
      </button>
      {/* Foul — adds a strike UNLESS already at 2 (a foul never makes
          the third strike). No-op at 2 strikes so a foul ball can't
          fake a strikeout + fire the auto-celebration. (audit P1) */}
      <button
        type="button"
        onClick={() => {
          if (strikes < 2) onStat({ strikes: strikes + 1 });
        }}
        disabled={strikes >= 2}
        title={strikes >= 2 ? 'Foul at 2 strikes — count stays 2' : 'Foul ball (adds a strike under 2)'}
        className="flex-1 min-w-[56px] h-14 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-sm hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Foul
      </button>
      {/* Out — retires the batter. The backend rolls the side over and
          resets the count at 3 outs. Distinct from Strike so a routine
          out (groundout / flyout) isn't recorded as a strikeout. */}
      <button
        type="button"
        onClick={() => onStat({ outs: outs + 1, balls: 0, strikes: 0 })}
        className="flex-1 min-w-[56px] h-14 rounded-xl bg-amber-600 text-white font-black text-base hover:bg-amber-700 transition-colors"
      >
        Out
      </button>
      {/* live count indicator */}
      <div className="flex flex-col items-center justify-center bg-white border border-slate-200 rounded-xl px-3 h-14 shrink-0">
        <span className="text-[9px] font-black tracking-widest text-slate-400">COUNT</span>
        <span className="text-xl font-black text-slate-900 tabular-nums">
          {balls}–{strikes}
        </span>
        <span className="text-[9px] text-slate-400">{outs} out</span>
      </div>
      {/* Base-runner diamond toggles — light the board's diamond. */}
      <div className="flex items-stretch gap-1 shrink-0">
        {bases.map((b) => {
          const on = num(stats[b.key]) > 0;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onStat({ [b.key]: on ? 0 : 1 })}
              aria-pressed={on}
              title={`Runner on ${b.label}`}
              className={`h-14 w-12 rounded-xl font-black text-sm transition-colors border ${
                on
                  ? 'bg-emerald-600 text-white border-emerald-700'
                  : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>
      {/* Top / Bottom half toggle — advances Top→Bot→next-inning-Top.
          This is the ONLY place the operator can move the half forward;
          `half` was never written anywhere in the console before. */}
      <button
        type="button"
        onClick={onAdvanceHalf}
        title="Advance half-inning (Top → Bottom → next inning)"
        className="h-14 px-3 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 transition-colors flex flex-col items-center justify-center shrink-0"
      >
        <span className="text-[9px] font-black tracking-widest text-indigo-200">HALF</span>
        <span>{isBottom ? 'Bot ▼' : 'Top ▲'}</span>
      </button>
    </>
  );
}

// ── HomeRunMacro ───────────────────────────────────────────────
// One-tap home-run macro for baseball / softball. The ambiguous +1/+2/
// +3 run delta can't auto-fire a celebration (a 2-run single looks the
// same as a 2-run homer), so we make the homer EXPLICIT: tap HR → pick
// how many runs scored (1-4) → it applies the score delta to the batting
// team AND fires the matching cinematic (CEL_BASEBALL_HOMERUN, or the
// grand-slam scene for 4). Batting team is derived from the inning half
// (Top = away bats, Bottom = home bats).
//
// The cue fires through the same `key` path the Presentation cue tiles
// use — `homeRun` / `grandSlam` are the sport's celebration keys, and
// the board / ribbon map them to the baseball cinematics. (Softball's
// def spreads BASEBALL so the same keys resolve to its 🥎 variants.)
function HomeRunMacro({
  g,
  def,
  ctl,
  stats,
}: {
  g: any;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
  stats: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [fired, setFired] = useState(false);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (firedTimer.current) clearTimeout(firedTimer.current); }, []);

  // Top half → away team bats; Bottom half → home team bats.
  const half = String(stats.half || 'Top').toUpperCase();
  const battingTeam: 'home' | 'away' =
    half === 'BOT' || half === 'BOTTOM' ? 'home' : 'away';
  const battingName = battingTeam === 'home' ? g.homeTeam : g.awayTeam;

  const fire = (runs: number) => {
    // Score delta first — the runs that crossed on the swing.
    ctl.score.mutate({ team: battingTeam, delta: runs });
    // Then the cinematic. 4 runs = grand slam; otherwise a home run.
    // `homeRun` / `grandSlam` are the sport's celebration keys — softball
    // spreads BASEBALL so both resolve to its 🥎 variants — and the board /
    // ribbon map them to the baseball cinematics.
    ctl.cue.mutate({ key: runs >= 4 ? 'grandSlam' : 'homeRun', target: 'ALL' });
    setOpen(false);
    setFired(true);
    if (firedTimer.current) clearTimeout(firedTimer.current);
    firedTimer.current = setTimeout(() => setFired(false), 1600);
  };

  const RUNS: { n: number; label: string; sub: string }[] = [
    { n: 1, label: 'Solo', sub: '+1' },
    { n: 2, label: '2-run', sub: '+2' },
    { n: 3, label: '3-run', sub: '+3' },
    { n: 4, label: 'Grand Slam', sub: '+4' },
  ];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Home run for ${battingName} — pick the runs that scored, fires the cinematic`}
        aria-expanded={open}
        className={`h-14 px-4 rounded-xl font-black text-base transition-colors flex flex-col items-center justify-center ${
          fired
            ? 'bg-green-600 text-white'
            : 'bg-gradient-to-b from-amber-400 to-amber-500 text-amber-950 hover:from-amber-300 hover:to-amber-400'
        }`}
      >
        <span className="text-[9px] font-black tracking-widest opacity-80">
          {fired ? 'FIRED' : battingTeam === 'home' ? 'HOME BATS' : 'AWAY BATS'}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden>{def.key === 'softball' ? '🥎' : '⚾'}</span>
          {fired ? 'Home Run!' : 'HR'}
        </span>
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed top-0 right-0 bottom-0 left-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl">
            <p className="px-1 pb-1.5 text-[11px] font-bold text-slate-500">
              Runs scored on the homer — <span className="text-slate-800">{battingName}</span> bats
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {RUNS.map((r) => (
                <button
                  key={r.n}
                  type="button"
                  onClick={() => fire(r.n)}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    r.n >= 4
                      ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  <span className="block text-sm font-black text-slate-800">{r.label}</span>
                  <span className="block text-[11px] font-semibold text-slate-400">{r.sub} runs</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── PlayerFoulStepper ──────────────────────────────────────────
// Basketball per-player foul tracker. Writes stats.playerFouls (the
// shared structured key) so the board can surface foul-trouble.
// 5 fouls = fouled out (HS); we badge the player red at 4 (one away)
// and grey-out + label OUT at 5. Reuses the roster for name/jersey so
// the operator taps a name instead of typing. Falls back to a manual
// jersey add when the roster is empty.
type PlayerFoulRow = { team: 'home' | 'away'; jersey: number; name?: string; fouls: number };

function PlayerFoulStepper({
  gameId,
  g,
  ctl,
  stats,
}: {
  gameId: string;
  g: any;
  ctl: ReturnType<typeof useGameControl>;
  stats: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const roster = useGameRoster(gameId);
  const players: any[] = Array.isArray(roster.data) ? roster.data : [];

  const rows: PlayerFoulRow[] = Array.isArray(stats.playerFouls)
    ? (stats.playerFouls as any[]).filter(
        (r) => r && (r.team === 'home' || r.team === 'away'),
      )
    : [];

  const writeRows = (next: PlayerFoulRow[]) =>
    ctl.stats.mutate({ stats: { playerFouls: next } });

  const setFouls = (team: 'home' | 'away', jersey: number, name: string | undefined, fouls: number) => {
    const clamped = Math.max(0, Math.min(9, fouls));
    const idx = rows.findIndex((r) => r.team === team && r.jersey === jersey);
    let next: PlayerFoulRow[];
    if (idx >= 0) {
      next = rows.map((r, i) => (i === idx ? { ...r, fouls: clamped, name: name ?? r.name } : r));
    } else {
      next = [...rows, { team, jersey, name, fouls: clamped }];
    }
    // Drop zero-foul rows that aren't pinned by a name so the list stays tidy.
    writeRows(next.filter((r) => r.fouls > 0 || r.name));
  };

  const totalFlagged = rows.filter((r) => r.fouls >= 4).length;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Per-player fouls — 5 = fouled out"
        className={`h-14 px-3 rounded-xl font-black text-sm transition-colors flex flex-col items-center justify-center border ${
          totalFlagged > 0
            ? 'bg-amber-500 border-amber-600 text-amber-950 hover:bg-amber-400'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
        }`}
      >
        <span className="text-[9px] font-black tracking-widest text-slate-400">FOULS</span>
        <span className="flex items-center gap-1">
          Players
          {totalFlagged > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-950 text-amber-50 text-[10px] tabular-nums">
              {totalFlagged}
            </span>
          )}
        </span>
      </button>

      {open && (
        <PlayerCounterPopover
          title="Player fouls"
          subtitle="5 = fouled out (HS). Tap a name to add a foul."
          onClose={() => setOpen(false)}
          homeTeam={g.homeTeam}
          awayTeam={g.awayTeam}
          players={players}
          rows={rows.map((r) => ({ team: r.team, jersey: r.jersey, name: r.name, count: r.fouls }))}
          max={5}
          outLabel="FOULED OUT"
          warnAt={4}
          unit="foul"
          onSet={(team, jersey, name, count) => setFouls(team, jersey, name, count)}
        />
      )}
    </div>
  );
}

// ── PlayerExclusionStepper ─────────────────────────────────────
// Water-polo per-player exclusion (major foul) tracker. Writes
// stats.playerExclusions. 3 exclusions = ejected (FINA), so we badge at
// 2 and label EJECTED at 3. Same roster-backed picker pattern as fouls.
type PlayerExclusionRow = { team: 'home' | 'away'; jersey: number; name?: string; count: number };

function PlayerExclusionStepper({
  gameId,
  g,
  ctl,
  stats,
}: {
  gameId: string;
  g: any;
  ctl: ReturnType<typeof useGameControl>;
  stats: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const roster = useGameRoster(gameId);
  const players: any[] = Array.isArray(roster.data) ? roster.data : [];

  const rows: PlayerExclusionRow[] = Array.isArray(stats.playerExclusions)
    ? (stats.playerExclusions as any[]).filter(
        (r) => r && (r.team === 'home' || r.team === 'away'),
      )
    : [];

  const writeRows = (next: PlayerExclusionRow[]) =>
    ctl.stats.mutate({ stats: { playerExclusions: next } });

  const setCount = (team: 'home' | 'away', jersey: number, name: string | undefined, count: number) => {
    const clamped = Math.max(0, Math.min(9, count));
    const idx = rows.findIndex((r) => r.team === team && r.jersey === jersey);
    let next: PlayerExclusionRow[];
    if (idx >= 0) {
      next = rows.map((r, i) => (i === idx ? { ...r, count: clamped, name: name ?? r.name } : r));
    } else {
      next = [...rows, { team, jersey, name, count: clamped }];
    }
    writeRows(next.filter((r) => r.count > 0 || r.name));
  };

  const totalFlagged = rows.filter((r) => r.count >= 2).length;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Per-player exclusions — 3 = ejected"
        className={`h-14 px-3 rounded-xl font-black text-sm transition-colors flex flex-col items-center justify-center border ${
          totalFlagged > 0
            ? 'bg-amber-500 border-amber-600 text-amber-950 hover:bg-amber-400'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
        }`}
      >
        <span className="text-[9px] font-black tracking-widest text-slate-400">EXCLUSIONS</span>
        <span className="flex items-center gap-1">
          Players
          {totalFlagged > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-950 text-amber-50 text-[10px] tabular-nums">
              {totalFlagged}
            </span>
          )}
        </span>
      </button>

      {open && (
        <PlayerCounterPopover
          title="Player exclusions"
          subtitle="3 = ejected (FINA). Tap a name to add an exclusion."
          onClose={() => setOpen(false)}
          homeTeam={g.homeTeam}
          awayTeam={g.awayTeam}
          players={players}
          rows={rows.map((r) => ({ team: r.team, jersey: r.jersey, name: r.name, count: r.count }))}
          max={3}
          outLabel="EJECTED"
          warnAt={2}
          unit="exclusion"
          onSet={(team, jersey, name, count) => setCount(team, jersey, name, count)}
        />
      )}
    </div>
  );
}

// ── PlayerCounterPopover ───────────────────────────────────────
// Shared roster-backed counter popover for foul / exclusion trackers.
// Shows the live counts grouped by team with a − / + stepper per row,
// plus a roster-name picker to add a player and a manual jersey add when
// the roster is empty. `max` is the disqualification threshold (5 fouls
// / 3 exclusions); `warnAt` badges the at-risk player; `outLabel` is the
// disqualified caption.
type CounterRow = { team: 'home' | 'away'; jersey: number; name?: string; count: number };

function PlayerCounterPopover({
  title,
  subtitle,
  onClose,
  homeTeam,
  awayTeam,
  players,
  rows,
  max,
  outLabel,
  warnAt,
  unit,
  onSet,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  homeTeam: string;
  awayTeam: string;
  players: any[];
  rows: CounterRow[];
  max: number;
  outLabel: string;
  warnAt: number;
  unit: string;
  onSet: (team: 'home' | 'away', jersey: number, name: string | undefined, count: number) => void;
}) {
  const [addTeam, setAddTeam] = useState<'home' | 'away'>('home');
  const [manualJersey, setManualJersey] = useState('');

  // Roster players for the add-picker, by team. Roster `team` is a
  // free string; anything not 'away' counts as home (mirrors PaRosterPicker).
  const rosterFor = (team: 'home' | 'away') =>
    players.filter((p) => (team === 'away' ? p.team === 'away' : p.team !== 'away'));

  const rowFor = (team: 'home' | 'away', jersey: number) =>
    rows.find((r) => r.team === team && r.jersey === jersey);

  const grouped: { team: 'home' | 'away'; label: string }[] = [
    { team: 'home', label: homeTeam || 'Home' },
    { team: 'away', label: awayTeam || 'Away' },
  ];

  const addManual = () => {
    const j = parseInt(manualJersey, 10);
    if (!Number.isFinite(j) || j < 0 || j > 999) return;
    if (!rowFor(addTeam, j)) onSet(addTeam, j, undefined, 1);
    setManualJersey('');
  };

  return (
    <>
      <div className="fixed top-0 right-0 bottom-0 left-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 z-50 mb-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">{title}</p>
            <p className="text-[11px] text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto space-y-3">
          {grouped.map((grp) => {
            const teamRows = rows
              .filter((r) => r.team === grp.team)
              .sort((a, b) => a.jersey - b.jersey);
            const rosterChoices = rosterFor(grp.team).filter(
              (p) => !rowFor(grp.team, parseInt(String(p.number || ''), 10)),
            );
            return (
              <div key={grp.team}>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {grp.label}
                </p>
                {teamRows.length === 0 && (
                  <p className="px-1 pb-1 text-[11px] text-slate-300">No {unit}s yet.</p>
                )}
                <div className="space-y-1">
                  {teamRows.map((r) => {
                    const out = r.count >= max;
                    const warn = !out && r.count >= warnAt;
                    return (
                      <div
                        key={`${r.team}-${r.jersey}`}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                          out
                            ? 'border-red-200 bg-red-50'
                            : warn
                              ? 'border-amber-200 bg-amber-50'
                              : 'border-slate-200'
                        }`}
                      >
                        <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-1 rounded-md bg-slate-900 text-white text-xs font-black tabular-nums">
                          #{r.jersey}
                        </span>
                        <span className="flex-1 truncate text-xs font-semibold text-slate-700">
                          {r.name || 'Player'}
                          {out && (
                            <span className="ml-1 text-[10px] font-black text-red-600">{outLabel}</span>
                          )}
                        </span>
                        {/* Per-player foul/exclusion steppers — ≥44px so two
                            adjacent rows can't be mis-tapped during live play.
                            (2026-06-15 console-UX P0) */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Remove ${unit}`}
                            onClick={() => onSet(r.team, r.jersey, r.name, r.count - 1)}
                            className="min-h-[44px] min-w-[44px] rounded-lg bg-slate-100 text-slate-600 text-lg font-black hover:bg-slate-200 active:bg-slate-300"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-base font-black tabular-nums text-slate-900">
                            {r.count}
                          </span>
                          <button
                            type="button"
                            aria-label={`Add ${unit}`}
                            onClick={() => onSet(r.team, r.jersey, r.name, r.count + 1)}
                            className="min-h-[44px] min-w-[44px] rounded-lg bg-indigo-600 text-white text-lg font-black hover:bg-indigo-700 active:bg-indigo-800"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add a player to this team — roster names first, manual fallback. */}
                {rosterChoices.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rosterChoices.slice(0, 12).map((p) => {
                      const j = parseInt(String(p.number || ''), 10);
                      const jersey = Number.isFinite(j) ? j : 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onSet(grp.team, jersey, p.name, 1)}
                          className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                        >
                          #{p.number || '—'} {p.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Manual add — for the roster-empty case. */}
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Add by jersey
          </p>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1">
              {(['home', 'away'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAddTeam(t)}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
                    addTeam === t
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {t === 'home' ? homeTeam || 'Home' : awayTeam || 'Away'}
                </button>
              ))}
            </div>
            <Input
              value={manualJersey}
              onChange={(e) => setManualJersey(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }}
              placeholder="#"
              inputMode="numeric"
              className="h-8 w-14 text-center text-sm font-bold"
            />
            <Button size="sm" onClick={addManual} disabled={!manualJersey}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── MeetResultsSection ─────────────────────────────────────────
// Finish-results grid for LEADERBOARD meet sports (track / swim /
// cross-country / golf) AND the per-apparatus / per-routine judged
// sports (gymnastics / cheer). Writes stats.results — the shared
// structured key the board reads.
//
// Shape: Array<{ event, order?, entries: [{ place, name, team, lane?, mark }] }>
//   - For meet sports: event = "100m Free", mark = a time / distance.
//   - For judged sports: event = the apparatus / round ("Vault"), mark =
//     the decimal judged score ("9.850"). `judged` flips copy + presets.
//
// 30-second happy path: tap "Add event" → name it (or pick an apparatus
// preset) → "Add finisher" → type place + name + mark → done. No nested
// modals; every field is type-in-place and persists on blur/Enter.
type ResultEntry = { place: number; name: string; team?: 'home' | 'away' | null; lane?: number; mark: string };
type ResultEvent = { event: string; order?: number; entries: ResultEntry[] };

const APPARATUS_PRESETS: Record<string, string[]> = {
  gymnastics: ['Vault', 'Bars', 'Beam', 'Floor', 'All-Around'],
  competitive_cheer: ['Round 1', 'Round 2', 'Finals', 'Game Day', 'Stunt'],
};

function MeetResultsSection({
  g,
  def,
  ctl,
  judged,
}: {
  g: any;
  def: SportDefinition;
  ctl: ReturnType<typeof useGameControl>;
  judged: boolean;
}) {
  const stats: Record<string, unknown> = g.stats || {};
  const events: ResultEvent[] = Array.isArray(stats.results)
    ? (stats.results as any[])
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          event: String(e.event || ''),
          order: typeof e.order === 'number' ? e.order : undefined,
          entries: Array.isArray(e.entries)
            ? (e.entries as any[]).map((en) => ({
                place: typeof en.place === 'number' ? en.place : 0,
                name: String(en.name || ''),
                team: en.team === 'home' || en.team === 'away' ? en.team : null,
                lane: typeof en.lane === 'number' ? en.lane : undefined,
                mark: String(en.mark || ''),
              }))
            : [],
        }))
    : [];

  const write = (next: ResultEvent[]) => ctl.stats.mutate({ stats: { results: next } });

  const [newEvent, setNewEvent] = useState('');
  const markLabel = judged ? 'Score' : 'Mark';
  const markPlaceholder = judged
    ? def.key === 'gymnastics' ? '9.850' : '285.5'
    : def.key === 'golf' ? '72 (+1)' : def.key === 'swimming_diving' ? '1:52.31' : '11.42';
  const eventNoun = judged ? (def.key === 'gymnastics' ? 'apparatus' : 'round') : 'event';
  const lanesShown = def.key === 'swimming_diving';
  const presets = APPARATUS_PRESETS[def.key] || [];

  const addEvent = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    write([...events, { event: trimmed, order: events.length + 1, entries: [] }]);
    setNewEvent('');
  };
  const removeEvent = (idx: number) => write(events.filter((_, i) => i !== idx));
  const updateEvent = (idx: number, patch: Partial<ResultEvent>) =>
    write(events.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const addEntry = (evIdx: number) => {
    const ev = events[evIdx];
    const nextPlace = ev.entries.length + 1;
    updateEvent(evIdx, {
      entries: [...ev.entries, { place: nextPlace, name: '', team: null, mark: '' }],
    });
  };
  const updateEntry = (evIdx: number, enIdx: number, patch: Partial<ResultEntry>) => {
    const ev = events[evIdx];
    updateEvent(evIdx, {
      entries: ev.entries.map((en, i) => (i === enIdx ? { ...en, ...patch } : en)),
    });
  };
  const removeEntry = (evIdx: number, enIdx: number) => {
    const ev = events[evIdx];
    updateEvent(evIdx, { entries: ev.entries.filter((_, i) => i !== enIdx) });
  };

  return (
    <div className="bg-white border-t border-slate-200 px-4 py-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">
              {judged ? 'Apparatus results' : 'Meet results'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {judged
                ? 'Per-apparatus scores — these drive the leaderboard board.'
                : 'Finish order per event — these drive the leaderboard board.'}
            </p>
          </div>
        </div>

        {/* Add an event / apparatus. Presets are one-tap for judged sports. */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => addEvent(p)}
              disabled={events.some((e) => e.event.toLowerCase() === p.toLowerCase())}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              + {p}
            </button>
          ))}
          <Input
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addEvent(newEvent); }}
            placeholder={judged ? `New ${eventNoun}…` : 'New event (e.g. 100m Free)…'}
            className="h-9 w-48 text-sm"
          />
          <Button size="sm" onClick={() => addEvent(newEvent)} disabled={!newEvent.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add {eventNoun}
          </Button>
        </div>

        {events.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
            {judged
              ? `Add an ${eventNoun} above, then record each team's score.`
              : 'Add an event above, then record the finish order.'}
          </div>
        )}

        <div className="space-y-3">
          {events.map((ev, evIdx) => (
            <div key={evIdx} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 border-b border-slate-200">
                <Input
                  value={ev.event}
                  onChange={(e) => updateEvent(evIdx, { event: e.target.value })}
                  placeholder={judged ? eventNoun : 'Event name'}
                  className="h-8 flex-1 text-sm font-bold bg-white"
                />
                <button
                  type="button"
                  onClick={() => removeEvent(evIdx)}
                  aria-label="Remove event"
                  className="rounded-md px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  Remove
                </button>
              </div>

              {/* Column headers */}
              <div className="flex items-center gap-2 px-3 pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span className="w-12">{judged ? '#' : 'Place'}</span>
                {lanesShown && <span className="w-12">Lane</span>}
                <span className="flex-1">{judged ? 'Team / athlete' : 'Name'}</span>
                <span className="w-20">Side</span>
                <span className="w-24">{markLabel}</span>
                <span className="w-8" />
              </div>

              <div className="px-3 py-2 space-y-1.5">
                {ev.entries.map((en, enIdx) => (
                  <div key={enIdx} className="flex items-center gap-2">
                    <Input
                      value={String(en.place || '')}
                      onChange={(e) =>
                        updateEntry(evIdx, enIdx, {
                          place: Math.max(0, Math.min(999, parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10))),
                        })
                      }
                      inputMode="numeric"
                      className="h-9 w-12 text-center text-sm font-black"
                    />
                    {lanesShown && (
                      <Input
                        value={typeof en.lane === 'number' ? String(en.lane) : ''}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          updateEntry(evIdx, enIdx, { lane: v ? Math.max(0, Math.min(99, parseInt(v, 10))) : undefined });
                        }}
                        inputMode="numeric"
                        placeholder="—"
                        className="h-9 w-12 text-center text-sm"
                      />
                    )}
                    <Input
                      value={en.name}
                      onChange={(e) => updateEntry(evIdx, enIdx, { name: e.target.value })}
                      placeholder={judged ? 'Team / athlete' : 'Athlete name'}
                      className="h-9 flex-1 text-sm"
                    />
                    {/* Side picker — Home / Away / neutral. */}
                    <div className="flex w-20 gap-0.5">
                      {([
                        { v: 'home' as const, l: 'H' },
                        { v: 'away' as const, l: 'A' },
                        { v: null, l: '–' },
                      ]).map((opt) => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => updateEntry(evIdx, enIdx, { team: opt.v })}
                          title={opt.v === 'home' ? g.homeTeam : opt.v === 'away' ? g.awayTeam : 'Neutral'}
                          className={`flex-1 h-9 rounded-md text-xs font-black transition-colors ${
                            en.team === opt.v
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {opt.l}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={en.mark}
                      onChange={(e) => updateEntry(evIdx, enIdx, { mark: e.target.value })}
                      placeholder={markPlaceholder}
                      className="h-9 w-24 text-center text-sm font-bold tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => removeEntry(evIdx, enIdx)}
                      aria-label="Remove finisher"
                      className="h-9 w-8 rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600 font-black"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addEntry(evIdx)}
                  className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {judged ? 'Add score' : 'Add finisher'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
  // item J (2026-06-16) — a custom length for leagues whose shot clock isn't
  // one of the presets. The configure mutation already accepts any value;
  // this just exposes it. A non-preset live value counts as "custom".
  const isCustom = len > 0 && !opts.includes(len);
  const [custom, setCustom] = useState(isCustom ? String(len) : '');
  const customNum = Math.round(Number(custom));
  const customValid = Number.isFinite(customNum) && customNum >= 1 && customNum <= 90;
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
      {/* item J — custom length. Shows the active custom value highlighted. */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500 shrink-0">Custom</span>
        <input
          type="number"
          min={1}
          max={90}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customValid) ctl.shotClock.mutate({ action: 'configure', value: customNum });
          }}
          placeholder="sec"
          className="w-20 px-2 py-1.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!customValid || customNum === len}
          onClick={() => ctl.shotClock.mutate({ action: 'configure', value: customNum })}
        >
          Set
        </Button>
        {isCustom && (
          <span className="text-[11px] font-semibold text-indigo-600">Using {len}s</span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {isCustom ? `${len}s custom shot clock.` : OPTS.find((o) => o.v === len)?.hint}
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

  // item B (2026-06-21) — answer the operator's "where's the photo?": the
  // intro content IS the roster. Surface per-team readiness (player + photo
  // counts) so it's obvious the content exists + where it comes from. Shared
  // React Query cache with RosterPanel, so no extra fetch.
  const rosterQ = useGameRoster(gameId);
  const roster: Array<{ team?: string; photoUrl?: string | null }> = Array.isArray(rosterQ.data)
    ? (rosterQ.data as Array<{ team?: string; photoUrl?: string | null }>)
    : [];
  const teamStats = (team: 'home' | 'away') => {
    const players = roster.filter((p) => p.team === team);
    return { count: players.length, photos: players.filter((p) => !!p.photoUrl).length };
  };
  const homeStats = teamStats('home');
  const awayStats = teamStats('away');

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
      {/* item B (2026-06-21) — explain WHAT it is, WHEN it fires, and WHERE the
          content comes from (the roster). This answers "where's the photo?". */}
      <p className="text-xs text-slate-500 mb-1">
        Takes over the scoreboard with one full-screen slide per starter —{' '}
        <span className="font-semibold text-slate-600">photo, name, number and stats</span> — then
        auto-returns to the scoreboard when it finishes.
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        The photos and names come from the <span className="font-semibold text-slate-500">roster
        you build above</span> — that&rsquo;s where you add each player&rsquo;s headshot.
      </p>

      {/* Per-team readiness — so it's obvious the content exists (and what's missing). */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {(['home', 'away'] as const).map((side) => {
          const st = side === 'home' ? homeStats : awayStats;
          const name = side === 'home' ? game.homeTeam : game.awayTeam;
          return (
            <div
              key={side}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                st.count === 0
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              <span className="font-bold text-slate-700">{name}</span>{' '}
              {st.count === 0
                ? '— no players yet, add them above'
                : `— ${st.count} player${st.count === 1 ? '' : 's'} · ${st.photos} with photos`}
            </div>
          );
        })}
      </div>

      <div className="flex" style={{ marginBottom: 8 }}>
        {/* Home intro button — disabled until the home roster has players. */}
        <button
          type="button"
          disabled={busy || homeStats.count === 0}
          title={homeStats.count === 0 ? 'Add home players in the roster above first' : undefined}
          onClick={() => fire('home')}
          className={`flex-1 rounded-l-xl border-y border-l px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            succeeded('home')
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
          }`}
        >
          {succeeded('home') ? '✓ Sent!' : `🎤 ${game.homeTeam} Intro`}
        </button>

        {/* Away intro button — disabled until the away roster has players. */}
        <button
          type="button"
          disabled={busy || awayStats.count === 0}
          title={awayStats.count === 0 ? 'Add away players in the roster above first' : undefined}
          onClick={() => fire('away')}
          className={`flex-1 rounded-r-xl border-y border-r px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            succeeded('away')
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200'
          }`}
          style={{ borderLeft: '1px solid #e2e8f0' }}
        >
          {succeeded('away') ? '✓ Sent!' : `🎤 ${game.awayTeam} Intro`}
        </button>
      </div>
      <p className="text-[11px] text-slate-400" style={{ marginBottom: 8 }}>
        Firing an intro shows it on the scoreboard now (a live preview is in the Displays section above).
      </p>

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
  // Inning sports (baseball / softball) never read "OT" — extra
  // innings just keep counting (Top 10th, Bot 11th…). This branch
  // MUST precede the overtime check (audit: console copy of the
  // OT-before-Inning bug — extra innings were showing "OT").
  if (def.segment.name === 'Inning') {
    const half = String((g.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}#${n}`;
  }
  if (n > def.segment.count) {
    // Leaderboard / hole-based meet sports never overflow into "OT" —
    // clamp the label to the segment name (Hole 18, Event N) instead.
    if (def.mode === 'LEADERBOARD' || def.segment.overtime === false) {
      return `${def.segment.name} ${Math.min(n, def.segment.count)}`;
    }
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
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
  const [soundPickerOpen, setSoundPickerOpen] = useState(false); // item I
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
    <div>
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
        {/* item I (2026-06-16) — UPLOAD an MP3 (not URL-only). The assets
            upload chain already accepts audio/mpeg + audio/wav; this just
            surfaces it + a ▶ preview so the operator hears it before the game. */}
        <div>
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5" />
            Celebration sound
          </label>
          <Input
            className="mt-1"
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="Paste a sound URL, or upload below"
            maxLength={2048}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setSoundPickerOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload MP3
            </Button>
            {audioUrl.trim() && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio src={audioUrl.trim()} controls preload="none" className="h-8 max-w-[220px]" />
            )}
            {audioUrl.trim() && (
              <button
                type="button"
                onClick={() => setAudioUrl('')}
                className="text-[11px] text-slate-400 hover:text-rose-600 font-semibold"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Played on every fired celebration. Upload an MP3/WAV (or paste a URL) — leave blank for
            no sound.
          </p>
          {soundPickerOpen && (
            <AssetPicker
              kind="audio"
              title="Choose celebration sound"
              onPick={(url) => {
                setAudioUrl(url);
                setSoundPickerOpen(false);
              }}
              onClose={() => setSoundPickerOpen(false)}
            />
          )}
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

/** Inner content of sponsor scheduling — no Section wrapper.
 *  Used inside the unified "Sponsors" card in Setup mode. */
function SponsorSchedulingInner() {
  const { data, isLoading } = useSponsors();
  const update = useUpdateSponsor();
  const sponsors: ScheduledSponsor[] = Array.isArray(data) ? (data as ScheduledSponsor[]) : [];

  if (isLoading) return null;
  if (sponsors.length === 0)
    return (
      <p className="text-xs text-slate-400">
        Add at least one sponsor above to configure flight dates and frequency caps.
      </p>
    );

  return (
    <>
      <p className="text-xs text-slate-400 mb-3">
        For each sponsor: how often it appears, a limit on repeats, and the date range it runs.
        Everything auto-starts and auto-stops — set it once before the game.
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
    </>
  );
}

/** Standalone card wrapper — used wherever SponsorScheduling appears outside the Setup 6-section layout. */
function SponsorSchedulingSection() {
  return (
    <Section title="Sponsor ad scheduling">
      <SponsorSchedulingInner />
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
        {/* item G (2026-06-16) — plain "how often" instead of "rotation
            weight 5/2/10". The numeric `weight` stays the single source of
            truth; the buttons just pick it. */}
        <div>
          <label className="font-semibold text-slate-500">How often it appears</label>
          <div className="mt-1 flex rounded-lg border border-slate-200 overflow-hidden">
            {FREQ_TIERS.map((t) => {
              const on = weightToTier(weight) === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  title={t.help}
                  onClick={() => {
                    setWeight(FREQ_TIER_WEIGHT[t.value]);
                    mark();
                  }}
                  className={`flex-1 px-2 py-1.5 text-[11px] font-bold transition-colors ${
                    on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* item G — "don't show more than" dropdown, not a raw number box
            labelled "Uncapped". Stored as frequencyCapPerHour. */}
        <div>
          <label className="font-semibold text-slate-500">Don&rsquo;t show more than</label>
          <select
            value={freqCap === '' ? '' : freqCap}
            onChange={(e) => {
              setFreqCap(e.target.value);
              mark();
            }}
            className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            {CAP_PRESETS.map((p) => (
              <option key={p.label} value={p.perHour == null ? '' : String(p.perHour)}>
                {p.label}
              </option>
            ))}
            {/* preserve a pre-existing non-preset value so nothing is lost */}
            {freqCap !== '' && !CAP_PRESETS.some((p) => String(p.perHour ?? '') === freqCap) && (
              <option value={freqCap}>{capLabel(Number(freqCap))}</option>
            )}
          </select>
        </div>
        {/* item G — "Flight start/end" ad-jargon → plain "Show from / until". */}
        <div>
          <label className="font-semibold text-slate-500">Show from</label>
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
          <label className="font-semibold text-slate-500">Show until</label>
          <input
            type="date"
            value={flightEnd}
            onChange={(e) => {
              setFlightEnd(e.target.value);
              mark();
            }}
            className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <p className="text-[11px] text-slate-400 mt-0.5 sm:col-span-2">
            Auto-starts and auto-stops. Leave blank to always show.
          </p>
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

// item 0 (2026-06-20) — Section gains an optional "Ready ✓" completion badge so
// Setup reads as a pre-game checklist. The badge is POSITIVE-only (shown when a
// section is configured); an empty optional section shows NO badge, so the
// operator is never nagged about things a game doesn't need to go live.
function Section({
  title,
  children,
  done,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  done?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {done && (
          // Positive-only "Configured" (not "Ready") so an optional section's
          // badge never reads as a required step the operator missed (review nit).
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
            <Check className="h-3 w-3" /> Configured
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] text-slate-400 -mt-1.5 mb-3">{hint}</p>}
      {children}
    </div>
  );
}

/** item A (2026-06-20) — the LIVE game-state control. Setup no longer carries
 *  the 5-state stepper (it was always "Scheduled" there); state changes belong
 *  HERE in Run, where the status cinematics + horn (T1-5) fire. Reuses the SAME
 *  unified status mutation (T1-1) the old stepper used — so durable undo (T1-2)
 *  + the cinematics come for free, with no new handler and no hook edit. */
function RunStatusControl({ g, ctl }: { g: any; ctl: ReturnType<typeof useGameControl> }) {
  const status = String(g?.status || 'SCHEDULED');
  const go = (s: string) => ctl.status.mutate({ status: s });
  const META: Record<string, { label: string; chip: string; dot: string }> = {
    SCHEDULED: { label: 'Scheduled', chip: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
    PRE_GAME: { label: 'Pre-game', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
    LIVE: { label: 'Live', chip: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500 animate-pulse' },
    HALFTIME: { label: 'Halftime', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
    FINAL: { label: 'Final', chip: 'bg-slate-800 text-white border-slate-700', dot: 'bg-slate-400' },
  };
  const m = META[status] || META.SCHEDULED;
  const btn = 'min-h-[40px] px-3.5 py-1.5 rounded-lg text-sm font-bold border transition-colors shrink-0';
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white overflow-x-auto">
      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Game state</span>
      <span
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest border ${m.chip} shrink-0`}
      >
        <span className={`w-2 h-2 rounded-full ${m.dot}`} />
        {m.label}
      </span>
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        {(status === 'SCHEDULED' || status === 'PRE_GAME') && (
          <button type="button" onClick={() => go('LIVE')} className={`${btn} border-green-600 bg-green-600 text-white hover:bg-green-700`}>
            ● Go Live
          </button>
        )}
        {status === 'LIVE' && (
          <>
            <button type="button" onClick={() => go('HALFTIME')} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}>
              Halftime
            </button>
            <HoldChip
              label="Final"
              ariaLabel="Mark game Final — hold to confirm; ends real-time scoring"
              onConfirm={() => go('FINAL')}
              className={`${btn} border-slate-300 text-slate-600 hover:bg-slate-100`}
            />
          </>
        )}
        {status === 'HALFTIME' && (
          <>
            <button type="button" onClick={() => go('LIVE')} className={`${btn} border-green-600 bg-green-600 text-white hover:bg-green-700`}>
              Resume
            </button>
            <HoldChip
              label="Final"
              ariaLabel="Mark game Final — hold to confirm; ends real-time scoring"
              onConfirm={() => go('FINAL')}
              className={`${btn} border-slate-300 text-slate-600 hover:bg-slate-100`}
            />
          </>
        )}
        {status === 'FINAL' && (
          // Reopening a finalized game resumes live scoring — deliberate, so
          // hold-to-confirm like the other significant transitions (review nit).
          <HoldChip
            label="Reopen game"
            ariaLabel="Reopen game — hold to confirm; resumes live scoring"
            onConfirm={() => go('LIVE')}
            className={`${btn} border-slate-300 text-slate-600 hover:bg-slate-100`}
          />
        )}
      </div>
    </div>
  );
}

/** item A/0 — the Setup checklist's single primary action. `onLive` (in the
 *  parent) performs the Scheduled→LIVE transition via the same unified mutation
 *  then routes to Run; once live it just opens Run. */
function GoLiveBar({ g, onLive }: { g: any; onLive: () => void }) {
  const status = String(g?.status || 'SCHEDULED');
  const pre = status === 'SCHEDULED' || status === 'PRE_GAME';
  return (
    <div className="rounded-2xl bg-slate-900 text-white p-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <div className="text-sm font-bold">
          {pre ? 'Ready when you are' : status === 'LIVE' ? 'Game is live' : status === 'HALFTIME' ? 'Halftime' : 'Game is final'}
        </div>
        <p className="text-[13px] text-slate-300 mt-0.5">
          {pre
            ? 'Going live starts the game on every screen and opens the Run console — where you score the game and change states.'
            : 'Switch to Run game to control the live game.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onLive}
        className="min-h-[48px] px-6 py-2.5 rounded-xl text-base font-black bg-green-500 hover:bg-green-400 text-slate-900 shrink-0"
      >
        {pre ? '● Go Live' : 'Open Run console →'}
      </button>
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
  // 2026-06-16 — filter STRICTLY by sports category, NOT aspect ratio. The
  // old `ratio < 3` scoreboard catch-all swept in every vertical's 1920×1080
  // template (Touch Kiosk, QSR menus, Worship, Healthcare, …) — the operator
  // saw "Touch Kiosk — Veterinary Check-In" in the scoreboard dropdown. Only
  // sports-board categories belong on a sports surface.
  const SCOREBOARD_CATS = new Set(['SCOREBOARD', 'SPORTS', 'GAMEDAY', 'ATHLETICS', 'EVENTS']);
  function aspectMatches(t: typeof list[number], surface: 'scoreboard' | 'ribbon' | 'scorebug'): boolean {
    const cat = (t.category || '').toUpperCase();
    if (surface === 'ribbon')   return cat === 'RIBBON';
    if (surface === 'scorebug') return cat === 'SCOREBUG' || cat === 'SPONSOR';
    return SCOREBOARD_CATS.has(cat);
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
// data is surfaced via ScoreTile (per-team), GameScopeStatEditor
// (game-scope text / number), and the sport bottom trays.
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
      key: 'v1',
      name: 'Classic',
      desc: 'Marquee scoreboard cinematics + horizontal ribbon strip (default).',
    },
    {
      key: 'v2',
      name: 'Stadium v2',
      desc: 'New canvas engine — same cue plays brand-matched on both the scoreboard and ribbon. Water polo only for now; other sports fall back to Classic.',
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
  useOverlayLock(); // hide mobile tab bar while the cheat sheet is open
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
