/**
 * The Publish to Screens sheet — THE OTHER DOOR onto "one screen, two
 * playlists".
 *
 * Greg, minutes after the Add-screens dialog got this warning: "i was just able
 * to add a screen to a playlist that was already in another playlist...did that
 * fix hit yet?" It had not shipped — and it would not have caught him anyway,
 * because this sheet creates schedules by a different path and I had guarded
 * only the dialog and the on/off toggle.
 *
 * FOUR surfaces create schedules. Closing one and calling the job done is how a
 * fix gets reported as shipped while the operator keeps hitting the bug, so
 * each door gets its own mounted test with its own negative control.
 *
 * Fixture shape:
 *   p1 "Fall Assembly"  — the playlist being published (has an item so the
 *                         sheet's Publish button is reachable).
 *   p2 "Kings Portrait" — ACTIVE on Cafeteria (s3) and on Gym Ribbon (s9).
 * Publishing p1 to Cafeteria must warn about p2 on Cafeteria ONLY; its Gym
 * Ribbon rule is not ours to touch.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, act, waitFor, within } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby North', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's2', name: 'Lobby South', status: 'OFFLINE', screenGroupId: 'g1' },
  { id: 's3', name: 'Cafeteria', status: 'ONLINE', screenGroupId: null },
  { id: 's9', name: 'Gym Ribbon', status: 'ONLINE', screenGroupId: null },
];
const GROUPS = [{ id: 'g1', name: 'Lobby Wall', screens: SCREENS.slice(0, 2) }];

const PLAYLISTS = [
  { id: 'p1', name: 'Fall Assembly', items: [], isActive: false },
  { id: 'p2', name: 'Kings Portrait', items: [], isActive: true },
];

const SCHEDULES = [
  { id: 'sc-p2-hit', playlistId: 'p2', screenId: 's3', screenGroupId: null, isActive: true },
  { id: 'sc-p2-keep', playlistId: 'p2', screenId: 's9', screenGroupId: null, isActive: true },
];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

const createScheduleSpy = jest.fn().mockResolvedValue({ id: 'new-sched' });

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
  useCreateSchedule: () => ({ mutateAsync: createScheduleSpy, isPending: false }),
  useSetPlaylistSync: mutation,
  useDeleteSchedule: mutation,
  useToggleSchedule: mutation,
  useUpdateSchedule: mutation,
  useSetPlaylistActive: mutation,
  useCreateSubmission: mutation,
  // Double-sided faces. This mock replaces use-api WHOLESALE, so a hook
  // missing here renders as undefined and throws a TypeError rather than
  // failing on the thing under test. Add new hooks here too.
  useSetScreenFaceMode: mutation,
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

/** Open Fall Assembly → Schedules → Add Schedule → the sheet. */
async function openPublishSheet() {
  render(<PlaylistsPage />);
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: 'Open playlist Fall Assembly' }));
  });
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: 'Schedules' }));
  });
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: /Add Schedule/ }));
  });
  return within(rtl.getByRole('dialog', { name: 'Publish to Screens' }));
}

/** Tick a screen in the sheet and press Publish. */
async function publishTo(sheet: ReturnType<typeof within>, screenName: string) {
  fireEvent.click(sheet.getByText(screenName));
  await act(async () => {
    fireEvent.click(sheet.getByRole('button', { name: /^Publish$/ }));
  });
}

beforeEach(() => {
  createScheduleSpy.mockClear();
  appConfirmMock.mockClear();
  appConfirmMock.mockResolvedValue(true);
});

describe('Publish to Screens — taking a screen another playlist is on', () => {
  it('warns, naming the other playlist and only the shared screen', async () => {
    const sheet = await openPublishSheet();
    await publishTo(sheet, 'Cafeteria');

    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; tone: string };
    expect(arg.title).toBe('Replace on 1 screen?');
    expect(arg.message).toContain('“Kings Portrait” is currently playing on Cafeteria');
    expect(arg.message).toContain('its other screens stay untouched');
    // p2's OTHER screen is not ours to take, so it must not be named.
    expect(arg.message).not.toContain('Gym Ribbon');
    expect(arg.confirmLabel).toBe('Replace');
    expect(arg.tone).toBe('warn');
  });

  it('REFUSING publishes nothing', async () => {
    appConfirmMock.mockResolvedValue(false);
    const sheet = await openPublishSheet();
    await publishTo(sheet, 'Cafeteria');

    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(createScheduleSpy).not.toHaveBeenCalled();
  });

  it('agreeing publishes — the server then displaces the other rule', async () => {
    const sheet = await openPublishSheet();
    await publishTo(sheet, 'Cafeteria');

    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    // replace mode + going live is what makes the API displace. If either
    // changes, the warning starts promising something that will not happen.
    expect(createScheduleSpy.mock.calls[0][0]).toMatchObject({
      screenId: 's3', mode: 'replace', isActive: true,
    });
  });

  it('a free screen publishes with no prompt at all', async () => {
    const sheet = await openPublishSheet();
    await publishTo(sheet, 'Lobby North');   // nobody is on s1

    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
  });
});
