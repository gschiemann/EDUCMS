/**
 * "SET UP A PASSKEY ON THIS PHONE" — the second step on a phone, RTL proof
 * (2026-10-05).
 *
 * Owner, on his iPhone (his only passkey was made on his Mac): "Takes the
 * username, takes the password, then says use your passkey and I click that
 * and it just pops up a QR code, I X off of that and you give me 3 more
 * options but I just want to create a passkey on my phone and get logged in."
 *
 *   password → { mfaRequired, mfaMethods:['passkey'], mfaFallbacks:['backup','email'] }
 *     → TWO equal choices, before any sheet: "Use your passkey" /
 *       "Set up a passkey on this iPhone"
 *     → set up: the emailed code goes out AT ONCE → the code
 *       (`autocomplete="one-time-code"`) → Continue → signed in
 *     → "Turn on Face ID or Touch ID sign-in for this iPhone" — ONE button,
 *       create() inside the tap → saved → straight to the dashboard
 *     → cancelled → still signed in, one line: add it later in Settings
 *     → this device remembers; the next sign-in here shows only "Use your passkey".
 *
 * Every API call is the global `fetch` (mocked by URL); `@simplewebauthn/
 * browser` is mocked because jsdom has no authenticator. WebCrypto is
 * installed so the per-device memory (`lib/passkey-on-device.ts`) is real.
 */
import { webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';

const push = jest.fn();
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(''),
}));

jest.mock('@/lib/client-logger', () => ({
  clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/session-client', () => ({
  adoptRememberedSession: () => Promise.resolve(true),
  hasRememberMarker: () => false,
  refreshRememberedSession: () => Promise.resolve(false),
}));

const startAuthentication = jest.fn();
const startRegistration = jest.fn();
const platformAuthenticatorIsAvailable = jest.fn();
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: () => Promise.resolve(false),
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
  startRegistration: (...a: unknown[]) => startRegistration(...a),
  platformAuthenticatorIsAvailable: (...a: unknown[]) => platformAuthenticatorIsAvailable(...a),
  WebAuthnAbortService: { cancelCeremony: () => undefined },
}));

import LoginPage from '../page';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { __resetPasskeyOfferMemoryForTests, PASSKEY_OFFER_SESSION_KEY } from '@/lib/passkey-offer';
import { passkeyRememberedOnDevice, rememberPasskeyOnDevice } from '@/lib/passkey-on-device';

type Reply = { ok?: boolean; status?: number; body?: unknown };
type Call = { url: string; body: Record<string, unknown> | undefined; headers: Record<string, string> };

/** Route replies by URL suffix, longest match first; a route may be a queue. */
function mockFetchByPath(routes: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init?: RequestInit) => {
    if (!String(url).endsWith('/auth/sign-in-options')) {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
    }
    const key = keys.find((k) => String(url).endsWith(k));
    const route = key ? routes[key] : undefined;
    const r: Reply = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]) : route ?? { ok: false, status: 404, body: {} };
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body ?? {}),
    });
  });
  return calls;
}

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  // iPadOS Safari's default "desktop site" user agent.
  macOrIpad:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};
const EMAIL = 'owner@venueos.example';
const GRANT = 'Gr4nt_' + 'x'.repeat(35) + '-9';
const USER = { id: 'u1', email: EMAIL, role: 'SUPER_ADMIN', tenantSlug: 'hq', tenantId: 't1' };
const SESSION = { access_token: 'tok-email', user: USER };
const SESSION_WITH_GRANT = { ...SESSION, passkeyEnrollment: { grant: GRANT, expiresAt: '2026-10-05T12:10:00Z' } };
const CHALLENGE = 'C'.repeat(43);
const GET_OPTIONS = { challenge: 'Y2hhbGw', rpId: 'venue-os.app' };
const CREATE_OPTIONS = { challenge: 'Y3JlYXRl', rp: { id: 'venue-os.app', name: 'VenueOS' }, user: { id: 'dXNlcg', name: 'a', displayName: 'A' } };
const DEST = '/hq/dashboard';

/** The owner's account: one passkey (on his Mac), backup codes, mail configured. */
const OWNER_LOGIN = { mfaRequired: true, mfaToken: 'mfa-1', mfaMethods: ['passkey'], mfaFallbacks: ['backup', 'email'] };

/** Everything the set-up path calls, in a happy shape. */
const SETUP_ROUTES = (): Record<string, Reply | Reply[]> => ({
  '/auth/login': { body: OWNER_LOGIN },
  '/auth/mfa/challenge/passkey/options': { body: { options: GET_OPTIONS } },
  '/auth/mfa/challenge/email/send': { body: { challenge: CHALLENGE, expiresAt: '2026-10-05T12:10:00Z' } },
  '/auth/mfa/challenge/email': { body: SESSION_WITH_GRANT },
  '/auth/passkeys/register/options': { body: { options: CREATE_OPTIONS } },
  '/auth/passkeys/register/verify': { body: { passkey: { id: 'pk-iphone', label: 'iPhone' } } },
});

function domError(name: string): Error {
  const e = new Error(`${name} raised`);
  e.name = name;
  return e;
}

/**
 * Find the button, THEN tap it inside act(). Never `findBy` INSIDE act():
 * React holds every update in act's queue until the callback returns, so a
 * step that lands while the query is still waiting is never painted — the
 * query times out on a page stuck at "Signing in…". (Seen under a loaded
 * parallel run, where the WebCrypto hash settled one macrotask later.)
 */
async function tap(name: string | RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => { fireEvent.click(button); });
  return button;
}

async function toSecondStep() {
  await act(async () => { render(<LoginPage />); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: EMAIL } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/i })); });
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i })); });
}

/** "Set up a passkey on this iPhone" → the code arrives → typed → Continue. */
async function setUpThroughTheCode() {
  await tap('Set up a passkey on this iPhone');
  fireEvent.change(await screen.findByLabelText('Code from the email'), { target: { value: '482913' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/ })); });
}

const navigatedTo = () => [...push.mock.calls, ...replace.mock.calls].map((c) => c[0]);

function setUserAgent(ua: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

// jsdom has neither WebCrypto's `subtle` nor TextEncoder; a phone on a secure
// origin has both.
const realSubtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
const realEncoder = (globalThis as { TextEncoder?: unknown }).TextEncoder;
const realUA = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
const realTouch = Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints');
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  (globalThis as { TextEncoder?: unknown }).TextEncoder = NodeTextEncoder;
});
afterAll(() => {
  if (realSubtle) Object.defineProperty(globalThis.crypto, 'subtle', realSubtle);
  else delete (globalThis.crypto as { subtle?: unknown }).subtle;
  (globalThis as { TextEncoder?: unknown }).TextEncoder = realEncoder;
  if (realUA) Object.defineProperty(window.navigator, 'userAgent', realUA);
  if (realTouch) Object.defineProperty(window.navigator, 'maxTouchPoints', realTouch);
  else delete (window.navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
});

beforeEach(() => {
  setUserAgent(UA.iphone, 5);
  push.mockReset();
  replace.mockReset();
  startAuthentication.mockReset();
  startRegistration.mockReset();
  platformAuthenticatorIsAvailable.mockReset();
  platformAuthenticatorIsAvailable.mockResolvedValue(true);
  useUIStore.setState({ token: null, user: null });
  __resetPasskeyOfferMemoryForTests();
  localStorage.clear();
  sessionStorage.clear();
  try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
});

// ───────────────────────────────────────────────────────────────────────
describe('on a phone, the passkey step starts with two EQUAL choices', () => {
  it('before any sheet opens: "Use your passkey" and "Set up a passkey on this iPhone", same size and weight — nothing started', async () => {
    const calls = mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    const use = await screen.findByRole('button', { name: 'Use your passkey' });
    const setUp = screen.getByRole('button', { name: 'Set up a passkey on this iPhone' });
    expect(screen.getByText('Is your passkey on this iPhone?')).toBeInTheDocument();
    // Equal: the same classes — neither is dressed as the "real" answer.
    expect(setUp.className).toBe(use.className);
    // What the second choice will do first, tied to the button for a screen reader.
    expect(setUp).toHaveAccessibleDescription("We'll email you a code first, to make sure it's you.");
    // Nothing has happened yet: no sheet (no QR code), no options fetched, no mail sent.
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(calls.map((c) => c.url)).toEqual([`${API_URL}/auth/login`]);
    // Focus is on the first choice; "Use another way" and Back are still there.
    expect(document.activeElement).toBe(use);
    expect(screen.getByRole('button', { name: /^Use another way$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Back$/ })).toBeInTheDocument();
  });

  it('"Use your passkey" is still today\'s button: one tap opens the sheet', async () => {
    mockFetchByPath(SETUP_ROUTES());
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    await toSecondStep();
    await tap('Use your passkey');
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: GET_OPTIONS });
  });

  it.each([
    ['an Android phone', UA.android, 1, 'Set up a passkey on this Android phone', 'Is your passkey on this Android phone?'],
    ['an iPad asking for the desktop site', UA.macOrIpad, 5, 'Set up a passkey on this iPad', 'Is your passkey on this iPad?'],
  ])('the words follow the device — %s', async (_what, ua, touch, choice, question) => {
    setUserAgent(ua, touch);
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    expect(await screen.findByRole('button', { name: choice })).toBeInTheDocument();
    expect(screen.getByText(question)).toBeInTheDocument();
  });

  it('a computer keeps the step exactly as it was — one "Use your passkey", no set-up choice', async () => {
    setUserAgent(UA.macOrIpad, 0);
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(screen.getByText('Use your passkey to finish signing in.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up a passkey/ })).not.toBeInTheDocument();
  });

  it('a phone that cannot hold a passkey (no Face ID / screen lock) is not offered one', async () => {
    platformAuthenticatorIsAvailable.mockResolvedValue(false);
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up a passkey/ })).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('"Set up a passkey on this iPhone" — ONE guided path', () => {
  it('the code goes out AT ONCE, then the code, then ONE button — create() inside the tap — then straight in', async () => {
    const calls = mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();

    // 1. No "Email me a code" in between: the tap sends it.
    await tap('Set up a passkey on this iPhone');
    expect(calls.find((c) => c.url === `${API_URL}/auth/mfa/challenge/email/send`)?.body).toEqual({ mfaToken: 'mfa-1' });

    // 2. The code: iOS offers it from Mail above the keyboard.
    expect(await screen.findByText('Enter the code we emailed you to set up a passkey on this iPhone.')).toBeInTheDocument();
    expect(screen.getByText(`We emailed a 6-digit code to ${EMAIL}.`)).toBeInTheDocument();
    const input = screen.getByLabelText('Code from the email');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(document.activeElement).toBe(input);
    // THE SECURITY RULE: nothing that can add a passkey has been asked for yet.
    expect(calls.some((c) => c.url.includes('/auth/passkeys/register'))).toBe(false);

    fireEvent.change(input, { target: { value: '482913' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/ })); });
    expect(calls.find((c) => c.url === `${API_URL}/auth/mfa/challenge/email`)?.body).toEqual({ challenge: CHALLENGE, code: '482913' });
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-email'); });

    // 3. ONE screen, ONE button.
    expect(await screen.findByRole('heading', { name: 'Turn on Face ID or Touch ID sign-in for this iPhone' })).toBeInTheDocument();
    expect(screen.getByText("You're signed in. Turn it on, and next time signing in here is one tap.")).toBeInTheDocument();
    const card = screen.getByTestId('passkey-offer');
    expect(within(card).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Not now|Don't ask/ })).not.toBeInTheDocument();
    // The creation options were bought with the grant the EMAILED CODE left —
    // strictly after the code was verified, never from the password alone.
    const urls = calls.map((c) => c.url);
    const verifyAt = urls.indexOf(`${API_URL}/auth/mfa/challenge/email`);
    const optionsAt = urls.indexOf(`${API_URL}/auth/passkeys/register/options`);
    expect(verifyAt).toBeGreaterThan(urls.indexOf(`${API_URL}/auth/mfa/challenge/email/send`));
    expect(optionsAt).toBeGreaterThan(verifyAt);
    expect(calls[optionsAt].body).toEqual({ enrollmentGrant: GRANT });
    expect(calls[optionsAt].headers.Authorization).toBe('Bearer tok-email');

    // 4. Safari: create() must run INSIDE the tap — synchronously, nothing awaited first.
    let finish: (v: unknown) => void = () => {};
    startRegistration.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(within(card).getByRole('button', { name: 'Turn on Face ID or Touch ID' }));
    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: CREATE_OPTIONS });
    await act(async () => { finish({ id: 'cred-iphone', rawId: 'cred-iphone', type: 'public-key', response: {} }); });

    // 5. Saved → straight to where the sign-in was going. No extra "saved" screen.
    await waitFor(() => { expect(navigatedTo()).toContain(DEST); });
    expect(screen.queryByRole('heading', { name: 'Passkey saved' })).not.toBeInTheDocument();
    expect(calls.find((c) => c.url === `${API_URL}/auth/passkeys/register/verify`)?.body?.label).toBe('iPhone');
    // Never the QR code: no sign-in ceremony was ever started on this path.
    expect(startAuthentication).not.toHaveBeenCalled();
    // 6. This device remembers.
    expect(await passkeyRememberedOnDevice(EMAIL)).toBe(true);
  });

  it('cancelling Face ID leaves the person SIGNED IN — one calm line, Continue — never red, never the QR code', async () => {
    mockFetchByPath(SETUP_ROUTES());
    startRegistration.mockRejectedValue(domError('NotAllowedError'));
    await toSecondStep();
    await setUpThroughTheCode();
    await tap('Turn on Face ID or Touch ID');

    expect(await screen.findByRole('heading', { name: "You're signed in" })).toBeInTheDocument();
    expect(screen.getByTestId('phone-setup-later')).toHaveTextContent(
      'You can add a passkey for this device later in Settings → My security.',
    );
    expect(document.querySelector('.bg-rose-50')).toBeNull();
    expect(useUIStore.getState().token).toBe('tok-email');
    expect(startAuthentication).not.toHaveBeenCalled();
    // Nothing was saved, so nothing is remembered.
    expect(await passkeyRememberedOnDevice(EMAIL)).toBe(false);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    expect(navigatedTo()).toContain(DEST);
  });

  it('a refusal by the device (not a cancel) reads the same calm line — the code already signed the person in', async () => {
    mockFetchByPath(SETUP_ROUTES());
    startRegistration.mockRejectedValue(domError('NotSupportedError'));
    await toSecondStep();
    await setUpThroughTheCode();
    await tap('Turn on Face ID or Touch ID');
    expect(await screen.findByTestId('phone-setup-later')).toBeInTheDocument();
    expect(document.querySelector('.bg-rose-50')).toBeNull();
  });

  it('this device ALREADY holds one (the browser refuses a duplicate): says so, remembers it, Continue', async () => {
    mockFetchByPath(SETUP_ROUTES());
    startRegistration.mockRejectedValue(domError('InvalidStateError'));
    await toSecondStep();
    await setUpThroughTheCode();
    await tap('Turn on Face ID or Touch ID');
    expect(
      await screen.findByText('This device already has a passkey for your account. Next time, choose your passkey when you sign in.'),
    ).toBeInTheDocument();
    expect(await passkeyRememberedOnDevice(EMAIL)).toBe(true);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('nothing could be prepared (no grant came back): still signed in, the same "add it later" line', async () => {
    const calls = mockFetchByPath({ ...SETUP_ROUTES(), '/auth/mfa/challenge/email': { body: SESSION } });
    await toSecondStep();
    await setUpThroughTheCode();
    expect(await screen.findByRole('heading', { name: "You're signed in" })).toBeInTheDocument();
    expect(screen.getByTestId('phone-setup-later')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/auth/passkeys/register'))).toBe(false);
    expect(useUIStore.getState().token).toBe('tok-email');
  });

  it('a session\'s earlier "Not now" does not hold it back — the person asked for this one', async () => {
    sessionStorage.setItem(PASSKEY_OFFER_SESSION_KEY, '1');
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    await setUpThroughTheCode();
    expect(await screen.findByRole('heading', { name: 'Turn on Face ID or Touch ID sign-in for this iPhone' })).toBeInTheDocument();
  });

  it('a wrong code stays on the code, and nothing that adds a passkey is asked for', async () => {
    const calls = mockFetchByPath({
      ...SETUP_ROUTES(),
      '/auth/mfa/challenge/email': { ok: false, status: 401, body: { code: 'MFA_EMAIL_CODE_INVALID', attemptsLeft: 4 } },
    });
    await toSecondStep();
    await setUpThroughTheCode();
    expect(await screen.findByText("That code doesn't match. 4 tries left.")).toBeInTheDocument();
    expect(screen.getByLabelText('Code from the email')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/auth/passkeys/register'))).toBe(false);
    expect(useUIStore.getState().token).toBeNull();
  });

  it('"Back" from the code returns to the two choices, with focus on the first', async () => {
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    await tap('Set up a passkey on this iPhone');
    await screen.findByLabelText('Code from the email');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Back$/ })); });
    const use = await screen.findByRole('button', { name: 'Use your passkey' });
    expect(screen.getByRole('button', { name: 'Set up a passkey on this iPhone' })).toBeInTheDocument();
    expect(screen.getByText('Is your passkey on this iPhone?')).toBeInTheDocument();
    expect(document.activeElement).toBe(use);
  });

  it('a refused send (a password reset this week) is the catalog sentence, and the choices stay', async () => {
    mockFetchByPath({
      ...SETUP_ROUTES(),
      '/auth/mfa/challenge/email/send': { ok: false, status: 409, body: { code: 'MFA_EMAIL_CODE_AFTER_RESET', message: 'english' } },
    });
    await toSecondStep();
    await tap('Set up a passkey on this iPhone');
    expect(
      await screen.findByText(/Your password was reset recently, so a code by email isn't available for a few days/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up a passkey on this iPhone' })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('after "Use your passkey" misses, the set-up path leads the list', () => {
  it('"Set up a passkey on this iPhone" is FIRST, focused, and takes the same guided path', async () => {
    const calls = mockFetchByPath(SETUP_ROUTES());
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    await toSecondStep();
    await tap('Use your passkey');
    await screen.findByTestId('passkey-elsewhere-note');

    const ways = screen.getByTestId('mfa-other-ways');
    const first = within(ways).getAllByRole('button')[0];
    expect(first).toHaveTextContent('Set up a passkey on this iPhone');
    expect(document.activeElement).toBe(first);

    await act(async () => { fireEvent.click(first); });
    expect(calls.filter((c) => c.url.endsWith('/auth/mfa/challenge/email/send'))).toHaveLength(1);
    expect(await screen.findByText('Enter the code we emailed you to set up a passkey on this iPhone.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Code from the email'), { target: { value: '482913' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue$/ })); });
    expect(await screen.findByRole('heading', { name: 'Turn on Face ID or Touch ID sign-in for this iPhone' })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('per device: once this iPhone holds a passkey, only "Use your passkey"', () => {
  it('after the guided path saved one, the NEXT sign-in here shows only "Use your passkey"', async () => {
    mockFetchByPath(SETUP_ROUTES());
    startRegistration.mockResolvedValue({ id: 'cred-iphone', rawId: 'cred-iphone', type: 'public-key', response: {} });
    await toSecondStep();
    await setUpThroughTheCode();
    await tap('Turn on Face ID or Touch ID');
    await waitFor(() => { expect(navigatedTo()).toContain(DEST); });

    // Later, on the same phone: a new visit to the sign-in page.
    cleanup();
    useUIStore.setState({ token: null, user: null });
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(screen.getByText('Use your passkey to finish signing in.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up a passkey/ })).not.toBeInTheDocument();
  });

  it('a passkey that just WORKED here is remembered too', async () => {
    mockFetchByPath({ ...SETUP_ROUTES(), '/auth/mfa/challenge/passkey': { body: SESSION } });
    startAuthentication.mockResolvedValue({ id: 'cred', rawId: 'cred', type: 'public-key', response: {} });
    await toSecondStep();
    await tap('Use your passkey');
    await waitFor(() => { expect(useUIStore.getState().token).toBe('tok-email'); });
    expect(await passkeyRememberedOnDevice(EMAIL)).toBe(true);
  });

  it('never a dead end: if that passkey then misses, the list still leads with "Set up a passkey on this iPhone"', async () => {
    await rememberPasskeyOnDevice(EMAIL);
    mockFetchByPath(SETUP_ROUTES());
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    await toSecondStep();
    const use = await screen.findByRole('button', { name: 'Use your passkey' });
    expect(screen.queryByRole('button', { name: /Set up a passkey/ })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(use); });
    await screen.findByTestId('passkey-elsewhere-note');
    const labels = within(screen.getByTestId('mfa-other-ways')).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Set up a passkey on this iPhone', 'Use a backup code', 'Email me a code']);
  });

  it('remembered for THIS account only — another person signing in on the same phone still gets both choices', async () => {
    await rememberPasskeyOnDevice('front-desk@venueos.example');
    mockFetchByPath(SETUP_ROUTES());
    await toSecondStep();
    expect(await screen.findByRole('button', { name: 'Set up a passkey on this iPhone' })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('no emailed code for this sign-in → no setting a passkey up here', () => {
  it('mail not configured / a password reset this week: the choice is hidden and the step says where the passkey works', async () => {
    mockFetchByPath({ ...SETUP_ROUTES(), '/auth/login': { body: { ...OWNER_LOGIN, mfaFallbacks: ['backup'] } } });
    startAuthentication.mockRejectedValue(domError('NotAllowedError'));
    await toSecondStep();
    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up a passkey/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('phone-setup-unavailable')).toHaveTextContent(
      "If your passkey isn't on this iPhone, sign in on the device that has it.",
    );
    // And after a miss, the list does not offer it either.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use your passkey' })); });
    await screen.findByTestId('passkey-elsewhere-note');
    const labels = within(screen.getByTestId('mfa-other-ways')).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Use a backup code']);
  });
});
