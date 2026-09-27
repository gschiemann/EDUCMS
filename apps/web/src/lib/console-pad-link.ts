/**
 * console-pad-link — what the volunteer scorekeeper pad may CLAIM about its
 * connection (K12-F16).
 *
 * The audit's evidence: after 11 seconds of failed board reads the pad still
 * showed a red "LIVE" chip and no warning, so a volunteer could keep tapping
 * against a score they could no longer see. Player Reliability rule 10
 * applies here too — copy states what the evidence proves:
 *
 *   - "LIVE" only while the last good read of the board is fresh;
 *   - a failed or stalled read stream becomes a PERSISTENT "connection lost"
 *     state (never an auto-dismissing toast), and the controls pause — a tap
 *     made against a stale picture is how a wrong score reaches the board;
 *   - when reads come back after a loss the pad does not quietly resume: it
 *     shows the fresh score and waits for the volunteer to confirm it
 *     ("resync") before the controls work again.
 *
 * Backgrounding the phone is NOT a loss: the poll stops by design (mobile
 * perf standard), so on return the pad is merely "connecting" until its
 * first fresh read, then live — no confirmation needed, nothing was missed
 * while a tap could have been made.
 *
 * Thresholds match the public board's staleness chip (board-poll's
 * STALE_FEED_AFTER_MS; 2 s when the browser itself reports offline), so the
 * pad and the board flip together.
 *
 * Pure reducer — no React, no DOM, no timers — so every transition is a unit
 * test (see __tests__/console-pad-link.test.ts).
 */
import { STALE_FEED_AFTER_MS } from './board-poll';

/** No good read for this long while visible = connection lost. */
export const PAD_STALE_AFTER_MS = STALE_FEED_AFTER_MS;
/** …or this long when the browser reports navigator.onLine === false. */
export const PAD_OFFLINE_STALE_AFTER_MS = 2000;

export type PadLinkPhase =
  /** Waiting for the first fresh read (page load, or back from background). */
  | 'connecting'
  /** The last good read is fresh. The only phase where controls work. */
  | 'live'
  /** Reads failed or stalled past the threshold. Persistent. */
  | 'lost'
  /** Reads are back after a loss; the volunteer must confirm the score. */
  | 'resync'
  /** The tab is hidden — nothing polls, nothing is claimed. */
  | 'paused';

export interface PadLinkState {
  phase: PadLinkPhase;
  /** Local Date.now() of the last good read (200 or 304), or null. */
  lastGoodAt: number | null;
  /** When the current wait (connecting) began — the stall reference before
   *  any fresh read has landed. */
  waitingSince: number;
  /** When the loss was declared (for "lost for N s" copy). */
  lostAt: number | null;
  /** A loss happened and the volunteer has not confirmed the fresh score
   *  yet. Survives backgrounding — hiding the tab never clears a loss. */
  mustConfirm: boolean;
}

export type PadLinkEvent =
  | { type: 'good'; at: number }
  | { type: 'tick'; at: number; browserOffline?: boolean }
  | { type: 'hidden'; at: number }
  | { type: 'visible'; at: number }
  | { type: 'confirm'; at: number };

export function initialPadLink(at: number): PadLinkState {
  return { phase: 'connecting', lastGoodAt: null, waitingSince: at, lostAt: null, mustConfirm: false };
}

export function padLinkReducer(s: PadLinkState, e: PadLinkEvent): PadLinkState {
  switch (e.type) {
    case 'good': {
      // A hidden tab has no poll running; a straggler landing after the
      // stop() is ignored rather than resurrecting a claim.
      if (s.phase === 'paused') return s;
      return {
        ...s,
        lastGoodAt: e.at,
        phase: s.mustConfirm ? 'resync' : 'live',
      };
    }
    case 'tick': {
      const limit = e.browserOffline ? PAD_OFFLINE_STALE_AFTER_MS : PAD_STALE_AFTER_MS;
      if (s.phase === 'live' || s.phase === 'resync') {
        const since = s.lastGoodAt ?? s.waitingSince;
        if (e.at - since > limit) {
          return { ...s, phase: 'lost', lostAt: e.at, mustConfirm: true };
        }
        return s;
      }
      if (s.phase === 'connecting') {
        if (e.at - s.waitingSince > limit) {
          // Never reached the board since the wait began. If the pad had
          // shown a picture before (lastGoodAt), that picture is now stale
          // and the volunteer must confirm the fresh one when it lands.
          return { ...s, phase: 'lost', lostAt: e.at, mustConfirm: s.lastGoodAt !== null };
        }
        return s;
      }
      return s;
    }
    case 'hidden':
      if (s.phase === 'paused') return s;
      return { ...s, phase: 'paused' };
    case 'visible': {
      if (s.phase !== 'paused') return s;
      // Returning after a loss keeps the loss (and its confirm) until a
      // fresh read proves otherwise; otherwise just wait for a fresh read.
      if (s.mustConfirm) return { ...s, phase: 'lost', waitingSince: e.at };
      return { ...s, phase: 'connecting', waitingSince: e.at };
    }
    case 'confirm':
      if (s.phase !== 'resync') return s;
      return { ...s, phase: 'live', mustConfirm: false, lostAt: null };
    default:
      return s;
  }
}

/** Controls may send commands only while the picture is proven fresh. */
export function padControlsEnabled(s: PadLinkState): boolean {
  return s.phase === 'live';
}

/**
 * The single header chip. `live-game` is the ONLY state allowed to read
 * "LIVE", and only while the connection is live AND the game is LIVE; a
 * connected non-live game shows its status; everything else names the
 * connection state instead of the game state.
 */
export type PadChip = 'live-game' | 'game-status' | 'connecting' | 'lost' | 'resync' | 'paused';

export function padChip(s: PadLinkState, gameStatus: string): PadChip {
  if (s.phase === 'live') return gameStatus === 'LIVE' ? 'live-game' : 'game-status';
  return s.phase;
}

/** Whole seconds since the last good read, or null when there never was one. */
export function padSecondsSinceGood(s: PadLinkState, now: number): number | null {
  if (s.lastGoodAt === null) return null;
  return Math.max(0, Math.floor((now - s.lastGoodAt) / 1000));
}

// ── commands ─────────────────────────────────────────────────────────

/** Why a tap did not land. `offline` = no response at all (it may or may
 *  not have reached the server — the volunteer must check the board). */
export type PadFailure = 'offline' | 'not-permitted' | 'rate-limited' | 'refused' | 'server';

/** Classify a failed console request by its HTTP status (null = network). */
export function classifyPadFailure(status: number | null): PadFailure {
  if (status === null) return 'offline';
  if (status === 403) return 'not-permitted';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server';
  return 'refused';
}

/** A command the pad sent that did not land, kept on screen until dismissed. */
export interface PadRejectedCommand {
  id: number;
  label: string;
  failure: PadFailure;
  at: number;
}

/** Keep the newest few rejections (newest first) — enough to show what
 *  failed without growing forever on a long outage. */
export const PAD_MAX_REJECTED = 3;

export function pushRejected(
  list: PadRejectedCommand[],
  entry: PadRejectedCommand,
): PadRejectedCommand[] {
  return [entry, ...list].slice(0, PAD_MAX_REJECTED);
}
