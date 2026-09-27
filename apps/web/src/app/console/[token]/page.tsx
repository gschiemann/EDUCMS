'use client';

/**
 * VenueOS Sports — the PUBLIC scorekeeper pad (Phase-2 Domain SHARE;
 * rebuilt for the K-12 launch program, register row K12-F16).
 *
 * A student/volunteer opens /console/<token> from a link or QR the operator
 * minted in the game console and gets the controls THEIR ROLE allows — no
 * tenant account. The limits are enforced SERVER-side: every tap hits the
 * public SportsConsoleController, whose allowlist + game-scoped HMAC token
 * (versioned, always expiring, with the role inside the MAC) is the security
 * boundary; this page is the friendly face and renders from the capability
 * list the server's /session answers with.
 *
 *   Scorer's table  — everything a volunteer can do
 *   Scorekeeper     — score, timeouts, team stats, possession, penalties, cues
 *   Clock operator  — game clock, period, timeouts
 *   Shot / play clock operator — that clock only
 *   (pre-role link) — the original five controls
 *
 * CONNECTION TRUTH (lib/console-pad-link). The audit found this pad still
 * showing a red "LIVE" after 11 seconds of failed board reads, with no
 * warning. Now: "LIVE" only while the last good read is fresh; a stalled
 * read stream becomes a PERSISTENT "connection lost" banner and the controls
 * pause (a tap against a picture you cannot see is how a wrong score reaches
 * the board); when reads return the volunteer confirms the fresh score before
 * the controls work again. Every tap shows while it is being sent, and one
 * that does not land stays on screen, named, until dismissed.
 *
 * Reads ride the PUBLIC board endpoint via the shared hardened poll engine
 * (startBoardPoll — self-chaining, ETag/304, jittered backoff); a 304 still
 * refreshes the clock-skew sample. Mutations are plain fetch (the token in
 * the path IS the credential), one at a time. A 401 anywhere flips to the
 * full-screen "link revoked/expired" message.
 *
 * Mobile perf standard: solid backgrounds only (no backdrop-blur), and
 * NOTHING runs while the tab is hidden — the board poll, the clock ticker
 * and the connection ticker all stop on visibilitychange and resume (with a
 * fresh poll) on return.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_URL } from '@/lib/api-url';
import { startBoardPoll } from '@/lib/board-poll';
import {
  CONSOLE_CAPABILITIES,
  consoleCapabilities,
  findSport,
  formatScore,
  isConsoleRole,
  type ConsoleCapability,
  type ConsoleRole,
} from '@cms/api-types';
import {
  consoleTokenGameId,
  padIncrements,
  projectClockMs,
  fmtPadClock,
  fmtSubClockSec,
  projectSubClockMs,
  readSubClock,
  type PadClockAnchor,
} from '@/lib/console-share';
import {
  classifyPadFailure,
  initialPadLink,
  padChip,
  padControlsEnabled,
  padLinkReducer,
  padSecondsSinceGood,
  pushRejected,
  type PadFailure,
  type PadRejectedCommand,
} from '@/lib/console-pad-link';
import {
  PadClockSection,
  PadCueSection,
  PadGameStatsSection,
  PadPenaltySection,
  PadPlayClockSection,
  PadPossessionSection,
  PadSegmentSection,
  PadShotClockSection,
  PadTeamSection,
  type PadSend,
  type PadStep,
} from './PadSections';

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
  possession: string;
  stats: Record<string, unknown>;
}

type SessionState = 'checking' | 'ok' | 'revoked' | 'offline';

/** Catalog key per failure class (lib/console-pad-link classifyPadFailure). */
const FAILURE_KEY: Record<PadFailure, string> = {
  offline: 'failedOffline',
  'not-permitted': 'failedNotPermitted',
  'rate-limited': 'failedRateLimited',
  refused: 'failedRefused',
  server: 'failedServer',
};

interface Access {
  role: ConsoleRole | null;
  capabilities: ConsoleCapability[];
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** Fold the fields a console response carries (the updated game row) into
 *  the local picture; anything absent keeps its current value. The next
 *  board poll reconciles everything else. */
function foldResponse(cur: PadData, j: Record<string, unknown>): PadData {
  return {
    ...cur,
    homeScore: num(j.homeScore, cur.homeScore),
    awayScore: num(j.awayScore, cur.awayScore),
    segment: num(j.segment, cur.segment),
    status: typeof j.status === 'string' ? j.status : cur.status,
    clockMs: num(j.clockMs, cur.clockMs),
    clockRunning: typeof j.clockRunning === 'boolean' ? j.clockRunning : cur.clockRunning,
    clockUpdatedAt: typeof j.clockUpdatedAt === 'string' ? j.clockUpdatedAt : cur.clockUpdatedAt,
    possession: typeof j.possession === 'string' ? j.possession : cur.possession,
    stats: j.stats && typeof j.stats === 'object' ? (j.stats as Record<string, unknown>) : cur.stats,
  };
}

export default function ScorekeeperPadPage() {
  const t = useTranslations('sportsPad');
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const gameId = useMemo(() => consoleTokenGameId(token), [token]);

  const [session, setSession] = useState<SessionState>('checking');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [access, setAccess] = useState<Access | null>(null);
  const [data, setData] = useState<PadData | null>(null);
  // Local receive-time sample paired with the payload's serverTime — the
  // skew term of every clock projection (see console-share.projectClockMs).
  const anchorRef = useRef<PadClockAnchor | null>(null);
  const [link, dispatchLink] = useReducer(padLinkReducer, 0, () => initialPadLink(Date.now()));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [rejected, setRejected] = useState<PadRejectedCommand[]>([]);
  const rejectSeq = useRef(0);

  const def = findSport(data?.sport);
  const increments = padIncrements(def);

  // ── session probe: is this link alive, and what may it do? ──────
  useEffect(() => {
    if (!token || !gameId) {
      setSession('revoked');
      return;
    }
    let alive = true;
    setSession('checking');
    fetch(`${API_URL}/sports/console/${encodeURIComponent(token)}/session`, { cache: 'no-store' })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 401) {
          setSession('revoked');
          return;
        }
        if (!res.ok) {
          setSession('offline');
          return;
        }
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!alive) return;
        const role = isConsoleRole(j.role) ? j.role : null;
        // An API from before role links sends no capability list: fall back
        // to the pre-role allowlist for this sport (the server re-checks
        // every tap either way).
        const caps = Array.isArray(j.capabilities)
          ? (j.capabilities as unknown[]).filter((c): c is ConsoleCapability =>
              (CONSOLE_CAPABILITIES as readonly string[]).indexOf(String(c)) !== -1,
            )
          : consoleCapabilities(null, findSport(typeof j.sport === 'string' ? j.sport : ''));
        setAccess({ role, capabilities: caps });
        setSession('ok');
      })
      .catch(() => {
        if (alive) setSession('offline');
      });
    return () => {
      alive = false;
    };
  }, [token, gameId, sessionAttempt]);

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
            possession:
              typeof p.possession === 'string'
                ? p.possession
                : p.stats && typeof (p.stats as Record<string, unknown>).possession === 'string'
                  ? String((p.stats as Record<string, unknown>).possession)
                  : '',
            stats: p.stats && typeof p.stats === 'object' ? (p.stats as Record<string, unknown>) : {},
          };
          anchorRef.current = {
            clockMs: next.clockMs,
            clockRunning: next.clockRunning,
            clockUpdatedAt: next.clockUpdatedAt,
            serverTime: next.serverTime,
            receivedAt,
          };
          setData(next);
          dispatchLink({ type: 'good', at: receivedAt });
        },
        // 304 — nothing changed, but the server clock sample is fresh:
        // keep the skew honest (board parity) and count it as a good read.
        onServerTime: (serverTime) => {
          const receivedAt = Date.now();
          if (anchorRef.current) anchorRef.current = { ...anchorRef.current, serverTime, receivedAt };
          dispatchLink({ type: 'good', at: receivedAt });
        },
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (stop) {
          stop();
          stop = null;
        }
        dispatchLink({ type: 'hidden', at: Date.now() });
      } else {
        dispatchLink({ type: 'visible', at: Date.now() });
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

  // ── the 1 s connection ticker (visible-only) — decides "lost" and keeps
  //    the "last update N s ago" copy honest. ──────────────────────────
  useEffect(() => {
    if (session !== 'ok') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const at = Date.now();
      dispatchLink({ type: 'tick', at, browserOffline: navigator.onLine === false });
      setNowMs(at);
    };
    const arm = () => {
      if (timer === null && document.visibilityState !== 'hidden') timer = setInterval(tick, 1000);
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
  }, [session]);

  // ── the fast clock ticker: 250 ms, only while something is running, the
  //    picture is FRESH and the tab is visible. While the picture is stale
  //    (lost, or waiting after a return) the clocks FREEZE at their last
  //    known reading — projecting a running clock we can no longer see would
  //    be a guess. In `resync` the reads are back, so the picture is fresh
  //    and ticks; only the controls wait for the volunteer's confirmation. ─
  const live = link.phase === 'live' || link.phase === 'resync';
  const subRunning = !!(
    (data?.stats?.shotClock as Record<string, unknown> | undefined)?.running ||
    (data?.stats?.playClock as Record<string, unknown> | undefined)?.running ||
    (Array.isArray(data?.stats?.penalties) && (data?.stats?.penalties as Record<string, unknown>[]).some((p) => p && p.running))
  );
  const anyRunning = !!data && (data.clockRunning || subRunning);
  useEffect(() => {
    if (!live || !anyRunning) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer === null && document.visibilityState !== 'hidden') {
        timer = setInterval(() => setNowMs(Date.now()), 250);
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
  }, [live, anyRunning]);

  // Frozen "now" while not live: the projection stops at the last good read.
  const projectAt = live ? nowMs : (link.lastGoodAt ?? nowMs);
  const skewMs = anchorRef.current ? anchorRef.current.serverTime - anchorRef.current.receivedAt : 0;
  const clockNow =
    anchorRef.current && def ? projectClockMs(anchorRef.current, def.clock.type, projectAt) : data?.clockMs ?? 0;

  // ── commands: one at a time, only against a live picture ─────────
  const send = useCallback<PadSend>(
    (label, path, method, body, next) => {
      if (!token || pendingRef.current) return;
      pendingRef.current = true;
      setPending(label);
      const fail = (failure: PadFailure) => {
        rejectSeq.current += 1;
        const id = rejectSeq.current;
        setRejected((list) => pushRejected(list, { id, label, failure, at: Date.now() }));
      };
      const run = async (step: PadStep): Promise<boolean> => {
        let res: Response;
        try {
          res = await fetch(`${API_URL}/sports/console/${encodeURIComponent(token)}${step.path}`, {
            method: step.method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(step.body),
          });
        } catch {
          fail(classifyPadFailure(null));
          return false;
        }
        if (res.status === 401) {
          setSession('revoked');
          return false;
        }
        if (!res.ok) {
          fail(classifyPadFailure(res.status));
          return false;
        }
        const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (json && typeof json === 'object') setData((cur) => (cur ? foldResponse(cur, json) : cur));
        return true;
      };
      void (async () => {
        try {
          const ok = await run({ path, method, body });
          if (ok && next) await run(next);
        } finally {
          pendingRef.current = false;
          setPending(null);
        }
      })();
    },
    [token],
  );

  // ── full-screen terminal states ────────────────────────────────
  if (session === 'revoked') {
    return (
      <Shell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl" aria-hidden>🔒</div>
          <h1 className="mt-4 text-xl font-black text-white">{t('revokedTitle')}</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-400">{t('revokedBody')}</p>
        </div>
      </Shell>
    );
  }
  if (session === 'offline') {
    return (
      <Shell>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl" aria-hidden>📡</div>
          <h1 className="mt-4 text-xl font-black text-white">{t('offlineTitle')}</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-400">{t('offlineBody')}</p>
          <button
            type="button"
            onClick={() => setSessionAttempt((n) => n + 1)}
            className="mt-5 min-h-[48px] rounded-xl bg-sky-600 px-6 text-sm font-black uppercase tracking-wide text-white"
          >
            {t('retry')}
          </button>
        </div>
      </Shell>
    );
  }
  if (session === 'checking' || !data || !access) {
    return (
      <Shell>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="text-sm font-bold uppercase tracking-widest text-slate-500" role="status">
            {t('connecting')}
          </div>
        </div>
      </Shell>
    );
  }

  const caps = new Set(access.capabilities);
  const final = data.status === 'FINAL';
  const controlsOn = padControlsEnabled(link) && !final;
  const disabled = !controlsOn || pending !== null;
  const segName = def?.segment?.name || t('periodFallback');
  const homeColor = data.homeColor || '#38bdf8';
  const awayColor = data.awayColor || '#f472b6';
  const hasClock = !!def && def.clock.type !== 'none';
  const chip = padChip(link, data.status);
  const since = padSecondsSinceGood(link, nowMs);
  const roleKey = access.role
    ? access.role === 'shot' && def?.key === 'football'
      ? 'rolePlay'
      : `role.${access.role}`
    : 'role.legacy';
  const shotSc = def?.shotClock ? readSubClock(data.stats.shotClock) : null;
  const playSc = def?.key === 'football' ? readSubClock(data.stats.playClock) : null;

  return (
    <Shell>
      {/* header — game identity, the connection-aware chip, the link's role */}
      <header className="px-4 pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 truncate text-sm font-black text-white">
            {data.homeTeam} <span className="text-slate-500">{t('vs')}</span> {data.awayTeam}
          </div>
          <span
            data-testid="pad-chip"
            data-chip={chip}
            className={`ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${
              chip === 'live-game'
                ? 'bg-red-600 text-white'
                : chip === 'lost'
                  ? 'bg-amber-400 text-slate-950'
                  : chip === 'resync'
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-slate-700 text-slate-200'
            }`}
          >
            {chip === 'live-game'
              ? t('chipLive')
              : chip === 'game-status'
                ? t.has(`status.${data.status}`) ? t(`status.${data.status}`) : data.status || t('chipGame')
                : chip === 'lost'
                  ? t('chipLost')
                  : chip === 'resync'
                    ? t('chipResync')
                    : chip === 'paused'
                      ? t('chipPaused')
                      : t('chipConnecting')}
          </span>
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-amber-400" data-testid="pad-role">
          {t(roleKey)}
        </div>
      </header>

      {/* PERSISTENT connection state — never a toast. */}
      <div aria-live="polite" role="status">
        {link.phase === 'lost' && (
          <div data-testid="pad-lost" className="mx-4 mb-2 rounded-xl border-2 border-amber-400 bg-amber-950 px-3 py-2.5 text-amber-50">
            <div className="text-sm font-black uppercase tracking-wide">{t('lostTitle')}</div>
            <p className="mt-1 text-[13px] font-semibold">
              {since === null ? t('lostNeverBody') : t('lostBody', { seconds: since })}
            </p>
          </div>
        )}
        {link.phase === 'resync' && (
          <div data-testid="pad-resync" className="mx-4 mb-2 rounded-xl border-2 border-sky-400 bg-sky-950 px-3 py-2.5 text-sky-50">
            <div className="text-sm font-black uppercase tracking-wide">{t('resyncTitle')}</div>
            <p className="mt-1 text-[13px] font-semibold">{t('resyncBody')}</p>
            <button
              type="button"
              onClick={() => dispatchLink({ type: 'confirm', at: Date.now() })}
              className="mt-2 min-h-[48px] w-full rounded-xl bg-sky-500 text-sm font-black uppercase tracking-wide text-slate-950"
            >
              {t('resyncConfirm')}
            </button>
          </div>
        )}
        {link.phase === 'connecting' && link.lastGoodAt !== null && (
          <div className="mx-4 mb-2 rounded-xl bg-slate-800 px-3 py-2 text-[13px] font-bold text-slate-200">
            {t('refreshing')}
          </div>
        )}
        {final && link.phase === 'live' && (
          <div className="mx-4 mb-2 rounded-xl bg-slate-800 px-3 py-2 text-[13px] font-bold text-slate-200">
            {t('finalBody')}
          </div>
        )}
        {pending && (
          <div data-testid="pad-pending" className="mx-4 mb-2 rounded-xl bg-slate-800 px-3 py-2 text-[13px] font-bold text-slate-200">
            {t('sending', { label: pending })}
          </div>
        )}
      </div>

      {/* Commands that did not land — kept until dismissed. */}
      {rejected.length > 0 && (
        <ul data-testid="pad-rejected" className="mx-4 mb-2 space-y-2" aria-live="assertive">
          {rejected.map((r) => (
            <li key={r.id} className="flex items-start gap-2 rounded-xl bg-red-700 px-3 py-2 text-white">
              <p className="min-w-0 flex-1 text-[13px] font-bold">
                {t(FAILURE_KEY[r.failure], { label: r.label })}
              </p>
              <button
                type="button"
                onClick={() => setRejected((list) => list.filter((x) => x.id !== r.id))}
                aria-label={t('dismiss')}
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-red-900 text-sm font-black"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* scoreboard strip — what the pad last saw, with its age when stale */}
      <section className={`mx-4 rounded-2xl bg-slate-900 p-4 ${live ? '' : 'opacity-70'}`} data-testid="pad-scoreboard">
        <div className="flex items-stretch justify-between">
          <ScoreCol label={data.homeTeam} color={homeColor} score={formatScore(def, data.homeScore)} />
          <div className="flex flex-col items-center justify-center px-2">
            {hasClock && (
              <div className="font-mono text-3xl font-black tabular-nums text-white">{fmtPadClock(clockNow)}</div>
            )}
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {segName} {data.segment}
            </div>
            {(shotSc || playSc) && (
              <div className="mt-1 font-mono text-lg font-black tabular-nums text-amber-400">
                {shotSc
                  ? shotSc.len > 0 || shotSc.ms > 0
                    ? fmtSubClockSec(projectSubClockMs(shotSc, skewMs, projectAt))
                    : '—'
                  : playSc && playSc.at
                    ? fmtSubClockSec(projectSubClockMs(playSc, skewMs, projectAt))
                    : '40'}
              </div>
            )}
            {!live && (
              <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-amber-300">{t('lastKnown')}</div>
            )}
          </div>
          <ScoreCol label={data.awayTeam} color={awayColor} score={formatScore(def, data.awayScore)} />
        </div>
      </section>

      {/* score pads */}
      {caps.has('score') && increments.length > 0 && (
        <section className="mx-4 mt-3 grid grid-cols-2 gap-3" data-testid="pad-score">
          <PadCol
            team="home"
            label={data.homeTeam}
            color={homeColor}
            increments={increments}
            disabled={disabled}
            minusLabel={t('minusOne', { team: data.homeTeam })}
            onDelta={(delta) =>
              send(t('cmdScore', { team: data.homeTeam, delta: delta > 0 ? `+${delta}` : `${delta}` }), '/score', 'PATCH', {
                team: 'home',
                delta,
              })
            }
          />
          <PadCol
            team="away"
            label={data.awayTeam}
            color={awayColor}
            increments={increments}
            disabled={disabled}
            minusLabel={t('minusOne', { team: data.awayTeam })}
            onDelta={(delta) =>
              send(t('cmdScore', { team: data.awayTeam, delta: delta > 0 ? `+${delta}` : `${delta}` }), '/score', 'PATCH', {
                team: 'away',
                delta,
              })
            }
          />
        </section>
      )}

      {caps.has('clock') && hasClock && (
        <PadClockSection running={data.clockRunning} clockNow={clockNow} disabled={disabled} send={send} />
      )}
      {caps.has('shotClock') && def && (
        <PadShotClockSection def={def} stats={data.stats} skewMs={skewMs} nowMs={projectAt} disabled={disabled} send={send} />
      )}
      {caps.has('playClock') && (
        <PadPlayClockSection stats={data.stats} skewMs={skewMs} nowMs={projectAt} disabled={disabled} send={send} />
      )}
      {caps.has('segment') && <PadSegmentSection segName={segName} disabled={disabled} send={send} />}
      {def && (caps.has('stats') || caps.has('timeout')) && (
        <PadTeamSection
          def={def}
          stats={data.stats}
          homeTeam={data.homeTeam}
          awayTeam={data.awayTeam}
          homeColor={homeColor}
          awayColor={awayColor}
          canStats={caps.has('stats')}
          canTimeout={caps.has('timeout')}
          disabled={disabled}
          send={send}
        />
      )}
      {def && caps.has('stats') && (
        <PadGameStatsSection
          def={def}
          stats={data.stats}
          homeTeam={data.homeTeam}
          awayTeam={data.awayTeam}
          canSegment={caps.has('segment')}
          disabled={disabled}
          send={send}
        />
      )}
      {caps.has('possession') && (
        <PadPossessionSection
          possession={data.possession}
          homeTeam={data.homeTeam}
          awayTeam={data.awayTeam}
          disabled={disabled}
          send={send}
        />
      )}
      {def && caps.has('penalties') && (
        <PadPenaltySection
          def={def}
          stats={data.stats}
          homeTeam={data.homeTeam}
          awayTeam={data.awayTeam}
          skewMs={skewMs}
          nowMs={projectAt}
          disabled={disabled}
          send={send}
        />
      )}
      {def && caps.has('cue') && <PadCueSection def={def} disabled={disabled} send={send} />}
      <div className="pb-8" />
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
      <div className="max-w-full truncate text-[12px] font-black uppercase tracking-wider" style={{ color }}>
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
  disabled,
  minusLabel,
  onDelta,
}: {
  team: 'home' | 'away';
  label: string;
  color: string;
  increments: number[];
  disabled: boolean;
  minusLabel: string;
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
            disabled={disabled}
            onClick={() => onDelta(inc)}
            className="min-h-[56px] rounded-xl bg-slate-800 text-xl font-black text-white active:opacity-80 disabled:opacity-40"
          >
            +{inc}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDelta(-1)}
          className="min-h-[56px] rounded-xl bg-slate-800/60 text-xl font-black text-slate-400 active:opacity-80 disabled:opacity-40"
          aria-label={minusLabel}
        >
          −1
        </button>
      </div>
    </div>
  );
}
