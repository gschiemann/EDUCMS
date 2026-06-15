'use client';

/**
 * VenueOS Sports — read-only Leaders view for the game console.
 *
 * The SERVER is the single source of truth for stat leaders + the auto
 * player-of-the-game: it computes them on the public board endpoint
 * (`GET /sports/board/:id`, see SportsBoardController + computePlayerSurfaces
 * in apps/api/src/sports/sports-stats.service.ts). We do NOT recompute
 * anything client-side — we just fetch that endpoint (same payload the
 * scoreboard renders), poll it on a short interval, and display
 * `leaders[]` + `playerOfGame`.
 *
 * Each leader row and the POTG card has a one-tap "Spotlight this player"
 * button that reuses the existing console spotlight mutation
 * (`useGameControl().spotlight` → PATCH /sports/games/:id/spotlight), so it
 * lights up the SAME Spotlight band on the board + ribbon that the Run-mode
 * roster taps drive. Read-only display otherwise — no editing here.
 *
 * Gated behind FLAGS.SPORTS_PLAYER_STATS at the mount site (page.tsx); the
 * board endpoint only includes `leaders`/`playerOfGame` when that flag is on
 * for the tenant, so an off-tenant simply sees the empty state.
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2, Star, Trophy } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useGameControl } from '@/hooks/use-api';

/** A single stat leader, exactly as the board endpoint serves it. */
type Leader = {
  statKey: string;
  label: string;
  team: 'home' | 'away';
  playerName: string;
  playerNumber: string | null;
  photoUrl: string | null;
  value: string;
};

/** Auto player-of-the-game, shaped for the SpotlightBand. */
type PlayerOfGame = {
  name: string;
  number: string | null;
  team: 'home' | 'away';
  photoUrl: string | null;
  headline: string;
  lines: Array<{ label: string; value: string }>;
} | null;

type BoardLeaders = {
  leaders?: Leader[];
  playerOfGame?: PlayerOfGame;
};

export function LeadersPanel({
  gameId,
  homeTeam,
  awayTeam,
}: {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
}) {
  // Single source of truth: the public board endpoint already computed
  // leaders + POTG server-side. Poll every few seconds so the operator
  // sees them update as the roster stats fill in / change during play.
  const { data, isLoading } = useQuery({
    queryKey: ['sports-board-leaders', gameId],
    queryFn: async (): Promise<BoardLeaders> => {
      const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!gameId,
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });

  const ctl = useGameControl(gameId);
  const leaders: Leader[] = Array.isArray(data?.leaders) ? data!.leaders! : [];
  const potg: PlayerOfGame = data?.playerOfGame ?? null;

  const teamName = (team: 'home' | 'away') =>
    team === 'away' ? awayTeam || 'Away' : homeTeam || 'Home';

  const spotlightLeader = (l: Leader) =>
    ctl.spotlight.mutate({
      visible: true,
      title: l.playerName,
      photoUrl: l.photoUrl || undefined,
      subtitle:
        [l.playerNumber ? `#${l.playerNumber}` : null, teamName(l.team)]
          .filter(Boolean)
          .join(' · ') || undefined,
      lines: [{ label: l.label, value: l.value }],
    });

  const spotlightPotg = (p: NonNullable<PlayerOfGame>) =>
    ctl.spotlight.mutate({
      visible: true,
      title: p.name,
      photoUrl: p.photoUrl || undefined,
      subtitle:
        [p.number ? `#${p.number}` : null, teamName(p.team)].filter(Boolean).join(' · ') ||
        undefined,
      lines: (p.lines || []).slice(0, 4).map((ln) => ({
        label: String(ln.label),
        value: String(ln.value),
      })),
    });

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">
        Auto-computed from the roster stats — top performer for each stat, plus a player of the
        game. Tap <strong className="font-semibold text-slate-500">Spotlight</strong> to light any
        of them up on the scoreboard and ribbon. Read-only — edit the underlying stats in the
        roster above.
      </p>

      {isLoading && leaders.length === 0 && !potg && (
        <p className="flex items-center gap-2 text-sm text-slate-400 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leaders…
        </p>
      )}

      {!isLoading && leaders.length === 0 && !potg && (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
          <Trophy className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">No leaders yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Stats appear as the roster fills in — add players and their stats above.
          </p>
        </div>
      )}

      {/* Player of the game — the headline card */}
      {potg && (
        <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-3">
            {potg.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={potg.photoUrl}
                alt=""
                className="h-14 w-14 rounded-lg object-cover bg-amber-100 ring-1 ring-amber-200 shrink-0"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
            ) : (
              <div className="h-14 w-14 rounded-lg bg-amber-100 flex items-center justify-center ring-1 ring-amber-200 shrink-0">
                <Trophy className="h-5 w-5 text-amber-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                Player of the game
              </div>
              <div className="text-sm font-bold text-slate-900 truncate">
                {potg.number ? <span className="text-amber-600">#{potg.number} </span> : null}
                {potg.name}
                <span className="ml-1.5 font-medium text-slate-400">· {teamName(potg.team)}</span>
              </div>
              <div className="text-xs text-slate-600 truncate">{potg.headline}</div>
            </div>
            <button
              type="button"
              disabled={ctl.spotlight.isPending}
              onClick={() => spotlightPotg(potg)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
              title="Spotlight this player on the scoreboard and ribbon"
            >
              <Star className="h-3.5 w-3.5" />
              Spotlight
            </button>
          </div>
        </div>
      )}

      {/* Stat leaders — one row per stat */}
      {leaders.length > 0 && (
        <div className="space-y-1.5">
          {leaders.map((l) => (
            <div
              key={l.statKey}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="w-14 shrink-0 text-center">
                <div className="text-lg font-black tabular-nums leading-none text-slate-900">
                  {l.value}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-0.5">
                  {l.label}
                </div>
              </div>
              {l.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.photoUrl}
                  alt=""
                  className="h-10 w-10 rounded-md object-cover bg-slate-100 shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              ) : (
                <div className="h-10 w-10 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                  <Star className="h-4 w-4 text-slate-300" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {l.playerNumber ? (
                    <span className="text-slate-400">#{l.playerNumber} </span>
                  ) : null}
                  {l.playerName}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{teamName(l.team)}</div>
              </div>
              <button
                type="button"
                disabled={ctl.spotlight.isPending}
                onClick={() => spotlightLeader(l)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                title="Spotlight this player on the scoreboard and ribbon"
              >
                <Star className="h-3.5 w-3.5" />
                Spotlight
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
