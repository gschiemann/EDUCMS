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
 *     typed CLEAR does not carry over to it — and (review round 1) a refresh
 *     with the box empty says nothing, and a picked alert that is simply gone
 *     is not called "a newer alert";
 *   • a 409 that does not carry the newer alert's type still names it, from
 *     the list it re-reads (review round 1);
 *   • review round 2: a 409 whose list re-read FAILS does not loop — the next
 *     fresh CLEAR ends the alert the 409 named; two tenant entries that share
 *     an id never share a key; a district clear that left locations in their
 *     own alert says so in a toast that outlives the overlay.
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
const toastWarning = jest.fn();
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    warning: (...a: unknown[]) => toastWarning(...a),
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  }),
  Toaster: () => null,
}));

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
  toastWarning.mockReset();
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

  it('a refresh to a different alert with NO CLEAR typed says nothing (review round 1)', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([HOLD]).mockResolvedValue([LOCKDOWN]);
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['emergency-active'] });
    });
    await waitFor(() => expect(screen.getByTestId('emergency-active-alerts')).toHaveTextContent('Lockdown'));
    expect(screen.queryByText(/a newer alert is now active/)).toBeNull();
    expect(screen.queryByText(/no longer listed/)).toBeNull();
  });

  it('a picked alert that disappears drops the typed CLEAR without calling the remaining alert newer (review round 1)', async () => {
    const GROUP = {
      ...tenantAlert('ovr_group', 'MEDICAL'),
      scopeType: 'group', scopeId: 'g1', targetName: 'Gym', triggeredAt: '2026-11-21T09:00:00.000Z',
      clearScopeType: 'group', clearScopeId: 'g1',
    };
    fetchActiveAlerts.mockResolvedValueOnce([HOLD, GROUP]).mockResolvedValue([HOLD]);
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    await act(async () => {
      fireEvent.click(screen.getByText(/Gym/));
    });
    typeClear();
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['emergency-active'] });
    });
    await waitFor(() => expect(screen.getByPlaceholderText('Type CLEAR')).toHaveValue(''));
    expect(screen.getByText(/The alert you picked is no longer listed, so nothing was cleared/)).toBeInTheDocument();
    expect(screen.queryByText(/a newer alert is now active/)).toBeNull();
    expect(allClearEmergency).not.toHaveBeenCalled();
  });

  it('a 409 without the newer alert’s type names it from the list it re-reads (review round 1)', async () => {
    // Two alerts after the re-read, so nothing is auto-selected: the type can
    // only come from the re-read list's entry for the same target.
    const GROUP = {
      ...tenantAlert('ovr_group', 'MEDICAL'),
      scopeType: 'group', scopeId: 'g1', targetName: 'Gym', clearScopeType: 'group', clearScopeId: 'g1',
    };
    fetchActiveAlerts.mockResolvedValueOnce([HOLD]).mockResolvedValue([LOCKDOWN, GROUP]);
    allClearEmergency.mockResolvedValueOnce({ success: false, error: 'All clear failed: 409', code: 'ALERT_CHANGED' });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(await screen.findByText(/Nothing was cleared: a newer alert is now active \(Lockdown\)/)).toBeInTheDocument();
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

const LOCKDOWN_409 = {
  success: false,
  error: 'All clear failed: 409',
  code: 'ALERT_CHANGED',
  currentAlertType: 'LOCKDOWN',
  currentAlert: { alertId: 'ovr_lockdown', scopeId: 't1', type: 'LOCKDOWN', isDrill: false },
};

describe('EmergencyOverlay — review round 2', () => {
  it('a 409 whose list re-read FAILS does not loop: the list shows the alert the 409 named, and the next CLEAR ends it by its id', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([HOLD]).mockRejectedValue(new Error('/emergency/active failed: 503'));
    allClearEmergency.mockResolvedValueOnce(LOCKDOWN_409).mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenNthCalledWith(1, expect.objectContaining({ overrideId: 'ovr_hold' }));
    expect(await screen.findByText(/Nothing was cleared: a newer alert is now active \(Lockdown\)/)).toBeInTheDocument();
    // The re-read failed, yet the list no longer offers the replaced Hold.
    await waitFor(() => expect(screen.getByTestId('emergency-active-alerts')).toHaveTextContent('Lockdown'));
    expect(screen.getByTestId('emergency-active-alerts')).not.toHaveTextContent('Hold');

    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ overrideId: 'ovr_lockdown', scopeType: 'tenant', scopeId: 't1' }),
    );
    expect(allClearEmergency.mock.calls[1][0]).not.toHaveProperty('isDrill');
  });

  it('with the alert list down and a stale tenant status, the CLEAR after a 409 names the alert the 409 named', async () => {
    fetchActiveAlerts.mockRejectedValue(new Error('/emergency/active failed: 503'));
    // GET /tenants still reports the Hold (its re-read also fails or lags).
    mockTenant = { emergencyStatus: 'CRITICAL', emergencyIsDrill: false, emergencyAlertId: 'ovr_hold' };
    allClearEmergency.mockResolvedValueOnce(LOCKDOWN_409).mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByText(/Couldn’t load the list of alerts/);
    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenNthCalledWith(1, expect.objectContaining({ overrideId: 'ovr_hold', schoolId: 't1' }));
    expect(await screen.findByText(/Nothing was cleared: a newer alert is now active \(Lockdown\)/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type CLEAR')).toHaveValue('');

    typeClear();
    await terminate();
    expect(allClearEmergency).toHaveBeenNthCalledWith(2, expect.objectContaining({ overrideId: 'ovr_lockdown', schoolId: 't1' }));
  });

  it('two tenant entries that share an id (an older server) are two rows, and picking the second ends the second', async () => {
    const ANNEX = { ...LOCKDOWN, scopeId: 'annex', tenantId: 'annex', targetName: 'Annex', tenantName: 'Annex' };
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN, ANNEX]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await renderOverlay();
      const list = await screen.findByTestId('emergency-active-alerts');
      expect(list.querySelectorAll('li')).toHaveLength(2);
      // React never saw a duplicate key.
      expect(
        consoleError.mock.calls.some((c) => String(c[0]).includes('same key')),
      ).toBe(false);
      // Tenant-wide entries are labelled by type and screen count, so pick
      // the second row by position.
      const rows = list.querySelectorAll('li button');
      await act(async () => {
        fireEvent.click(rows[1]);
      });
      // Only the picked row reads as selected.
      expect(rows[1]).toHaveAttribute('aria-pressed', 'true');
      expect(rows[0]).toHaveAttribute('aria-pressed', 'false');
      typeClear();
      await terminate();
      expect(allClearEmergency).toHaveBeenCalledWith(
        expect.objectContaining({ schoolId: 'annex', scopeId: 'annex', overrideId: 'ovr_lockdown' }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('a district clear that left locations in their own alert says so, in a toast that outlives the overlay', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true, keptTenantIds: ['s1', 's2'], keptListedForCaller: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(String(toastWarning.mock.calls[0][0])).toMatch(/2 locations keep their own alerts/);
    expect(String(toastWarning.mock.calls[0][0])).toMatch(/open Emergency Trigger, where each is listed/);
  });

  // Review round 3 — the count is of ALERTS (the server sends one entry per
  // kept alert), and "where it is listed" is said only to an operator whose
  // own list shows it.
  it('one kept alert reads "1 location", and says where it is listed when the server says this list shows it', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true, keptTenantIds: ['school', 'school'], keptListedForCaller: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    const text = String(toastWarning.mock.calls[0][0]);
    expect(text).toMatch(/1 location keeps its own alert/);
    expect(text).toMatch(/open Emergency Trigger, where it is listed/);
  });

  it('a school admin whose list does not show the kept alert is told who can end it, never that it is listed', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true, keptTenantIds: ['annex'], keptListedForCaller: false });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(toastWarning).toHaveBeenCalledTimes(1);
    const text = String(toastWarning.mock.calls[0][0]);
    expect(text).toMatch(/1 location keeps its own alert/);
    expect(text).toMatch(/It is not in your alert list: that location’s own operators or a district administrator must end it\./);
    expect(text).not.toMatch(/where it is listed/);
  });

  it('a reply without the flag (an older server) gets the wording that claims less', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true, keptTenantIds: ['s1', 's2'] });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    const text = String(toastWarning.mock.calls[0][0]);
    expect(text).toMatch(/2 locations keep their own alerts/);
    expect(text).toMatch(/They are not in your alert list/);
  });

  it('two tenant-wide alerts in the list are each named by their location; one alone reads as before', async () => {
    const SCHOOL_OWN = { ...LOCKDOWN, alertId: 'ovr_school_lockdown', scopeId: 'school', tenantId: 'school', targetName: 'Washington Elementary', tenantName: 'Washington Elementary', screenCount: 6 };
    fetchActiveAlerts.mockResolvedValue([{ ...LOCKDOWN, targetName: 'Lincoln District' }, SCHOOL_OWN]);
    await renderOverlay();
    const list = await screen.findByTestId('emergency-active-alerts');
    expect(list).toHaveTextContent('Lockdown — Lincoln District, 24 screens');
    expect(list).toHaveTextContent('Lockdown — Washington Elementary, 6 screens');
    expect(list).not.toHaveTextContent('all 24 screens');
  });

  it('a clear that kept nobody shows no toast', async () => {
    fetchActiveAlerts.mockResolvedValueOnce([LOCKDOWN]).mockResolvedValue([]);
    allClearEmergency.mockResolvedValue({ success: true });
    await renderOverlay();
    await screen.findByTestId('emergency-active-alerts');
    typeClear();
    await terminate();
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
