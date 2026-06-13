/**
 * Channel-grid model + configurable water-polo field extraction.
 *
 * WHY THIS EXISTS (2026-06-11 first-customer hardening): real CTS consoles
 * — both the legacy RS-232 ("classic") stream and the Gen7/WA-2 RS-485
 * stream — transmit a DISPLAY IMAGE, not semantic fields: a grid of
 * channels (a.k.a. modules), each holding up to N character positions.
 * Which channel means "score" vs "shot clock" is sport- AND
 * venue-configurable (System 6 "Define Module" + per-board DIP switches),
 * so hardcoding module semantics in the wire parser (the pre-06-11
 * CTS_MODULE approach) was wrong twice over: wrong default channel
 * numbers vs the F872 water-polo manual, and unfixable on-site when a
 * venue's mapping differs.
 *
 * The fix is this layer: both transports decode bytes into a ChannelGrid,
 * and ONE extractor turns the grid into CtsFullSnapshot using a
 * WaterPoloChannelMap that defaults to the documented F872 layout and is
 * overridable per profile / per venue (bring-up reconciliation = a config
 * edit, not a code change).
 *
 * F872 (System 6 Water Polo manual, Appendix B) default layout:
 *   ch1  TIME        "88:88.88" game clock
 *   ch2  PER + SHOT  digit0 = period, then shot clock ":88.88" packing
 *   ch5  SCORE       home "88" + away "88"
 *   ch7  packed line "88 88:88 88" (home · clock · away) — fallback
 *   ch4  EJECT A · ch3 EJECT B · ch11 EJECT C  (cap# + countdown)
 *   ch9  SHOT        ":88.88" standalone (preferred over ch2 when present)
 *   ch12/ch6 TIME OUT
 *   ch13 CAP·GOALS·CAP (scorer recognition) · ch14 CAP·FOULS·CAP
 * Side-assignment of the three eject lines is venue-configured; the
 * default map marks them 'unknown' and the extractor surfaces them on the
 * home list in order (the bring-up capture tells us the real sides —
 * override `side` then).
 */

import type {
  CtsExclusion,
  CtsFullSnapshot,
  CtsStructuredShotClock,
} from './types';

/** One channel line: character cells + per-cell decimal points. */
export interface ChannelLine {
  chars: string[];
  decPoints: boolean[];
  /** Gen7 "universal" flag (module header bit 0x40). When set, this
   *  module mirrors module 0's shared digits — readers redirect to
   *  module 0 (reference ctsScoreboardasync.js GetTime/GetDigits:
   *  `module1 = Univ ? 0 : module`). The legacy "classic" decoder never
   *  sets it, so it is a no-op for that transport. */
  univ?: boolean;
}

/** The decoded display image: channel number → line. */
export type ChannelGrid = Map<number, ChannelLine>;

export function createGrid(): ChannelGrid {
  return new Map();
}

/** Get (or lazily create) a channel line sized to `width` cells. */
export function gridLine(grid: ChannelGrid, channel: number, width = 8): ChannelLine {
  let line = grid.get(channel);
  if (!line) {
    line = { chars: new Array(width).fill(' '), decPoints: new Array(width).fill(false) };
    grid.set(channel, line);
  } else if (line.chars.length < width) {
    while (line.chars.length < width) {
      line.chars.push(' ');
      line.decPoints.push(false);
    }
  }
  return line;
}

/** Read a slice of a channel as a trimmed string ('' when absent).
 *  Honors the Gen7 "universal" flag: a channel flagged univ mirrors
 *  module 0's shared digits, so the read redirects there (reference
 *  ctsScoreboardasync.js GetTime: `module1 = Univ ? 0 : module`). No-op
 *  for classic (never sets univ) and for module 0 itself. */
export function gridText(grid: ChannelGrid, channel: number, start = 0, count?: number): string {
  let line = grid.get(channel);
  if (line?.univ && channel !== 0) {
    line = grid.get(0) ?? line;
  }
  if (!line) return '';
  const end = count == null ? line.chars.length : Math.min(start + count, line.chars.length);
  return line.chars.slice(start, end).join('');
}

/** Digit-slice spec inside one channel. */
export interface DigitSlice {
  channel: number;
  start: number;
  count: number;
}

/** One eject (exclusion) line: cap digits + time digits + side. */
export interface EjectSlot {
  channel: number;
  /** Which team the line belongs to. 'unknown' until the venue capture
   *  confirms — extractor then surfaces it on the home list in order. */
  side: 'home' | 'away' | 'unknown';
  capStart: number;
  capCount: number;
  timeStart: number;
  timeCount: number;
}

/**
 * Venue-overridable water-polo channel map. Every field is a plain JSON
 * shape so a profile/query override can replace any part of it.
 */
export interface WaterPoloChannelMap {
  clock: DigitSlice;
  period: DigitSlice;
  /** Standalone shot-clock slice (preferred when its channel is live). */
  shot: DigitSlice;
  /** Fallback shot slice packed beside the period (F872 ch2). */
  shotPacked: DigitSlice;
  homeScore: DigitSlice;
  awayScore: DigitSlice;
  /** Packed combo line "HH 88:88 AA" used when the score channel is idle. */
  packedLine?: {
    channel: number;
    homeStart: number;
    homeCount: number;
    awayStart: number;
    awayCount: number;
  };
  ejects: EjectSlot[];
  homeTimeouts: DigitSlice;
  awayTimeouts: DigitSlice;
}

/** F872 Appendix B defaults (System 6 water polo). */
export const F872_WATER_POLO_MAP: WaterPoloChannelMap = {
  clock: { channel: 1, start: 0, count: 8 },
  period: { channel: 2, start: 0, count: 1 },
  shotPacked: { channel: 2, start: 1, count: 5 },
  shot: { channel: 9, start: 0, count: 6 },
  homeScore: { channel: 5, start: 0, count: 2 },
  awayScore: { channel: 5, start: 2, count: 2 },
  packedLine: { channel: 7, start: 0, homeStart: 0, homeCount: 2, awayStart: 6, awayCount: 2 } as any,
  ejects: [
    { channel: 4, side: 'unknown', capStart: 0, capCount: 2, timeStart: 2, timeCount: 3 },
    { channel: 3, side: 'unknown', capStart: 0, capCount: 2, timeStart: 2, timeCount: 3 },
    { channel: 11, side: 'unknown', capStart: 0, capCount: 2, timeStart: 2, timeCount: 3 },
  ],
  homeTimeouts: { channel: 12, start: 0, count: 1 },
  awayTimeouts: { channel: 6, start: 0, count: 1 },
};

/** Deep-merge a partial override (e.g. from a profile or `?ctsMap=` JSON)
 *  over the F872 defaults. Arrays replace wholesale. */
export function resolveWaterPoloMap(override?: Partial<WaterPoloChannelMap> | null): WaterPoloChannelMap {
  if (!override) return F872_WATER_POLO_MAP;
  return {
    ...F872_WATER_POLO_MAP,
    ...override,
    ejects: override.ejects ?? F872_WATER_POLO_MAP.ejects,
  };
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');

function sliceText(grid: ChannelGrid, s: DigitSlice): string {
  return gridText(grid, s.channel, s.start, s.count);
}

function parseIntSafe(s: string): number {
  const d = digits(s);
  if (!d) return 0;
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : 0;
}

/** "8:88.8" / "88:88" style clock normalize: trim + collapse blanks. */
function normalizeClock(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  return t;
}

function parseShot(raw: string, prevMs: number, receivedAt: number, prevAt: number): CtsStructuredShotClock {
  const d = digits(raw);
  const trimmed = raw.trim();
  if (!d) return { raw: trimmed, ms: 0, running: false };
  // Shot displays are whole seconds (":30") or seconds.tenths (":08.4").
  const dot = trimmed.includes('.');
  let ms: number;
  if (dot) {
    const [secPart, tenthPart] = trimmed.replace(/[^0-9.]/g, '').split('.');
    ms = parseIntSafe(secPart ?? '') * 1000 + parseIntSafe((tenthPart ?? '').slice(0, 1)) * 100;
  } else {
    ms = parseIntSafe(d) * 1000;
  }
  // Cadence inference: a value change between updates ⇒ counting.
  const running = ms > 0 && ms !== prevMs && prevAt > 0 && receivedAt - prevAt < 3000;
  return { raw: trimmed, ms, running };
}

function parseEjects(grid: ChannelGrid, slots: EjectSlot[]): { home: CtsExclusion[]; away: CtsExclusion[] } {
  const home: CtsExclusion[] = [];
  const away: CtsExclusion[] = [];
  for (const slot of slots) {
    const cap = parseIntSafe(gridText(grid, slot.channel, slot.capStart, slot.capCount));
    const timeRaw = gridText(grid, slot.channel, slot.timeStart, slot.timeCount);
    const secs = parseIntSafe(timeRaw);
    if (cap === 0 && secs === 0) continue; // idle line
    const entry: CtsExclusion = { playerJersey: cap, secondsRemaining: secs };
    if (slot.side === 'away') away.push(entry);
    else home.push(entry); // 'home' and (honestly) 'unknown' until capture
  }
  return { home, away };
}

/**
 * Extract a water-polo CtsFullSnapshot from the channel grid.
 * `prev` supplies last-known values so untouched fields persist (idle
 * channels aren't retransmitted) and shot-clock cadence can be inferred.
 */
export function extractWaterPolo(
  grid: ChannelGrid,
  map: WaterPoloChannelMap,
  prev: CtsFullSnapshot,
  horn: boolean,
  receivedAt: number,
): CtsFullSnapshot {
  const clockRaw = normalizeClock(sliceText(grid, map.clock));
  const periodRaw = digits(sliceText(grid, map.period));

  // Shot: standalone channel wins when it has digits; else the packed slice.
  const shotStandalone = sliceText(grid, map.shot);
  const shotPacked = sliceText(grid, map.shotPacked);
  const shotRaw = digits(shotStandalone) ? shotStandalone : shotPacked;
  const shot = parseShot(shotRaw, prev.homeShotClock?.ms ?? 0, receivedAt, prev.receivedAt ?? 0);

  // Score: dedicated channel; fall back to the packed combo line.
  let homeScoreRaw = sliceText(grid, map.homeScore);
  let awayScoreRaw = sliceText(grid, map.awayScore);
  if (!digits(homeScoreRaw) && !digits(awayScoreRaw) && map.packedLine) {
    const p = map.packedLine;
    // Packed line is "HH 88:88 AA" (home · clock · away). The exact cell
    // offsets vary by console/firmware (this is the idle-score fallback),
    // so tokenize the whole channel into numeric groups and take
    // home = first group, away = LAST group — robust to spacing/colon
    // cells and to the away digits sitting at 6, 8, or 9. Falls back to
    // the configured offsets only if tokenizing finds < 2 groups.
    const groups = gridText(grid, p.channel, 0).split(/[^0-9]+/).filter(Boolean);
    if (groups.length >= 2) {
      homeScoreRaw = groups[0];
      awayScoreRaw = groups[groups.length - 1];
    } else {
      homeScoreRaw = gridText(grid, p.channel, p.homeStart, p.homeCount);
      awayScoreRaw = gridText(grid, p.channel, p.awayStart, p.awayCount);
    }
  }

  const { home: homeExclusions, away: awayExclusions } = parseEjects(grid, map.ejects);

  const homeTORaw = digits(sliceText(grid, map.homeTimeouts));
  const awayTORaw = digits(sliceText(grid, map.awayTimeouts));

  return {
    clock: clockRaw || prev.clock,
    period: periodRaw ? parseIntSafe(periodRaw) : prev.period,
    homeScore: digits(homeScoreRaw) ? parseIntSafe(homeScoreRaw) : prev.homeScore,
    awayScore: digits(awayScoreRaw) ? parseIntSafe(awayScoreRaw) : prev.awayScore,
    // Water polo has ONE possession clock; both fields carry it so every
    // existing widget (which reads home/away) renders correctly.
    homeShotClock: shot,
    awayShotClock: shot,
    homeExclusions,
    awayExclusions,
    homeTimeoutsRemaining: homeTORaw ? parseIntSafe(homeTORaw) : prev.homeTimeoutsRemaining,
    awayTimeoutsRemaining: awayTORaw ? parseIntSafe(awayTORaw) : prev.awayTimeoutsRemaining,
    horn,
    receivedAt,
  };
}

/** A blank starting snapshot (mirrors CtsParser's construction defaults). */
export function emptySnapshot(): CtsFullSnapshot {
  return {
    clock: '',
    period: 0,
    homeScore: 0,
    awayScore: 0,
    homeShotClock: { raw: '', ms: 0, running: false },
    awayShotClock: { raw: '', ms: 0, running: false },
    homeExclusions: [],
    awayExclusions: [],
    homeTimeoutsRemaining: 0,
    awayTimeoutsRemaining: 0,
    horn: false,
    receivedAt: 0,
  };
}
