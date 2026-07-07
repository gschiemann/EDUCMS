'use client';

/**
 * Public athlete stats page (player-stats S1, 2026-06-22).
 *
 * The "so a parent can see their kid's stats after the game" surface. PUBLIC +
 * unauthed — reached by an unguessable share token the operator hands out
 * (text/email/social), exactly like the public /board and /ribbon routes. The
 * API 404s unless the operator opted this athlete into sharing (isPublic), so
 * a minor is never exposed by default and there is no person-id enumeration.
 * Renders career totals, season-by-season, and a recent game log. Mobile-first
 * (parents open it on a phone).
 */
import { use, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-url';

interface StatLine {
  sport: string;
  statKey: string;
  statValue: number;
  displayValue: string | null;
  gamesPlayed: number;
}
interface SeasonLine extends StatLine {
  season: string;
}
interface GameLogEntry {
  gameId: string;
  date: string | null;
  sport: string;
  opponent: string;
  homeAway: 'home' | 'away';
  teamScore: number | null;
  opponentScore: number | null;
  result: 'W' | 'L' | 'T' | null;
  stats: Record<string, string>;
}
interface Profile {
  fullName: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  gradYear: number | null;
  teamName: string | null;
  career: StatLine[];
  season: SeasonLine[];
  gameLog: GameLogEntry[];
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** Sport keys are stored lowercase/snake_case (e.g. "water_polo"); label them. */
const fmtSport = (sport: string) =>
  sport
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/** Distinct sports present in a set of stat lines, in first-seen order. */
const sportsOf = (lines: { sport: string }[]) => [...new Set(lines.map((l) => l.sport))];

export default function AthletePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<'loading' | 'notfound' | 'error' | 'ok'>('loading');
  const [p, setP] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/athletes/${token}`, { cache: 'no-store' });
        if (!alive) return;
        if (res.status === 404) return setState('notfound');
        if (!res.ok) return setState('error');
        const data = (await res.json()) as Profile;
        if (!alive) return;
        setP(data);
        setState('ok');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <main className="min-h-dvh grid place-items-center bg-slate-50 text-slate-400 text-sm">
        Loading stats…
      </main>
    );
  }
  if (state === 'notfound') {
    return (
      <main className="min-h-dvh grid place-items-center bg-slate-50 px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-slate-800">Stats not available</p>
          <p className="mt-1 text-sm text-slate-500">
            This athlete profile isn’t shared (or the link was turned off).
          </p>
        </div>
      </main>
    );
  }
  if (state === 'error' || !p) {
    return (
      <main className="min-h-dvh grid place-items-center bg-slate-50 px-6 text-center">
        <p className="text-sm text-slate-500">Couldn’t load these stats. Try again in a moment.</p>
      </main>
    );
  }

  const seasons = [...new Set(p.season.map((s) => s.season))].sort().reverse();
  // Only disambiguate by sport when the athlete actually plays >1 sport —
  // single-sport athletes (the common case) render exactly as before, no
  // noisy labels. Stat codes collide across sports (soccer 'G' goals vs
  // basketball 'G' games), so a two-sport athlete needs the sport shown.
  const careerSports = sportsOf(p.career);
  const multiSport = new Set([...p.career, ...p.season].map((l) => l.sport)).size > 1;

  // A career stat tile — shared by the flat and grouped layouts.
  const careerTile = (c: StatLine) => (
    <div key={`${c.sport}-${c.statKey}`} className="rounded-xl bg-white border border-slate-200 px-3 py-3 text-center">
      <div className="text-2xl font-black text-slate-900 tabular-nums leading-none">
        {c.displayValue ?? c.statValue}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{c.statKey}</div>
    </div>
  );

  return (
    <main className="min-h-dvh bg-slate-50 pb-16">
      {/* Hero */}
      <header className="bg-slate-900 text-white px-5 pt-8 pb-7">
        <div className="mx-auto max-w-2xl flex items-center gap-4">
          {p.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photoUrl} alt="" className="h-20 w-20 rounded-2xl object-cover bg-slate-700" />
          ) : (
            <div className="h-20 w-20 rounded-2xl bg-slate-700 grid place-items-center text-3xl font-black text-slate-300">
              {p.number || p.fullName.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-black truncate">{p.fullName}</h1>
            <p className="text-sm text-slate-300">
              {[p.number ? `#${p.number}` : null, p.position, p.teamName, p.gradYear ? `Class of ${p.gradYear}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4">
        {/* Career totals */}
        <section className="mt-5">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Career</h2>
          {p.career.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 py-5 text-center text-sm text-slate-400">
              No career stats logged yet.
            </p>
          ) : multiSport ? (
            // Multi-sport: group tiles under a small sport heading so a
            // parent can tell soccer goals from basketball games.
            <div className="space-y-4">
              {careerSports.map((sport) => (
                <div key={sport}>
                  <h3 className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {fmtSport(sport)}
                  </h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {p.career.filter((c) => c.sport === sport).map(careerTile)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{p.career.map(careerTile)}</div>
          )}
        </section>

        {/* Season-by-season */}
        {seasons.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">By season</h2>
            <div className="space-y-3">
              {seasons.map((sn) => {
                const rows = p.season.filter((s) => s.season === sn);
                const seasonSports = sportsOf(rows);
                const statSpan = (r: SeasonLine) => (
                  <span key={`${r.sport}-${r.statKey}`} className="text-sm tabular-nums">
                    <span className="font-black text-slate-900">{r.displayValue ?? r.statValue}</span>{' '}
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{r.statKey}</span>
                  </span>
                );
                return (
                  <div key={sn} className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 text-sm font-bold text-slate-700 border-b border-slate-100">{sn}</div>
                    {multiSport && seasonSports.length > 1 ? (
                      // Multiple sports in one season → one stat row per sport,
                      // each tagged, so identical codes stay distinguishable.
                      <div className="divide-y divide-slate-100">
                        {seasonSports.map((sport) => (
                          <div key={sport} className="px-3 py-2.5">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                              {fmtSport(sport)}
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                              {rows.filter((r) => r.sport === sport).map(statSpan)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-3 py-2.5">{rows.map(statSpan)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Game log */}
        {p.gameLog.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Recent games</h2>
            <div className="space-y-2">
              {p.gameLog.map((g) => {
                const resColor =
                  g.result === 'W' ? 'text-emerald-600' : g.result === 'L' ? 'text-red-600' : 'text-slate-500';
                const topStats = Object.entries(g.stats).slice(0, 4);
                return (
                  <div key={g.gameId} className="rounded-xl bg-white border border-slate-200 px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">
                          {g.homeAway === 'home' ? 'vs' : '@'} {g.opponent || '—'}
                        </div>
                        <div className="text-[11px] text-slate-400">{fmtDate(g.date)}</div>
                      </div>
                      {g.result && (
                        <div className={`text-sm font-black tabular-nums ${resColor}`}>
                          {g.result} {g.teamScore}–{g.opponentScore}
                        </div>
                      )}
                    </div>
                    {topStats.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                        {topStats.map(([k, v]) => (
                          <span key={k} className="text-xs tabular-nums">
                            <span className="font-bold text-slate-700">{v}</span>{' '}
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <footer className="mt-10 text-center text-[11px] text-slate-400">Powered by VenueOS</footer>
      </div>
    </main>
  );
}
