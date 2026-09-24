/**
 * PasskeyCard — Settings → Security (2026-09-21).
 *
 * Same testing contract as MfaCard.test.tsx: the network is mocked at
 * `apiFetch`, NOT at the hooks, so the REAL use-api hooks run with their REAL
 * URLs and this suite proves the frozen API contract is matched rather than
 * assumed. `@simplewebauthn/browser` is mocked because jsdom has no
 * authenticator — mocking the package (not `@/lib/passkeys`) keeps our own
 * wrapper in the path under test.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

// No implementation here: `jest.fn(() => true)` is typed at arity 0 and tsc
// rejects the argument-forwarding wrapper below. The value is set per test.
const browserSupportsWebAuthn = jest.fn();
const startRegistration = jest.fn();
const startAuthentication = jest.fn();
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: (...a: any[]) => browserSupportsWebAuthn(...a),
  startRegistration: (...a: any[]) => startRegistration(...a),
  startAuthentication: (...a: any[]) => startAuthentication(...a),
}));

import { PasskeyCard } from '../PasskeyCard';

const CREATE_OPTIONS = { challenge: 'Y2hhbGxlbmdl', rp: { name: 'VenueOS' } };
const ATTESTATION = { id: 'cred-abc', rawId: 'cred-abc', type: 'public-key', response: {} };

const IPHONE = {
  id: 'pk-1',
  label: 'iPhone',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: '2026-09-20T10:00:00.000Z',
  transports: ['internal'],
};

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PasskeyCard />
    </QueryClientProvider>,
  );
}

/** An apiFetch error shaped exactly like the one api-client attaches. */
function apiError(message: string, status: number, code?: string) {
  const err: any = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

beforeEach(() => {
  apiFetch.mockReset();
  browserSupportsWebAuthn.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  startRegistration.mockReset();
  startAuthentication.mockReset();
});

describe('PasskeyCard — empty state', () => {
  it('pitches passkeys and offers exactly one way in', async () => {
    apiFetch.mockImplementation((path: string) =>
      path === '/auth/passkeys' ? Promise.resolve({ passkeys: [], max: 10 }) : Promise.resolve(null),
    );

    await act(async () => { renderCard(); });

    expect(await screen.findByText(/No authenticator app, and it can't be phished/i)).toBeInTheDocument();
    expect(screen.getByText(/You haven't added a passkey yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a passkey/i })).toBeInTheDocument();
    // Nothing has been enrolled, so no "you may turn 2FA off" nudge yet.
    expect(screen.queryByText(/turn the authenticator app off/i)).not.toBeInTheDocument();
  });

  it('survives an API that answers with nothing at all', async () => {
    // A pre-passkey API (or a harness that stubs every call) returns null
    // here. That is "no passkeys yet", never a crash on the security page.
    apiFetch.mockResolvedValue(null);
    await act(async () => { renderCard(); });
    expect(await screen.findByText(/You haven't added a passkey yet/i)).toBeInTheDocument();
  });
});

describe('PasskeyCard — the "you may turn the app off" note', () => {
  const ROW = { id: 'pk-1', label: 'Mac', createdAt: '2026-09-20T00:00:00Z', lastUsedAt: null, transports: ['internal'] };
  const withStatus = (enabled: boolean) => (path: string) =>
    path === '/auth/passkeys'
      ? Promise.resolve({ passkeys: [ROW], max: 10 })
      : path === '/auth/mfa/status'
        ? Promise.resolve({ enabled, passkeyCount: 1 })
        : Promise.resolve(null);

  it('appears once a passkey exists AND the authenticator app is on', async () => {
    apiFetch.mockImplementation(withStatus(true));
    await act(async () => { renderCard(); });
    expect(await screen.findByText('Mac')).toBeInTheDocument();
    expect(await screen.findByText(/turn the authenticator app off/i)).toBeInTheDocument();
  });

  it('stays quiet when the app is OFF — it would describe a control that is not there (2026-09-24)', async () => {
    apiFetch.mockImplementation(withStatus(false));
    await act(async () => { renderCard(); });
    expect(await screen.findByText('Mac')).toBeInTheDocument();
    expect(screen.queryByText(/turn the authenticator app off/i)).not.toBeInTheDocument();
  });
});

describe('PasskeyCard — add flow', () => {
  it('password → options → create → verify → the row appears', async () => {
    let list: any[] = [];
    const calls: Array<{ path: string; opts: any }> = [];
    apiFetch.mockImplementation((path: string, opts?: any) => {
      calls.push({ path, opts });
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: list, max: 10 });
      if (path === '/auth/passkeys/register/options') return Promise.resolve({ options: CREATE_OPTIONS });
      if (path === '/auth/passkeys/register/verify') {
        list = [IPHONE];
        return Promise.resolve({ passkey: IPHONE });
      }
      // The authenticator app is ON for this account, so the "you may turn it
      // off now" note is due once the passkey lands.
      if (path === '/auth/mfa/status') return Promise.resolve({ enabled: true, passkeyCount: list.length });
      return Promise.resolve(null);
    });
    startRegistration.mockResolvedValue(ATTESTATION);

    await act(async () => { renderCard(); });
    await screen.findByText(/You haven't added a passkey yet/i);

    fireEvent.click(screen.getByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), {
      target: { value: 'hunter2hunter2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
    });

    // The REAL endpoints, with the REAL bodies.
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/passkeys/register/options', {
        method: 'POST',
        body: JSON.stringify({ password: 'hunter2hunter2' }),
      });
    });
    // v13 call shape, through our wrapper.
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: CREATE_OPTIONS });
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/passkeys/register/verify', {
        method: 'POST',
        // jsdom's UA is none of the known platforms → the generic default.
        body: JSON.stringify({ response: ATTESTATION, label: 'Passkey' }),
      });
    });

    // The list refreshes and the row lands, with its dates.
    expect(await screen.findByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText(/Added /)).toBeInTheDocument();
    expect(screen.getByText(/Last used /)).toBeInTheDocument();
    // And the operator is TOLD they may now drop the authenticator app —
    // without anything having been switched off for them.
    expect(screen.getByText(/Nothing has been changed for you/i)).toBeInTheDocument();
  });

  it('shows the one-time recovery codes when the API returns them', async () => {
    const CODES = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'];
    let list: any[] = [];
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: list, max: 10 });
      if (path === '/auth/passkeys/register/options') return Promise.resolve({ options: CREATE_OPTIONS });
      if (path === '/auth/passkeys/register/verify') {
        list = [IPHONE];
        return Promise.resolve({ passkey: IPHONE, backupCodes: CODES });
      }
      return Promise.resolve(null);
    });
    startRegistration.mockResolvedValue(ATTESTATION);

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });

    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('CCCC-3333')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy codes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();

    // "Shown once" has to mean once: dismissing them takes them off screen
    // and nothing brings them back.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /I've saved them/i })); });
    expect(screen.queryByText('AAAA-1111')).not.toBeInTheDocument();
  });

  it('a wrong password says so and does NOT touch the authenticator', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: [], max: 10 });
      if (path === '/auth/passkeys/register/options') {
        return Promise.reject(apiError('Unauthorized', 401));
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), { target: { value: 'wrong' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });

    expect(await screen.findByText(/That password isn't right/i)).toBeInTheDocument();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('PASSKEY_LIMIT explains the ceiling instead of failing generically', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: [], max: 10 });
      if (path === '/auth/passkeys/register/options') {
        return Promise.reject(apiError('Too many passkeys', 409, 'PASSKEY_LIMIT'));
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });

    expect(await screen.findByText(/You already have 10 passkeys/i)).toBeInTheDocument();
  });

  it('PASSKEY_PASSWORD_REQUIRED explains SSO rather than blaming the password', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: [], max: 10 });
      if (path === '/auth/passkeys/register/options') {
        return Promise.reject(apiError('No password on file', 409, 'PASSKEY_PASSWORD_REQUIRED'));
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });

    expect(await screen.findByText(/signs in through your organization/i)).toBeInTheDocument();
  });

  it('a CANCELLED Face ID sheet paints NO error at all', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: [], max: 10 });
      if (path === '/auth/passkeys/register/options') return Promise.resolve({ options: CREATE_OPTIONS });
      return Promise.resolve(null);
    });
    const cancelled = new Error('The operation either timed out or was not allowed.');
    cancelled.name = 'NotAllowedError';
    startRegistration.mockRejectedValue(cancelled);

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });

    await waitFor(() => { expect(startRegistration).toHaveBeenCalled(); });
    // Nothing red, nothing verified, and we are back on the button.
    expect(screen.queryByText(/couldn't/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/isn't right/i)).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith('/auth/passkeys/register/verify', expect.anything());
    expect(await screen.findByRole('button', { name: /Add a passkey/i })).toBeInTheDocument();
  });

  it('an InvalidStateError names the real cause — this device already has one', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: [], max: 10 });
      if (path === '/auth/passkeys/register/options') return Promise.resolve({ options: CREATE_OPTIONS });
      return Promise.resolve(null);
    });
    const dupe = new Error('previously registered');
    dupe.name = 'InvalidStateError';
    startRegistration.mockRejectedValue(dupe);

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Add a passkey/i }));
    fireEvent.change(await screen.findByPlaceholderText('Your password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });

    expect(await screen.findByText(/This device already has a passkey/i)).toBeInTheDocument();
  });
});

describe('PasskeyCard — manage', () => {
  it('renames a passkey through PATCH /auth/passkeys/:id', async () => {
    let list = [IPHONE];
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: list, max: 10 });
      if (path === '/auth/passkeys/pk-1') {
        list = [{ ...IPHONE, label: 'Work iPhone' }];
        return Promise.resolve({ passkey: list[0] });
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Rename iPhone/i }));
    fireEvent.change(await screen.findByLabelText('Passkey name'), { target: { value: 'Work iPhone' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/i })); });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/passkeys/pk-1', {
        method: 'PATCH',
        body: JSON.stringify({ label: 'Work iPhone' }),
      });
    });
    expect(await screen.findByText('Work iPhone')).toBeInTheDocument();
  });

  it('removes a passkey only after the account password', async () => {
    let list = [IPHONE];
    apiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: list, max: 10 });
      if (path === '/auth/passkeys/pk-1' && opts?.method === 'DELETE') {
        list = [];
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Remove iPhone/i }));
    // A password is genuinely required — an empty submit never reaches the API.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove passkey/i })); });
    expect(await screen.findByText(/Enter your password to remove this passkey/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith('/auth/passkeys/pk-1', expect.objectContaining({ method: 'DELETE' }));

    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'hunter2hunter2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove passkey/i })); });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/passkeys/pk-1', {
        method: 'DELETE',
        body: JSON.stringify({ password: 'hunter2hunter2' }),
      });
    });
    await waitFor(() => { expect(screen.queryByText('iPhone')).not.toBeInTheDocument(); });
  });

  it('PASSKEY_LAST_FACTOR explains WHY, and the passkey stays', async () => {
    apiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/auth/passkeys') return Promise.resolve({ passkeys: [IPHONE], max: 10 });
      if (path === '/auth/passkeys/pk-1' && opts?.method === 'DELETE') {
        return Promise.reject(apiError('Last factor', 409, 'PASSKEY_LAST_FACTOR'));
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    fireEvent.click(await screen.findByRole('button', { name: /Remove iPhone/i }));
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove passkey/i })); });

    expect(
      await screen.findByText(/this is your last factor. Add another passkey or set up the authenticator app first/i),
    ).toBeInTheDocument();
    expect(screen.getByText('iPhone')).toBeInTheDocument();
  });

  it('a passkey with no label and no last-use reads honestly', async () => {
    apiFetch.mockImplementation((path: string) =>
      path === '/auth/passkeys'
        ? Promise.resolve({
            passkeys: [{ ...IPHONE, label: null, lastUsedAt: null }],
            max: 10,
          })
        : Promise.resolve(null),
    );

    await act(async () => { renderCard(); });
    expect(await screen.findByText('Unnamed passkey')).toBeInTheDocument();
    expect(screen.getByText(/Never used/i)).toBeInTheDocument();
  });

  it('hides "Add" once the server-declared limit is reached', async () => {
    apiFetch.mockImplementation((path: string) =>
      path === '/auth/passkeys'
        ? Promise.resolve({ passkeys: [{ ...IPHONE }, { ...IPHONE, id: 'pk-2', label: 'Mac' }], max: 2 })
        : Promise.resolve(null),
    );

    await act(async () => { renderCard(); });
    expect(await screen.findByText(/reached the limit of 2 passkeys/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a passkey/i })).not.toBeInTheDocument();
  });
});

describe('PasskeyCard — unsupported browser', () => {
  it('says so calmly and offers NO button', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    apiFetch.mockImplementation((path: string) =>
      path === '/auth/passkeys' ? Promise.resolve({ passkeys: [], max: 10 }) : Promise.resolve(null),
    );

    await act(async () => { renderCard(); });

    expect(await screen.findByText(/This browser doesn't support passkeys/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a passkey/i })).not.toBeInTheDocument();
    // No dead pitch either — we do not sell something this browser can't do.
    expect(screen.queryByText(/No authenticator app, and it can't be phished/i)).not.toBeInTheDocument();
  });
});
