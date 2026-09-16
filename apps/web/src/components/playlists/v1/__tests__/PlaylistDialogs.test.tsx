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
import { render, screen as rtl } from '@testing-library/react';

const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  useCreateSchedule: mutation,
  useUpdateSchedule: mutation,
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
