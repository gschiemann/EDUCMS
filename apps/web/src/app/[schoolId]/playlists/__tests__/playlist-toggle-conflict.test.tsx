/**
 * Turning a playlist ON when another one already owns the screen.
 *
 * This behaviour has shipped since 2026-05-04 and took THREE takes to get
 * right. On 2026-09-16 its derivation moved into
 * `playlistOps.findScreenConflicts` so the Add-screens dialog could ask the
 * same question instead of growing a second hand-rolled copy — and at that
 * moment it had NO test at all. The negative control proved it: neutering the
 * warning at this call site left all five playlist-page suites green.
 *
 * So this suite exists to make the extraction falsifiable. It drives the real
 * classic page through the operator's own control — the on/off toggle on a
 * playlist card — and asserts the prompt, its copy, and both answers.
 *
 * Fixture shape matters and is easy to get wrong:
 *   - p1 must have a schedule (`scheduleCount > 0`) or `handleToggleClick`
 *     opens the editor instead of toggling ("Set a schedule first").
 *   - p1's schedule must be INACTIVE so the card renders "Turn on".
 *   - p2 must be ACTIVE on a screen p1 also targets, or there is no conflict.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, act, waitFor } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby North', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's2', name: 'Lobby South', status: 'OFFLINE', screenGroupId: 'g1' },
  { id: 's3', name: 'Cafeteria', status: 'ONLINE', screenGroupId: null },
  { id: 's9', name: 'The Den', status: 'ONLINE', screenGroupId: null },
];
const GROUPS = [{ id: 'g1', name: 'Lobby Wall', screens: SCREENS.slice(0, 2) }];

const PLAYLISTS = [
  { id: 'p1', name: 'Fall Assembly', items: [], isActive: false },
  { id: 'p2', name: 'Kings Portrait', items: [], isActive: true },
];

// p1 is pinned to Cafeteria but switched OFF; p2 is LIVE on Cafeteria AND on
// The Den. Turning p1 on must displace p2 on Cafeteria ONLY — its Den rule is
// untouched. That asymmetry is the take-2 regression Greg reported:
// "it turned off the new url playlist as well for a screen that isnt included".
const SCHEDULES = [
  { id: 'sc-p1', playlistId: 'p1', screenId: 's3', screenGroupId: null, isActive: false },
  { id: 'sc-p2-hit', playlistId: 'p2', screenId: 's3', screenGroupId: null, isActive: true },
  { id: 'sc-p2-keep', playlistId: 'p2', screenId: 's9', screenGroupId: null, isActive: true },
];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

const toggleScheduleSpy = jest.fn();
const setActiveSpy = jest.fn();

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
  useSetPlaylistSync: mutation,
  useDeleteSchedule: mutation,
  useToggleSchedule: () => ({ mutate: toggleScheduleSpy, mutateAsync: jest.fn(), isPending: false }),
  useUpdateSchedule: mutation,
  useSetPlaylistActive: () => ({ mutate: setActiveSpy, mutateAsync: jest.fn(), isPending: false }),
  useCreateSubmission: mutation,
  usePublishToFleet: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false, reset: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));

const appConfirmMock = jest.fn().mockResolvedValue(true);
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirmMock(...a),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, tenant: { id: 't1' } }),
}));

import PlaylistsPage from '../ClassicPlaylistsPage';

/** Click the on/off toggle on the "Fall Assembly" card. */
async function turnOnFallAssembly() {
  render(<PlaylistsPage />);
  // Both cards render a toggle; p1 is off so its label is "Turn on", p2 is
  // live so its label is "Turn off". Exactly one says "Turn on".
  const toggle = rtl.getByRole('button', { name: 'Turn on' });
  await act(async () => { fireEvent.click(toggle); });
}

beforeEach(() => {
  toggleScheduleSpy.mockClear();
  setActiveSpy.mockClear();
  appConfirmMock.mockClear();
  appConfirmMock.mockResolvedValue(true);
});

describe('turning a playlist on over another playlist’s screen', () => {
  it('warns, naming the other playlist and only the shared screen', async () => {
    await turnOnFallAssembly();
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());

    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; tone: string };
    expect(arg.title).toBe('Replace on 1 screen?');
    expect(arg.message).toContain('“Kings Portrait” is currently playing on Cafeteria');
    expect(arg.message).toContain('Switching “Fall Assembly” on');
    expect(arg.message).toContain('its other screens stay untouched');
    // The Den is p2's OTHER screen and must not be named — naming it would be
    // the take-2 regression resurfacing in the copy.
    expect(arg.message).not.toContain('The Den');
    expect(arg.confirmLabel).toBe('Replace');
    expect(arg.tone).toBe('warn');
  });

  it('agreeing switches off ONLY the overlapping rule, then activates', async () => {
    await turnOnFallAssembly();
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalled());

    expect(toggleScheduleSpy).toHaveBeenCalledWith('sc-p2-hit');
    expect(toggleScheduleSpy).not.toHaveBeenCalledWith('sc-p2-keep');
    expect(setActiveSpy).toHaveBeenCalledWith({ id: 'p1', active: true });
  });

  it('refusing changes nothing at all', async () => {
    appConfirmMock.mockResolvedValue(false);
    await turnOnFallAssembly();
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());

    expect(toggleScheduleSpy).not.toHaveBeenCalled();
    expect(setActiveSpy).not.toHaveBeenCalled();
  });
});
