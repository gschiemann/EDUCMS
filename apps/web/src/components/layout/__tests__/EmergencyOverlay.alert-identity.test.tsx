/**
 * EMG-01 (2026-11-21) — the dashboard overlay names the tenant-wide alert it
 * is ending, and handles the server's refusal when that alert was replaced.
 *
 *   • the all-clear sends the tenant-wide alert's REAL id (from the active
 *     list; with the list down, from GET /tenants) — not a stale id from this
 *     browser's store;
 *   • a 409 ALERT_CHANGED says in plain words that a newer alert of type X is
 *     active and that nothing was cleared, keeps the lock up, re-reads the
 *     list and asks for a fresh CLEAR — which then ends the CURRENT alert by
 *     its own id;
 *   • if the list refreshes to a different alert while CLEAR is typed, the
 *     typed CLEAR does not carry over to it.
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
let mockTenant: Record<string, unknown> = { emergencyStatus: 'CRITICAL', emergencyIsDrill: false };
jest.mock('@/hooks/use-api', () => ({
  useTenantStatus: () => ({ data: mockTenant }),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { EmergencyOverlay } from '@/components/layout/EmergencyOverlay';
import { useUIStore } from '@/store/ui-store';

const tenantAlert = (alertId: string | null, type: string) => ({
  alertId, scopeType: 'tenant', scopeId: 't1', targetName: 'Lincoln High', tenantId: 't1', tenantName: 'Lincoln High',
  type, severity: 'CRITICAL', isDrill: false, screenCount: 24, showingCount: null, triggeredAt: '2026-11-21T10:00:00.000Z',
});
const HOLD = tenantAlert('ovr_hold', 'HOLD');
const LOCKDOWN = tenantAlert('ovr_lockdown', 'LOCKDOWN');

let qc: QueryClient;
async function renderOverlay() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <EmergencyOverlay />
      </QueryClientProvider>,
    );
  });
}

const typeClear = () => fireEvent.change(screen.getByPlaceholderText('Type CLEAR'), { target: { value: 'clear' } });
const terminate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('emergency-overlay-terminate'));
  });
};

beforeEach(() => {
  allClearEmergency.mockReset();
  fetchActiveAlerts.mockReset();
  mockTenant = { emergencyStatus: 'CRITICAL', emergencyIsDrill: false };
  useUIStore.setState({
    token: 'tok',
    user: { id: 'u1', email: 'a@b.test', role: 'SCHOOL_ADMIN', tenantId: 't1' } as never,
    isEmergencyActive: true,
    // This browser sent a Hold earlier; another operator has since escalated.
    activeEmergencyOverrideId: 'ovr_hold',
  });
});

describe('EmergencyOverlay — the tenant-wide alert’s identity (EMG-01)', () => {
  it('ends the tenant-wide alert by the id the server lists, not the one this browser remembers', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenCalledWith(
      expect.objectContaining({ overrideId: 'ovr_lockdown', scopeType: 'tenant', scopeId: 't1' }),
    );
  });

  it('a 409 ALERT_CHANGED says a newer alert is active, clears nothing locally, and the next CLEAR ends the CURRENT alert', async () => {
    // The list still shows the Hold when the operator confirms; the server
    // already holds the Lockdown.
    fetchActiveAlerts.mockResolvedValueOnce([HOLD]).mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency
      .mockResolvedValueOnce({ success: false, error: 'All clear failed: 409', code: 'ALERT_CHANGED', currentAlertType: 'LOCKDOWN' })
      .mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();

    expect(allClearEmergency).toHaveBeenNthCalledWith(1, expect.objectContaining({ overrideId: 'ovr_hold' }));
    // Plain words, naming the alert that is live now.
    const alert = await screen.findByText(/Nothing was cleared: a newer alert is now active \(Lockdown\)/);
    expect(alert).toHaveAttribute('role', 'alert');
    // The lock stays up and the typed CLEAR is gone: a fresh confirmation is needed.
    expect(useUIStore.getState().isEmergencyActive).toBe(true);
    expect(screen.getByTestId('emergency-overlay')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type CLEAR')).toHaveValue('');
    expect(screen.getByTestId('emergency-overlay-terminate')).toBeDisabled();
    // The list was re-read and now shows the Lockdown for review.
    await waitFor(() => expect(screen.getByTestId('emergency-active-alerts')).toHaveTextContent('Lockdown'));
    expect(fetchActiveAlerts.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The operator confirms again — this time for the Lockdown, by its own id.
    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenNthCalledWith(2, expect.objectContaining({ overrideId: 'ovr_lockdown', scopeType: 'tenant' }));
  });

  it('a typed CLEAR does not carry over when the list refreshes to a different alert', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([HOLD]).mockResolvedValue([LOCKDOWN]);
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    expect(screen.getByTestId('emergency-overlay-terminate')).not.toBeDisabled();

    await act(async () => {
      await qc.refetchQueries({ queryKey: ['emergency-active'] });
    });

    await waitFor(() => expect(screen.getByTestId('emergency-active-alerts')).toHaveTextContent('Lockdown'));
    expect(screen.getByPlaceholderText('Type CLEAR')).toHaveValue('');
    expect(screen.getByTestId('emergency-overlay-terminate')).toBeDisabled();
    expect(screen.getByText(/a newer alert is now active \(Lockdown\)/)).toBeInTheDocument();
    expect(allClearEmergency).not.toHaveBeenCalled();
  });

  it('with the alert list down, names the alert GET /tenants reports (not this browser’s remembered id)', async () => {
    fetchActiveAlerts.mockRejectedValue(new Error('/emergency/active failed: 503'));
    mockTenant = { emergencyStatus: 'CRITICAL', emergencyIsDrill: false, emergencyAlertId: 'ovr_lockdown' };
    allClearEmergency.mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByText(/Couldn’t load the list of alerts/);
    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenCalledWith(expect.objectContaining({ overrideId: 'ovr_lockdown', schoolId: 't1' }));
  });

  it('an alert from before alert identity (no id anywhere) still clears with the remembered id, as before', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([tenantAlert(null, 'HOLD')]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenCalledWith(expect.objectContaining({ overrideId: 'ovr_hold', scopeType: 'tenant' }));
  });
});
