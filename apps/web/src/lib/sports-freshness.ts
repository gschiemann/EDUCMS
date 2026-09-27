/**
 * sports-freshness — THE freshness and recovery contract of every live game
 * surface (K-12 sports launch program, lane A2, K12-F40).
 *
 * The board, the ribbon, the scorebug, the operator console and the volunteer
 * pad each used to decide on their own what "live" meant: the board and the
 * ribbon flipped a CONNECTION LOST chip after 8 s, the scorebug never did, the
 * console had no read-freshness state at all, and the pad invented its own.
 * One question now gets one answer everywhere — this module is it:
 *
 *   connecting  waiting for the first good read since the surface (or its
 *               tab) came up. Nothing is claimed yet.
 *   live        the last good read (a 200 OR a 304 — both prove the server
 *               answered with the current state) is younger than
 *               LINK_STALE_AFTER_MS (2 s when the browser itself says it is
 *               offline — that may only HASTEN the verdict, never cause it).
 *   stale       no good read inside that window. The surface keeps its last
 *               frame, says the connection is lost, and HOLDS every clock at
 *               the reading it had when it went stale: a clock is never run
 *               on unconfirmed data (the table may have stopped it).
 *   recovering  the first good read after a loss. Display surfaces go
 *               straight back to live on it; a surface created with
 *               `confirmAfterLoss` (the volunteer pad) waits for its person
 *               to confirm the fresh picture first.
 *   paused      the tab is hidden, nothing polls, nothing is claimed.
 *
 * Plus the one rule every poller applies to what it receives (acceptRevision):
 * a payload whose game revision is OLDER than one already shown is never
 * applied. Two API replicas each cache the board for a second, so without it
 * a poll that lands on the other replica can roll a board back to the score
 * it showed a second ago.
 *
 * Pure reducer — no React, no DOM, no timers; every transition is a unit test.
 * Chromium-83 safe.
 */
import { STALE_FEED_AFTER_MS } from './board-poll';

/** No good read for this long = stale. Shared with board-poll's chip. */
export const LINK_STALE_AFTER_MS = STALE_FEED_AFTER_MS;
/** …or this long when navigator.onLine reports false. */
export const LINK_OFFLINE_STALE_AFTER_MS = 2000;

export type LinkPhase = 'connecting' | 'live' | 'stale' | 'recovering' | 'paused';

export interface LinkState {
  phase: LinkPhase;
  /** Local ms of the last good read, or null before the first one. */
  lastGoodAt: number | null;
  /** When the current wait for a first read began. */
  waitingSince: number;
  /** Local ms the link went stale — the instant clocks are held at. */
  staleSince: number | null;
  /** A loss happened and (for confirming surfaces) is not yet confirmed. */
  hadLoss: boolean;
  confirmAfterLoss: boolean;
}

export type LinkEvent =
  | { type: 'good'; at: number }
  | { type: 'tick'; at: number; browserOffline?: boolean }
  | { type: 'hidden'; at: number }
  | { type: 'visible'; at: number }
  | { type: 'confirm'; at: number };

export function initialLink(at: number, opts: { confirmAfterLoss?: boolean } = {}): LinkState {
  return {
    phase: 'connecting',
    lastGoodAt: null,
    waitingSince: at,
    staleSince: null,
    hadLoss: false,
    confirmAfterLoss: !!opts.confirmAfterLoss,
  };
}

export function linkReducer(s: LinkState, e: LinkEvent): LinkState {
  switch (e.type) {
    case 'good': {
      // A straggler landing after the tab was hidden resurrects nothing.
      if (s.phase === 'paused') return s;
      const recovering = s.hadLoss && s.confirmAfterLoss;
      return {
        ...s,
        lastGoodAt: e.at,
        staleSince: null,
        phase: recovering ? 'recovering' : 'live',
        hadLoss: recovering,
      };
    }
    case 'tick': {
      const limit = e.browserOffline ? LINK_OFFLINE_STALE_AFTER_MS : LINK_STALE_AFTER_MS;
      if (s.phase === 'live' || s.phase === 'recovering') {
        const since = s.lastGoodAt ?? s.waitingSince;
        return e.at - since > limit ? { ...s, phase: 'stale', staleSince: e.at, hadLoss: true } : s;
      }
      if (s.phase === 'connecting') {
        return e.at - s.waitingSince > limit
          ? { ...s, phase: 'stale', staleSince: e.at, hadLoss: s.hadLoss || s.lastGoodAt !== null }
          : s;
      }
      return s;
    }
    case 'hidden':
      return s.phase === 'paused' ? s : { ...s, phase: 'paused', staleSince: null };
    case 'visible':
      // Back from the background: no claim until a fresh read lands (a
      // loss that was not confirmed yet stays owed).
      return s.phase === 'paused' ? { ...s, phase: 'connecting', waitingSince: e.at, staleSince: null } : s;
    case 'confirm':
      return s.phase === 'recovering' ? { ...s, phase: 'live', hadLoss: false } : s;
    default:
      return s;
  }
}

/** Only a live link may claim to be live (a LIVE badge, a green light). */
export function linkIsLive(s: LinkState): boolean {
  return s.phase === 'live';
}

/**
 * Apply a payload only if it is not OLDER than what is already shown.
 * `null` on either side (an API that predates revisions, a first payload)
 * always applies.
 */
export function acceptRevision(shown: number | null | undefined, incoming: unknown): boolean {
  if (typeof incoming !== 'number' || !isFinite(incoming)) return true;
  if (typeof shown !== 'number' || !isFinite(shown)) return true;
  return incoming >= shown;
}

/** Whole seconds since the last good read, or null when there never was one. */
export function secondsSinceGood(s: LinkState, now: number): number | null {
  return s.lastGoodAt === null ? null : Math.max(0, Math.floor((now - s.lastGoodAt) / 1000));
}

/**
 * Who is driving the game right now, from the stats the board payload
 * carries: a CTS console whose heartbeat is fresh, a machine feed whose last
 * packet is fresh, else the operators at the table. `serverNow` in the
 * server's clock (the stamps are written in it).
 */
export type GameSource = 'cts' | 'feed' | 'manual';
export const SOURCE_FRESH_MS = 5000;

export function authoritativeSource(stats: unknown, serverNow: number): GameSource {
  const s = stats && typeof stats === 'object' ? (stats as Record<string, unknown>) : {};
  const age = (iso: unknown) => {
    const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
    return isFinite(t) ? serverNow - t : Infinity;
  };
  const cts = s.cts && typeof s.cts === 'object' ? (s.cts as Record<string, unknown>) : null;
  if (cts && age(cts.lastUpdateAt) < SOURCE_FRESH_MS) return 'cts';
  const feed = s.feed && typeof s.feed === 'object' ? (s.feed as Record<string, unknown>) : null;
  if (feed && feed.source === 'feed' && feed.accepted !== false && age(feed.lastPacketAt) < SOURCE_FRESH_MS) {
    return 'feed';
  }
  return 'manual';
}
