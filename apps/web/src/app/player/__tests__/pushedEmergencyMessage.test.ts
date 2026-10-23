/**
 * The pushed-message mapper shared by the WS and SSE transports
 * (2026-10-22). The decisive case is the first one: the id the player keeps
 * must be the DB row id the API signs as `messageId`, because
 * `reconcileStrandedEmergency` compares that id against the device poll and
 * clears the overlay after two misses — an id that can never match is a
 * life-safety alert that drops itself ~24 s after it was pushed.
 */
import { pushedEmergencyFromPayload } from '../pushedEmergencyMessage';

describe('pushedEmergencyFromPayload', () => {
  /** Exactly what `emergency.controller.ts` signs for a TEXT_BROADCAST. */
  const signedBroadcast = {
    messageId: 'bcast_7e9c26cf_school-a',
    severity: 'WARN',
    text: 'Shelter in place',
    expiresAt: 1_792_752_550,
  };

  it('keeps the signed `messageId` as the id — the one the poll lists (WS envelope eventId is NOT used)', () => {
    const m = pushedEmergencyFromPayload('TEXT_BROADCAST', signedBroadcast, 'evt-random-uuid');
    expect(m.id).toBe('bcast_7e9c26cf_school-a');
    expect(m.type).toBe('TEXT_BROADCAST');
    expect(m.severity).toBe('WARN');
    expect(m.textBlob).toBe('Shelter in place'); // `text` alias (2026-05-28 fix) preserved
    expect(m.expiresAt).toBe(1_792_752_550);
    expect(m.mediaUrls).toEqual([]);
    expect(m.audioUrl).toBeNull();
  });

  it('SSE hands only the inner payload (no eventId) and gets the same id', () => {
    expect(pushedEmergencyFromPayload('TEXT_BROADCAST', signedBroadcast, undefined).id).toBe(
      'bcast_7e9c26cf_school-a',
    );
  });

  it('MEDIA_ALERT / SOS sign `textBlob`, `mediaUrls`, `audioUrl`', () => {
    const m = pushedEmergencyFromPayload(
      'MEDIA_ALERT',
      {
        messageId: 'media_1',
        severity: 'CRITICAL',
        textBlob: 'Evacuate',
        mediaUrls: ['https://cdn/map.png'],
        audioUrl: 'https://cdn/a.mp3',
        expiresAt: 1,
      },
      'evt',
    );
    expect(m).toEqual(
      expect.objectContaining({
        id: 'media_1',
        textBlob: 'Evacuate',
        mediaUrls: ['https://cdn/map.png'],
        audioUrl: 'https://cdn/a.mp3',
      }),
    );
  });

  it('a literal `id` (the e2e harness shape) is still accepted when there is no messageId', () => {
    expect(pushedEmergencyFromPayload('SOS', { id: 'sos-1', textBlob: 'x' }, 'evt').id).toBe('sos-1');
  });

  it('falls back to the eventId, then a synthetic id — a malformed payload still paints (fail-safe toward over-alerting)', () => {
    expect(pushedEmergencyFromPayload('SOS', {}, 'evt-9').id).toBe('evt-9');
    expect(pushedEmergencyFromPayload('SOS', null, undefined, () => 1234).id).toBe('msg-1234');
    expect(pushedEmergencyFromPayload('SOS', 'garbage', undefined, () => 1).severity).toBe('CRITICAL');
  });

  it('an unknown severity defaults to CRITICAL; createdAt is taken from the payload or stamped now', () => {
    const m = pushedEmergencyFromPayload('SOS', { messageId: 's', severity: 'LOUD' }, undefined, () => 0);
    expect(m.severity).toBe('CRITICAL');
    expect(m.createdAt).toBe(new Date(0).toISOString());
    expect(
      pushedEmergencyFromPayload('SOS', { messageId: 's', createdAt: '2026-10-22T00:00:00.000Z' }, undefined).createdAt,
    ).toBe('2026-10-22T00:00:00.000Z');
  });
});
