/**
 * The power button on a playlist's screen row — THE FIFTH DOOR onto
 * "one screen, two playlists".
 *
 * Greg, 2026-09-19: "we add the group when creating the playlist so that its
 * easy to add them all at once but after its created its up to the user if the
 * want to disable a screen from a playlist".
 *
 * So every row's button works now, including the screens that are only on the
 * playlist through a GROUP rule. Which makes switching one screen ON a fifth way
 * to put two playlists on one screen at once — and Greg's rule (2026-09-16) has
 * no exceptions: "you cant have a screen active in two playlist at the same time
 * unless its scheduled". The four doors that already ask are worthless if this
 * one does not.
 *
 * WHAT IS DIFFERENT HERE, and asserted below: the other playlist is stood down
 * ON THAT SCREEN ONLY. The older doors toggle the competitor's whole rule, which
 * for a group rule takes it off every screen in the group — far more than
 * "Replace on 1 screen" says.
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const NOW = Date.now();
const SCREENS = [
  { id: 's1', name: 'G75', status: 'ONLINE', screenGroupId: 'g1', lastPingAt: new Date(NOW).toISOString() },
  { id: 's2', name: 'GUQ55', status: 'ONLINE', screenGroupId: 'g1', lastPingAt: new Date(NOW).toISOString() },
  { id: 's3', name: 'L55VEC', status: 'ONLINE', screenGroupId: null, lastPingAt: new Date(NOW).toISOString() },
];
const GROUPS = [{ id: 'g1', name: 'LCD Flat Panels', screens: [{ id: 's1', name: 'G75' }, { id: 's2', name: 'GUQ55' }] }];
const PLAYLISTS = [
  { id: 'p1', name: 'Frog 1920', items: [], updatedAt: new Date(NOW).toISOString() },
  { id: 'p2', name: 'Kings Portrait', items: [], updatedAt: new Date(NOW).toISOString() },
];
const start = new Date(NOW - 86400000).toISOString();

let SCHEDULES: Array<Record<string, unknown>> = [];

const query = (get: () => unknown) => () =>
  ({ data: get(), isLoading: false, isError: false, isFetched: true, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({}), mutate: jest.fn(), isPending: false });

const setActiveSpy = jest.fn().mockResolvedValue({});
const removeSpy = jest.fn().mockResolvedValue({});

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(() => PLAYLISTS),
  useSchedules: query(() => SCHEDULES),
  useScreens: query(() => SCREENS),
  useScreenGroups: query(() => GROUPS),
  usePlaylistDelivery: () => ({ data: null, isLoading: false, isError: false, isFetched: false, refetch: jest.fn() }),
  useAuditLog: query(() => ({ items: [], total: 0, limit: 200, offset: 0 })),
  useSetPlaylistActive: mutation,
  useSetPlaylistSync: mutation,
  useRefreshWeb: mutation,
  useCreateSchedule: mutation,
  useUpdateSchedule: mutation,
  useSetScreenFaceMode: () => ({ mutate: jest.fn(), isPending: false }),
  useSetPlaylistScreenActive: () => ({ mutateAsync: setActiveSpy, isPending: false }),
  useRemovePlaylistScreen: () => ({ mutateAsync: removeSpy, isPending: false }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'demo', playlistId: 'p1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, token: 't' }),
}));
const appConfirmMock = jest.fn().mockResolvedValue(true);
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirmMock(...a),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('next/dynamic', () => () => {
  const Stub = () => <div data-testid="classic-editor">editor</div>;
  Stub.displayName = 'ClassicEditorStub';
  return Stub;
});

import WorkspacePage from '../[playlistId]/page';

function renderWorkspace() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkspacePage /></QueryClientProvider>);
}

const rowFor = (name: string) =>
  screen.getAllByTestId('delivery-row').find((r) => r.textContent?.includes(name))!;

function open() {
  window.history.replaceState(null, '', '/demo/playlists/p1?tab=screens');
  renderWorkspace();
}

beforeEach(() => {
  setActiveSpy.mockClear();
  removeSpy.mockClear();
  appConfirmMock.mockClear();
  appConfirmMock.mockResolvedValue(true);
});

describe('a screen on the playlist through a GROUP rule', () => {
  beforeEach(() => {
    SCHEDULES = [{ id: 'g-rule', playlistId: 'p1', screenId: null, screenGroupId: 'g1', isActive: true, startTime: start }];
  });

  it('switching it OFF asks the playlist-scoped door for THAT screen — no prompt, nothing else touched', async () => {
    open();
    const row = rowFor('GUQ55');
    expect(row.textContent).toContain('via LCD Flat Panels');
    fireEvent.click(within(row).getByRole('button', { name: 'Stop this playlist on GUQ55' }));
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledTimes(1));
    expect(setActiveSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's2', active: false });
    expect(appConfirmMock).not.toHaveBeenCalled();
  });

  it('removing it confirms first, then asks for that screen', async () => {
    open();
    fireEvent.click(within(rowFor('G75')).getByRole('button', { name: 'Remove G75 from this playlist' }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's1' }));
    expect(appConfirmMock).toHaveBeenCalledTimes(1);
  });

  it('declining the remove does nothing', async () => {
    appConfirmMock.mockResolvedValue(false);
    open();
    fireEvent.click(within(rowFor('G75')).getByRole('button', { name: 'Remove G75 from this playlist' }));
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe('switching ONE screen on — the fifth door', () => {
  const pausedOwn = { id: 'mine', playlistId: 'p1', screenId: 's3', screenGroupId: null, isActive: false, startTime: start };

  it('a FREE screen switches on with no prompt', async () => {
    SCHEDULES = [pausedOwn];
    open();
    fireEvent.click(within(rowFor('L55VEC')).getByRole('button', { name: 'Play this playlist on L55VEC' }));
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's3', active: true }));
    expect(appConfirmMock).not.toHaveBeenCalled();
    expect(setActiveSpy).toHaveBeenCalledTimes(1);
  });

  it('a screen another playlist is playing on WARNS, naming it', async () => {
    SCHEDULES = [pausedOwn, { id: 'theirs', playlistId: 'p2', screenId: 's3', screenGroupId: null, isActive: true, startTime: start }];
    open();
    fireEvent.click(within(rowFor('L55VEC')).getByRole('button', { name: 'Play this playlist on L55VEC' }));
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; tone: string };
    expect(arg.title).toBe('Replace on 1 screen?');
    expect(arg.message).toContain('Kings Portrait');
    expect(arg.message).toContain('L55VEC');
    expect(arg.tone).toBe('warn');
  });

  it('REFUSING changes nothing at all', async () => {
    appConfirmMock.mockResolvedValue(false);
    SCHEDULES = [pausedOwn, { id: 'theirs', playlistId: 'p2', screenId: 's3', screenGroupId: null, isActive: true, startTime: start }];
    open();
    fireEvent.click(within(rowFor('L55VEC')).getByRole('button', { name: 'Play this playlist on L55VEC' }));
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(setActiveSpy).not.toHaveBeenCalled();
  });

  it('agreeing stands the other playlist down ON THAT SCREEN ONLY, then switches this one on', async () => {
    // The other playlist is on the screen through ITS group rule. Toggling that
    // rule — what the older doors do — would blank it on the whole group.
    SCHEDULES = [
      { id: 'mine-g', playlistId: 'p1', screenId: null, screenGroupId: 'g1', isActive: false, startTime: start },
      { id: 'theirs-g', playlistId: 'p2', screenId: null, screenGroupId: 'g1', isActive: true, startTime: start },
    ];
    open();
    fireEvent.click(within(rowFor('GUQ55')).getByRole('button', { name: 'Play this playlist on GUQ55' }));
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledTimes(2));
    expect(setActiveSpy.mock.calls.map((c) => c[0])).toEqual([
      { playlistId: 'p2', screenId: 's2', active: false },   // them, off — this screen only
      { playlistId: 'p1', screenId: 's2', active: true },    // then us, on
    ]);
  });

  it('a playlist in a DIFFERENT window is not a conflict — breakfast and dinner share a screen', async () => {
    SCHEDULES = [
      { ...pausedOwn, timeStart: '06:00', timeEnd: '10:00' },
      { id: 'theirs', playlistId: 'p2', screenId: 's3', screenGroupId: null, isActive: true, startTime: start, timeStart: '17:00', timeEnd: '21:00' },
    ];
    open();
    fireEvent.click(within(rowFor('L55VEC')).getByRole('button', { name: 'Play this playlist on L55VEC' }));
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's3', active: true }));
    expect(appConfirmMock).not.toHaveBeenCalled();
  });
});

describe('a screen whose 1080p playback copy is in play (rule 16, 2026-09-26)', () => {
  const FAIL = 'A playback copy could not be prepared. Retry publishing this playlist.';
  const preparingOwn = { id: 'mine', playlistId: 'p1', screenId: 's3', screenGroupId: null, isActive: false, pendingMedia: true, pendingMediaError: null, startTime: start };

  it('PREPARING: the switch is "Stop and cancel publish" — confirmed, named, then OFF for that screen', async () => {
    SCHEDULES = [preparingOwn];
    open();
    const row = rowFor('L55VEC');
    expect(row).toHaveAttribute('data-playback', 'preparing');
    fireEvent.click(within(row).getByRole('button', { name: 'Stop and cancel publish on L55VEC' }));
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's3', active: false }));
    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; tone: string };
    expect(arg.title).toBe('Stop and cancel publish on L55VEC?');
    expect(arg.message).toContain('The 1080p copy being prepared for L55VEC is cancelled');
    expect(arg.confirmLabel).toBe('Stop and cancel publish');
    expect(arg.tone).toBe('danger');
  });

  it('declining the cancel leaves the copy preparing', async () => {
    appConfirmMock.mockResolvedValue(false);
    SCHEDULES = [preparingOwn];
    open();
    fireEvent.click(within(rowFor('L55VEC')).getByRole('button', { name: 'Stop and cancel publish on L55VEC' }));
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(setActiveSpy).not.toHaveBeenCalled();
  });

  it('removing a preparing screen says it also cancels the copy', async () => {
    SCHEDULES = [preparingOwn];
    open();
    fireEvent.click(within(rowFor('L55VEC')).getByRole('button', { name: 'Remove L55VEC from this playlist' }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's3' }));
    const arg = appConfirmMock.mock.calls[0][0] as { message: string };
    expect(arg.message).toContain('This also cancels the 1080p copy being prepared for it.');
  });

  it('FAILED: the switch is a retry — a fresh attempt through the gate, no prompt on a free screen', async () => {
    SCHEDULES = [{ ...preparingOwn, pendingMediaError: FAIL }];
    open();
    const row = rowFor('L55VEC');
    expect(row).toHaveAttribute('data-playback', 'failed');
    expect(within(row).getByText('Playback copy failed')).toHaveAttribute('title', FAIL);
    fireEvent.click(within(row).getByRole('button', { name: 'Retry publish on L55VEC' }));
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith({ playlistId: 'p1', screenId: 's3', active: true }));
    expect(appConfirmMock).not.toHaveBeenCalled();
  });

  it('members of a GROUP whose rule is preparing are locked — the server would refuse the split', async () => {
    SCHEDULES = [{ id: 'g-rule', playlistId: 'p1', screenId: null, screenGroupId: 'g1', isActive: false, pendingMedia: true, pendingMediaError: null, startTime: start }];
    open();
    for (const name of ['G75', 'GUQ55']) {
      const row = rowFor(name);
      expect(row).toHaveAttribute('data-playback', 'group-preparing');
      expect(within(row).getByText('Preparing 1080p copy for LCD Flat Panels')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: `Remove ${name} from this playlist` })).toBeDisabled();
    }
    expect(setActiveSpy).not.toHaveBeenCalled();
  });

  it('the group-locked state does NOT spread to a screen with a rule of its own', async () => {
    SCHEDULES = [
      { id: 'g-rule', playlistId: 'p1', screenId: null, screenGroupId: 'g1', isActive: false, pendingMedia: true, pendingMediaError: null, startTime: start },
      { id: 'own-s1', playlistId: 'p1', screenId: 's1', screenGroupId: null, isActive: true, startTime: start },
    ];
    open();
    expect(rowFor('G75')).not.toHaveAttribute('data-playback');
    expect(within(rowFor('G75')).getByRole('button', { name: 'Stop this playlist on G75' })).toBeEnabled();
    expect(rowFor('GUQ55')).toHaveAttribute('data-playback', 'group-preparing');
  });
});
