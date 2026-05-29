/**
 * @cms/scoreboard-cts/daktronics/offsets — per-sport RTD buffer field
 * maps for the Daktronics All Sport 5000 / 5500 / 3000.
 *
 * ── Provenance ───────────────────────────────────────────────────────
 * Every (offset, length) pair below is transcribed VERBATIM from the
 * MIT-licensed reference decoder
 * github.com/zabackary/daktronics-allsport-5000-rs
 * (src/sports/{football,basketball,baseball}.rs `sport_builder!` field
 * tuples), which in turn derive from Daktronics' "All Sport 5000 Series
 * Enhanced RTD" reference manual (ED-12483).
 *
 * ── Offset numbering ─────────────────────────────────────────────────
 * `offset` is the **1-based item position** exactly as it appears in
 * the Daktronics manual AND the reference decoder's field tuples. The
 * reader (`readField` in parser.ts) subtracts 1 to index the 0-based
 * buffer — mirroring `real_index = item - 1` in the reference
 * `RTDState::field_str`. DO NOT pre-subtract here; keeping the table
 * 1-based means it diffs cleanly against the manual / reference.
 *
 * ── Justification ────────────────────────────────────────────────────
 * `justify` matches the reference: 'L' (left) trims trailing spaces,
 * 'R' (right) trims leading spaces, 'N' (none) leaves the raw slice.
 * Numeric fields are right-justified in the buffer; we trim then parse.
 *
 * ── FIELD-VALIDATION STATUS (READ THIS) ──────────────────────────────
 * These offsets are taken from a community reverse-engineered decoder,
 * not from a console we physically tapped. The reference's own headers
 * say each sport "was generated semi-automatically and may contain
 * errors." High-confidence core fields (clock, score, period, the
 * down/distance and balls/strikes/outs blocks) are corroborated across
 * BOTH open decoders + the protocol forum thread. Lower-confidence
 * fields are flagged inline with `verified: false` and enumerated in
 * UNVERIFIED_OFFSETS below — they need validation against a real All
 * Sport console or the Daktronics RTD simulator before production trust.
 */

import type { DaktronicsSport } from './types';

export type Justify = 'L' | 'R' | 'N';

export interface FieldDef {
  /** 1-based item position in the RTD display buffer (manual numbering). */
  readonly offset: number;
  /** Field width in bytes. */
  readonly length: number;
  /** Whitespace trim behavior. */
  readonly justify: Justify;
  /** False = transcribed from the reference but NOT corroborated by a
   *  second source or a real console; needs field validation. */
  readonly verified: boolean;
}

/**
 * Fields common to every sport's RTD buffer (identical offsets across
 * football / basketball / baseball — the All Sport lays the shared
 * header out the same way for all codes). Item numbers 1-30.
 */
export interface CommonFields {
  /** Main clock "mm:ss / ss.t" — item 1, off 1 len 5. */
  readonly mainClock: FieldDef;
  /** Main clock = 0 flag (' ' or 'z') — item 5, off 27 len 1. */
  readonly clockIsZero: FieldDef;
  /** Main clock stopped flag (' ' or 's') — item 6, off 28 len 1. */
  readonly clockStopped: FieldDef;
  /** Main clock / time-out horn (' ' or 'h') — item 7, off 29 len 1. */
  readonly mainClockTimeOutHorn: FieldDef;
  /** Main clock horn (' ' or 'h') — item 8, off 30 len 1. */
  readonly mainClockHorn: FieldDef;
  /** Time-out horn (' ' or 'h') — item 9, off 31 len 1. */
  readonly timeOutHorn: FieldDef;
  /** Home team score — item 16, off 108 len 4. */
  readonly homeScore: FieldDef;
  /** Guest team score — item 17, off 112 len 4. */
  readonly guestScore: FieldDef;
  /** Home time-outs left, total — item 21, off 122 len 2. */
  readonly homeTimeoutsTotal: FieldDef;
  /** Guest time-outs left, total — item 25, off 130 len 2. */
  readonly guestTimeoutsTotal: FieldDef;
  /** Period / Quarter / Inning — item 30, off 142 len 2. */
  readonly period: FieldDef;
}

const COMMON: CommonFields = {
  mainClock: { offset: 1, length: 5, justify: 'L', verified: true },
  clockIsZero: { offset: 27, length: 1, justify: 'L', verified: true },
  clockStopped: { offset: 28, length: 1, justify: 'L', verified: true },
  mainClockTimeOutHorn: { offset: 29, length: 1, justify: 'L', verified: true },
  mainClockHorn: { offset: 30, length: 1, justify: 'L', verified: true },
  timeOutHorn: { offset: 31, length: 1, justify: 'L', verified: true },
  homeScore: { offset: 108, length: 4, justify: 'R', verified: true },
  guestScore: { offset: 112, length: 4, justify: 'R', verified: true },
  // Time-outs-total + period are corroborated by both decoders but the
  // exact total-vs-full/partial split is sometimes console-config
  // dependent; mark the totals verified (they're the stable read) and
  // period verified (it's item 30 in every sport table).
  homeTimeoutsTotal: { offset: 122, length: 2, justify: 'R', verified: true },
  guestTimeoutsTotal: { offset: 130, length: 2, justify: 'R', verified: true },
  period: { offset: 142, length: 2, justify: 'R', verified: true },
} as const;

// ── Football ──────────────────────────────────────────────────────────
export interface FootballFields extends CommonFields {
  /** Ball On (yard line) — item 46, off 220 len 2. */
  readonly ballOn: FieldDef;
  /** Down text "1st".."4th" — item 47, off 222 len 3. */
  readonly down: FieldDef;
  /** To Go (yards) — item 48, off 225 len 2. */
  readonly toGo: FieldDef;
  /** Play Clock Time "mm:ss" — item 40, off 201 len 8. */
  readonly playClock: FieldDef;
  /** Home possession indicator (' ' or '<') — item 42, off 210 len 1. */
  readonly homePossession: FieldDef;
  /** Guest possession indicator (' ' or '>') — item 44, off 215 len 1. */
  readonly guestPossession: FieldDef;
}

const FOOTBALL: FootballFields = {
  ...COMMON,
  ballOn: { offset: 220, length: 2, justify: 'R', verified: true },
  down: { offset: 222, length: 3, justify: 'L', verified: true },
  toGo: { offset: 225, length: 2, justify: 'R', verified: true },
  // Play clock + possession indicators are item 40/42/44 — present in
  // the reference but a common point of console-code variation
  // (some football inserts park the play clock elsewhere). Flag for
  // field validation.
  playClock: { offset: 201, length: 8, justify: 'L', verified: false },
  homePossession: { offset: 210, length: 1, justify: 'L', verified: false },
  guestPossession: { offset: 215, length: 1, justify: 'L', verified: false },
} as const;

// ── Basketball ──────────────────────────────────────────────────────────
export interface BasketballFields extends CommonFields {
  /** Shot Clock Time "mm:ss" — item 40, off 201 len 8. */
  readonly shotClock: FieldDef;
  /** Home possession indicator (' ' or '<') — item 42, off 210 len 1. */
  readonly homePossession: FieldDef;
  /** Guest possession indicator (' ' or '>') — item 45, off 216 len 1. */
  readonly guestPossession: FieldDef;
  /** Home 1-on-1 (single) bonus (' ' or '<') — item 48, off 222 len 1. */
  readonly homeBonus: FieldDef;
  /** Home 2-shot (double) bonus (' ' or '<') — item 49, off 223 len 1. */
  readonly homeDoubleBonus: FieldDef;
  /** Guest 1-on-1 (single) bonus (' ' or '>') — item 51, off 229 len 1. */
  readonly guestBonus: FieldDef;
  /** Guest 2-shot (double) bonus (' ' or '>') — item 52, off 230 len 1. */
  readonly guestDoubleBonus: FieldDef;
  /** Home team fouls — item 54, off 236 len 2. */
  readonly homeTeamFouls: FieldDef;
  /** Guest team fouls — item 55, off 238 len 2. */
  readonly guestTeamFouls: FieldDef;
}

const BASKETBALL: BasketballFields = {
  ...COMMON,
  homeTeamFouls: { offset: 236, length: 2, justify: 'R', verified: true },
  guestTeamFouls: { offset: 238, length: 2, justify: 'R', verified: true },
  // Shot clock + bonus/possession indicators corroborated in the
  // reference; the shot clock in particular is a frequent console-code
  // variant (basketball vs basketball-with-shot-clock inserts). Flag.
  shotClock: { offset: 201, length: 8, justify: 'L', verified: false },
  homePossession: { offset: 210, length: 1, justify: 'L', verified: false },
  guestPossession: { offset: 216, length: 1, justify: 'L', verified: false },
  homeBonus: { offset: 222, length: 1, justify: 'L', verified: false },
  homeDoubleBonus: { offset: 223, length: 1, justify: 'L', verified: false },
  guestBonus: { offset: 229, length: 1, justify: 'L', verified: false },
  guestDoubleBonus: { offset: 230, length: 1, justify: 'L', verified: false },
} as const;

// ── Baseball / softball ──────────────────────────────────────────────
export interface BaseballFields extends CommonFields {
  /** Ball count — item 50, off 222 len 1. */
  readonly balls: FieldDef;
  /** Strike count — item 51, off 223 len 1. */
  readonly strikes: FieldDef;
  /** Out count — item 52, off 224 len 1. */
  readonly outs: FieldDef;
  /** Home at-bat indicator (' ' or '>') — item 40, off 201 len 1. */
  readonly homeAtBat: FieldDef;
  /** Guest at-bat indicator (' ' or '>') — item 41, off 202 len 1. */
  readonly guestAtBat: FieldDef;
  /** Home hits — item 42, off 203 len 2. */
  readonly homeHits: FieldDef;
  /** Guest hits — item 45, off 209 len 2. */
  readonly guestHits: FieldDef;
  /** Home errors — item 43, off 205 len 2. */
  readonly homeErrors: FieldDef;
  /** Guest errors — item 46, off 211 len 2. */
  readonly guestErrors: FieldDef;
  /** Batter number — item 48, off 215 len 2. */
  readonly batterNumber: FieldDef;
}

const BASEBALL: BaseballFields = {
  ...COMMON,
  // Count (balls/strikes/outs) is the canonical baseball block —
  // corroborated across both decoders. High confidence.
  balls: { offset: 222, length: 1, justify: 'R', verified: true },
  strikes: { offset: 223, length: 1, justify: 'R', verified: true },
  outs: { offset: 224, length: 1, justify: 'R', verified: true },
  // At-bat indicators + hits/errors/batter are present in the
  // reference but less commonly cross-checked. Flag for validation.
  homeAtBat: { offset: 201, length: 1, justify: 'L', verified: false },
  guestAtBat: { offset: 202, length: 1, justify: 'L', verified: false },
  homeHits: { offset: 203, length: 2, justify: 'R', verified: false },
  guestHits: { offset: 209, length: 2, justify: 'R', verified: false },
  homeErrors: { offset: 205, length: 2, justify: 'R', verified: false },
  guestErrors: { offset: 211, length: 2, justify: 'R', verified: false },
  batterNumber: { offset: 215, length: 2, justify: 'R', verified: false },
} as const;

/** The full offset table, keyed by sport. */
export const DAKTRONICS_OFFSETS = {
  football: FOOTBALL,
  basketball: BASKETBALL,
  baseball: BASEBALL,
} as const;

/**
 * Largest (offset-1 + length) referenced across all sports, used to
 * size the RTD buffer so a positioned write near the end never
 * overflows. Baseball's batter/hits, basketball's fouls (off 238 len 2
 * = index 237..239), and football's stats all live well under 700.
 * We size to 1024 (1 KiB) — the reference's default RTDState buffer
 * size — for comfortable headroom (the buffer is virtual ASCII; the
 * cost is one 1 KiB allocation per parser, negligible).
 */
export const RTD_BUFFER_SIZE = 1024;

/**
 * Machine-readable list of the offsets that have NOT been validated
 * against a real console — surfaced so a future agent / the install
 * tech can prioritize field validation. Each entry mirrors a
 * `verified: false` FieldDef above.
 */
export const UNVERIFIED_OFFSETS: ReadonlyArray<{
  sport: DaktronicsSport;
  field: string;
  offset: number;
  length: number;
  reason: string;
}> = [
  { sport: 'football', field: 'playClock', offset: 201, length: 8, reason: 'item 40 — play-clock placement varies by football insert/code' },
  { sport: 'football', field: 'homePossession', offset: 210, length: 1, reason: 'item 42 — possession indicator, console-code dependent' },
  { sport: 'football', field: 'guestPossession', offset: 215, length: 1, reason: 'item 44 — possession indicator, console-code dependent' },
  { sport: 'basketball', field: 'shotClock', offset: 201, length: 8, reason: 'item 40 — shot clock only on shot-clock-enabled inserts' },
  { sport: 'basketball', field: 'homePossession', offset: 210, length: 1, reason: 'item 42 — possession arrow, console-code dependent' },
  { sport: 'basketball', field: 'guestPossession', offset: 216, length: 1, reason: 'item 45 — possession arrow, console-code dependent' },
  { sport: 'basketball', field: 'homeBonus', offset: 222, length: 1, reason: 'item 48 — 1-on-1 bonus indicator' },
  { sport: 'basketball', field: 'homeDoubleBonus', offset: 223, length: 1, reason: 'item 49 — 2-shot bonus indicator' },
  { sport: 'basketball', field: 'guestBonus', offset: 229, length: 1, reason: 'item 51 — 1-on-1 bonus indicator' },
  { sport: 'basketball', field: 'guestDoubleBonus', offset: 230, length: 1, reason: 'item 52 — 2-shot bonus indicator' },
  { sport: 'baseball', field: 'homeAtBat', offset: 201, length: 1, reason: 'item 40 — at-bat indicator' },
  { sport: 'baseball', field: 'guestAtBat', offset: 202, length: 1, reason: 'item 41 — at-bat indicator' },
  { sport: 'baseball', field: 'homeHits', offset: 203, length: 2, reason: 'item 42 — hits' },
  { sport: 'baseball', field: 'guestHits', offset: 209, length: 2, reason: 'item 45 — hits' },
  { sport: 'baseball', field: 'homeErrors', offset: 205, length: 2, reason: 'item 43 — errors' },
  { sport: 'baseball', field: 'guestErrors', offset: 211, length: 2, reason: 'item 46 — errors' },
  { sport: 'baseball', field: 'batterNumber', offset: 215, length: 2, reason: 'item 48 — batter number' },
] as const;
