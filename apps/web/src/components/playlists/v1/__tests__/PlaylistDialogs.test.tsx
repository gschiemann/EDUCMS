/**
 * The two dialogs, MOUNTED — the coverage whose absence Greg found for me.
 *
 * The negative control on 6f89395a said it plainly: replacing the route's
 * handleAddScreens with a no-op still passed all 190 tests, because nothing
 * asserted either dialog actually opens. Greg then reported exactly that
 * failure on the live deploy ("cant click any of the buttons"). A render-time
 * throw inside these components is invisible to every other suite.
 *
 * So these render them OPEN and assert real, operator-visible content.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor } from '@testing-library/react';

// One shared spy per mounted tree, so a test can assert whether the create
// actually fired. `mutation` is re-created per hook call by the factory below,
// so the spy has to live outside it.
const createSpy = jest.fn().mockResolvedValue({ id: 'x' });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  useCreateSchedule: () => ({ mutateAsync: createSpy, isPending: false }),
  useUpdateSchedule: mutation,
}));

// The conflict warning asks through appConfirm. Mocked so a case can make the
// operator say yes or no, and assert what happened either way.
const appConfirmMock = jest.fn().mockResolvedValue(true);
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...args: unknown[]) => appConfirmMock(...args),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));

import { AddScreensDialog, ScheduleDialog, inheritedWindow } from '../PlaylistDialogs';
import type { OpsScheduleRef } from '../playlistOps';

const SCREENS = [
  { id: 's1', name: 'LED Poster 1', status: 'ONLINE', screenGroupId: null },
  { id: 's2', name: 'Lobby North', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's3', name: 'Lobby South', status: 'OFFLINE', screenGroupId: 'g1' },
];
const GROUPS = [{ id: 'g1', name: 'Lobby Wall', screens: [{ id: 's2' }, { id: 's3' }] }];

describe('AddScreensDialog', () => {
  it('renders the picker when open — the wizard step, not a rebuilt one', () => {
    render(
      <AddScreensDialog
        open
        onClose={jest.fn()}
        playlistId="p1"
        screens={SCREENS as never}
        groups={GROUPS as never}
        schedules={[]}
        alreadyScreenIds={new Set()}
        onDone={jest.fn()}
      />,
    );
    expect(rtl.getByRole('dialog', { name: 'Add screens' })).toBeInTheDocument();
    expect(rtl.getByText('Where should it play?')).toBeInTheDocument();
    expect(rtl.getByText('LED Poster 1')).toBeInTheDocument();
    expect(rtl.getByText('Lobby Wall')).toBeInTheDocument();
  });

  it('does not offer a screen the playlist already plays on', () => {
    render(
      <AddScreensDialog
        open
        onClose={jest.fn()}
        playlistId="p1"
        screens={SCREENS as never}
        groups={GROUPS as never}
        schedules={[]}
        alreadyScreenIds={new Set(['s1'])}
        onDone={jest.fn()}
      />,
    );
    expect(rtl.queryByText('LED Poster 1')).not.toBeInTheDocument();
    expect(rtl.getByText('Lobby North')).toBeInTheDocument();
  });

  it('renders nothing when closed — no invisible overlay over the page', () => {
    const { container } = render(
      <AddScreensDialog
        open={false}
        onClose={jest.fn()}
        playlistId="p1"
        screens={SCREENS as never}
        groups={GROUPS as never}
        schedules={[]}
        alreadyScreenIds={new Set()}
        onDone={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

/**
 * The conflict warning — one screen, two playlists.
 *
 * Greg: "the playlist allowed me to add screens that already had an active
 * playlist...it needs to warn that those screens have an active playlist and if
 * i agree it disables those screens in the other playlist."
 *
 * These cases exist because of the negative control: disabling the warning
 * outright left all ten of the tests above green. A warning nothing asserts is
 * the 6f89395a hole again — it typechecks, it ships, and the operator finds it.
 */
describe('AddScreensDialog — the conflict warning', () => {
  const OTHER_PLAYLISTS = [
    { id: 'p1', name: 'Fall Assembly' },
    { id: 'p2', name: 'Kings Portrait' },
  ];
  // p2 is ACTIVE on s1 — the screen we are about to take.
  const LIVE_ELSEWHERE = [
    { id: 'sc-other', playlistId: 'p2', screenId: 's1', isActive: true },
  ] as unknown as OpsScheduleRef[];

  type DialogProps = React.ComponentProps<typeof AddScreensDialog>;
  const renderDialog = (over: Partial<DialogProps> = {}) =>
    render(
      <AddScreensDialog
        open
        onClose={jest.fn()}
        playlistId="p1"
        playlistName="Fall Assembly"
        screens={SCREENS as never}
        groups={GROUPS as never}
        schedules={[]}
        alreadyScreenIds={new Set()}
        onDone={jest.fn()}
        {...over}
      />,
    );

  const pickAndAdd = async () => {
    fireEvent.click(rtl.getByText('LED Poster 1'));           // = s1
    fireEvent.click(rtl.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(appConfirmMock).toHaveBeenCalled());
  };

  beforeEach(() => {
    createSpy.mockClear();
    appConfirmMock.mockClear();
    appConfirmMock.mockResolvedValue(true);
  });

  it('warns, naming the other playlist and the screen it will be replaced on', async () => {
    renderDialog({ playlists: OTHER_PLAYLISTS, allSchedules: LIVE_ELSEWHERE });
    await pickAndAdd();

    const arg = appConfirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; tone: string };
    expect(arg.title).toBe('Replace on 1 screen?');
    expect(arg.message).toContain('“Kings Portrait” is currently playing on LED Poster 1');
    expect(arg.message).toContain('Adding that screen to “Fall Assembly”');
    expect(arg.message).toContain('its other screens stay untouched');
    expect(arg.confirmLabel).toBe('Replace');
    expect(arg.tone).toBe('warn');
  });

  it('REFUSING adds nothing — the rules are never created', async () => {
    appConfirmMock.mockResolvedValue(false);
    renderDialog({ playlists: OTHER_PLAYLISTS, allSchedules: LIVE_ELSEWHERE });
    await pickAndAdd();
    await waitFor(() => expect(createSpy).not.toHaveBeenCalled());
  });

  it('agreeing proceeds — the server then displaces, this client does not', async () => {
    renderDialog({ playlists: OTHER_PLAYLISTS, allSchedules: LIVE_ELSEWHERE });
    await pickAndAdd();
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    // mode:'replace' + isActive:true is what makes the API displace the
    // competing rule. If this ever changes, the warning starts lying.
    expect(createSpy.mock.calls[0][0]).toMatchObject({ mode: 'replace', isActive: true, screenId: 's1' });
  });

  it('no conflict → no prompt at all, it just adds', async () => {
    renderDialog({ playlists: OTHER_PLAYLISTS, allSchedules: [] });
    fireEvent.click(rtl.getByText('LED Poster 1'));
    fireEvent.click(rtl.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
  });

  it('a PAUSED rule elsewhere is not a conflict', async () => {
    renderDialog({
      playlists: OTHER_PLAYLISTS,
      allSchedules: [{ id: 'sc-off', playlistId: 'p2', screenId: 's1', isActive: false }] as unknown as OpsScheduleRef[],
    });
    fireEvent.click(rtl.getByText('LED Poster 1'));
    fireEvent.click(rtl.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
  });

  it('without the playlist lists it adds silently rather than warning wrongly', async () => {
    renderDialog();                                  // no playlists, no allSchedules
    fireEvent.click(rtl.getByText('LED Poster 1'));
    fireEvent.click(rtl.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(appConfirmMock).not.toHaveBeenCalled();
  });
});

describe('ScheduleDialog', () => {
  it('renders the publishing step when open', () => {
    render(
      <ScheduleDialog
        open
        onClose={jest.fn()}
        playlistId="p1"
        schedule={null}
        targetCount={1}
        addTargets={{ screenIds: ['s1'], groupIds: [] }}
        onDone={jest.fn()}
      />,
    );
    expect(rtl.getByRole('dialog', { name: 'Add schedule' })).toBeInTheDocument();
    expect(rtl.getByText('Activate immediately')).toBeInTheDocument();
    expect(rtl.getByText('Schedule a window')).toBeInTheDocument();
  });

  it('an existing windowed rule opens on its own days and times', () => {
    const sched = {
      id: 'sc1', playlistId: 'p1', daysOfWeek: 'Mon,Wed', timeStart: '09:00', timeEnd: '17:00',
    } as OpsScheduleRef;
    render(
      <ScheduleDialog
        open
        onClose={jest.fn()}
        playlistId="p1"
        schedule={sched}
        targetCount={1}
        addTargets={{ screenIds: [], groupIds: [] }}
        onDone={jest.fn()}
      />,
    );
    expect(rtl.getByRole('dialog', { name: 'Edit schedule' })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Mon', pressed: true })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Wed', pressed: true })).toBeInTheDocument();
  });

  it('says so instead of failing when the playlist has no screens yet', () => {
    render(
      <ScheduleDialog
        open
        onClose={jest.fn()}
        playlistId="p1"
        schedule={null}
        targetCount={0}
        addTargets={{ screenIds: [], groupIds: [] }}
        onDone={jest.fn()}
      />,
    );
    expect(rtl.getByText(/not on a screen yet/i)).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ScheduleDialog
        open={false}
        onClose={jest.fn()}
        playlistId="p1"
        schedule={null}
        targetCount={1}
        addTargets={{ screenIds: ['s1'], groupIds: [] }}
        onDone={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('inheritedWindow', () => {
  const w = (d: string | null, a: string | null, b: string | null) =>
    ({ id: 'x', playlistId: 'p', daysOfWeek: d, timeStart: a, timeEnd: b }) as OpsScheduleRef;

  it('copies the window when every rule agrees', () => {
    expect(inheritedWindow([w('Mon,Tue', '08:00', '15:00'), w('Mon,Tue', '08:00', '15:00')]))
      .toEqual({ daysOfWeek: 'Mon,Tue', timeStart: '08:00', timeEnd: '15:00' });
  });

  it('falls back to always-on when they disagree — never a guessed window', () => {
    expect(inheritedWindow([w('Mon', '08:00', '15:00'), w('Tue', '09:00', '17:00')])).toEqual({});
  });

  it('an always-on playlist stays always-on', () => {
    expect(inheritedWindow([w(null, null, null)])).toEqual({});
  });
});
