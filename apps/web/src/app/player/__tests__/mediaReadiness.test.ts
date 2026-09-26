/**
 * @jest-environment node
 *
 * Readiness-gated playback (2026-09-26): a large file is never mounted or
 * streamed before its native bytes are on disk. Pure module — every shape the
 * brief names is a table here: solo playlist, multi-item, no service worker,
 * frame-locked sync, first boot.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import {
  LARGE_MEDIA_BYTES,
  countDistinctPlayable,
  decidePlaylistCommit,
  isItemReady,
  isLargeMedia,
  nextPlayableCounter,
  readyItemIds,
  resolveActiveCounter,
  resolveActiveSlot,
  type ReadinessItem,
} from '../mediaReadiness';

const MiB = 1024 * 1024;

function item(id: string, large: boolean): ReadinessItem {
  return { id, large, cacheKey: `key:${id}` };
}

describe('isLargeMedia — the page and the worker draw the same line', () => {
  it('a known size decides; with no size, a video URL is large', () => {
    expect(isLargeMedia({ url: 'https://x/clip.mp4', sizeBytes: 8 * MiB })).toBe(true);
    expect(isLargeMedia({ url: 'https://x/clip.mp4', sizeBytes: 8 * MiB - 1 })).toBe(false);
    expect(isLargeMedia({ url: 'https://x/photo.jpg', sizeBytes: 141_245_550 })).toBe(true);
    expect(isLargeMedia({ url: 'https://x/clip.mp4' })).toBe(true);
    expect(isLargeMedia({ url: 'https://x/clip.mov?token=abc' })).toBe(true);
    expect(isLargeMedia({ url: 'https://x/photo.jpg' })).toBe(false);
    expect(isLargeMedia({ url: 'https://x/menu.pdf', sizeBytes: null })).toBe(false);
    expect(isLargeMedia({ url: '' })).toBe(false);
    expect(LARGE_MEDIA_BYTES).toBe(8 * MiB);
  });

  it('agrees with sw-player.js isLargeAsset on every row of a shared table', () => {
    // The worker is the other half of this contract: what IT stages, the page
    // must hold; what it fetches inline, the page must mount at once.
    const src = readFileSync(resolve(__dirname, '../../../../public/sw-player.js'), 'utf8');
    const self: Record<string, unknown> = { location: { origin: 'https://venue-os.app' }, addEventListener: () => undefined };
    self.self = self;
    const ctx = createContext({ self, URL, Map, Set, Request: class {}, Response: class {}, console, setTimeout, clearTimeout });
    runInContext(src, ctx);
    const hooks = (self as { __swTestHooks?: { isLargeAsset: (a: unknown) => boolean; LARGE_ASSET_BYTES: number } }).__swTestHooks!;
    expect(hooks.LARGE_ASSET_BYTES).toBe(LARGE_MEDIA_BYTES);
    const table = [
      { url: 'https://x/a.mp4', size: 141_245_550 },
      { url: 'https://x/a.mp4', size: 8 * MiB },
      { url: 'https://x/a.mp4', size: 8 * MiB - 1 },
      { url: 'https://x/a.mp4', size: 0 },
      { url: 'https://x/a.mp4', size: null },
      { url: 'https://x/a.mp4' },
      { url: 'https://x/a.webm#t=1' },
      { url: 'https://x/a.mkv?x=1' },
      { url: 'https://x/a.jpg', size: 9 * MiB },
      { url: 'https://x/a.jpg', size: 100 },
      { url: 'https://x/a.jpg' },
      { url: 'https://x/a.pdf', size: 9 * MiB },
      { url: 'https://x/page.html' },
      { url: '' },
    ];
    for (const row of table) {
      expect({ row, page: isLargeMedia({ url: row.url, sizeBytes: row.size }) })
        .toEqual({ row, page: hooks.isLargeAsset(row) });
    }
  });
});

describe('isItemReady / readyItemIds', () => {
  const small = item('img', false);
  const big = item('4k', true);

  it('a small file is always ready; a large one waits for its bytes', () => {
    const onDisk = new Set<string>();
    expect(isItemReady(small, 'ready', onDisk)).toBe(true);
    expect(isItemReady(big, 'ready', onDisk)).toBe(false);
    expect(isItemReady(big, 'ready', new Set(['key:4k']))).toBe(true);
  });

  it('NO service worker: nothing can ever land on disk, so everything streams — never strand the screen', () => {
    expect(isItemReady(big, 'unavailable', new Set())).toBe(true);
    expect([...readyItemIds([small, big], 'unavailable', new Set())]).toEqual(['img', '4k']);
  });

  it('registration still unanswered (first boot): a large item is held, a small one is not', () => {
    expect(isItemReady(big, 'unknown', new Set(['key:4k']))).toBe(false);
    expect([...readyItemIds([small, big], 'unknown', new Set())]).toEqual(['img']);
  });
});

describe('free-run rotation', () => {
  const playableOf = (ready: boolean[]) => (i: number) => ready[i];

  it('resolveActiveCounter re-aims the counter at the first playable slot without moving the mod space', () => {
    const p = playableOf([false, false, true, false]);
    expect(resolveActiveCounter(0, 4, p)).toBe(2);
    expect(resolveActiveCounter(2, 4, p)).toBe(2);
    expect(resolveActiveCounter(3, 4, p)).toBe(6); // wraps: 3→4(0)→5(1)→6(2)
    expect(resolveActiveCounter(7, 4, p)).toBe(10);
    expect(resolveActiveCounter(0, 4, () => false)).toBeNull();
    expect(resolveActiveCounter(0, 0, () => true)).toBeNull();
  });

  it('multi-item: the ready items keep rotating around the one still downloading', () => {
    // [image, 4K video (downloading), image]
    const p = playableOf([true, false, true]);
    expect(nextPlayableCounter(0, 3, p)).toBe(2);
    expect(nextPlayableCounter(2, 3, p)).toBe(3); // wraps to slot 0
    expect(nextPlayableCounter(3, 3, p)).toBe(5);
    // Once the video lands it joins the rotation in its own slot.
    const all = playableOf([true, true, true]);
    expect(nextPlayableCounter(0, 3, all)).toBe(1);
    expect(nextPlayableCounter(1, 3, all)).toBe(2);
  });

  it('solo: one playable item never advances onto itself (the slide IS the playlist)', () => {
    expect(nextPlayableCounter(0, 1, () => true)).toBe(0);
    expect(nextPlayableCounter(4, 3, playableOf([false, true, false]))).toBe(4);
    expect(countDistinctPlayable([{ id: 'a' }, { id: 'b' }, { id: 'c' }], playableOf([false, true, false]))).toBe(1);
    expect(countDistinctPlayable([{ id: 'a' }, { id: 'a' }, { id: 'c' }], () => true)).toBe(2);
  });

  it('nothing playable: the counter holds', () => {
    expect(nextPlayableCounter(5, 3, () => false)).toBe(5);
  });
});

describe('resolveActiveSlot', () => {
  const ready3 = (ready: boolean[]) => ({ playable: (i: number) => ready[i], ready: (i: number) => ready[i] });

  it('free-run multi-item: shows the first ready slot and pre-mounts the next READY one', () => {
    const slot = resolveActiveSlot({ counter: 1, n: 3, syncLocked: false, ...ready3([true, false, true]) });
    expect(slot).toEqual({ activeIndex: 2, held: false, nextIndex: 0, waitingForDownload: false });
  });

  it('free-run solo: no next-up slot when only one item is ready', () => {
    const slot = resolveActiveSlot({ counter: 0, n: 3, syncLocked: false, ...ready3([false, true, false]) });
    expect(slot).toEqual({ activeIndex: 1, held: false, nextIndex: null, waitingForDownload: false });
  });

  it('first boot / everything downloading: nothing to show and the page knows why', () => {
    const slot = resolveActiveSlot({ counter: 0, n: 2, syncLocked: false, ...ready3([false, false]) });
    expect(slot).toEqual({ activeIndex: null, held: false, nextIndex: null, waitingForDownload: true });
    // Empty playlist is not "waiting for a download".
    expect(resolveActiveSlot({ counter: 0, n: 0, syncLocked: false, ...ready3([]) }).waitingForDownload).toBe(false);
  });

  it('a slot the daypart closes (ready but not playable) is skipped without reading as a download wait', () => {
    const slot = resolveActiveSlot({
      counter: 0, n: 2, syncLocked: false,
      playable: (i) => i === 1, ready: () => true,
    });
    expect(slot).toEqual({ activeIndex: 1, held: false, nextIndex: null, waitingForDownload: false });
    const none = resolveActiveSlot({ counter: 0, n: 2, syncLocked: false, playable: () => false, ready: () => true });
    expect(none).toEqual({ activeIndex: null, held: false, nextIndex: null, waitingForDownload: false });
  });

  it('SYNC: the timeline slot is never moved — an unready slot is HELD, not skipped', () => {
    const held = resolveActiveSlot({ counter: 4, n: 3, syncLocked: true, ...ready3([true, false, true]) });
    // counter 4 → slot 1, the downloading video: hold it, keep the slot for the servo/HUD.
    expect(held).toEqual({ activeIndex: 1, held: true, nextIndex: 2, waitingForDownload: true });
    const playing = resolveActiveSlot({ counter: 3, n: 3, syncLocked: true, ...ready3([true, false, true]) });
    // slot 0 plays; its next-up (slot 1) is unready and is NOT pre-mounted.
    expect(playing).toEqual({ activeIndex: 0, held: false, nextIndex: null, waitingForDownload: false });
  });

  it('SYNC: a held slot on a first boot (nothing ever shown) still counts as waiting for the download', () => {
    const slot = resolveActiveSlot({ counter: 0, n: 1, syncLocked: true, ...ready3([false]) });
    expect(slot).toEqual({ activeIndex: 0, held: true, nextIndex: null, waitingForDownload: true });
  });
});

describe('decidePlaylistCommit — what was on glass stays until the new content is ready', () => {
  it('a new playlist with nothing ready WAITS while regular content is on glass', () => {
    expect(decidePlaylistCommit({ isEmergency: false, anyReady: false, regularContentOnGlass: true })).toBe('defer');
  });

  it('first boot / new screen: nothing on glass, so it goes up and the splash shows the download', () => {
    expect(decidePlaylistCommit({ isEmergency: false, anyReady: false, regularContentOnGlass: false })).toBe('commit');
  });

  it('one ready file is enough: the ready files rotate while the rest download', () => {
    expect(decidePlaylistCommit({ isEmergency: false, anyReady: true, regularContentOnGlass: true })).toBe('commit');
  });

  it('an EMERGENCY playlist is never held back by a download (rule 11)', () => {
    expect(decidePlaylistCommit({ isEmergency: true, anyReady: false, regularContentOnGlass: true })).toBe('commit');
    expect(decidePlaylistCommit({ isEmergency: true, anyReady: false, regularContentOnGlass: false })).toBe('commit');
  });
});
