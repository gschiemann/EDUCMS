/**
 * The new-playlist wizard — THE FOURTH DOOR onto "one screen, two playlists".
 *
 * Greg, 2026-09-16, naming all three cases at once:
 *   "it needs to catch me adding a screen to an existing playlist, building a
 *    new playlist or turning on an old playlist that has screens in another
 *    active playlist"
 *
 * "Building a new playlist" is this one. Four surfaces create schedules; the
 * other three are covered by their own suites, and each has a negative control
 * because a guard nothing asserts is how a fix gets reported as shipped while
 * the operator keeps hitting the bug.
 *
 * AND THE RULE IS TIME-AWARE:
 *   "you cant have a screen active in two playlist at the same time unless its
 *    scheduled...breakfast, lunch, dinner with different schedules but they
 *    cant be on at the same time"
 * So a new always-on playlist landing on an occupied screen warns, and a new
 * dinner playlist landing beside an existing breakfast one does not.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby North', status: 'ONLINE' },
  { id: 's3', name: 'Cafeteria', status: 'ONLINE' },
];
const GROUPS: unknown[] = [];
const ASSETS = [
  { id: 'a1', originalName: 'Welcome.png', title: 'Welcome', mimeType: 'image/png', fileUrl: '/u/a1.png', folderId: null },
];

const PLAYLISTS = [{ id: 'p2', name: 'Kings Portrait' }];

const noopMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'new' }), isPending: false });
const createScheduleSpy = jest.fn().mockResolvedValue({ id: 'sched-new' });

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: ASSETS }),
  useAssetFolders: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useScreens: () => ({ data: SCREENS }),
  useScreenGroups: () => ({ data: GROUPS }),
  useCreatePlaylist: () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'p-new', name: 'Dinner Board' }), isPending: false }),
  useReorderPlaylistItems: noopMutation,
  useCreateSchedule: () => ({ mutateAsync: createScheduleSpy, isPending: false }),
  useCreateSubmission: noopMutation,
  useSetPlaylistSync: noopMutation,
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
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN' } }),
}));

import { PlaylistCreateWizard } from '../PlaylistCreateWizard';

/** p2 already holds Cafeteria, in the given window. */
const occupying = (daysOfWeek: string | null, timeStart: string | null, timeEnd: string | null) => [
  { id: 'sc-p2', playlistId: 'p2', screenId: 's3', screenGroupId: null, isActive: true, daysOfWeek, timeStart, timeEnd },
];

/**
 * Walk the wizard to Create, taking Cafeteria on the way.
 *
 * Step 4 is left on its default, "Activate immediately" — which is the case
 * that matters here, because an always-on playlist collides with everything.
 * (The windowed path is exercised directly against the rule in
 * screenConflicts.test.ts, where breakfast-vs-lunch is proven without having
 * to drive five wizard steps to assert one boolean.)
 */
async function createTakingCafeteria(schedules: ReturnType<typeof occupying>) {
  render(
    <PlaylistCreateWizard
      open
      onClose={() => {}}
      onCreated={() => {}}
      playlists={PLAYLISTS}
      allSchedules={schedules}
    />,
  );

  fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Dinner Board' } });
  fireEvent.click(rtl.getByText('Media Playlist'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

  fireEvent.click(rtl.getByText('Welcome.png'));
  fireEvent.click(rtl.getByRole('button', { name: /Next/ }));

  // Step 3 — take the screen p2 is already on.
  fireEvent.click(rtl.getByText('Cafeteria'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

  // Step 4 — publish window, left on "Activate immediately".
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

  // Step 5 — Create.
  fireEvent.click(rtl.getByRole('button', { name: /Create Playlist|Create \(won't display yet\)/ }));
}

beforeEach(() => {
  createScheduleSpy.mockClear();
  appConfirmMock.mockClear();
  appConfirmMock.mockResolvedValue(true);
});

describe('new-playlist wizard — the fourth door', () => {
  it('warns when the new playlist would take an occupied screen at the same time', async () => {
    // Both always-on: the new playlist defaults to activate-immediately, and
    // p2 holds Cafeteria with no window. Always collides with always.
    await createTakingCafeteria(occupying(null, null, null));

    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; tone: string };
    expect(arg.title).toBe('Replace on 1 screen?');
    expect(arg.message).toContain('“Kings Portrait” is currently playing on Cafeteria');
    expect(arg.confirmLabel).toBe('Replace');
    expect(arg.tone).toBe('warn');
  });

  it('REFUSING creates the playlist but assigns no screen', async () => {
    appConfirmMock.mockResolvedValue(false);
    await createTakingCafeteria(occupying(null, null, null));

    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    // The playlist itself is already created by this point; declining leaves it
    // unassigned, the same state as "Skip" on the screen step. What must NOT
    // happen is the schedule that takes the screen.
    expect(createScheduleSpy).not.toHaveBeenCalled();
  });

  it('agreeing creates the schedule', async () => {
    await createTakingCafeteria(occupying(null, null, null));
    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    expect(createScheduleSpy.mock.calls[0][0]).toMatchObject({ screenId: 's3', mode: 'replace' });
  });

  it('a FREE screen creates with no prompt', async () => {
    // p2 is on Cafeteria; this run takes Lobby North instead.
    render(
      <PlaylistCreateWizard
        open
        onClose={() => {}}
        onCreated={() => {}}
        playlists={PLAYLISTS}
        allSchedules={occupying(null, null, null)}
      />,
    );
    fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Dinner Board' } });
    fireEvent.click(rtl.getByText('Media Playlist'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByText('Welcome.png'));
    fireEvent.click(rtl.getByRole('button', { name: /Next/ }));
    fireEvent.click(rtl.getByText('Lobby North'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /Create Playlist|Create \(won't display yet\)/ }));

    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
  });

  it('without the playlist lists it creates silently rather than warning wrongly', async () => {
    render(<PlaylistCreateWizard open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Dinner Board' } });
    fireEvent.click(rtl.getByText('Media Playlist'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByText('Welcome.png'));
    fireEvent.click(rtl.getByRole('button', { name: /Next/ }));
    fireEvent.click(rtl.getByText('Cafeteria'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
    fireEvent.click(rtl.getByRole('button', { name: /Create Playlist|Create \(won't display yet\)/ }));

    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
  });
});
