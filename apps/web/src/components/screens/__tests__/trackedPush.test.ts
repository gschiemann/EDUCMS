/**
 * trackedPush — the server's record of an operator push, as the dashboard
 * reads it (2026-10-18, tracked pushes; API: player-ota/push-tracking.ts).
 */
import { deriveTrackedPush, holdIsCurrent } from '../trackedPush';

const PUSHED = '2026-10-16T10:00:00.000Z';
const at = (min: number) => new Date(Date.parse(PUSHED) + min * 60_000).toISOString();

describe('deriveTrackedPush', () => {
  it('no push → null (and an unreadable push time is no push)', () => {
    expect(deriveTrackedPush(null)).toBeNull();
    expect(deriveTrackedPush({ forceApkUpdatePendingAt: null })).toBeNull();
    expect(deriveTrackedPush({ forceApkUpdatePendingAt: 'not a date' })).toBeNull();
  });

  it('sent, never handed over → waiting; handed over → sent', () => {
    expect(deriveTrackedPush({ forceApkUpdatePendingAt: PUSHED, forceApkUpdateOfferCount: 0 })).toMatchObject({
      kind: 'waiting', offers: 0, pushedAtMs: Date.parse(PUSHED), heldAtMs: null, reason: null,
    });
    expect(deriveTrackedPush({
      forceApkUpdatePendingAt: PUSHED, forceApkUpdateOfferCount: 2, forceApkUpdateLastOfferAt: at(1),
      forceApkUpdateTargetVersion: '1.1.41',
    })).toMatchObject({ kind: 'sent', offers: 2, lastOfferAtMs: Date.parse(at(1)), targetVersion: '1.1.41' });
  });

  it('an API that predates the record (only forceApkUpdatePendingAt) reads exactly as before: a push in flight', () => {
    expect(deriveTrackedPush({ forceApkUpdatePendingAt: PUSHED })).toMatchObject({ kind: 'waiting', offers: 0 });
  });

  it.each([
    ['NEEDS_TAP', 'needs-tap'],
    ['STALLED', 'stalled'],
    ['FAILED', 'failed'],
    ['EXPIRED', 'expired'],
  ])('hold %s → %s, with when it was held', (hold, kind) => {
    expect(deriveTrackedPush({
      forceApkUpdatePendingAt: PUSHED, forceApkUpdateHold: hold, forceApkUpdateHoldAt: at(40), forceApkUpdateOfferCount: 1,
    })).toMatchObject({ kind, heldAtMs: Date.parse(at(40)) });
  });

  it('an unknown hold value is not a hold', () => {
    expect(deriveTrackedPush({ forceApkUpdatePendingAt: PUSHED, forceApkUpdateHold: 'PAUSED', forceApkUpdateOfferCount: 1 }))
      .toMatchObject({ kind: 'sent', heldAtMs: null });
  });

  it('reads the stable reason code, never the English sentence, and the failure code it names', () => {
    const p = deriveTrackedPush({
      forceApkUpdatePendingAt: PUSHED, forceApkUpdateHold: 'FAILED', forceApkUpdateOfferCount: 1,
      forceApkUpdateHoldReason: 'device-reported-failed_incompatible: Installing v1.1.41 failed on the screen (failed_incompatible).',
    });
    expect(p).toMatchObject({ reason: 'device-reported-failed_incompatible', failedCode: 'INCOMPATIBLE' });
    expect(deriveTrackedPush({
      forceApkUpdatePendingAt: PUSHED, forceApkUpdateHold: 'STALLED',
      forceApkUpdateHoldReason: 'offer-limit-reached: v1.1.41 was offered 4 times and did not install; …',
    })).toMatchObject({ reason: 'offer-limit-reached', failedCode: null });
    // Junk in the column is not a reason.
    expect(deriveTrackedPush({ forceApkUpdatePendingAt: PUSHED, forceApkUpdateHold: 'STALLED', forceApkUpdateHoldReason: 'Some Sentence: x' }))
      .toMatchObject({ reason: null });
  });
});

describe('holdIsCurrent', () => {
  const held = deriveTrackedPush({
    forceApkUpdatePendingAt: PUSHED, forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateHoldAt: at(40), forceApkUpdateOfferCount: 1,
  })!;

  it('a hold describes the screen until it reports real progress after it', () => {
    expect(holdIsCurrent(held, { state: 'NEEDS_TAP', at: at(41) })).toBe(true);
    expect(holdIsCurrent(held, { state: 'INSTALLING', at: at(30) })).toBe(true); // before the hold
    // Someone pressed Install now on the panel: its live progress wins.
    expect(holdIsCurrent(held, { state: 'DOWNLOADING', at: at(45) })).toBe(false);
    expect(holdIsCurrent(held, { state: 'INSTALLING', at: at(46) })).toBe(false);
  });

  it('a push the server is still offering is not a hold', () => {
    const sent = deriveTrackedPush({ forceApkUpdatePendingAt: PUSHED, forceApkUpdateOfferCount: 1 })!;
    expect(holdIsCurrent(sent, { state: null, at: null })).toBe(false);
  });
});
