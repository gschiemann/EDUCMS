/**
 * FIRST-LOGIN CREDENTIAL SETUP — web gate (2026-09-03).
 *
 * A location account provisioned with a placeholder email
 * (`riot-jacksonville@riotcolor.com`) and a starter password must see the
 * setup screen INSTEAD of the dashboard until it has claimed its own
 * credentials. These tests render the real `SchoolLayout` — the actual mount
 * point, not a stand-in — so a future refactor that moves the gate out of the
 * render tree fails here rather than silently shipping an ungated dashboard
 * (CLAUDE.md "verify the render tree").
 *
 * `DashboardLayout` is mocked to a marker. That is deliberate: the whole point
 * of the gate is that the chrome and its dozen data hooks NEVER MOUNT, and
 * asserting the marker's absence is the direct proof of that.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'riot-jax' }),
}));

// The chrome must never mount behind the gate — a marker makes that assertable.
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-chrome">{children}</div>
  ),
}));

jest.mock('@/lib/client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The CSRF bootstrap is a separate unauthenticated round trip; stub it so the
// assertions below see only the calls this flow is about.
jest.mock('@/lib/csrf', () => ({
  ensureCsrfToken: jest.fn().mockResolvedValue('csrf-token'),
  invalidateCsrfToken: jest.fn(),
}));

import SchoolLayout from '../layout';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

const GATED_USER = {
  id: 'u1',
  email: 'riot-jacksonville@riotcolor.com',
  role: 'SCHOOL_ADMIN',
  tenantId: 'tenant-riot-jax',
  tenantSlug: 'riot-jax',
  mustSetupCredentials: true,
};

function mockFetchOnce(result: { ok?: boolean; status?: number; body?: unknown }) {
  const fn = jest.fn(() =>
    Promise.resolve({
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: () => Promise.resolve(result.body ?? {}),
    }),
  );
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

/** Render the layout and let the `mounted` effect settle. */
async function renderLayout() {
  await act(async () => {
    render(
      <SchoolLayout>
        <div data-testid="page-content">the dashboard page</div>
      </SchoolLayout>,
    );
  });
}

async function fillAndSubmit(
  values: { email?: string; password?: string; confirm?: string } = {},
) {
  const email = values.email ?? 'dana@riotcolor.com';
  const password = values.password ?? 'a-real-password-1';
  const confirm = values.confirm ?? password;
  fireEvent.change(screen.getByLabelText('Your work email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
  });
}

describe('SchoolLayout — first-login credential setup gate', () => {
  beforeEach(() => {
    useUIStore.setState({ token: 'starter.jwt.token', user: { ...GATED_USER } });
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  });

  it('renders the setup screen and NOT the dashboard for a flagged account', async () => {
    await renderLayout();

    expect(screen.getByRole('heading', { name: /finish setting up your account/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Your work email')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    // The chrome and the page underneath it never mounted.
    expect(screen.queryByTestId('dashboard-chrome')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it('renders the dashboard normally for an account that is NOT flagged', async () => {
    useUIStore.setState({ user: { ...GATED_USER, mustSetupCredentials: false } });
    await renderLayout();

    expect(screen.getByTestId('dashboard-chrome')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /finish setting up/i })).not.toBeInTheDocument();
  });

  it('shows the placeholder address so the operator knows what they are replacing', async () => {
    await renderLayout();
    expect(screen.getByText('riot-jacksonville@riotcolor.com')).toBeInTheDocument();
  });

  it('submits to /auth/complete-setup and drops the operator into the dashboard', async () => {
    const fetchMock = mockFetchOnce({
      body: {
        success: true,
        access_token: 'fresh.jwt.token',
        sessionsRevoked: true,
        user: { ...GATED_USER, email: 'dana@riotcolor.com', mustSetupCredentials: false },
      },
    });

    await renderLayout();
    await fillAndSubmit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(`${API_URL}/auth/complete-setup`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer starter.jwt.token');
    expect(JSON.parse(init.body)).toEqual({
      email: 'dana@riotcolor.com',
      password: 'a-real-password-1',
    });

    // The replacement session replaced the old one, and the gate stood down.
    await waitFor(() => expect(screen.getByTestId('dashboard-chrome')).toBeInTheDocument());
    const state = useUIStore.getState();
    expect(state.token).toBe('fresh.jwt.token');
    expect(state.user?.email).toBe('dana@riotcolor.com');
    expect(state.user?.mustSetupCredentials).toBe(false);
  });

  it('surfaces a duplicate email inline on the email field and keeps the gate up', async () => {
    mockFetchOnce({
      ok: false,
      status: 409,
      body: { error: true, code: 'SETUP_EMAIL_IN_USE', message: 'That email is already in use.' },
    });

    await renderLayout();
    await fillAndSubmit({ email: 'taken@riotcolor.com' });

    const err = await screen.findByText(/already in use/i);
    expect(err).toBeInTheDocument();
    // Wired to the input for screen readers, not just painted next to it.
    expect(screen.getByLabelText('Your work email')).toHaveAttribute(
      'aria-describedby',
      err.getAttribute('id'),
    );
    expect(screen.getByLabelText('Your work email')).toHaveAttribute('aria-invalid', 'true');
    // Still gated — nothing about the session changed.
    expect(screen.queryByTestId('dashboard-chrome')).not.toBeInTheDocument();
    expect(useUIStore.getState().token).toBe('starter.jwt.token');
  });

  it('surfaces a password-policy failure inline', async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { error: true, code: 'SETUP_PASSWORD_UNCHANGED', message: 'Choose a new password.' },
    });

    await renderLayout();
    await fillAndSubmit({ password: 'the-starter-one' });

    expect(await screen.findByText(/starter password you were given/i)).toBeInTheDocument();
  });

  describe('client-side checks answer without a round trip', () => {
    it('refuses a short password', async () => {
      const fetchMock = mockFetchOnce({ body: {} });
      await renderLayout();
      await fillAndSubmit({ password: 'short7!' });

      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a mismatched confirmation', async () => {
      const fetchMock = mockFetchOnce({ body: {} });
      await renderLayout();
      await fillAndSubmit({ password: 'a-real-password-1', confirm: 'something-else-2' });

      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses keeping the placeholder email', async () => {
      const fetchMock = mockFetchOnce({ body: {} });
      await renderLayout();
      await fillAndSubmit({ email: 'riot-jacksonville@riotcolor.com' });

      expect(screen.getByText(/temporary address the account was created with/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('is completable with a keyboard alone', async () => {
    const fetchMock = mockFetchOnce({
      body: {
        success: true,
        access_token: 'fresh.jwt.token',
        user: { ...GATED_USER, email: 'dana@riotcolor.com', mustSetupCredentials: false },
      },
    });
    await renderLayout();

    // Focus starts on the first field the operator must fill in.
    await waitFor(() => expect(screen.getByLabelText('Your work email')).toHaveFocus());

    // Every control is a real labelled form control in reading order, and the
    // form submits on Enter from within it (a native <form> + type=submit).
    fireEvent.change(screen.getByLabelText('Your work email'), { target: { value: 'dana@riotcolor.com' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-real-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-real-password-1' } });
    const form = screen.getByLabelText('Your work email').closest('form');
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers a way out for an operator handed the wrong credential', async () => {
    await renderLayout();
    expect(screen.getByRole('button', { name: /not your account\? sign out/i })).toBeInTheDocument();
  });
});
