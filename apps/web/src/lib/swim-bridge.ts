/**
 * swim-bridge — pure glue logic for the swim-timing WebSerial bridge page
 * (`/[schoolId]/sports/[gameId]/swim-bridge`), the first real consumer of
 * `@cms/scoreboard-cts`'s SwimTimingParser (Inputs-wave SWIM, 2026-08-10).
 *
 * Everything here is plain state-machine math — no React, no DOM, no
 * network, no timers (callers inject `now`) — so the throttle / backoff /
 * consistency behavior is unit-testable without mounting the page (same
 * discipline as `app/player/sync/`).
 *
 * BUNDLE RULE (screens/page.tsx precedent): dashboard routes must never
 * STATICALLY import `@cms/scoreboard-cts` — the bridge page loads it via
 * `await import()` inside the Connect click handler. This module therefore
 * uses TYPE-ONLY imports (erased at compile time, zero bundle impact) and
 * receives the package's runtime functions by INJECTION (`LaneByteFilter`
 * takes `parseCtsSwimPackets` + `laneModule` as constructor inputs), so we
 * share the package's one framing implementation instead of re-implementing
 * the protocol here — without pulling the decoder into the dashboard bundle.
 *
 * Why the client-side hardening exists at all (recon 03-RECON-SWIM traps):
 * the CTS swimming scoreboard-serial wire has NO length byte and NO
 * checksum — packets are framed purely by a fixed payload-length table.
 * A listener that joins mid-stream can mis-frame: a payload byte gets read
 * as a module address and 4-5 REAL bytes become a garbage "lane state"
 * that the parser then accumulates forever. Two independent defenses:
 *
 *   1. `LaneByteFilter` — the lane modules' payloads carry their own lane
 *      number in payload[0]; `decodeLanePacket` deliberately trusts the
 *      module address and DISCARDS that byte, so we cross-check it HERE
 *      and drop any lane packet whose payload byte disagrees with its
 *      module address. A mis-framed pseudo-packet passes only if a random
 *      byte coincidentally equals the module's lane number.
 *   2. `SnapshotConsistencyGate` — the first POST is held until
 *      `CONSISTENT_SNAPSHOTS_REQUIRED` consecutive decoded snapshots pass
 *      the plausibility validator (a mis-framed decode routinely yields
 *      seconds > 59 / hundredths > 99 / event > 999). An implausible
 *      pre-open snapshot tells the page to `parser.reset()` so poisoned
 *      accumulated state can't linger — the stream re-locks within a
 *      packet or two.
 */

import type { RawCtsSwimPacket, SwimTimingSnapshot } from '@cms/scoreboard-cts';

// ── POST pacing ─────────────────────────────────────────────────────────
//
// The server budget for /swim-timing-snapshot is 40 requests / 10 s per
// game — 4 Hz SUSTAINED (sports-board.controller.ts FEED_MAX_PER_WINDOW).
// CtsBridge's 200 ms floor (5 Hz) would exceed it, so the swim bridge
// floors at 250 ms and treats fixed-window boundary slack as luck, not
// budget (ingest-rate-limit.ts is a fixed window — don't lean on it).
export const SWIM_POST_MIN_INTERVAL_MS = 250;
/** Backoff ceiling after repeated 429s. */
export const SWIM_POST_MAX_INTERVAL_MS = 2000;
/** Consecutive plausible snapshots required before the FIRST POST. */
export const CONSISTENT_SNAPSHOTS_REQUIRED = 2;

/** Default serial settings for the CTS swimming scoreboard-serial output:
 *  RS-232, 9600 baud, 8 data bits, EVEN parity, 1 stop bit (report A7 /
 *  swim-timing.ts header). `?baud=` overrides the rate for oddball
 *  converters; the framing (8-E-1) is part of the protocol and fixed. */
export const SWIM_SERIAL_DEFAULTS = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'even',
} as const;

/** Parse the `?baud=` override out of a location.search string. Anything
 *  non-numeric / non-positive falls back to the 9600 default. */
export function resolveBaudRate(
  search: string | null | undefined,
  fallback: number = SWIM_SERIAL_DEFAULTS.baudRate,
): number {
  if (!search) return fallback;
  const raw = new URLSearchParams(search).get('baud');
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── 429 backoff calculator ──────────────────────────────────────────────

export interface SwimPostResult {
  /** True for any 2xx. */
  ok: boolean;
  /** True when the server answered 429 SPORTS_SWIM_TIMING_RATE_LIMITED. */
  rateLimited?: boolean;
}

/**
 * Next inter-POST interval given the last result:
 *   - 429      → double, capped at `maxMs` (we blew the 40/10s budget —
 *                shed load fast).
 *   - success  → halve, floored at `minMs` (decay back toward full rate).
 *   - network / other error → unchanged (not a pacing signal).
 */
export function nextPostInterval(
  currentMs: number,
  result: SwimPostResult,
  opts: { minMs?: number; maxMs?: number } = {},
): number {
  const minMs = opts.minMs ?? SWIM_POST_MIN_INTERVAL_MS;
  const maxMs = opts.maxMs ?? SWIM_POST_MAX_INTERVAL_MS;
  if (result.rateLimited) return Math.min(maxMs, currentMs * 2);
  if (result.ok) return Math.max(minMs, Math.floor(currentMs / 2));
  return currentMs;
}

// ── Latest-wins POST throttle ───────────────────────────────────────────

/**
 * Latest-wins snapshot throttle with 429 backoff. The parser emits on
 * every state-changing packet (up to ~10 Hz mid-race); this machine keeps
 * only the NEWEST pending snapshot and releases one per interval. Because
 * a SwimTimingSnapshot is the parser's full accumulated state, dropping
 * intermediate snapshots loses nothing — the latest supersedes them all.
 *
 * Time is injected (`now` args) so tests never sleep.
 */
export class SwimPostScheduler<T = SwimTimingSnapshot> {
  private lastTakenAt: number | null = null;
  private pendingSnap: T | null = null;
  private interval: number;

  constructor(
    private readonly minMs: number = SWIM_POST_MIN_INTERVAL_MS,
    private readonly maxMs: number = SWIM_POST_MAX_INTERVAL_MS,
  ) {
    this.interval = minMs;
  }

  /** Queue a snapshot. Replaces any older pending one (latest wins). */
  offer(snap: T): void {
    this.pendingSnap = snap;
  }

  get hasPending(): boolean {
    return this.pendingSnap !== null;
  }

  /** Current inter-POST interval — > minMs means backoff is active. */
  get intervalMs(): number {
    return this.interval;
  }

  /** Milliseconds until the pending snapshot may post. 0 = due now;
   *  Infinity = nothing pending. */
  msUntilDue(now: number): number {
    if (this.pendingSnap === null) return Infinity;
    if (this.lastTakenAt === null) return 0; // first POST — no spacing yet
    return Math.max(0, this.lastTakenAt + this.interval - now);
  }

  /** Consume the pending snapshot if the interval has elapsed; null
   *  otherwise. Consuming stamps `now` as the spacing baseline. */
  takeIfDue(now: number): T | null {
    if (this.pendingSnap === null || this.msUntilDue(now) > 0) return null;
    const snap = this.pendingSnap;
    this.pendingSnap = null;
    this.lastTakenAt = now;
    return snap;
  }

  /**
   * Report the outcome of a POST previously taken via `takeIfDue`.
   * Adjusts the interval (see `nextPostInterval`), and re-queues the
   * failed snapshot when no newer one has arrived — otherwise the LAST
   * state of a race (no further packets coming) would be silently lost
   * to a transient 429 / network blip. A newer pending snapshot always
   * wins over the failed one (it supersedes it by construction).
   */
  onResult(snap: T, result: SwimPostResult): void {
    this.interval = nextPostInterval(this.interval, result, {
      minMs: this.minMs,
      maxMs: this.maxMs,
    });
    if (!result.ok && this.pendingSnap === null) {
      this.pendingSnap = snap;
    }
  }
}

// ── Snapshot plausibility + first-POST consistency gate ─────────────────

/**
 * Is a decoded snapshot physically plausible? A mis-framed stream (no
 * checksum on the wire — see file header) decodes real payload bytes as
 * the wrong fields, which routinely lands outside these ranges:
 * seconds/hundredths are 0-59 / 0-99 by construction of a real console,
 * lanes are 1-12, splits channels 0-5, event ≤ 999, heat ≤ 99, dual-meet
 * scores ≤ 999 (all per the swim-timing.ts protocol writeup). Blank
 * fields decode to zeros, which pass.
 */
export function isPlausibleSnapshot(snap: SwimTimingSnapshot): boolean {
  for (const [key, lane] of Object.entries(snap.lanes)) {
    const laneNo = Number(key);
    if (!Number.isInteger(laneNo) || laneNo < 1 || laneNo > 12) return false;
    if (lane.lane !== laneNo) return false;
    if (lane.place < 0 || lane.place > 12) return false;
    if (lane.minutes < 0 || lane.minutes > 99) return false;
    if (lane.seconds < 0 || lane.seconds > 59) return false;
    if (lane.hundredths < 0 || lane.hundredths > 99) return false;
  }
  for (const [key, split] of Object.entries(snap.splits)) {
    const channel = Number(key);
    if (!Number.isInteger(channel) || channel < 0 || channel > 5) return false;
    if (split.channel !== channel) return false;
    if (split.minutes < 0 || split.minutes > 99) return false;
    if (split.seconds < 0 || split.seconds > 59) return false;
    if (split.hundredths < 0 || split.hundredths > 99) return false;
  }
  if (snap.eventHeat) {
    if (snap.eventHeat.eventNumber < 0 || snap.eventHeat.eventNumber > 999) return false;
    if (snap.eventHeat.heat < 0 || snap.eventHeat.heat > 99) return false;
  }
  if (snap.teamScore) {
    if (snap.teamScore.homeScore < 0 || snap.teamScore.homeScore > 999) return false;
    if (snap.teamScore.awayScore < 0 || snap.teamScore.awayScore > 999) return false;
  }
  return true;
}

export type SwimGateVerdict = 'open' | 'waiting' | 'reject';

/**
 * First-POST gate: holds posting until `required` CONSECUTIVE snapshots
 * pass `isPlausibleSnapshot`. Once open it stays open — after that,
 * transient noise is the server sanitizer's problem, and resetting would
 * blank a board mid-meet.
 *
 * Verdicts:
 *   'open'    — this (and every later) snapshot may post.
 *   'waiting' — plausible, but the streak isn't met yet. Don't post.
 *   'reject'  — implausible decode BEFORE the gate opened. The caller
 *               should `parser.reset()` — the parser accumulates state,
 *               so a garbage lane entry would otherwise sit in every
 *               future snapshot and keep the gate shut forever.
 */
export class SnapshotConsistencyGate {
  private streak = 0;
  private opened = false;
  private rejected = 0;

  constructor(private readonly required: number = CONSISTENT_SNAPSHOTS_REQUIRED) {}

  offer(snap: SwimTimingSnapshot): SwimGateVerdict {
    if (this.opened) return 'open';
    if (!isPlausibleSnapshot(snap)) {
      this.streak = 0;
      this.rejected += 1;
      return 'reject';
    }
    this.streak += 1;
    if (this.streak >= this.required) {
      this.opened = true;
      return 'open';
    }
    return 'waiting';
  }

  get open(): boolean {
    return this.opened;
  }

  /** Plausible snapshots seen so far toward the streak (UI: "warming up 1/2"). */
  get progress(): number {
    return this.opened ? this.required : this.streak;
  }

  get rejectedCount(): number {
    return this.rejected;
  }
}

// ── Lane-byte cross-check filter ────────────────────────────────────────

/** Shape of `parseCtsSwimPackets` from `@cms/scoreboard-cts` — injected,
 *  never statically imported (bundle rule, see file header). */
export type SwimPacketParser = (bytes: Uint8Array | number[]) => {
  packets: RawCtsSwimPacket[];
  remainder: number[];
};

/** Invert the package's exported `laneModule(lane) → module address` into
 *  the module → lane lookup the filter needs (`laneNumberForModule` is
 *  private to the package; this derives the same map from public API, so
 *  it can never drift from the encoder). */
export function buildModuleLaneMap(
  laneModuleFn: (lane: number) => number,
): ReadonlyMap<number, number> {
  const map = new Map<number, number>();
  for (let lane = 1; lane <= 12; lane++) map.set(laneModuleFn(lane), lane);
  return map;
}

/**
 * Streaming byte filter that sits BETWEEN the serial port and
 * `SwimTimingParser.feed`. Frames packets with the injected package
 * parser (buffering partial packets across chunk boundaries exactly like
 * the parser itself would), drops any LANE packet whose payload lane byte
 * (payload[0]) disagrees with its module address, and re-flattens the
 * kept packets into bytes for the parser.
 *
 * Split packets ALSO carry a lane byte, but split channel ↔ lane pairing
 * is venue DIP-switch config the protocol doesn't describe (see
 * SwimSplitState docs) — so splits are passed through unvalidated, as are
 * event/heat and team-score packets.
 *
 * Note: unknown-module noise bytes are consumed here (the framer skips
 * them) and not re-emitted — the parser would skip them identically, so
 * downstream behavior is unchanged.
 */
export class LaneByteFilter {
  private pending: number[] = [];
  private dropped = 0;

  constructor(
    private readonly parsePackets: SwimPacketParser,
    private readonly moduleLane: ReadonlyMap<number, number>,
  ) {}

  /** Filter one serial chunk. Returns bytes safe to feed the parser. */
  filter(bytes: Uint8Array | number[]): number[] {
    const incoming: number[] = Array.isArray(bytes) ? bytes : Array.from(bytes);
    const { packets, remainder } = this.parsePackets(this.pending.concat(incoming));
    this.pending = remainder;
    const out: number[] = [];
    for (const pkt of packets) {
      const expectedLane = this.moduleLane.get(pkt.module);
      if (expectedLane !== undefined && pkt.payload[0] !== expectedLane) {
        this.dropped += 1;
        continue;
      }
      out.push(pkt.module, ...pkt.payload);
    }
    return out;
  }

  /** Lane packets dropped because payload[0] contradicted the module
   *  address — nonzero means line noise or a mis-framed join. */
  get droppedCount(): number {
    return this.dropped;
  }
}

// ── Status-line helper ──────────────────────────────────────────────────

/** One-line human summary of the latest snapshot for the bridge status UI. */
export function summarizeSnapshot(snap: SwimTimingSnapshot): string {
  const laneCount = Object.keys(snap.lanes).length;
  const lanes = `${laneCount} lane${laneCount === 1 ? '' : 's'}`;
  const ev = snap.eventHeat
    ? `Event ${snap.eventHeat.eventNumber} — Heat ${snap.eventHeat.heat}`
    : 'No event/heat yet';
  const score = snap.teamScore
    ? ` · ${snap.teamScore.homeScore}–${snap.teamScore.awayScore}`
    : '';
  return `${ev} · ${lanes}${score}`;
}
