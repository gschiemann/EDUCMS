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
const createPlaylistSpy = jest.fn().mockResolvedValue({ id: 'p-new', name: 'Dinner Board' });

jest.mock('@/hooks/use-api', () => ({
  useFleetOperations: () => ({ data: undefined, isLoading: false }),
  usePublishToFleet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAssets: () => ({ data: ASSETS }),
  useAssetFolders: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useScreens: () => ({ data: SCREENS }),
  useScreenGroups: () => ({ data: GROUPS }),
  useCreatePlaylist: () => ({ mutateAsync: createPlaylistSpy, isPending: false }),
  useReorderPlaylistItems: noopMutation,
  useCreateSchedule: () => ({ mutateAsync: createScheduleSpy, isPending: false }),
  useCreateSubmission: noopMutation,
  useSetPlaylistSync: noopMutation,
  // Double-sided faces. This suite mocks use-api WHOLESALE, so every hook the
  // wizard calls has to be listed here or it reads as undefined at render —
  // which is a TypeError, not a helpful failure. That has now broken a suite
  // ten separate times. If you add a hook to the wizard, add it here too.
  useSetScreenFaceMode: noopMutation,
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));

const appConfirmMock = jest.fn().mockResolvedValue(true);
const appChooseMock = jest.fn().mockResolvedValue('confirm');
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirmMock(...a),
  appChoose: (...a: unknown[]) => appChooseMock(...a),
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
async function createTakingCafeteria(
  schedules: ReturnType<typeof occupying>,
  opts: { window?: boolean; onCreated?: (p: unknown) => void } = {},
) {
  render(
    <PlaylistCreateWizard
      open
      onClose={() => {}}
      onCreated={opts.onCreated ?? (() => {})}
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

  // Step 4 — publish window: "Activate immediately" by default, or the
  // default "Schedule a window" (Mon–Fri 08:00–15:00 — the QA case).
  if (opts.window) fireEvent.click(rtl.getByText('Schedule a window'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));

  // Step 5 — Create.
  fireEvent.click(rtl.getByRole('button', { name: /Create Playlist|Create \(won't display yet\)/ }));
}

beforeEach(() => {
  createScheduleSpy.mockClear();
  createPlaylistSpy.mockClear();
  appConfirmMock.mockClear();
  appConfirmMock.mockResolvedValue(true);
  appChooseMock.mockClear();
  appChooseMock.mockResolvedValue('confirm');
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

  // Launch QA U14 (2026-10-24): Cancel used to leave an unassigned playlist
  // behind — three cancels, three orphan playlists. The question is now asked
  // BEFORE anything is written, so Cancel means nothing was created.
  it('CANCEL creates nothing — no playlist, no schedule — and stays on Review to try again', async () => {
    appConfirmMock.mockResolvedValue(false);
    const onCreated = jest.fn();
    await createTakingCafeteria(occupying(null, null, null), { onCreated });

    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    // Let any (wrong) follow-up writes land before asserting their absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(createPlaylistSpy).not.toHaveBeenCalled();
    expect(createScheduleSpy).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    // Still on Review, with Create enabled again — the operator can change a
    // screen or try again; nothing is half-written.
    const create = rtl.getByRole('button', { name: /Create Playlist|Create \(won't display yet\)/ });
    expect(create).not.toBeDisabled();
  });

  it('while the question is open the Create button does not say "Creating…" — nothing is being created yet', async () => {
    let answer!: (proceed: boolean) => void;
    appConfirmMock.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    await createTakingCafeteria(occupying(null, null, null));

    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    // Busy (nothing behind the question can be clicked), but in its own words.
    await waitFor(() => expect(rtl.getByRole('button', { name: /Create Playlist/ })).toBeDisabled());
    expect(rtl.queryByText('Creating…')).toBeNull();

    answer(false);
    await waitFor(() => expect(rtl.getByRole('button', { name: /Create Playlist/ })).not.toBeDisabled());
    expect(createPlaylistSpy).not.toHaveBeenCalled();
  });

  it('the question is asked before the playlist exists', async () => {
    appConfirmMock.mockImplementation(async () => {
      expect(createPlaylistSpy).not.toHaveBeenCalled();
      return true;
    });
    await createTakingCafeteria(occupying(null, null, null));
    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    expect(createPlaylistSpy).toHaveBeenCalledTimes(1);
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

// Launch QA U15 (2026-10-24): a TIME-LIMITED playlist (Mon–Fri 08:00–15:00)
// onto a screen that plays an ALWAYS-ON one must not switch that one off —
// it keeps playing outside school hours, so the screen is never blank.
// Only an explicit "Replace everything" removes it.
describe('new-playlist wizard — a windowed playlist onto an always-on one', () => {
  it('asks "Keep both" (the default) / "Replace everything" / Cancel, saying what happens outside the hours', async () => {
    await createTakingCafeteria(occupying(null, null, null), { window: true });

    await waitFor(() => expect(appChooseMock).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
    const arg = appChooseMock.mock.calls[0][0] as {
      title: string; message: string; confirmLabel: string; alternateLabel: string; cancelLabel: string;
    };
    expect(arg.title).toBe('Keep “Kings Portrait” playing the rest of the time?');
    expect(arg.message).toContain('“Dinner Board” plays only at its scheduled times.');
    expect(arg.message).toContain('“Kings Portrait” keeps playing on Cafeteria, so that screen is never blank.');
    expect(arg.message).toContain('Replace everything stops “Kings Portrait” on Cafeteria instead.');
    expect(arg.confirmLabel).toBe('Keep both');
    expect(arg.alternateLabel).toBe('Replace everything');
    expect(arg.cancelLabel).toBe('Cancel');
  });

  it('"Keep both" publishes the window WITHOUT replaceAlwaysOn (the server keeps the other as the fallback)', async () => {
    appChooseMock.mockResolvedValue('confirm');
    await createTakingCafeteria(occupying(null, null, null), { window: true });
    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    const body = createScheduleSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ screenId: 's3', mode: 'replace', daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00', timeEnd: '15:00' });
    expect(body).not.toHaveProperty('replaceAlwaysOn');
  });

  it('"Replace everything" sends replaceAlwaysOn: true', async () => {
    appChooseMock.mockResolvedValue('alternate');
    await createTakingCafeteria(occupying(null, null, null), { window: true });
    await waitFor(() => expect(createScheduleSpy).toHaveBeenCalled());
    expect(createScheduleSpy.mock.calls[0][0]).toMatchObject({ screenId: 's3', replaceAlwaysOn: true });
  });

  it('Cancel creates nothing', async () => {
    appChooseMock.mockResolvedValue('cancel');
    await createTakingCafeteria(occupying(null, null, null), { window: true });
    await waitFor(() => expect(appChooseMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(createPlaylistSpy).not.toHaveBeenCalled();
    expect(createScheduleSpy).not.toHaveBeenCalled();
  });

  it('a windowed playlist over an OVERLAPPING windowed one is still a plain replace', async () => {
    // p2 holds Cafeteria Mon–Fri 12:00–13:00 — inside our 08:00–15:00.
    await createTakingCafeteria(occupying('Mon,Tue,Wed,Thu,Fri', '12:00', '13:00'), { window: true });
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(appChooseMock).not.toHaveBeenCalled();
    expect((appConfirmMock.mock.calls[0][0] as { title: string }).title).toBe('Replace on 1 screen?');
  });

  it('an ALWAYS-ON playlist over an always-on one is still a plain replace', async () => {
    await createTakingCafeteria(occupying(null, null, null));
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
    expect(appChooseMock).not.toHaveBeenCalled();
  });
});

// QA 2026-10-23: a publish that failed AFTER the playlist row was created
// (here: the screen-copy step refusing the files) left the wizard on Review
// with "Create Playlist" enabled; every retry POSTed another identical
// playlist. The saved playlist must be handed back instead.
describe('a failed publish never invites a duplicate', () => {
  it('hands the saved playlist to onCreated when schedules fail', async () => {
    createScheduleSpy.mockRejectedValueOnce(new Error('These files can\'t be prepared for 1080p screens'));
    const onCreated = jest.fn();
    render(
      <PlaylistCreateWizard open onClose={() => {}} onCreated={onCreated} playlists={PLAYLISTS} allSchedules={[]} />,
    );
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
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-new' })));
  });
});
