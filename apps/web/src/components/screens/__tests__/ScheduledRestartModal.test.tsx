/**
 * Render-level proof that the scheduled restart sheet says what is true:
 * which screens cannot restart (all of today's fleet), the last result per
 * screen — including "Didn't come back after its scheduled restart" — that a
 * daytime time cannot be saved, that Off clears the policy, and that the
 * kill switch disables the save.
 */
import * as React from 'react';
import { fireEvent, render, screen as rtl, waitFor } from '@testing-library/react';

import en from '@/i18n/messages/en.json';
import { ScheduledRestartModal, describeRun } from '../ScheduledRestartModal';

const COPY = en.scheduledRestart as unknown as Record<string, string>;

let state: any = null;
const setMock = jest.fn(async (body: Record<string, unknown>) => ({ id: 'p1', ...body }));
const clearMock = jest.fn(async () => ({ success: true }));

jest.mock('@/hooks/use-scheduled-restarts', () => {
  const actual = jest.requireActual('@/hooks/use-scheduled-restarts');
  return {
    ...actual,
    useGroupScheduledRestart: () => ({ data: state, isLoading: false, isError: false }),
    useSetGroupScheduledRestart: () => ({ mutateAsync: setMock, isPending: false }),
    useClearGroupScheduledRestart: () => ({ mutateAsync: clearMock, isPending: false }),
  };
});
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

const target = { id: 'g1', name: 'North gym' };
const screenRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Lobby',
  hardwareClass: 'goodview-guq',
  canRestart: false,
  restartedRecently: false,
  lastRun: null,
  ...over,
});

beforeEach(() => {
  setMock.mockClear();
  clearMock.mockClear();
  state = { disabled: false, policy: null, screens: [screenRow()] };
});

describe('ScheduledRestartModal', () => {
  it('says out loud that no screen can restart remotely yet', () => {
    render(<ScheduledRestartModal target={target} onClose={() => {}} />);
    expect(rtl.getByTestId('scheduled-restart-cannot').textContent).toBe(COPY.noneCanRestart);
    expect(rtl.getByText(new RegExp(COPY.cannotRestart))).toBeTruthy();
  });

  it('shows "Didn\'t come back after its scheduled restart" for a NOT_BACK run', () => {
    state.screens = [screenRow({ canRestart: true, lastRun: { status: 'NOT_BACK', reason: null, scheduledFor: '2026-11-10T09:00:00Z', dispatchedAt: '2026-11-10T09:05:00Z', returnedAt: null, restartProven: false } })];
    render(<ScheduledRestartModal target={target} onClose={() => {}} />);
    expect(rtl.getByText(COPY.lastNotBack)).toBeTruthy();
    expect(rtl.queryByTestId('scheduled-restart-cannot')).toBeNull();
  });

  it('saves a nightly restart', async () => {
    render(<ScheduledRestartModal target={target} onClose={() => {}} />);
    fireEvent.click(rtl.getByRole('radio', { name: COPY.modeDaily }));
    fireEvent.click(rtl.getByTestId('scheduled-restart-save'));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ cadence: 'DAILY', dayOfWeek: null, time: '03:00', isActive: true }));
    expect(rtl.getByRole('status').textContent).toContain('every night at');
  });

  it('Off clears the policy', async () => {
    state.policy = { id: 'p1', cadence: 'DAILY', dayOfWeek: null, time: '23:00', isActive: true };
    render(<ScheduledRestartModal target={target} onClose={() => {}} />);
    fireEvent.click(rtl.getByRole('radio', { name: COPY.modeOff }));
    fireEvent.click(rtl.getByTestId('scheduled-restart-save'));
    await waitFor(() => expect(clearMock).toHaveBeenCalled());
    expect(rtl.getByRole('status').textContent).toBe(COPY.savedOff);
  });

  it('the kill switch disables saving and says why', () => {
    state.disabled = true;
    render(<ScheduledRestartModal target={target} onClose={() => {}} />);
    expect(rtl.getByTestId('scheduled-restart-disabled').textContent).toBe(COPY.disabled);
    expect((rtl.getByTestId('scheduled-restart-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('read-only people cannot save', () => {
    render(<ScheduledRestartModal target={target} readOnly onClose={() => {}} />);
    expect((rtl.getByTestId('scheduled-restart-save') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('describeRun', () => {
  const t = (key: string, values?: Record<string, string>) => {
    const raw = key.split('.').reduce<any>((n, k) => n?.[k], COPY) as string;
    return Object.entries(values ?? {}).reduce((s, [k, v]) => s.replace(`{${k}}`, v), raw);
  };
  it('names the skip reason', () => {
    expect(describeRun({ status: 'SKIPPED', reason: 'cannot-restart', scheduledFor: '', dispatchedAt: null, returnedAt: null, restartProven: false }, t, 'en').text)
      .toBe('Skipped: can\'t restart remotely');
  });
  it('an unknown reason never leaks a raw code', () => {
    expect(describeRun({ status: 'WAITING', reason: 'weird', scheduledFor: '', dispatchedAt: null, returnedAt: null, restartProven: false }, t, 'en').text)
      .toBe('Waiting: unknown reason');
  });
  it('a proven return is success', () => {
    expect(describeRun({ status: 'BACK', reason: null, scheduledFor: '', dispatchedAt: null, returnedAt: '2026-11-10T09:07:00Z', restartProven: true }, t, 'en').tone).toBe('success');
  });
});
