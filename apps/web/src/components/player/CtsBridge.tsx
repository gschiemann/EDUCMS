"use client";

/**
 * CtsBridge — browser-side Web Serial bridge for the Colorado Time
 * Systems (CTS) System 6 / Gen 6 scoreboard console.
 *
 * Runs IN the player page on a Beelink Mini PC (Chrome on Windows).
 * Reads bytes from a USB-RS232 dongle plugged into the CTS console's
 * 1/4" mono jack output, feeds them through @cms/scoreboard-cts'
 * CtsParser, and POSTs every parsed snapshot to
 * `POST /api/v1/screens/:id/game-state`. The API signs + broadcasts
 * the snapshot to every player connected to the same screen, so the
 * LED ribbon scoreboard widget re-renders within ~150ms.
 *
 * Architecture decisions:
 *
 *   - The bridge owns ZERO scoreboard render state. It's a pure
 *     producer: console → parser → POST. The player consumer reads
 *     the broadcast back via the existing signed-WS channel.
 *
 *   - Port permission persists per-origin via Web Serial's built-in
 *     getPorts(). On a Beelink kiosk that gets one cold-boot per
 *     game, the operator clicks "Connect" once on install day,
 *     subsequent boots reconnect silently.
 *
 *   - Reconnect-on-disconnect listener is mandatory — a wiggle of
 *     the USB plug would otherwise stop game data mid-quarter.
 *
 *   - Web Serial is Chrome 89+. The bridge SILENTLY hides if
 *     `'serial' in navigator` is false — protects Safari, Firefox,
 *     Chromium 83 (Taurus) from a broken UI. Operators on those
 *     browsers never see the panel; they're not the deploy target.
 *
 *   - The POST is throttled at the SOURCE: we POST on every parser
 *     `onUpdate` event. The parser only fires when the snapshot
 *     actually changed. Typical water polo: 5-10 updates/sec
 *     (clock + occasional score/period). The API gate is what
 *     bounds load.
 *
 *   - Throttle at the listener layer too — a max-rate of 8 Hz
 *     ensures we never spam the API even if the parser fires more
 *     often than that for some reason (e.g. tenths every 100ms).
 *     The pending snapshot is always the LATEST one (last-wins),
 *     so we never POST stale data.
 *
 * NOT in scope for v1:
 *   - Auto-celebration cue triggering on goal-delta detection.
 *     Belongs in the ScoreSource state machine (Sprint 13 Phase 4).
 *   - Multiple bridges per page. One CTS console per screen.
 *   - Pre-CTS-6 protocols (CTS System 5 / Daktronics). Different
 *     wire format; would need its own decoder package.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CtsParser,
  MockCtsFeed,
  REHEARSAL_SCRIPT,
  scriptGame,
  type CtsFullSnapshot,
} from '@cms/scoreboard-cts';

// Web Serial API types. We declare minimal shapes locally to avoid
// pulling @types/w3c-web-serial as a dependency. The runtime shape is
// stable across Chrome 89+.
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
    flowControl?: 'none' | 'hardware';
    bufferSize?: number;
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

/**
 * Sprint 13 Phase 2 — native serial bridge surface exposed by the
 * Player APK on Goodview ECBox3576 (and any Android box with a real
 * /dev/ttyS* hardware UART). The APK's WebAppBridge.kt mounts this
 * as `window.EduCmsNative.ctsSerial*` methods; we feature-detect
 * `ctsSerialEnabled()` and swap from Web Serial to native mode if
 * present. Bytes flow back via window.__ctsSerialBytes(base64) which
 * we register on connect.
 *
 * Same CtsParser, same POST, same WS, same orchestrator — bytes path
 * is the only thing that differs.
 */
interface EduCmsNativeBridge {
  ctsSerialEnabled?: () => boolean;
  ctsSerialConnect?: (
    devicePath: string,
    baudRate: number,
    dataBits: number,
    stopBits: number,
    parity: string,
  ) => string;
  ctsSerialDisconnect?: () => string;
  ctsSerialStatus?: () => string;
}

declare global {
  interface Window {
    EduCmsNative?: EduCmsNativeBridge;
    __ctsSerialBytes?: (base64: string) => void;
  }
}

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/** Are we running inside the Player APK with the native CTS serial
 *  bridge available? Detected once on mount; survives until reload. */
function detectNativeBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const n = window.EduCmsNative;
  if (!n || typeof n.ctsSerialEnabled !== 'function') return false;
  try {
    return !!n.ctsSerialEnabled();
  } catch {
    return false;
  }
}

/** base64 → Uint8Array. Tiny — no buffer-polyfill needed for the
 *  modest chunks the CTS console sends (~60 bytes/sec average). */
function b64ToBytes(b64: string): Uint8Array {
  const bin = (typeof atob !== 'undefined' ? atob(b64) : '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 8 Hz upper bound on snapshot POSTs. The CTS clock ticks at 10 Hz
// during the last minute (tenths shown); rendering at 8 Hz produces
// a smooth scoreboard without flooding the API. Latest-snapshot-wins
// during the throttle window.
const POST_THROTTLE_MS = 125;

/**
 * Optional URL query-param overrides for hardware-specific quirks.
 * Most installs leave these alone; documented here so the lead can
 * use them on-site if a CTS console reports baud / parity unusual.
 */
function readSerialOptsFromQuery(): {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
} {
  if (typeof window === 'undefined') {
    return { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' };
  }
  const p = new URLSearchParams(window.location.search);
  const baudRate = parseInt(p.get('ctsBaud') || '', 10) || 9600;
  const dataBitsRaw = parseInt(p.get('ctsDataBits') || '', 10) || 8;
  const dataBits: 7 | 8 = dataBitsRaw === 7 ? 7 : 8;
  const stopBitsRaw = parseInt(p.get('ctsStopBits') || '', 10) || 1;
  const stopBits: 1 | 2 = stopBitsRaw === 2 ? 2 : 1;
  const parityRaw = (p.get('ctsParity') || 'even').toLowerCase();
  const parity: 'none' | 'even' | 'odd' =
    parityRaw === 'none' || parityRaw === 'odd' ? parityRaw : 'even';
  return { baudRate, dataBits, stopBits, parity };
}

export interface CtsBridgeProps {
  /** Screen ID this bridge is bound to. POST endpoint includes it. */
  screenId: string;
  /** API root, e.g. https://api.example.com. No trailing /api/v1. */
  apiRoot: string;
  /** Device JWT for the screen — used as Bearer on the POST. */
  deviceToken: string | null;
  /** Compact mode: skip debug JSON pretty-print + last-bytes counter. */
  compact?: boolean;
}

export function CtsBridge({
  screenId,
  apiRoot,
  deviceToken,
  compact = false,
}: CtsBridgeProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bytesRead, setBytesRead] = useState<number>(0);
  const [lastSnapshot, setLastSnapshot] = useState<CtsFullSnapshot | null>(null);
  const [postCount, setPostCount] = useState<number>(0);
  const [postLastStatus, setPostLastStatus] = useState<string | null>(null);

  const parserRef = useRef<CtsParser | null>(null);
  const portRef = useRef<SerialPortLite | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const disposedRef = useRef<boolean>(false);
  const pendingSnapshotRef = useRef<CtsFullSnapshot | null>(null);
  const postTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPostAtRef = useRef<number>(0);

  // 2026-05-27 — Simulator state. Operator: "how can we build a
  // sample/fake connection to CTS…maybe we read content from a file
  // thats in the form of a CTS feed so we can see how it will load
  // and look?" The REHEARSAL_SCRIPT bundled in @cms/scoreboard-cts
  // already scripts a 30-second four-quarter water polo demo (goals,
  // exclusions, period changes, horn, timeouts). When the operator
  // starts the simulator, we feed those scripted bytes through the
  // SAME parser the live Web Serial / native bridge feeds — so the
  // /sports/board path, the broadcast WS, the CTS widgets, the
  // cinematic celebrations, every downstream surface sees identical
  // data to a real game.
  const [simRunning, setSimRunning] = useState<boolean>(false);
  const simAbortRef = useRef<{ aborted: boolean } | null>(null);

  // Sprint 13 Phase 2 — detect the deployment mode ONCE on mount.
  //   • nativeMode = true  → Player APK on Goodview ECBox3576 etc.
  //     Native serial bridge present; bypass Web Serial picker; auto-
  //     connect to /dev/ttyS1 (operator config in APK settings).
  //   • nativeMode = false → Beelink mini PC running desktop Chrome.
  //     Original Web Serial picker UI; operator clicks Connect once.
  const [nativeMode, setNativeMode] = useState<boolean>(false);
  const [nativeStatusJson, setNativeStatusJson] = useState<string>('');

  // Detect Web Serial OR native bridge availability once.
  useEffect(() => {
    if (detectNativeBridge()) {
      setNativeMode(true);
      setSupported(true);
      return;
    }
    const nav = navigator as unknown as SerialNavigatorLite;
    setSupported(!!nav.serial);
  }, []);

  // Initialize parser once.
  useEffect(() => {
    parserRef.current = new CtsParser();
    return () => {
      parserRef.current = null;
    };
  }, []);

  // Sprint 13 Phase 2 — native serial bytes path. The APK calls
  // `window.__ctsSerialBytes(base64)` for every chunk it reads from
  // the Phoenix-terminal RS232 port. We decode + feed straight into
  // the parser (same `parser.feed()` the Web Serial path uses).
  // Setup is conditional so non-Player browsers don't get a phantom
  // global hook.
  useEffect(() => {
    if (!nativeMode) return;
    window.__ctsSerialBytes = (b64: string) => {
      try {
        const bytes = b64ToBytes(b64);
        if (bytes.length === 0) return;
        parserRef.current?.feed(bytes);
        setBytesRead((n) => n + bytes.length);
      } catch (e) {
        setError(`Native bytes decode failed: ${(e as Error).message}`);
      }
    };
    return () => {
      if (typeof window !== 'undefined' && window.__ctsSerialBytes) {
        delete window.__ctsSerialBytes;
      }
    };
  }, [nativeMode]);

  // Sprint 13 Phase 2 — native auto-connect on mount. The operator
  // configured tty path + baud + parity once in APK settings (or via
  // the URL query params for ad-hoc testing); we open + start reading
  // immediately so the operator doesn't have to click anything on the
  // kiosk. Cable yanks are recovered via the status poll below.
  useEffect(() => {
    if (!nativeMode) return;
    const n = window.EduCmsNative;
    if (!n?.ctsSerialConnect) return;
    const opts = readSerialOptsFromQuery();
    // tty path comes from URL query (?ctsTty=/dev/ttyS2) or defaults
    // to /dev/ttyS1 — the Phoenix Terminal 1 RS232 RX on the
    // ECBox3576. APK settings UI (Phase 3) will let the operator pick
    // this from a list of probed devices.
    const tty = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('ctsTty') || '/dev/ttyS1')
      : '/dev/ttyS1';
    setStatus('connecting');
    setError(null);
    try {
      const resp = n.ctsSerialConnect(tty, opts.baudRate, opts.dataBits, opts.stopBits, opts.parity);
      const parsed = JSON.parse(resp || '{}');
      if (parsed.ok) {
        setStatus('connected');
      } else {
        setStatus('error');
        setError(`${parsed.code || 'error'}: ${parsed.message || 'connect failed'}`);
      }
    } catch (e) {
      setStatus('error');
      setError(`Native connect failed: ${(e as Error).message}`);
    }
    return () => {
      try { window.EduCmsNative?.ctsSerialDisconnect?.(); } catch { /* ignore */ }
    };
  }, [nativeMode]);

  // Sprint 13 Phase 2 — native status poll (5s) so the operator-facing
  // panel shows live bytes-read + last-byte-age. Also drives the
  // auto-reconnect: if the native side reports `open:false` while we
  // think we're connected (cable yank, kernel closed the tty), we
  // attempt a reconnect after a 2s backoff.
  useEffect(() => {
    if (!nativeMode) return;
    const tick = () => {
      try {
        const s = window.EduCmsNative?.ctsSerialStatus?.();
        if (!s) return;
        setNativeStatusJson(s);
        const parsed = JSON.parse(s) as { open?: boolean; lastError?: string };
        if (parsed.open === false && status === 'connected') {
          setStatus('disconnected');
          if (parsed.lastError) setError(parsed.lastError);
          // Auto-reconnect after a short delay — kernel can take a
          // beat to recover from cable yanks. Phase 3 will add
          // exponential backoff + max-attempt caps.
          setTimeout(() => {
            const n = window.EduCmsNative;
            if (!n?.ctsSerialConnect) return;
            const opts = readSerialOptsFromQuery();
            const tty = new URLSearchParams(window.location.search).get('ctsTty') || '/dev/ttyS1';
            try {
              const resp = n.ctsSerialConnect(tty, opts.baudRate, opts.dataBits, opts.stopBits, opts.parity);
              const reparsed = JSON.parse(resp || '{}');
              if (reparsed.ok) {
                setStatus('connected');
                setError(null);
              }
            } catch { /* will retry on next tick */ }
          }, 2000);
        }
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [nativeMode, status]);

  // POST the latest snapshot to the API. Latest-wins throttled at
  // POST_THROTTLE_MS. Uses keepalive: true so a tab close mid-POST
  // doesn't lose the final state.
  const flushPost = useCallback(async () => {
    if (disposedRef.current) return;
    const snap = pendingSnapshotRef.current;
    if (!snap) return;
    pendingSnapshotRef.current = null;
    lastPostAtRef.current = Date.now();
    try {
      const res = await fetch(
        `${apiRoot}/api/v1/screens/${encodeURIComponent(screenId)}/game-state`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {}),
          },
          body: JSON.stringify({ source: 'cts', snapshot: snap }),
          // keepalive: keep the request alive even if the page unloads
          // mid-POST. Capped at 64KB by browsers; our payloads are <2KB.
          keepalive: true,
        },
      );
      setPostCount((n) => n + 1);
      setPostLastStatus(`${res.status}`);
    } catch (e) {
      setPostLastStatus(`err: ${(e as Error).message}`);
    }
  }, [apiRoot, deviceToken, screenId]);

  const schedulePost = useCallback(
    (snap: CtsFullSnapshot) => {
      pendingSnapshotRef.current = snap;
      setLastSnapshot(snap);
      const elapsed = Date.now() - lastPostAtRef.current;
      if (elapsed >= POST_THROTTLE_MS) {
        // Fire immediately — fresh from throttle window.
        flushPost();
      } else if (postTimerRef.current === null) {
        // Schedule a single flush at the end of the window.
        postTimerRef.current = setTimeout(() => {
          postTimerRef.current = null;
          flushPost();
        }, POST_THROTTLE_MS - elapsed);
      }
    },
    [flushPost],
  );

  // Subscribe the parser → schedule POST.
  useEffect(() => {
    const parser = parserRef.current;
    if (!parser) return;
    const unsub = parser.onUpdate((snap) => {
      schedulePost(snap);
    });
    return unsub;
  }, [schedulePost]);

  // Read loop: pump bytes from the port's readable stream into the
  // parser. Returns when the stream ends (port closed / disconnect).
  const runReadLoop = useCallback(async (port: SerialPortLite) => {
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
          parserRef.current?.feed(value);
          setBytesRead((n) => n + value.length);
        }
      }
    } catch (e) {
      // Stream errors (cable yanked) bubble here.
      setError(`Read error: ${(e as Error).message}`);
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
      readerRef.current = null;
    }
  }, []);

  // Open + start reading from a port. Sets status / error along the way.
  const openAndRun = useCallback(
    async (port: SerialPortLite) => {
      try {
        setStatus('connecting');
        setError(null);
        const opts = readSerialOptsFromQuery();
        await port.open(opts);
        portRef.current = port;
        setStatus('connected');
        // Listen for hardware disconnect (cable yanked).
        const onDisconnect = () => {
          setStatus('disconnected');
        };
        try { port.addEventListener?.('disconnect', onDisconnect); } catch { /* ignore */ }
        // Pump until the read loop returns (port closed) or we're disposed.
        await runReadLoop(port);
        try { port.removeEventListener?.('disconnect', onDisconnect); } catch { /* ignore */ }
        // Try to close cleanly. Errors here are non-fatal.
        try { await port.close(); } catch { /* ignore */ }
        portRef.current = null;
        if (!disposedRef.current) setStatus('disconnected');
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        setStatus('error');
      }
    },
    [runReadLoop],
  );

  // On mount, try to reconnect to any previously-granted port. This
  // is the "game day morning" path — the operator paired the kiosk
  // months ago, no human is on-site to click Connect.
  useEffect(() => {
    if (supported !== true) return;
    let cancelled = false;
    (async () => {
      try {
        const nav = navigator as unknown as SerialNavigatorLite;
        const ports = (await nav.serial?.getPorts?.()) || [];
        if (cancelled) return;
        if (ports.length > 0) {
          const port = ports[0];
          if (!port) return;
          await openAndRun(port);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Auto-reconnect failed: ${(e as Error).message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, openAndRun]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (postTimerRef.current) {
        clearTimeout(postTimerRef.current);
        postTimerRef.current = null;
      }
      // Stop the sample-game simulator if it's running.
      if (simAbortRef.current) simAbortRef.current.aborted = true;
      simAbortRef.current = null;
      try { readerRef.current?.cancel().catch(() => undefined); } catch { /* ignore */ }
      try { portRef.current?.close().catch(() => undefined); } catch { /* ignore */ }
    };
  }, []);

  // Manual connect (operator click).
  const onConnect = useCallback(async () => {
    if (supported !== true) return;
    const nav = navigator as unknown as SerialNavigatorLite;
    if (!nav.serial) return;
    try {
      // No vendor/product filter — CTS uses generic USB-RS232 adapters
      // (FTDI, Prolific, CH340) so we let the OS show all serial
      // devices. The operator picks the one labeled COMx that they
      // see in Device Manager.
      const port = await nav.serial.requestPort();
      await openAndRun(port);
    } catch (e) {
      // User clicked Cancel on the picker.
      if ((e as Error).name === 'NotFoundError') {
        // Quiet — that's a normal "they backed out" gesture.
        return;
      }
      setError(`Request port failed: ${(e as Error).message}`);
      setStatus('error');
    }
  }, [supported, openAndRun]);

  // Manual disconnect (operator click).
  const onDisconnect = useCallback(async () => {
    try { readerRef.current?.cancel().catch(() => undefined); } catch { /* ignore */ }
    // The read loop will exit and `openAndRun` will close + null the port.
  }, []);

  // 2026-05-27 — Start the bundled CTS rehearsal script. Feeds the
  // SAME parser the live serial bridge feeds, so every downstream
  // surface (the API POST, the broadcast WS, the CTS scoreboard
  // widget, the AUTO-celebrate trigger that fires the goal cinematic)
  // sees identical data to a real CTS game. Loops the 30-second
  // script forever so the operator can leave it running while they
  // sanity-check the production deploy.
  const onStartSim = useCallback(async () => {
    const parser = parserRef.current;
    if (!parser) return;
    setSimRunning(true);
    setError(null);
    const abort = { aborted: false };
    simAbortRef.current = abort;
    const feed = new MockCtsFeed((bytes) => {
      if (abort.aborted) return;
      parser.feed(bytes);
      setBytesRead((n) => n + bytes.length);
    });
    // Initial state burst so the parser has a complete snapshot
    // before the first scripted event.
    feed.pushInitialState({ clock: '8:00', period: 1, homeScore: 0, awayScore: 0 });
    // Loop the script. Each pass is ~30s; we replay forever until
    // the operator clicks Stop or the bridge unmounts.
    (async () => {
      while (!abort.aborted) {
        try {
          await scriptGame(feed, REHEARSAL_SCRIPT);
        } catch (e) {
          if (!abort.aborted) setError(`Sim error: ${(e as Error).message}`);
          break;
        }
        if (abort.aborted) break;
        // Short gap then reset clock + scores for the next loop.
        await new Promise((r) => setTimeout(r, 1500));
        if (abort.aborted) break;
        feed.pushInitialState({ clock: '8:00', period: 1, homeScore: 0, awayScore: 0 });
      }
    })();
  }, []);

  const onStopSim = useCallback(() => {
    if (simAbortRef.current) simAbortRef.current.aborted = true;
    simAbortRef.current = null;
    setSimRunning(false);
  }, []);

  // Render — silent on unsupported browsers (Safari, Firefox, Taurus).
  if (supported === null) return null;
  if (supported === false) return null;

  // Cross-browser-safe panel — fixed corner, low z-index so emergency
  // overlay still wins. Inline styles to dodge any global CSS that
  // might collide. No CSS shorthand position / flex gap (Chromium 83
  // traps — see CLAUDE.md rule #10); not shipped to Taurus anyway,
  // but be a good citizen.
  const dot = {
    connected: '#22c55e',
    connecting: '#f59e0b',
    disconnected: '#f59e0b',
    idle: '#94a3b8',
    error: '#ef4444',
  }[status];

  return (
    <div
      role="region"
      aria-label="CTS scoreboard bridge"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        background: 'rgba(15,23,42,0.95)',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        padding: '10px 12px',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        zIndex: 9000,
        maxWidth: 320,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: dot,
            marginRight: 8,
            boxShadow: status === 'connected' ? `0 0 6px ${dot}` : 'none',
          }}
        />
        <strong style={{ marginRight: 8 }}>
          CTS Bridge{nativeMode ? ' · ECBox' : ''}
        </strong>
        <span style={{ opacity: 0.7 }}>{status}</span>
      </div>

      {/* Native mode: no buttons — auto-connect on mount + auto-
          reconnect on cable yank. Show the tty path so operators can
          verify which port is being read. */}
      {nativeMode && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
          Native serial (Phoenix terminal)
        </div>
      )}

      {!nativeMode && status !== 'connected' && (
        <button
          type="button"
          onClick={onConnect}
          style={{
            background: '#2563eb',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            marginRight: 6,
            marginBottom: 4,
          }}
        >
          Connect to CTS
        </button>
      )}
      {!nativeMode && status === 'connected' && (
        <button
          type="button"
          onClick={onDisconnect}
          style={{
            background: '#475569',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            marginRight: 6,
            marginBottom: 4,
          }}
        >
          Disconnect
        </button>
      )}

      {/* 2026-05-27 — Sample-game simulator. Operator: "how can we
          build a sample/fake connection to CTS…maybe we read content
          from a file thats in the form of a CTS feed". Feeds the
          bundled REHEARSAL_SCRIPT (30-second 4-quarter water polo
          game with goals/exclusions/horn) through the SAME parser
          the live bridge uses. Every downstream surface sees the
          same data shape it'd get from a real CTS console — perfect
          for dress-rehearsing the full show flow without hardware. */}
      {status !== 'connected' && !simRunning && (
        <button
          type="button"
          onClick={onStartSim}
          style={{
            background: '#7c3aed',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            marginRight: 6,
            marginBottom: 4,
          }}
          title="Run a scripted 30-second sample water-polo game through the parser. Useful for testing/demoing without a CTS console."
        >
          ▶ Play sample game
        </button>
      )}
      {simRunning && (
        <button
          type="button"
          onClick={onStopSim}
          style={{
            background: '#dc2626',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            marginRight: 6,
            marginBottom: 4,
          }}
        >
          ■ Stop sample
        </button>
      )}

      {!compact && (
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.85 }}>
          <div>bytes read: {bytesRead.toLocaleString()}</div>
          <div>
            posts: {postCount}
            {postLastStatus ? ` (${postLastStatus})` : ''}
          </div>
          {lastSnapshot && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer' }}>last state</summary>
              <pre
                style={{
                  margin: '4px 0 0 0',
                  fontSize: 10,
                  background: '#0f172a',
                  padding: 6,
                  borderRadius: 4,
                  overflow: 'auto',
                  maxWidth: 296,
                }}
              >
{JSON.stringify(
  {
    clock: lastSnapshot.clock,
    period: lastSnapshot.period,
    score: `${lastSnapshot.homeScore}-${lastSnapshot.awayScore}`,
    homeExcl: lastSnapshot.homeExclusions,
    awayExcl: lastSnapshot.awayExclusions,
    horn: lastSnapshot.horn,
  },
  null,
  2,
)}
              </pre>
            </details>
          )}
          {/* Stream Deck / remote-cue setup hint. Surfacing the URL right
              on the bridge panel so a show caller setting up their
              Stream Deck the morning of the game finds it without
              digging through docs. */}
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer' }}>Stream Deck / remote cue setup</summary>
            <div style={{ marginTop: 4, color: '#cbd5e1', fontSize: 10, lineHeight: 1.5 }}>
              <div style={{ marginBottom: 4 }}>
                Configure a Stream Deck "Web Request" button to:
              </div>
              <code style={{ display: 'block', background: '#0f172a', padding: 6, borderRadius: 4, marginBottom: 4, wordBreak: 'break-all', fontSize: 9 }}>
                POST {apiRoot}/api/v1/screens/{screenId}/cts-manual-cue
              </code>
              <div style={{ marginBottom: 4 }}>
                Headers: <code>Authorization: Bearer YOUR_OPERATOR_TOKEN</code>
              </div>
              <div style={{ marginBottom: 4 }}>
                Body:
              </div>
              <code style={{ display: 'block', background: '#0f172a', padding: 6, borderRadius: 4, fontSize: 9 }}>
                {`{"cueId":"CEL_SOCCER_GOAL","team":"home"}`}
              </code>
              <div style={{ marginTop: 4, opacity: 0.75 }}>
                Available cue ids live in the ribbon template's Celebration Overlay zone → Properties panel.
              </div>
            </div>
          </details>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: '#fca5a5',
            wordBreak: 'break-word',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
