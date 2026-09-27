/**
 * Feed packet ordering — K-12 sports launch program, lane A2 (K12-F14).
 *
 * A machine feed (a console bridge, a Sportzcast-style box, a provider
 * adapter) POSTs whole snapshots of the game several times a second. The
 * network does not keep them in order: a retried POST, a slow proxy or a
 * second box that was never switched off can deliver an OLDER snapshot after
 * a newer one — and before this, the older one simply won ("last write
 * wins"), rolling the score or the clock backwards on every board.
 *
 * THE ENVELOPE a feed may send with every snapshot (all optional — a feed
 * that sends none of it keeps the old last-write-wins behaviour):
 *
 *   session     who is feeding: one id per box BOOT (a restarted box, or a
 *               different box taking over, sends a new one). 1-64 chars.
 *   seq         the packet's number within its session, strictly increasing.
 *               Requires `session` — a bare counter would lock a restarted
 *               box out until it counted past its old high-water mark.
 *   eventId     the packet's own id; a second arrival is a duplicate.
 *   occurredAt  when the box read the scoreboard (epoch ms or ISO 8601).
 *               Orders packets of one session that carry no seq; kept on the
 *               event for forensics. Never compared ACROSS sessions — two
 *               boxes' clocks are not the same clock.
 *
 * THE RULES (orderFeedPacket):
 *   - same session, seq not above the last accepted one → stale;
 *   - same session, no seq, occurredAt before the last accepted one → stale;
 *   - a session that has been superseded (a newer session was accepted) →
 *     retired: its stragglers can never roll the game back, and the box that
 *     took over keeps the game ("switch sources" is explicit and one-way);
 *   - an eventId seen among the last few accepted → duplicate;
 *   - a new session is a takeover: accepted, and the old session is retired.
 *
 * The cursor is stored in Game.stats.feedCursor (a machine key — see
 * game-command.ts isMachineStatsKey) and advances in the same compare-and-
 * swap write as the snapshot it accepted, so two replicas receiving two
 * packets at once still apply them in order.
 *
 * Pure: no DB, no clock — every input is passed in.
 */
import { BadRequestException } from '@nestjs/common';

export interface FeedEnvelope {
  session: string | null;
  seq: number | null;
  eventId: string | null;
  occurredAt: number | null;
}

export interface FeedCursor {
  session: string | null;
  seq: number | null;
  occurredAt: number | null;
  /** The last accepted eventIds (newest first). */
  eventIds: string[];
  /** Sessions superseded by a newer one (newest first). */
  retired: string[];
}

export type FeedOrderVerdict =
  | { accept: true; cursor: FeedCursor }
  | {
      accept: false;
      reason:
        | 'stale-sequence'
        | 'stale-observation'
        | 'retired-session'
        | 'duplicate-event';
    };

const ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const SESSION_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_EVENT_IDS = 16;
const MAX_RETIRED = 8;

/** The envelope fields a snapshot DTO can carry. */
export const FEED_ENVELOPE_KEYS = [
  'session',
  'seq',
  'eventId',
  'occurredAt',
] as const;

function envelopeError(message: string): BadRequestException {
  return new BadRequestException({ code: 'FEED_ENVELOPE_INVALID', message });
}

/**
 * Validate and normalise the envelope of one snapshot. A malformed field is a
 * 400 (FEED_ENVELOPE_INVALID) — a garbled sequence number must never quietly
 * switch ordering off.
 */
export function cleanFeedEnvelope(
  raw: Record<string, unknown> | null | undefined,
): FeedEnvelope {
  const src = raw && typeof raw === 'object' ? raw : {};
  let session: string | null = null;
  if (src.session !== undefined && src.session !== null) {
    if (typeof src.session !== 'string' || !SESSION_RE.test(src.session)) {
      throw envelopeError(
        'session must be 1-64 characters of A-Z a-z 0-9 . _ : -',
      );
    }
    session = src.session;
  }
  let seq: number | null = null;
  if (src.seq !== undefined && src.seq !== null) {
    if (
      typeof src.seq !== 'number' ||
      !Number.isSafeInteger(src.seq) ||
      src.seq < 0
    ) {
      throw envelopeError('seq must be a non-negative whole number');
    }
    if (session === null) {
      throw envelopeError(
        'seq needs a session id (one per box boot), so a restarted box is not refused',
      );
    }
    seq = src.seq;
  }
  let eventId: string | null = null;
  if (src.eventId !== undefined && src.eventId !== null) {
    if (typeof src.eventId !== 'string' || !ID_RE.test(src.eventId)) {
      throw envelopeError(
        'eventId must be 1-100 characters of A-Z a-z 0-9 . _ : -',
      );
    }
    eventId = src.eventId;
  }
  let occurredAt: number | null = null;
  if (src.occurredAt !== undefined && src.occurredAt !== null) {
    const t =
      typeof src.occurredAt === 'number'
        ? src.occurredAt
        : typeof src.occurredAt === 'string'
          ? Date.parse(src.occurredAt)
          : NaN;
    if (!Number.isFinite(t) || t <= 0) {
      throw envelopeError(
        'occurredAt must be epoch milliseconds or an ISO 8601 time',
      );
    }
    occurredAt = Math.round(t);
  }
  return { session, seq, eventId, occurredAt };
}

/** Does the snapshot carry any envelope at all? */
export function hasEnvelope(env: FeedEnvelope): boolean {
  return (
    env.session !== null ||
    env.seq !== null ||
    env.eventId !== null ||
    env.occurredAt !== null
  );
}

/** The generic feed's stored cursor (Game.stats.feedCursor). */
export function readFeedCursor(stats: unknown): FeedCursor {
  const s =
    stats && typeof stats === 'object' && !Array.isArray(stats)
      ? (stats as Record<string, unknown>)
      : {};
  return parseFeedCursor(s.feedCursor);
}

/**
 * A stored cursor, tolerant of anything malformed (→ an empty cursor). The
 * CTS bridge keeps its own in Game.stats.cts.cursor, so a CTS console and a
 * generic feed on one game never retire each other's sessions.
 */
export function parseFeedCursor(raw: unknown): FeedCursor {
  const c =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const strings = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').slice(0, max)
      : [];
  return {
    session: typeof c.session === 'string' ? c.session : null,
    seq:
      typeof c.seq === 'number' && Number.isSafeInteger(c.seq) ? c.seq : null,
    occurredAt:
      typeof c.occurredAt === 'number' && Number.isFinite(c.occurredAt)
        ? c.occurredAt
        : null,
    eventIds: strings(c.eventIds, MAX_EVENT_IDS),
    retired: strings(c.retired, MAX_RETIRED),
  };
}

/** Decide one snapshot against the cursor (see the header for the rules). */
export function orderFeedPacket(
  cursor: FeedCursor,
  env: FeedEnvelope,
): FeedOrderVerdict {
  if (env.eventId !== null && cursor.eventIds.includes(env.eventId)) {
    return { accept: false, reason: 'duplicate-event' };
  }
  let session = cursor.session;
  let seq = cursor.seq;
  let occurredAt = cursor.occurredAt;
  let retired = cursor.retired;

  if (env.session !== null) {
    if (env.session === cursor.session) {
      if (env.seq !== null && cursor.seq !== null && env.seq <= cursor.seq) {
        return { accept: false, reason: 'stale-sequence' };
      }
      if (
        env.seq === null &&
        env.occurredAt !== null &&
        cursor.occurredAt !== null &&
        env.occurredAt < cursor.occurredAt
      ) {
        return { accept: false, reason: 'stale-observation' };
      }
    } else {
      if (retired.includes(env.session))
        return { accept: false, reason: 'retired-session' };
      // A new session takes over; the one it replaces can never come back.
      if (cursor.session !== null)
        retired = [cursor.session, ...retired].slice(0, MAX_RETIRED);
      session = env.session;
      seq = null;
      occurredAt = null;
    }
    if (env.seq !== null) seq = env.seq;
    if (env.occurredAt !== null) occurredAt = env.occurredAt;
  }

  const eventIds =
    env.eventId !== null
      ? [env.eventId, ...cursor.eventIds].slice(0, MAX_EVENT_IDS)
      : cursor.eventIds;
  return {
    accept: true,
    cursor: { session, seq, occurredAt, eventIds, retired },
  };
}
