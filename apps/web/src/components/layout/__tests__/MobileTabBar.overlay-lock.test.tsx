/**
 * Systemic mobile fix (2026-05-29): proof that ANY open overlay hides the
 * bottom MobileTabBar so the overlay's footer (Cancel / Confirm / Upload /
 * "Choose folder") always clears the bottom of the screen.
 *
 * THE BUG THIS LOCKS DOWN
 *   The fixed MobileTabBar (z-60) covered the bottom strip where every
 *   bottom-anchored modal puts its action buttons. The operator's first
 *   mobile action (asset upload) had its button clipped under the tab bar.
 *   A prior pass patched a hand-picked list of modals; this is the
 *   systemic fix — a global overlay-open counter (useAppStore) that the
 *   tab bar hides on, registered by every overlay via useOverlayLock().
 *
 * These are runnable RTL tests, not a static trace: they render the REAL
 * MobileTabBar alongside a real component that calls useOverlayLock(), and
 * assert the tab bar is in / out of the DOM as overlays open and close —
 * including the stacked-overlay case (a counter, not a boolean, so the bar
 * stays hidden until the LAST overlay closes).
 */
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';

// ── Mock MobileTabBar's data deps so it renders without the app shell ──
jest.mock('next/navigation', () => ({
  usePathname: () => '/school-1/assets',
  useParams: () => ({ schoolId: 'school-1' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
jest.mock('@/hooks/use-api', () => ({
  // The chrome's passkey entry (2026-09-24) reads the list; none here.
  usePasskeys: () => ({ data: undefined }),
  useNotifications: () => ({ data: { unreadCount: 0 } }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'K12' }),
}));

import { MobileTabBar } from '../MobileTabBar';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { useUIStore } from '@/store/ui-store';

// A minimal overlay that registers itself via the systemic hook — stands
// in for any real modal/sheet/drawer (FolderPicker, PlaylistCreateWizard,
// EmergencyTriggerModal, …). They all do exactly this one call.
function FakeOverlay({ label = 'overlay' }: { label?: string }) {
  useOverlayLock();
  return <div data-testid={label}>overlay body</div>;
}

// Drives one overlay open/closed from a button, so we can exercise the
// real mount → unmount lifecycle (and the effect cleanup that decrements).
function Harness() {
  const [open, setOpen] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <>
      <button onClick={() => setOpen((o) => !o)}>toggle</button>
      <button onClick={() => setSecond((o) => !o)}>toggle-2</button>
      {open && <FakeOverlay label="overlay-1" />}
      {second && <FakeOverlay label="overlay-2" />}
      <MobileTabBar />
    </>
  );
}

// The MobileTabBar's <nav aria-label="Primary"> is the element we assert
// on. A logged-in admin user is required so the bar renders its tabs.
function seedAdmin() {
  act(() => {
    useUIStore.setState({
      user: {
        id: 'u1',
        email: 'admin@test.edu',
        role: 'SCHOOL_ADMIN',
        tenantId: 't1',
      },
      mobileSidebarOpen: false,
      overlayOpenCount: 0,
    } as any);
  });
}

describe('MobileTabBar hides while any overlay is open (systemic mobile fix)', () => {
  beforeEach(() => {
    seedAdmin();
  });

  it('renders the tab bar when no overlay is open', () => {
    render(<Harness />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(useUIStore.getState().overlayOpenCount).toBe(0);
  });

  it('hides the tab bar when an overlay mounts, restores it when the overlay unmounts', () => {
    render(<Harness />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

    // Open the overlay → useOverlayLock bumps the count → tab bar unmounts.
    act(() => { screen.getByText('toggle').click(); });
    expect(screen.getByTestId('overlay-1')).toBeInTheDocument();
    expect(useUIStore.getState().overlayOpenCount).toBe(1);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();

    // Close the overlay → effect cleanup decrements → tab bar returns.
    act(() => { screen.getByText('toggle').click(); });
    expect(screen.queryByTestId('overlay-1')).not.toBeInTheDocument();
    expect(useUIStore.getState().overlayOpenCount).toBe(0);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('keeps the tab bar hidden until the LAST of two stacked overlays closes (counter, not boolean)', () => {
    render(<Harness />);

    act(() => { screen.getByText('toggle').click(); });   // overlay 1
    act(() => { screen.getByText('toggle-2').click(); });  // overlay 2 (stacked)
    expect(useUIStore.getState().overlayOpenCount).toBe(2);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();

    // Close only the second → still one overlay open → bar stays hidden.
    act(() => { screen.getByText('toggle-2').click(); });
    expect(useUIStore.getState().overlayOpenCount).toBe(1);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();

    // Close the first → count hits 0 → bar comes back.
    act(() => { screen.getByText('toggle').click(); });
    expect(useUIStore.getState().overlayOpenCount).toBe(0);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('also hides the tab bar when the mobile sidebar drawer is open (pre-existing behavior preserved)', () => {
    render(<Harness />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    act(() => { useUIStore.setState({ mobileSidebarOpen: true } as any); });
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });
});

describe('useOverlayLock counter never underflows', () => {
  it('popOverlay clamps at 0', () => {
    act(() => { useUIStore.setState({ overlayOpenCount: 0 } as any); });
    act(() => { useUIStore.getState().popOverlay(); });
    expect(useUIStore.getState().overlayOpenCount).toBe(0);
  });
});
