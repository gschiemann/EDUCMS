'use client';

/**
 * VenueOS Sports — the PUBLIC scorekeeper pad (Phase-2 Domain SHARE).
 *
 * A student/volunteer opens /console/<token> from a link or QR the
 * operator minted in the game console and gets LIMITED live-game
 * controls — score, clock, segment, timeouts, celebration cues — with no
 * tenant account. The limits are enforced SERVER-side: every tap hits the
 * public SportsConsoleController, whose explicit allowlist + game-scoped
 * HMAC token (versioned + always-expiring) is the security boundary; this
 * page is just the friendly face.
 *
 * Reads ride the PUBLIC board endpoint via the shared hardened poll
 * engine (startBoardPoll — self-chaining, ETag/304, jittered backoff).
 * Mutations are plain fetch (no auth session exists — the token in the
 * path IS the credential). A 401 anywhere flips to the full-screen
 * "link revoked/expired" message.
 *
 * Mobile perf standard: solid backgrounds only (no backdrop-blur — this
 * is always-mounted phone chrome), and NOTHING runs while the tab is
 * hidden — the board poll AND the local clock ticker both stop on
 * visibilitychange and resume (with a fresh poll) on return.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { startBoardPoll } from '@/lib/board-poll';
import { findSport, formatScore } from '@cms/api-types';
import {
  consoleTokenGameId,
  padIncrements,
  projectClockMs,
  fmtPadClock,
  parsePadClock,
  sportHasTeamTimeouts,
  type PadClockAnchor,
} from '@/lib/console-share';

/** The slice of the public board payload the pad renders. */
interface PadData {
  sport: string;
  status: string;
  segment: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeColor?: string | null;
  awayColor?: string | null;
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string | null;
  serverTime: number;
  stats?: Record<string, unknown> | null;
}

type SessionState = 'checking' | 'ok' | 'revoked' | 'offline';

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export default function ScorekeeperPadPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const gameId = useMemo(() => consoleTokenGameId(token), [token]);

  const [session, setSession] = useState<SessionState>('checking');
  const [data, setData] = useState<PadData | null>(null);
  // Local receive-time sample paired with the payload's serverTime — the
  // skew term of the clock projection (see console-share.projectClockMs).
  const anchorRef = useRef<PadClockAnchor | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [clockEdit, setClockEdit] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const def = findSport(data?.sport);
  const increments = padIncrements(def);

  // ── session probe: is this link alive? ─────────────────────────
  useEffect(() => {
    if (!token || !gameId) {
      setSession('revoked');
      return;
    }
    let alive = true;
    fetch(`${API_URL}/sports/console/${encodeURIComponent(token)}/session`, { cache: 'no-store' })
      .then((res) => {
        if (!alive) return;
        if (res.status === 401) setSession('revoked');
        else if (res.ok) setSession('ok');
        else setSession('offline');
      })
      .catch(() => {
        if (alive) setSession('offline');
      });
    return () => {
      alive = false;
    };
  }, [token, gameId]);

  // ── board state poll — only while the session is live AND the tab is
  //    visible (mobile perf: a pocketed phone runs zero timers). ──────
  useEffect(() => {
    if (session !== 'ok' || !gameId) return;
    let stop: (() => void) | null = null;
    const startIfVisible = () => {
      if (document.visibilityState === 'hidden' || stop) return;
      stop = startBoardPoll({
        url: `${API_URL}/sports/board/${gameId}`,
        intervalMs: 750,
        onPayload: (payload) => {
          const p = payload as Partial<PadData> & { serverTime?: number };
          const receivedAt = Date.now();
          const next: PadData = {
            sport: String(p.sport || ''),
            status: String(p.status || ''),
            segment: num(p.segment, 1),
            homeTeam: String(p.homeTeam || 'HOME'),
            awayTeam: String(p.awayTeam || 'AWAY'),
            homeScore: num(p.homeScore, 0),
            awayScore: num(p.awayScore, 0),
            homeColor: (p.homeColor as string) || null,
            awayColor: (p.awayColor as string) || null,
            clockMs: num(p.clockMs, 0),
            clockRunning: p.clockRunning === true,
            clockUpdatedAt: typeof p.clockUpdatedAt === 'string' ? p.clockUpdatedAt : null,
            serverTime: num(p.serverTime, receivedAt),
            stats:
              p.stats && typeof p.stats === 'object'
                ? (p.stats as Record<string, unknown>)
                : null,
          };
          anchorRef.current = {
            clockMs: next.clockMs,
            clockRunning: next.clockRunning,
            clockUpdatedAt: next.clockUpdatedAt,
            serverTime: next.serverTime,
            receivedAt,
          };
          setData(next);
        },
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (stop) {
          stop();
          stop = null;
        }
      } else {
        startIfVisible();
      }
    };
    startIfVisible();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (stop) stop();
    };
  }, [session, gameId]);

  // ── local clock tick (250ms, visible-only, running-clock-only) ──
  useEffect(() => {
    const tick = () => {
      const a = anchorRef.current;
      if (!a || !def) return;
      setClockNow(projectClockMs(a, def.clock.type, Date.now()));
    };
    tick();
    if (!data?.clockRunning || !def || def.clock.type === 'none') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer === null && document.visibilityState !== 'hidden') {
        timer = setInterval(tick, 250);
      }
    };
    const disarm = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? disarm() : arm());
    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      disarm();
    };
  }, [data?.clockRunning, data?.clockMs, data?.clockUpdatedAt, def]);

  // ── mutations — plain fetch; the token in the path is the auth ──
  const send = useCallback(
    async (path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>) => {
      if (!token) return null;
      setBusy(true);
      try {
        const res = await fetch(
          `${API_URL}/sports/console/${encodeURIComponent(token)}${path}`,
          {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (res.status === 401) {
          setSession('revoked');
          return null;
        }
        if (!res.ok) {
          setFlash(res.status === 429 ? 'Slow down — too many taps' : 'That didn’t go through');
          return null;
        }
        const json = await res.json().catch(() => null);
        // Snappy feedback: fold the server's post-write scores/segment into
        // local state now; the 750ms poll reconciles everything else.
        if (json && typeof json === 'object') {
          const j = json as Record<string, unknown>;
          setData((cur) =>
            cur
              ? {
                  ...cur,
                  homeScore: num(j.homeScore, cur.homeScore),
                  awayScore: num(j.awayScore, cur.awayScore),
                  segment: num(j.segment, cur.segment),
                }
              : cur,
          );
        }
        return json;
      } catch {
        setFlash('No connection — tap didn’t send');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  // Transient error strip auto-clear.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // ── full-screen terminal states ────────────────────────────────
  if (session === 'revoked') {
    return (
      <Shell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl">🔒</div>
          <h1 className="mt-4 text-xl font-black text-white">This scorekeeper link is no longer active</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-400">
            It may have expired or been revoked by the game operator. Ask them
            to send you a fresh link from the game console.
          </p>
        </div>
      </Shell>
    );
  }
  if (session === 'offline') {
    return (
      <Shell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl">📡</div>
          <h1 className="mt-4 text-xl font-black text-white">Can&apos;t reach the server</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-400">
            Check your connection and reload this page.
          </p>
        </div>
      </Shell>
    );
  }
  if (session === 'checking' || !data) {
    return (
      <Shell>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="text-sm font-bold uppercase tracking-widest text-slate-500">
            Connecting&hellip;
          </div>
        </div>
      </Shell>
    );
  }

  const live = data.status === 'LIVE';
  const segName = def?.segment?.name || 'Period';
  const homeTimeouts = num(data.stats?.homeTimeouts, NaN);
  const awayTimeouts = num(data.stats?.awayTimeouts, NaN);
  // T.O. buttons only for sports that DEFINE team-timeout stats (football /
  // basketball / water polo) — anywhere else the server rejects /timeout.
  const hasTimeouts = sportHasTeamTimeouts(def);
  const hasClock = !!def && def.clock.type !== 'none';
  const cues = (def?.celebrations || []).slice(0, 8);

  return (
    <Shell>
      {/* header — game identity + the honesty label */}
      <header className="px-4 pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 truncate text-sm font-black text-white">
            {data.homeTeam} <span className="text-slate-500">vs</span> {data.awayTeam}
          </div>
          <span
            className={`ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${
              live ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-200'
            }`}
          >
            {live ? 'LIVE' : data.status || 'GAME'}
          </span>
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          Scorekeeper link — limited controls
        </div>
      </header>

      {flash && (
        <div className="mx-4 mb-1 rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-bold text-white" role="status">
          {flash}
        </div>
      )}

      {/* scoreboard + clock strip */}
      <section className="mx-4 rounded-2xl bg-slate-900 p-4">
        <div className="flex items-stretch justify-between">
          <ScoreCol
            label={data.homeTeam}
            color={data.homeColor || '#38bdf8'}
            score={formatScore(def, data.homeScore)}
          />
          <div className="flex flex-col items-center justify-center px-2">
            {hasClock && (
              <div className="font-mono text-3xl font-black tabular-nums text-white">
                {fmtPadClock(clockNow)}
              </div>
            )}
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {segName} {data.segment}
            </div>
          </div>
          <ScoreCol
            label={data.awayTeam}
            color={data.awayColor || '#f472b6'}
            score={formatScore(def, data.awayScore)}
          />
        </div>
      </section>

      {/* score pads — hidden for judged/leaderboard sports (empty increments,
          same rule as the operator console's quick-score section) */}
      {increments.length > 0 && (
        <section className="mx-4 mt-3 grid grid-cols-2 gap-3">
          <PadCol
            team="home"
            label={data.homeTeam}
            color={data.homeColor || '#38bdf8'}
            increments={increments}
            busy={busy}
            onDelta={(delta) => send('/score', 'PATCH', { team: 'home', delta })}
          />
          <PadCol
            team="away"
            label={data.awayTeam}
            color={data.awayColor || '#f472b6'}
            increments={increments}
            busy={busy}
            onDelta={(delta) => send('/score', 'PATCH', { team: 'away', delta })}
          />
        </section>
      )}

      {/* clock controls */}
      {hasClock && (
        <section className="mx-4 mt-3 rounded-2xl bg-slate-900 p-3">
          <div className="flex items-center">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                send('/clock', 'PATCH', { action: data.clockRunning ? 'pause' : 'start' })
              }
              className={`min-h-[56px] flex-1 rounded-xl text-base font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40 ${
                data.clockRunning ? 'bg-red-600' : 'bg-emerald-600'
              }`}
            >
              {data.clockRunning ? 'Stop clock' : 'Start clock'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setClockEdit(clockEdit === null ? fmtPadClock(clockNow) : null)}
              className="ml-3 min-h-[56px] rounded-xl bg-slate-700 px-4 text-sm font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40"
            >
              Set
            </button>
          </div>
          {clockEdit !== null && (
            <div className="mt-3 flex items-center">
              <input
                value={clockEdit}
                onChange={(e) => setClockEdit(e.target.value)}
                inputMode="numeric"
                placeholder="12:00"
                aria-label={`Set clock (m:ss)`}
                className="min-h-[48px] w-28 rounded-lg border border-slate-600 bg-slate-800 px-3 text-center font-mono text-lg font-bold text-white"
              />
              <button
                type="button"
                disabled={busy || parsePadClock(clockEdit) === null}
                onClick={() => {
                  const ms = parsePadClock(clockEdit);
                  if (ms !== null) {
                    send('/clock', 'PATCH', { action: 'set', ms });
                    setClockEdit(null);
                  }
                }}
                className="ml-3 min-h-[48px] flex-1 rounded-lg bg-sky-600 text-sm font-black uppercase tracking-wide text-white disabled:opacity-40"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setClockEdit(null)}
                className="ml-2 min-h-[48px] rounded-lg bg-slate-700 px-3 text-sm font-bold text-slate-200"
              >
                ✕
              </button>
            </div>
          )}
        </section>
      )}

      {/* segment + timeouts (T.O. only for sports that define them) */}
      <section className={`mx-4 mt-3 grid gap-3 ${hasTimeouts ? 'grid-cols-3' : 'grid-cols-1'}`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => send('/segment', 'PATCH', { delta: 1 })}
          className="min-h-[56px] rounded-xl bg-slate-800 text-[13px] font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40"
        >
          Next {segName}
        </button>
        {hasTimeouts && (
          <button
            type="button"
            disabled={busy}
            onClick={() => send('/timeout', 'POST', { team: 'home' })}
            className="min-h-[56px] rounded-xl bg-slate-800 text-[13px] font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40"
          >
            Home T.O.{isFinite(homeTimeouts) ? ` (${homeTimeouts})` : ''}
          </button>
        )}
        {hasTimeouts && (
          <button
            type="button"
            disabled={busy}
            onClick={() => send('/timeout', 'POST', { team: 'away' })}
            className="min-h-[56px] rounded-xl bg-slate-800 text-[13px] font-black uppercase tracking-wide text-white active:opacity-80 disabled:opacity-40"
          >
            Away T.O.{isFinite(awayTimeouts) ? ` (${awayTimeouts})` : ''}
          </button>
        )}
      </section>

      {/* celebration cue row */}
      {cues.length > 0 && (
        <section className="mx-4 mt-3 pb-8">
          <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
            Celebrations
          </div>
          <div className="grid grid-cols-4 gap-2">
            {cues.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={busy}
                onClick={() => send('/cue', 'POST', { key: c.key })}
                className="min-h-[64px] rounded-xl bg-slate-900 px-1 text-center active:opacity-80 disabled:opacity-40"
              >
                <div className="text-xl">{c.emoji}</div>
                <div className="mt-0.5 text-[10px] font-bold leading-tight text-slate-300">
                  {c.label}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}

/** Solid dark shell — no backdrop-blur anywhere (mobile perf standard). */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-950 pb-6">{children}</div>;
}

function ScoreCol({ label, color, score }: { label: string; color: string; score: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <div
        className="max-w-full truncate text-[12px] font-black uppercase tracking-wider"
        style={{ color }}
      >
        {label}
      </div>
      <div className="mt-1 font-mono text-5xl font-black tabular-nums text-white">{score}</div>
    </div>
  );
}

function PadCol({
  team,
  label,
  color,
  increments,
  busy,
  onDelta,
}: {
  team: 'home' | 'away';
  label: string;
  color: string;
  increments: number[];
  busy: boolean;
  onDelta: (delta: number) => void;
}) {
  return (
    <div className="rounded-2xl bg-slate-900 p-3">
      <div className="mb-2 truncate text-center text-[11px] font-black uppercase tracking-wider" style={{ color }}>
        {label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {increments.map((inc) => (
          <button
            key={`${team}-${inc}`}
            type="button"
            disabled={busy}
            onClick={() => onDelta(inc)}
            className="min-h-[56px] rounded-xl bg-slate-800 text-xl font-black text-white active:opacity-80 disabled:opacity-40"
          >
            +{inc}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelta(-1)}
          className="min-h-[56px] rounded-xl bg-slate-800/60 text-xl font-black text-slate-400 active:opacity-80 disabled:opacity-40"
          aria-label={`${label} minus 1 (correction)`}
        >
          −1
        </button>
      </div>
    </div>
  );
}
