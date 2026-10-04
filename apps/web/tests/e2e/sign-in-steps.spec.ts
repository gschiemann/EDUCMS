/**
 * IDENTIFIER-FIRST SIGN-IN in a real browser (2026-10-04) — chromium + webkit.
 *
 * Owner: "the sign in seems so confusing, so many options… can't you just show what's enabled
 * for the user". The page now asks for ONE thing first (the email) and then shows only what
 * applies to it. This spec walks every way through it in both engines:
 *
 *   • password path, end to end, to the dashboard URL
 *   • a single-sign-on domain → one button that leaves for the API's SSO entry point
 *   • the domain lookup failing / never answering → the password form (never a dead end)
 *   • EULA: first-time browser (checkbox, required) vs returning (one quiet line)
 *   • the MFA challenge is still reachable from step 2
 *   • keyboard only, start to finish
 *   • the browser's Back returns to step 1; "Forgot password?" carries the address
 *   • no horizontal scroll at phone width or at 200 % zoom
 *
 * Every API call is intercepted on the API origin (`http://api.invalid/api/v1`, the value the
 * e2e build inlines). Nothing here needs a database.
 *
 *   E2E_REBUILD=1 pnpm exec playwright test tests/e2e/sign-in-steps.spec.ts
 *   E2E_SHOTS=/some/dir …   also writes the review screenshots (both viewports).
 */
import { createHash, generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page, type Route } from '@playwright/test';

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const API_ROOT = 'http://api.invalid/api/v1';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};

const SLUG = 'e2e-school';
const EMAIL = 'pat@elsewhere.example';
const SSO_EMAIL = 'teacher@northfield.example';
const PASSWORD = 'correct horse battery staple';
const EULA_KEY = 'edu_cms_eula_accepted_v1.0';
const KEEP_KEY = 'venueos_keep_signed_in.v1';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;
const FAKE_USER = { id: 'u1', email: EMAIL, role: 'SCHOOL_ADMIN', tenantId: SLUG, tenantSlug: SLUG, canTriggerPanic: false };
const SESSION = { access_token: FAKE_TOKEN, user: FAKE_USER };

type OptionsMode = 'password' | 'sso' | 'sso-unnamed' | 'fail' | 'hang' | 'error-500';
interface Api {
  options: OptionsMode;
  /** What POST /auth/login answers. */
  login: 'session' | 'mfa' | 'wrong-password';
  /** The identity provider: a page that stays put, or one that completes the round trip. */
  idp: 'page' | 'round-trip';
  /** POST /auth/passkeys/login/options: refused (the default — silent), or real options. */
  passkeyOptions: 'refuse' | 'serve';
  optionsCalls: Array<Record<string, unknown>>;
  loginCalls: Array<Record<string, unknown>>;
  mfaCalls: Array<Record<string, unknown>>;
  passkeyVerifyCalls: Array<Record<string, unknown>>;
  passkeyOptionCalls: number;
}
const api = (over: Partial<Api> = {}): Api => ({
  options: 'password',
  login: 'session',
  idp: 'page',
  passkeyOptions: 'refuse',
  optionsCalls: [],
  loginCalls: [],
  mfaCalls: [],
  passkeyVerifyCalls: [],
  passkeyOptionCalls: 0,
  ...over,
});

const at = (pathPattern: string) =>
  new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${pathPattern}(\\?.*)?$`);

async function installApiMocks(page: Page, a: Api) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const json = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const postBody = (route: Route) => JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;

  // Broadest catch-all FIRST (Playwright matches last-registered first): whatever the dashboard
  // asks for after a sign-in gets an empty answer rather than an NXDOMAIN.
  await page.route(/^http:\/\/api\.invalid\//, (route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })));
  await page.route(at('/auth/me'), (route) => json(route, FAKE_USER));

  await page.route(at('/auth/sign-in-options'), (route) =>
    cors(route, () => {
      a.optionsCalls.push(postBody(route));
      switch (a.options) {
        case 'sso':
          return json(route, { password: true, sso: { tenantSlug: 'northfield', provider: 'oidc', label: 'Google' } });
        case 'sso-unnamed':
          return json(route, { password: true, sso: { tenantSlug: 'northfield', provider: 'saml', label: null } });
        case 'fail':
          return route.abort('failed');
        case 'error-500':
          return json(route, { message: 'boom' }, 500);
        case 'hang':
          return undefined; // never answered — the page's own 3 s bound has to end it
        default:
          return json(route, { password: true, sso: null });
      }
    }),
  );

  await page.route(at('/auth/login'), (route) =>
    cors(route, () => {
      a.loginCalls.push(postBody(route));
      if (a.login === 'mfa') return json(route, { mfaRequired: true, mfaToken: 'mfa-token-e2e', mfaMethods: ['totp'] });
      if (a.login === 'wrong-password') {
        return json(route, { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' }, 401);
      }
      return json(route, SESSION);
    }),
  );
  await page.route(at('/auth/mfa/challenge'), (route) =>
    cors(route, () => {
      a.mfaCalls.push(postBody(route));
      return json(route, SESSION);
    }),
  );
  // The passkey-autofill request the page arms on step 1 where the browser supports it. Refused
  // by default: most tests are about the typed path, and a refusal must be silent.
  await page.route(at('/auth/passkeys/login/options'), (route) =>
    cors(route, () => {
      a.passkeyOptionCalls += 1;
      if (a.passkeyOptions === 'refuse') return json(route, { message: 'not in this test' }, 404);
      return json(route, {
        challengeId: 'ch-e2e',
        // What the API sends: a DISCOVERABLE request — no account named.
        options: {
          challenge: b64url('e2e-challenge-0123456789abcdef'),
          rpId: 'localhost',
          allowCredentials: [],
          userVerification: 'required',
          timeout: 60_000,
        },
      });
    }),
  );
  await page.route(at('/auth/passkeys/login/verify'), (route) =>
    cors(route, () => {
      a.passkeyVerifyCalls.push(postBody(route));
      return json(route, SESSION);
    }),
  );
  // Where single sign-on leaves to. A real deploy 302s to the identity provider, which sends
  // the browser back to the API callback, which lands on /login/sso-complete#token=…
  await page.route(at('/auth/sso/[^/]+/(oidc|saml)/login'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        a.idp === 'round-trip'
          ? `<title>idp</title><script>location.replace(${JSON.stringify(
              `${ORIGIN}/login/sso-complete#token=${FAKE_TOKEN}&tenant=${SLUG}`,
            )})</script>`
          : '<title>idp</title><h1>identity provider</h1>',
    }),
  );
}

/** A browser that has / has not accepted this EULA version before. */
async function open(page: Page, a: Api, opts: { returning: boolean; search?: string } = { returning: true }) {
  await installApiMocks(page, a);
  await page.addInitScript(
    ({ key, returning }: { key: string; returning: boolean }) => {
      try {
        if (returning) localStorage.setItem(key, 'yes');
        else localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    { key: EULA_KEY, returning: opts.returning },
  );
  await page.goto(`/login${opts.search ?? ''}`);
  await expect(page.locator('#login-email, #sso-slug')).toBeVisible();
}

/**
 * Type the address and press Continue. WebKit: a fill that lands before hydration is wiped by
 * React's first controlled render, so the fill is verified and repeated until it holds.
 */
async function continueWith(page: Page, email: string) {
  const field = page.locator('#login-email');
  await expect(async () => {
    await field.fill(email);
    await page.waitForTimeout(150);
    expect(await field.inputValue()).toBe(email);
  }).toPass({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

const card = (page: Page) => page.locator('.rounded-2xl').first();

// ─────────────────────────────────────────────────────────────────────────────
test.describe('step 1 — one field', () => {
  test('the email and Continue; nothing else to decide', async ({ page }) => {
    await open(page, api());

    const email = page.locator('#login-email');
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('autocomplete', 'username webauthn');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a workspace' })).toBeVisible();

    await expect(page.locator('#login-password')).toHaveCount(0);
    await expect(card(page).locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(card(page).locator('button[type="submit"]')).toHaveCount(1);
    await expect(page.getByText(/End User License Agreement/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /SSO|single sign-on/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Forgot password/i })).toHaveCount(0);
  });

  test('passkeys: the browser\'s own autofill where it has one, otherwise one quiet link — never a box', async ({ page }) => {
    const a = api();
    await open(page, a);
    const support = await page.evaluate(async () => {
      type Probe = (() => void) & { isConditionalMediationAvailable?: () => Promise<boolean> };
      const pkc = (globalThis as unknown as { PublicKeyCredential?: Probe }).PublicKeyCredential;
      // The app's own support check: `PublicKeyCredential` must be a FUNCTION.
      if (typeof pkc !== 'function') return 'none';
      if (typeof pkc.isConditionalMediationAvailable !== 'function') return 'modal-only';
      return (await pkc.isConditionalMediationAvailable()) ? 'autofill' : 'modal-only';
    });
    const link = page.getByRole('button', { name: 'Sign in with a passkey' });
    if (support === 'autofill') {
      // Armed from the email field (the options request went out), and no control on the page.
      await expect.poll(() => a.passkeyOptionCalls).toBeGreaterThan(0);
      await expect(link).toHaveCount(0);
    } else if (support === 'modal-only') {
      await expect(link).toBeVisible();
      expect(a.passkeyOptionCalls).toBe(0);
    } else {
      await expect(link).toHaveCount(0);
      expect(a.passkeyOptionCalls).toBe(0);
    }
    // Either way: the refused options call left no error, and the old explainer box is gone.
    // (Scoped to the card: Next's own route announcer is a page-level role="alert".)
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(/No passkey on this device/)).toHaveCount(0);
  });

  test('chromium: a passkey for this site signs in from step 1 — the real ceremony, with a virtual authenticator', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a CDP (Chromium) feature');
    const a = api({ passkeyOptions: 'serve' });
    // A platform authenticator holding ONE discoverable credential for this site and account.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    // The account's user handle, exactly as the API mints it: sha256(user id).
    const userHandle = createHash('sha256').update(FAKE_USER.id).digest();
    await cdp.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: {
        credentialId: Buffer.from('e2e-credential-0001').toString('base64'),
        isResidentCredential: true,
        rpId: 'localhost',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
        userHandle: userHandle.toString('base64'),
        signCount: 1,
      },
    });
    // This account chose "Keep me signed in" on this browser before.
    await page.addInitScript(
      ({ key, handle }: { key: string; handle: string }) => {
        try { localStorage.setItem(key, JSON.stringify([handle])); } catch { /* ignore */ }
      },
      { key: KEEP_KEY, handle: userHandle.toString('base64url') },
    );

    await open(page, a);
    const conditional = await page.evaluate(async () => {
      const pkc = (globalThis as unknown as { PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> } })
        .PublicKeyCredential;
      return typeof pkc?.isConditionalMediationAvailable === 'function' && (await pkc.isConditionalMediationAvailable());
    });
    if (!conditional) {
      // This build has no passkey autofill: the page shows its one quiet link instead.
      await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    }
    // With autofill, the virtual authenticator answers the pending request by itself — the
    // stand-in for a person picking the passkey from the field's suggestions.
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });

    expect(a.passkeyOptionCalls).toBeGreaterThan(0);
    expect(a.passkeyVerifyCalls).toHaveLength(1);
    const verify = a.passkeyVerifyCalls[0] as {
      challengeId?: string;
      rememberMe?: boolean;
      response?: { id?: string; type?: string; response?: { userHandle?: string } };
    };
    expect(verify.challengeId).toBe('ch-e2e');
    expect(verify.response?.type).toBe('public-key');
    expect(verify.response?.id).toBe(Buffer.from('e2e-credential-0001').toString('base64url'));
    // The assertion names the account by its opaque handle, and that account's remembered
    // choice travelled with the request.
    expect(verify.response?.response?.userHandle).toBe(userHandle.toString('base64url'));
    expect(verify.rememberMe).toBe(true);
    // No address was typed and no lookup or password call was made.
    expect(a.optionsCalls).toHaveLength(0);
    expect(a.loginCalls).toHaveLength(0);
    test.info().annotations.push({ type: 'passkey-path', description: conditional ? 'autofill (conditional mediation)' : 'link (modal)' });
  });

  test('a first-time browser sees the same step 1 — and no passkey way in before the EULA', async ({ page }) => {
    const a = api();
    await open(page, a, { returning: false });
    await expect(card(page).locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(a.passkeyOptionCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('step 2 — password', () => {
  test('email → Continue → password → Sign in → the dashboard', async ({ page }) => {
    const a = api();
    await open(page, a);
    await continueWith(page, EMAIL);

    const password = page.locator('#login-password');
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByTestId('sign-in-email')).toHaveText(EMAIL);
    await expect(page.locator('#login-email')).toHaveCount(0);
    await expect(card(page).locator('button[type="submit"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Create a workspace' })).toHaveCount(0);
    // The lookup carried the address and nothing else.
    expect(a.optionsCalls).toEqual([{ email: EMAIL }]);
    // …and the address is not in the URL.
    expect(page.url()).not.toContain('elsewhere');

    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(a.loginCalls).toEqual([{ email: EMAIL, password: PASSWORD, rememberMe: false }]);
  });

  test('a wrong password is announced and stays on the password step', async ({ page }) => {
    const a = api({ login: 'wrong-password' });
    await open(page, a);
    await continueWith(page, EMAIL);
    await page.locator('#login-password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(card(page).getByRole('alert')).toHaveText('Invalid credentials');
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('"Change" and the browser\'s Back both return to step 1 with the address kept', async ({ page }) => {
    await open(page, api());
    await continueWith(page, EMAIL);
    await expect(page.locator('#login-password')).toBeVisible();

    await page.getByRole('button', { name: 'Change email address' }).click();
    await expect(page.locator('#login-email')).toHaveValue(EMAIL);
    await expect(page.locator('#login-email')).toBeFocused();
    await expect(page.locator('#login-password')).toHaveCount(0);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('#login-password')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#login-email')).toHaveValue(EMAIL);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('"Forgot password?" carries the address to the reset page — not through the URL', async ({ page }) => {
    await open(page, api());
    await continueWith(page, EMAIL);
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.waitForURL(/\/reset-password\/request$/);
    await expect(page.locator('#reset-request-email')).toHaveValue(EMAIL);
    // Consumed on arrival.
    expect(await page.evaluate(() => sessionStorage.getItem('venueos_reset_email'))).toBeNull();
  });

  test('the MFA challenge is still reachable, and completes the sign-in', async ({ page }) => {
    const a = api({ login: 'mfa' });
    await open(page, a);
    await continueWith(page, EMAIL);
    await page.locator('#login-password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
    const code = page.locator('#mfa-code');
    await expect(code).toBeFocused();
    await code.fill('123456');
    await page.getByRole('button', { name: /Verify & sign in/ }).click();
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(a.mfaCalls).toEqual([{ mfaToken: 'mfa-token-e2e', code: '123456' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('step 2 — single sign-on, by the email\'s domain', () => {
  test('one primary button that leaves for the API\'s SSO entry point', async ({ page }) => {
    const a = api({ options: 'sso' });
    await open(page, a);
    await continueWith(page, SSO_EMAIL);

    const sso = page.getByRole('button', { name: 'Continue with Google' });
    await expect(sso).toBeFocused();
    await expect(card(page).locator('button[type="submit"]')).toHaveCount(1);
    await expect(page.locator('#login-password')).toHaveCount(0);
    await expect(page.getByTestId('sign-in-email')).toHaveText(SSO_EMAIL);

    const leaving = page.waitForRequest((r) => r.url() === `${API_ROOT}/auth/sso/northfield/oidc/login`);
    await sso.click();
    await leaving;
    await expect(page.getByRole('heading', { name: 'identity provider' })).toBeVisible();
    expect(a.loginCalls).toHaveLength(0);
  });

  test('"Use a password instead" reveals the password form, which signs in', async ({ page }) => {
    const a = api({ options: 'sso-unnamed' });
    await open(page, a);
    await continueWith(page, SSO_EMAIL);
    await expect(page.getByRole('button', { name: 'Continue with single sign-on' })).toBeVisible();

    await page.getByRole('button', { name: 'Use a password instead' }).click();
    const password = page.locator('#login-password');
    await expect(password).toBeFocused();
    await expect(page.getByRole('button', { name: /Continue with/ })).toHaveCount(0);
    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(a.loginCalls[0]).toMatchObject({ email: SSO_EMAIL });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('the lookup can never block a sign-in', () => {
  for (const mode of ['fail', 'error-500'] as const) {
    test(`lookup ${mode} → the password form, and the sign-in works`, async ({ page }) => {
      const a = api({ options: mode });
      await open(page, a);
      await continueWith(page, EMAIL);
      await expect(page.locator('#login-password')).toBeFocused();
      await expect(card(page).getByRole('alert')).toHaveCount(0);
      await page.locator('#login-password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    });
  }

  test('a lookup that never answers gives way after about 3 seconds', async ({ page }) => {
    const a = api({ options: 'hang' });
    await open(page, a);
    const started = Date.now();
    await continueWith(page, EMAIL);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(page.locator('#login-password')).toBeVisible({ timeout: 8_000 });
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(2_500);
    expect(waited).toBeLessThan(8_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('EULA', () => {
  test('FIRST TIME: the checkbox is required on step 2; ticking it lets the sign-in through', async ({ page }) => {
    const a = api();
    await open(page, a, { returning: false });
    await continueWith(page, EMAIL);
    await page.locator('#login-password').fill(PASSWORD);

    const box = page.getByRole('checkbox', { name: /End User License Agreement/ });
    await expect(box).not.toBeChecked();
    await expect(page.getByTestId('eula-accepted-note')).toHaveCount(0);

    // LOCK 1 — the element is `required`: the browser itself refuses to submit. What the person
    // sees is OUR message (translated, announced), not the browser's bubble.
    await expect(box).toHaveAttribute('required', '');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(card(page).getByRole('alert')).toHaveText(/must accept the End User License Agreement/);
    expect(a.loginCalls).toHaveLength(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), EULA_KEY)).toBeNull();

    // LOCK 2 — take the browser's validation away (as a script or an extension could): the
    // submit handler still refuses.
    await page.getByTestId('sign-in-step-password').evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(card(page).getByRole('alert')).toHaveText(/must accept the End User License Agreement/);
    await page.waitForTimeout(300);
    expect(a.loginCalls).toHaveLength(0);

    await box.check();
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(a.loginCalls).toHaveLength(1);
    expect(await page.evaluate((k) => localStorage.getItem(k), EULA_KEY)).toBe('yes');
  });

  test('FIRST TIME, single sign-on: the same checkbox gates leaving for the provider', async ({ page }) => {
    await open(page, api({ options: 'sso' }), { returning: false });
    await continueWith(page, SSO_EMAIL);
    const box = page.getByRole('checkbox', { name: /End User License Agreement/ });
    // The step's first field — there is nothing to type here.
    await expect(box).toBeFocused();
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(card(page).getByRole('alert')).toHaveText(/must accept the End User License Agreement/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('FIRST TIME, single sign-on: the acceptance is recorded only when the round trip ends in a session', async ({ page }) => {
    const a = api({ options: 'sso', idp: 'round-trip' });
    await open(page, a, { returning: false });
    await continueWith(page, SSO_EMAIL);
    await page.getByRole('checkbox', { name: /End User License Agreement/ }).check();
    // Ticked, not yet signed in: nothing recorded.
    expect(await page.evaluate((k) => localStorage.getItem(k), EULA_KEY)).toBeNull();

    await page.getByRole('button', { name: 'Continue with Google' }).click();
    // → identity provider → /login/sso-complete#token=… → the dashboard.
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(await page.evaluate((k) => localStorage.getItem(k), EULA_KEY)).toBe('yes');
    // …by the address that actually signed in, not the one that was typed.
    expect(await page.evaluate((k) => localStorage.getItem(`${k}_by`), EULA_KEY)).toBe(EMAIL);
    expect(a.loginCalls).toHaveLength(0);
  });

  test('RETURNING: no checkbox — one quiet line with the link, under the button', async ({ page }) => {
    await open(page, api());
    await continueWith(page, EMAIL);
    await expect(page.locator('#login-password')).toBeVisible();

    await expect(page.getByRole('checkbox', { name: /End User License Agreement/ })).toHaveCount(0);
    const note = page.getByTestId('eula-accepted-note');
    await expect(note).toHaveText('You agreed to the End User License Agreement on this device.');
    await expect(note.getByRole('link', { name: 'End User License Agreement' })).toHaveAttribute('href', '/terms/eula');
    const button = await page.getByRole('button', { name: 'Sign in', exact: true }).boundingBox();
    const line = await note.boundingBox();
    expect(line!.y).toBeGreaterThan(button!.y + button!.height - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('keyboard only', () => {
  test('returning browser: type, Enter, type, Enter — signed in without touching the mouse', async ({ page }) => {
    const a = api();
    await open(page, a);
    await expect(page.locator('#login-email')).toBeFocused();
    await expect(async () => {
      await page.locator('#login-email').fill('');
      await page.keyboard.type(EMAIL);
      expect(await page.locator('#login-email').inputValue()).toBe(EMAIL);
    }).toPass({ timeout: 15_000 });
    await page.keyboard.press('Enter');

    await expect(page.locator('#login-password')).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(a.loginCalls).toEqual([{ email: EMAIL, password: PASSWORD, rememberMe: false }]);
  });

  test('first-time browser: the EULA checkbox is reachable and tickable from the keyboard', async ({ page }) => {
    const a = api();
    await open(page, a, { returning: false });
    await continueWith(page, EMAIL);
    await expect(page.locator('#login-password')).toBeFocused();
    await page.keyboard.type(PASSWORD);

    const box = page.getByRole('checkbox', { name: /End User License Agreement/ });
    await box.focus();
    await expect(box).toBeFocused();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(a.loginCalls).toHaveLength(1);
  });

  test('"Change" works from the keyboard and focus follows to the email field', async ({ page }) => {
    await open(page, api());
    await continueWith(page, EMAIL);
    await expect(page.locator('#login-password')).toBeFocused();
    const change = page.getByRole('button', { name: 'Change email address' });
    await change.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#login-email')).toBeFocused();
    await expect(page.locator('#login-email')).toHaveValue(EMAIL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('layout', () => {
  /** No element may push the page wider than the viewport. */
  const noHorizontalScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  for (const size of [
    { name: 'phone 390×844', width: 390, height: 844 },
    // 1325×758 at 200 % zoom lays out as a 662-px-wide viewport; 390 at 200 % as 195.
    { name: '200 % zoom of 1325×758', width: 662, height: 379 },
    { name: '200 % zoom of a phone (reflow floor, 320 px)', width: 320, height: 420 },
  ]) {
    test(`${size.name}: both steps fit with no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, api(), { returning: false });
      expect(await noHorizontalScroll(page)).toBe(true);
      await continueWith(page, 'a.rather.long.address.for.a.narrow.screen@elsewhere.example');
      await expect(page.locator('#login-password')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      // The primary action is reachable (scrolls into view) and not clipped.
      const button = page.getByRole('button', { name: 'Sign in', exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('the manual single sign-on entry is reachable by URL only', () => {
  test('/login?sso=1 shows the organization entry; the normal page has no way to it', async ({ page }) => {
    await open(page, api());
    await expect(page.locator('#sso-slug')).toHaveCount(0);
    await expect(page.locator('a[href*="sso"]')).toHaveCount(0);

    await page.goto('/login?sso=1');
    await expect(page.locator('#sso-slug')).toBeVisible();
    await expect(page.locator('#login-email')).toHaveCount(0);
    await expect(card(page).locator('button[type="submit"]')).toHaveCount(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review screenshots — only when E2E_SHOTS names a directory. Both viewports, per engine.
test.describe('screenshots for review', () => {
  test.skip(!process.env.E2E_SHOTS, 'set E2E_SHOTS=<dir> to write the review screenshots');

  const VIEWPORTS = [
    { tag: '390x844', width: 390, height: 844 },
    { tag: '1325x758', width: 1325, height: 758 },
  ];

  for (const vp of VIEWPORTS) {
    test(`all states at ${vp.tag}`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const dir = process.env.E2E_SHOTS as string;
      fs.mkdirSync(dir, { recursive: true });
      const shot = async (name: string) => {
        // Let the focus ring / fonts settle so the picture is what a person sees.
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(dir, `${info.project.name}-${vp.tag}-${name}.png`) });
      };
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // 1b — step 1 in a browser WITHOUT passkey autofill (this engine as Playwright ships it):
      //      the one quiet link.
      await open(page, api());
      const hasFallbackLink = await page.getByRole('button', { name: 'Sign in with a passkey' }).isVisible().catch(() => false);
      if (hasFallbackLink) await shot('1b-step1-email-browser-without-passkey-autofill');

      // 1 — step 1 as Safari 16+, Chrome/Edge 108+ and Firefox 119+ show it: passkeys come from
      //     the email field's own autofill, so the page has no passkey control at all. Playwright's
      //     engines do not report that capability, so it is switched on for the picture.
      await page.addInitScript(() => {
        type Probe = (() => void) & { isConditionalMediationAvailable?: () => Promise<boolean> };
        const pkc = (globalThis as unknown as { PublicKeyCredential?: Probe }).PublicKeyCredential;
        if (typeof pkc === 'function') pkc.isConditionalMediationAvailable = () => Promise.resolve(true);
      });
      await open(page, api());
      await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0);
      await shot('1-step1-email');

      // 2 — step 2, password, FIRST-TIME browser (EULA checkbox)
      await page.context().clearCookies();
      await open(page, api(), { returning: false });
      await continueWith(page, EMAIL);
      await expect(page.locator('#login-password')).toBeVisible();
      await shot('2-step2-password-first-time-eula');

      // 5a — error: the EULA was not accepted (our message, not the browser's bubble)
      await page.locator('#login-password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(card(page).getByRole('alert')).toBeVisible();
      await shot('5a-error-eula-required');

      // 3 — step 2, password, RETURNING browser (one quiet line)
      await open(page, api({ login: 'wrong-password' }));
      await continueWith(page, EMAIL);
      await expect(page.getByTestId('eula-accepted-note')).toBeVisible();
      await shot('3-step2-password-returning');

      // 5b — error: wrong password
      await page.locator('#login-password').fill('not-the-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(card(page).getByRole('alert')).toBeVisible();
      await shot('5b-error-wrong-password');

      // 4 — step 2, single sign-on domain (returning, then first-time)
      await open(page, api({ options: 'sso' }));
      await continueWith(page, SSO_EMAIL);
      await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
      await shot('4-step2-sso-domain');

      await open(page, api({ options: 'sso-unnamed' }), { returning: false });
      await continueWith(page, SSO_EMAIL);
      await expect(page.getByRole('button', { name: 'Continue with single sign-on' })).toBeVisible();
      await shot('4b-step2-sso-domain-first-time-eula');
    });
  }
});
