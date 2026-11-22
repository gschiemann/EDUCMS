/**
 * EMG-04 (2026-11-21) — the player keeps every pushed message, shows the most
 * severe, and clears only by id. Shapes are the real ones: `push()` goes
 * through the same mapper the WS and SSE handlers call, with the payload the
 * API signs (`emergency.controller.ts`: `messageId`, `severity`, `text` /
 * `textBlob`, `expiresAt` in epoch seconds; no `createdAt`), and poll rows
 * are the API's `toEmergencyMessageView` shape.
 */
import { pushedEmergencyFromPayload, type PushedEmergencyType } from '../pushedEmergencyMessage';
import {
  EMPTY_PUSHED_MESSAGES,
  MAX_PUSHED_MESSAGES,
  PUSHED_MESSAGE_EXPIRY_GRACE_MS,
  addPushedMessage,
  addedPushedMessageIds,
  clearPushedMessage,
  compareEmergencyMessages,
  emergencyMessageFromPollRow,
  pushedClearMessageId,
  reconcilePushedMessages,
  removedPushedMessageIds,
  shownPushedMessage,
  type PollAnswer,
  type PushClock,
  type PushedMessages,
} from '../pushedMessages';

const SERVER_NOW = 1_792_000_000_000;
let wall = SERVER_NOW;
let mono = 5_000;
const clock = (): PushClock => ({ monoNowMs: mono, serverNowMs: wall });
const tick = (ms: number) => { wall += ms; mono += ms; };

beforeEach(() => { wall = SERVER_NOW; mono = 5_000; });

/** A gate-passed push as the page builds it (server-corrected clock for createdAt). */
function message(type: PushedEmergencyType, payload: Record<string, unknown>) {
  return pushedEmergencyFromPayload(type, payload, 'evt-envelope', () => wall);
}
function push(state: PushedMessages, type: PushedEmergencyType, payload: Record<string, unknown>) {
  return addPushedMessage(state, message(type, payload), clock());
}
const clear = (state: PushedMessages, payload: unknown) => clearPushedMessage(state, pushedClearMessageId(payload), mono);
const inMinutes = (min: number) => Math.floor((wall + min * 60_000) / 1000);

/** One successful poll answer, sent at `mono` unless `sentMono` says otherwise. */
function answer(rows: Array<Record<string, unknown>>, over: Partial<PollAnswer> = {}): PollAnswer {
  return { active: rows.map(emergencyMessageFromPollRow), sentMono: mono, mayAdd: true, ...over };
}
const row = (id: string, severity = 'CRITICAL', extra: Record<string, unknown> = {}) => ({
  id, type: 'SOS', severity, textBlob: `row ${id}`, mediaUrls: [], audioUrl: null,
  scopeType: 'tenant', scopeId: 'tenant-a', expiresAt: inMinutes(30), createdAt: new Date(wall).toISOString(),
  triggeredByUserId: 'u1', ...extra,
});

const SOS = { messageId: 'sos_room12', severity: 'CRITICAL', textBlob: 'SOS — Room 12', expiresAt: inMinutes(30) };
const DISMISSAL = { messageId: 'bcast_dismissal_school-a', severity: 'INFO', text: 'Early dismissal at 1 PM', expiresAt: inMinutes(5) };

describe('the glass shows the most severe message, then the newest', () => {
  it('INFO after CRITICAL keeps CRITICAL on the glass', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    tick(1_000);
    s = push(s, 'TEXT_BROADCAST', DISMISSAL);
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
    expect(s.entries.size).toBe(2);
  });

  it('a CRITICAL media alert after a WARN banner takes the glass', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', { messageId: 'bcast_buses', severity: 'WARN', text: 'Buses late', expiresAt: inMinutes(5) });
    tick(1_000);
    s = push(s, 'MEDIA_ALERT', { messageId: 'media_evac', severity: 'CRITICAL', textBlob: 'Evacuate', mediaUrls: [], expiresAt: inMinutes(30) });
    expect(shownPushedMessage(s)?.id).toBe('media_evac');
  });

  it('same severity: the newer createdAt wins', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', { messageId: 'warn_a', severity: 'WARN', text: 'A', expiresAt: inMinutes(5) });
    tick(1);
    s = push(s, 'TEXT_BROADCAST', { messageId: 'warn_b', severity: 'WARN', text: 'B', expiresAt: inMinutes(5) });
    expect(shownPushedMessage(s)?.id).toBe('warn_b');
  });

  it('ordering ties: same severity and same createdAt go to the later arrival, either way round', () => {
    const createdAt = '2026-11-21T15:00:00.000Z';
    const a = message('TEXT_BROADCAST', { messageId: 'tie_a', severity: 'WARN', text: 'A', createdAt });
    const b = message('TEXT_BROADCAST', { messageId: 'tie_b', severity: 'WARN', text: 'B', createdAt });
    expect(shownPushedMessage(addPushedMessage(addPushedMessage(EMPTY_PUSHED_MESSAGES, a, clock()), b, clock()))?.id).toBe('tie_b');
    expect(shownPushedMessage(addPushedMessage(addPushedMessage(EMPTY_PUSHED_MESSAGES, b, clock()), a, clock()))?.id).toBe('tie_a');
  });

  it('a second delivery of a held id keeps its place and does not reorder the glass', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', { messageId: 'warn_a', severity: 'WARN', text: 'A', expiresAt: inMinutes(5) });
    tick(1_000);
    s = push(s, 'TEXT_BROADCAST', { messageId: 'warn_b', severity: 'WARN', text: 'B', expiresAt: inMinutes(5) });
    const shownBefore = shownPushedMessage(s);
    tick(1_000);
    s = push(s, 'TEXT_BROADCAST', { messageId: 'warn_a', severity: 'WARN', text: 'A', expiresAt: inMinutes(5) });
    expect(shownPushedMessage(s)).toBe(shownBefore);
    expect(s.entries.size).toBe(2);
  });

  it('an identical re-delivery of the shown message keeps the very same object (nothing re-renders)', () => {
    const s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    const shown = shownPushedMessage(s);
    tick(3_000);
    expect(shownPushedMessage(push(s, 'SOS', SOS))).toBe(shown);
  });

  it('a re-delivery with new content updates the text but keeps its first createdAt', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    const first = shownPushedMessage(s)!;
    tick(3_000);
    s = push(s, 'SOS', { ...SOS, textBlob: 'SOS — Room 12 (nurse on the way)' });
    expect(shownPushedMessage(s)?.textBlob).toBe('SOS — Room 12 (nurse on the way)');
    expect(shownPushedMessage(s)?.createdAt).toBe(first.createdAt);
  });

  it('one message only: it is shown exactly as the mapper built it; nothing held shows nothing', () => {
    const m = message('SOS', SOS);
    expect(shownPushedMessage(addPushedMessage(EMPTY_PUSHED_MESSAGES, m, clock()))).toBe(m);
    expect(shownPushedMessage(EMPTY_PUSHED_MESSAGES)).toBeNull();
  });

  it('a message the overlay poll was showing, held when the first push lands, is not hidden by a lower one', () => {
    // The page adds the overlay's polled message, then the push (acceptPushedMessage).
    const polled = emergencyMessageFromPollRow(row('sos_polled'));
    let s = addPushedMessage(EMPTY_PUSHED_MESSAGES, polled, clock());
    tick(500);
    s = push(s, 'TEXT_BROADCAST', DISMISSAL);
    expect(shownPushedMessage(s)?.id).toBe('sos_polled');
  });
});

describe('ALL_CLEAR_MESSAGE removes only its own id', () => {
  it('clear B leaves A', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    s = push(s, 'TEXT_BROADCAST', DISMISSAL);
    s = clear(s, { messageId: DISMISSAL.messageId, clearedBy: 'u1' });
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
    expect(s.entries.size).toBe(1);
  });

  it('clearing the shown message reveals the next one by rank, not nothing', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', DISMISSAL);
    tick(1_000);
    s = push(s, 'SOS', SOS);
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
    s = clear(s, { messageId: SOS.messageId });
    expect(shownPushedMessage(s)?.id).toBe(DISMISSAL.messageId);
  });

  it('clear of an unknown id changes nothing (the same state comes back)', () => {
    const s = push(push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS), 'TEXT_BROADCAST', DISMISSAL);
    expect(clear(s, { messageId: 'bcast_other_school-b' })).toBe(s);
  });

  it('a clear with no usable id changes nothing — the server reconcile is the backstop', () => {
    const s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    for (const payload of [{}, { messageId: '' }, { messageId: 42 }, null, undefined, 'sos_room12']) {
      expect(pushedClearMessageId(payload)).toBeNull();
      expect(clear(s, payload)).toBe(s);
    }
  });

  it('the clear id is the signed messageId (a literal id is accepted), never the envelope eventId', () => {
    expect(pushedClearMessageId({ messageId: 'm1', id: 'm2' })).toBe('m1');
    expect(pushedClearMessageId({ id: 'm2' })).toBe('m2');
    expect(pushedClearMessageId({ eventId: 'evt-1' })).toBeNull();
  });

  it('the last clear empties the glass', () => {
    const s = clear(push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS), { messageId: 'sos_room12' });
    expect(shownPushedMessage(s)).toBeNull();
    expect(s.entries.size).toBe(0);
  });

  it('a hidden message already past its own expiry leaves with the clear instead of surfacing', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', DISMISSAL); // 5 min
    tick(1_000);
    s = push(s, 'SOS', { ...SOS, expiresAt: inMinutes(60) });
    tick(5 * 60_000 + PUSHED_MESSAGE_EXPIRY_GRACE_MS + 1_000);
    s = clear(s, { messageId: SOS.messageId });
    expect(shownPushedMessage(s)).toBeNull();
  });
});

describe('the server stays the arbiter (two misses, every held id, both ways)', () => {
  it('a hidden message the server stopped listing leaves after two successful polls; the shown one stays', () => {
    let s = push(push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS), 'TEXT_BROADCAST', DISMISSAL);
    tick(12_000);
    s = reconcilePushedMessages(s, answer([row('sos_room12')]), clock());
    expect(s.entries.size).toBe(2); // one miss is not a clear
    const before = s;
    tick(12_000);
    s = reconcilePushedMessages(s, answer([row('sos_room12')]), clock());
    expect(removedPushedMessageIds(before, s)).toEqual([DISMISSAL.messageId]);
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
  });

  it('a listing in between resets the streak', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    tick(12_000);
    s = reconcilePushedMessages(s, answer([]), clock());
    tick(12_000);
    s = reconcilePushedMessages(s, answer([row('sos_room12')]), clock());
    tick(12_000);
    s = reconcilePushedMessages(s, answer([]), clock());
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
    tick(12_000);
    s = reconcilePushedMessages(s, answer([]), clock());
    expect(shownPushedMessage(s)).toBeNull();
  });

  it('a poll that lists everything held changes nothing (no re-render)', () => {
    const s = push(push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS), 'TEXT_BROADCAST', DISMISSAL);
    tick(12_000);
    expect(reconcilePushedMessages(s, answer([row('sos_room12'), row(DISMISSAL.messageId, 'INFO')]), clock())).toBe(s);
  });

  it('a re-delivered push resets its miss streak', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    tick(12_000);
    s = reconcilePushedMessages(s, answer([]), clock());
    tick(1_000);
    s = push(s, 'SOS', SOS);
    tick(12_000);
    s = reconcilePushedMessages(s, answer([]), clock());
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
  });

  it('answers to polls SENT before a message arrived cannot clear it, even two of them', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', DISMISSAL);
    const sentBefore = mono; // two polls leave (the interval and an expiry re-check)…
    tick(100);
    s = push(s, 'SOS', SOS); // …the SOS is pushed while they are in flight…
    tick(100);
    s = reconcilePushedMessages(s, answer([row(DISMISSAL.messageId, 'INFO')], { sentMono: sentBefore }), clock());
    s = reconcilePushedMessages(s, answer([row(DISMISSAL.messageId, 'INFO')], { sentMono: sentBefore }), clock());
    expect(shownPushedMessage(s)?.id).toBe('sos_room12'); // …and neither answer could have listed it
  });

  it('a CRITICAL the server lists that never arrived as a push takes the glass from a held banner', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', DISMISSAL);
    tick(12_000);
    const before = s;
    s = reconcilePushedMessages(s, answer([row(DISMISSAL.messageId, 'INFO'), row('sos_missed_push')]), clock());
    expect(addedPushedMessageIds(before, s)).toEqual(['sos_missed_push']);
    expect(shownPushedMessage(s)?.id).toBe('sos_missed_push');
    expect(shownPushedMessage(s)?.textBlob).toBe('row sos_missed_push');
  });

  it('an answer in flight while a signed clear landed adds nothing (it may still list what was cleared), but still releases', () => {
    let s = push(push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS), 'TEXT_BROADCAST', DISMISSAL);
    tick(12_000);
    s = reconcilePushedMessages(s, answer([row('sos_room12')]), clock()); // DISMISSAL: miss 1
    s = clear(s, { messageId: SOS.messageId });
    tick(12_000);
    s = reconcilePushedMessages(s, answer([row('sos_room12')], { mayAdd: false }), clock());
    expect(s.entries.has('sos_room12')).toBe(false); // not raised again
    expect(s.entries.has(DISMISSAL.messageId)).toBe(false); // second miss released it
  });

  it('a row with no id is never raised', () => {
    const s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', DISMISSAL);
    tick(12_000);
    const noId: Record<string, unknown> = { ...row('x') };
    delete noId.id;
    expect(reconcilePushedMessages(s, answer([row(DISMISSAL.messageId, 'INFO'), noId]), clock())).toBe(s);
  });
});

describe('expiry and bounds', () => {
  it('a hidden message leaves after its own expiry plus the grace; never before', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS); // 30 min
    s = push(s, 'TEXT_BROADCAST', DISMISSAL); // 5 min, hidden
    tick(5 * 60_000 + PUSHED_MESSAGE_EXPIRY_GRACE_MS - 1_000);
    s = push(s, 'SOS', SOS); // any change runs the expiry pass
    expect(s.entries.has(DISMISSAL.messageId)).toBe(true);
    tick(2_000);
    s = push(s, 'SOS', SOS);
    expect(Array.from(s.entries.keys())).toEqual(['sos_room12']);
  });

  it('the SHOWN message never leaves on a clock alone — only a clear or the server reconcile releases the glass', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'TEXT_BROADCAST', DISMISSAL);
    tick(24 * 60 * 60_000);
    s = push(s, 'TEXT_BROADCAST', DISMISSAL);
    expect(shownPushedMessage(s)?.id).toBe(DISMISSAL.messageId);
  });

  it('a message with no expiry is never dropped on the clock', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    s = push(s, 'TEXT_BROADCAST', { messageId: 'no_expiry', severity: 'INFO', text: 'x' });
    tick(24 * 60 * 60_000);
    s = push(s, 'SOS', SOS);
    expect(s.entries.size).toBe(2);
  });

  it('the deadline is monotonic from arrival: a wall clock that jumps later cannot drop a live message', () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    s = push(s, 'TEXT_BROADCAST', DISMISSAL);
    wall += 6 * 60 * 60_000; // the device clock steps six hours ahead; monotonic time barely moves
    mono += 1_000;
    s = push(s, 'TEXT_BROADCAST', { messageId: 'later', severity: 'INFO', text: 'later', expiresAt: Math.floor(wall / 1000) + 300 });
    expect(s.entries.has(DISMISSAL.messageId)).toBe(true);
  });

  it(`never holds more than ${MAX_PUSHED_MESSAGES}; the lowest-ranked goes, never the shown one`, () => {
    let s = push(EMPTY_PUSHED_MESSAGES, 'SOS', SOS);
    for (let i = 0; i < MAX_PUSHED_MESSAGES + 5; i += 1) {
      tick(1);
      s = push(s, 'TEXT_BROADCAST', { messageId: `info_${i}`, severity: 'INFO', text: `n${i}` });
    }
    expect(s.entries.size).toBe(MAX_PUSHED_MESSAGES);
    expect(shownPushedMessage(s)?.id).toBe('sos_room12');
    expect(s.entries.has('info_0')).toBe(false); // the oldest INFO went first
    expect(s.entries.has(`info_${MAX_PUSHED_MESSAGES + 4}`)).toBe(true);
  });
});

describe('one ordering rule and one row mapper for the push and the poll', () => {
  it('compareEmergencyMessages: severity first, then newest createdAt', () => {
    const rows = [
      { id: 'info_new', severity: 'INFO', createdAt: '2026-11-21T15:05:00.000Z' },
      { id: 'crit_old', severity: 'CRITICAL', createdAt: '2026-11-21T15:00:00.000Z' },
      { id: 'warn', severity: 'WARN', createdAt: '2026-11-21T15:04:00.000Z' },
      { id: 'crit_new', severity: 'CRITICAL', createdAt: '2026-11-21T15:01:00.000Z' },
    ];
    expect([...rows].sort(compareEmergencyMessages).map((r) => r.id)).toEqual(['crit_new', 'crit_old', 'warn', 'info_new']);
  });

  it('orders every valid row exactly as the overlay poll sort it replaces', () => {
    const order = { CRITICAL: 0, WARN: 1, INFO: 2 } as const;
    const legacy = (a: { severity: keyof typeof order; createdAt: string }, b: { severity: keyof typeof order; createdAt: string }) =>
      (order[a.severity] - order[b.severity]) || b.createdAt.localeCompare(a.createdAt);
    const severities = ['CRITICAL', 'WARN', 'INFO'] as const;
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`, severity: severities[(i * 7) % 3], createdAt: new Date(SERVER_NOW - ((i * 37) % 11) * 60_000).toISOString(),
    }));
    expect([...rows].sort(compareEmergencyMessages).map((r) => r.id)).toEqual([...rows].sort(legacy).map((r) => r.id));
  });

  it('an unknown severity ranks as CRITICAL; a missing createdAt does not throw', () => {
    expect(compareEmergencyMessages(
      { severity: 'BOGUS', createdAt: '2026-11-21T15:00:00.000Z' },
      { severity: 'WARN', createdAt: '2026-11-21T16:00:00.000Z' },
    )).toBeLessThan(0);
    expect(() => compareEmergencyMessages({ severity: 'INFO', createdAt: null }, { severity: 'INFO' })).not.toThrow();
  });

  it('maps the API row shape the overlay always read, banner sanitised, severity fail-safe', () => {
    const m = emergencyMessageFromPollRow({
      id: 'b1', type: 'TEXT_BROADCAST', severity: 'INFO', textBlob: 'Library closes early.', mediaUrls: [], audioUrl: null,
      scopeType: 'tenant', scopeId: 't', expiresAt: 1_792_000_300, createdAt: '2026-11-21T15:00:00.000Z', triggeredByUserId: 'u',
      banner: { color: '#15803d', mode: 'scroll', speed: 'slow' },
    });
    expect(m).toEqual({
      id: 'b1', type: 'TEXT_BROADCAST', severity: 'INFO', textBlob: 'Library closes early.', mediaUrls: [], audioUrl: null,
      expiresAt: 1_792_000_300, createdAt: '2026-11-21T15:00:00.000Z', banner: { color: '#15803d', mode: 'scroll', speed: 'slow' },
    });
    expect(emergencyMessageFromPollRow({ id: 'x', type: 'SOS', severity: 'LOUD' }).severity).toBe('CRITICAL');
    expect(emergencyMessageFromPollRow({ type: 'SOS', severity: 'CRITICAL' }).id).toBe('');
    expect(emergencyMessageFromPollRow({ id: 'x', type: 'SOS', mediaUrls: 'nope' }).mediaUrls).toEqual([]);
  });
});
