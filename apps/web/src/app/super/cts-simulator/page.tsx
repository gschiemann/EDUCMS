"use client";

/**
 * SEC-010 (2026-09-04) — rendered per request so it can carry a CSP nonce.
 *
 * A prerendered route's inline scripts are built without a nonce, so the
 * enforced `script-src 'self' 'nonce-…'` from `src/proxy.ts` would refuse them
 * and this page would render blank. This route holds (or leads directly to) an
 * authenticated session, which is precisely what SEC-010's XSS impact is about,
 * so it is worth one render per request to bring it inside the policy. Public
 * marketing/legal/help pages and `/panic` deliberately stay prerendered and
 * report-only — see CSP_UNNONCEABLE_PREFIXES in src/lib/csp-script-policy.ts.
 *
 * `tools/check-csp-prerender.cjs` fails the build if this ever silently
 * reverts to being prerendered.
 */
export const dynamic = 'force-dynamic';

/**
 * /super/cts-simulator — synthetic CTS Gen 6 console driver.
 *
 * The Colorado Timing System Gen 6 console is the physical box we
 * integrate with at the water polo install (T2-1). In production the
 * flow is: console -> RS232 cable -> EP6N/ECBox player -> CtsBridge
 * decodes the byte stream -> POST /api/v1/sports/games/:id/cts-
 * snapshot -> SportsService.ingestCtsSnapshot writes stats.cts ->
 * board / ribbon / scorebug surfaces poll the live overlay.
 *
 * This page is the dev / demo / rehearsal driver. It POSTs the SAME
 * snapshots a real bridge would post, so every downstream path runs
 * exactly like the real install (T1-1's "same rules apply" rule).
 * The right pane embeds the live /board/:id surface so the operator
 * sees the wall react in real time as they click buttons.
 *
 * SUPER_ADMIN only — gated both client-side and via the @RequireRoles
 * guard on the cts-snapshot endpoint.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Loader2, ChevronLeft, Pause, Play, RotateCcw, Plus, Minus,
  Trophy, Volume2, UserX, Timer, Zap, Radio,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useGames, useGame, useCtsSimulator, type CtsSimSnapshot } from '@/hooks/use-api';

type Game = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  clockMs: number;
  clockRunning: boolean;
  segment: number;
  status: string;
  stats: any;
};

export default function CtsSimulatorPage() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && (!user || user.role !== 'SUPER_ADMIN')) {
      router.replace('/');
    }
  }, [mounted, user, router]);

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-300">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!user || user.role !== 'SUPER_ADMIN') {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-[1920px] items-center gap-4 px-6 py-3">
          <button
            onClick={() => router.push('/super')}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" /> Back to Super
          </button>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-5 w-5 text-emerald-400" />
            CTS Gen 6 Console Simulator
          </h1>
          <div className="ml-auto text-xs text-slate-400">
            POSTs synthetic snapshots to{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5">
              /sports/games/:id/cts-snapshot
            </code>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1920px] px-6 py-6">
        {selectedGameId ? (
          <SimulatorPanel
            gameId={selectedGameId}
            onChangeGame={() => setSelectedGameId(null)}
          />
        ) : (
          <GamePicker onPick={setSelectedGameId} />
        )}
      </main>
    </div>
  );
}

// ─── Game picker ────────────────────────────────────────────────

function GamePicker({ onPick }: { onPick: (id: string) => void }) {
  const { data, isLoading } = useGames();
  const games: Game[] = Array.isArray(data) ? (data as Game[]) : [];

  // Surface water polo + every game with a CTS-capable sport. The
  // simulator works for any sport that has a defined CTS module table
  // (currently only water_polo — T2-1 P0-5 will expand this).
  const ctsGames = games.filter((g) => g.sport === 'water_polo');
  const otherGames = games.filter((g) => g.sport !== 'water_polo');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Pick a game to drive
        </h2>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : ctsGames.length === 0 && otherGames.length === 0 ? (
          <p className="rounded border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
            No games found. Create a water-polo game first via the operator
            console at <code className="text-slate-200">/[schoolId]/sports</code>.
          </p>
        ) : (
          <div className="space-y-4">
            {ctsGames.length > 0 && (
              <Section title="Water polo (CTS module table available)">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ctsGames.map((g) => <GameCard key={g.id} game={g} onPick={onPick} />)}
                </div>
              </Section>
            )}
            {otherGames.length > 0 && (
              <Section title="Other sports (CTS module table not yet implemented — T2-1 P0-5)">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 opacity-60">
                  {otherGames.map((g) => <GameCard key={g.id} game={g} onPick={onPick} />)}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function GameCard({ game, onPick }: { game: Game; onPick: (id: string) => void }) {
  return (
    <button
      onClick={() => onPick(game.id)}
      className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-left hover:border-emerald-500 hover:bg-slate-900"
    >
      <div className="text-xs uppercase tracking-wider text-slate-500">{game.sport}</div>
      <div className="mt-1 font-semibold">
        {game.homeTeam} vs {game.awayTeam}
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-slate-300">
          {game.homeScore}–{game.awayScore}
        </span>
        <span className="text-slate-500">{game.status}</span>
      </div>
    </button>
  );
}

// ─── Simulator panel ─────────────────────────────────────────────

function SimulatorPanel({
  gameId,
  onChangeGame,
}: {
  gameId: string;
  onChangeGame: () => void;
}) {
  const { data, isLoading } = useGame(gameId);
  const game = data as Game | undefined;
  const sim = useCtsSimulator(gameId);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [lastEvent, setLastEvent] = useState<string>('');

  // Local mirrors of the CTS-side state. We track these so each button
  // press knows the cumulative state to push (real consoles do the same
  // — every packet carries the FULL current value of that module, not
  // a delta).
  const [ctsHome, setCtsHome] = useState(0);
  const [ctsAway, setCtsAway] = useState(0);
  const [ctsPeriod, setCtsPeriod] = useState(1);
  const [ctsClockMs, setCtsClockMs] = useState(8 * 60 * 1000);
  const [ctsClockRunning, setCtsClockRunning] = useState(false);
  const [ctsHomeTimeouts, setCtsHomeTimeouts] = useState(3);
  const [ctsAwayTimeouts, setCtsAwayTimeouts] = useState(3);

  // Pull the CTS-side state out of the game's stats.cts so the panel
  // boots in sync with whatever's already there.
  useEffect(() => {
    if (!game?.stats?.cts) return;
    const cts = game.stats.cts as Record<string, unknown>;
    if (typeof cts.homeScore === 'number') setCtsHome(cts.homeScore);
    if (typeof cts.awayScore === 'number') setCtsAway(cts.awayScore);
    if (typeof cts.segment === 'number') setCtsPeriod(cts.segment);
    if (typeof cts.clockMs === 'number') setCtsClockMs(cts.clockMs);
    if (typeof cts.clockRunning === 'boolean') setCtsClockRunning(cts.clockRunning);
    if (typeof cts.homeTimeoutsRemaining === 'number') setCtsHomeTimeouts(cts.homeTimeoutsRemaining);
    if (typeof cts.awayTimeoutsRemaining === 'number') setCtsAwayTimeouts(cts.awayTimeoutsRemaining);
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (snap: CtsSimSnapshot, label: string) => {
    setLastEvent(label);
    sim.mutate(snap);
  };

  // ── Action handlers ──────────────────────────────────────────

  const startClock = () => {
    setCtsClockRunning(true);
    push({ clockMs: ctsClockMs, clockRunning: true }, `Clock start @ ${fmtClock(ctsClockMs)}`);
  };
  const pauseClock = () => {
    setCtsClockRunning(false);
    push({ clockMs: ctsClockMs, clockRunning: false }, `Clock pause @ ${fmtClock(ctsClockMs)}`);
  };
  const resetClock = (ms: number, label: string) => {
    setCtsClockMs(ms);
    setCtsClockRunning(false);
    push({ clockMs: ms, clockRunning: false }, `Clock reset → ${label}`);
  };
  const homeGoal = () => {
    const next = ctsHome + 1;
    setCtsHome(next);
    push({ homeScore: next, awayScore: ctsAway }, `Home goal → ${next}–${ctsAway}`);
  };
  const awayGoal = () => {
    const next = ctsAway + 1;
    setCtsAway(next);
    push({ homeScore: ctsHome, awayScore: next }, `Away goal → ${ctsHome}–${next}`);
  };
  const homeUndo = () => {
    const next = Math.max(0, ctsHome - 1);
    setCtsHome(next);
    push({ homeScore: next, awayScore: ctsAway }, `Home undo → ${next}–${ctsAway}`);
  };
  const awayUndo = () => {
    const next = Math.max(0, ctsAway - 1);
    setCtsAway(next);
    push({ homeScore: ctsHome, awayScore: next }, `Away undo → ${ctsHome}–${next}`);
  };
  const setPeriod = (n: number) => {
    setCtsPeriod(n);
    push({ segment: n }, `Period → ${n}`);
  };
  const horn = () => {
    push({ horn: true }, `Horn`);
    setTimeout(() => sim.mutate({ horn: false }), 250);
  };
  const exclusion = (team: 'home' | 'away', jersey: number, seconds: number, slot: 0 | 1 | 2) => {
    const arr: ({ playerJersey: number; secondsRemaining: number } | null)[] = [null, null, null];
    arr[slot] = { playerJersey: jersey, secondsRemaining: seconds };
    if (team === 'home') {
      push({ homeExclusions: arr }, `Home exclusion #${jersey} @ slot ${slot + 1}`);
    } else {
      push({ awayExclusions: arr }, `Away exclusion #${jersey} @ slot ${slot + 1}`);
    }
  };
  const clearExclusion = (team: 'home' | 'away', slot: 0 | 1 | 2) => {
    const arr: ({ playerJersey: number; secondsRemaining: number } | null)[] = [null, null, null];
    if (team === 'home') {
      push({ homeExclusions: arr }, `Clear home exclusion slot ${slot + 1}`);
    } else {
      push({ awayExclusions: arr }, `Clear away exclusion slot ${slot + 1}`);
    }
  };
  const callTimeout = (team: 'home' | 'away') => {
    if (team === 'home') {
      const next = Math.max(0, ctsHomeTimeouts - 1);
      setCtsHomeTimeouts(next);
      push({ homeTimeoutsRemaining: next }, `Home timeout (${next} left)`);
    } else {
      const next = Math.max(0, ctsAwayTimeouts - 1);
      setCtsAwayTimeouts(next);
      push({ awayTimeoutsRemaining: next }, `Away timeout (${next} left)`);
    }
  };

  // ── 30-second rehearsal script ───────────────────────────────

  const runRehearsal = async () => {
    if (scriptRunning) return;
    setScriptRunning(true);
    setLastEvent('Rehearsal script started');
    try {
      // Hardcoded reproduction of REHEARSAL_SCRIPT in @cms/scoreboard-cts/mock
      // (we don't import the package in the dashboard bundle to keep the
      // dashboard runtime free of CTS protocol code — this is just a
      // simulator).
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      let h = 0, a = 0;
      const fire = (snap: CtsSimSnapshot, label: string) => {
        setLastEvent(label);
        sim.mutate(snap);
      };

      fire({ clockMs: 8 * 60 * 1000, clockRunning: false, segment: 1, homeScore: 0, awayScore: 0 }, 'Q1 setup');
      await sleep(500);
      fire({ clockMs: 7 * 60 * 1000 + 45 * 1000, clockRunning: true }, 'Clock start 7:45');
      await sleep(1000);
      h = 1; fire({ homeScore: h }, 'Home goal');
      await sleep(1500);
      fire({ homeExclusions: [{ playerJersey: 7, secondsRemaining: 20 }, null, null] }, 'Away exclusion #7');
      await sleep(1000);
      h = 2; fire({ homeScore: h }, 'Home goal');
      await sleep(1000);
      fire({ homeExclusions: [null, null, null] }, 'Clear exclusion');
      await sleep(1000);
      a = 1; fire({ awayScore: a }, 'Away goal');
      await sleep(1000);
      fire({ horn: true }, 'Horn');
      await sleep(250);
      sim.mutate({ horn: false });
      await sleep(750);
      fire({ segment: 2, clockMs: 8 * 60 * 1000, clockRunning: false }, 'Q2 begin');
      await sleep(1500);
      a = 2; fire({ awayScore: a, clockRunning: true }, 'Away goal');
      await sleep(2000);
      h = 3; fire({ homeScore: h }, 'Home goal');
      await sleep(2000);
      fire({ homeTimeoutsRemaining: 2 }, 'Home timeout');
      await sleep(2000);
      fire({ segment: 3, clockMs: 8 * 60 * 1000 }, 'Q3 begin');
      await sleep(2000);
      h = 4; fire({ homeScore: h }, 'Home goal');
      await sleep(2000);
      a = 3; fire({ awayScore: a }, 'Away goal');
      await sleep(2000);
      fire({ homeExclusions: [{ playerJersey: 11, secondsRemaining: 20 }, { playerJersey: 4, secondsRemaining: 20 }, null] }, 'Home double exclusion');
      await sleep(1000);
      a = 4; fire({ awayScore: a }, 'Away goal (power play)');
      await sleep(2000);
      fire({ segment: 4, clockMs: 8 * 60 * 1000 }, 'Q4 begin');
      await sleep(2000);
      fire({ clockMs: 45_200 }, 'Final 45s');
      await sleep(1000);
      h = 5; fire({ homeScore: h }, 'Game-winner!');
      await sleep(1000);
      fire({ horn: true, clockRunning: false }, 'Final horn');
      await sleep(250);
      sim.mutate({ horn: false });
      setLastEvent('Rehearsal complete — Home 5, Away 4');
      setCtsHome(5); setCtsAway(4); setCtsPeriod(4);
    } finally {
      setScriptRunning(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────

  if (isLoading || !game) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const tenantSlug = (game.stats?.tenantSlug as string) ?? '';
  const boardUrl = tenantSlug
    ? `/${tenantSlug}/board/${gameId}`
    : `/board/${gameId}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
      {/* Left: control panel */}
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">Driving</div>
              <div className="font-semibold">
                {game.homeTeam} vs {game.awayTeam}
              </div>
              <div className="mt-1 text-xs text-slate-400">{game.sport} · {game.status}</div>
            </div>
            <button
              onClick={onChangeGame}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              Change game
            </button>
          </div>
        </div>

        {/* CTS-side state mirror */}
        <Card title="CTS-side state">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Home" value={`${ctsHome}`} />
            <Stat label="Away" value={`${ctsAway}`} />
            <Stat label="Period" value={`Q${ctsPeriod}`} />
            <Stat label="Clock" value={`${fmtClock(ctsClockMs)} ${ctsClockRunning ? '▶' : '⏸'}`} />
            <Stat label="Home T.O." value={`${ctsHomeTimeouts}`} />
            <Stat label="Away T.O." value={`${ctsAwayTimeouts}`} />
          </div>
          {lastEvent && (
            <div className="mt-3 rounded bg-slate-950 px-3 py-2 text-xs text-emerald-300">
              ↳ {lastEvent}
            </div>
          )}
        </Card>

        {/* Clock controls */}
        <Card title="Game clock (module 0x01)">
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={startClock} disabled={ctsClockRunning} icon={Play}>
              Start
            </Btn>
            <Btn onClick={pauseClock} disabled={!ctsClockRunning} icon={Pause}>
              Pause
            </Btn>
            <Btn onClick={() => resetClock(8 * 60 * 1000, '8:00')} icon={RotateCcw}>
              Reset 8:00
            </Btn>
            <Btn onClick={() => resetClock(45_200, ':45.2')} icon={RotateCcw}>
              Set :45.2
            </Btn>
          </div>
        </Card>

        {/* Scoring */}
        <Card title="Scoring (modules 0x02 / 0x03)">
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={homeGoal} icon={Plus}>Home +1</Btn>
            <Btn onClick={awayGoal} icon={Plus}>Away +1</Btn>
            <Btn onClick={homeUndo} icon={Minus} variant="ghost">Home −1</Btn>
            <Btn onClick={awayUndo} icon={Minus} variant="ghost">Away −1</Btn>
          </div>
        </Card>

        {/* Period (segment) */}
        <Card title="Period (module 0x04)">
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((p) => (
              <Btn key={p} onClick={() => setPeriod(p)} variant={ctsPeriod === p ? 'primary' : 'ghost'}>
                Q{p}
              </Btn>
            ))}
          </div>
        </Card>

        {/* Exclusions (water-polo specific) */}
        <Card title="Exclusions (modules 0x08-0x0D)">
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => exclusion('home', 7, 20, 0)} icon={UserX}>
              Home #7 · 20s
            </Btn>
            <Btn onClick={() => exclusion('away', 11, 20, 0)} icon={UserX}>
              Away #11 · 20s
            </Btn>
            <Btn onClick={() => clearExclusion('home', 0)} variant="ghost">
              Clear home
            </Btn>
            <Btn onClick={() => clearExclusion('away', 0)} variant="ghost">
              Clear away
            </Btn>
          </div>
        </Card>

        {/* Timeouts */}
        <Card title="Timeouts remaining (modules 0x10 / 0x11)">
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => callTimeout('home')} disabled={ctsHomeTimeouts === 0} icon={Timer}>
              Home timeout
            </Btn>
            <Btn onClick={() => callTimeout('away')} disabled={ctsAwayTimeouts === 0} icon={Timer}>
              Away timeout
            </Btn>
          </div>
        </Card>

        {/* Horn */}
        <Card title="Horn (module 0x1F)">
          <Btn onClick={horn} icon={Volume2} variant="primary">
            Fire horn
          </Btn>
        </Card>

        {/* Rehearsal script */}
        <Card title="30s rehearsal script">
          <Btn
            onClick={runRehearsal}
            disabled={scriptRunning}
            icon={scriptRunning ? Loader2 : Zap}
            variant="primary"
            className={scriptRunning ? '[&_svg]:animate-spin' : ''}
          >
            {scriptRunning ? 'Running…' : 'Run 4-quarter rehearsal'}
          </Btn>
          <p className="mt-2 text-xs text-slate-500">
            Drives the game from kickoff to final horn in 30s (compressed
            timeline). Useful for visually verifying the scoreboard + ribbon
            + scorebug react to every event the real console would emit.
          </p>
        </Card>
      </div>

      {/* Right: live board iframe */}
      <div className="rounded-lg border border-slate-800 bg-black">
        <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
            Live board · {boardUrl}
          </span>
        </div>
        <iframe
          src={boardUrl}
          className="block h-[800px] w-full"
          title="Live board preview"
        />
      </div>
    </div>
  );
}

// ─── small UI helpers ────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-950 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg">{value}</div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  icon: Icon,
  variant = 'default',
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'primary' | 'ghost';
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
      : variant === 'ghost'
      ? 'border border-slate-700 text-slate-300 hover:bg-slate-800'
      : 'bg-slate-800 text-slate-100 hover:bg-slate-700';
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.ceil(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
