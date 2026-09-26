/**
 * Removing a playlist from the library — the in-use confirmation (2026-09-26).
 *
 * The server deletes a PUBLISHED playlist (publishing rules or location
 * copies) only with `?confirm=in-use`, and answers 409 PLAYLIST_PUBLISHED with
 * its reach otherwise — which is what an open tab from before the warned
 * delete gets. So the library sends `confirmInUse: true` ONLY when the dialog
 * the operator just confirmed said the playlist is published. When the page
 * thought it was not (its rules not loaded, copies at other locations) and the
 * server says otherwise, the operator is shown the published warning with the
 * server's numbers, and only confirming THAT sends the confirmation.
 *
 * Driven through the real page and the real row menu.
 */

import * as React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

const PLAYLISTS = [
  {
    id: 'p1', name: 'Member Promotions',
    items: [{ id: 'i1', durationMs: 90_000, asset: { originalName: 'spring.jpg', mimeType: 'image/jpeg' } }],
    updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    createdBy: { id: 'u1', email: 'garlan@example.com' },
  },
  {
    id: 'p2', name: 'Fall Fundraiser',
    items: [{ id: 'i2', durationMs: 30_000, asset: { originalName: 'fall.jpg', mimeType: 'image/jpeg' } }],
    updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    createdBy: { id: 'u1', email: 'garlan@example.com' },
  },
];
const SCREENS = [{ id: 's1', name: 'G43', status: 'ONLINE', screenGroupId: null, renderHealth: 'OK', lastRenderedAt: new Date().toISOString() }];
// p1 has a publishing rule this page can see; p2 has none here.
const SCHEDULES = [{ id: 'sc1', playlistId: 'p1', screenId: 's1', screenGroupId: null, isActive: true, startTime: new Date(Date.now() - 86400000).toISOString() }];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, isFetched: true, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'new' }), mutate: jest.fn(), isPending: false });

type DeleteArg = { id: string; confirmInUse: boolean };
let deleteImpl: jest.Mock<Promise<unknown>, [DeleteArg]>;

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useSchedules: query(SCHEDULES),
  useSetPlaylistActive: mutation,
  useScreens: query(SCREENS),
  useScreenGroups: query([]),
  useTemplates: query([]),
  usePlaylistSummary: query(null),
  useFleet: query({ root: null, locations: [], stats: {}, screens: [] }),
  useDeletePlaylist: () => ({ mutateAsync: (arg: DeleteArg) => deleteImpl(arg), mutate: jest.fn(), isPending: false }),
  useCreatePlaylist: mutation,
  useReorderPlaylistItems: mutation,
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'demo' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, token: 't' }),
}));
const appConfirm = jest.fn();
const appAlert = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirm(...a),
  appAlert: (...a: unknown[]) => appAlert(...a),
}));
jest.mock('@/components/playlists/PlaylistCreateWizard', () => ({ PlaylistCreateWizard: () => null }));
jest.mock('@/components/playlists/PublishToLocationsModal', () => ({ PublishToLocationsModal: () => null }));
jest.mock('@/components/playlists/PlaylistPreviewThumb', () => ({ PlaylistPreviewThumb: () => <div data-testid="thumb" /> }));

import PlaylistsPage from '../page';

/** What apiFetch throws for the server's 409 PLAYLIST_PUBLISHED (status + code + parsed body). */
function published409(reach?: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    error: true,
    code: 'PLAYLIST_PUBLISHED',
    message: '“Fall Fundraiser” is still published (0 publishing rules · 0 screens · copies at 3 other locations), so it was not deleted. Refresh the page and remove it again to confirm.',
    confirmQuery: 'confirm=in-use',
  };
  if (reach) body.reach = reach;
  return Object.assign(new Error(body.message as string), { status: 409, code: 'PLAYLIST_PUBLISHED', body });
}

async function remove(name: string) {
  render(<PlaylistsPage />);
  // The row itself (the library also renders a compact layout for phones).
  const row = screen.getAllByTestId('playlist-row').find((r) => r.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  fireEvent.click(within(row).getByRole('button', { name: `More actions for ${name}` }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole('menu', { name: `Actions for ${name}` })).getByRole('menuitem', { name: 'Remove playlist' }));
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/demo/playlists');
  deleteImpl = jest.fn().mockResolvedValue({ deleted: true });
  appConfirm.mockReset().mockResolvedValue(true);
  appAlert.mockReset().mockResolvedValue(undefined);
});

describe('removing a playlist — the in-use confirmation', () => {
  it('a published playlist: the published warning, and confirming it sends the confirmation', async () => {
    await remove('Member Promotions');
    await waitFor(() => expect(deleteImpl).toHaveBeenCalled());
    expect(appConfirm).toHaveBeenCalledTimes(1);
    expect(appConfirm.mock.calls[0][0]).toMatchObject({
      title: 'Delete published playlist “Member Promotions”?',
      confirmLabel: 'Delete playlist and rules',
      tone: 'danger',
    });
    expect(appConfirm.mock.calls[0][0].message).toContain('1 rule · 1 screen');
    expect(deleteImpl).toHaveBeenCalledTimes(1);
    expect(deleteImpl).toHaveBeenCalledWith({ id: 'p1', confirmInUse: true });
    expect(appAlert).not.toHaveBeenCalled();
  });

  it('an unpublished playlist: "not published anywhere", and the delete goes WITHOUT the confirmation', async () => {
    await remove('Fall Fundraiser');
    await waitFor(() => expect(deleteImpl).toHaveBeenCalled());
    expect(appConfirm.mock.calls[0][0]).toMatchObject({ title: 'Remove “Fall Fundraiser”?', confirmLabel: 'Remove permanently' });
    expect(deleteImpl).toHaveBeenCalledWith({ id: 'p2', confirmInUse: false });
  });

  it('cancelling the warning sends nothing', async () => {
    appConfirm.mockResolvedValue(false);
    await remove('Member Promotions');
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    expect(deleteImpl).not.toHaveBeenCalled();
  });

  it('the server finds it published after all: the published warning with the SERVER numbers, then — only if confirmed — the confirmation', async () => {
    deleteImpl = jest.fn()
      .mockRejectedValueOnce(published409({ rules: 4, screens: 12, locations: 4, copies: 3 }))
      .mockResolvedValueOnce({ deleted: true });
    await remove('Fall Fundraiser');
    await waitFor(() => expect(deleteImpl).toHaveBeenCalledTimes(2));
    expect(appConfirm).toHaveBeenCalledTimes(2);
    const second = appConfirm.mock.calls[1][0];
    expect(second).toMatchObject({
      title: 'Delete published playlist “Fall Fundraiser”?',
      confirmLabel: 'Delete playlist and rules',
      tone: 'danger',
    });
    expect(second.message).toContain('4 rules · 12 screens · 4 locations');
    expect(second.message).toMatch(/copies at 3 other locations/);
    expect(deleteImpl.mock.calls.map(([arg]) => arg)).toEqual([
      { id: 'p2', confirmInUse: false },
      { id: 'p2', confirmInUse: true },
    ]);
    expect(appAlert).not.toHaveBeenCalled();
  });

  it('declining the server-numbers warning keeps the playlist: no second delete', async () => {
    appConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    deleteImpl = jest.fn().mockRejectedValueOnce(published409({ rules: 0, screens: 0, locations: 2, copies: 1 }));
    await remove('Fall Fundraiser');
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(2));
    expect(deleteImpl).toHaveBeenCalledTimes(1);
    expect(appAlert).not.toHaveBeenCalled();
  });

  it('a 409 PLAYLIST_PUBLISHED with no reach: the server sentence, and no confirmed retry', async () => {
    deleteImpl = jest.fn().mockRejectedValueOnce(published409());
    await remove('Fall Fundraiser');
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0]).toMatchObject({
      title: "Couldn't remove playlist",
      message: expect.stringContaining('so it was not deleted'),
    });
    expect(appConfirm).toHaveBeenCalledTimes(1);
    expect(deleteImpl).toHaveBeenCalledTimes(1);
  });

  it('an emergency refusal of the CONFIRMED delete is reported, never answered with another confirmation', async () => {
    deleteImpl = jest.fn().mockRejectedValueOnce(
      Object.assign(new Error('This playlist is emergency content.'), { status: 409, code: 'PLAYLIST_IN_EMERGENCY_USE' }),
    );
    await remove('Member Promotions');
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0]).toMatchObject({ title: "Couldn't remove playlist", message: 'This playlist is emergency content.' });
    expect(appConfirm).toHaveBeenCalledTimes(1);
    expect(deleteImpl).toHaveBeenCalledTimes(1);
  });

  it('a failure of the second, confirmed delete is reported', async () => {
    deleteImpl = jest.fn()
      .mockRejectedValueOnce(published409({ rules: 1, screens: 1, locations: 2, copies: 1 }))
      .mockRejectedValueOnce(Object.assign(new Error('Network down'), { status: 503 }));
    await remove('Fall Fundraiser');
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0]).toMatchObject({ title: "Couldn't remove playlist", message: 'Network down' });
    expect(deleteImpl).toHaveBeenCalledTimes(2);
  });
});
