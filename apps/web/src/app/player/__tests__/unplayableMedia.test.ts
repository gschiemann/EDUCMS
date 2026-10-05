/**
 * @jest-environment node
 *
 * Unplayable items (2026-10-05, media beta-test campaign): one bad file must
 * never freeze a screen or leave a black slot. The pure half — the failure
 * ledger and the slide choice it feeds — tested per shape, composed with the
 * readiness gate exactly the way page.tsx composes them
 * (playable = ready ∧ in its daypart ∧ not unplayable).
 */
import {
  UNPLAYABLE_MAX_ENTRIES,
  UNPLAYABLE_RETRY_MS,
  UnplayableLedger,
  everyItemUnplayable,
  pickHeldSlide,
  playerCanShow,
  unplayableKey,
} from '../unplayableMedia';
import { countDistinctPlayable, nextPlayableCounter, resolveActiveSlot } from '../mediaReadiness';

const T0 = 1_000_000;

type Item = { id: string; url: string; hash?: string | null; mime: string; ready?: boolean };

/** The page's composition, for a playlist and a ledger at time `now`. */
function gate(items: Item[], ledger: UnplayableLedger, now: number) {
  const unplayable = (i: number) =>
    !playerCanShow(items[i].mime) || ledger.isUnplayable(unplayableKey(items[i]), now);
  const ready = (i: number) => items[i].ready !== false;
  const playable = (i: number) => ready(i) && !unplayable(i);
  return { unplayable, ready, playable };
}

/** Walk the free-run rotation the way the page does: the active slot, then advance. */
function rotation(items: Item[], ledger: UnplayableLedger, now: number, laps: number): (number | null)[] {
  const { playable, ready } = gate(items, ledger, now);
  const shown: (number | null)[] = [];
  let counter = 0;
  for (let step = 0; step < laps; step++) {
    const slot = resolveActiveSlot({ counter, n: items.length, syncLocked: false, playable, ready });
    shown.push(slot.activeIndex);
    if (slot.activeIndex === null) break;
    counter = nextPlayableCounter(counter, items.length, playable);
  }
  return shown;
}

const brokenVideo: Item = { id: 'v-bad', url: 'https://x/broken.mp4', hash: null, mime: 'video/mp4' };
const goodImage: Item = { id: 'i-good', url: 'https://x/good.jpg', mime: 'image/jpeg' };
const goodVideo: Item = { id: 'v-good', url: 'https://x/good.mp4', hash: 'AB'.repeat(32), mime: 'video/mp4' };
const brokenImage: Item = { id: 'i-bad', url: 'https://x/text-as.jpg', mime: 'image/jpeg' };
const audio: Item = { id: 'a-1', url: 'https://x/song.mp3', mime: 'audio/mpeg' };

describe('playerCanShow — a type the player has no branch for is unplayable from the start', () => {
  it('audio cannot be shown (it used to fall through to <img>: a blank slide every lap)', () => {
    for (const mime of ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'AUDIO/MPEG', ' audio/mpeg']) {
      expect(playerCanShow(mime)).toBe(false);
    }
  });
  it('negative control: every type the render has a branch for is unchanged', () => {
    for (const mime of ['image/jpeg', 'image/png', 'video/mp4', 'video/webm', 'text/html', 'application/pdf', '', null, undefined]) {
      expect(playerCanShow(mime)).toBe(true);
    }
  });
});

describe('unplayableKey — a new file is tried at once', () => {
  it('changes with the URL or the digest (a re-publish / conversion), never with digest case', () => {
    const base = unplayableKey({ id: 'a', url: 'https://x/1.mp4', hash: 'ABC' });
    expect(unplayableKey({ id: 'a', url: 'https://x/2.mp4', hash: 'ABC' })).not.toBe(base);
    expect(unplayableKey({ id: 'a', url: 'https://x/1.mp4', hash: 'DEF' })).not.toBe(base);
    expect(unplayableKey({ id: 'b', url: 'https://x/1.mp4', hash: 'ABC' })).not.toBe(base);
    expect(unplayableKey({ id: 'a', url: 'https://x/1.mp4', hash: 'abc' })).toBe(base);
    expect(unplayableKey({ id: 'a', url: 'https://x/1.mp4' })).toBe(unplayableKey({ id: 'a', url: 'https://x/1.mp4', hash: null }));
  });
});

describe('UnplayableLedger', () => {
  it('a failure is news ONCE, however many events one broken element fires', () => {
    const l = new UnplayableLedger();
    expect(l.record('k', T0)).toBe(true);
    expect(l.record('k', T0 + 10)).toBe(false);
    expect(l.isUnplayable('k', T0 + 10)).toBe(true);
  });

  it('the same file is tried again after the cool-off (a transient failure is not exile)', () => {
    const l = new UnplayableLedger();
    l.record('k', T0);
    expect(l.isUnplayable('k', T0 + UNPLAYABLE_RETRY_MS - 1)).toBe(true);
    expect(l.isUnplayable('k', T0 + UNPLAYABLE_RETRY_MS)).toBe(false);
    // Failing again after the retry is news again, and starts a new cool-off.
    expect(l.record('k', T0 + UNPLAYABLE_RETRY_MS + 5)).toBe(true);
    expect(l.isUnplayable('k', T0 + 2 * UNPLAYABLE_RETRY_MS)).toBe(true);
  });

  it('a coarse clock that lags the failure still reads "out" (the page re-evaluates once a minute)', () => {
    const l = new UnplayableLedger();
    l.record('k', T0);
    expect(l.isUnplayable('k', T0 - 59_000)).toBe(true);
  });

  it('is bounded: the oldest failures are forgotten first', () => {
    const l = new UnplayableLedger(UNPLAYABLE_RETRY_MS, 3);
    ['a', 'b', 'c', 'd'].forEach((k, i) => l.record(k, T0 + i));
    expect(l.size).toBe(3);
    expect(l.isUnplayable('a', T0 + 4)).toBe(false);
    expect(l.isUnplayable('d', T0 + 4)).toBe(true);
    expect(UNPLAYABLE_MAX_ENTRIES).toBeGreaterThanOrEqual(64);
  });

  it('negative control: an unrelated item is never affected', () => {
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    expect(l.isUnplayable(unplayableKey(goodImage), T0)).toBe(false);
  });
});

describe('free-run: an unplayable slot never takes the glass', () => {
  it('BEFORE the failure is recorded the broken video is in the rotation (the bug: nothing recorded it)', () => {
    const l = new UnplayableLedger();
    expect(rotation([brokenVideo, goodImage], l, T0, 4)).toEqual([0, 1, 0, 1]);
  });

  it('[broken video, good image]: after the failure only the image shows — a solo slide', () => {
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    expect(rotation([brokenVideo, goodImage], l, T0, 5)).toEqual([1, 1, 1, 1, 1]);
    const { playable, ready } = gate([brokenVideo, goodImage], l, T0);
    const slot = resolveActiveSlot({ counter: 0, n: 2, syncLocked: false, playable, ready });
    // The failed video is not even the hidden next-up slide (it used to stay
    // mounted there — the same errored element came back and froze the screen).
    expect(slot).toEqual({ activeIndex: 1, held: false, nextIndex: null, waitingForDownload: false });
    expect(countDistinctPlayable([brokenVideo, goodImage], playable)).toBe(1);
  });

  it('[good jpg, broken mp4, good mp4]: both good items alternate; the next-up slot skips the broken one', () => {
    const items = [goodImage, brokenVideo, goodVideo];
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    expect(rotation(items, l, T0, 6)).toEqual([0, 2, 0, 2, 0, 2]);
    const { playable, ready } = gate(items, l, T0);
    expect(resolveActiveSlot({ counter: 0, n: 3, syncLocked: false, playable, ready }).nextIndex).toBe(2);
  });

  it('[good image, broken image, audio]: no black slot — the good image is a solo slide', () => {
    const items = [goodImage, brokenImage, audio];
    const l = new UnplayableLedger();
    // The audio item is out before anything failed; the broken image once recorded.
    expect(rotation(items, l, T0, 4)).toEqual([0, 1, 0, 1]);
    l.record(unplayableKey(brokenImage), T0);
    expect(rotation(items, l, T0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('every item unplayable: nothing is shown, and it is NOT a download wait', () => {
    const items = [brokenVideo, brokenImage, audio];
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    l.record(unplayableKey(brokenImage), T0);
    const { playable, ready, unplayable } = gate(items, l, T0);
    expect(resolveActiveSlot({ counter: 0, n: 3, syncLocked: false, playable, ready })).toEqual({
      activeIndex: null, held: false, nextIndex: null, waitingForDownload: false,
    });
    expect(everyItemUnplayable(items.length, unplayable)).toBe(true);
  });

  it('negative control: one item still downloading is a download wait, never "unavailable"', () => {
    const items = [{ ...goodVideo, ready: false }, brokenImage];
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenImage), T0);
    const { playable, ready, unplayable } = gate(items, l, T0);
    expect(resolveActiveSlot({ counter: 0, n: 2, syncLocked: false, playable, ready }).waitingForDownload).toBe(true);
    expect(everyItemUnplayable(items.length, unplayable)).toBe(false);
  });

  it('the failed item is tried again after the cool-off, and at once under a new URL', () => {
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    expect(rotation([brokenVideo, goodImage], l, T0 + UNPLAYABLE_RETRY_MS, 2)).toEqual([0, 1]);
    const republished = { ...brokenVideo, url: 'https://x/converted.mp4' };
    expect(rotation([republished, goodImage], l, T0 + 1, 2)).toEqual([0, 1]);
  });

  it('everyItemUnplayable: an empty playlist is empty, not unplayable', () => {
    expect(everyItemUnplayable(0, () => true)).toBe(false);
    expect(everyItemUnplayable(2, (i) => i === 0)).toBe(false);
  });
});

describe('frame-locked sync: an unplayable slot is HELD, never skipped', () => {
  const items = [goodImage, brokenVideo, goodVideo];
  it('the timeline slot is not moved; the slide on glass stays the last one shown', () => {
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    const { playable, ready, unplayable } = gate(items, l, T0);
    const slot = resolveActiveSlot({ counter: 1, n: 3, syncLocked: true, playable, ready });
    expect(slot.activeIndex).toBe(1); // the timeline's slot — the servo and HUD still see it
    expect(slot.held).toBe(true);
    expect(slot.waitingForDownload).toBe(false); // failed ≠ downloading
    // Last shown was slot 0: it stays on glass.
    expect(pickHeldSlide([0], items.length, (i) => !unplayable(i))).toBe(0);
  });

  it('the slide that FAILED while on glass is not what is held — the one before it is', () => {
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    const { unplayable } = gate(items, l, T0);
    expect(pickHeldSlide([1, 0], items.length, (i) => !unplayable(i))).toBe(0);
  });

  it('nothing shown yet (or everything shown has failed): hold nothing, never a failed slide', () => {
    expect(pickHeldSlide([], 3, () => true)).toBeNull();
    expect(pickHeldSlide([null, null], 3, () => true)).toBeNull();
    expect(pickHeldSlide([1], 3, () => false)).toBeNull();
    expect(pickHeldSlide([7], 3, () => true)).toBeNull(); // out of range after a shorter playlist
  });

  it('negative control: a playable slot under sync is shown, not held', () => {
    const l = new UnplayableLedger();
    l.record(unplayableKey(brokenVideo), T0);
    const { playable, ready } = gate(items, l, T0);
    expect(resolveActiveSlot({ counter: 2, n: 3, syncLocked: true, playable, ready })).toMatchObject({ activeIndex: 2, held: false });
  });
});
