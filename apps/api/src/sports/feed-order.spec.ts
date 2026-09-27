/**
 * Feed packet ordering rules (K12-F14) — pure, no clock, no DB.
 */
import { BadRequestException } from '@nestjs/common';
import {
  cleanFeedEnvelope,
  hasEnvelope,
  orderFeedPacket,
  parseFeedCursor,
  readFeedCursor,
  type FeedCursor,
} from './feed-order';

const EMPTY: FeedCursor = { session: null, seq: null, occurredAt: null, eventIds: [], retired: [] };
const env = (e: Partial<ReturnType<typeof cleanFeedEnvelope>>) => ({
  session: null,
  seq: null,
  eventId: null,
  occurredAt: null,
  ...e,
});

describe('cleanFeedEnvelope', () => {
  it('accepts the documented shapes and normalises occurredAt to epoch ms', () => {
    expect(cleanFeedEnvelope({ session: 'box.1:a-b_c', seq: 0, eventId: 'e-1', occurredAt: '2026-09-27T18:00:00.250Z' }))
      .toEqual({ session: 'box.1:a-b_c', seq: 0, eventId: 'e-1', occurredAt: Date.parse('2026-09-27T18:00:00.250Z') });
    expect(cleanFeedEnvelope({ occurredAt: 1_790_000_000_000.4 }).occurredAt).toBe(1_790_000_000_000);
    expect(cleanFeedEnvelope({ homeScore: 3 })).toEqual(env({}));
    expect(hasEnvelope(cleanFeedEnvelope({ homeScore: 3 }))).toBe(false);
    expect(cleanFeedEnvelope(null)).toEqual(env({}));
  });

  it.each([
    [{ seq: 1 }],
    [{ session: '' }],
    [{ session: 'x'.repeat(65) }],
    [{ session: 's', seq: Number.MAX_SAFE_INTEGER + 1 }],
    [{ session: 's', seq: '4' }],
    [{ eventId: 'a b' }],
    [{ occurredAt: 0 }],
    [{ occurredAt: {} }],
  ])('refuses %j', (raw) => {
    expect(() => cleanFeedEnvelope(raw as Record<string, unknown>)).toThrow(BadRequestException);
  });
});

describe('orderFeedPacket', () => {
  it('orders a session by seq', () => {
    const first = orderFeedPacket(EMPTY, env({ session: 's', seq: 1 }));
    expect(first.accept).toBe(true);
    const c = (first as { cursor: FeedCursor }).cursor;
    expect(orderFeedPacket(c, env({ session: 's', seq: 1 }))).toEqual({ accept: false, reason: 'stale-sequence' });
    expect(orderFeedPacket(c, env({ session: 's', seq: 0 }))).toEqual({ accept: false, reason: 'stale-sequence' });
    expect(orderFeedPacket(c, env({ session: 's', seq: 2 })).accept).toBe(true);
    // A packet of the session with no seq is not ordered by seq.
    expect(orderFeedPacket(c, env({ session: 's' })).accept).toBe(true);
  });

  it('a new session retires the old one; the retired list is bounded', () => {
    let c: FeedCursor = EMPTY;
    for (let i = 0; i < 12; i++) {
      const v = orderFeedPacket(c, env({ session: `s${i}`, seq: 1 }));
      expect(v.accept).toBe(true);
      c = (v as { cursor: FeedCursor }).cursor;
    }
    expect(c.session).toBe('s11');
    expect(c.retired).toHaveLength(8);
    expect(c.retired[0]).toBe('s10');
    expect(orderFeedPacket(c, env({ session: 's10', seq: 99 }))).toEqual({ accept: false, reason: 'retired-session' });
  });

  it('remembers the last 16 eventIds', () => {
    let c: FeedCursor = EMPTY;
    for (let i = 0; i < 20; i++) c = (orderFeedPacket(c, env({ eventId: `e${i}` })) as { cursor: FeedCursor }).cursor;
    expect(c.eventIds).toHaveLength(16);
    expect(orderFeedPacket(c, env({ eventId: 'e19' }))).toEqual({ accept: false, reason: 'duplicate-event' });
    expect(orderFeedPacket(c, env({ eventId: 'e0' })).accept).toBe(true); // aged out of the window
  });

  it('occurredAt orders only within one session, never across boxes', () => {
    const c = (orderFeedPacket(EMPTY, env({ session: 'a', occurredAt: 5_000 })) as { cursor: FeedCursor }).cursor;
    expect(orderFeedPacket(c, env({ session: 'a', occurredAt: 4_999 }))).toEqual({ accept: false, reason: 'stale-observation' });
    // Another box with an earlier clock can still take over.
    expect(orderFeedPacket(c, env({ session: 'b', occurredAt: 1 })).accept).toBe(true);
  });

  it('reads a malformed stored cursor as empty', () => {
    expect(readFeedCursor({ feedCursor: 'junk' })).toEqual(EMPTY);
    expect(parseFeedCursor({ session: 7, seq: 'x', eventIds: [1, 'a'], retired: null })).toEqual({
      ...EMPTY,
      eventIds: ['a'],
    });
    expect(readFeedCursor(undefined)).toEqual(EMPTY);
  });
});
