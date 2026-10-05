/**
 * The dashboard trigger modal — alert targeting (2026-10-05).
 *
 * The owner's rule: "All screens needs to be on by default and needs to be
 * easy to use." So this proves, on the real component:
 *   1. the target is All screens (with its count) before anyone touches it;
 *   2. the default flow — pick type, type the word, fire — calls the server
 *      action with EXACTLY the arguments it always had (no `target` key);
 *   3. "Choose screens" → one screen changes the confirmation sentence and
 *      the request, and nothing else about the flow;
 *   4. a failed screen list never blocks All screens.
 * The typed confirm word is untouched in every case.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const broadcastEmergency = jest.fn();
jest.mock('@/actions/trigger-emergency', () => ({
  broadcastEmergency: (...args: unknown[]) => broadcastEmergency(...args),
  allClearEmergency: jest.fn(),
}));
const fetchEmergencyTargets = jest.fn();
jest.mock('@/lib/emergency-api', () => ({
  fetchEmergencyTargets: (...args: unknown[]) => fetchEmergencyTargets(...args),
  fetchActiveAlerts: jest.fn(async () => []),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { EmergencyTriggerModal } from '@/components/emergency/EmergencyTriggerModal';
import { useUIStore } from '@/store/ui-store';

const TARGETS = {
  tenantId: 't1',
  tenantName: 'Lincoln High',
  allScreensCount: 24,
  groups: [{ id: 'g-gym', name: 'Gym', tenantId: 't1', tenantName: 'Lincoln High', screenCount: 6 }],
  screens: [
    { id: 's-lobby', name: 'Lobby', location: 'Main entrance', online: true, groupId: null, groupName: null, tenantId: 't1', tenantName: 'Lincoln High', displayScreenCount: 1 },
    { id: 's-gym-1', name: 'Gym east', location: null, online: false, groupId: 'g-gym', groupName: 'Gym', tenantId: 't1', tenantName: 'Lincoln High', displayScreenCount: 1 },
  ],
};

async function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = jest.fn();
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <EmergencyTriggerModal onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  return { onClose };
}

async function pickLockdownAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: /^Lockdown/ }));
  fireEvent.change(screen.getByPlaceholderText('LOCKDOWN'), { target: { value: 'lockdown' } });
}

beforeEach(() => {
  broadcastEmergency.mockReset();
  broadcastEmergency.mockResolvedValue({ success: true, overrideId: 'ovr_1' });
  fetchEmergencyTargets.mockReset();
  fetchEmergencyTargets.mockResolvedValue(TARGETS);
  useUIStore.setState({
    token: 'tok',
    user: { id: 'u1', email: 'a@b.test', role: 'SCHOOL_ADMIN', tenantId: 't1' } as any,
    isEmergencyActive: false,
    activeEmergencyOverrideId: null,
  });
});

describe('EmergencyTriggerModal — where the alert goes', () => {
  it('defaults to All screens, with the count, before anyone touches it', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)'));
    expect(screen.getByTestId('emergency-choose-screens')).toHaveTextContent('Choose screens');
  });

  it('the default flow sends EXACTLY the pre-targeting arguments and says "all 24 screens"', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)'));
    await pickLockdownAndConfirm();
    expect(screen.getByTestId('emergency-confirm-summary')).toHaveTextContent(
      'This will immediately send Lockdown on all 24 screens.',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Trigger Emergency$/ }));
    });
    expect(broadcastEmergency).toHaveBeenCalledTimes(1);
    // No `target` key at all — the identical call the modal always made.
    expect(broadcastEmergency.mock.calls[0][0]).toEqual({
      schoolId: 't1',
      type: 'lockdown',
      triggeredBy: 'u1',
      token: 'tok',
    });
  });

  it('choosing ONE screen changes the confirmation and the request — and nothing else', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)'));

    fireEvent.click(screen.getByTestId('emergency-choose-screens'));
    const picker = screen.getByTestId('emergency-target-picker');
    expect(picker).toHaveTextContent('Groups');
    expect(picker).toHaveTextContent('Gym group');
    expect(picker).toHaveTextContent('6 screens');
    expect(picker).toHaveTextContent('Screens');
    expect(picker).toHaveTextContent('Online');
    expect(picker).toHaveTextContent('Offline');
    fireEvent.click(screen.getByTestId('target-option-screen-s-lobby'));

    expect(screen.queryByTestId('emergency-target-picker')).toBeNull();
    expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('Lobby · 1 screen');

    await pickLockdownAndConfirm();
    expect(screen.getByTestId('emergency-confirm-summary')).toHaveTextContent(
      'This will immediately send Lockdown on 1 screen — Lobby.',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Trigger Emergency$/ }));
    });
    expect(broadcastEmergency.mock.calls[0][0]).toEqual({
      schoolId: 't1',
      type: 'lockdown',
      triggeredBy: 'u1',
      token: 'tok',
      target: { scopeType: 'device', scopeId: 's-lobby' },
    });
  });

  it('a group is one tap too, and one tap puts it back to All screens', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)'));
    fireEvent.click(screen.getByTestId('emergency-choose-screens'));
    fireEvent.click(screen.getByTestId('target-option-group-g-gym'));
    expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('Gym group · 6 screens');

    fireEvent.click(screen.getByTestId('emergency-target-reset'));
    expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)');
  });

  it('the picker search narrows both lists', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)'));
    fireEvent.click(screen.getByTestId('emergency-choose-screens'));
    fireEvent.change(screen.getByPlaceholderText('Search groups and screens'), { target: { value: 'lobby' } });
    expect(screen.getByTestId('target-option-screen-s-lobby')).toBeInTheDocument();
    expect(screen.queryByTestId('target-option-screen-s-gym-1')).toBeNull();
    expect(screen.queryByTestId('target-option-group-g-gym')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search groups and screens'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('emergency-target-picker')).toHaveTextContent('No groups or screens match “zzz”.');
  });

  it('a screen list that fails to load never blocks All screens', async () => {
    fetchEmergencyTargets.mockRejectedValue(new Error('offline'));
    await renderModal();
    await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens'));
    fireEvent.click(screen.getByTestId('emergency-choose-screens'));
    await waitFor(() =>
      expect(screen.getByTestId('emergency-target-picker')).toHaveTextContent('Couldn’t load your screens.'),
    );
    fireEvent.click(screen.getByTestId('target-option-all'));

    await pickLockdownAndConfirm();
    expect(screen.getByTestId('emergency-confirm-summary')).toHaveTextContent('Lockdown on all screens');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Trigger Emergency$/ }));
    });
    expect(broadcastEmergency.mock.calls[0][0]).not.toHaveProperty('target');
  });
});
