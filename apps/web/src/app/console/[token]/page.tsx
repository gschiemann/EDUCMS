'use client';

/**
 * VenueOS Sports — the PUBLIC scorekeeper pad (Phase-2 Domain SHARE;
 * rebuilt for the K-12 launch program, register row K12-F16, on lane A1's
 * command engine and lane A2's freshness contract).
 *
 * A student/volunteer opens /console/<token> from a link or QR the operator
 * minted in the game console and gets the controls THEIR LINK'S SCOPE allows
 * — no tenant account. The limits are enforced SERVER-side: every tap hits
 * the public SportsConsoleController, whose allowlist + game-scoped HMAC
 * token (versioned, always expiring, with the scope inside the MAC — one
 * permission model, @cms/api-types sports-console-scopes.ts) is the security
 * boundary; this page is the friendly face and renders from the `allows`
 * list the server's /session answers with.
 *
 *   table         — everything a volunteer can do
 *   scorer        — score, timeouts, team stats, possession, penalties, cues
 *   timer         — game clock, period, timeouts
 *   shot          — the shot clock / play clock only
 *   presentation  — celebrations only
 *   full          — (a link minted before scopes) the original five controls
 *
 * THE COMMAND ENGINE (K12-F10 / F09 / F13, lib/console-pad-commands). Every
 * tap carries a durable command id; a tap that got no response and is a
 * score / clock / period / stats change is queued under that id and replayed
 * by the operator console's own replay controller (lib/game-op-replay) — a
 * copy that did land is answered from the server's receipt, never applied
 * twice. Undo is the server's single-use inverse of THIS link's own latest
 * action. A FINAL game refuses every tap server-side; the pad says so.
 *
 * CONNECTION TRUTH (lib/sports-freshness via hooks/use-sports-link — the ONE
 * contract the board, ribbon, scorebug and operator console share). "LIVE"
 * only while the last good read is fresh; a stalled read stream is a
 * PERSISTENT "connection lost" banner, the controls pause and every clock is
 * HELD at the reading it had (a clock is never run on unconfirmed data);
 * when reads return the volunteer confirms the fresh picture before the
 * controls work again (confirmAfterLoss). Clocks project from the page's one
 * server clock (lib/server-clock, fed by every board poll) and format with
 * the shared formatter — tenths in the final minute where the sport's boards
 * show them.
 *
 * Reads ride the PUBLIC board endpoint via the shared hardened poll engine
 * (startBoardPoll — self-chaining, ETag/304, jittered backoff); a payload
 * older than one already shown is never applied (acceptRevision). A 401
 * anywhere flips to the full-screen "link revoked/expired" message.
 *
 * Mobile perf standard: solid backgrounds only (no backdrop-blur), and
 * NOTHING runs while the tab is hidden — the board poll, the clock ticker,
 * the freshness ticker and the queue's retry timer all stop on
 * visibilitychange and resume (with a fresh poll) on return.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_URL } from '@/lib/api-url';
import { startBoardPoll } from '@/lib/board-poll';
import {
  CONSOLE_ACTIONS,
  clockShowsTenths,
  consoleAllows,
  findSport,
  formatScore,
  formatSportClock,
  isConsoleScope,
  projectGameClockMs,
  type ConsoleAction,
  type ConsoleScope,
} from '@cms/api-types';
import { consoleTokenGameId, padIncrements } from '@/lib/console-share';
import {
  classifyPadFailure,
  nextLastAction,
  padQueueKey,
  padQueueKind,
  padQueuedPath,
  pushRejected,
  type PadFailure,
  type PadLastAction,
  type PadRejectedCommand,
  type PadStep,
} from '@/lib/console-pad-commands';
import { getGameOpQueue, isNetworkFailure, newCommandId, type GameOp } from '@/lib/game-op-queue';
import { attachOpQueueReplay } from '@/lib/game-op-replay';
import { acceptRevision, linkIsLive, secondsSinceGood, type LinkState } from '@/lib/sports-freshness';
import { noteRevisionShown, useSportsLink } from '@/hooks/use-sports-link';
import { serverClock } from '@/lib/server-clock';
import {
  PadClockSection,
  PadCueSection,
  PadGameStatsSection,
  PadPenaltySection,
  PadPlayClockSection,
  PadPossessionSection,
  PadSegmentSection,
  PadShotClockSection,
  PadSubClockReadout,
  PadTeamSection,
  PadUndoCard,
  type PadSend,
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
  possession: string;
  stats: Record<string, unknown>;
}

type SessionState = 'checking' | 'ok' | 'revoked' | 'offline';

/** Catalog key per failure class (lib/console-pad-commands classifyPadFailure). */
const FAILURE_KEY: Record<PadFailure, string> = {
  offline: 'failedOffline',
  'not-permitted': 'failedNotPermitted',
  'rate-limited': 'failedRateLimited',
  final: 'failedFinal',
  refused: 'failedRefused',
  server: 'failedServer',
  'undo-not-latest': 'undoNotLatest',
  'undo-conflict': 'undoConflict',
  'undo-gone': 'undoGone',
  'undo-impossible': 'undoImpossible',
};

interface Access {
  scope: ConsoleScope;
  allows: ConsoleAction[];
}

type StepOutcome = 'ok' | 'queued' | 'unknown' | 'refused' | 'revoked';

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

/** The API error code of a refused request, if it sent one. */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const j = (await res.json()) as Record<string, unknown> | null;
    return j && typeof j.code === 'string' ? j.code : null;
  } catch {
    return null;
  }
}

export default function ScorekeeperPadPage() {
  const t = useTranslations('sportsPad');
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const gameId = useMemo(() => consoleTokenGameId(token), [token]);
  const queueKey = useMemo(() => (gameId ? padQueueKey(gameId, token) : ''), [gameId, token]);

  const [session, setSession] = useState<SessionState>('checking');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [access, setAccess] = useState<Access | null>(null);
  const [data, setData] = useState<PadData | null>(null);
  // The segment on screen when a tap is made (a queued absolute op replays
  // with it). A ref, so the async command sender never reads a stale render.
  const segmentRef = useRef<number | null>(null);
  useEffect(() => {
    segmentRef.current = data ? data.segment : null;
  }, [data]);
  // K12-F40 — the newest game revision shown; an older payload (another
  // replica's one-second board cache) is never applied over it.
  const shownRevision = useRef<number | null>(null);
  const link = useSportsLink({ confirmAfterLoss: true, holdClocks: true, trackVisibility: true });
  const [, setTick] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [rejected, setRejected] = useState<PadRejectedCommand[]>([]);
  const rejectSeq = useRef(0);
  const [lastAction, setLastAction] = useState<PadLastAction | null>(null);
  const [undone, setUndone] = useState<string | null>(null);

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
        // The link's scope and what it may do in THIS sport — display only;
        // the server re-checks every tap against the same table. An answer
        // without a scope is a link minted before scopes: `full`.
        const scope: ConsoleScope = isConsoleScope(j.scope) ? j.scope : 'full';
        const allows = Array.isArray(j.allows)
          ? (j.allows as unknown[]).filter((c): c is ConsoleAction =>
              (CONSOLE_ACTIONS as readonly string[]).indexOf(String(c)) !== -1,
            )
          : consoleAllows(scope, findSport(typeof j.sport === 'string' ? j.sport : ''));
        setAccess({ scope, allows });
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
  //    visible (mobile perf: a pocketed phone runs zero timers). Every good
  //    poll (a 200 or a 304) is a good read for the freshness contract and a
  //    sample for the page's server clock (startBoardPoll feeds it). ──────
  const markGood = link.markGood;
  useEffect(() => {
    if (session !== 'ok' || !gameId) return;
    let stop: (() => void) | null = null;
    const startIfVisible = () => {
      if (document.visibilityState === 'hidden' || stop) return;
      stop = startBoardPoll({
        url: `${API_URL}/sports/board/${gameId}`,
        intervalMs: 750,
        onPayload: (payload) => {
          const p = payload as Partial<PadData> & { revision?: unknown; updatedAt?: unknown };
          if (!acceptRevision(shownRevision.current, p.revision)) return;
          if (typeof p.revision === 'number') shownRevision.current = p.revision;
          noteRevisionShown('pad', p);
          setData({
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
            possession:
              typeof p.possession === 'string'
                ? p.possession
                : p.stats && typeof (p.stats as Record<string, unknown>).possession === 'string'
                  ? String((p.stats as Record<string, unknown>).possession)
                  : '',
            stats: p.stats && typeof p.stats === 'object' ? (p.stats as Record<string, unknown>) : {},
          });
        },
        onStatus: (s) => {
          if (s.online) markGood();
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
  }, [session, gameId, markGood]);

  // ── the offline queue: taps that got no response replay under the id
  //    their first attempt carried, through the console's replay controller.
  const queue = useMemo(() => (queueKey ? getGameOpQueue(queueKey) : null), [queueKey]);
  const subscribeQueue = useCallback(
    (onChange: () => void) => (queue ? queue.subscribe(onChange) : () => {}),
    [queue],
  );
  const readQueue = useCallback(() => (queue ? queue.getSnapshot() : null), [queue]);
  const queueSnap = useSyncExternalStore(subscribeQueue, readQueue, () => null);
  useEffect(() => {
    if (!queue || session !== 'ok' || !token) return;
    const sender = async (op: GameOp): Promise<unknown> => {
      const body: Record<string, unknown> = { ...op.payload, commandId: op.opId };
      // An ABSOLUTE op replays with the period it was made in (the server
      // refuses it in another one); a score delta is a real point whenever.
      if (op.kind !== 'score' && typeof op.expectedSegment === 'number') body.expectedSegment = op.expectedSegment;
      const res = await fetch(`${API_URL}/sports/console/${encodeURIComponent(token)}${padQueuedPath(op.kind)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        setSession('revoked');
        return null;
      }
      // A definitive refusal can never succeed on retry: drop it, and say so.
      if (res.status >= 400 && res.status < 500) {
        queue.noteRejection();
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json().catch(() => null);
    };
    return attachOpQueueReplay(queueKey, queue, sender, {
      // The server's latest action for this link is now a replayed one the
      // pad cannot name: nothing to offer as Undo.
      onReplayed: () => setLastAction(null),
    });
  }, [queue, queueKey, session, token]);

  // ── the clock ticker: re-render while a clock runs and the picture is
  //    fresh; 100 ms when tenths are on screen, else 250 ms. While stale the
  //    server clock is HELD (useSportsLink holdClocks), so nothing moves. ──
  const live = link.state.phase === 'live' || link.state.phase === 'recovering';
  const subRunning = !!(
    (data?.stats?.shotClock as Record<string, unknown> | undefined)?.running ||
    (data?.stats?.playClock as Record<string, unknown> | undefined)?.running ||
    (Array.isArray(data?.stats?.penalties) &&
      (data?.stats?.penalties as Record<string, unknown>[]).some((p) => p && p.running))
  );
  const anyRunning = !!data && (data.clockRunning || subRunning);
  const tenths = !!data && !!def && data.clockRunning && clockShowsTenths(def, data.clockMs);
  useEffect(() => {
    if (!live || !anyRunning) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer === null && document.visibilityState !== 'hidden') {
        timer = setInterval(() => setTick((n) => (n + 1) % 1_000_000), tenths ? 100 : 250);
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
  }, [live, anyRunning, tenths]);

  // "Undone: …" is a confirmation, not an error — it clears itself.
  useEffect(() => {
    if (!undone) return;
    const timer = setTimeout(() => setUndone(null), 4000);
    return () => clearTimeout(timer);
  }, [undone]);

  // ── commands: one at a time, only against a live picture ─────────
  const reject = useCallback((label: string, failure: PadFailure, retry?: PadRejectedCommand['retry']) => {
    rejectSeq.current += 1;
    const id = rejectSeq.current;
    setRejected((list) => pushRejected(list, { id, label, failure, at: Date.now(), retry: retry ?? null }));
  }, []);

  /** Send one request under `commandId`. */
  const runStep = useCallback(
    async (label: string, step: PadStep, commandId: string): Promise<StepOutcome> => {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/sports/console/${encodeURIComponent(token)}${step.path}`, {
          method: step.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...step.body, commandId }),
        });
      } catch (err) {
        // No response at all: it may or may not have landed. A queue kind
        // waits in the queue under the SAME id (a copy that landed is
        // answered from its receipt); anything else is offered back as
        // "Send again", also under the same id.
        const kind = padQueueKind(step.kind);
        if (queue && kind && isNetworkFailure(err)) {
          queue.enqueue(kind, step.body, { commandId, expectedSegment: segmentRef.current });
          return 'queued';
        }
        reject(label, 'offline', { step, commandId });
        return 'unknown';
      }
      if (res.status === 401) {
        setSession('revoked');
        return 'revoked';
      }
      if (!res.ok) {
        reject(label, classifyPadFailure(res.status, await errorCode(res)));
        return 'refused';
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (json && typeof json === 'object') {
        if (typeof json.version === 'number') {
          shownRevision.current = Math.max(shownRevision.current ?? 0, json.version);
        }
        setData((cur) => (cur ? foldResponse(cur, json) : cur));
      }
      return 'ok';
    },
    [token, queue, reject],
  );

  const send = useCallback<PadSend>(
    (label, step, next) => {
      if (!token || pendingRef.current) return;
      pendingRef.current = true;
      setPending(label);
      setUndone(null);
      void (async () => {
        try {
          const firstId = newCommandId();
          let outcome = await runStep(label, step, firstId);
          let lastStep = step;
          let lastId = firstId;
          if (next) {
            if (outcome === 'ok') {
              lastId = newCommandId();
              lastStep = next;
              outcome = await runStep(label, next, lastId);
            } else if (outcome === 'queued' && queue) {
              // Keep the two halves in order: the second waits behind the first.
              const kind = padQueueKind(next.kind);
              if (kind) queue.enqueue(kind, next.body, { commandId: newCommandId(), expectedSegment: segmentRef.current });
            }
          }
          if (outcome !== 'revoked') {
            const settled = outcome;
            setLastAction((prev) => nextLastAction(prev, settled, lastStep, lastId, label, !!next));
          }
        } finally {
          pendingRef.current = false;
          setPending(null);
        }
      })();
    },
    [token, runStep, queue],
  );

  /** Resend a tap that got no answer, under the SAME command id. */
  const resend = useCallback(
    (entry: PadRejectedCommand) => {
      if (!entry.retry || pendingRef.current) return;
      const { step, commandId } = entry.retry;
      setRejected((list) => list.filter((x) => x.id !== entry.id));
      pendingRef.current = true;
      setPending(entry.label);
      void (async () => {
        try {
          const outcome = await runStep(entry.label, step, commandId);
          if (outcome !== 'revoked') {
            setLastAction((prev) => nextLastAction(prev, outcome, step, commandId, entry.label, false));
          }
        } finally {
          pendingRef.current = false;
          setPending(null);
        }
      })();
    },
    [runStep],
  );

  /** Undo this link's own latest action — once. */
  const undo = useCallback(() => {
    const target = lastAction;
    if (!target || !token || pendingRef.current) return;
    const label = t('undoLabel', { label: target.label });
    pendingRef.current = true;
    setPending(label);
    void (async () => {
      try {
        let res: Response;
        try {
          res = await fetch(`${API_URL}/sports/console/${encodeURIComponent(token)}/undo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ undoOf: target.commandId }),
          });
        } catch {
          // No answer: the undo may or may not have landed. Tapping Undo again
          // is safe (the server claims it once), so it stays offered.
          reject(label, 'offline');
          return;
        }
        if (res.status === 401) {
          setSession('revoked');
          return;
        }
        setLastAction(null);
        if (!res.ok) {
          reject(label, classifyPadFailure(res.status, await errorCode(res)));
          return;
        }
        setUndone(target.label);
      } finally {
        pendingRef.current = false;
        setPending(null);
      }
    })();
  }, [lastAction, token, t, reject]);

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

  const nowServer = serverClock.now();
  const clockNow = def ? projectGameClockMs(data, def.clock.type, nowServer) : data.clockMs;
  const caps = new Set<ConsoleAction>(access.allows);
  const final = data.status === 'FINAL';
  const controlsOn = linkIsLive(link.state) && !final;
  const disabled = !controlsOn || pending !== null;
  const segName = def?.segment?.name || t('periodFallback');
  const homeColor = data.homeColor || '#38bdf8';
  const awayColor = data.awayColor || '#f472b6';
  const hasClock = !!def && def.clock.type !== 'none';
  const chip = padChip(link.state, data.status);
  const roleKey =
    access.scope === 'full'
      ? 'role.legacy'
      : access.scope === 'shot' && def?.key === 'football'
        ? 'rolePlay'
        : `role.${access.scope}`;
  const queued = queueSnap ? queueSnap.ops.length : 0;

  return (
    <Shell>
      {/* K12-F16 — a phone held sideways (the `short-land:` variant, the same
          query as hooks/use-short-landscape): two panes, no page scroll. LEFT
          (the aside): who and what — the chip, the connection truth, the
          score, the clock and Undo — never scrolled away by a tap. RIGHT:
          the controls, scrolling on their own. Portrait stacks the two. */}
      <div className="short-land:grid short-land:h-[100dvh] short-land:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] short-land:overflow-hidden">
      <div data-testid="pad-aside" className="short-land:overflow-y-auto short-land:overscroll-contain short-land:border-r short-land:border-slate-800 short-land:pb-3">
      {/* header — game identity, the connection-aware chip, the link's scope */}
      <header className="px-4 pb-2 pt-4 short-land:pt-2">
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
                : chip === 'stale'
                  ? 'bg-amber-400 text-slate-950'
                  : chip === 'recovering'
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-slate-700 text-slate-200'
            }`}
          >
            {chip === 'live-game'
              ? t('chipLive')
              : chip === 'game-status'
                ? t.has(`status.${data.status}`)
                  ? t(`status.${data.status}`)
                  : data.status || t('chipGame')
                : chip === 'stale'
                  ? t('chipLost')
                  : chip === 'recovering'
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
        <PadStaleBanner state={link.state} />
        {link.state.phase === 'recovering' && (
          <div data-testid="pad-resync" className="mx-4 mb-2 rounded-xl border-2 border-sky-400 bg-sky-950 px-3 py-2.5 text-sky-50">
            <div className="text-sm font-black uppercase tracking-wide">{t('resyncTitle')}</div>
            <p className="mt-1 text-[13px] font-semibold">{t('resyncBody')}</p>
            <button
              type="button"
              onClick={link.confirm}
              className="mt-2 min-h-[48px] w-full rounded-xl bg-sky-500 text-sm font-black uppercase tracking-wide text-slate-950"
            >
              {t('resyncConfirm')}
            </button>
          </div>
        )}
        {link.state.phase === 'connecting' && link.state.lastGoodAt !== null && (
          <div className="mx-4 mb-2 rounded-xl bg-slate-800 px-3 py-2 text-[13px] font-bold text-slate-200">
            {t('refreshing')}
          </div>
        )}
        {final && (
          <div data-testid="pad-final" className="mx-4 mb-2 rounded-xl border-2 border-slate-500 bg-slate-800 px-3 py-2.5 text-slate-100">
            <div className="text-sm font-black uppercase tracking-wide">{t('finalTitle')}</div>
            <p className="mt-1 text-[13px] font-semibold">{t('finalBody')}</p>
          </div>
        )}
        {queued > 0 && (
          <div data-testid="pad-queued" className="mx-4 mb-2 rounded-xl bg-amber-400 px-3 py-2 text-[13px] font-bold text-slate-950">
            {queueSnap?.replaying ? t('queuedSending', { count: queued }) : t('queuedWaiting', { count: queued })}
          </div>
        )}
        {queued === 0 && queueSnap && queueSnap.lastRejectionAt !== null && (
          <div data-testid="pad-queue-refused" className="mx-4 mb-2 flex items-start gap-2 rounded-xl bg-red-700 px-3 py-2 text-white">
            <p className="min-w-0 flex-1 self-center text-[13px] font-bold">{t('queuedRefused')}</p>
            <button
              type="button"
              onClick={() => queue?.clearRejection()}
              aria-label={t('dismiss')}
              className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-red-900 text-sm font-black"
            >
              ✕
            </button>
          </div>
        )}
        {pending && (
          <div data-testid="pad-pending" className="mx-4 mb-2 rounded-xl bg-slate-800 px-3 py-2 text-[13px] font-bold text-slate-200">
            {t('sending', { label: pending })}
          </div>
        )}
        {undone && (
          <div data-testid="pad-undone" className="mx-4 mb-2 rounded-xl bg-emerald-700 px-3 py-2 text-[13px] font-bold text-white">
            {t('undoneBody', { label: undone })}
          </div>
        )}
      </div>

      {/* Commands that did not land — kept until dismissed. */}
      {rejected.length > 0 && (
        <ul data-testid="pad-rejected" className="mx-4 mb-2 space-y-2" aria-live="assertive">
          {rejected.map((r) => (
            <li key={r.id} className="flex items-start gap-2 rounded-xl bg-red-700 px-3 py-2 text-white">
              <p className="min-w-0 flex-1 self-center text-[13px] font-bold">{t(FAILURE_KEY[r.failure], { label: r.label })}</p>
              {r.retry && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => resend(r)}
                  className="min-h-[44px] shrink-0 rounded-lg bg-white px-3 text-xs font-black uppercase text-red-800 disabled:opacity-40"
                >
                  {t('sendAgain')}
                </button>
              )}
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

      {/* scoreboard strip — what the pad last saw, labelled when stale */}
      <section className={`mx-4 rounded-2xl bg-slate-900 p-4 ${live ? '' : 'opacity-70'}`} data-testid="pad-scoreboard">
        <div className="flex items-stretch justify-between">
          <ScoreCol label={data.homeTeam} color={homeColor} score={formatScore(def, data.homeScore)} />
          <div className="flex flex-col items-center justify-center px-2">
            {hasClock && (
              <div className="font-mono text-3xl font-black tabular-nums text-white" data-testid="pad-clock-readout">
                {formatSportClock(def, clockNow)}
              </div>
            )}
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {segName} {data.segment}
            </div>
            {def && <PadSubClockReadout def={def} stats={data.stats} nowMs={nowServer} />}
            {!live && (
              <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-amber-300">{t('lastKnown')}</div>
            )}
          </div>
          <ScoreCol label={data.awayTeam} color={awayColor} score={formatScore(def, data.awayScore)} />
        </div>
      </section>

      {lastAction && <PadUndoCard label={lastAction.label} disabled={disabled} onUndo={undo} />}
      </div>

      <div data-testid="pad-controls" className="short-land:overflow-y-auto short-land:overscroll-contain short-land:pb-6">
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
              send(t('cmdScore', { team: data.homeTeam, delta: delta > 0 ? `+${delta}` : `${delta}` }), {
                kind: 'score',
                path: '/score',
                method: 'PATCH',
                body: { team: 'home', delta },
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
              send(t('cmdScore', { team: data.awayTeam, delta: delta > 0 ? `+${delta}` : `${delta}` }), {
                kind: 'score',
                path: '/score',
                method: 'PATCH',
                body: { team: 'away', delta },
              })
            }
          />
        </section>
      )}

      {caps.has('clock') && hasClock && def && (
        <PadClockSection def={def} running={data.clockRunning} clockNow={clockNow} disabled={disabled} send={send} />
      )}
      {caps.has('shotClock') && def && (
        <PadShotClockSection def={def} stats={data.stats} nowMs={nowServer} disabled={disabled} send={send} />
      )}
      {caps.has('playClock') && def && (
        <PadPlayClockSection def={def} stats={data.stats} nowMs={nowServer} disabled={disabled} send={send} />
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
          nowMs={nowServer}
          disabled={disabled}
          send={send}
        />
      )}
      {def && caps.has('cue') && <PadCueSection def={def} disabled={disabled} send={send} />}
      <div className="pb-8 short-land:pb-2" />
      </div>
      </div>
    </Shell>
  );
}

/**
 * The single header chip. `live-game` is the ONLY state allowed to read
 * "LIVE", and only while the link is live AND the game is LIVE; a connected
 * non-live game shows its status; everything else names the connection
 * state (the shared contract's phase) instead of the game state.
 */
type PadChip = 'live-game' | 'game-status' | LinkState['phase'];
function padChip(s: LinkState, gameStatus: string): PadChip {
  if (s.phase === 'live') return gameStatus === 'LIVE' ? 'live-game' : 'game-status';
  return s.phase;
}

/**
 * K12-F40 — while the reads are stale the pad says so, with how long ago the
 * last good read was. A one-second ticker only while stale (no timer
 * otherwise); the first frame reads the instant the link went stale.
 */
function PadStaleBanner({ state }: { state: LinkState }) {
  const t = useTranslations('sportsPad');
  const stale = state.phase === 'stale';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stale) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stale]);
  if (!stale) return null;
  const seconds = secondsSinceGood(state, Math.max(now, state.staleSince ?? now));
  return (
    <div data-testid="pad-lost" className="mx-4 mb-2 rounded-xl border-2 border-amber-400 bg-amber-950 px-3 py-2.5 text-amber-50">
      <div className="text-sm font-black uppercase tracking-wide">{t('lostTitle')}</div>
      <p className="mt-1 text-[13px] font-semibold">
        {seconds === null ? t('lostNeverBody') : t('lostBody', { seconds })}
      </p>
    </div>
  );
}

/** Solid dark shell — no backdrop-blur anywhere (mobile perf standard). On a
 *  phone held sideways the panes own the scrolling and clear the notch. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    // Sideways, the pad is pinned to the viewport (physical longhand sides,
    // never `inset`): `min-h-screen` is 100vh — the LARGE viewport on a phone
    // (browser bars hidden) — and the root layout's 384 px backdrop is taller
    // than a 360 px landscape screen, either of which would let the whole
    // page scroll under the two panes.
    <div className="min-h-screen bg-slate-950 pb-6 short-land:fixed short-land:top-0 short-land:right-0 short-land:bottom-0 short-land:left-0 short-land:min-h-0 short-land:pb-0 short-land:pl-[env(safe-area-inset-left)] short-land:pr-[env(safe-area-inset-right)]">
      {children}
    </div>
  );
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
