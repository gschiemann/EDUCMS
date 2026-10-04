/**
 * Identifier-first sign-in — the page (2026-10-04).
 *
 * Owner: "the sign in seems so confusing, so many options… can't you just show
 * what's enabled for the user". These tests are the standard:
 *
 *   STEP 1   one field (the email) and Continue. Nothing else to decide.
 *   STEP 2   what applies to that email's DOMAIN — the password form, or a
 *            single sign-on button with the password one link away.
 *
 * and the four things that must not regress with it: the lookup can never
 * block a sign-in, the EULA click-through is exactly as binding as before for
 * a browser that has not accepted, the passkey autofill request never gets in
 * the way of anything, and the typed address stays out of the URL and out of
 * localStorage.
 *
 * The page talks to the API through the global `fetch`; it is mocked here and
 * asserted by exact URL + body. `@simplewebauthn/browser` is mocked because
 * jsdom has no authenticator.
 */
import { createHash, webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const push = jest.fn();
let search = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
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
const browserSupportsWebAuthnAutofill = jest.fn();
const startAuthentication = jest.fn();
const cancelCeremony = jest.fn();
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: (...a: unknown[]) => browserSupportsWebAuthn(...a),
  browserSupportsWebAuthnAutofill: (...a: unknown[]) => browserSupportsWebAuthnAutofill(...a),
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
  startRegistration: jest.fn(),
  platformAuthenticatorIsAvailable: () => Promise.resolve(false),
  WebAuthnAbortService: { cancelCeremony: (...a: unknown[]) => cancelCeremony(...a) },
}));

// jsdom cannot navigate; observe the one place the page leaves for the
// identity provider. Everything else in the module is the real thing.
const leaveForSingleSignOn = jest.fn();
jest.mock('@/lib/sign-in-steps', () => ({
  ...jest.requireActual('@/lib/sign-in-steps'),
  leaveForSingleSignOn: (...a: unknown[]) => leaveForSingleSignOn(...a),
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

type Reply = { ok?: boolean; status?: number; body?: unknown; reject?: boolean; hang?: boolean };
type Call = { url: string; body: any };

function mockFetchByPath(routes: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  (global as any).fetch = jest.fn((url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    const r: Reply = key ? routes[key] : { ok: false, status: 404, body: {} };
    if (r.reject) return Promise.reject(new TypeError('Failed to fetch'));
    if (r.hang) return new Promise(() => undefined);
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body ?? {}),
    });
  });
  return calls;
}

const EULA_KEY = 'edu_cms_eula_accepted_v1.0';
const EULA_PENDING_KEY = 'venueos_eula_pending_v1.0';
const KEEP_KEY = 'venueos_keep_signed_in.v1';
/** The account's WebAuthn user handle, as the API mints it and an assertion reports it. */
const userHandle = (userId: string) => createHash('sha256').update(userId).digest('base64url');

// jsdom has neither WebCrypto's `subtle` nor TextEncoder; a real browser on a
// secure origin has both (`lib/keep-signed-in.ts` hashes the user id with them).
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  (globalThis as { TextEncoder?: unknown }).TextEncoder = NodeTextEncoder;
});
const SESSION = {
  access_token: 'tok-1',
  user: { id: 'u1', email: 'pat@elsewhere.example', role: 'SCHOOL_ADMIN', tenantSlug: 'lincoln', tenantId: 't1' },
};
const NO_SSO: Reply = { body: { password: true, sso: null } };
const SSO_GOOGLE: Reply = {
  body: { password: true, sso: { tenantSlug: 'northfield', provider: 'oidc', label: 'Google' } },
};
const optionsCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/auth/sign-in-options'));
const loginCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/auth/login'));

async function renderPage() {
  await act(async () => { render(<LoginPage />); });
}

async function continueWith(email: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  });
}

beforeEach(() => {
  search = '';
  push.mockReset();
  leaveForSingleSignOn.mockReset();
  adoptRememberedSession.mockReset();
  adoptRememberedSession.mockResolvedValue(true);
  browserSupportsWebAuthn.mockReset();
  browserSupportsWebAuthn.mockReturnValue(true);
  browserSupportsWebAuthnAutofill.mockReset();
  browserSupportsWebAuthnAutofill.mockResolvedValue(false);
  startAuthentication.mockReset();
  cancelCeremony.mockReset();
  useUIStore.setState({ token: null, user: null });
  localStorage.clear();
  sessionStorage.clear();
  // A returning browser unless a test says otherwise.
  localStorage.setItem(EULA_KEY, 'yes');
});

// ───────────────────────────────────────────────────────────────────────
describe('STEP 1 — one field', () => {
  it('shows the email and Continue — and none of what used to crowd the page', async () => {
    mockFetchByPath({});
    await renderPage();

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    // What makes the browser offer a passkey from this field's own autofill.
    expect(email).toHaveAttribute('autocomplete', 'username webauthn');
    expect(document.activeElement).toBe(email);
    expect(screen.getByRole('button', { name: /^Continue$/ })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('link', { name: 'Create a workspace' })).toBeInTheDocument();

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Forgot password/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sign in$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SSO|single sign-on/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/End User License Agreement/i)).not.toBeInTheDocument();
    // Exactly one submit control on the step.
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('first-time browser: step 1 is identical — no EULA checkbox, no passkey link', async () => {
    localStorage.removeItem(EULA_KEY);
    mockFetchByPath({});
    await renderPage();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /passkey/i })).not.toBeInTheDocument();
    // The card holds exactly one control to press.
    expect(document.querySelectorAll('.rounded-2xl button')).toHaveLength(1);
  });

  it('Continue with nothing typed asks nobody anything', async () => {
    const calls = mockFetchByPath({});
    await renderPage();
    await act(async () => { fireEvent.submit(screen.getByTestId('sign-in-step-email')); });
    expect(calls).toHaveLength(0);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('Enter in the field is Continue', async () => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    await renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@elsewhere.example' } });
    await act(async () => { fireEvent.submit(screen.getByLabelText('Email').closest('form')!); });
    expect(optionsCalls(calls)).toHaveLength(1);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('STEP 2 — password', () => {
  it('asks the API about the address (normalised) and opens the password form', async () => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('  Pat@Elsewhere.Example ');

    expect(optionsCalls(calls)).toEqual([
      { url: `${API_URL}/auth/sign-in-options`, body: { email: 'pat@elsewhere.example' } },
    ]);

    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(document.activeElement).toBe(password);
    // The address, read-only, with the way back.
    expect(screen.getByTestId('sign-in-email')).toHaveTextContent('pat@elsewhere.example');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change email address' })).toHaveTextContent('Change');
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/reset-password/request');
    // One primary action; step 1's extras are gone.
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Sign in$/ })).toHaveAttribute('type', 'submit');
    expect(screen.queryByRole('link', { name: 'Create a workspace' })).not.toBeInTheDocument();
    // The change is announced politely.
    expect(screen.getByTestId('sign-in-step-announcement')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('sign-in-step-announcement')).toHaveTextContent(
      'Enter the password for pat@elsewhere.example.',
    );

    fireEvent.change(password, { target: { value: 'hunter2hunter2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    expect(loginCalls(calls)).toEqual([
      {
        url: `${API_URL}/auth/login`,
        body: { email: 'pat@elsewhere.example', password: 'hunter2hunter2', rememberMe: false },
      },
    ]);
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');
  });

  it('"Keep me signed in" starts unticked every visit, and a finished sign-in remembers the choice for THAT account', async () => {
    // Even on a browser where someone chose it before.
    localStorage.setItem(KEEP_KEY, JSON.stringify([userHandle('someone-else')]));
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    const keep = screen.getByRole('checkbox', { name: 'Keep me signed in' });
    expect(keep).not.toBeChecked();
    fireEvent.click(keep);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    expect(loginCalls(calls)[0].body.rememberMe).toBe(true);
    expect(adoptRememberedSession).toHaveBeenCalledWith('tok-1');
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(KEEP_KEY) as string)).toEqual([
        userHandle('u1'),
        userHandle('someone-else'),
      ]);
    });
    // A hash of the id — never the id or the address.
    expect(localStorage.getItem(KEEP_KEY)).not.toContain('pat@');
  });

  it('signing in with the box left unticked forgets that account\'s earlier choice', async () => {
    localStorage.setItem(KEEP_KEY, JSON.stringify([userHandle('u1')]));
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    await waitFor(() => { expect(localStorage.getItem(KEEP_KEY)).toBeNull(); });
    expect(adoptRememberedSession).not.toHaveBeenCalled();
  });

  it('a wrong password is announced (role="alert") and stays on the password step', async () => {
    mockFetchByPath({
      '/auth/sign-in-options': NO_SSO,
      '/auth/login': { ok: false, status: 401, body: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' } },
    });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope-nope' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(useUIStore.getState().token).toBeNull();
  });

  it('"Forgot password?" carries the address to the reset page — through sessionStorage, not the URL', async () => {
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    const link = await screen.findByRole('link', { name: 'Forgot password?' });
    expect(link.getAttribute('href')).not.toContain('pat');
    fireEvent.click(link);
    expect(sessionStorage.getItem('venueos_reset_email')).toBe('pat@elsewhere.example');
  });

  it('"Change" returns to step 1 with the address still in the field, and the password gone', async () => {
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'typed-then-left' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change email address' })); });

    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('pat@elsewhere.example');
    expect(document.activeElement).toBe(email);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    // …and going forward again starts with an empty password.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/ })); });
    expect(await screen.findByLabelText('Password')).toHaveValue('');
  });

  it("the browser's Back returns to step 1 — one history entry, no URL change", async () => {
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    const pushState = jest.spyOn(window.history, 'pushState');
    try {
      await renderPage();
      expect(pushState).not.toHaveBeenCalled();
      await continueWith('pat@elsewhere.example');
      await screen.findByLabelText('Password');
      expect(pushState).toHaveBeenCalledTimes(1);
      // (state, unused) — no third argument: the URL is not touched.
      expect(pushState.mock.calls[0]).toHaveLength(2);

      act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
      expect(screen.getByLabelText('Email')).toHaveValue('pat@elsewhere.example');
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    } finally {
      pushState.mockRestore();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('STEP 2 — single sign-on, decided by the domain alone', () => {
  it('names the provider, starts SSO at the API, and keeps the password one link away', async () => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': SSO_GOOGLE });
    await renderPage();
    await continueWith('teacher@northfield.example');

    const sso = await screen.findByRole('button', { name: 'Continue with Google' });
    expect(sso).toHaveAttribute('type', 'submit');
    expect(document.activeElement).toBe(sso);
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByTestId('sign-in-email')).toHaveTextContent('teacher@northfield.example');
    expect(screen.getByTestId('sign-in-step-announcement')).toHaveTextContent(
      'Single sign-on is available for teacher@northfield.example.',
    );

    await act(async () => { fireEvent.click(sso); });
    expect(leaveForSingleSignOn).toHaveBeenCalledWith(`${API_URL}/auth/sso/northfield/oidc/login`);
    expect(loginCalls(calls)).toHaveLength(0);
  });

  it('a provider the server cannot name gets the plain wording', async () => {
    mockFetchByPath({
      '/auth/sign-in-options': { body: { password: true, sso: { tenantSlug: 'northfield', provider: 'saml', label: null } } },
    });
    await renderPage();
    await continueWith('teacher@northfield.example');
    const sso = await screen.findByRole('button', { name: 'Continue with single sign-on' });
    await act(async () => { fireEvent.click(sso); });
    expect(leaveForSingleSignOn).toHaveBeenCalledWith(`${API_URL}/auth/sso/northfield/saml/login`);
  });

  it('"Use a password instead" reveals the password form, which signs in as usual', async () => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': SSO_GOOGLE, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('teacher@northfield.example');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Use a password instead' }));
    });

    const password = screen.getByLabelText('Password');
    expect(document.activeElement).toBe(password);
    // Still one primary action.
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument();
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(1);

    fireEvent.change(password, { target: { value: 'hunter2hunter2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    expect(loginCalls(calls)[0].body.email).toBe('teacher@northfield.example');
    expect(leaveForSingleSignOn).not.toHaveBeenCalled();
  });

  it('an organization that does not allow a password: single sign-on only, no link to a form that cannot work', async () => {
    mockFetchByPath({
      '/auth/sign-in-options': {
        body: { password: false, sso: { tenantSlug: 'northfield', provider: 'oidc', label: 'Google' } },
      },
    });
    await renderPage();
    await continueWith('teacher@northfield.example');
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(screen.queryByRole('button', { name: 'Use a password instead' })).not.toBeInTheDocument();
    // "Change" is still the way back.
    expect(screen.getByRole('button', { name: 'Change email address' })).toBeInTheDocument();
  });

  it('an answer that is not the documented shape is "no single sign-on", not a broken step', async () => {
    mockFetchByPath({
      '/auth/sign-in-options': { body: { password: true, sso: { tenantSlug: '../../evil', provider: 'oidc' } } },
    });
    await renderPage();
    await continueWith('teacher@northfield.example');
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('the lookup can never block a sign-in', () => {
  it.each<[string, Reply]>([
    ['a network failure', { reject: true }],
    ['a 500', { ok: false, status: 500 }],
    ['a 429 from the throttle', { ok: false, status: 429 }],
    ['an API that predates the endpoint (404)', { ok: false, status: 404 }],
  ])('%s → the password form', async (_name, reply) => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': reply, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('pat@elsewhere.example');

    const password = await screen.findByLabelText('Password');
    // Nothing red: the operator did nothing wrong.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(password, { target: { value: 'hunter2hunter2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    expect(loginCalls(calls)).toHaveLength(1);
  });

  it('a lookup that never answers gives way to the password form after 3 seconds', async () => {
    jest.useFakeTimers();
    try {
      mockFetchByPath({ '/auth/sign-in-options': { hang: true } });
      await renderPage();
      await continueWith('pat@elsewhere.example');

      // Waiting: still step 1, Continue busy, nothing to type a password into
      // — and nothing on the page jumps (the field keeps focus, the line
      // under the card stays).
      expect(screen.getByRole('button', { name: /^Continue$/ })).toBeDisabled();
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Email')).not.toHaveAttribute('readonly');
      expect(document.activeElement).toBe(screen.getByLabelText('Email'));
      expect(screen.getByRole('link', { name: 'Create a workspace' })).toBeInTheDocument();
      // Edits are ignored while it is in flight: the answer is for THIS address.
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone.else@elsewhere.example' } });
      expect(screen.getByLabelText('Email')).toHaveValue('pat@elsewhere.example');

      await act(async () => { await jest.advanceTimersByTimeAsync(2_999); });
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
      await act(async () => { await jest.advanceTimersByTimeAsync(1); });
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('NOT AN ORACLE — step 2 is the same for any address at a domain', () => {
  it('two different addresses at one domain render byte-identical step 2 (apart from the address itself)', async () => {
    const stepTwo = async (email: string) => {
      mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
      const { container, unmount } = render(<LoginPage />);
      await act(async () => { await Promise.resolve(); });
      await continueWith(email);
      await screen.findByLabelText('Password');
      const html = container.querySelector('.rounded-2xl')!.innerHTML.split(email).join('<EMAIL>');
      unmount();
      return html;
    };
    const known = await stepTwo('real.admin@elsewhere.example');
    const unknown = await stepTwo('nobody-000@elsewhere.example');
    expect(unknown).toBe(known);
  });

  it('sends the lookup nothing but the address', async () => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    await screen.findByLabelText('Password');
    expect(Object.keys(optionsCalls(calls)[0].body)).toEqual(['email']);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('the address stays in memory', () => {
  it('no field on either step has a `name` — a submit that beats hydration must carry nothing into the URL', async () => {
    // A form submitted before React hydrates is a NATIVE GET to this URL, and
    // a GET serialises every NAMED control into the query string. Unnamed
    // fields are how a typed address (or password) can never end up in the
    // address bar, the history or a server log that way.
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    localStorage.removeItem(EULA_KEY);
    await renderPage();
    const named = () => Array.from(document.querySelectorAll('form input[name], form button[name]'));
    expect(named()).toEqual([]);
    expect(screen.getByTestId('sign-in-step-email')).not.toHaveAttribute('action');
    await continueWith('pat@elsewhere.example');
    await screen.findByLabelText('Password');
    expect(named()).toEqual([]);
    expect(screen.getByTestId('sign-in-step-password')).not.toHaveAttribute('action');
  });

  it('is never written to the URL or to localStorage on the way to step 2', async () => {
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    const before = window.location.href;
    await renderPage();
    await continueWith('pat@elsewhere.example');
    await screen.findByLabelText('Password');

    expect(window.location.href).toBe(before);
    const stored = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n');
    expect(stored).not.toContain('pat@elsewhere.example');
    expect(sessionStorage.length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('EULA — as binding as before for a new browser, not repeated for a returning one', () => {
  it('FIRST TIME: the checkbox is on step 2, unticked, and nothing signs in without it', async () => {
    localStorage.removeItem(EULA_KEY);
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });

    const box = screen.getByRole('checkbox', { name: /End User License Agreement/i });
    expect(box).not.toBeChecked();
    // LOCK 1 — the browser itself will not submit the form without it.
    expect(box).toBeRequired();
    expect(screen.queryByTestId('eula-accepted-note')).not.toBeInTheDocument();

    // Pressing the button (the browser validates, the form does not submit):
    // OUR message, announced — not the browser's bubble, and not silence.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/must accept the End User License Agreement/i);
    expect(loginCalls(calls)).toHaveLength(0);
    expect(localStorage.getItem(EULA_KEY)).toBeNull();

    // Ticking it clears the message…
    fireEvent.click(box);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // …and the sign-in goes through.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    expect(loginCalls(calls)).toHaveLength(1);
    // Recorded only once the sign-in actually finished — the same three keys as ever.
    expect(localStorage.getItem(EULA_KEY)).toBe('yes');
    expect(localStorage.getItem(`${EULA_KEY}_by`)).toBe('pat@elsewhere.example');
    expect(localStorage.getItem(`${EULA_KEY}_at`)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('FIRST TIME: LOCK 2 — a submit that gets past the browser is still refused by the handler', async () => {
    localStorage.removeItem(EULA_KEY);
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });

    // `fireEvent.submit` dispatches the submit event directly — no constraint
    // validation — which is what a script or a `novalidate` form would do.
    await act(async () => { fireEvent.submit(screen.getByTestId('sign-in-step-password')); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/must accept the End User License Agreement/i);
    expect(loginCalls(calls)).toHaveLength(0);
    expect(useUIStore.getState().token).toBeNull();
  });

  it('FIRST TIME: a failed sign-in records no acceptance', async () => {
    localStorage.removeItem(EULA_KEY);
    mockFetchByPath({
      '/auth/sign-in-options': NO_SSO,
      '/auth/login': { ok: false, status: 401, body: { message: 'Invalid credentials' } },
    });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'wrong-wrong' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /End User License Agreement/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    await screen.findByRole('alert');
    expect(localStorage.getItem(EULA_KEY)).toBeNull();
  });

  it('FIRST TIME, single sign-on: the same checkbox gates leaving for the provider', async () => {
    localStorage.removeItem(EULA_KEY);
    mockFetchByPath({ '/auth/sign-in-options': SSO_GOOGLE });
    await renderPage();
    await continueWith('teacher@northfield.example');
    const sso = await screen.findByRole('button', { name: 'Continue with Google' });
    const eula = screen.getByRole('checkbox', { name: /End User License Agreement/i });
    expect(eula).toBeRequired();
    // The step's first field: it takes the focus (there is nothing to type here).
    expect(document.activeElement).toBe(eula);

    await act(async () => { fireEvent.click(sso); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/must accept the End User License Agreement/i);
    expect(leaveForSingleSignOn).not.toHaveBeenCalled();
    // The handler's own lock, for a submit that gets past the browser.
    await act(async () => { fireEvent.submit(screen.getByTestId('sign-in-step-sso')); });
    expect(leaveForSingleSignOn).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /End User License Agreement/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })); });
    expect(leaveForSingleSignOn).toHaveBeenCalledTimes(1);
    // The sign-in has NOT finished yet — it finishes on /login/sso-complete,
    // after the identity provider. The tick is parked for that page; nothing
    // is recorded here.
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(localStorage.getItem(EULA_KEY)).toBeNull();
  });

  it('RETURNING, single sign-on: nothing to park — the quiet line, and straight on', async () => {
    mockFetchByPath({ '/auth/sign-in-options': SSO_GOOGLE });
    await renderPage();
    await continueWith('teacher@northfield.example');
    const sso = await screen.findByRole('button', { name: 'Continue with Google' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('eula-accepted-note')).toBeInTheDocument();
    await act(async () => { fireEvent.click(sso); });
    expect(leaveForSingleSignOn).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).toBeNull();
  });

  it('a tick parked by a single sign-on that never finished is dropped on the next visit', async () => {
    localStorage.removeItem(EULA_KEY);
    sessionStorage.setItem(EULA_PENDING_KEY, '2026-10-04T12:00:00.000Z');
    mockFetchByPath({});
    await renderPage();
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).toBeNull();
  });

  it('RETURNING: no checkbox at all — one quiet line with the link, under the button', async () => {
    const calls = mockFetchByPath({ '/auth/sign-in-options': NO_SSO, '/auth/login': { body: SESSION } });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    await screen.findByLabelText('Password');

    expect(screen.queryByRole('checkbox', { name: /End User License Agreement/i })).not.toBeInTheDocument();
    const note = screen.getByTestId('eula-accepted-note');
    // (The link inside the sentence is asserted in the browser — the jest
    // next-intl stub renders rich text without its tag handlers.)
    expect(note).toHaveTextContent('You agreed to the End User License Agreement on this device.');
    const button = screen.getByRole('button', { name: /^Sign in$/ });
    expect(button.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => { expect(loginCalls(calls)).toHaveLength(1); });
  });

  it('a different EULA version on this browser is not an acceptance', async () => {
    localStorage.clear();
    localStorage.setItem('edu_cms_eula_accepted_v0.9', 'yes');
    mockFetchByPath({ '/auth/sign-in-options': NO_SSO });
    await renderPage();
    await continueWith('pat@elsewhere.example');
    await screen.findByLabelText('Password');
    expect(screen.getByRole('checkbox', { name: /End User License Agreement/i })).not.toBeChecked();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('passkeys — from the email field, never in the way', () => {
  const GET_OPTIONS = { challenge: 'Y2hhbGw', rpId: 'venue-os.app' };
  // A discoverable credential's assertion names its account by user handle.
  const ASSERTION = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { userHandle: userHandle('u1') } };
  const passkeyOptionCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/auth/passkeys/login/options'));

  /** A conditional request that stays pending until the test settles it. */
  function pendingAutofill() {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    startAuthentication.mockImplementation(
      () => new Promise((res, rej) => { resolve = res; reject = rej; }),
    );
    return { pick: (v: unknown) => resolve(v), abort: () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) };
  }

  it('where the browser has passkey autofill: a pending conditional request, and NO passkey control on the page', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    pendingAutofill();
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
    });
    await renderPage();

    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    // The discoverable request — no email, so it cannot say who has a passkey.
    expect(passkeyOptionCalls(calls)).toEqual([{ url: `${API_URL}/auth/passkeys/login/options`, body: {} }]);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS, useBrowserAutofill: true });
    expect(screen.queryByRole('button', { name: /passkey/i })).not.toBeInTheDocument();
    // Nothing was submitted on anyone's behalf.
    expect(calls.some((c) => c.url.endsWith('/auth/passkeys/login/verify'))).toBe(false);
    expect(useUIStore.getState().token).toBeNull();
  });

  it('picking a passkey from the autofill signs in — a normal session unless THIS account chose otherwise', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    // Someone ELSE ticked "Keep me signed in" on this browser. Not this account.
    localStorage.setItem(KEEP_KEY, JSON.stringify([userHandle('someone-else')]));
    const autofill = pendingAutofill();
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    await renderPage();
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    await act(async () => { autofill.pick(ASSERTION); });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    const verify = calls.find((c) => c.url.endsWith('/auth/passkeys/login/verify'))!;
    expect(verify.body).toEqual({ challengeId: 'ch-1', response: ASSERTION, rememberMe: false });
    expect(adoptRememberedSession).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');
    // The session exists — the autofill request is not armed again on the way out.
    expect(startAuthentication).toHaveBeenCalledTimes(1);
  });

  it('…and keeps the account signed in when it last chose that on this browser', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    localStorage.setItem(KEEP_KEY, JSON.stringify([userHandle('u1')]));
    const autofill = pendingAutofill();
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
      '/auth/passkeys/login/verify': { body: SESSION },
    });
    await renderPage();
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });

    await act(async () => { autofill.pick(ASSERTION); });

    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    const verify = calls.find((c) => c.url.endsWith('/auth/passkeys/login/verify'))!;
    expect(verify.body).toEqual({ challengeId: 'ch-1', response: ASSERTION, rememberMe: true });
    expect(adoptRememberedSession).toHaveBeenCalledWith('tok-1');
    expect(push).toHaveBeenCalledWith('/lincoln/dashboard');
    // No email was ever typed, and no lookup was made.
    expect(optionsCalls(calls)).toHaveLength(0);
  });

  it('a password sign-in after a passkey attempt follows the CHECKBOX, not the passkey\'s remembered choice', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    localStorage.setItem(KEEP_KEY, JSON.stringify([userHandle('u1')]));
    const autofill = pendingAutofill();
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
      '/auth/passkeys/login/verify': { ok: false, status: 401, body: { code: 'PASSKEY_VERIFICATION_FAILED' } },
      '/auth/sign-in-options': NO_SSO,
      '/auth/login': { body: SESSION },
    });
    await renderPage();
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    await act(async () => { autofill.pick(ASSERTION); });
    await screen.findByRole('alert');

    await continueWith('pat@elsewhere.example');
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in' })).not.toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ })); });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-1'); });
    expect(loginCalls(calls)[0].body.rememberMe).toBe(false);
    expect(adoptRememberedSession).not.toHaveBeenCalled();
  });

  it('Continue ABORTS the pending request — it must never sit in front of a later ceremony', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    pendingAutofill();
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
      '/auth/sign-in-options': NO_SSO,
    });
    await renderPage();
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    expect(cancelCeremony).not.toHaveBeenCalled();

    await continueWith('pat@elsewhere.example');
    await screen.findByLabelText('Password');
    expect(cancelCeremony).toHaveBeenCalledTimes(1);
    // …and it is not re-armed on step 2.
    expect(startAuthentication).toHaveBeenCalledTimes(1);
    expect(passkeyOptionCalls(calls)).toHaveLength(1);
  });

  it('leaving the page aborts it too', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    pendingAutofill();
    mockFetchByPath({ '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } } });
    let unmount!: () => void;
    await act(async () => { ({ unmount } = render(<LoginPage />)); });
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    unmount();
    expect(cancelCeremony).toHaveBeenCalledTimes(1);
  });

  it('an aborted request is silent — no banner, no hint', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    const autofill = pendingAutofill();
    mockFetchByPath({ '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } } });
    await renderPage();
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    await act(async () => { autofill.abort(); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('passkey-none-hint')).not.toBeInTheDocument();
  });

  it('a refused or throttled options call means no autofill — and no error on a page nobody has touched', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    mockFetchByPath({ '/auth/passkeys/login/options': { ok: false, status: 429, body: {} } });
    await renderPage();
    await act(async () => { await Promise.resolve(); });
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a picked passkey the server refuses says so, and autofill is armed again', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    const autofill = pendingAutofill();
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
      '/auth/passkeys/login/verify': { ok: false, status: 401, body: { code: 'PASSKEY_VERIFICATION_FAILED' } },
    });
    await renderPage();
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(1); });
    await act(async () => { autofill.pick(ASSERTION); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/That passkey wasn't accepted/i);
    await waitFor(() => { expect(startAuthentication).toHaveBeenCalledTimes(2); });
    expect(passkeyOptionCalls(calls)).toHaveLength(2);
    expect(useUIStore.getState().token).toBeNull();
  });

  it('FIRST-TIME browser: not armed at all — a passkey is not a way around the EULA', async () => {
    localStorage.removeItem(EULA_KEY);
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    const calls = mockFetchByPath({
      '/auth/passkeys/login/options': { body: { options: GET_OPTIONS, challengeId: 'ch-1' } },
    });
    await renderPage();
    await act(async () => { await Promise.resolve(); });
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('where the browser has NO passkey autofill: one quiet link, and no pending request', async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(false);
    const calls = mockFetchByPath({});
    await renderPage();
    const link = await screen.findByRole('button', { name: 'Sign in with a passkey' });
    expect(link).toHaveAttribute('type', 'button');
    // Low emphasis: a text link, not a second boxed button — and no explainer.
    expect(link.className).not.toMatch(/\bborder\b|bg-indigo-600/);
    expect(screen.queryByText(/No passkey on this device/i)).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(startAuthentication).not.toHaveBeenCalled();
    // Still exactly one primary action.
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('a browser with no WebAuthn sees neither', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    const calls = mockFetchByPath({});
    await renderPage();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: /passkey/i })).not.toBeInTheDocument();
    expect(browserSupportsWebAuthnAutofill).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('the manual single sign-on entry — by URL only', () => {
  it('nothing on the normal page leads to it', async () => {
    mockFetchByPath({});
    await renderPage();
    expect(screen.queryByLabelText('Organization slug')).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="sso"]')).toBeNull();
  });

  it('/login?sso=1 shows the organization entry and starts SSO as it always did', async () => {
    search = 'sso=1';
    const calls = mockFetchByPath({
      '/auth/sso/northfield/config-public': { body: { enabled: true, provider: 'OIDC', tenantSlug: 'northfield' } },
    });
    await renderPage();
    const slug = screen.getByLabelText('Organization slug');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(1);

    fireEvent.change(slug, { target: { value: 'northfield' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' })); });
    expect(calls[0].url).toBe(`${API_URL}/auth/sso/northfield/config-public`);
    await waitFor(() => {
      expect(leaveForSingleSignOn).toHaveBeenCalledWith(`${API_URL}/auth/sso/northfield/oidc/login`);
    });
  });

  it('…behind the same EULA gate as every other way in', async () => {
    search = 'sso=1';
    localStorage.removeItem(EULA_KEY);
    const calls = mockFetchByPath({
      '/auth/sso/northfield/config-public': { body: { enabled: true, provider: 'OIDC', tenantSlug: 'northfield' } },
    });
    await renderPage();
    fireEvent.change(screen.getByLabelText('Organization slug'), { target: { value: 'northfield' } });
    const box = screen.getByRole('checkbox', { name: /End User License Agreement/i });
    expect(box).toBeRequired();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/must accept the End User License Agreement/i);
    await act(async () => { fireEvent.submit(screen.getByLabelText('Organization slug').closest('form')!); });
    expect(calls).toHaveLength(0);
    expect(leaveForSingleSignOn).not.toHaveBeenCalled();

    fireEvent.click(box);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' })); });
    await waitFor(() => { expect(leaveForSingleSignOn).toHaveBeenCalledTimes(1); });
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).not.toBeNull();
    expect(localStorage.getItem(EULA_KEY)).toBeNull();
  });

  it('an organization with no single sign-on gets a translated, announced message', async () => {
    search = 'sso=1';
    mockFetchByPath({ '/auth/sso/nowhere/config-public': { body: { enabled: false } } });
    await renderPage();
    fireEvent.change(screen.getByLabelText('Organization slug'), { target: { value: 'nowhere' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Single sign-on is not set up for “nowhere”.');
    expect(leaveForSingleSignOn).not.toHaveBeenCalled();
  });
});
