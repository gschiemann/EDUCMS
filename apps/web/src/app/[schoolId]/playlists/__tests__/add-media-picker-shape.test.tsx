/**
 * The playlist EDITOR's "Add Media" picker shows the whole image and its shape.
 *
 * Greg, 2026-09-21, picking slides: "i cant tell whats is landscap vs porterait
 * because you made them all look identical in the preview here". The wizard's
 * picker had the bug he was looking at; this picker had the very same
 * `object-cover` in a 16:9 box, one click away in the same workflow.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';

const asset = (id: string, originalName: string) => ({
  id, originalName, fileUrl: `https://cdn.example.com/${id}.png`, mimeType: 'image/png',
});
const item = (id: string, a: ReturnType<typeof asset>, order: number) => ({
  id, assetId: a.id, asset: a, durationMs: 10_000, sequenceOrder: order, muted: true,
});

const PLAYLISTS = [
  {
    id: 'p1', name: 'Kings Landscape', isActive: true,
    items: [
      item('i1', asset('a1', 'Blackout Night.png'), 0),
      item('i2', asset('a2', 'Season Tickets.png'), 1),
      item('i3', asset('a3', 'Team Store.png'), 2),
    ],
  },
  { id: 'p2', name: 'Empty On Purpose', isActive: true, items: [] },
];
const LIBRARY = [
  { id: 'L1', originalName: 'wide.png', fileUrl: 'https://cdn.example.com/wide.png', mimeType: 'image/png', folderId: null, status: 'PUBLISHED' },
  { id: 'L2', originalName: 'tall.png', fileUrl: 'https://cdn.example.com/tall.png', mimeType: 'image/png', folderId: null, status: 'PUBLISHED' },
];
const SCREENS: unknown[] = [];
const GROUPS: unknown[] = [];
const SCHEDULES: unknown[] = [];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query(LIBRARY),
  useAssetFolders: query([]),
  useScreenGroups: query(GROUPS),
  useSchedules: query(SCHEDULES),
  useScreens: query(SCREENS),
  useTemplates: query([]),
  useUsers: query([]),
  useFleet: query({ root: null, locations: [], stats: { total: 0, online: 0, offline: 0, locationCount: 0 }, screens: [] }),
  useCreatePlaylist: mutation,
  useDeletePlaylist: mutation,
  useReorderPlaylistItems: mutation,
  useCreateSchedule: mutation,
  useDeleteSchedule: mutation,
  useToggleSchedule: mutation,
  useUpdateSchedule: mutation,
  useSetPlaylistActive: mutation,
  useCreateSubmission: mutation,
  usePublishToFleet: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false, reset: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, tenant: { id: 't1' } }),
}));

// Points at the CLASSIC page deliberately. These two suites guard behaviour
// that lives in ./ClassicPlaylistsPage.tsx (the pre-v1 library rows + the
// publish sheet's blast radius), which the Operations v1 rebuild preserved
// rather than rewrote — ../page is now the v1/classic switcher.
import PlaylistsPage from '../ClassicPlaylistsPage';

const NAMES = ['Blackout Night.png', 'Season Tickets.png', 'Team Store.png'];
const EMPTY = /Empty playlist|playlistsPage\.emptyPlaylist/;


describe("the editor's Add Media picker never crops, and says each file's shape", () => {
  const libraryImages = () =>
    Array.from(document.querySelectorAll('img')).filter((i) => /cdn\.example\.com\/(wide|tall)\.png/.test(i.getAttribute('src') || ''));
  const loadAs = (img: HTMLImageElement, w: number, h: number) => {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
    fireEvent.load(img);
  };

  it('tiles are object-contain (never object-cover) and carry a MEASURED shape tag', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    fireEvent.click(rtl.getAllByRole('button', { name: /Add Media/i })[0]);
    const imgs = libraryImages();
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img.className).toMatch(/\bobject-contain\b/);
      expect(img.className).not.toMatch(/object-cover/);
    }
    expect(rtl.queryAllByTestId('asset-orientation')).toHaveLength(0); // nothing claimed before load
    loadAs(imgs[0], 1920, 1080);
    loadAs(imgs[1], 1080, 1920);
    expect(rtl.getAllByTestId('asset-orientation').map((n) => n.textContent)).toEqual(['Landscape', 'Portrait']);
  });
});
