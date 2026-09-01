/**
 * The playlist-detail "Publish to Screens" bottom sheet — the third publish
 * path — mounted for real.
 *
 * Its target list mixes "Lobby Wall (Entire Group)" rows with individual
 * screen rows, so "3 selected" could mean 3 screens or 300. These assertions
 * are against the operator's actual DOM:
 *
 *   A. ticking a whole group reports the resolved reach + the real names
 *   B. a windowed schedule with zero days DISABLES both Publish and Save,
 *      and says why (live-test finding P7)
 *
 * The unsaved-changes guard (confirmDiscardChanges + beforeunload) is left
 * exactly as-is by this wave; `appConfirm` stays mocked to "yes" here so the
 * navigation into the detail view isn't what's under test.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, act, within } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby North', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's2', name: 'Lobby South', status: 'OFFLINE', screenGroupId: 'g1' },
  { id: 's3', name: 'Cafeteria', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's9', name: 'Gym Ribbon', status: 'ONLINE', screenGroupId: null },
];
const GROUPS = [{ id: 'g1', name: 'Lobby Wall', screens: SCREENS.slice(0, 3) }];
const PLAYLISTS = [{ id: 'p1', name: 'Fall Assembly', items: [], isActive: true }];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query([]),
  useAssetFolders: query([]),
  useScreenGroups: query(GROUPS),
  useSchedules: query([]),
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
  // Mounted (but inert) by the page's HQ modal.
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

// ts-jest hoists the jest.mock calls above this import, so the page sees the
// stubs. The page itself is the REAL one under test.
// Points at the CLASSIC page deliberately. These two suites guard behaviour
// that lives in ./ClassicPlaylistsPage.tsx (the pre-v1 library rows + the
// publish sheet's blast radius), which the Operations v1 rebuild preserved
// rather than rewrote — ../page is now the v1/classic switcher.
import PlaylistsPage from '../ClassicPlaylistsPage';

async function openPublishSheet() {
  render(<PlaylistsPage />);
  // Dashboard → detail view (handleSelect is async through appConfirm).
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: 'Open playlist Fall Assembly' }));
  });
  await act(async () => {
    // Header "Publish" — the sheet's own footer button shares the label, so
    // everything after this point is scoped to the dialog.
    fireEvent.click(rtl.getAllByRole('button', { name: /^Publish$/ })[0]);
  });
  return within(rtl.getByRole('dialog', { name: 'Publish to Screens' }));
}

describe('Publish to Screens sheet — blast radius', () => {
  it('A. ticking a whole group reports the resolved reach and names', async () => {
    const sheet = await openPublishSheet();

    // Nothing ticked yet.
    expect(sheet.getByText('Publishes to 0 screens')).toBeInTheDocument();

    fireEvent.click(sheet.getByText('Lobby Wall (Entire Group)'));

    expect(sheet.getByText('Publishes to 3 screens across 1 group')).toBeInTheDocument();
    expect(sheet.getByText('Lobby North · Lobby South · Cafeteria')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: /^Publish$/ })).not.toBeDisabled();
  });

  it('B. a windowed schedule with zero days blocks Publish AND Save (P7)', async () => {
    const sheet = await openPublishSheet();
    fireEvent.click(sheet.getByText('Lobby Wall (Entire Group)'));

    // Switch to a day/time window, then clear every day.
    fireEvent.click(sheet.getByRole('button', { name: 'Scheduled' }));
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      fireEvent.click(sheet.getByRole('button', { name: d, pressed: true }));
    }

    expect(sheet.getByText(/would run on zero days/)).toBeInTheDocument();
    expect(sheet.getByRole('alert')).toHaveTextContent(/Pick at least one day above/);
    expect(sheet.getByRole('button', { name: /^Publish$/ })).toBeDisabled();
    expect(sheet.getByRole('button', { name: /^Save$/ })).toBeDisabled();

    // Pick one day back → both buttons live again.
    fireEvent.click(sheet.getByRole('button', { name: 'Wed' }));
    expect(sheet.queryByRole('alert')).not.toBeInTheDocument();
    expect(sheet.getByRole('button', { name: /^Publish$/ })).not.toBeDisabled();
    expect(sheet.getByRole('button', { name: /^Save$/ })).not.toBeDisabled();
  });
});
