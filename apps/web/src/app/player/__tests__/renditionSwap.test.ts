/**
 * renditionSwap (2026-10-12) — "the viewer must never see the switch": a
 * demotion to the 1080p copy (or "Try full quality again") changes only the
 * file a playlist item names; the screen keeps playing the current file until
 * the new one is on disk and verified, then swaps at a natural boundary.
 */
import { decideRenditionSwap, renditionSwapIds, swapFilesReady, type SwapItem } from '../renditionSwap';
import { loopBoundaryTracker } from '../loopBoundary';

const key = (u: string) => u.split('?')[0];
const vid = (id: string, url: string, over: Partial<SwapItem> = {}): SwapItem => ({
  id, durationMs: 30_000, sequenceOrder: Number(id.replace(/\D/g, '') || 0), transitionType: null, muted: true,
  asset: { fileUrl: url, mimeType: 'video/mp4' }, ...over,
});
const img = (id: string, url: string): SwapItem => ({ id, durationMs: 10_000, sequenceOrder: 9, transitionType: null, muted: true, asset: { fileUrl: url, mimeType: 'image/jpeg' } });

describe('renditionSwapIds — only a pure file swap qualifies', () => {
  const glass = [vid('i1', 'https://c/4k.mp4'), img('i2', 'https://c/a.jpg')];
  it('the video item names its 1080p copy → a swap of that item', () => {
    expect(renditionSwapIds(glass, [vid('i1', 'https://c/1080.mp4'), img('i2', 'https://c/a.jpg')], key)).toEqual(new Set(['i1']));
  });
  it('a signed-URL query change is not a swap (same stable key)', () => {
    expect(renditionSwapIds(glass, [vid('i1', 'https://c/4k.mp4?token=2'), img('i2', 'https://c/a.jpg')], key)).toBeNull();
  });
  it('anything else is ordinary content: added/removed/reordered/retimed items, a picture changed, a non-video', () => {
    expect(renditionSwapIds(glass, [vid('i1', 'https://c/1080.mp4')], key)).toBeNull();
    expect(renditionSwapIds(glass, [img('i2', 'https://c/a.jpg'), vid('i1', 'https://c/1080.mp4')], key)).toBeNull();
    expect(renditionSwapIds(glass, [vid('i1', 'https://c/1080.mp4', { durationMs: 5 }), img('i2', 'https://c/a.jpg')], key)).toBeNull();
    expect(renditionSwapIds(glass, [vid('i1', 'https://c/1080.mp4'), img('i2', 'https://c/b.jpg')], key)).toBeNull();
    expect(renditionSwapIds(glass, [vid('i1', 'https://c/1080.mp4', { muted: false }), img('i2', 'https://c/a.jpg')], key)).toBeNull();
    expect(renditionSwapIds([], [], key)).toBeNull();
    expect(renditionSwapIds(null, glass, key)).toBeNull();
  });
});

describe('decideRenditionSwap', () => {
  const swap = new Set(['i1']);
  const base = { swapIds: swap, readyIds: new Set<string>(['i2']), activeItemId: 'i1', armed: null, boundarySeq: 0, isEmergency: false };

  it('HOLD while the new file is not on disk — the current file keeps playing', () => {
    expect(decideRenditionSwap(base)).toBe('hold');
    expect(decideRenditionSwap({ ...base, activeItemId: 'i2' })).toBe('hold'); // even when not on glass: the video must not vanish from the rotation
    expect(swapFilesReady(swap, new Set(['i2']))).toBe(false);
  });

  it('ready, swapped video NOT on glass → commit now (it mounts later from disk)', () => {
    expect(decideRenditionSwap({ ...base, readyIds: new Set(['i1', 'i2']), activeItemId: 'i2' })).toBe('commit');
    expect(decideRenditionSwap({ ...base, readyIds: new Set(['i1']), activeItemId: null })).toBe('commit');
  });

  it('ready, swapped video ON glass → wait for a boundary; never mid-play', () => {
    const ready = { ...base, readyIds: new Set(['i1']) };
    expect(decideRenditionSwap(ready)).toBe('hold'); // not armed yet
    const armed = { ...ready, armed: { activeItemId: 'i1', boundarySeq: 7 }, boundarySeq: 7 };
    expect(decideRenditionSwap(armed)).toBe('hold'); // mid-lap
    expect(decideRenditionSwap({ ...armed, boundarySeq: 8 })).toBe('commit'); // the loop wrapped
    expect(decideRenditionSwap({ ...armed, activeItemId: 'i3' })).toBe('commit'); // the item changed
  });

  it('an emergency is never held', () => {
    expect(decideRenditionSwap({ ...base, isEmergency: true })).toBe('commit');
  });
});

describe('loopBoundaryTracker sequence + listeners (the boundary signal the page waits on)', () => {
  it('every recorded wrap advances a sequence that a new session never rewinds, and notifies', () => {
    const seen: number[] = [];
    const off = loopBoundaryTracker.onBoundary(() => seen.push(loopBoundaryTracker.sequence));
    const before = loopBoundaryTracker.sequence;
    loopBoundaryTracker.record({ backend: 'native', holdMs: 0, skipMs: 0 } as any);
    loopBoundaryTracker.startSession('continuous');
    loopBoundaryTracker.record({ backend: 'continuous', holdMs: 0, skipMs: 0 } as any);
    expect(loopBoundaryTracker.sequence).toBe(before + 2);
    expect(seen).toEqual([before + 1, before + 2]);
    off();
    loopBoundaryTracker.record({ backend: 'native', holdMs: 0, skipMs: 0 } as any);
    expect(seen).toHaveLength(2);
  });

  it('a throwing listener never breaks the tracker', () => {
    const off = loopBoundaryTracker.onBoundary(() => { throw new Error('x'); });
    expect(() => loopBoundaryTracker.record({ backend: 'native', holdMs: 0, skipMs: 0 } as any)).not.toThrow();
    off();
  });
});
