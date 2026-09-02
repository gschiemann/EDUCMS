/**
 * /[schoolId]/settings/emergency — the three behaviors that are load-bearing
 * for a life-safety configuration surface:
 *
 *   1. A K-12 organization NEVER sees a "turn it off" control (always-on
 *      contract). The old page decided this from a localStorage read; it is
 *      now the server's `emergencyEnabledLocked`.
 *   2. A non-K-12 organization DOES see the control.
 *   3. A failed save keeps the state the SERVER last confirmed and says so —
 *      never an optimistic flip to the value that was clicked (§13.2).
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'springfield' }),
  usePathname: () => '/springfield/settings/emergency',
  useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/store/ui-store', () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { role: 'DISTRICT_ADMIN' } }),
}));

jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn(async () => true),
  appAlert: jest.fn(async () => undefined),
}));

jest.mock('@/components/settings/PanicContentEditor', () => ({
  PanicContentEditor: ({ label }: { label: string }) => <div>panic-editor:{label}</div>,
}));
jest.mock('@/components/floor-plans/EmbeddedFloorPlanView', () => ({
  EmbeddedFloorPlanView: () => <div>floor-plan-view</div>,
}));
jest.mock('@/components/emergency/EmergencyReadinessCard', () => ({
  EmergencyReadinessCard: () => <div>readiness-card</div>,
  useEmergencyReadiness: () => ({ data: undefined, isLoading: false }),
}));

const mutateAsync = jest.fn(async (next: boolean) => ({ ok: true, next }));
let enablement: {
  enabled: boolean;
  stored: boolean | null;
  locked: boolean;
  isLoading: boolean;
  isError: boolean;
} = { enabled: true, stored: true, locked: false, isLoading: false, isError: false };

jest.mock('@/hooks/use-api', () => ({
  useTenant: () => ({ data: { id: 't1', name: 'Springfield' } }),
  useAuditLog: () => ({ data: undefined }),
  useFloorPlans: () => ({ data: [], isLoading: false }),
  useUploadFloorPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePanicContent: () => ({ data: { items: [] }, isLoading: false }),
  useEmergencyEnablement: () => enablement,
  useSetEmergencyEnabled: () => ({ mutateAsync, isPending: false }),
  useLocationBasedEmergencyConfig: () => ({ data: { enabled: false }, isLoading: false, isError: false }),
  useToggleLocationBasedEmergency: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import { SettingsShellProvider } from '@/components/settings/shell/SettingsShellContext';
import EmergencySettingsPage from '../page';

function renderPage() {
  return render(
    <SettingsShellProvider>
      <EmergencySettingsPage />
    </SettingsShellProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mutateAsync.mockImplementation(async (next: boolean) => ({ ok: true, next }));
  enablement = { enabled: true, stored: true, locked: false, isLoading: false, isError: false };
  window.localStorage.clear();
});

describe('Emergency settings page', () => {
  it('hides the off control for a K-12 organization and says why', () => {
    enablement = { enabled: true, stored: null, locked: true, isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Emergency alerts are on')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /turn off emergency alerts/i })).not.toBeInTheDocument();
    expect(screen.getByText(/stay on and cannot be turned off here/i)).toBeInTheDocument();
  });

  it('offers the off control for a non-K-12 organization', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /turn off emergency alerts/i })).toBeInTheDocument();
  });

  it('keeps the last server-confirmed state and explains a failed save', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('Network request failed'));
    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /turn off emergency alerts/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
    expect(
      screen.getByText(/last setting the server confirmed is still in effect/i),
    ).toBeInTheDocument();
    // Not optimistically flipped: the capability still reads ON, because the
    // server never confirmed anything else.
    expect(screen.getByText('Emergency alerts are on')).toBeInTheDocument();
    expect(screen.queryByText(/server confirms emergency alerts are off/i)).not.toBeInTheDocument();
  });

  it('shows the server confirmation only after the write resolves', async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /turn off emergency alerts/i }));
    });
    await waitFor(() =>
      expect(screen.getByText('Saved. The server confirms emergency alerts are off.')).toBeInTheDocument(),
    );
    expect(mutateAsync).toHaveBeenCalledWith(false);
  });

  it('migrates a leftover localStorage answer to the server once, then deletes the key', async () => {
    enablement = { enabled: false, stored: null, locked: false, isLoading: false, isError: false };
    window.localStorage.setItem('emergencyEnabled:t1', 'true');
    renderPage();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(true));
    await waitFor(() => expect(window.localStorage.getItem('emergencyEnabled:t1')).toBeNull());
  });

  it('never overwrites a server value that already exists', async () => {
    window.localStorage.setItem('emergencyEnabled:t1', 'false');
    renderPage();
    await waitFor(() => expect(window.localStorage.getItem('emergencyEnabled:t1')).toBeNull());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('renders no drill or test control (none is implemented server-side)', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /drill|run a test|send a test/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });
});
