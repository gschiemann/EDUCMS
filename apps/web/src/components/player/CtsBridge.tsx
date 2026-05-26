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

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

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

  // Detect Web Serial availability once.
  useEffect(() => {
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
        <strong style={{ marginRight: 8 }}>CTS Bridge</strong>
        <span style={{ opacity: 0.7 }}>{status}</span>
      </div>

      {status !== 'connected' && (
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
      {status === 'connected' && (
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
