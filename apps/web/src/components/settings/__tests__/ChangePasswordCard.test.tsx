/**
 * ACC-02 change-password UI — RTL proof (2026-08-03).
 *
 * The endpoint shipped 2026-08-01 with no UI at all. Two behaviours here are
 * easy to get wrong and expensive when you do:
 *
 *   1. The server revokes EVERY live token for the account and returns one
 *      replacement. A form that ignores it leaves this tab holding a dead
 *      token — the user is signed out by their own security action.
 *   2. `sessionsRevoked:false` means the password DID change but the
 *      revocation store was unreachable. Reporting a plain success there is a
 *      lie about the one property the user came to this card for.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('next-intl', () => ({
  // Render the key path itself so assertions do not depend on copy.
  useTranslations: () => (k: string, vals?: any) =>
    vals ? `${k}:${JSON.stringify(vals)}` : k,
}));

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...a: any[]) => apiFetch(...a),
}));

import { ChangePasswordCard } from '../ChangePasswordCard';
import { useUIStore } from '@/store/ui-store';

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChangePasswordCard />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(current = 'oldpassword', next = 'newpassword1', confirm = next) {
  fireEvent.change(screen.getByLabelText('changePassword.currentLabel'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('changePassword.newLabel'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('changePassword.confirmLabel'), { target: { value: confirm } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'changePassword.submit' }));
  });
}

describe('ChangePasswordCard', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useUIStore.setState({ token: 'old-token' });
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
  });

  it('POSTs the two passwords to /auth/change-password', async () => {
    apiFetch.mockResolvedValue({ success: true, access_token: 'new-token', sessionsRevoked: true });
    renderCard();
    await fillAndSubmit();
    expect(apiFetch).toHaveBeenCalledWith(
      '/auth/change-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'oldpassword', newPassword: 'newpassword1' }),
      }),
    );
  });

  it('swaps the stored token so this tab is not signed out by its own action', async () => {
    apiFetch.mockResolvedValue({ success: true, access_token: 'new-token', sessionsRevoked: true });
    renderCard();
    await fillAndSubmit();
    await waitFor(() => expect(useUIStore.getState().token).toBe('new-token'));
  });

  it('reports the honest partial outcome when sessions could NOT be revoked', async () => {
    apiFetch.mockResolvedValue({ success: true, access_token: 'new-token', sessionsRevoked: false });
    renderCard();
    await fillAndSubmit();
    expect(await screen.findByText('changePassword.okNotRevoked')).toBeInTheDocument();
    expect(screen.queryByText('changePassword.okRevoked')).not.toBeInTheDocument();
  });

  it('confirms the clean outcome when they were', async () => {
    apiFetch.mockResolvedValue({ success: true, access_token: 'new-token', sessionsRevoked: true });
    renderCard();
    await fillAndSubmit();
    expect(await screen.findByText('changePassword.okRevoked')).toBeInTheDocument();
  });

  it('catches a typo in the confirmation without spending a request', async () => {
    renderCard();
    await fillAndSubmit('oldpassword', 'newpassword1', 'newpassword2');
    expect(await screen.findByText('changePassword.errMismatch')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('rejects a too-short password client-side (mirrors the server floor)', async () => {
    renderCard();
    await fillAndSubmit('oldpassword', 'short', 'short');
    expect(await screen.findByText(/changePassword\.errTooShort/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('rejects reusing the current password without spending two argon2 hashes', async () => {
    renderCard();
    await fillAndSubmit('samepassword', 'samepassword', 'samepassword');
    expect(await screen.findByText('changePassword.errUnchanged')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('surfaces the server message on a wrong current password, and keeps the old token', async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error('Your current password is incorrect.'), {
      code: 'AUTH_CURRENT_PASSWORD_INVALID',
    }));
    renderCard();
    await fillAndSubmit();
    expect(await screen.findByText('Your current password is incorrect.')).toBeInTheDocument();
    expect(useUIStore.getState().token).toBe('old-token');
  });
});
