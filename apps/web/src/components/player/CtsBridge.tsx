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
  CtsWireParser,
  MockCtsFeed,
  REHEARSAL_SCRIPT,
  scriptGame,
  type CtsFullSnapshot,
  DaktronicsParser,
  type DaktronicsSnapshot,
  type DaktronicsSport,
  resolveConsoleProfile,
  type ConsoleProfile,
  type ConsoleProfileId,
  type SerialSettings,
} from '@cms/scoreboard-cts';
import { parseCtsClockToMs } from '@/lib/cts-merge';

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
  // 2026-05-27 — EP6N second-port native bridge. Same shape as the
  // primary ctsSerial* methods but addressed to port 2 (Phoenix
  // terminal RS232 #2 on the EP6N). The APK exposes these alongside
  // the primary ones whenever the device has more than one hardware
  // UART. Older APKs without dual-port support simply don't expose
  // them and the second-port code path stays dormant.
  ctsSerialEnabled2?: () => boolean;
  ctsSerialConnect2?: (
    devicePath: string,
    baudRate: number,
    dataBits: number,
    stopBits: number,
    parity: string,
  ) => string;
  ctsSerialDisconnect2?: () => string;
  ctsSerialStatus2?: () => string;
}

declare global {
  interface Window {
    EduCmsNative?: EduCmsNativeBridge;
    __ctsSerialBytes?: (base64: string) => void;
    /** Native APK bytes callback for the SECOND RS232 port. Wired up
     *  on mount when wiring.rs232_2 !== 'off'. */
    __ctsSerialBytes2?: (base64: string) => void;
  }
}

/** EP6N hardware-wiring config. Describes which logical role (CTS
 *  console / Elgato Stream Deck / debug-only aux) each native RS232
 *  port is wearing. The dashboard's WiringPanel writes this through
 *  PUT /api/v1/screens/:id; the manifest pushes it to the player and
 *  the bridge below opens the right number of ports with the right
 *  parser per port.
 *
 *  Backward-compat default: `{ rs232_1: 'cts', rs232_2: 'off' }` —
 *  the exact pre-EP6N single-port behavior. The bridge treats
 *  `undefined` wiring as that default. */
export type CtsBridgeWiring = {
  rs232_1?: 'cts' | 'streamdeck' | 'aux' | 'off';
  rs232_2?: 'cts' | 'streamdeck' | 'aux' | 'off';
};

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

// 5 Hz upper bound on snapshot POSTs (200 ms window). The CTS clock
// ticks at 10 Hz during the last minute (tenths shown); rendering at
// 5 Hz still produces a smooth scoreboard on a 4-foot LED ribbon and
// halves the write load on the gameId-keyed endpoint, which writes
// to `Game.stats.cts` (one Postgres row update per accepted snapshot).
//
// Why this matters more in gameId mode than in the legacy screen-scoped
// path: that path just signs + publishes a transient WS message, no DB
// write. The gameId-keyed endpoint persists the snapshot so the board
// /ribbon /scorebug routes can read it via the public /sports/board/:id
// poll. A higher POST rate is overkill — the board polls at 750 ms, so
// the snapshot only needs to be fresher than the next poll boundary.
//
// Latest-snapshot-wins during the throttle window.
const POST_THROTTLE_MS = 200;

/**
 * 2026-05-27 — Stream Deck text-line parser.
 *
 * The Elgato Stream Deck "Web Request" or a tiny on-device serial
 * sketch (Arduino, Teensy, RP2040) can emit one ASCII line per cue.
 * We accumulate bytes until `\n`, parse one line at a time, and
 * dispatch via the existing game-control endpoints — the same paths
 * the `useGameControl` hook in the dashboard's sports control page
 * uses. Two recognised forms:
 *
 *   CUE <key> [target]            → POST /sports/games/:id/cue
 *                                       body { key, target? }
 *   SCORE <±N> <team>             → PATCH /sports/games/:id/score
 *                                       body { delta: N, team }
 *
 * Examples (each ends in `\n`):
 *   CUE goal
 *   CUE save BOARD
 *   SCORE +1 home
 *   SCORE -2 away
 *
 * Unknown / malformed lines are logged silently and ignored — the
 * Stream Deck might be misconfigured but we don't want to crash the
 * board mid-game.
 */
type StreamDeckCmd =
  | { type: 'cue'; key: string; target?: string }
  | { type: 'score'; team: 'home' | 'away'; delta: number };

function parseStreamDeckLine(line: string): StreamDeckCmd | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const op = (parts[0] || '').toUpperCase();
  if (op === 'CUE') {
    const key = parts[1];
    if (!key) return null;
    const target = parts[2];
    return { type: 'cue', key, ...(target ? { target } : {}) };
  }
  if (op === 'SCORE') {
    const deltaRaw = parts[1];
    const teamRaw = (parts[2] || '').toLowerCase();
    if (!deltaRaw) return null;
    const delta = parseInt(deltaRaw, 10);
    if (!Number.isFinite(delta) || delta === 0) return null;
    if (teamRaw !== 'home' && teamRaw !== 'away') return null;
    return { type: 'score', team: teamRaw, delta };
  }
  return null;
}

/** Stateful line-buffer for one port. Stream Deck commands are
 *  newline-delimited ASCII; we accumulate raw bytes and yield one
 *  trimmed line at a time, even if the serial chunk boundary lands
 *  mid-line. */
class LineAccumulator {
  private buf = '';
  push(bytes: Uint8Array, onLine: (line: string) => void): void {
    // ASCII / UTF-8 — Stream Deck strings are 7-bit. atob/charCode
    // would also work; TextDecoder is fine because we never reset it.
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      if (c !== undefined) text += String.fromCharCode(c);
    }
    this.buf += text;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const raw = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      onLine(raw);
    }
    // Guard against a single very long bogus line eating memory.
    if (this.buf.length > 4096) {
      this.buf = this.buf.slice(-2048);
    }
  }
}

// T2-1: cadence multiplier for clockRunning derivation.  If the
// elapsed time since the last GAME_CLOCK packet exceeds the estimated
// inter-packet interval by this factor, we treat the clock as paused.
// 1.5× is conservative — at ~1000ms inter-packet (whole-second mode)
// we declare paused after 1.5 s; at ~100ms (tenths mode) after 150ms.
// A legitimate WiFi jitter spike rarely exceeds one full interval.
const CLOCK_PAUSE_FACTOR = 1.5;

// Minimum pause threshold in ms: protects against spurious pauses
// when the inter-packet estimate is very small (first two packets may
// arrive back-to-back).  900ms is the safe floor for whole-second
// cadence without triggering on normal gaps.
const CLOCK_PAUSE_MIN_MS = 900;

/**
 * Resolve the serial settings to open the port with.
 *
 * The base defaults come from the selected console profile
 * (`profile.serial`): CTS Gen 6 → 9600/8/E/1, Daktronics All Sport →
 * 19200/8/N/1. The existing `cts*` URL query params still override any
 * field on-site (kept for backward compat — the lead can hand-tune baud
 * / parity for an oddball console without a redeploy). A param left
 * unset falls through to the profile default, so a Daktronics deploy
 * with NO query params gets 19200/8/N/1 automatically.
 */
function readSerialOptsFromQuery(base: SerialSettings): {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
} {
  if (typeof window === 'undefined') {
    return { ...base };
  }
  const p = new URLSearchParams(window.location.search);
  const baudRate = parseInt(p.get('ctsBaud') || '', 10) || base.baudRate;
  const dataBitsRaw = parseInt(p.get('ctsDataBits') || '', 10) || base.dataBits;
  const dataBits: 7 | 8 = dataBitsRaw === 7 ? 7 : 8;
  const stopBitsRaw = parseInt(p.get('ctsStopBits') || '', 10) || base.stopBits;
  const stopBits: 1 | 2 = stopBitsRaw === 2 ? 2 : 1;
  const parityRaw = (p.get('ctsParity') || '').toLowerCase();
  const parity: 'none' | 'even' | 'odd' =
    parityRaw === 'none' || parityRaw === 'odd' || parityRaw === 'even'
      ? (parityRaw as 'none' | 'even' | 'odd')
      : base.parity;
  return { baudRate, dataBits, stopBits, parity };
}

export interface CtsBridgeProps {
  /** Screen ID this bridge is bound to. The legacy POST endpoint
   *  (`/screens/:id/game-state`) includes it. Still used as a fallback
   *  when no `gameId` is provided — broadcasts a transient WS GAME_STATE
   *  for the in-page CtsScoreboard widget consumer. */
  screenId: string;
  /** API root, e.g. https://api.example.com. No trailing /api/v1. */
  apiRoot: string;
  /** Device JWT for the screen — used as Bearer on the legacy
   *  `/screens/:id/game-state` POST. */
  deviceToken: string | null;
  /** 2026-05-27 — Sprint 13: the Game this CTS feed is targeting. When
   *  set together with `feedToken`, the bridge POSTs each snapshot to
   *  `/sports/board/:gameId/cts-snapshot` (persists to `Game.stats.cts`).
   *  The board / ribbon / scorebug surfaces then read this as the source
   *  of truth via the existing 750 ms public /board/:id poll.
   *
   *  When `gameId` is null/undefined, the bridge falls back to the
   *  transient WS GAME_STATE broadcast (legacy behavior). */
  gameId?: string | null;
  /** HMAC feed token for the gameId-keyed POST. Generated server-side
   *  via GET /sports/games/:id/feed-credentials; the operator pastes it
   *  in once during install (or the player manifest carries it). */
  feedToken?: string | null;
  /** 2026-05-27 — EP6N dual-RS232 wiring. The dashboard's WiringPanel
   *  writes this to `Screen.config.wiring`; the manifest pushes it
   *  through to the player which feeds it here. Defaults to
   *  `{ rs232_1: 'cts', rs232_2: 'off' }` for backward compatibility
   *  with every existing single-port install. */
  wiring?: CtsBridgeWiring;
  /** 2026-05-29 — which scoreboard console this kiosk is wired to.
   *  Selects BOTH the serial settings (CTS 9600/8/E/1 vs Daktronics
   *  19200/8/N/1) AND the parser. Defaults to 'cts-gen6' so every
   *  existing CTS install behaves exactly as before. Can also be set
   *  via the `?consoleProfile=` URL query param (the prop wins if both
   *  are present). */
  consoleProfile?: ConsoleProfileId;
  /** 2026-05-29 — for the Daktronics profile, which sport's RTD field
   *  map to decode against (football | basketball | baseball). Ignored
   *  by the CTS profile (CTS is water polo only). Defaults to
   *  'football'; can also be set via `?dakSport=` URL query param. */
  daktronicsSport?: DaktronicsSport;
  /** Compact mode: skip debug JSON pretty-print + last-bytes counter. */
  compact?: boolean;
}

export function CtsBridge({
  screenId,
  apiRoot,
  deviceToken,
  gameId,
  feedToken,
  wiring,
  consoleProfile,
  daktronicsSport,
  compact = false,
}: CtsBridgeProps) {
  // Resolve the wiring with the legacy single-port default.
  const rs232_1Role: 'cts' | 'streamdeck' | 'aux' | 'off' =
    wiring?.rs232_1 ?? 'cts';
  const rs232_2Role: 'cts' | 'streamdeck' | 'aux' | 'off' =
    wiring?.rs232_2 ?? 'off';

  // 2026-05-29 — Resolve the console profile (prop > query param >
  // default 'cts-gen6'). The profile carries the serial settings AND
  // tells us which decoder to drive. Resolved once per render; the
  // value is stable for a given install.
  const profileId: string | null | undefined =
    consoleProfile ??
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('consoleProfile')
      : null);
  const profile: ConsoleProfile = resolveConsoleProfile(profileId);
  const isDaktronics = profile.decoder === 'daktronics';
  // Hold the profile's serial settings in a ref so the connection-
  // lifecycle effects/callbacks below can read them WITHOUT taking a
  // dep on the (new-every-render) `profile.serial` object — those
  // effects must re-run only on nativeMode / role changes, never on a
  // profile-object identity churn. The values are install-constant.
  const serialBaseRef = useRef<SerialSettings>(profile.serial);
  serialBaseRef.current = profile.serial;
  // 2026-06-01 — the tty the native bridge opens by default now comes
  // from the profile (`uart` → /dev/ttyS1; `usb-serial` → /dev/ttyUSB0).
  // The WTTC profile feeds via an FTDI USB-serial adapter on a USB host
  // port (/dev/ttyUSB0); Gen 6 / Daktronics stay on the native UART
  // (/dev/ttyS1). `?ctsTty=` still overrides on-site. Held in a ref so
  // the connection-lifecycle effects read the install-constant value
  // without taking a dep on the new-every-render profile object.
  const defaultTtyRef = useRef<string>(profile.defaultTty);
  defaultTtyRef.current = profile.defaultTty;
  // Sport for the Daktronics decoder (prop > query param > 'football').
  const dakSport: DaktronicsSport =
    daktronicsSport ??
    (((typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('dakSport')
      : null) as DaktronicsSport | null) || 'football');
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bytesRead, setBytesRead] = useState<number>(0);
  const [lastSnapshot, setLastSnapshot] = useState<CtsFullSnapshot | null>(null);
  // 2026-05-29 — last decoded Daktronics snapshot (for the debug panel).
  const [lastDakSnapshot, setLastDakSnapshot] = useState<DaktronicsSnapshot | null>(null);
  const [postCount, setPostCount] = useState<number>(0);
  const [postLastStatus, setPostLastStatus] = useState<string | null>(null);

  const parserRef = useRef<CtsWireParser | null>(null);

  // ── Capture mode (2026-06-12, WTTC bring-up deliverable) ──────────
  // Records the RAW serial bytes (all roles, pre-decode) into a ring
  // buffer the operator downloads as a .bin — the artifact that
  // validates the Gen7/WA-2 decoder against the real console and
  // promotes the profile from 'provisional'. Auto-arms with
  // ?ctsCapture=1 so an install tech can start it from the URL alone.
  const CAPTURE_CAP_BYTES = 1_048_576; // 1MB ≈ many minutes at 9600-115200 baud
  const captureRef = useRef<number[] | null>(null);
  const captureLenRef = useRef(0);
  const [capturing, setCapturing] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('ctsCapture') === '1';
    } catch {
      return false;
    }
  });
  const [captureCount, setCaptureCount] = useState(0);
  useEffect(() => {
    if (capturing) {
      if (!captureRef.current) captureRef.current = [];
    }
    // Stopping keeps the buffer so the operator can still download it.
    const t = setInterval(() => setCaptureCount(captureLenRef.current), 1000);
    return () => clearInterval(t);
  }, [capturing]);
  const onDownloadCapture = useCallback(() => {
    const buf = captureRef.current;
    if (!buf || buf.length === 0) return;
    try {
      const blob = new Blob([Uint8Array.from(buf)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cts-capture-${Date.now()}.bin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch { /* download is operator-initiated; failure is visible */ }
  }, []);
  // 2026-05-29 — Daktronics All Sport RTD parser. Only instantiated +
  // fed when the resolved profile is the Daktronics one; null on a CTS
  // install so the CTS path is untouched. Exactly one of the two
  // parsers is live per bridge mount.
  const dakParserRef = useRef<DaktronicsParser | null>(null);
  const portRef = useRef<SerialPortLite | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const disposedRef = useRef<boolean>(false);

  // ── Web Serial auto-reconnect (2026-06-12, sports-venue audit P1) ──
  // A kicked/replugged console cable used to kill the bridge until a
  // human touched the kiosk: the 'disconnect' listener only set status,
  // and the getPorts() auto-attach ran once on mount. After any
  // UNEXPECTED drop we now poll getPorts() every 3s and reopen the
  // re-granted port (replugging the same dongle needs no user gesture —
  // the origin's grant persists). Operator-initiated Disconnect sets
  // manualStopRef so the watcher never fights a human.
  const manualStopRef = useRef(false);
  const reconnectTimersRef = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());
  const scheduleReconnectRef = useRef<(portIndex: 1 | 2, role: 'cts' | 'streamdeck' | 'aux' | 'off') => void>(() => {});
  const [reconnectArmed, setReconnectArmed] = useState(false);
  const pendingSnapshotRef = useRef<CtsFullSnapshot | null>(null);
  const postTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPostAtRef = useRef<number>(0);
  // 2026-05-29 — Daktronics POST throttle state (parallel to the CTS
  // refs above; same latest-wins throttle, separate pending slot so the
  // two snapshot types never alias).
  const pendingDakSnapshotRef = useRef<DaktronicsSnapshot | null>(null);
  const dakPostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDakPostAtRef = useRef<number>(0);

  // 2026-05-27 — EP6N dual-RS232. Each port maintains its OWN line
  // accumulator (Stream Deck) and its own port handles. The CtsParser
  // is shared with whichever port carries the 'cts' role — only one
  // port can carry CTS at a time (the protocol's stateful parser is
  // not reentrant across two independent feeds). Roles 'streamdeck'
  // and 'aux' are stateless per-line and trivially parallel.
  const port2Ref = useRef<SerialPortLite | null>(null);
  const reader2Ref = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const streamDeckLines1Ref = useRef<LineAccumulator | null>(null);
  const streamDeckLines2Ref = useRef<LineAccumulator | null>(null);
  // Status the panel surfaces for the second port. The shared
  // `status` variable above still tracks port 1 to preserve the
  // existing connect/disconnect UX.
  const [status2, setStatus2] = useState<Status>('idle');
  const [bytesRead2, setBytesRead2] = useState<number>(0);
  // Count of Stream Deck commands successfully dispatched, surfaced
  // in the debug panel so the operator can confirm wiring without a
  // multimeter (just press a button on the Stream Deck — counter
  // ticks).
  const [streamDeckCmds, setStreamDeckCmds] = useState<number>(0);
  // Last Stream Deck line received (any port), for operator sanity
  // when the dispatcher rejects malformed lines silently.
  const [lastStreamDeckLine, setLastStreamDeckLine] = useState<string | null>(null);
  // T2-1 (2026-05-27) — derive a running/paused bit from GAME_CLOCK
  // packet cadence rather than display-string mutation.
  //
  // Old approach (CLOCK_PAUSE_MS = 800ms): compared the displayed clock
  // string to the prior reading.  At whole-second granularity (>1:00)
  // the CTS console emits one packet per second, so a legitimately
  // running clock had a gap of ~1000ms — longer than 800ms — and the
  // old code false-reported `clockRunning: false` on every whole-second
  // tick.
  //
  // New approach: the CtsParser now tracks the last two GAME_CLOCK
  // packet timestamps.  We compare `Date.now()` against the last
  // packet timestamp + (interval × 1.5).  At sub-minute cadence
  // (~100ms interval) the pause is detected within ~150ms; at
  // whole-second cadence (~1000ms) within ~1.5s — correct in both
  // modes.  The parser ref below is stable across renders (the
  // CtsParser instance is created once per bridge mount).
  //
  // `parserRef` is declared later in this component; the clockRunning
  // derivation runs inline in the POST function and reads the parser
  // directly — no separate ref needed here.
  // (This comment block replaces the old prevClockRef; delete when
  // the logic below is understood.)

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

  // Initialize the parser for the selected console profile.
  //   - CTS profile     → CtsWireParser (real classic / Gen7-WA2 decode)
  //   - Daktronics      → DaktronicsParser (All Sport RTD buffer decoder)
  // Exactly one is live. Stream Deck line accumulators are profile-
  // independent (cue text is the same regardless of which scoreboard
  // console is on the other port).
  useEffect(() => {
    if (isDaktronics) {
      dakParserRef.current = new DaktronicsParser({ sport: dakSport });
      parserRef.current = null;
    } else {
      // 2026-06-12 real-wire cutover: CtsWireParser decodes the REAL
      // framing (classic, validated vs real console captures; or the
      // WTTC's Gen7/WA-2 RS-485 stream) per the profile's `wire` field.
      // Same public API the old CtsParser exposed — feed/onUpdate/
      // getState/reset/flush + the clock-cadence surface.
      parserRef.current = new CtsWireParser({ wire: profile.wire ?? 'classic' });
      dakParserRef.current = null;
    }
    streamDeckLines1Ref.current = new LineAccumulator();
    streamDeckLines2Ref.current = new LineAccumulator();
    return () => {
      parserRef.current = null;
      dakParserRef.current = null;
      streamDeckLines1Ref.current = null;
      streamDeckLines2Ref.current = null;
    };
  }, [isDaktronics, dakSport, profile.wire]);

  /**
   * 2026-05-27 — dispatch a Stream Deck command via the same
   * endpoints the dashboard's `useGameControl` hook calls
   * (POST /sports/games/:id/cue, PATCH /sports/games/:id/score).
   * Requires `gameId` + `feedToken` — without them we can't address
   * a game and the command is silently dropped (the operator hasn't
   * wired the kiosk to a game yet).
   */
  const dispatchStreamDeckCmd = useCallback(
    async (cmd: StreamDeckCmd) => {
      if (!gameId || !feedToken) return; // no game bound — drop
      try {
        if (cmd.type === 'cue') {
          await fetch(
            `${apiRoot}/api/v1/sports/games/${encodeURIComponent(gameId)}/cue`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-feed-token': feedToken,
              },
              body: JSON.stringify({
                key: cmd.key,
                ...(cmd.target ? { target: cmd.target } : {}),
              }),
              keepalive: true,
            },
          );
        } else if (cmd.type === 'score') {
          await fetch(
            `${apiRoot}/api/v1/sports/games/${encodeURIComponent(gameId)}/score`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-feed-token': feedToken,
              },
              body: JSON.stringify({ team: cmd.team, delta: cmd.delta }),
              keepalive: true,
            },
          );
        }
        setStreamDeckCmds((n) => n + 1);
      } catch {
        // Network blip — Stream Deck commands are fire-and-forget at
        // the operator level (they'll press the button again if the
        // celebration doesn't fire). No retry storm.
      }
    },
    [apiRoot, gameId, feedToken],
  );

  /**
   * Route bytes from one port into the right pipeline based on the
   * port's role. CTS bytes feed the shared CtsParser; Stream Deck
   * bytes split into newline-delimited lines and dispatch as cue /
   * score commands; AUX bytes get logged to the console for the
   * operator running the install kit. 'off' = no-op (the port was
   * never opened, so this shouldn't get called).
   *
   * `portIndex` (1 or 2) just selects the matching line-accumulator
   * — each port carries its OWN serial chunk-boundary state.
   */
  const routeBytes = useCallback(
    (portIndex: 1 | 2, role: 'cts' | 'streamdeck' | 'aux' | 'off', bytes: Uint8Array) => {
      if (role === 'off' || bytes.length === 0) return;
      // Capture tap — raw bytes, every role, BEFORE any decode. Ring-
      // buffered so an hours-long bring-up can't grow unbounded.
      const cap = captureRef.current;
      if (cap) {
        for (let i = 0; i < bytes.length; i++) cap.push(bytes[i]);
        if (cap.length > CAPTURE_CAP_BYTES) cap.splice(0, cap.length - CAPTURE_CAP_BYTES);
        captureLenRef.current = cap.length;
      }
      if (role === 'cts') {
        // The 'cts' wiring role means "this port carries the scoreboard
        // console" — which console it actually is depends on the
        // resolved profile. Feed the live parser (CtsParser OR
        // DaktronicsParser). Only one is non-null per mount.
        if (dakParserRef.current) dakParserRef.current.feed(bytes);
        else parserRef.current?.feed(bytes);
        return;
      }
      if (role === 'streamdeck') {
        const acc = portIndex === 1
          ? streamDeckLines1Ref.current
          : streamDeckLines2Ref.current;
        if (!acc) return;
        acc.push(bytes, (line) => {
          setLastStreamDeckLine(line.slice(0, 80));
          const cmd = parseStreamDeckLine(line);
          if (cmd) void dispatchStreamDeckCmd(cmd);
        });
        return;
      }
      if (role === 'aux') {
        // Debug-only: log byte counts + first 32 chars. Never sent
        // anywhere; just helps the install tech verify cabling.
        try {
          const head = Array.from(bytes.slice(0, 32))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ');
          // eslint-disable-next-line no-console
          console.log(`[CtsBridge aux port${portIndex}] ${bytes.length}B: ${head}`);
        } catch { /* ignore */ }
      }
    },
    [dispatchStreamDeckCmd],
  );

  // Sprint 13 Phase 2 — native serial bytes path. The APK calls
  // `window.__ctsSerialBytes(base64)` for every chunk it reads from
  // the Phoenix-terminal RS232 port. We decode + feed through the
  // role router (CTS parser / Stream Deck line accumulator / aux
  // logger) selected by `rs232_1Role`. Setup is conditional so
  // non-Player browsers don't get a phantom global hook.
  useEffect(() => {
    if (!nativeMode) return;
    if (rs232_1Role === 'off') return;
    window.__ctsSerialBytes = (b64: string) => {
      try {
        const bytes = b64ToBytes(b64);
        if (bytes.length === 0) return;
        routeBytes(1, rs232_1Role, bytes);
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
  }, [nativeMode, rs232_1Role, routeBytes]);

  // 2026-05-27 — EP6N second-port native bytes path. Same shape as
  // port 1 but reads from `window.__ctsSerialBytes2`, mounted only
  // when the operator wired a role to port 2.
  useEffect(() => {
    if (!nativeMode) return;
    if (rs232_2Role === 'off') return;
    window.__ctsSerialBytes2 = (b64: string) => {
      try {
        const bytes = b64ToBytes(b64);
        if (bytes.length === 0) return;
        routeBytes(2, rs232_2Role, bytes);
        setBytesRead2((n) => n + bytes.length);
      } catch (e) {
        setError(`Native bytes2 decode failed: ${(e as Error).message}`);
      }
    };
    return () => {
      if (typeof window !== 'undefined' && window.__ctsSerialBytes2) {
        delete window.__ctsSerialBytes2;
      }
    };
  }, [nativeMode, rs232_2Role, routeBytes]);

  // Sprint 13 Phase 2 — native auto-connect on mount. The operator
  // configured tty path + baud + parity once in APK settings (or via
  // the URL query params for ad-hoc testing); we open + start reading
  // immediately so the operator doesn't have to click anything on the
  // kiosk. Cable yanks are recovered via the status poll below.
  //
  // 2026-05-27 — when rs232_1Role is 'off' (operator wired all the
  // traffic to port 2), we skip the auto-connect so we don't sit on
  // a tty the operator might want for something else.
  useEffect(() => {
    if (!nativeMode) return;
    if (rs232_1Role === 'off') return;
    const n = window.EduCmsNative;
    if (!n?.ctsSerialConnect) return;
    const opts = readSerialOptsFromQuery(serialBaseRef.current);
    // tty path comes from URL query (?ctsTty=/dev/ttyUSB0) or defaults
    // to the selected profile's tty — /dev/ttyS1 for native-UART consoles
    // (Gen 6 / Daktronics) or /dev/ttyUSB0 for the WTTC's USB-serial
    // (FTDI) feed. APK settings UI (Phase 3) will let the operator pick
    // this from a list of probed devices.
    const tty = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('ctsTty') || defaultTtyRef.current)
      : defaultTtyRef.current;
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
  }, [nativeMode, rs232_1Role]);

  // 2026-05-27 — EP6N port-2 native auto-connect. Mirrors port-1's
  // setup but addresses /dev/ttyS2 (the second Phoenix-terminal
  // RS232) via the ctsSerialConnect2 method. Older Player APKs that
  // don't expose the dual-port methods silently skip this effect —
  // the wiring still works, just only the first port is open.
  useEffect(() => {
    if (!nativeMode) return;
    if (rs232_2Role === 'off') return;
    const n = window.EduCmsNative;
    if (!n?.ctsSerialConnect2) {
      // Older single-port APK — log the wiring mismatch so the
      // operator knows to update the APK to v2.x.
      // eslint-disable-next-line no-console
      console.warn('[CtsBridge] wiring.rs232_2 set but APK has no ctsSerialConnect2 — update Player APK to enable second port.');
      return;
    }
    const opts = readSerialOptsFromQuery(serialBaseRef.current);
    const tty = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('ctsTty2') || '/dev/ttyS2')
      : '/dev/ttyS2';
    setStatus2('connecting');
    try {
      const resp = n.ctsSerialConnect2(tty, opts.baudRate, opts.dataBits, opts.stopBits, opts.parity);
      const parsed = JSON.parse(resp || '{}');
      if (parsed.ok) {
        setStatus2('connected');
      } else {
        setStatus2('error');
        setError(`port2 ${parsed.code || 'error'}: ${parsed.message || 'connect failed'}`);
      }
    } catch (e) {
      setStatus2('error');
      setError(`Native port2 connect failed: ${(e as Error).message}`);
    }
    return () => {
      try { window.EduCmsNative?.ctsSerialDisconnect2?.(); } catch { /* ignore */ }
    };
  }, [nativeMode, rs232_2Role]);

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
            const opts = readSerialOptsFromQuery(serialBaseRef.current);
            const tty = new URLSearchParams(window.location.search).get('ctsTty') || defaultTtyRef.current;
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
  //
  // Two destinations, picked at runtime:
  //   1. gameId + feedToken set → `POST /sports/board/:gameId/cts-snapshot`
  //      Persists the snapshot under `Game.stats.cts`; the board /
  //      ribbon / scorebug routes pick it up via the existing 750 ms
  //      public /board/:id poll. This is the Sprint 13 source-of-truth
  //      path — what the operator wants when the CTS console is
  //      broadcasting AND there's an active game in the dashboard.
  //   2. Otherwise → legacy `POST /screens/:id/game-state`. Pure
  //      transient WS broadcast for the in-page CtsScoreboard widget
  //      consumer; no persistence. Kept for backward compatibility
  //      with kiosks that haven't migrated to game-mode yet.
  //
  // The two paths are mutually exclusive per snapshot — we don't double-
  // write because the legacy WS-only path is now strictly weaker than
  // the persistent path (the persistent path is also broadcast via the
  // board cache invalidation + 750 ms poll which lands within the same
  // perceived window).
  const flushPost = useCallback(async () => {
    if (disposedRef.current) return;
    const snap = pendingSnapshotRef.current;
    if (!snap) return;
    pendingSnapshotRef.current = null;
    lastPostAtRef.current = Date.now();

    // gameId mode — persist to Game.stats.cts via the public board
    // endpoint, authenticated with the HMAC feed token.
    if (gameId && feedToken) {
      // T2-1: Cadence-based clockRunning derivation.
      //
      // The CTS protocol has no explicit "clock running" bit.  The
      // CtsParser now tracks the wall-clock timestamps of the last two
      // GAME_CLOCK (0x01) packets via `getLastClockPacketAt()` and
      // `getClockPacketIntervalMs()`.  We derive `clockRunning` by
      // comparing elapsed time since the last packet to the estimated
      // inter-packet interval × CLOCK_PAUSE_FACTOR:
      //
      //   • At sub-minute (tenths mode): interval ≈ 100ms;
      //     pause detected after ~150ms.
      //   • At whole-second: interval ≈ 1000ms; pause detected
      //     after ~1500ms.
      //   • Before two packets seen (intervalMs = 0): fall back
      //     to CLOCK_PAUSE_MIN_MS as a safe default.
      //
      // This replaces the old 800ms display-string-changed heuristic
      // that false-paused at every whole-second tick.
      const parser = parserRef.current;
      let clockRunning: boolean | undefined;
      if (parser && typeof snap.clock === 'string') {
        const now = Date.now();
        const lastPacketAt = parser.getLastClockPacketAt();
        const intervalMs = parser.getClockPacketIntervalMs();
        if (lastPacketAt > 0) {
          const threshold =
            intervalMs > 0
              ? Math.max(intervalMs * CLOCK_PAUSE_FACTOR, CLOCK_PAUSE_MIN_MS)
              : CLOCK_PAUSE_MIN_MS;
          clockRunning = now - lastPacketAt < threshold;
        }
      }

      // T2-1: Derive clockRunning flag for shot clocks.  Shot clocks
      // only count when the game clock is counting, so we use the same
      // derived `clockRunning` value.  The parser emits `running: true`
      // when ms > 0; we override with false when the game clock is
      // paused.
      const shotClockRunning = clockRunning ?? false;
      const homeSc = snap.homeShotClock;
      const awaySc = snap.awayShotClock;

      const body: Record<string, unknown> = {
        clockMs: parseCtsClockToMs(snap.clock) ?? undefined,
        clockRunning,
        segment: typeof snap.period === 'number' ? snap.period : undefined,
        homeScore: typeof snap.homeScore === 'number' ? snap.homeScore : undefined,
        awayScore: typeof snap.awayScore === 'number' ? snap.awayScore : undefined,
        horn: snap.horn === true ? true : undefined,
        raw: typeof snap.clock === 'string' ? snap.clock : undefined,
        // T2-1: per-side shot clocks (previously silently dropped).
        homeShotClock:
          homeSc && (homeSc.raw !== '' || homeSc.ms > 0)
            ? { ms: homeSc.ms, running: homeSc.ms > 0 && shotClockRunning, raw: homeSc.raw }
            : undefined,
        awayShotClock:
          awaySc && (awaySc.raw !== '' || awaySc.ms > 0)
            ? { ms: awaySc.ms, running: awaySc.ms > 0 && shotClockRunning, raw: awaySc.raw }
            : undefined,
        // T2-1: exclusions — send as nullable 3-slot arrays so the
        // server can merge into stats.penalties with source:'cts'.
        // We always send all 3 slots (null = empty) so the server can
        // clear stale exclusion data when a player exits the box.
        homeExclusions: [
          snap.homeExclusions[0] ?? null,
          snap.homeExclusions[1] ?? null,
          snap.homeExclusions[2] ?? null,
        ],
        awayExclusions: [
          snap.awayExclusions[0] ?? null,
          snap.awayExclusions[1] ?? null,
          snap.awayExclusions[2] ?? null,
        ],
        // T2-1: timeouts remaining (previously silently dropped).
        homeTimeoutsRemaining:
          typeof snap.homeTimeoutsRemaining === 'number'
            ? snap.homeTimeoutsRemaining
            : undefined,
        awayTimeoutsRemaining:
          typeof snap.awayTimeoutsRemaining === 'number'
            ? snap.awayTimeoutsRemaining
            : undefined,
      };
      try {
        const res = await fetch(
          `${apiRoot}/api/v1/sports/board/${encodeURIComponent(gameId)}/cts-snapshot`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-feed-token': feedToken,
            },
            body: JSON.stringify(body),
            keepalive: true,
          },
        );
        setPostCount((n) => n + 1);
        setPostLastStatus(`${res.status}`);
      } catch (e) {
        setPostLastStatus(`err: ${(e as Error).message}`);
      }
      return;
    }

    // Legacy WS-broadcast path — used when no game is bound.
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
  }, [apiRoot, deviceToken, screenId, gameId, feedToken]);

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

  // Subscribe the CTS parser → schedule POST.
  useEffect(() => {
    const parser = parserRef.current;
    if (!parser) return;
    const unsub = parser.onUpdate((snap) => {
      schedulePost(snap);
    });
    return unsub;
  }, [schedulePost]);

  // 2026-05-29 — POST a Daktronics snapshot. Maps the normalized
  // DaktronicsSnapshot onto the SAME body shape the CTS path posts, so
  // the server / board / ribbon / scorebug surfaces never care which
  // console produced the data. Same two destinations (gameId-keyed
  // persistent path vs legacy WS broadcast), same keepalive semantics,
  // same latest-wins throttle.
  //
  // Key difference vs CTS: the All Sport has an EXPLICIT clock-stopped
  // flag, so `clockRunning` comes straight off the snapshot — no
  // cadence-based derivation needed (that was a CTS-only workaround
  // because CTS has no running bit).
  const flushDakPost = useCallback(async () => {
    if (disposedRef.current) return;
    const snap = pendingDakSnapshotRef.current;
    if (!snap) return;
    pendingDakSnapshotRef.current = null;
    lastDakPostAtRef.current = Date.now();

    if (gameId && feedToken) {
      // Sport-specific extension blob, kept under a namespaced key so
      // the server can store it in stats without colliding with CTS's
      // water-polo fields.
      const sportExtra: Record<string, unknown> =
        snap.sport === 'football' && snap.football
          ? {
              down: snap.football.down || undefined,
              toGo: snap.football.toGo || undefined,
              ballOn: snap.football.ballOn || undefined,
              possession: snap.football.possession ?? undefined,
              playClock: snap.football.playClock || undefined,
            }
          : snap.sport === 'basketball' && snap.basketball
            ? {
                homeTeamFouls: snap.basketball.homeTeamFouls || undefined,
                guestTeamFouls: snap.basketball.guestTeamFouls || undefined,
                homeBonus: snap.basketball.homeBonus || undefined,
                homeDoubleBonus: snap.basketball.homeDoubleBonus || undefined,
                guestBonus: snap.basketball.guestBonus || undefined,
                guestDoubleBonus: snap.basketball.guestDoubleBonus || undefined,
                possession: snap.basketball.possession ?? undefined,
                shotClock: snap.basketball.shotClock || undefined,
              }
            : snap.sport === 'baseball' && snap.baseball
              ? {
                  balls: snap.baseball.balls || undefined,
                  strikes: snap.baseball.strikes || undefined,
                  outs: snap.baseball.outs || undefined,
                  atBat: snap.baseball.atBat ?? undefined,
                  homeHits: snap.baseball.homeHits || undefined,
                  awayHits: snap.baseball.awayHits || undefined,
                  homeErrors: snap.baseball.homeErrors || undefined,
                  awayErrors: snap.baseball.awayErrors || undefined,
                  batterNumber: snap.baseball.batterNumber || undefined,
                }
              : {};

      const body: Record<string, unknown> = {
        clockMs: parseCtsClockToMs(snap.clock) ?? undefined,
        clockRunning: snap.clockRunning,
        segment: typeof snap.period === 'number' ? snap.period : undefined,
        homeScore: typeof snap.homeScore === 'number' ? snap.homeScore : undefined,
        awayScore: typeof snap.awayScore === 'number' ? snap.awayScore : undefined,
        horn: snap.horn === true ? true : undefined,
        raw: typeof snap.clock === 'string' ? snap.clock : undefined,
        homeTimeoutsRemaining:
          typeof snap.homeTimeoutsRemaining === 'number'
            ? snap.homeTimeoutsRemaining
            : undefined,
        awayTimeoutsRemaining:
          typeof snap.awayTimeoutsRemaining === 'number'
            ? snap.awayTimeoutsRemaining
            : undefined,
        // Provenance + sport-specific data. `source: 'daktronics'` lets
        // the server-side merge distinguish console families if it ever
        // needs to; today it's stored alongside the normalized fields.
        source: 'daktronics',
        sport: snap.sport,
        daktronics: sportExtra,
      };
      try {
        const res = await fetch(
          `${apiRoot}/api/v1/sports/board/${encodeURIComponent(gameId)}/cts-snapshot`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-feed-token': feedToken,
            },
            body: JSON.stringify(body),
            keepalive: true,
          },
        );
        setPostCount((n) => n + 1);
        setPostLastStatus(`${res.status}`);
      } catch (e) {
        setPostLastStatus(`err: ${(e as Error).message}`);
      }
      return;
    }

    // Legacy WS-broadcast path — no game bound.
    try {
      const res = await fetch(
        `${apiRoot}/api/v1/screens/${encodeURIComponent(screenId)}/game-state`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {}),
          },
          body: JSON.stringify({ source: 'daktronics', snapshot: snap }),
          keepalive: true,
        },
      );
      setPostCount((n) => n + 1);
      setPostLastStatus(`${res.status}`);
    } catch (e) {
      setPostLastStatus(`err: ${(e as Error).message}`);
    }
  }, [apiRoot, deviceToken, screenId, gameId, feedToken]);

  const scheduleDakPost = useCallback(
    (snap: DaktronicsSnapshot) => {
      pendingDakSnapshotRef.current = snap;
      setLastDakSnapshot(snap);
      const elapsed = Date.now() - lastDakPostAtRef.current;
      if (elapsed >= POST_THROTTLE_MS) {
        flushDakPost();
      } else if (dakPostTimerRef.current === null) {
        dakPostTimerRef.current = setTimeout(() => {
          dakPostTimerRef.current = null;
          flushDakPost();
        }, POST_THROTTLE_MS - elapsed);
      }
    },
    [flushDakPost],
  );

  // Subscribe the Daktronics parser → schedule POST.
  useEffect(() => {
    const parser = dakParserRef.current;
    if (!parser) return;
    const unsub = parser.onUpdate((snap) => {
      scheduleDakPost(snap);
    });
    return unsub;
  }, [scheduleDakPost]);

  // Read loop: pump bytes from the port's readable stream through
  // the role router (CTS parser / Stream Deck lines / aux logger).
  // Returns when the stream ends (port closed / disconnect).
  //
  // `portIndex` selects which port's per-port state we touch
  // (reader handle, bytes-read counter, line accumulator). `role`
  // picks the parser. The router itself is a pure function — same
  // bytes, different downstream paths.
  const runReadLoop = useCallback(
    async (
      port: SerialPortLite,
      portIndex: 1 | 2,
      role: 'cts' | 'streamdeck' | 'aux' | 'off',
    ) => {
      if (!port.readable) {
        setError('Port readable stream is null');
        return;
      }
      const reader = port.readable.getReader();
      if (portIndex === 1) readerRef.current = reader;
      else reader2Ref.current = reader;
      try {
        while (!disposedRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) {
            routeBytes(portIndex, role, value);
            if (portIndex === 1) setBytesRead((n) => n + value.length);
            else setBytesRead2((n) => n + value.length);
          }
        }
      } catch (e) {
        // Stream errors (cable yanked) bubble here.
        setError(`Port ${portIndex} read error: ${(e as Error).message}`);
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        if (portIndex === 1) readerRef.current = null;
        else reader2Ref.current = null;
      }
    },
    [routeBytes],
  );

  // Open + start reading from a port. Sets status / error along the way.
  // 2026-05-27 — generalized to handle port 1 OR port 2 with the
  // matching role. The Web Serial picker calls this for each port the
  // operator wires.
  const openAndRun = useCallback(
    async (
      port: SerialPortLite,
      portIndex: 1 | 2 = 1,
      role: 'cts' | 'streamdeck' | 'aux' | 'off' = rs232_1Role,
    ) => {
      const setStat = portIndex === 1 ? setStatus : setStatus2;
      try {
        setStat('connecting');
        setError(null);
        const opts = readSerialOptsFromQuery(serialBaseRef.current);
        await port.open(opts);
        if (portIndex === 1) portRef.current = port;
        else port2Ref.current = port;
        setStat('connected');
        // Listen for hardware disconnect (cable yanked).
        const onDisconnect = () => {
          setStat('disconnected');
        };
        try { port.addEventListener?.('disconnect', onDisconnect); } catch { /* ignore */ }
        // Pump until the read loop returns (port closed) or we're disposed.
        await runReadLoop(port, portIndex, role);
        try { port.removeEventListener?.('disconnect', onDisconnect); } catch { /* ignore */ }
        // Try to close cleanly. Errors here are non-fatal.
        try { await port.close(); } catch { /* ignore */ }
        if (portIndex === 1) portRef.current = null;
        else port2Ref.current = null;
        if (!disposedRef.current) {
          setStat('disconnected');
          scheduleReconnectRef.current(portIndex, role);
        }
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        setStat('error');
        if (!disposedRef.current) scheduleReconnectRef.current(portIndex, role);
      }
    },
    [runReadLoop, rs232_1Role],
  );

  // Reconnect watcher body — defined after openAndRun (it reopens via it),
  // published through scheduleReconnectRef so openAndRun's tail can call it.
  const scheduleReconnect = useCallback(
    (portIndex: 1 | 2, role: 'cts' | 'streamdeck' | 'aux' | 'off') => {
      if (disposedRef.current || manualStopRef.current) return;
      if (nativeMode || role === 'off') return; // native path has its own retry
      const timers = reconnectTimersRef.current;
      if (timers.has(portIndex)) return; // already watching this port
      setReconnectArmed(true);
      const t = setInterval(async () => {
        if (disposedRef.current || manualStopRef.current) {
          clearInterval(t);
          timers.delete(portIndex);
          if (timers.size === 0) setReconnectArmed(false);
          return;
        }
        try {
          const nav = navigator as unknown as SerialNavigatorLite;
          const ports = (await nav.serial?.getPorts?.()) || [];
          const port = ports[portIndex - 1] ?? ports[0];
          if (!port) return; // still unplugged — keep polling
          clearInterval(t);
          timers.delete(portIndex);
          if (timers.size === 0) setReconnectArmed(false);
          // openAndRun's tail re-schedules if this open fails — so a
          // half-seated plug keeps retrying at the same 3s cadence.
          await openAndRun(port, portIndex, role);
        } catch { /* keep polling */ }
      }, 3000);
      timers.set(portIndex, t);
    },
    [nativeMode, openAndRun],
  );
  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  // On mount, try to reconnect to any previously-granted port. This
  // is the "game day morning" path — the operator paired the kiosk
  // months ago, no human is on-site to click Connect.
  //
  // 2026-05-27 — dual-port note. Web Serial's `getPorts()` returns
  // every port the origin has been granted. We only auto-attach the
  // FIRST granted port to logical port 1 (port 2 is wired via the
  // explicit "Connect port 2" button), so a dev box with one CTS
  // dongle still behaves exactly like before. Operators that pre-
  // granted two USB-serial dongles can wire them via Connect 1 /
  // Connect 2 after reload (Web Serial doesn't carry stable port
  // identity across reloads — it's a deliberate platform decision).
  useEffect(() => {
    if (supported !== true) return;
    if (nativeMode) return; // native auto-connect handles it
    if (rs232_1Role === 'off') return;
    let cancelled = false;
    (async () => {
      try {
        const nav = navigator as unknown as SerialNavigatorLite;
        const ports = (await nav.serial?.getPorts?.()) || [];
        if (cancelled) return;
        if (ports.length > 0) {
          const port = ports[0];
          if (!port) return;
          await openAndRun(port, 1, rs232_1Role);
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
  }, [supported, openAndRun, nativeMode, rs232_1Role]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      for (const t of reconnectTimersRef.current.values()) clearInterval(t);
      reconnectTimersRef.current.clear();
      if (postTimerRef.current) {
        clearTimeout(postTimerRef.current);
        postTimerRef.current = null;
      }
      // Stop the sample-game simulator if it's running.
      if (simAbortRef.current) simAbortRef.current.aborted = true;
      simAbortRef.current = null;
      try { readerRef.current?.cancel().catch(() => undefined); } catch { /* ignore */ }
      try { portRef.current?.close().catch(() => undefined); } catch { /* ignore */ }
      try { reader2Ref.current?.cancel().catch(() => undefined); } catch { /* ignore */ }
      try { port2Ref.current?.close().catch(() => undefined); } catch { /* ignore */ }
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
      manualStopRef.current = false; // operator re-engaged — re-arm auto-reconnect
      const stale1 = reconnectTimersRef.current.get(1);
      if (stale1) { clearInterval(stale1); reconnectTimersRef.current.delete(1); }
      const port = await nav.serial.requestPort();
      await openAndRun(port, 1, rs232_1Role);
    } catch (e) {
      // User clicked Cancel on the picker.
      if ((e as Error).name === 'NotFoundError') {
        // Quiet — that's a normal "they backed out" gesture.
        return;
      }
      setError(`Request port failed: ${(e as Error).message}`);
      setStatus('error');
    }
  }, [supported, openAndRun, rs232_1Role]);

  // 2026-05-27 — Manual connect for the SECOND port (Web Serial only,
  // dev / Beelink scenario). On native EP6N the second port auto-
  // connects via ctsSerialConnect2 — this button is here purely for
  // local desktop development with two USB-serial dongles.
  const onConnect2 = useCallback(async () => {
    if (supported !== true) return;
    if (rs232_2Role === 'off') return;
    const nav = navigator as unknown as SerialNavigatorLite;
    if (!nav.serial) return;
    try {
      manualStopRef.current = false;
      const stale2 = reconnectTimersRef.current.get(2);
      if (stale2) { clearInterval(stale2); reconnectTimersRef.current.delete(2); }
      const port = await nav.serial.requestPort();
      await openAndRun(port, 2, rs232_2Role);
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') return;
      setError(`Request port2 failed: ${(e as Error).message}`);
      setStatus2('error');
    }
  }, [supported, openAndRun, rs232_2Role]);

  // Manual disconnect (operator click).
  const onDisconnect = useCallback(async () => {
    manualStopRef.current = true; // operator intent — don't auto-reconnect
    try { readerRef.current?.cancel().catch(() => undefined); } catch { /* ignore */ }
    // The read loop will exit and `openAndRun` will close + null the port.
  }, []);
  const onDisconnect2 = useCallback(async () => {
    manualStopRef.current = true;
    try { reader2Ref.current?.cancel().catch(() => undefined); } catch { /* ignore */ }
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
          {isDaktronics ? `Daktronics (${dakSport})` : 'CTS'} Bridge{nativeMode ? ' · ECBox' : ''}{gameId && feedToken ? ' · game' : ''}
        </strong>
        <span style={{ opacity: 0.7 }}>
          P1:{rs232_1Role} {status}
          {reconnectArmed ? ' · auto-reconnect armed' : ''}
        </span>
      </div>

      {/* 2026-05-27 — EP6N port 2 status row. Only renders when the
          operator wired port 2 to a non-off role. Mirrors the port 1
          status dot so the operator can see both ports at a glance. */}
      {rs232_2Role !== 'off' && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: ({
                connected: '#22c55e',
                connecting: '#f59e0b',
                disconnected: '#f59e0b',
                idle: '#94a3b8',
                error: '#ef4444',
              } as Record<Status, string>)[status2],
              marginRight: 8,
            }}
          />
          <span style={{ opacity: 0.7 }}>P2:{rs232_2Role} {status2}</span>
        </div>
      )}

      {/* Capture mode — bring-up byte recorder (see refs above). */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setCapturing((c) => !c)}
          style={{
            background: capturing ? '#dc2626' : '#334155',
            color: 'white',
            border: 'none',
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            marginRight: 6,
          }}
        >
          {capturing ? '■ Stop capture' : '● Capture bytes'}
        </button>
        {captureCount > 0 && (
          <button
            type="button"
            onClick={onDownloadCapture}
            style={{
              background: '#0e7490',
              color: 'white',
              border: 'none',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              marginRight: 6,
            }}
          >
            ↓ Save .bin ({Math.round(captureCount / 1024)} KB)
          </button>
        )}
        {capturing && captureCount === 0 && (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>waiting for bytes…</span>
        )}
      </div>

      {/* Native mode: no buttons — auto-connect on mount + auto-
          reconnect on cable yank. Show the tty path so operators can
          verify which port is being read. */}
      {nativeMode && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
          Native serial (Phoenix terminal)
        </div>
      )}

      {!nativeMode && rs232_1Role !== 'off' && status !== 'connected' && (
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
          Connect P1 ({rs232_1Role})
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
          Disconnect P1
        </button>
      )}

      {/* 2026-05-27 — EP6N port 2 manual Web Serial wiring (dev /
          Beelink scenario). Native mode auto-connects via the
          ctsSerialConnect2 effect above; this button only shows on
          desktop Chrome. */}
      {!nativeMode && rs232_2Role !== 'off' && status2 !== 'connected' && (
        <button
          type="button"
          onClick={onConnect2}
          style={{
            background: '#0891b2',
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
          Connect P2 ({rs232_2Role})
        </button>
      )}
      {!nativeMode && rs232_2Role !== 'off' && status2 === 'connected' && (
        <button
          type="button"
          onClick={onDisconnect2}
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
          Disconnect P2
        </button>
      )}

      {/* 2026-05-27 — Sample-game simulator. Operator: "how can we
          build a sample/fake connection to CTS…maybe we read content
          from a file thats in the form of a CTS feed". Feeds the
          bundled REHEARSAL_SCRIPT (30-second 4-quarter water polo
          game with goals/exclusions/horn) through the SAME parser
          the live bridge uses. Every downstream surface sees the
          same data shape it'd get from a real CTS console — perfect
          for dress-rehearsing the full show flow without hardware.

          2026-05-29 — the bundled rehearsal is a WATER-POLO script for
          the CTS parser, so the button only shows on the CTS profile.
          A Daktronics sample-game script is a future add (would feed
          MockDaktronicsFeed instead). */}
      {!isDaktronics && status !== 'connected' && !simRunning && (
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
          <div>P1 bytes: {bytesRead.toLocaleString()}</div>
          {rs232_2Role !== 'off' && (
            <div>P2 bytes: {bytesRead2.toLocaleString()}</div>
          )}
          <div>
            posts: {postCount}
            {postLastStatus ? ` (${postLastStatus})` : ''}
          </div>
          {(rs232_1Role === 'streamdeck' || rs232_2Role === 'streamdeck') && (
            <div>
              streamdeck cmds: {streamDeckCmds}
              {lastStreamDeckLine ? ` · last: "${lastStreamDeckLine}"` : ''}
            </div>
          )}
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
          {/* 2026-05-29 — Daktronics last-state panel (parity with the
              CTS one above). Shows the normalized snapshot + the active
              sport's extension fields so the install tech can confirm
              the offset map is reading real values off the console. */}
          {lastDakSnapshot && (
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
    sport: lastDakSnapshot.sport,
    clock: lastDakSnapshot.clock,
    running: lastDakSnapshot.clockRunning,
    period: lastDakSnapshot.period,
    score: `${lastDakSnapshot.homeScore}-${lastDakSnapshot.awayScore}`,
    horn: lastDakSnapshot.horn,
    football: lastDakSnapshot.football,
    basketball: lastDakSnapshot.basketball,
    baseball: lastDakSnapshot.baseball,
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
