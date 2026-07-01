/**
 * 2026-07-01 LAUNCH-SPRINT player deep pass — blank-screen class (b):
 * "an asset URL 404s mid-playlist." Pins the fix for the case where EVERY
 * item in the live playlist fails to load. Before this fix, the player's
 * onError handler only ever advanced `currentIndex` forward with no floor
 * — a playlist where every item is broken (bulk Supabase outage, a
 * bucket-migration that left stale signed URLs) cycled forever through
 * the same N broken items, and the kiosk showed nothing but its black
 * container background, indefinitely, with zero operator-facing signal.
 *
 * `AllAssetsFailedTracker` is the pure logic behind the fix: it flips on
 * only once every distinct item in the playlist has failed at least once
 * (a full lap with zero successful renders), and clears immediately on
 * any success or any genuinely different item set.
 */
import { AllAssetsFailedTracker } from '../all-assets-failed-tracker';

describe('AllAssetsFailedTracker', () => {
  it('does not trip on a single broken item in a multi-item playlist', () => {
    const t = new AllAssetsFailedTracker();
    const allIds = ['a', 'b', 'c'];
    expect(t.recordFailure('a', allIds)).toBe(false);
    expect(t.failedCount).toBe(1);
  });

  it('trips only once EVERY distinct item has failed at least once', () => {
    const t = new AllAssetsFailedTracker();
    const allIds = ['a', 'b', 'c'];
    expect(t.recordFailure('a', allIds)).toBe(false);
    expect(t.recordFailure('b', allIds)).toBe(false);
    // Third distinct failure completes the full lap — every item is broken.
    expect(t.recordFailure('c', allIds)).toBe(true);
  });

  it('trips immediately for a solo-item (single-asset) playlist', () => {
    const t = new AllAssetsFailedTracker();
    expect(t.recordFailure('only-item', ['only-item'])).toBe(true);
  });

  it('does not double-count repeated failures of the SAME item id (cycling through one broken item)', () => {
    const t = new AllAssetsFailedTracker();
    const allIds = ['a', 'b'];
    // The exact regression scenario: currentIndex increments forever but
    // keeps landing on the same handful of ids because sorted.length is
    // small. Repeated failures of 'a' alone should never look like "every
    // item failed" when 'b' has never actually been attempted/failed.
    t.recordFailure('a', allIds);
    t.recordFailure('a', allIds);
    t.recordFailure('a', allIds);
    expect(t.failedCount).toBe(1);
    expect(t.recordFailure('a', allIds)).toBe(false);
  });

  it('a single success clears every recorded failure immediately (no need to wait for a full recovery lap)', () => {
    const t = new AllAssetsFailedTracker();
    const allIds = ['a', 'b', 'c'];
    t.recordFailure('a', allIds);
    t.recordFailure('b', allIds);
    t.recordSuccess();
    expect(t.failedCount).toBe(0);
    // Re-tripping requires a fresh full lap, not just the remaining 'c'.
    expect(t.recordFailure('c', allIds)).toBe(false);
  });

  it('reset() clears failures for a republish / genuinely different item set', () => {
    const t = new AllAssetsFailedTracker();
    t.recordFailure('a', ['a', 'b']);
    t.recordFailure('b', ['a', 'b']);
    expect(t.failedCount).toBe(2);
    t.reset();
    expect(t.failedCount).toBe(0);
  });

  it('ignores a null/undefined itemId or an empty playlist without throwing', () => {
    const t = new AllAssetsFailedTracker();
    expect(t.recordFailure(null, ['a'])).toBe(false);
    expect(t.recordFailure(undefined, ['a'])).toBe(false);
    expect(t.recordFailure('a', [])).toBe(false);
    expect(t.failedCount).toBe(0);
  });

  it('stale failed ids from a shrunk playlist do not falsely trip "all failed" for the new set', () => {
    // Regression guard: if the playlist shrinks (operator removed items)
    // WITHOUT an explicit reset() call, a stale failed-id for a
    // no-longer-present item must not count toward the new allIds set.
    const t = new AllAssetsFailedTracker();
    t.recordFailure('old-item-no-longer-in-playlist', ['old-item-no-longer-in-playlist']);
    // New playlist set — 'x' has never failed.
    expect(t.recordFailure('y', ['x', 'y'])).toBe(false);
  });
});
