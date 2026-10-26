/**
 * A practice DRILL is worded as a drill on every dashboard surface
 * (2026-10-24, launch QA U16).
 *
 * The QA walkthrough found the dashboard overlay correctly indigo and saying
 * "DRILL ACTIVE", while — for the same drill — the strip under the phone
 * header read "CRITICAL ACTIVE · View incident" and the Sidebar pill read
 * "Emergency Active" in red. These render the REAL TopToolbar and Sidebar with
 * the real store and assert the words and the colour for both a drill and a
 * live alert (the live wording must not change: it is the emergency owner's).
 *
 * The drill answer has two sources, both covered:
 *   - the tenant row's own `emergencyIsDrill` (an "All screens" drill);
 *   - what EmergencyOverlay publishes from the live alert list
 *     (`emergencyDrillOnly`), which is the only way to know a drill aimed at
 *     one group or one screen is a drill.
 */
import { act, render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  usePathname: () => '/school-1/dashboard',
  useParams: () => ({ schoolId: 'school-1' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
let mockTenant: Record<string, unknown> = {};
jest.mock('@/hooks/use-api', () => ({
  useTenantBranding: () => ({ data: undefined }),
  useTenantStatus: () => ({ data: mockTenant }),
  useNotifications: () => ({ data: { unreadCount: 0 } }),
  usePasskeys: () => ({ data: { passkeys: [], max: 10 } }),
  usePendingAssets: () => ({ data: [] }),
  useSubmissions: () => ({ data: [] }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'K12', roleLabel: (r: string) => r }),
}));
jest.mock('@/components/emergency/EmergencyTriggerModal', () => ({ EmergencyTriggerModal: () => null }));
jest.mock('../SchoolSwitcher', () => ({ SchoolSwitcher: () => <button type="button">School</button> }));
jest.mock('../NotificationsBell', () => ({ NotificationsBell: () => <button type="button">Alerts</button> }));
jest.mock('../ProfileEditModal', () => ({ ProfileEditModal: () => null }));
jest.mock('../../help/HelpDrawer', () => ({ HelpDrawer: () => null }));

import { TopToolbar } from '../TopToolbar';
import { Sidebar } from '../Sidebar';
import { useAppStore } from '@/lib/store';

function seed(opts: { drillPublished?: boolean | null } = {}) {
  act(() => {
    useAppStore.setState({
      user: { id: 'u1', email: 'a@b.c', role: 'SCHOOL_ADMIN', tenantId: 't1', canTriggerPanic: true } as never,
      activeTenant: 'school-1',
      overlayOpenCount: 0,
      mobileSidebarOpen: false,
      isEmergencyActive: true,
      emergencyDrillOnly: opts.drillPublished ?? null,
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockTenant = {};
});

describe('an "All screens" DRILL (the tenant row says so)', () => {
  beforeEach(() => {
    mockTenant = { emergencyStatus: 'CRITICAL', emergencyIsDrill: true, panicLockdownPlaylistId: 'p1' };
    seed();
  });

  it('the phone strip is indigo and says "Drill in progress · View drill" — never "Critical active"', () => {
    render(<TopToolbar />);
    const strip = screen.getByTestId('toolbar-emergency-strip');
    expect(strip).toHaveAttribute('data-drill', 'true');
    expect(strip.className).toMatch(/bg-indigo-700/);
    expect(strip.className).not.toMatch(/bg-red-/);
    expect(strip).toHaveTextContent('Drill in progress');
    expect(strip).toHaveTextContent('View drill');
    expect(strip.textContent).not.toMatch(/critical|incident|emergency/i);
  });

  it('the phone header pill is indigo and says "Drill in progress"', () => {
    render(<TopToolbar />);
    const pill = screen.getByTestId('toolbar-emergency-pill');
    expect(pill).toHaveAttribute('data-drill', 'true');
    expect(pill.className).toMatch(/bg-indigo-600/);
    expect(pill).toHaveTextContent('Drill in progress');
    expect(pill.textContent).not.toMatch(/Emergency Active/);
  });

  it('the Sidebar pill is indigo and says "Drill in progress"', () => {
    render(<Sidebar />);
    const pill = screen.getByTestId('sidebar-emergency-pill');
    expect(pill).toHaveAttribute('data-drill', 'true');
    expect(pill.className).toMatch(/bg-indigo-600/);
    expect(pill).toHaveTextContent('Drill in progress');
  });
});

describe('a LIVE alert keeps its wording exactly', () => {
  beforeEach(() => {
    mockTenant = { emergencyStatus: 'CRITICAL', emergencyIsDrill: false, panicLockdownPlaylistId: 'p1' };
    seed();
  });

  it('the phone strip stays red with the live words and "View incident"', () => {
    render(<TopToolbar />);
    const strip = screen.getByTestId('toolbar-emergency-strip');
    expect(strip).toHaveAttribute('data-drill', 'false');
    expect(strip.className).toMatch(/bg-red-700/);
    expect(strip).toHaveTextContent('Critical active');
    expect(strip).toHaveTextContent('View incident');
    expect(strip.textContent).not.toMatch(/drill/i);
  });

  it('the pills stay red and say "Emergency Active"', () => {
    render(<><TopToolbar /><Sidebar /></>);
    expect(screen.getByTestId('toolbar-emergency-pill').className).toMatch(/bg-red-600/);
    expect(screen.getByTestId('toolbar-emergency-pill')).toHaveTextContent('Emergency Active');
    expect(screen.getByTestId('sidebar-emergency-pill').className).toMatch(/bg-red-600/);
    expect(screen.getByTestId('sidebar-emergency-pill')).toHaveTextContent('Emergency Active');
  });
});

describe('what the overlay publishes from the live alert list wins', () => {
  it('a drill aimed at one group (the tenant row knows nothing about it) still says DRILL', () => {
    mockTenant = { emergencyStatus: 'INACTIVE', emergencyScopedAlertActive: true, panicLockdownPlaylistId: 'p1' };
    seed({ drillPublished: true });
    render(<TopToolbar />);
    expect(screen.getByTestId('toolbar-emergency-strip')).toHaveTextContent('Drill in progress');
    expect(screen.getByTestId('toolbar-emergency-pill')).toHaveAttribute('data-drill', 'true');
  });

  it('a live alert among drills keeps the live words, even if the tenant row is a drill', () => {
    mockTenant = { emergencyStatus: 'CRITICAL', emergencyIsDrill: true, panicLockdownPlaylistId: 'p1' };
    seed({ drillPublished: false });
    render(<TopToolbar />);
    const strip = screen.getByTestId('toolbar-emergency-strip');
    expect(strip).toHaveAttribute('data-drill', 'false');
    expect(strip.className).toMatch(/bg-red-700/);
    expect(strip).toHaveTextContent('View incident');
  });

  it('the answer is dropped when the alert ends, so the next alert starts from its own facts', () => {
    seed({ drillPublished: true });
    act(() => { useAppStore.getState().setEmergencyActive(false); });
    expect(useAppStore.getState().emergencyDrillOnly).toBeNull();
  });
});
