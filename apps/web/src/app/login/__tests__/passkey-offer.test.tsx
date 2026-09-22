/**
 * The post-sign-in passkey walk-through, and the "no passkey here yet" hint —
 * RTL proof (2026-09-22).
 *
 * Operator: "when i try to login with a passkey to my main account it says i
 * dont have one saved. shouldnt it walk me thru getting one?"
 *
 *   HINT   "Sign in with a passkey" → the sheet closes with no credential
 *          (NotAllowedError — indistinguishable from a cancel) → no red
 *          banner, but a calm line saying what to do next.
 *
 *   OFFER  password (+ authenticator code) → the response carries a
 *          single-use `passkeyEnrollment.grant` → the page trades it for
 *          creation options BEFORE showing anything → "Sign in faster next
 *          time · Set up passkey · Not now" → create() INSIDE the tap →
 *          register/verify → "Passkey saved" → Continue → the dashboard.
 *
 * Every exit (Not now, Continue, Esc, Back) must reach the destination; the
 * one hold is a first factor's one-time backup codes.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const push = jest.fn();
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(''),
}));

jest.mock('@/lib/client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const adoptRememberedSession = jest.fn();
jest.mock('@/lib/session-client', () => ({
  adoptRememberedSession: (...a: unknown[]) => adoptRememberedSession(...a),
  hasRememberMarker: () => false,
  refreshRememberedSession: () => Promise.resolve(false),
}));

const browserSupportsWebAuthn = jest.fn();
const startAuthentication = jest.fn();
const startRegistration = jest.fn();
const platformAuthenticatorIsAvailable = jest.fn();
const cancelCeremony = jest.fn();
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: (...a: unknown[]) => browserSupportsWebAuthn(...a),
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
  startRegistration: (...a: unknown[]) => startRegistration(...a),
  platformAuthenticatorIsAvailable: (...a: unknown[]) => platformAuthenticatorIsAvailable(...a),
  WebAuthnAbortService: { cancelCeremony: (...a: unknown[]) => cancelCeremony(...a) },
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import {
  __resetPasskeyOfferMemoryForTests,
  PASSKEY_OFFER_SESSION_KEY,
  PASSKEY_OFFER_SNOOZE_KEY,
} from '@/lib/passkey-offer';

type Reply = { ok?: boolean; status?: number; body?: unknown; reject?: boolean };
type Call = { url: string; body: unknown; headers: Record<string, string> };

/** Route replies by URL suffix, longest match first; record every call. */
function mockFetchByPath(routes: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const key = keys.find((k) => String(url).endsWith(k));
    const r: Reply = key ? routes[key] : { ok: false, status: 404, body: {} };
    if (r.reject) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body ?? {}),
    });
  });
  return calls;
}

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
/** 43 base64url characters — the exact shape the API mints. */
const GRANT = 'Gr4nt_' + 'x'.repeat(35) + '-9';
const USER = { id: 'u1', email: 'admin@school.edu', role: 'SUPER_ADMIN', tenantSlug: 'lincoln', tenantId: 't1' };
const SESSION = { access_token: 'tok-1', user: USER };
const WITH_GRANT = { ...SESSION, passkeyEnrollment: { grant: GRANT, expiresAt: '2026-09-22T12:10:00.000Z' } };
const CREATE_OPTIONS = { challenge: 'Y2hhbGw', rp: { id: 'venue-os.app', name: 'VenueOS' }, user: { id: 'dXNlcg', name: 'a', displayName: 'A' } };
const ATTESTATION = { id: 'cred-new', rawId: 'cred-new', type: 'public-key', response: {} };
const DEST = '/lincoln/dashboard';

function domError(name: string): Error {
  const e = new Error(`${name} raised`);
  e.name = name;
  return e;
}

async function typePasswordAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@school.edu' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
  });
}

/** Password → authenticator code → the offer (Greg's exact path). */
async function signInWithPasswordAndCode() {
  await act(async () => { render(<LoginPage />); });
  await typePasswordAndSubmit();
  fireEvent.change(await screen.findByLabelText('Authentication code'), { target: { value: '123456' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i }));
  });
}

const OFFER_ROUTES = {
  '/auth/login': { body: { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['totp'] } },
  '/auth/mfa/challenge': { body: WITH_GRANT },
  '/auth/passkeys/register/options': { body: { options: CREATE_OPTIONS } },
  '/auth/passkeys/register/verify': { body: { passkey: { id: 'pk-1', label: 'Mac' } } },
};

let realUA: PropertyDescriptor | undefined;
beforeAll(() => {
  realUA = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
  Object.defineProperty(window.navigator, 'userAgent', { value: MAC_UA, configurable: true });
});
afterAll(() => {
  if (realUA) Object.defineProperty(window.navigator, 'userAgent', realUA);
});

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  adoptRememberedSession.mockReset();
  adoptRememberedSession.mockResolvedValue(true);
  browserSupportsWebAuthn.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  startAuthentication.mockReset();
  startRegistration.mockReset();
  platformAuthenticatorIsAvailable.mockReset();
  platformAuthenticatorIsAvailable.mockResolvedValue(true);
  cancelCeremony.mockReset();
  useUIStore.setState({ token: null, user: null });
  __resetPasskeyOfferMemoryForTests();
  localStorage.clear();
  sessionStorage.clear();
  try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
});

// ───────────────────────────────────────────────────────────────────────
describe('the walk-through after password + authenticator code', () => {
  it('prepares the offer BEFORE showing it — the grant is spent on a Bearer call, nothing is auto-invoked', async () => {
    const calls = mockFetchByPath(OFFER_ROUTES);
    await signInWithPasswordAndCode();

    expect(await screen.findByRole('heading', { name: 'Sign in faster next time' })).toBeInTheDocument();
    expect(screen.getByText('Use Face ID or Touch ID instead of your password and code.')).toBeInTheDocument();
    // Signed in already — the offer is a screen BEFORE the redirect.
    expect(useUIStore.getState().token).toBe('tok-1');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    // The grant went out once, on the fresh session, before the button existed.
    const opt = calls.find((c) => c.url === `${API_URL}/auth/passkeys/register/options`)!;
    expect(opt.body).toEqual({ enrollmentGrant: GRANT });
    expect(opt.headers.Authorization).toBe('Bearer tok-1');
    // Arriving on the screen does not touch the authenticator.
    expect(startRegistration).not.toHaveBeenCalled();

    // The primary control holds focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Set up passkey/i }));
  });

  it('"Set up passkey" calls create() SYNCHRONOUSLY inside the tap (Safari user gesture), then saves and continues', async () => {
    const calls = mockFetchByPath(OFFER_ROUTES);
    let resolveCreate: (v: unknown) => void = () => undefined;
    startRegistration.mockImplementation(() => new Promise((r) => { resolveCreate = r; }));
    await signInWithPasswordAndCode();
    const setUp = await screen.findByRole('button', { name: /Set up passkey/i });
    const callsBefore = calls.length;

    // NO act/await around the click: if anything were awaited in front of
    // create(), the mock would not have been called by the next line.
    fireEvent.click(setUp);
    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: CREATE_OPTIONS });
    expect(calls.length).toBe(callsBefore); // no request between tap and ceremony

    await act(async () => { resolveCreate(ATTESTATION); });

    expect(await screen.findByRole('heading', { name: 'Passkey saved' })).toBeInTheDocument();
    expect(
      screen.getByText('Next time, choose “Sign in with a passkey” and use Face ID or Touch ID.'),
    ).toBeInTheDocument();
    const verify = calls.find((c) => c.url === `${API_URL}/auth/passkeys/register/verify`)!;
    expect(verify.headers.Authorization).toBe('Bearer tok-1');
    expect(verify.body).toEqual({ response: ATTESTATION, label: 'Mac' });

    const cont = screen.getByRole('button', { name: /^Continue$/i });
    expect(document.activeElement).toBe(cont);
    fireEvent.click(cont);
    // REPLACE: our own history entry is swapped for the dashboard, so Back
    // from the dashboard lands where it always did.
    expect(replace).toHaveBeenCalledWith(DEST);
    expect(push).not.toHaveBeenCalled();
  });

  it('"Not now" continues and is remembered for 30 days — the next sign-in does not ask, or spend its grant', async () => {
    let calls = mockFetchByPath(OFFER_ROUTES);
    const { unmount } = render(<LoginPage />);
    await typePasswordAndSubmit();
    fireEvent.change(await screen.findByLabelText('Authentication code'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i })); });

    fireEvent.click(await screen.findByRole('button', { name: /^Not now$/i }));
    expect(replace).toHaveBeenCalledWith(DEST);
    expect(startRegistration).not.toHaveBeenCalled();
    expect(Number(localStorage.getItem(PASSKEY_OFFER_SNOOZE_KEY))).toBeGreaterThan(0);
    unmount();

    // A brand-new page (new session memory) on the same device.
    __resetPasskeyOfferMemoryForTests();
    sessionStorage.clear();
    push.mockReset();
    replace.mockReset();
    calls = mockFetchByPath(OFFER_ROUTES);
    await signInWithPasswordAndCode();
    await waitFor(() => { expect(push).toHaveBeenCalledWith(DEST); });
    expect(screen.queryByRole('heading', { name: 'Sign in faster next time' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/auth/passkeys/register/options'))).toBe(false);
  });

  it('Esc on the offer says what "Not now" says', async () => {
    mockFetchByPath(OFFER_ROUTES);
    await signInWithPasswordAndCode();
    await screen.findByRole('button', { name: /Set up passkey/i });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(replace).toHaveBeenCalledWith(DEST);
    expect(localStorage.getItem(PASSKEY_OFFER_SNOOZE_KEY)).not.toBeNull();
  });

  it('the browser Back button continues to the destination instead of stranding the operator', async () => {
    mockFetchByPath(OFFER_ROUTES);
    const pushState = jest.spyOn(window.history, 'pushState');
    await signInWithPasswordAndCode();
    await screen.findByRole('button', { name: /Set up passkey/i });
    // One entry of our own, so Back has something to pop.
    expect(pushState).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    // After Back our entry is already gone: the destination is PUSHED.
    expect(push).toHaveBeenCalledWith(DEST);
    pushState.mockRestore();
  });

  it('a dismissed device sheet: a calm note and Continue — never a dead end, never red', async () => {
    mockFetchByPath(OFFER_ROUTES);
    startRegistration.mockRejectedValue(domError('NotAllowedError'));
    const { container } = render(<LoginPage />);
    await typePasswordAndSubmit();
    fireEvent.change(await screen.findByLabelText('Authentication code'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verify & sign in/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Set up passkey/i })); });

    expect(
      await screen.findByText('No passkey was set up. You can add one anytime in Settings → My security.'),
    ).toBeInTheDocument();
    expect(container.querySelector('.bg-rose-50')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
    expect(replace).toHaveBeenCalledWith(DEST);
    // Not again this session — but NOT the 30-day "Not now" either.
    expect(sessionStorage.getItem(PASSKEY_OFFER_SESSION_KEY)).toBe('1');
    expect(localStorage.getItem(PASSKEY_OFFER_SNOOZE_KEY)).toBeNull();
  });

  it('a refused save: a plain message and Continue', async () => {
    mockFetchByPath({
      ...OFFER_ROUTES,
      '/auth/passkeys/register/verify': { ok: false, status: 401, body: { code: 'PASSKEY_VERIFICATION_FAILED' } },
    });
    startRegistration.mockResolvedValue(ATTESTATION);
    await signInWithPasswordAndCode();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Set up passkey/i })); });

    expect(
      await screen.findByText("We couldn't set up a passkey this time. You can add one later in Settings → My security."),
    ).toBeInTheDocument();
    // Still signed in: a refused SAVE is not a refused SESSION (this page
    // never takes apiFetch's sign-out-on-401 path).
    expect(useUIStore.getState().token).toBe('tok-1');
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
    expect(replace).toHaveBeenCalledWith(DEST);
  });

  it('a network failure mid-save is the same plain message and Continue', async () => {
    mockFetchByPath({ ...OFFER_ROUTES, '/auth/passkeys/register/verify': { reject: true } });
    startRegistration.mockResolvedValue(ATTESTATION);
    await signInWithPasswordAndCode();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Set up passkey/i })); });
    expect(await screen.findByText(/couldn't set up a passkey this time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Continue$/i })).toBeInTheDocument();
  });

  it('the grant is never written to browser storage', async () => {
    mockFetchByPath(OFFER_ROUTES);
    startRegistration.mockResolvedValue(ATTESTATION);
    await signInWithPasswordAndCode();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Set up passkey/i })); });
    await screen.findByRole('heading', { name: 'Passkey saved' });
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        expect(store.getItem(store.key(i) as string)).not.toContain(GRANT);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('a FIRST factor — the one-time backup codes come before Continue', () => {
  const CODES = Array.from({ length: 10 }, (_, i) => `CODE${i}XYZ`);

  it('shows the codes, holds them against Esc and Back, and continues only from the button', async () => {
    // A password-only account (no MFA): the passkey is now its first factor.
    mockFetchByPath({
      '/auth/login': { body: WITH_GRANT },
      '/auth/passkeys/register/options': { body: { options: CREATE_OPTIONS } },
      '/auth/passkeys/register/verify': { body: { passkey: { id: 'pk-1' }, backupCodes: CODES } },
    });
    startRegistration.mockResolvedValue(ATTESTATION);
    const pushState = jest.spyOn(window.history, 'pushState');

    await act(async () => { render(<LoginPage />); });
    await typePasswordAndSubmit();
    // No code was typed on this sign-in, so the body says "password" only.
    expect(await screen.findByText('Use Face ID or Touch ID instead of your password.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Set up passkey/i })); });

    expect(await screen.findByRole('heading', { name: 'Save your backup codes' })).toBeInTheDocument();
    for (const c of CODES) expect(screen.getByText(c)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(2); // the entry was re-armed
    expect(screen.getByText(CODES[0])).toBeInTheDocument();

    const saved = screen.getByRole('button', { name: /I've saved them/i });
    expect(document.activeElement).toBe(saved);
    fireEvent.click(saved);
    expect(replace).toHaveBeenCalledWith(DEST);
    pushState.mockRestore();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('no offer — straight to the dashboard, exactly as before', () => {
  it.each<[string, () => void, Record<string, Reply>]>([
    ['the device has no built-in authenticator', () => platformAuthenticatorIsAvailable.mockResolvedValue(false), {}],
    ['the browser has no WebAuthn at all', () => browserSupportsWebAuthn.mockReturnValue(false), {}],
    ['the sign-in carried no grant (the account has a passkey)', () => undefined, { '/auth/login': { body: SESSION } }],
    ['the account is behind the first-login setup gate', () => undefined, {
      '/auth/login': { body: { ...WITH_GRANT, user: { ...USER, mustSetupCredentials: true } } },
    }],
    ['"Not now" is in force on this device', () => localStorage.setItem(PASSKEY_OFFER_SNOOZE_KEY, String(Date.now())), {}],
  ])('%s', async (_what, arrange, overrides) => {
    arrange();
    const calls = mockFetchByPath({
      '/auth/login': { body: WITH_GRANT },
      '/auth/passkeys/register/options': { body: { options: CREATE_OPTIONS } },
      ...overrides,
    });
    await act(async () => { render(<LoginPage />); });
    await typePasswordAndSubmit();
    await waitFor(() => { expect(push).toHaveBeenCalledWith(DEST); });
    expect(screen.queryByRole('heading', { name: 'Sign in faster next time' })).not.toBeInTheDocument();
    // The grant was not spent on an offer nobody will see.
    expect(calls.some((c) => c.url.endsWith('/auth/passkeys/register/options'))).toBe(false);
  });

  it('options refused (expired or spent grant): straight on — the operator never sees a broken offer', async () => {
    mockFetchByPath({
      '/auth/login': { body: WITH_GRANT },
      '/auth/passkeys/register/options': { ok: false, status: 403, body: { code: 'PASSKEY_GRANT_INVALID' } },
    });
    await act(async () => { render(<LoginPage />); });
    await typePasswordAndSubmit();
    await waitFor(() => { expect(push).toHaveBeenCalledWith(DEST); });
    expect(screen.queryByRole('heading', { name: 'Sign in faster next time' })).not.toBeInTheDocument();
    // …and a 403 there never signed anyone out.
    expect(useUIStore.getState().token).toBe('tok-1');
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('"Sign in with a passkey" on a device that has none', () => {
  const GET_OPTIONS = { challenge: 'Y2hhbGw', rpId: 'venue-os.app' };

  it('no red banner — a calm hint that points at the password and promises the walk-through', async () => {
    mockFetchByPath({ '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } } });
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    const { container } = render(<LoginPage />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Sign in with a passkey/i }));
    });

    expect(
      await screen.findByText(
        "No passkey on this device yet? Sign in with your email and password, and we'll help you set up Face ID or Touch ID for next time.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('.bg-rose-50')).toBeNull();
    // The hint sits in a live region so it is announced.
    expect(screen.getByTestId('passkey-none-hint').parentElement).toHaveAttribute('aria-live', 'polite');
  });

  it('promises nothing when this device cannot hold a passkey', async () => {
    platformAuthenticatorIsAvailable.mockResolvedValue(false);
    mockFetchByPath({ '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } } });
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });
    expect(
      await screen.findByText('No passkey on this device yet? Sign in with your email and password instead.'),
    ).toBeInTheDocument();
  });

  it('the hint gives way to a real error, and clears when the password path is taken', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
      '/auth/login': { ok: false, status: 401, body: {} },
    });
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });
    await screen.findByTestId('passkey-none-hint');
    await typePasswordAndSubmit();
    expect(await screen.findByText('Invalid email or password. Please try again.')).toBeInTheDocument();
    expect(screen.queryByTestId('passkey-none-hint')).not.toBeInTheDocument();
  });

  it('a sign-in that genuinely FAILS says so in sign-in words — never "setting up"', async () => {
    mockFetchByPath({ '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } } });
    startAuthentication.mockRejectedValue(domError('UnknownError'));
    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });
    expect(
      await screen.findByText("Your device couldn't finish signing in with the passkey. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/setting up/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('passkey-none-hint')).not.toBeInTheDocument();
  });

  it('a wrong-address refusal is the translated sentence, not the server’s English', async () => {
    mockFetchByPath({
      '/auth/passkeys/login/options': {
        ok: false,
        status: 400,
        body: { code: 'PASSKEY_ORIGIN_NOT_ALLOWED', message: 'Passkeys are not available from this address.' },
      },
    });
    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });
    expect(
      await screen.findByText('Passkeys only work on the official VenueOS address. Check the web address and try again.'),
    ).toBeInTheDocument();
  });

  it('an unreachable server is a catalog sentence that still names the address', async () => {
    mockFetchByPath({ '/auth/passkeys/login/options': { reject: true } });
    await act(async () => { render(<LoginPage />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign in with a passkey/i }));
    });
    expect(
      await screen.findByText(`Can't reach the server at ${API_URL}. If this keeps happening, contact your administrator.`),
    ).toBeInTheDocument();
  });
});
