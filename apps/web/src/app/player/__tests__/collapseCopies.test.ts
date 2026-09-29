import { collapseIdenticalVideoCopies, type CollapsibleItem } from '../collapseCopies';

const vid = (over: Partial<CollapsibleItem> & { id?: string; url?: string } = {}): CollapsibleItem & { id: string } => ({
  id: over.id ?? 'i',
  muted: over.muted,
  daysOfWeek: over.daysOfWeek,
  timeStart: over.timeStart,
  timeEnd: over.timeEnd,
  asset: { mimeType: 'video/mp4', fileUrl: over.url ?? 'https://cdn/x/clip.mp4' },
});
const img = (id = 'img'): CollapsibleItem & { id: string } => ({ id, asset: { mimeType: 'image/png', fileUrl: 'https://cdn/x/a.png' } });

describe('collapseIdenticalVideoCopies', () => {
  it('three copies of one video are ONE video that repeats (the Cleveland playlist)', () => {
    const items = [vid({ id: 'a' }), vid({ id: 'b' }), vid({ id: 'c' })];
    const out = collapseIdenticalVideoCopies(items);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a'); // the first copy stands for all
  });

  it('a single item, or none, is returned as it is (same array)', () => {
    const one = [vid()];
    expect(collapseIdenticalVideoCopies(one)).toBe(one);
    const none: CollapsibleItem[] = [];
    expect(collapseIdenticalVideoCopies(none)).toBe(none);
  });

  it('different clips are a real rotation — untouched', () => {
    const items = [vid({ id: 'a' }), vid({ id: 'b', url: 'https://cdn/x/other.mp4' })];
    expect(collapseIdenticalVideoCopies(items)).toBe(items);
  });

  it('one image anywhere means a real rotation — untouched', () => {
    const items = [vid({ id: 'a' }), img(), vid({ id: 'b' })];
    expect(collapseIdenticalVideoCopies(items)).toBe(items);
    const first = [img(), vid({ id: 'a' }), vid({ id: 'b' })];
    expect(collapseIdenticalVideoCopies(first)).toBe(first);
  });

  it('copies with their own days or hours are a schedule, not duplicates — untouched', () => {
    for (const over of [{ daysOfWeek: ['Mon'] }, { timeStart: '08:00' }, { timeEnd: '17:00' }]) {
      const items = [vid({ id: 'a' }), vid({ id: 'b', ...over })];
      expect(collapseIdenticalVideoCopies(items)).toBe(items);
      const firstHasIt = [vid({ id: 'a', ...over }), vid({ id: 'b' })];
      expect(collapseIdenticalVideoCopies(firstHasIt)).toBe(firstHasIt);
    }
  });

  it('a mixed mute setting is not a duplicate; null / true / absent all mean muted', () => {
    const mixed = [vid({ id: 'a', muted: true }), vid({ id: 'b', muted: false })];
    expect(collapseIdenticalVideoCopies(mixed)).toBe(mixed);
    expect(collapseIdenticalVideoCopies([vid({ id: 'a', muted: null }), vid({ id: 'b', muted: true }), vid({ id: 'c' })])).toHaveLength(1);
    expect(collapseIdenticalVideoCopies([vid({ id: 'a', muted: false }), vid({ id: 'b', muted: false })])).toHaveLength(1);
  });

  it('an item with no file behind it is never collapsed onto another', () => {
    const noUrl: CollapsibleItem = { asset: { mimeType: 'video/mp4', fileUrl: '' } };
    const items = [noUrl, noUrl];
    expect(collapseIdenticalVideoCopies(items)).toBe(items);
    const noAsset: CollapsibleItem = {};
    expect(collapseIdenticalVideoCopies([noAsset, noAsset])).toHaveLength(2);
  });
});
