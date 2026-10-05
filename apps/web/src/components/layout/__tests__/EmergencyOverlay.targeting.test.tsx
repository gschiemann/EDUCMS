/**
 * The dashboard emergency overlay with several live alerts (2026-10-05).
 *
 *   • every live alert is listed with its target — "Lockdown — Gym group,
 *     6 screens" — separately;
 *   • the all-clear ends EXACTLY the chosen alert: its id and its scope go to
 *     the server action, the typed CLEAR gate is unchanged;
 *   • a failed all-clear keeps the lock up and says so (the old overlay
 *     ignored the action's failure result and closed anyway).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const allClearEmergency = jest.fn();
jest.mock('@/actions/trigger-emergency', () => ({
  broadcastEmergency: jest.fn(),
  allClearEmergency: (...args: unknown[]) => allClearEmergency(...args),
}));
const fetchActiveAlerts = jest.fn();
jest.mock('@/lib/emergency-api', () => ({
  fetchActiveAlerts: (...args: unknown[]) => fetchActiveAlerts(...args),
  fetchEmergencyTargets: jest.fn(async () => ({ tenantId: 't1', tenantName: null, allScreensCount: 0, groups: [], screens: [] })),
}));
jest.mock('@/hooks/use-api', () => ({
  useTenantStatus: () => ({ data: { emergencyStatus: 'INACTIVE', emergencyScopedAlertActive: true } }),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { EmergencyOverlay } from '@/components/layout/EmergencyOverlay';
import { useUIStore } from '@/store/ui-store';

const GYM = {
  alertId: 'ovr_gym', scopeType: 'group', scopeId: 'g-gym', targetName: 'Gym', tenantId: 't1', tenantName: null,
  type: 'LOCKDOWN', severity: 'CRITICAL', screenCount: 6, showingCount: 6, triggeredAt: '2026-10-05T10:00:00Z',
};
const LOBBY = {
  alertId: 'ovr_lobby', scopeType: 'device', scopeId: 's-lobby', targetName: 'Lobby', tenantId: 't1', tenantName: null,
  type: 'MEDICAL', severity: 'CRITICAL', screenCount: 1, showingCount: 1, triggeredAt: '2026-10-05T10:01:00Z',
};

async function renderOverlay() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <EmergencyOverlay />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  allClearEmergency.mockReset();
  fetchActiveAlerts.mockReset();
  useUIStore.setState({
    token: 'tok',
    user: { id: 'u1', email: 'a@b.test', role: 'SCHOOL_ADMIN', tenantId: 't1' } as any,
    isEmergencyActive: true,
    activeEmergencyOverrideId: null,
  });
});

describe('EmergencyOverlay — several alerts, each with its own all-clear', () => {
  it('lists every live alert with its target and ends exactly the chosen one', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([GYM, LOBBY]).mockResolvedValue([LOBBY]);
    allClearEmergency.mockResolvedValue({ success: true });
    await renderOverlay();

    const list = await screen.findByTestId('emergency-active-alerts');
    expect(list).toHaveTextContent('Lockdown — Gym group, 6 screens');
    expect(list).toHaveTextContent('Medical — Lobby, 1 screen');
    // Scoped alerts only: the copy does not claim every screen is locked.
    expect(screen.getByText('Some screens are showing an emergency alert. The others play their normal schedule.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Lockdown — Gym group, 6 screens/ }));
    expect(screen.getByTestId('emergency-overlay-ending')).toHaveTextContent('Ending: Lockdown — Gym group, 6 screens');
    fireEvent.change(screen.getByPlaceholderText('Type CLEAR'), { target: { value: 'clear' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Terminate Emergency/ }));
    });

    expect(allClearEmergency).toHaveBeenCalledWith(
      expect.objectContaining({ overrideId: 'ovr_gym', scopeType: 'group', scopeId: 'g-gym', schoolId: 't1', token: 'tok' }),
    );
    // Another alert is still live → the lock stays up.
    expect(useUIStore.getState().isEmergencyActive).toBe(true);
  });

  it('one alert is simply THE alert — no choice needed', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOBBY]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByText('Medical — Lobby, 1 screen');

    fireEvent.change(screen.getByPlaceholderText('Type CLEAR'), { target: { value: 'CLEAR' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Terminate Emergency/ }));
    });
    expect(allClearEmergency).toHaveBeenCalledWith(
      expect.objectContaining({ overrideId: 'ovr_lobby', scopeType: 'device', scopeId: 's-lobby' }),
    );
    // Nothing left → the lock comes down.
    await waitFor(() => expect(useUIStore.getState().isEmergencyActive).toBe(false));
  });

  it('a FAILED all-clear keeps the lock up and says the alert is still on screens', async () => {
    fetchActiveAlerts.mockResolvedValue([LOBBY]);
    allClearEmergency.mockResolvedValue({ success: false, error: 'All clear failed: 500' });
    await renderOverlay();
    await screen.findByText('Medical — Lobby, 1 screen');

    fireEvent.change(screen.getByPlaceholderText('Type CLEAR'), { target: { value: 'CLEAR' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Terminate Emergency/ }));
    });
    expect(
      await screen.findByText(/All-clear was NOT sent — the alert is still on screens\. All clear failed: 500/),
    ).toBeInTheDocument();
    expect(useUIStore.getState().isEmergencyActive).toBe(true);
  });

  it('the CLEAR gate is unchanged: nothing is sent until CLEAR is typed', async () => {
    fetchActiveAlerts.mockResolvedValue([LOBBY]);
    await renderOverlay();
    await screen.findByText('Medical — Lobby, 1 screen');
    expect(screen.getByRole('button', { name: /Terminate Emergency/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Type CLEAR'), { target: { value: 'CLEA' } });
    expect(screen.getByRole('button', { name: /Terminate Emergency/ })).toBeDisabled();
    expect(allClearEmergency).not.toHaveBeenCalled();
  });
});
