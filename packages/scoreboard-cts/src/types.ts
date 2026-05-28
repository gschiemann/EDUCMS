/**
 * @cms/scoreboard-cts — types for the Colorado Time Systems (CTS)
 * System 6 / Gen 6 protocol decoder.
 *
 * These types target WATER POLO. Other sports re-use the same physical
 * protocol but expose different module addresses; the Sport Engine
 * (Sprint 13) will eventually carry per-sport CtsGameState variants
 * behind a tagged-union, but for the live install we only need water
 * polo right now.
 *
 * Physical layer (CTS System 6 / Gen 6, per
 * https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/):
 *
 *   - RS-232 over 1/4" mono jack
 *   - 9600 baud, 8 data bits, EVEN parity, 1 stop bit
 *   - Address byte has high bit set (>127); identifies the module
 *     (0x00-0x1F = 25 module addresses).
 *   - Up to 8 data bytes follow (<128). Each data byte encodes
 *     (digit_position << 4) | inverted_7seg_value.
 *   - Inverted seven-segment values mean: a SET bit = SEGMENT OFF.
 *     A blank digit reads 0x7F (all segments off, inverted).
 *
 * The reference open-source implementation we cross-referenced is
 * `fabriziobertocci/coloradoScoreboard` on GitHub.
 */

/**
 * One active exclusion (water polo: a 20-second penalty during which
 * the offending player is in the penalty box). A scoreboard usually
 * tracks up to 3 simultaneous exclusions per team.
 */
export interface CtsExclusion {
  /** Jersey number of the excluded player. Reading 0 = no jersey value yet. */
  playerJersey: number;
  /** Seconds remaining on the exclusion timer (0..20 in water polo). */
  secondsRemaining: number;
}

/**
 * Structured shot-clock value (T2-1).
 *
 * Replaces the raw display string in CtsFullSnapshot.  The `raw` field
 * preserves the original decoded string for diagnostics / logging.
 * `ms` is the canonical machine-readable value (0 = shot clock expired
 * or not running).  `running` is derived from the packet cadence at
 * snapshot build time: if the parser emitted a fresh packet for this
 * module in the current update cycle the shot clock is considered
 * running; the bridge computes the final `running` flag server-side
 * using game-clock cadence as a proxy (shot clocks only count when the
 * game clock counts).
 */
export interface CtsStructuredShotClock {
  /** The decoded display string ("24", "0", ""). */
  raw: string;
  /** Milliseconds (raw digits interpreted as whole seconds × 1000).
   *  0 when the display is blank / expired. */
  ms: number;
  /** True when the shot clock is believed to be counting down. */
  running: boolean;
}

/**
 * One decoded game state. Emitted by CtsParser whenever a complete
 * module-update packet decodes successfully.
 *
 * Every field is OPTIONAL on the emitted update because the parser
 * only emits the fields that the latest module packet actually
 * touched — a clock-only update doesn't carry the score, for
 * instance. CtsParser's own internal "latest known state" is the
 * accumulation of every field ever seen.
 */
export interface CtsGameState {
  /** Game clock as a display string. "M:SS" while above 1 minute,
   *  ":SS.t" in the last minute (tenths shown) — same convention as
   *  the physical scoreboard. */
  clock?: string;

  /** Period / quarter / half. Water polo plays 4 quarters; period 5
   *  often means OT. CTS reports 1..9 here without range-checking. */
  period?: number;

  /** Cumulative home / away score. Range 0..99 for water polo,
   *  but we don't clamp — the protocol can carry 3 digits if the
   *  console is configured for one. */
  homeScore?: number;
  awayScore?: number;

  /** Shot clocks (water polo: 30-second possession). Structured object
   *  with `raw` (display string), `ms` (milliseconds), and `running`.
   *  Empty when the shot clock is parked. */
  homeShotClock?: CtsStructuredShotClock;
  awayShotClock?: CtsStructuredShotClock;

  /** Active exclusions, max 3 each per team. Array length 0..3.
   *  Note: when a player exits the box (clock reaches 0 or coach calls
   *  re-entry), the entry is dropped and remaining ones shift left in
   *  the array — same as the scoreboard display. */
  homeExclusions?: CtsExclusion[];
  awayExclusions?: CtsExclusion[];

  /** Timeouts remaining (water polo: 2 per team per half). */
  homeTimeoutsRemaining?: number;
  awayTimeoutsRemaining?: number;

  /** Horn / end-of-period signal. True for one update cycle when
   *  the console fires the horn. UIs should latch on the rising
   *  edge — the parser does NOT debounce. */
  horn?: boolean;

  /** Wall-clock millisecond timestamp when this update was decoded
   *  (client-side `Date.now()`). Used by downstream consumers to
   *  detect stale feeds (no update in > N ms → console disconnected). */
  receivedAt: number;
}

/**
 * Internal: the parser's accumulated state — what we send when ANY
 * field changes. This is the SUPERSET that callers should treat as
 * a "running snapshot of the scoreboard."
 *
 * Differs from CtsGameState in that every field is set to a sane
 * default at construction time (no `undefined` after the first
 * parse), so widgets can render without null-coalescing every read.
 */
export interface CtsFullSnapshot {
  clock: string;
  period: number;
  homeScore: number;
  awayScore: number;
  /** T2-1: structured shot clocks (promoted from plain string in v1.1). */
  homeShotClock: CtsStructuredShotClock;
  awayShotClock: CtsStructuredShotClock;
  homeExclusions: CtsExclusion[];
  awayExclusions: CtsExclusion[];
  homeTimeoutsRemaining: number;
  awayTimeoutsRemaining: number;
  horn: boolean;
  receivedAt: number;
}

/**
 * CTS module addresses we know how to decode. The list below covers the
 * water polo profile of a System 6 console. Other sports re-use the
 * same address space with different meanings; future sport profiles
 * will live in their own module-address tables.
 *
 * Address bytes from the serial line have the high bit set (e.g.
 * 0x81 is "module 0x01 = game clock"). The parser strips that high
 * bit before lookup, so this table uses the LOW 7 BITS only.
 *
 * Notes from real-world reverse-engineering of CTS dumps:
 *   - The protocol does not guarantee every module address is
 *     populated; an idle module simply isn't transmitted.
 *   - Some consoles also send aux packets (date/time-of-day) on
 *     module 0x1E / 0x1F. We ignore those — water polo never reads
 *     them.
 */
export const CTS_MODULE = {
  GAME_CLOCK: 0x01,
  HOME_SCORE: 0x02,
  AWAY_SCORE: 0x03,
  PERIOD: 0x04,
  HOME_SHOT_CLOCK: 0x06,
  AWAY_SHOT_CLOCK: 0x07,
  HOME_EXCL_1: 0x08, // [jersey, jersey, time, time, time]
  HOME_EXCL_2: 0x09,
  HOME_EXCL_3: 0x0a,
  AWAY_EXCL_1: 0x0b,
  AWAY_EXCL_2: 0x0c,
  AWAY_EXCL_3: 0x0d,
  HOME_TIMEOUTS: 0x10,
  AWAY_TIMEOUTS: 0x11,
  HORN: 0x1f,
} as const;

export type CtsModuleAddress = (typeof CTS_MODULE)[keyof typeof CTS_MODULE];

/**
 * Callback signature for CtsParser update events. The receiver gets
 * the FULL accumulated snapshot — not just the delta — so the
 * widget can render in one pass without merging state.
 */
export type CtsUpdateListener = (state: CtsFullSnapshot) => void;
