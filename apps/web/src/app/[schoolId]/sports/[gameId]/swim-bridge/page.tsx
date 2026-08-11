'use client';

/**
 * Swim timing bridge (Inputs-wave SWIM, 2026-08-10) — the WebSerial page
 * that finally INSTANTIATES `SwimTimingParser` outside its own test: reads
 * the CTS swimming scoreboard-serial line (RS-232 9600/8-E-1) off a
 * USB-serial adapter on the timing-table laptop, decodes it in-browser,
 * and POSTs latest-wins snapshots to the already-fully-wired ingest at
 * `POST /sports/board/:gameId/swim-timing-snapshot`.
 *
 * Structural template: `components/player/CtsBridge.tsx` (the water-polo
 * WebSerial precedent) — type shims, read loop, 3s reconnect watcher, and
 * the x-feed-token POST shape are ported from there. Differences, on
 * purpose:
 *   - Dashboard route, not player-screen-scoped: the endpoint needs only
 *     gameId + feed token, and the natatorium reality is a laptop at the
 *     timing table, not a kiosk. No device token, no screen baggage.
 *   - POST floor is 250 ms (server budget 40/10s = 4 Hz sustained —
 *     CtsBridge's 200 ms would exceed it) with 429 backoff, in
 *     `@/lib/swim-bridge` (pure + unit-tested).
 *   - Client-side hardening for the checksum-less swim wire: lane-byte
 *     cross-check filter + a 2-consecutive-consistent-snapshots gate
 *     before the FIRST POST (see swim-bridge.ts header for the traps).
 *
 * CROSS-BROWSER (CLAUDE.md rule): Web Serial is Chromium-only. Same
 * pattern as CtsBridge's supported===false degrade — except this is a
 * destination page, so instead of rendering nothing it renders an
 * explicit fallback panel pointing at the manual Lane Pad, which keeps
 * working in every browser.
 *
 * BUNDLE RULE (screens/page.tsx precedent): `@cms/scoreboard-cts` is
 * loaded via `await import()` inside the Connect click handler — never
 * statically — so the decoder stays out of the dashboard bundle. The
 * type-only imports below are erased at compile time.
 *
 * Credentials: minted in-page via the same GET /sports/games/:id/
 * feed-credentials the console's copy-feed button uses. The token lives
 * in a ref for the session — NEVER in the URL (shared timing-table
 * laptops keep history).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Cable, CircleOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { API_URL } from '@/lib/api-url';
import {
  LaneByteFilter,
  SnapshotConsistencyGate,
  SwimPostScheduler,
  SWIM_POST_MIN_INTERVAL_MS,
  SWIM_SERIAL_DEFAULTS,
  buildModuleLaneMap,
  resolveBaudRate,
  summarizeSnapshot,
} from '@/lib/swim-bridge';
// Type-only — erased at compile time; the runtime module is dynamically
// imported inside onConnect (bundle rule, see header).
import type { SwimTimingParser, SwimTimingSnapshot } from '@cms/scoreboard-cts';

// Web Serial API types — minimal local shapes (CtsBridge.tsx pattern) to
// avoid pulling @types/w3c-web-serial. Runtime shape is stable Chrome 89+.
interface SerialPortInfoLite {
  usbVendorId?: number;
  usbProductId?: number;
}
interface SerialPortLite {
  readable: ReadableStream<Uint8Array> | null;
  open(opts: {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfoLite;
  addEventListener?(type: 'disconnect', listener: () => void): void;
  removeEventListener?(type: 'disconnect', listener: () => void): void;
}
interface SerialNavigatorLite {
  serial?: {
    requestPort(opts?: { filters?: SerialPortInfoLite[] }): Promise<SerialPortLite>;
    getPorts(): Promise<SerialPortLite[]>;
  };
}

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const STATUS_DOT: Record<Status, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  disconnected: '#f59e0b',
  idle: '#94a3b8',
  error: '#ef4444',
};

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Live — reading the console',
  disconnected: 'Disconnected',
  error: 'Error',
};

export default function SwimBridgePage() {
  const params = useParams();
  const schoolId = String(params?.schoolId ?? '');
  const gameId = String(params?.gameId ?? '');

  // ── Support detection ───────────────────────────────────────────────
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    const nav = navigator as unknown as SerialNavigatorLite;
    setSupported(!!nav.serial);
  }, []);

  // ── Live state ──────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bytesRead, setBytesRead] = useState(0);
  const [droppedLaneBytes, setDroppedLaneBytes] = useState(0);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [gateProgress, setGateProgress] = useState(0);
  const [gateOpen, setGateOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [lastPostStatus, setLastPostStatus] = useState<string | null>(null);
  const [lastPostAt, setLastPostAt] = useState<number | null>(null);
  const [postIntervalMs, setPostIntervalMs] = useState(SWIM_POST_MIN_INTERVAL_MS);
  const [reconnectArmed, setReconnectArmed] = useState(false);

  // ── Refs (session machinery — none of this drives render directly) ──
  const disposedRef = useRef(false);
  const manualStopRef = useRef(false);
  const portRef = useRef<SerialPortLite | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const parserRef = useRef<SwimTimingParser | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const filterRef = useRef<LaneByteFilter | null>(null);
  const gateRef = useRef<SnapshotConsistencyGate | null>(null);
  const schedulerRef = useRef<SwimPostScheduler<SwimTimingSnapshot> | null>(null);
  const feedTokenRef = useRef<string | null>(null);
  const postTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postInFlightRef = useRef(false);

  // ── POST pump — latest-wins, ≥250ms spacing, 429 backoff ────────────
  const doPost = useCallback(
    async (snap: SwimTimingSnapshot) => {
      const token = feedTokenRef.current;
      if (!token) return;
      postInFlightRef.current = true;
      try {
        const res = await fetch(
          `${API_URL}/sports/board/${encodeURIComponent(gameId)}/swim-timing-snapshot`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Header, never ?token= — the URL would land in laptop history.
              'x-feed-token': token,
            },
            body: JSON.stringify(snap),
            // Survive a page unload mid-POST (CtsBridge precedent).
            keepalive: true,
          },
        );
        const rateLimited = res.status === 429; // SPORTS_SWIM_TIMING_RATE_LIMITED
        schedulerRef.current?.onResult(snap, { ok: res.ok, rateLimited });
        setPostCount((n) => n + 1);
        setLastPostAt(Date.now());
        if (rateLimited) {
          setLastPostStatus('429 rate-limited — backing off');
        } else if (res.ok) {
          let accepted: boolean | undefined;
          try {
            const j = (await res.json()) as { accepted?: boolean };
            accepted = j?.accepted;
          } catch {
            /* body optional */
          }
          setLastPostStatus(accepted === false ? '200 (empty snapshot — dropped)' : `${res.status} ok`);
        } else {
          setLastPostStatus(`${res.status}`);
        }
      } catch (e) {
        schedulerRef.current?.onResult(snap, { ok: false });
        setLastPostStatus(`err: ${(e as Error).message}`);
      } finally {
        setPostIntervalMs(schedulerRef.current?.intervalMs ?? SWIM_POST_MIN_INTERVAL_MS);
        postInFlightRef.current = false;
        pumpPostsRef.current();
      }
    },
    [gameId],
  );

  // Self-scheduling drain. Ref-published so doPost's tail and the parser
  // callback can both call it without a hook-ordering dance.
  const pumpPostsRef = useRef<() => void>(() => {});
  const pumpPosts = useCallback(() => {
    if (disposedRef.current) return;
    if (postInFlightRef.current) return; // serialized — drain resumes in doPost's finally
    if (postTimerRef.current !== null) return; // a flush is already scheduled
    const sched = schedulerRef.current;
    if (!sched) return;
    const now = Date.now();
    const snap = sched.takeIfDue(now);
    if (snap) {
      void doPost(snap);
      return;
    }
    if (!sched.hasPending) return;
    postTimerRef.current = setTimeout(() => {
      postTimerRef.current = null;
      pumpPostsRef.current();
    }, Math.max(1, sched.msUntilDue(Date.now())));
  }, [doPost]);
  useEffect(() => {
    pumpPostsRef.current = pumpPosts;
  }, [pumpPosts]);

  // ── Parser snapshot handler: gate → scheduler → pump ────────────────
  const handleSnapshot = useCallback((snap: SwimTimingSnapshot) => {
    setSnapshotCount((n) => n + 1);
    setLastSummary(summarizeSnapshot(snap));
    const gate = gateRef.current;
    if (!gate) return;
    const verdict = gate.offer(snap);
    setGateOpen(gate.open);
    setGateProgress(gate.progress);
    if (verdict === 'reject') {
      // Implausible decode before the gate opened — a mis-framed join
      // poisons the parser's ACCUMULATED state, so reset it; the stream
      // re-locks within a packet or two. (Post-open, noise is the server
      // sanitizer's problem — see SnapshotConsistencyGate docs.)
      parserRef.current?.reset();
      setRejectedCount(gate.rejectedCount);
      return;
    }
    if (verdict !== 'open') return;
    schedulerRef.current?.offer(snap);
    pumpPostsRef.current();
  }, []);

  // ── Read loop (CtsBridge.tsx:1294 pattern, single port) ─────────────
  const runReadLoop = useCallback(
    async (port: SerialPortLite) => {
      if (!port.readable) {
        setError('Port readable stream is null');
        return;
      }
      const reader = port.readable.getReader();
      readerRef.current = reader;
      try {
        while (!disposedRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) {
            setBytesRead((n) => n + value.length);
            const filter = filterRef.current;
            const parser = parserRef.current;
            if (filter && parser) {
              const kept = filter.filter(value);
              setDroppedLaneBytes(filter.droppedCount);
              if (kept.length) parser.feed(kept);
            }
          }
        }
      } catch (e) {
        // Stream errors (cable yanked) bubble here.
        setError(`Read error: ${(e as Error).message}`);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        readerRef.current = null;
      }
    },
    [],
  );

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnectArmed(false);
  }, []);

  // Reconnect watcher (CtsBridge.tsx:1376 pattern): after a drop, poll the
  // already-granted ports every 3s and reopen — feed token + parser are
  // still in refs, so recovery needs no operator gesture.
  const scheduleReconnectRef = useRef<() => void>(() => {});
  const scheduleReconnect = useCallback(() => {
    if (disposedRef.current || manualStopRef.current) return;
    if (reconnectTimerRef.current !== null) return;
    setReconnectArmed(true);
    reconnectTimerRef.current = setInterval(async () => {
      if (disposedRef.current || manualStopRef.current) {
        clearReconnect();
        return;
      }
      try {
        const nav = navigator as unknown as SerialNavigatorLite;
        const ports = (await nav.serial?.getPorts?.()) || [];
        const port = ports[0];
        if (!port) return; // still unplugged — keep polling
        clearReconnect();
        // openAndRun's tail re-arms if this open fails, so a half-seated
        // plug keeps retrying at the same 3s cadence.
        await openAndRunRef.current(port);
      } catch {
        /* keep polling */
      }
    }, 3000);
  }, [clearReconnect]);
  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  // Open + pump until the port dies (CtsBridge.tsx:1333 pattern).
  const openAndRunRef = useRef<(port: SerialPortLite) => Promise<void>>(async () => {});
  const openAndRun = useCallback(
    async (port: SerialPortLite) => {
      try {
        setStatus('connecting');
        setError(null);
        await port.open({
          baudRate: resolveBaudRate(typeof window !== 'undefined' ? window.location.search : ''),
          dataBits: SWIM_SERIAL_DEFAULTS.dataBits,
          stopBits: SWIM_SERIAL_DEFAULTS.stopBits,
          parity: SWIM_SERIAL_DEFAULTS.parity,
        });
        portRef.current = port;
        setStatus('connected');
        const onDisconnect = () => setStatus('disconnected');
        try {
          port.addEventListener?.('disconnect', onDisconnect);
        } catch {
          /* ignore */
        }
        await runReadLoop(port);
        try {
          port.removeEventListener?.('disconnect', onDisconnect);
        } catch {
          /* ignore */
        }
        try {
          await port.close();
        } catch {
          /* ignore */
        }
        portRef.current = null;
        if (!disposedRef.current) {
          setStatus(manualStopRef.current ? 'idle' : 'disconnected');
          scheduleReconnectRef.current();
        }
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
        if (!disposedRef.current) scheduleReconnectRef.current();
      }
    },
    [runReadLoop],
  );
  useEffect(() => {
    openAndRunRef.current = openAndRun;
  }, [openAndRun]);

  // ── Connect (operator click — the required user gesture) ────────────
  const onConnect = useCallback(async () => {
    if (supported !== true) return;
    const nav = navigator as unknown as SerialNavigatorLite;
    if (!nav.serial) return;
    manualStopRef.current = false;
    clearReconnect();
    let port: SerialPortLite;
    try {
      // requestPort FIRST — it must ride the click's transient user
      // activation. No vendor filter: CTS runs through generic USB-RS232
      // adapters (FTDI / Prolific / CH340), same as CtsBridge.
      port = await nav.serial.requestPort();
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') return; // picker cancelled — quiet
      setError(`Request port failed: ${(e as Error).message}`);
      setStatus('error');
      return;
    }
    try {
      setStatus('connecting');
      setError(null);
      // Decoder loads HERE, not at module top — bundle rule (see header).
      const cts = await import('@cms/scoreboard-cts');
      unsubRef.current?.();
      const parser = new cts.SwimTimingParser();
      parserRef.current = parser;
      filterRef.current = new LaneByteFilter(
        cts.parseCtsSwimPackets,
        buildModuleLaneMap(cts.laneModule),
      );
      gateRef.current = new SnapshotConsistencyGate();
      schedulerRef.current = new SwimPostScheduler<SwimTimingSnapshot>();
      setGateOpen(false);
      setGateProgress(0);
      unsubRef.current = parser.onUpdate(handleSnapshot);
      // Mint the game-scoped HMAC feed token in-page (same endpoint the
      // console's copy-credentials button calls). Stays in memory only.
      const creds = await apiFetch<{ token: string }>(`/sports/games/${gameId}/feed-credentials`);
      feedTokenRef.current = creds.token;
      await openAndRun(port);
    } catch (e) {
      setError(`Bridge start failed: ${(e as Error).message}`);
      setStatus('error');
    }
  }, [supported, gameId, clearReconnect, handleSnapshot, openAndRun]);

  // ── Disconnect (operator intent — stands down auto-reconnect) ───────
  const onDisconnect = useCallback(() => {
    manualStopRef.current = true;
    clearReconnect();
    try {
      readerRef.current?.cancel().catch(() => undefined);
    } catch {
      /* ignore */
    }
    // The read loop exits and openAndRun's tail closes + nulls the port.
  }, [clearReconnect]);

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current !== null) clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      if (postTimerRef.current !== null) clearTimeout(postTimerRef.current);
      postTimerRef.current = null;
      unsubRef.current?.();
      try {
        readerRef.current?.cancel().catch(() => undefined);
      } catch {
        /* ignore */
      }
      try {
        portRef.current?.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
    };
  }, []);

  // 1s tick so "last POST Xs ago" stays honest when posting stalls (the
  // exact moment age matters). Only runs while a session is live.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    if (status !== 'connected') return;
    const t = setInterval(() => setAgeTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const postAge =
    lastPostAt !== null ? Math.max(0, Math.round((Date.now() - lastPostAt) / 1000)) : null;
  const backingOff = postIntervalMs > SWIM_POST_MIN_INTERVAL_MS;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4">
        <Link
          href={`/${schoolId}/sports/${gameId}`}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to game console
        </Link>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <Cable className="h-5 w-5 text-indigo-400" />
        <h1 className="text-lg font-black text-white">Swim timing bridge</h1>
      </div>
      <p className="mb-5 text-sm text-slate-400">
        Reads the Colorado Time Systems scoreboard-serial output (RS-232, 9600 baud, 8-E-1)
        from a USB-serial adapter and feeds live lane times, places, event/heat and team
        score straight into this game&apos;s results — no typing during a heat.
      </p>

      {supported === null && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
          Checking browser support…
        </div>
      )}

      {supported === false && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-amber-300">
            <CircleOff className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-wide">
              This browser can&apos;t read the timing console
            </h2>
          </div>
          <p className="text-sm text-amber-100/90">
            The auto-timing bridge needs Chrome or Edge on a laptop at the timing table —
            the manual Lane Pad keeps working everywhere.
          </p>
          <div className="mt-4">
            <Link href={`/${schoolId}/sports/${gameId}`}>
              <Button className="min-h-[44px] bg-indigo-600 font-black text-white hover:bg-indigo-700">
                Open the Lane Pad instead
              </Button>
            </Link>
          </div>
        </div>
      )}

      {supported === true && (
        <>
          {/* Connect / status card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: STATUS_DOT[status] }}
                />
                <div>
                  <div role="status" aria-live="polite" className="text-sm font-black text-white">
                    {STATUS_LABEL[status]}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {SWIM_SERIAL_DEFAULTS.baudRate} baud default · add <code>?baud=</code> to
                    the URL for an oddball converter
                    {reconnectArmed ? ' · watching for the port to come back (3s)' : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {status === 'connected' || status === 'connecting' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onDisconnect}
                    className="min-h-[44px] border-slate-700 bg-slate-900 font-black text-slate-300 hover:bg-slate-800"
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={onConnect}
                    className="min-h-[44px] gap-1.5 bg-indigo-600 font-black text-white hover:bg-indigo-700 active:bg-indigo-800"
                  >
                    <Cable className="h-4 w-4" />
                    Connect timing console
                  </Button>
                )}
              </div>
            </div>
            {error && (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs font-bold text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Lane-pad collision hint — the feed writes "EVENT N — HEAT M"
              rows; a hand-typed pad row for the same heat competes with it. */}
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-800/40 bg-amber-950/30 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-200/90">
              Pause the manual Lane Pad while the bridge is live — both write the same
              results, and a hand-typed heat row will compete with the console&apos;s feed
              for the same event.
            </p>
          </div>

          {/* Session telemetry */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Bytes read" value={String(bytesRead)} />
            <StatTile label="Snapshots decoded" value={String(snapshotCount)} />
            <StatTile
              label="First-post gate"
              value={gateOpen ? 'live' : `warming up ${gateProgress}/2`}
              tone={gateOpen ? 'good' : 'wait'}
            />
            <StatTile
              label="Lane-byte drops"
              value={String(droppedLaneBytes)}
              tone={droppedLaneBytes > 0 ? 'warn' : undefined}
              hint="lane packets whose payload lane byte contradicted the module address"
            />
            <StatTile
              label="Garbage resets"
              value={String(rejectedCount)}
              tone={rejectedCount > 0 ? 'warn' : undefined}
              hint="implausible decodes before the gate opened (parser reset + re-lock)"
            />
            <StatTile
              label="POST interval"
              value={`${postIntervalMs} ms${backingOff ? ' · backing off' : ''}`}
              tone={backingOff ? 'warn' : undefined}
            />
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StatTile label="Last snapshot" value={lastSummary ?? '—'} />
            <StatTile
              label="Ingest"
              value={
                postCount === 0
                  ? 'nothing posted yet'
                  : `${postCount} posted · last ${lastPostStatus ?? '—'}${
                      postAge !== null ? ` · ${postAge}s ago` : ''
                    }`
              }
              tone={
                lastPostStatus && !lastPostStatus.startsWith('2') && postCount > 0
                  ? 'warn'
                  : undefined
              }
            />
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            Feed credentials are minted for this game when you connect and stay in this
            tab&apos;s memory only. Snapshots post latest-wins at up to 4/s (the ingest
            budget); a 429 doubles the spacing up to 2s and it decays back on success.
            No Chromium at the table? See <code>docs/SWIM_TIMING_BRIDGE.md</code> for the
            Node fallback script.
          </p>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'wait';
}) {
  const valueColor =
    tone === 'good'
      ? 'text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-400'
        : tone === 'wait'
          ? 'text-slate-300'
          : 'text-white';
  return (
    <div
      title={hint}
      className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5"
    >
      <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}
