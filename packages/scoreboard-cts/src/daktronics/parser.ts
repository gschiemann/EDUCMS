/**
 * @cms/scoreboard-cts/daktronics/parser — Daktronics All Sport 5000
 * Enhanced RTD decoder. Browser-safe (no Node-only APIs).
 *
 * Feed it raw serial bytes via `feed()`; subscribe via `onUpdate()`;
 * get the full normalized `DaktronicsSnapshot` whenever a decoded field
 * actually changes. Same public-API shape as CtsParser so CtsBridge can
 * treat the two interchangeably.
 *
 * ── How it differs from CtsParser ────────────────────────────────────
 * CTS streams per-module seven-segment packets; this streams positioned
 * ASCII writes into ONE flat display buffer (see types.ts). So:
 *   - we accumulate complete SYN..ETB frames (byte-stuffing-free; the
 *     framing bytes 0x16/0x17 don't appear inside ASCII text payloads),
 *   - validate the modulo-256 checksum,
 *   - parse the CONTROL offset (1-based item position → 0-based index),
 *   - splice TEXT into the buffer at that index,
 *   - re-slice the active sport's named fields out of the buffer,
 *   - emit a fresh snapshot if anything changed.
 *
 * The console sends incremental writes, NOT the whole buffer each cycle.
 * The buffer persists across frames (init filled with spaces), so a
 * clock-only frame leaves the score slice untouched — exactly like the
 * physical display memory. Pressing the console STOP button forces a
 * full dump (documented behavior; nothing special needed our side).
 */

import {
  RTD,
  RTD_FIELD_PREFIX,
  type DaktronicsSnapshot,
  type DaktronicsSport,
  type DaktronicsUpdateListener,
} from './types';
import {
  DAKTRONICS_OFFSETS,
  RTD_BUFFER_SIZE,
  type FieldDef,
} from './offsets';

/** Parser options. */
export interface DaktronicsParserOptions {
  /** Which sport's offset table to decode against. Defaults to
   *  'football'. Change at runtime via `setSport()`. */
  sport?: DaktronicsSport;
}

/**
 * Result of a single field read: the trimmed string and its numeric
 * interpretation (NaN-safe → 0). Tiny helper struct so the snapshot
 * builder reads cleanly.
 */
interface ReadResult {
  str: string;
  num: number;
}

export class DaktronicsParser {
  /** The persistent RTD display buffer. ASCII, space-initialized. */
  private buffer: Uint8Array;

  /** Frame-assembly accumulator. Bytes between SYN and ETB inclusive
   *  of the inner fields (we store the post-SYN, pre-ETB bytes). */
  private frame: number[] = [];
  /** True while we're between a SYN and its closing ETB. */
  private inFrame = false;

  private sport: DaktronicsSport;
  private state: DaktronicsSnapshot;
  private listeners: Set<DaktronicsUpdateListener> = new Set();

  /** Count of frames whose checksum failed — surfaced for diagnostics
   *  (a high rate means wrong baud / bad cable / line noise). */
  private badChecksumCount = 0;
  /** Count of frames accepted (good checksum, written to buffer). */
  private goodFrameCount = 0;

  constructor(opts: DaktronicsParserOptions = {}) {
    this.sport = opts.sport ?? 'football';
    this.buffer = new Uint8Array(RTD_BUFFER_SIZE);
    this.buffer.fill(0x20); // ASCII space — matches a blank display
    this.state = this.deriveSnapshot();
  }

  /** Subscribe to update events. Returns an unsubscribe function. */
  public onUpdate(listener: DaktronicsUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Read-only copy of the latest accumulated snapshot. */
  public getState(): DaktronicsSnapshot {
    return this.cloneSnapshot(this.state);
  }

  /** Which sport this parser is currently decoding. */
  public getSport(): DaktronicsSport {
    return this.sport;
  }

  /** Diagnostics: { good, bad } frame counts. */
  public getFrameStats(): { good: number; bad: number } {
    return { good: this.goodFrameCount, bad: this.badChecksumCount };
  }

  /**
   * Switch the active sport profile. Re-derives the snapshot from the
   * EXISTING buffer (the buffer is sport-agnostic raw bytes; only the
   * field map changes), and emits if the new interpretation differs.
   */
  public setSport(sport: DaktronicsSport): void {
    if (sport === this.sport) return;
    this.sport = sport;
    const next = this.deriveSnapshot();
    if (this.snapshotChanged(this.state, next)) {
      this.state = next;
      this.emit();
    } else {
      this.state = next;
    }
  }

  /** Reset buffer + state (e.g. switching games). Listeners stay. */
  public reset(): void {
    this.buffer.fill(0x20);
    this.frame = [];
    this.inFrame = false;
    this.badChecksumCount = 0;
    this.goodFrameCount = 0;
    this.state = this.deriveSnapshot();
  }

  /**
   * Feed raw serial bytes. Accepts Uint8Array (native serial reads) or
   * number[] (tests). Assembles frames; on each complete + checksum-
   * valid frame, writes into the buffer and re-derives the snapshot.
   */
  public feed(bytes: Uint8Array | number[]): void {
    const arr: number[] = Array.isArray(bytes) ? bytes : Array.from(bytes);
    for (const raw of arr) {
      const b = raw & 0xff;
      if (b === RTD.SYN) {
        // Start of a new frame. Any partial frame is abandoned (a fresh
        // SYN is an unambiguous resync point — the console never embeds
        // 0x16 inside an ASCII field payload).
        this.inFrame = true;
        this.frame = [];
        continue;
      }
      if (!this.inFrame) {
        // Byte outside a frame (noise / mid-stream attach). Drop.
        continue;
      }
      if (b === RTD.ETB) {
        // End of frame. Process what we accumulated, then reset.
        this.processFrame(this.frame);
        this.inFrame = false;
        this.frame = [];
        continue;
      }
      this.frame.push(b);
      // Guard against a runaway frame (missing ETB) eating memory.
      if (this.frame.length > RTD_BUFFER_SIZE * 2) {
        this.inFrame = false;
        this.frame = [];
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * Process the bytes between SYN and ETB (exclusive of both).
   * Layout: HEADER <SOH> CONTROL <STX> TEXT <EOT> SUM
   *
   * Validates the checksum (modulo-256 sum of every byte from the first
   * byte after SYN up to and including EOT, as 2 ASCII hex digits — per
   * the protocol spec + packet.rs reference), extracts the 1-based item
   * offset from CONTROL, and writes TEXT into the buffer at offset-1.
   */
  private processFrame(frameBytes: number[]): void {
    // Locate the structural markers.
    const sohIdx = frameBytes.indexOf(RTD.SOH);
    if (sohIdx < 0) return; // malformed — no header/control separator

    const eotIdx = frameBytes.indexOf(RTD.EOT, sohIdx);
    if (eotIdx < 0) return; // malformed — no checksum separator

    // STX separates CONTROL from TEXT. Some frames carry no TEXT (STX
    // absent, EOT directly after CONTROL) — handle both.
    const stxIdx = frameBytes.indexOf(RTD.STX, sohIdx);
    const hasText = stxIdx >= 0 && stxIdx < eotIdx;

    // ── checksum ──
    // SUM is the 2 ASCII hex bytes immediately after EOT. Computed over
    // every byte from frame start (first byte after SYN) up to AND
    // INCLUDING EOT.
    const sumBytes = frameBytes.slice(eotIdx + 1, eotIdx + 3);
    if (sumBytes.length === 2) {
      const declared = parseInt(String.fromCharCode(sumBytes[0]!, sumBytes[1]!), 16);
      let sum = 0;
      for (let i = 0; i <= eotIdx; i++) sum = (sum + frameBytes[i]!) & 0xff;
      if (!Number.isNaN(declared) && declared !== sum) {
        // Bad checksum — drop the frame, don't corrupt the buffer.
        this.badChecksumCount += 1;
        return;
      }
    }
    // (If SUM is missing/short we accept leniently — some current-loop
    // taps drop the trailing bytes; the buffer write is still safe.)

    // ── CONTROL → offset ──
    // CONTROL runs from SOH+1 to STX (or EOT when no text). It looks
    // like "00421NNNNN": a field-data prefix + 5-digit 1-based item
    // position. We accept any CONTROL whose digits parse; non-field
    // control frames (ACK responses, "90000" etc.) carry no usable
    // offset and are skipped.
    const controlEnd = hasText ? stxIdx : eotIdx;
    const control = this.asciiSlice(frameBytes, sohIdx + 1, controlEnd).trim();
    if (!control.startsWith(RTD_FIELD_PREFIX)) {
      // Not a field-data write (e.g. an ACK frame). Nothing to apply.
      return;
    }
    const itemStr = control.slice(RTD_FIELD_PREFIX.length);
    const item1 = parseInt(itemStr, 10);
    if (!Number.isFinite(item1) || item1 < 1) return;
    const writeIndex = item1 - 1; // 1-based item → 0-based buffer index

    // ── TEXT → buffer ──
    const text = hasText ? frameBytes.slice(stxIdx + 1, eotIdx) : [];
    if (writeIndex + text.length > this.buffer.length) {
      // Out-of-bounds write — clamp rather than throw (defensive; a
      // corrupt offset shouldn't crash the board mid-game).
      const room = this.buffer.length - writeIndex;
      if (room <= 0) {
        this.goodFrameCount += 1;
        return;
      }
      this.buffer.set(text.slice(0, room), writeIndex);
    } else {
      this.buffer.set(text, writeIndex);
    }
    this.goodFrameCount += 1;

    // ── re-derive + emit on change ──
    const next = this.deriveSnapshot();
    if (this.snapshotChanged(this.state, next)) {
      this.state = next;
      this.emit();
    } else {
      // Keep receivedAt fresh on the stored state even when nothing
      // visible changed, so staleness math stays honest — but DON'T
      // emit (no change to render). We only bump receivedAt on actual
      // change to match CtsParser's contract (receivedAt advances with
      // emitted snapshots).
      // (intentional no-op)
    }
  }

  /** Read an ASCII slice [start, end) of a byte array as a string. */
  private asciiSlice(arr: number[], start: number, end: number): string {
    let s = '';
    for (let i = start; i < end && i < arr.length; i++) {
      s += String.fromCharCode(arr[i]! & 0xff);
    }
    return s;
  }

  /**
   * Read one named field out of the persistent buffer, applying the
   * field's justification trim. Returns trimmed string + numeric value.
   *
   * Mirrors the reference `field_str`: `real_index = item - 1`, slice
   * [real_index, real_index+length), then trim per justify.
   */
  private readField(def: FieldDef): ReadResult {
    const start = def.offset - 1; // 1-based item → 0-based buffer index
    const end = start + def.length;
    if (start < 0 || end > this.buffer.length) return { str: '', num: 0 };
    let s = '';
    for (let i = start; i < end; i++) s += String.fromCharCode(this.buffer[i]! & 0xff);
    if (def.justify === 'L') s = s.replace(/\s+$/, '');
    else if (def.justify === 'R') s = s.replace(/^\s+/, '');
    // 'N' — leave raw.
    const digits = s.replace(/[^0-9-]/g, '');
    const n = digits === '' || digits === '-' ? 0 : parseInt(digits, 10);
    return { str: s, num: Number.isFinite(n) ? n : 0 };
  }

  /** True if the field's single-char flag is "set" (non-blank, not '0'). */
  private flagSet(def: FieldDef): boolean {
    const start = def.offset - 1;
    if (start < 0 || start >= this.buffer.length) return false;
    const c = this.buffer[start]! & 0xff;
    // Blank (space) or NUL = clear; anything else (s/z/h/</>) = set.
    return c !== 0x20 && c !== 0x00;
  }

  /**
   * Build the full normalized snapshot from the current buffer using
   * the active sport's offset table.
   */
  private deriveSnapshot(): DaktronicsSnapshot {
    const sport = this.sport;
    const map = DAKTRONICS_OFFSETS[sport];

    const clock = this.readField(map.mainClock).str;
    const clockStopped = this.flagSet(map.clockStopped);
    const clockIsZero = this.flagSet(map.clockIsZero);
    const horn =
      this.flagSet(map.mainClockHorn) ||
      this.flagSet(map.timeOutHorn) ||
      this.flagSet(map.mainClockTimeOutHorn);

    const base: DaktronicsSnapshot = {
      sport,
      clock,
      clockStopped,
      // A clock that is stopped OR at zero is not "running". Default
      // (blank flags) = running, which matches the All Sport: it sets
      // the 's' flag only when explicitly stopped.
      clockRunning: !clockStopped && !clockIsZero,
      clockIsZero,
      period: this.readField(map.period).num,
      homeScore: this.readField(map.homeScore).num,
      awayScore: this.readField(map.guestScore).num,
      homeTimeoutsRemaining: this.readField(map.homeTimeoutsTotal).num,
      awayTimeoutsRemaining: this.readField(map.guestTimeoutsTotal).num,
      horn,
      receivedAt: Date.now(),
    };

    if (sport === 'football') {
      const m = DAKTRONICS_OFFSETS.football;
      base.football = {
        down: this.readField(m.down).str,
        toGo: this.readField(m.toGo).num,
        ballOn: this.readField(m.ballOn).num,
        possession: this.resolvePossession(m.homePossession, m.guestPossession),
        playClock: this.readField(m.playClock).str,
      };
    } else if (sport === 'basketball') {
      const m = DAKTRONICS_OFFSETS.basketball;
      base.basketball = {
        homeTeamFouls: this.readField(m.homeTeamFouls).num,
        guestTeamFouls: this.readField(m.guestTeamFouls).num,
        homeBonus: this.flagSet(m.homeBonus),
        homeDoubleBonus: this.flagSet(m.homeDoubleBonus),
        guestBonus: this.flagSet(m.guestBonus),
        guestDoubleBonus: this.flagSet(m.guestDoubleBonus),
        possession: this.resolvePossession(m.homePossession, m.guestPossession),
        shotClock: this.readField(m.shotClock).str,
      };
    } else {
      const m = DAKTRONICS_OFFSETS.baseball;
      base.baseball = {
        balls: this.readField(m.balls).num,
        strikes: this.readField(m.strikes).num,
        outs: this.readField(m.outs).num,
        atBat: this.resolvePossession(m.homeAtBat, m.guestAtBat),
        homeHits: this.readField(m.homeHits).num,
        awayHits: this.readField(m.guestHits).num,
        homeErrors: this.readField(m.homeErrors).num,
        awayErrors: this.readField(m.guestErrors).num,
        batterNumber: this.readField(m.batterNumber).num,
      };
    }

    return base;
  }

  /** home indicator set → 'home'; guest set → 'away'; neither → null. */
  private resolvePossession(home: FieldDef, guest: FieldDef): 'home' | 'away' | null {
    if (this.flagSet(home)) return 'home';
    if (this.flagSet(guest)) return 'away';
    return null;
  }

  /**
   * Structural equality of two snapshots EXCEPT `receivedAt` (which we
   * don't want to count as a change). Cheap deep-ish compare via JSON of
   * everything but the timestamp.
   */
  private snapshotChanged(a: DaktronicsSnapshot, b: DaktronicsSnapshot): boolean {
    return JSON.stringify(this.withoutTs(a)) !== JSON.stringify(this.withoutTs(b));
  }

  private withoutTs(s: DaktronicsSnapshot): Omit<DaktronicsSnapshot, 'receivedAt'> {
    const { receivedAt: _omit, ...rest } = s;
    void _omit;
    return rest;
  }

  private cloneSnapshot(s: DaktronicsSnapshot): DaktronicsSnapshot {
    return {
      ...s,
      ...(s.football ? { football: { ...s.football } } : {}),
      ...(s.basketball ? { basketball: { ...s.basketball } } : {}),
      ...(s.baseball ? { baseball: { ...s.baseball } } : {}),
    };
  }

  private emit(): void {
    const snap = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[DaktronicsParser] listener threw:', err);
      }
    }
  }
}
