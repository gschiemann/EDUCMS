/**
 * The dashboard trigger modal — LIVE | DRILL (2026-10-10).
 *
 * The lead's rules, proven on the real component:
 *   1. the modal opens in LIVE every time, and the live flow sends EXACTLY the
 *      pre-drill arguments (no `isDrill` key) — the targeting suite's own
 *      assertion, re-stated here because this is the file that could break it;
 *   2. DRILL visibly changes the surface (title, badge, confirm sentence, the
 *      fire button says Start Drill) and adds `isDrill: true` to the request —
 *      and NOTHING else: same type grid, same typed confirm word;
 *   3. a drill chosen in one open is forgotten by the next.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const broadcastEmergency = jest.fn();
jest.mock('@/actions/trigger-emergency', () => ({
  broadcastEmergency: (...args: unknown[]) => broadcastEmergency(...args),
  allClearEmergency: jest.fn(),
}));
jest.mock('@/lib/emergency-api', () => ({
  fetchEmergencyTargets: jest.fn(async () => ({
    tenantId: 't1', tenantName: 'Lincoln High', allScreensCount: 24, groups: [], screens: [],
  })),
  fetchActiveAlerts: jest.fn(async () => []),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { EmergencyTriggerModal } from '@/components/emergency/EmergencyTriggerModal';
import { useUIStore } from '@/store/ui-store';

async function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = jest.fn();
  const utils = await act(async () =>
    render(
      <QueryClientProvider client={qc}>
        <EmergencyTriggerModal onClose={onClose} />
      </QueryClientProvider>,
    ),
  );
  await waitFor(() => expect(screen.getByTestId('emergency-target-label')).toHaveTextContent('All screens (24)'));
  return { onClose, ...utils };
}

beforeEach(() => {
  broadcastEmergency.mockReset();
  broadcastEmergency.mockResolvedValue({ success: true, overrideId: 'ovr_1' });
  useUIStore.setState({
    token: 'tok',
    user: { id: 'u1', email: 'a@b.test', role: 'SCHOOL_ADMIN', tenantId: 't1' } as any,
    isEmergencyActive: false,
    activeEmergencyOverrideId: null,
  });
});

describe('EmergencyTriggerModal — LIVE | DRILL', () => {
  it('opens in LIVE: red title, no drill badge, and the live request has no isDrill key', async () => {
    await renderModal();
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'live');
    expect(screen.getByTestId('emergency-modal-title')).toHaveTextContent('Trigger Emergency');
    expect(screen.queryByTestId('emergency-drill-badge')).toBeNull();
    expect(screen.getByTestId('emergency-fire')).toHaveAttribute('data-mode', 'live');

    fireEvent.click(screen.getByRole('button', { name: /^Lockdown/ }));
    fireEvent.change(screen.getByPlaceholderText('LOCKDOWN'), { target: { value: 'lockdown' } });
    expect(screen.getByTestId('emergency-confirm-summary')).toHaveTextContent('This will immediately send Lockdown on all 24 screens.');
    await act(async () => {
      fireEvent.click(screen.getByTestId('emergency-fire'));
    });
    expect(broadcastEmergency.mock.calls[0][0]).toEqual({ schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', token: 'tok' });
  });

  it('DRILL changes the words and the colour, keeps the ceremony, and adds exactly isDrill: true', async () => {
    const { onClose } = await renderModal();
    fireEvent.click(screen.getByTestId('emergency-mode-drill'));
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'drill');
    expect(screen.getByTestId('emergency-modal-title')).toHaveTextContent('Start a Drill');
    expect(screen.getByTestId('emergency-drill-badge')).toHaveTextContent('DRILL MODE');
    expect(screen.getByTestId('emergency-fire')).toHaveAttribute('data-mode', 'drill');
    expect(screen.getByTestId('emergency-fire')).toHaveTextContent('Start Drill');
    // not red
    expect(screen.getByTestId('emergency-fire').getAttribute('style')).not.toMatch(/#ef4444/);

    // same six types, same confirm word
    fireEvent.click(screen.getByRole('button', { name: /^Lockdown/ }));
    const input = screen.getByPlaceholderText('LOCKDOWN');
    expect(screen.getByTestId('emergency-confirm-summary')).toHaveTextContent('This will immediately start a DRILL: Lockdown on all 24 screens.');
    // the fire button stays locked until the word is typed — same gate as live
    expect(screen.getByTestId('emergency-fire')).toBeDisabled();
    fireEvent.change(input, { target: { value: 'lockdown' } });
    expect(screen.getByTestId('emergency-fire')).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('emergency-fire'));
    });
    expect(broadcastEmergency).toHaveBeenCalledTimes(1);
    expect(broadcastEmergency.mock.calls[0][0]).toEqual({
      schoolId: 't1', type: 'lockdown', triggeredBy: 'u1', token: 'tok', isDrill: true,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('a drill refused over a live alert is shown in plain words, and nothing flips locally', async () => {
    broadcastEmergency.mockResolvedValue({
      success: false,
      code: 'EMERGENCY_DRILL_BLOCKED_BY_LIVE_ALERT',
      error: 'Emergency broadcast failed: 409 — A live emergency alert is active. End the live alert first — a drill never replaces a real emergency.',
    });
    await renderModal();
    fireEvent.click(screen.getByTestId('emergency-mode-drill'));
    fireEvent.click(screen.getByRole('button', { name: /^Hold/ }));
    fireEvent.change(screen.getByPlaceholderText('HOLD'), { target: { value: 'hold' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('emergency-fire'));
    });
    // The banner AND the screen-reader live region both carry the reason.
    expect(screen.getAllByText(/a drill never replaces a real emergency/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Emergency dispatch FAILED — alert was NOT sent to screens.')).toBeInTheDocument();
    expect(useUIStore.getState().isEmergencyActive).toBe(false);
  });

  it('a drill chosen in one open is forgotten by the next open', async () => {
    const first = await renderModal();
    fireEvent.click(screen.getByTestId('emergency-mode-drill'));
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'drill');
    first.unmount();
    await renderModal();
    expect(screen.getByTestId('emergency-mode-switch')).toHaveAttribute('data-mode', 'live');
    expect(screen.getByTestId('emergency-modal-title')).toHaveTextContent('Trigger Emergency');
  });
});
