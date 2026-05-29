/**
 * @cms/scoreboard-cts/daktronics — types for the Daktronics All Sport
 * 5000 / 5500 / 3000 "Enhanced RTD" (Real Time Data) serial decoder.
 *
 * Sibling of the CTS (Colorado Time Systems) decoder. CTS is the
 * aquatics/water-polo console; the Daktronics All Sport is the most
 * common control console in US high-school football / basketball /
 * baseball gyms — so this closes the #1 console-tap-off gap
 * (docs/research/2026-05-29-sports-provenue-gap/03-score-data-ingestion.md).
 *
 * ── Physical layer (very different from CTS) ─────────────────────────
 *   - RS-232 (and 20 mA current-loop) via the All Sport "Port Expander"
 *   - 19200 baud, 8 data bits, NO parity, 1 stop bit  (CTS is 9600/8/E/1)
 *   - FTDI / Prolific USB-serial cable on the desktop side
 *
 * ── Wire protocol (RTD "Position Text" frames) ───────────────────────
 * Unlike CTS — which streams per-module addressable seven-segment
 * packets — the All Sport continuously refreshes a single flat ASCII
 * "display buffer". Each frame is a *positioned text write*: it carries
 * a decimal offset (where in the buffer to write) and an ASCII text
 * payload. Every named field (clock, score, period, down, balls, …) is
 * a fixed (offset,length) slice of that buffer per sport.
 *
 * Frame shape (per the All Sport 5000 Enhanced RTD spec + the two
 * MIT-licensed open decoders — github.com/zabackary/daktronics-allsport-5000-rs
 * and github.com/rpitv/scoreboard):
 *
 *     <SYN> HEADER <SOH> CONTROL <STX> TEXT <EOT> SUM <ETB>
 *
 *     <SYN> = 0x16   frame start
 *     HEADER = "00210000" / "20000000" (8 ASCII; ignored beyond prefix)
 *     <SOH> = 0x01
 *     CONTROL = "00421NNNNN" (10 ASCII) — the trailing NNNNN decimal
 *               digits are the 1-based buffer item position where TEXT
 *               is written; "00421" is the field-data prefix.
 *     <STX> = 0x02
 *     TEXT  = the ASCII field payload (may be empty)
 *     <EOT> = 0x04
 *     SUM   = 2 ASCII hex digits = (sum of every byte from the first
 *             byte after <SYN> up to and including <EOT>) mod 256
 *     <ETB> = 0x17   frame end
 *
 * The console sends data incrementally — only the bytes that changed,
 * NOT the whole buffer every cycle. Pressing the console's STOP button
 * forces a full buffer dump (handy on connect; documented in the
 * reference decoder). Our parser therefore keeps a persistent buffer
 * and overwrites the slice each frame addresses, exactly like
 * RTDState::update_from_packet in the Rust reference.
 *
 * ── Offset numbering (the subtle bit — read before editing offsets) ──
 * The per-sport offset tables in `offsets.ts` use the SAME 1-based item
 * positions that Daktronics' Enhanced RTD manual and the zabackary
 * decoder's field tuples use. The reader subtracts 1 to get the 0-based
 * buffer index (mirrors `real_index = item - 1` in the Rust
 * `field_str`). The CONTROL-field NNNNN is likewise the 1-based item
 * position and is converted to a 0-based write index on parse. Keeping
 * the tables 1-based means anyone cross-checking against the manual or
 * the reference decoder sees identical numbers.
 */

/** Which sport's offset table to apply to the RTD buffer. */
export type DaktronicsSport = 'football' | 'basketball' | 'baseball';

/**
 * Normalized snapshot — the SAME canonical shape the CTS decoder emits
 * (`clock` / `homeScore` / `awayScore` / `period` / `horn` + sport
 * extension fields), so CtsBridge can POST either source through one
 * code path and the server/board surfaces never care which console
 * produced it.
 *
 * Mirrors CtsFullSnapshot's contract: every field has a sane default
 * after construction (no `undefined` reads), so widgets render without
 * null-coalescing. The `sport` tag and the sport-specific blocks are
 * the only additions over the CTS snapshot.
 */
export interface DaktronicsSnapshot {
  /** Which sport profile decoded this snapshot. */
  sport: DaktronicsSport;

  /** Main game clock as a display string ("12:00", "1:23", ":45.6").
   *  The All Sport sends this already-formatted with the ':' / '.'
   *  separators — we surface it verbatim (trimmed). */
  clock: string;

  /** True when the console reports the main clock as STOPPED (item
   *  "Main Clock Stopped" = 's'). The All Sport has an EXPLICIT stopped
   *  flag — unlike CTS, where we infer running/paused from packet
   *  cadence. So `clockRunning` here is authoritative, not derived. */
  clockStopped: boolean;

  /** Convenience inverse of `clockStopped` (the canonical field every
   *  downstream consumer reads as "is the clock counting"). */
  clockRunning: boolean;

  /** True when the console reports the main clock = 0 (item "Main
   *  Clock =0" = 'z'). */
  clockIsZero: boolean;

  /** Period / Quarter (football, basketball) or Inning (baseball).
   *  1-based; OT/extra periods continue past the regulation count. */
  period: number;

  /** Cumulative team scores. */
  homeScore: number;
  awayScore: number;

  /** Timeouts remaining (total). Football/basketball; 0 for baseball. */
  homeTimeoutsRemaining: number;
  awayTimeoutsRemaining: number;

  /** Horn / buzzer. True for the cycle the console fires it (main-clock
   *  horn OR time-out horn). Latch on the rising edge downstream — the
   *  parser does not debounce. */
  horn: boolean;

  /** Sport-specific extension. Exactly one of these is populated to
   *  match `sport`; the others are absent. */
  football?: DaktronicsFootball;
  basketball?: DaktronicsBasketball;
  baseball?: DaktronicsBaseball;

  /** Wall-clock ms when this snapshot was decoded (`Date.now()`).
   *  Downstream staleness detection (no update in > N ms → console
   *  disconnected). */
  receivedAt: number;
}

/** Football-specific fields (down, distance, possession, etc.). */
export interface DaktronicsFootball {
  /** "1st" | "2nd" | "3rd" | "4th" | "" (raw console text). */
  down: string;
  /** Yards to go for a first down. */
  toGo: number;
  /** Ball-on yard line. */
  ballOn: number;
  /** Possession: 'home' | 'away' | null when neither indicator is set. */
  possession: 'home' | 'away' | null;
  /** Play clock display string ("0:25" / ":25"), "" when blank. */
  playClock: string;
}

/** Basketball-specific fields (fouls, bonus, possession, shot clock). */
export interface DaktronicsBasketball {
  /** Team fouls this period. */
  homeTeamFouls: number;
  guestTeamFouls: number;
  /** Bonus indicators (1-on-1 = single bonus, 2-shot = double bonus). */
  homeBonus: boolean;
  homeDoubleBonus: boolean;
  guestBonus: boolean;
  guestDoubleBonus: boolean;
  /** Possession arrow / indicator: 'home' | 'away' | null. */
  possession: 'home' | 'away' | null;
  /** Shot-clock display string ("24" / ":24" / "0:24"), "" when blank. */
  shotClock: string;
}

/** Baseball/softball-specific fields (count, outs, baserunners, hits). */
export interface DaktronicsBaseball {
  /** Balls (0-4 displayed; console may show 4 transiently). */
  balls: number;
  /** Strikes (0-3). */
  strikes: number;
  /** Outs (0-3). */
  outs: number;
  /** At-bat: 'home' | 'away' | null (which side is batting). */
  atBat: 'home' | 'away' | null;
  /** Hits / errors / left-on-base per team. */
  homeHits: number;
  awayHits: number;
  homeErrors: number;
  awayErrors: number;
  /** Current batter's jersey number (0 = none shown). */
  batterNumber: number;
}

/**
 * Listener for parser update events. Receives the FULL accumulated
 * snapshot (not a delta), same contract as CtsUpdateListener.
 */
export type DaktronicsUpdateListener = (snapshot: DaktronicsSnapshot) => void;

// ── Protocol byte constants (exported for the mock + tests) ──────────
export const RTD = {
  SYN: 0x16,
  SOH: 0x01,
  STX: 0x02,
  EOT: 0x04,
  ETB: 0x17,
} as const;

/** The CONTROL-field prefix that marks a field-data write. The 5
 *  trailing decimal digits after this prefix are the 1-based buffer
 *  item position. Per packet.rs HEADER_PREFIX in the reference decoder. */
export const RTD_FIELD_PREFIX = '00421';
