/**
 * Identifier-first sign-in — the pure half (2026-10-04).
 *
 * The three rules `lib/sign-in-steps.ts` holds, one describe each: the step
 * machine only ever shows what the email's DOMAIN implies, the lookup can
 * never block a sign-in, and the lookup's answer is never trusted by shape.
 */
import {
  fetchSignInOptions,
  INITIAL_SIGN_IN_STEP,
  normalizeEmail,
  parseSignInOptions,
  RESET_EMAIL_HANDOFF_KEY,
  SIGN_IN_OPTIONS_TIMEOUT_MS,
  signInStepReducer,
  ssoLoginUrl,
  stashEmailForReset,
  takeEmailForReset,
  type SignInOptions,
  type SignInStep,
  type SsoOption,
} from '../sign-in-steps';

const SSO: SsoOption = { tenantSlug: 'northfield', provider: 'oidc', label: 'Google' };
const NO_SSO: SignInOptions = { sso: null, passwordAllowed: true };
const WITH_SSO: SignInOptions = { sso: SSO, passwordAllowed: true };
const run = (events: Parameters<typeof signInStepReducer>[1][], from: SignInStep = INITIAL_SIGN_IN_STEP) =>
  events.reduce(signInStepReducer, from);

describe('the step machine', () => {
  it('starts on the email step', () => {
    expect(INITIAL_SIGN_IN_STEP).toEqual({ name: 'email' });
  });

  it('Continue normalises the address the way the API does and waits for the lookup', () => {
    expect(run([{ type: 'CONTINUE', email: '  Pat.Lee@Northfield.Example ' }])).toEqual({
      name: 'checking',
      email: 'pat.lee@northfield.example',
    });
    expect(normalizeEmail('  A@B.Example ')).toBe('a@b.example');
  });

  it('Continue with nothing typed stays put', () => {
    expect(run([{ type: 'CONTINUE', email: '   ' }])).toEqual({ name: 'email' });
  });

  it('no single sign-on → the password form IS step 2', () => {
    expect(
      run([
        { type: 'CONTINUE', email: 'pat@elsewhere.example' },
        { type: 'OPTIONS', email: 'pat@elsewhere.example', options: NO_SSO },
      ]),
    ).toEqual({ name: 'method', email: 'pat@elsewhere.example', sso: null, passwordAllowed: true, passwordOpen: true });
  });

  it('single sign-on → it is the step, with the password form closed behind a link', () => {
    const step = run([
      { type: 'CONTINUE', email: 'pat@northfield.example' },
      { type: 'OPTIONS', email: 'pat@northfield.example', options: WITH_SSO },
    ]);
    expect(step).toEqual({
      name: 'method',
      email: 'pat@northfield.example',
      sso: SSO,
      passwordAllowed: true,
      passwordOpen: false,
    });
    expect(signInStepReducer(step, { type: 'USE_PASSWORD' })).toEqual({ ...step, passwordOpen: true });
  });

  it('an organization that does not allow a password: single sign-on only — the link does nothing', () => {
    const step = run([
      { type: 'CONTINUE', email: 'pat@northfield.example' },
      { type: 'OPTIONS', email: 'pat@northfield.example', options: { sso: SSO, passwordAllowed: false } },
    ]);
    expect(step).toMatchObject({ name: 'method', sso: SSO, passwordAllowed: false, passwordOpen: false });
    expect(signInStepReducer(step, { type: 'USE_PASSWORD' })).toBe(step);
  });

  it('NEVER A DEAD END: "no password" with no single sign-on to offer still opens the password form', () => {
    expect(
      run([
        { type: 'CONTINUE', email: 'pat@elsewhere.example' },
        { type: 'OPTIONS', email: 'pat@elsewhere.example', options: { sso: null, passwordAllowed: false } },
      ]),
    ).toEqual({ name: 'method', email: 'pat@elsewhere.example', sso: null, passwordAllowed: true, passwordOpen: true });
  });

  it('a FAILED lookup (null) falls back to the password form — never a dead end', () => {
    expect(
      run([
        { type: 'CONTINUE', email: 'pat@northfield.example' },
        { type: 'OPTIONS', email: 'pat@northfield.example', options: null },
      ]),
    ).toEqual({ name: 'method', email: 'pat@northfield.example', sso: null, passwordAllowed: true, passwordOpen: true });
  });

  it('a STALE answer — for an address the operator already moved on from — changes nothing', () => {
    // Changed their mind and typed another address before the first answer landed.
    const step = run([
      { type: 'CONTINUE', email: 'first@northfield.example' },
      { type: 'CONTINUE', email: 'second@elsewhere.example' },
      { type: 'OPTIONS', email: 'first@northfield.example', options: WITH_SSO },
    ]);
    expect(step).toEqual({ name: 'checking', email: 'second@elsewhere.example' });
    // An answer arriving on step 1 or step 2 is ignored too.
    expect(signInStepReducer({ name: 'email' }, { type: 'OPTIONS', email: 'a@b.example', options: WITH_SSO })).toEqual({
      name: 'email',
    });
    const onPassword: SignInStep = {
      name: 'method',
      email: 'a@b.example',
      sso: null,
      passwordAllowed: true,
      passwordOpen: true,
    };
    expect(signInStepReducer(onPassword, { type: 'OPTIONS', email: 'a@b.example', options: WITH_SSO })).toBe(onPassword);
  });

  it('Change returns to the email step from anywhere', () => {
    for (const from of [
      { name: 'checking', email: 'a@b.example' },
      { name: 'method', email: 'a@b.example', sso: SSO, passwordAllowed: true, passwordOpen: false },
      { name: 'method', email: 'a@b.example', sso: null, passwordAllowed: true, passwordOpen: true },
    ] as SignInStep[]) {
      expect(signInStepReducer(from, { type: 'CHANGE' })).toEqual({ name: 'email' });
    }
  });

  it('Continue and "Use a password instead" mean nothing on the wrong step', () => {
    const onPassword: SignInStep = {
      name: 'method',
      email: 'a@b.example',
      sso: null,
      passwordAllowed: true,
      passwordOpen: true,
    };
    expect(signInStepReducer(onPassword, { type: 'CONTINUE', email: 'other@b.example' })).toBe(onPassword);
    expect(signInStepReducer({ name: 'email' }, { type: 'USE_PASSWORD' })).toEqual({ name: 'email' });
  });
});

describe('parseSignInOptions — the answer is never trusted by shape', () => {
  it('reads the documented shape', () => {
    expect(parseSignInOptions({ password: true, sso: { tenantSlug: 'northfield', provider: 'oidc', label: 'Google' } })).toEqual(
      WITH_SSO,
    );
    expect(parseSignInOptions({ password: true, sso: { tenantSlug: 'northfield', provider: 'saml', label: null } })).toEqual({
      sso: { tenantSlug: 'northfield', provider: 'saml', label: null },
      passwordAllowed: true,
    });
    expect(parseSignInOptions({ password: true, sso: null })).toEqual(NO_SSO);
  });

  it('only an explicit `password: false` WITH single sign-on removes the password form', () => {
    const sso = { tenantSlug: 'northfield', provider: 'oidc', label: null };
    expect(parseSignInOptions({ password: false, sso }).passwordAllowed).toBe(false);
    for (const password of [true, undefined, null, 'false', 0]) {
      expect(parseSignInOptions({ password, sso }).passwordAllowed).toBe(true);
    }
    // Nothing to sign in WITH instead → the password stays.
    expect(parseSignInOptions({ password: false, sso: null })).toEqual(NO_SSO);
    expect(parseSignInOptions({ password: false })).toEqual(NO_SSO);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'sso'],
    ['an empty object', {}],
    ['sso: true', { sso: true }],
    ['an unknown provider', { sso: { tenantSlug: 'northfield', provider: 'ldap' } }],
    ['an upper-case provider', { sso: { tenantSlug: 'northfield', provider: 'OIDC' } }],
    ['a missing slug', { sso: { provider: 'oidc' } }],
    // These two end up in a URL — a slug that could change the path is refused,
    // and a refused answer never takes the password form with it.
    ['a slug with a slash', { password: false, sso: { tenantSlug: '../../auth/login', provider: 'oidc' } }],
    ['a slug with a query', { password: false, sso: { tenantSlug: 'a?next=//evil.example', provider: 'oidc' } }],
  ])('%s → no single sign-on, password form', (_name, data) => {
    expect(parseSignInOptions(data)).toEqual(NO_SSO);
  });

  it('drops a label that is not a short string, keeping the rest', () => {
    expect(parseSignInOptions({ sso: { tenantSlug: 'northfield', provider: 'oidc', label: 42 } }).sso?.label).toBeNull();
    expect(
      parseSignInOptions({ sso: { tenantSlug: 'northfield', provider: 'oidc', label: 'x'.repeat(41) } }).sso?.label,
    ).toBeNull();
  });
});

describe('fetchSignInOptions — the lookup can never block a sign-in', () => {
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

  it('POSTs only the email and returns the parsed answer', async () => {
    const fetchImpl = jest.fn(() => ok({ password: true, sso: { tenantSlug: 'northfield', provider: 'oidc', label: null } }));
    const out = await fetchSignInOptions('https://api.example/api/v1', 'pat@northfield.example', { fetchImpl });
    expect(out).toEqual({ sso: { tenantSlug: 'northfield', provider: 'oidc', label: null }, passwordAllowed: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe('https://api.example/api/v1/auth/sign-in-options');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'pat@northfield.example' });
  });

  it.each([
    ['a 429 from the throttle', () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) })],
    ['a 500', () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })],
    ['a 404 (an API that predates the endpoint)', () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a body that is not JSON', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('x')) })],
  ])('%s → null (password form)', async (_name, impl) => {
    expect(await fetchSignInOptions('https://api.example', 'a@b.example', { fetchImpl: impl as never })).toBeNull();
  });

  describe('timeouts', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('a request that never answers gives up after 3 s and aborts it', async () => {
      let signal: AbortSignal | undefined;
      const fetchImpl = jest.fn((_url: string, init: { signal?: AbortSignal }) => {
        signal = init.signal;
        return new Promise<never>(() => undefined);
      });
      const pending = fetchSignInOptions('https://api.example', 'a@b.example', { fetchImpl: fetchImpl as never });
      let settled: unknown = 'pending';
      void pending.then((v) => { settled = v; });

      await jest.advanceTimersByTimeAsync(SIGN_IN_OPTIONS_TIMEOUT_MS - 1);
      expect(settled).toBe('pending');
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBeNull();
      expect(signal?.aborted).toBe(true);
      expect(SIGN_IN_OPTIONS_TIMEOUT_MS).toBe(3_000);
    });

    it('headers that arrive and a BODY that stalls is the same timeout — the bound covers the read', async () => {
      const fetchImpl = jest.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => new Promise<never>(() => undefined) }),
      );
      const pending = fetchSignInOptions('https://api.example', 'a@b.example', { fetchImpl: fetchImpl as never });
      let settled: unknown = 'pending';
      void pending.then((v) => { settled = v; });
      await jest.advanceTimersByTimeAsync(SIGN_IN_OPTIONS_TIMEOUT_MS);
      expect(settled).toBeNull();
    });
  });
});

describe('ssoLoginUrl', () => {
  it('is the API entry point that 302s to the provider', () => {
    expect(ssoLoginUrl('https://api.example/api/v1', SSO)).toBe(
      'https://api.example/api/v1/auth/sso/northfield/oidc/login',
    );
  });
});

describe('the "Forgot password?" hand-off', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('carries the address once — the reset page consumes it on read', () => {
    stashEmailForReset('  Pat@Northfield.Example ');
    expect(sessionStorage.getItem(RESET_EMAIL_HANDOFF_KEY)).toBe('pat@northfield.example');
    expect(takeEmailForReset()).toBe('pat@northfield.example');
    expect(sessionStorage.getItem(RESET_EMAIL_HANDOFF_KEY)).toBeNull();
    expect(takeEmailForReset()).toBe('');
  });

  it('never touches localStorage, and stores nothing for an empty address', () => {
    stashEmailForReset('   ');
    expect(sessionStorage.length).toBe(0);
    stashEmailForReset('pat@northfield.example');
    expect(localStorage.length).toBe(0);
  });

  it('survives storage that throws (Safari private mode, locked-down kiosks)', () => {
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(() => stashEmailForReset('pat@northfield.example')).not.toThrow();
      expect(takeEmailForReset()).toBe('');
    } finally {
      set.mockRestore();
      get.mockRestore();
    }
  });
});
