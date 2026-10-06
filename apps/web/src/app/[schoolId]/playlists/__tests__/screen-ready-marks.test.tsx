/**
 * The playlist editor marks a video the screens are NOT playing (2026-10-05).
 *
 * The manifest leaves out a video stamped not screen-ready — still converting
 * for screens, or its conversion failed — so a playlist can hold an item no
 * screen shows. Run against the REAL classic editor (what
 * /[schoolId]/playlists/[playlistId] mounts as its Content tab), with the
 * fixture shape of the sibling suites: the right rows carry the mark, the
 * others carry nothing new.
 */
import * as React from 'react';
import { render, screen as rtl, within } from '@testing-library/react';

const asset = (id: string, originalName: string, mimeType: string, processingMeta: unknown = null) => ({
  id,
  originalName,
  mimeType,
  fileUrl: `https://cdn.example.com/${id}.${originalName.split('.').pop()}`,
  posterUrl: null,
  processingMeta,
});
const item = (id: string, a: ReturnType<typeof asset>, order: number) => ({
  id, assetId: a.id, asset: a, durationMs: 10_000, sequenceOrder: order, muted: true,
});

const PLAYLISTS = [
  {
    id: 'p1',
    name: 'Lobby',
    isActive: true,
    items: [
      item('i1', asset('a1', 'Phone clip.mov', 'video/quicktime', {
        screen: { version: 1, ready: false, pending: true, issues: ['codec', 'hdr', 'container'], checkedAt: 'x' },
      }), 0),
      item('i2', asset('a2', 'Broken export.webm', 'video/webm', {
        screen: { version: 1, ready: false, issues: ['codec', 'container'], error: 'timeout', checkedAt: 'x' },
      }), 1),
      item('i3', asset('a3', 'Welcome.mp4', 'video/mp4', { screen: { version: 1, ready: true, checkedAt: 'x' } }), 2),
      item('i4', asset('a4', 'Old upload.mp4', 'video/mp4'), 3),
      item('i5', asset('a5', 'Menu.png', 'image/png'), 4),
    ],
  },
];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query([]),
  useAssetFolders: query([]),
  useScreenGroups: query([]),
  useSchedules: query([]),
  useScreens: query([]),
  useTemplates: query([]),
  useUsers: query([]),
  useFleet: query({ root: null, locations: [], stats: { total: 0, online: 0, offline: 0, locationCount: 0 }, screens: [] }),
  useFleetOperations: query(undefined),
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
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, tenant: { id: 't1' } }),
}));

import PlaylistsPage from '../ClassicPlaylistsPage';

const rowOf = (name: string) => rtl.getByText(name).closest('.playlist-item-card') as HTMLElement;
/** The whole item card: the row strip plus the line under it. */
const cardOf = (name: string) => rowOf(name).parentElement as HTMLElement;
/** The mark under the name (md and up). */
const markOf = (name: string) => within(rowOf(name)).queryByTestId('screen-ready-pill');
/** The mark on its own line under the row (phones). */
const phoneMarkOf = (name: string) => {
  const line = within(cardOf(name)).queryByTestId('screen-ready-mark-phone');
  return line ? within(line).queryByTestId('screen-ready-pill') : null;
};

describe('the Content tab marks the items no screen is playing', () => {
  it('converting → "Not playing yet — converting"; failed → "Can\'t play on screens"', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    expect(markOf('Phone clip.mov')).toHaveTextContent('Not playing yet — converting');
    expect(markOf('Phone clip.mov')).toHaveAttribute('title', 'Converting for screens — it will start playing when the copy is ready');
    expect(markOf('Broken export.webm')).toHaveTextContent("Can't play on screens");
    expect(markOf('Broken export.webm')).toHaveAttribute(
      'title',
      'This video could not be converted for screens: converting it took too long. Export it as MP4 (H.264) and upload it again.',
    );
  });

  it('a video that plays (ready, or from before the verdict existed) and a picture carry no mark — and no empty line', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    for (const name of ['Welcome.mp4', 'Old upload.mp4', 'Menu.png']) {
      expect(within(cardOf(name)).queryByTestId('screen-ready-pill')).toBeNull();
      expect(within(cardOf(name)).queryByTestId('screen-ready-mark-phone')).toBeNull();
      expect(within(cardOf(name)).queryByTestId('screen-ready-mark-desktop')).toBeNull();
    }
    // Two marked items, each with its phone line and its md+ line.
    expect(rtl.getAllByTestId('screen-ready-pill')).toHaveLength(4);
  });

  it('every breakpoint gets the mark: under the name from md up, on its own full-width line on a phone', () => {
    // On a phone the name column is a few pixels wide (names truncate to one
    // letter there), so the phone copy sits OUTSIDE the cramped row strip.
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    for (const name of ['Phone clip.mov', 'Broken export.webm']) {
      const desktop = within(rowOf(name)).getByTestId('screen-ready-mark-desktop');
      expect(desktop.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(desktop.className).toMatch(/(^|\s)md:block(\s|$)/);
      const phoneLine = within(cardOf(name)).getByTestId('screen-ready-mark-phone');
      expect(phoneLine.className).toMatch(/(^|\s)md:hidden(\s|$)/);
      expect(rowOf(name).contains(phoneLine)).toBe(false);
      expect(phoneMarkOf(name)?.textContent).toBe(markOf(name)?.textContent);
    }
  });
});
