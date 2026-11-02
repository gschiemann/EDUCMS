import { applyGallery, EMPTY_GALLERY_FILTERS, playingWhere, playlistOrientation, screenOrientation, type GalleryEntry } from '../galleryModel';
import type { PlaylistSummaryRow } from '../../v1/playlistOps';

const now = new Date('2026-11-02T15:00:00Z');
const screens = [
  { id: 's1', name: 'Front Desk', status: 'ONLINE', screenGroupId: 'g1', resolution: '1080x1920' },
  { id: 's2', name: 'Hall East', status: 'ONLINE', screenGroupId: 'g1', resolution: '1080x1920' },
  { id: 's3', name: 'Cafe Board', status: 'OFFLINE', screenGroupId: null, resolution: '1920x1080', location: 'North Campus' },
];
const groups = [{ id: 'g1', name: 'Lobby Posters' }];

describe('playingWhere', () => {
  it('lists a group once and a pinned screen outside it, live only for open rules', () => {
    const schedules = [
      { id: 'a', playlistId: 'p', screenGroupId: 'g1', isActive: true },
      { id: 'b', playlistId: 'p', screenId: 's1', isActive: true },
      { id: 'c', playlistId: 'p', screenId: 's3', isActive: true },
    ];
    const w = playingWhere({ id: 'p', scheduleState: 'ACTIVE' }, schedules as any, screens, groups, now);
    expect(w.live).toBe(true);
    expect(w.places.map((p) => `${p.kind}:${p.name}`)).toEqual(['group:Lobby Posters', 'screen:Cafe Board']);
    expect(w.screenCount).toBe(3);
    expect(w.places[1].online).toBe(false);
  });
  it('a paused playlist is not live but still names its targets', () => {
    const w = playingWhere({ id: 'p', scheduleState: 'PAUSED' }, [{ id: 'a', playlistId: 'p', screenId: 's3', isActive: false }] as any, screens, groups, now);
    expect(w.live).toBe(false);
    expect(w.places[0].name).toBe('Cafe Board');
  });
});

describe('orientation', () => {
  it('reads template canvas, then asset dims, then target screens', () => {
    expect(playlistOrientation({ template: { screenWidth: 1080, screenHeight: 1920 } }, [])).toBe('portrait');
    expect(playlistOrientation({ items: [{ asset: { processingMeta: { originalDimensions: { w: 1920, h: 1080 } } } }] }, [])).toBe('landscape');
    expect(playlistOrientation({ items: [] }, [screens[0], screens[1]])).toBe('portrait');
    expect(playlistOrientation({ items: [] }, [])).toBe('unknown');
    expect(screenOrientation({ id: 'x', orientation: 'LANDSCAPE', resolution: '1080x1920' })).toBe('landscape');
  });
});

describe('applyGallery', () => {
  const row = (id: string, state: PlaylistSummaryRow['scheduleState'], targets: string[]): GalleryEntry => ({
    row: { id, name: id, scheduleState: state, targetScreenIds: targets, searchText: id, updatedAt: now.toISOString() } as any,
    orientation: id === 'b' ? 'portrait' : 'landscape',
    where: { places: [], screenCount: targets.length, live: state === 'ACTIVE' },
    attention: false,
  });
  const entries = [row('c', 'UNASSIGNED', []), row('a', 'ACTIVE', ['s3']), row('b', 'ACTIVE', ['s1', 's2'])];
  it('playing first, most screens first', () => {
    const out = applyGallery({ entries, tab: 'all', search: '', filters: EMPTY_GALLERY_FILTERS, sort: 'playing', screens });
    expect(out.map((e) => e.row.id)).toEqual(['b', 'a', 'c']);
  });
  it('filters by group, location and orientation', () => {
    const f = (x: Partial<typeof EMPTY_GALLERY_FILTERS>) =>
      applyGallery({ entries, tab: 'all', search: '', filters: { ...EMPTY_GALLERY_FILTERS, ...x }, sort: 'name', screens }).map((e) => e.row.id);
    expect(f({ group: 'g1' })).toEqual(['b']);
    expect(f({ location: 'North Campus' })).toEqual(['a']);
    expect(f({ orientation: 'portrait' })).toEqual(['b']);
  });
});
