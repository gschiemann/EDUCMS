/**
 * An editor opened on a playlist must show that playlist's items.
 *
 * Greg, 2026-09-15: "why does the playlist show empty when i click on it? all
 * my content should be there from this playlist". The classic editor edits —
 * and SAVES — a working copy of the items, and that copy was only filled by a
 * click on a row or the ?publishPlaylist hand-off. The v1 playlist page mounts
 * the editor with `embedPlaylistId`, and "Open full editor" deep-links it with
 * `initialPlaylistId`; both left the working copy empty. Reproduced in the
 * sandbox on both routes: "Empty playlist" over a playlist holding 3 items.
 * Adding one item there and saving would have REPLACED the real items.
 */

import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';

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
const SCREENS: unknown[] = [];
const GROUPS: unknown[] = [];
const SCHEDULES: unknown[] = [];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query([]),
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

describe('an editor opened on a playlist shows its items', () => {
  it('embedded in the playlist page (embedPlaylistId)', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    for (const name of NAMES) expect(rtl.getAllByText(name).length).toBeGreaterThan(0);
    expect(rtl.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it('deep-linked from "Open full editor" (initialPlaylistId)', () => {
    render(<PlaylistsPage initialPlaylistId="p1" />);
    for (const name of NAMES) expect(rtl.getAllByText(name).length).toBeGreaterThan(0);
    expect(rtl.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  // Control: a playlist that really IS empty must still say so.
  it('a genuinely empty playlist still reads as empty', () => {
    render(<PlaylistsPage embedPlaylistId="p2" embedSection="content" />);
    expect(rtl.getByText(EMPTY)).toBeInTheDocument();
  });
});
