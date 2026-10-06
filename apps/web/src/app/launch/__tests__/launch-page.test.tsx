/**
 * M01 rendered — proof the route is WIRED, not just that the decision
 * function is correct. The states asserted here are the ones an operator can
 * actually get stuck on.
 */
import { render, screen, waitFor, act } from '@testing-library/react';

const replace = jest.fn();
const mockSwitch = jest.fn(async () => ({ ok: true }));
jest.mock('@/hooks/use-tenant-switch', () => ({ useTenantSwitch: () => ({ switchToTenant: mockSwitch }) }));
let mockNext: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get: (k: string) => (k === 'next' ? mockNext : null) }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
jest.mock('@/hooks/use-api', () => ({
  useAccessibleTenants: () => mockTenants,
}));

let mockTenants: any = { data: { tenants: [] }, isPending: false, isError: false };

import LaunchPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { setRememberMarker, __resetSessionRefreshState } from '@/lib/session-client';

function signedIn(slug: string | null = 'peak-west') {
  act(() => {
    useUIStore.setState({
      token: 'tok',
      user: { id: 'u', email: 'a@b.c', role: 'SCHOOL_ADMIN', tenantId: 't', tenantSlug: slug ?? undefined } as never,
    });
  });
}

beforeEach(() => {
  replace.mockClear();
  mockSwitch.mockClear();
  __resetSessionRefreshState();
  mockNext = null;
  window.localStorage.clear();
  mockTenants = { data: { tenants: [] }, isPending: false, isError: false };
  act(() => { useUIStore.setState({ token: null, user: null, authRestoring: false }); });
  global.fetch = jest.fn();
});

it('an installed launch with no session goes to sign-in, never the marketing page', async () => {
  render(<LaunchPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
});

it('a verified session lands on its location Home', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  signedIn();
  render(<LaunchPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/peak-west/dashboard'));
});

it('a 401 shows an explained expiry with a sign-in route — not a bare login form', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
  signedIn();
  render(<LaunchPage />);
  expect(await screen.findByTestId('launch-expired')).toBeInTheDocument();
  expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});

describe('the offline screen', () => {
  it('a network failure is offline, and says so — it does not sign anyone out', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    signedIn();
    render(<LaunchPage />);
    expect(await screen.findByTestId('launch-offline')).toBeInTheDocument();
    expect(screen.getByText(/still signed in/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('reports last successful sync when this device has one', async () => {
    window.localStorage.setItem('venueos_last_sync_at', new Date(Date.now() - 3 * 60_000).toISOString());
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    signedIn();
    render(<LaunchPage />);
    await screen.findByTestId('launch-offline');
    expect(screen.getByText(/Last successful sync 3 minutes ago/i)).toBeInTheDocument();
  });

  it('says so plainly when it has none, rather than implying a fresh sync', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    signedIn();
    render(<LaunchPage />);
    await screen.findByTestId('launch-offline');
    expect(screen.getByText(/No successful sync recorded on this device yet/i)).toBeInTheDocument();
  });

  it('still offers Emergency — an incident must not be gated behind a launch failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    signedIn();
    render(<LaunchPage />);
    await screen.findByTestId('launch-offline');
    expect(screen.getByRole('link', { name: /Open Emergency/i })).toHaveAttribute('href', '/panic');
  });

  it('a 5xx is the server failing, not the operator being signed out', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
    signedIn();
    render(<LaunchPage />);
    expect(await screen.findByTestId('launch-offline')).toBeInTheDocument();
  });
});

it('a session with no location offers the chooser', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  mockTenants = {
    data: { tenants: [{ id: '1', name: 'Peak West', slug: 'peak-west' }, { id: '2', name: 'Peak East', slug: 'peak-east' }] },
    isPending: false,
    isError: false,
  };
  signedIn(null);
  render(<LaunchPage />);
  expect(await screen.findByTestId('launch-choose-location')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Peak West/ })).toHaveAttribute('href', '/peak-west/dashboard');
  expect(screen.getByRole('link', { name: /Peak East/ })).toHaveAttribute('href', '/peak-east/dashboard');
});

it('a deep link survives the launch router', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  mockNext = '/peak-west/screens';
  signedIn();
  render(<LaunchPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/peak-west/screens'));
});


it('waits for cold-start cookie restoration instead of redirecting to login', async () => {
  setRememberMarker(true);
  act(() => useUIStore.setState({ authRestoring: true }));
  render(<LaunchPage />);
  expect(screen.getByTestId('launch-working')).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
  act(() => useUIStore.setState({ token: 'restored', user: { id: 'u', tenantId: 't', tenantSlug: 'peak-west' } as never, authRestoring: false }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/peak-west/dashboard'));
});

it('re-enters a saved workspace only after the accessible-locations response confirms it', async () => {
  signedIn(); setRememberMarker(true);
  localStorage.setItem('edu_cms_last_school', 'peak-east');
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tenants: [{ id: 'east', slug: 'peak-east' }] }) });
  render(<LaunchPage />);
  await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith({ id: 'east', slug: 'peak-east' }));
  expect(replace).not.toHaveBeenCalledWith('/peak-west/dashboard');
});

it('a saved workspace that is no longer allowed falls back to the home account', async () => {
  signedIn(); setRememberMarker(true);
  localStorage.setItem('edu_cms_last_school', 'revoked-location');
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tenants: [] }) });
  render(<LaunchPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/peak-west/dashboard'));
  expect(mockSwitch).not.toHaveBeenCalled();
});

it('a retryable restoration failure shows offline without forgetting the login choice', async () => {
  setRememberMarker(true);
  render(<LaunchPage />);
  expect(await screen.findByTestId('launch-offline')).toBeInTheDocument();
  expect(localStorage.getItem('edu_cms_remember')).toBe('1');
  expect(replace).not.toHaveBeenCalled();
});
