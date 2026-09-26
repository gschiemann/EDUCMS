/**
 * The Schedule tab understands a 1080p playback copy (rule 16, 2026-09-26).
 *
 * A rule held for a screen-sized copy is neither running nor paused: the card
 * says PREPARING 1080P and that it starts by itself, its power button is the
 * confirmed "Stop and cancel publish" (the server cancels a held rule on
 * toggle — never a silent cancel behind a pause icon), and deleting it says it
 * cancels the copy too. A rule whose copy FAILED is inert (bdb3f59a): the card
 * carries the server's words and offers "Retry publish", which is a FRESH
 * publish of the same window and target through the gate.
 *
 * Same harness as schedule-card-states.test.tsx, with the mutations spied so
 * the click → confirm → request chain is asserted, not just the paint.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, act, within, waitFor } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby LCD', status: 'ONLINE', screenGroupId: null },
  { id: 's2', name: '4K wall', status: 'ONLINE', screenGroupId: null },
  { id: 's3', name: 'Hall 1', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's4', name: 'Hall 2', status: 'ONLINE', screenGroupId: 'g1' },
];
const GROUPS = [{ id: 'g1', name: 'Hallway', screens: [{ id: 's3', name: 'Hall 1' }, { id: 's4', name: 'Hall 2' }] }];
const PLAYLISTS = [{ id: 'p1', name: 'Promo 4K', items: [], isActive: true }];
const FAIL = 'A playback copy could not be prepared. Retry publishing this playlist.';

const base = (over: Record<string, unknown>) => ({
  playlistId: 'p1', screenId: null, screenGroupId: null, isActive: true, pendingMedia: false, pendingMediaError: null,
  daysOfWeek: null, timeStart: null, timeEnd: null, mutedOverride: null, startTime: '2026-09-16T00:00:00.000Z', endTime: null,
  priority: 0, mode: 'replace', ...over,
});

let SCHEDULES: any[] = [];

const toggleSpy = jest.fn();
const deleteSpy = jest.fn();
const createSpy = jest.fn().mockResolvedValue({ id: 'new' });
const appConfirmMock = jest.fn().mockResolvedValue(true);
const appAlertMock = jest.fn().mockResolvedValue(undefined);

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), mutate: jest.fn(), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query([]),
  useAssetFolders: query([]),
  useScreenGroups: query(GROUPS),
  useSchedules: () => ({ data: SCHEDULES, isLoading: false, isError: false, refetch: jest.fn() }),
  useScreens: query(SCREENS),
  useTemplates: query([]),
  useUsers: query([]),
  useFleet: query({ root: null, locations: [], stats: { total: 0, online: 0, offline: 0, locationCount: 0 }, screens: [] }),
  useCreatePlaylist: mutation,
  useDeletePlaylist: mutation,
  useReorderPlaylistItems: mutation,
  useCreateSchedule: () => ({ mutateAsync: createSpy, mutate: jest.fn(), isPending: false }),
  useSetPlaylistSync: mutation,
  useDeleteSchedule: () => ({ mutateAsync: jest.fn(), mutate: deleteSpy, isPending: false }),
  useToggleSchedule: () => ({ mutateAsync: jest.fn(), mutate: toggleSpy, isPending: false }),
  useUpdateSchedule: mutation,
  useSetPlaylistActive: mutation,
  useCreateSubmission: mutation,
  useSetScreenFaceMode: mutation,
  usePublishToFleet: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false, reset: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirmMock(...a),
  appAlert: (...a: unknown[]) => appAlertMock(...a),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, tenant: { id: 't1' } }),
}));

import PlaylistsPage from '../ClassicPlaylistsPage';

async function openScheduleTab() {
  const view = render(<PlaylistsPage />);
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: 'Open playlist Promo 4K' }));
  });
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: /^Schedules/ }));
  });
  return view;
}

const cards = () => rtl.getAllByTestId('schedule-window');

beforeEach(() => {
  toggleSpy.mockClear();
  deleteSpy.mockClear();
  createSpy.mockClear();
  appConfirmMock.mockClear();
  appConfirmMock.mockResolvedValue(true);
  appAlertMock.mockClear();
});

describe('a window with rules held for a 1080p copy', () => {
  beforeEach(() => {
    SCHEDULES = [
      base({ id: 'r-lcd', screenId: 's1', isActive: false, pendingMedia: true }),
      base({ id: 'r-wall', screenId: 's2', isActive: true }),
      base({ id: 'r-g', screenGroupId: 'g1', isActive: false, pendingMedia: true }),
    ];
  });

  it('says PREPARING for the screens that wait (a group counts its members) and is not dimmed', async () => {
    await openScheduleTab();
    const [card] = cards();
    expect(card).toHaveAttribute('data-playback', 'preparing');
    expect(card.className).not.toContain('opacity-60');
    // s1 + the two Hallway members wait; the 4K wall plays.
    expect(within(card).getByTestId('window-preparing')).toHaveTextContent('Preparing 1080p copy for 3 screens');
    expect(within(card).queryByText('Paused everywhere')).not.toBeInTheDocument();
  });

  it('its power button is "Stop and cancel publish": confirmed with the count, then every rule is toggled', async () => {
    await openScheduleTab();
    const [card] = cards();
    const power = within(card).getByRole('button', { name: 'Stop and cancel publish' });
    expect(power).toHaveAttribute('title', 'Stop and cancel publish');
    await act(async () => { fireEvent.click(power); });
    await waitFor(() => expect(toggleSpy).toHaveBeenCalledTimes(3));
    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string };
    expect(arg.title).toBe('Stop and cancel publish?');
    expect(arg.message).toBe('This cancels the 1080p copy being prepared for 3 screens and pauses this schedule on 4 screens.');
    expect(arg.confirmLabel).toBe('Stop and cancel publish');
    expect(toggleSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['r-g', 'r-lcd', 'r-wall']);
  });

  it('declining leaves the copy preparing', async () => {
    appConfirmMock.mockResolvedValue(false);
    await openScheduleTab();
    await act(async () => { fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Stop and cancel publish' })); });
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(toggleSpy).not.toHaveBeenCalled();
  });

  it('deleting the window says it cancels the copy too', async () => {
    await openScheduleTab();
    const [card] = cards();
    const trash = within(card).getAllByRole('button').find((b) => b.querySelector('svg.lucide-trash-2'))!;
    await act(async () => { fireEvent.click(trash); });
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(3));
    const arg = appConfirmMock.mock.calls[0][0] as { message: string };
    expect(arg.message).toContain('It also cancels the 1080p copy being prepared.');
  });
});

describe('a window whose copy FAILED', () => {
  beforeEach(() => {
    SCHEDULES = [base({
      id: 'r-lcd', screenId: 's1', isActive: false, pendingMedia: true, pendingMediaError: FAIL,
      daysOfWeek: 'Mon,Tue', timeStart: '06:00', timeEnd: '10:00', priority: 2, mutedOverride: true,
    })];
  });

  it('carries the server\'s words and offers Retry publish instead of a power button', async () => {
    await openScheduleTab();
    const [card] = cards();
    expect(card).toHaveAttribute('data-playback', 'failed');
    expect(within(card).getByTestId('window-failed')).toHaveTextContent(`Playback copy failed · ${FAIL}`);
    expect(within(card).queryByText('Paused everywhere')).not.toBeInTheDocument();
    expect(within(card).getByTestId('window-retry')).toHaveTextContent('Retry publish');
    expect(within(card).queryByRole('button', { name: 'Stop and cancel publish' })).not.toBeInTheDocument();
  });

  it('Retry publish is a FRESH publish of the failed rule\'s own window and target', async () => {
    await openScheduleTab();
    await act(async () => { fireEvent.click(within(cards()[0]).getByTestId('window-retry')); });
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith({
      playlistId: 'p1', screenId: 's1', startTime: '2026-09-16T00:00:00.000Z',
      daysOfWeek: 'Mon,Tue', timeStart: '06:00', timeEnd: '10:00', priority: 2, mode: 'replace', mutedOverride: true,
    });
    expect(appConfirmMock).not.toHaveBeenCalled();
    expect(toggleSpy).not.toHaveBeenCalled();
  });

  it('a refused retry is reported, not swallowed', async () => {
    createSpy.mockRejectedValueOnce(new Error('The 1080p video copy could not be queued.'));
    await openScheduleTab();
    await act(async () => { fireEvent.click(within(cards()[0]).getByTestId('window-retry')); });
    await waitFor(() => expect(appAlertMock).toHaveBeenCalled());
    expect(appAlertMock.mock.calls[0][0]).toMatchObject({ title: 'Couldn’t retry publishing', message: 'The 1080p video copy could not be queued.', tone: 'danger' });
  });
});

describe('a plain paused window is untouched by any of this', () => {
  it('still reads Paused everywhere with its ordinary Resume button', async () => {
    SCHEDULES = [base({ id: 'r-lcd', screenId: 's1', isActive: false })];
    await openScheduleTab();
    const [card] = cards();
    expect(card).not.toHaveAttribute('data-playback');
    expect(within(card).getByText('Paused everywhere')).toBeInTheDocument();
    expect(within(card).getByTitle('Resume this schedule on 1 screen')).toBeInTheDocument();
    expect(within(card).queryByTestId('window-retry')).not.toBeInTheDocument();
  });
});
