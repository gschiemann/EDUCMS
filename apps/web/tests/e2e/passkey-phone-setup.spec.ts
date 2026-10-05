/**
 * "SET UP A PASSKEY ON THIS PHONE" — in a real browser (2026-10-05).
 *
 * Owner, on his iPhone (his only passkey was made on his Mac): "Takes the username, takes the
 * password, then says use your passkey and I click that and it just pops up a QR code, I X off
 * of that and you give me 3 more options but I just want to create a passkey on my phone and
 * get logged in."
 *
 *   chromium — REAL WebAuthn ceremonies against a CDP virtual authenticator that holds NO
 *              credential for this account (= the passkey lives on the Mac):
 *                password → two equal choices → "Set up a passkey on this iPhone" → the code is
 *                emailed at once → code → Continue → ONE button "Turn on Face ID or Touch ID" →
 *                a REAL credential is created → the dashboard. Then the next visit on this
 *                device: only "Use your passkey" → one tap → signed in.
 *              and the cancel path: Face ID refused → still signed in, one calm line → Continue.
 *   webkit   — at iPhone size (390×844) with the ceremony mocked: the layout of every screen of
 *              the path (no sideways scroll, thumb-sized and equal choices, axe clean) and the
 *              cancelled ending.
 *
 * Every API call is intercepted on the API origin (`http://api.invalid/api/v1`). No database.
 *
 *   E2E_BASE=http://localhost:3471 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/passkey-phone-setup.spec.ts
 *   E2E_SHOTS=/some/dir …   also writes screenshots of each state.
 */
import * as path from 'path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/** Zero violations, the same WCAG 2.1 A + AA rule set the a11y CI audit runs on /login. */
async function axe(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${what}: ${v.id} (${v.impact}) — ${v.help} ×${v.nodes.length}`)).toEqual([]);
}

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const API_ROOT = 'http://api.invalid/api/v1';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EMAIL = 'owner@venueos.example';
const PASSWORD = 'correct horse battery staple';
const SLUG = 'hq';
const RIGHT_CODE = '482913';
const CHALLENGE = 'C'.repeat(43);
const GRANT = 'Gr4nt_' + 'x'.repeat(35) + '-9';
const MAC_CREDENTIAL = 'the-macs-credential-id-0123456789';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;
const USER = { id: 'u1', email: EMAIL, role: 'SUPER_ADMIN', tenantId: SLUG, tenantSlug: SLUG, canTriggerPanic: true };

interface Api {
  sendCalls: Array<Record<string, unknown>>;
  verifyCalls: Array<Record<string, unknown>>;
  regOptionCalls: Array<{ body: Record<string, unknown>; auth: string | undefined }>;
  regVerifyCalls: Array<Record<string, unknown>>;
  passkeyOptionCalls: number;
  passkeyVerifyCalls: Array<Record<string, unknown>>;
  /** Every API path in the order the page asked for it. */
  order: string[];
}
const api = (): Api => ({
  sendCalls: [],
  verifyCalls: [],
  regOptionCalls: [],
  regVerifyCalls: [],
  passkeyOptionCalls: 0,
  passkeyVerifyCalls: [],
  order: [],
});

const at = (p: string) => new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${p}(\\?.*)?$`);

async function installApiMocks(page: Page, a: Api) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const json = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const postBody = (route: Route) => JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;
  const note = (route: Route) => {
    if (route.request().method() === 'POST') a.order.push(new URL(route.request().url()).pathname.replace('/api/v1', ''));
  };

  // Broadest catch-all FIRST (Playwright matches last-registered first).
  await page.route(/^http:\/\/api\.invalid\//, (route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })));
  await page.route(at('/auth/me'), (route) => json(route, USER));
  await page.route(at('/auth/sign-in-options'), (route) => json(route, { password: true, sso: null }));
  // Step 1's passkey autofill: refused (silently) — this spec is about the SECOND step.
  await page.route(at('/auth/passkeys/login/options'), (route) => json(route, { message: 'not in this test' }, 404));
  // The owner's account: the second factor is a passkey (on the Mac), it has backup codes, and
  // mail is configured.
  await page.route(at('/auth/login'), (route) => {
    note(route);
    return json(route, { mfaRequired: true, mfaToken: 'mfa-token-e2e', mfaMethods: ['passkey'], mfaFallbacks: ['backup', 'email'] });
  });
  // The second-factor request names the account's credentials: the Mac's — and, once this test
  // has registered one, the iPhone's (that is what the real API does on the next sign-in).
  await page.route(at('/auth/mfa/challenge/passkey/options'), (route) =>
    cors(route, () => {
      note(route);
      a.passkeyOptionCalls += 1;
      const ids = [MAC_CREDENTIAL];
      const registered = (a.regVerifyCalls[0]?.response as { id?: string } | undefined)?.id;
      return json(route, {
        options: {
          challenge: b64url(`mfa-challenge-${a.passkeyOptionCalls}-0123456789abcdef`),
          rpId: 'localhost',
          allowCredentials: [
            ...ids.map((id) => ({ id: b64url(id), type: 'public-key', transports: ['internal', 'hybrid'] })),
            ...(registered ? [{ id: registered, type: 'public-key', transports: ['internal'] }] : []),
          ],
          userVerification: 'required',
          timeout: 10_000,
        },
      });
    }),
  );
  await page.route(at('/auth/mfa/challenge/passkey'), (route) =>
    cors(route, () => {
      note(route);
      a.passkeyVerifyCalls.push(postBody(route));
      return json(route, { access_token: FAKE_TOKEN, user: USER });
    }),
  );
  await page.route(at('/auth/mfa/challenge/email/send'), (route) =>
    cors(route, () => {
      note(route);
      a.sendCalls.push(postBody(route));
      return json(route, { challenge: CHALLENGE, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    }),
  );
  await page.route(at('/auth/mfa/challenge/email'), (route) =>
    cors(route, () => {
      note(route);
      const body = postBody(route);
      a.verifyCalls.push(body);
      if (body.challenge !== CHALLENGE || body.code !== RIGHT_CODE) {
        return json(route, { code: 'MFA_EMAIL_CODE_INVALID', message: 'english', attemptsLeft: 4 }, 401);
      }
      // The single-use grant: minted by the API ONLY after the emailed code (mint site 3).
      return json(route, { access_token: FAKE_TOKEN, user: USER, passkeyEnrollment: { grant: GRANT, expiresAt: new Date(Date.now() + 600_000).toISOString() } });
    }),
  );
  await page.route(at('/auth/passkeys/register/options'), (route) =>
    cors(route, () => {
      note(route);
      a.regOptionCalls.push({ body: postBody(route), auth: route.request().headers()['authorization'] });
      return json(route, {
        options: {
          rp: { name: 'VenueOS', id: 'localhost' },
          user: { id: b64url('u1-user-handle'), name: EMAIL, displayName: 'Greg' },
          challenge: b64url('reg-challenge-0123456789abcdef'),
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          timeout: 60_000,
          attestation: 'none',
          // The Mac's credential is excluded, as the API does — it is not on this authenticator.
          excludeCredentials: [{ id: b64url(MAC_CREDENTIAL), type: 'public-key', transports: ['internal', 'hybrid'] }],
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        },
      });
    }),
  );
  await page.route(at('/auth/passkeys/register/verify'), (route) =>
    cors(route, () => {
      note(route);
      const body = postBody(route);
      a.regVerifyCalls.push(body);
      return json(route, { passkey: { id: 'pk-iphone', label: body.label ?? null, createdAt: new Date().toISOString(), lastUsedAt: null, transports: ['internal'] } });
    }),
  );
}

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${test.info().project.name}-phone-setup-${name}.png`), fullPage: true });
}

/** Email → Continue → password → Sign in, verified per keystroke (WebKit hydration race). */
async function signInWithPassword(page: Page) {
  await page.goto('/login');
  const field = page.locator('#login-email');
  await expect(field).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    await field.fill(EMAIL);
    await page.waitForTimeout(150);
    expect(await field.inputValue()).toBe(EMAIL);
  }).toPass({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const password = page.locator('#login-password');
  await expect(password).toBeVisible({ timeout: 30_000 });
  await password.fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** No sideways scroll on the phone. */
async function assertNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The two first choices: visible, EQUAL in size, thumb-sized, inside the phone's width. */
async function assertTwoEqualChoices(page: Page) {
  await expect(page.getByText('Is your passkey on this iPhone?')).toBeVisible({ timeout: 30_000 });
  const choices = page.getByTestId('phone-passkey-choices');
  const use = choices.getByRole('button', { name: 'Use your passkey' });
  const setUp = choices.getByRole('button', { name: 'Set up a passkey on this iPhone' });
  await expect(use).toBeVisible();
  await expect(setUp).toBeVisible();
  const a = await use.boundingBox();
  const b = await setUp.boundingBox();
  expect(a && b).toBeTruthy();
  expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1);
  expect(a!.height).toBeGreaterThanOrEqual(48);
  expect(a!.x).toBeGreaterThanOrEqual(0);
  expect(a!.x + a!.width).toBeLessThanOrEqual(390);
  await assertNoSidewaysScroll(page);
  return { use, setUp };
}

/** The code arrives (sent by the tap itself), iOS can fill it, and Continue takes it. */
async function enterTheEmailedCode(page: Page, a: Api) {
  await expect.poll(() => a.sendCalls.length).toBe(1);
  expect(a.sendCalls[0]).toEqual({ mfaToken: 'mfa-token-e2e' });
  await expect(page.getByText('Enter the code we emailed you to set up a passkey on this iPhone.')).toBeVisible();
  const code = page.locator('#mfa-email-code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  // Nothing that could add a passkey has been asked for yet — the code always comes first.
  expect(a.regOptionCalls).toHaveLength(0);
  await shot(page, '2-code');
  await code.fill(RIGHT_CODE);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => a.verifyCalls.length).toBe(1);
  expect(a.verifyCalls[0]).toEqual({ challenge: CHALLENGE, code: RIGHT_CODE });
}

/** The ONE-button screen, its options bought with the grant the emailed code left. */
async function assertTurnOnScreen(page: Page, a: Api) {
  await expect(page.getByRole('heading', { name: 'Turn on Face ID or Touch ID sign-in for this iPhone' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("You're signed in. Turn it on, and next time signing in here is one tap.")).toBeVisible();
  const card = page.getByTestId('passkey-offer');
  await expect(card.getByRole('button')).toHaveCount(1);
  const turnOn = card.getByRole('button', { name: 'Turn on Face ID or Touch ID' });
  await expect(turnOn).toBeVisible();
  const box = await turnOn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await assertNoSidewaysScroll(page);
  expect(a.regOptionCalls).toHaveLength(1);
  expect(a.regOptionCalls[0].body).toEqual({ enrollmentGrant: GRANT });
  expect(a.regOptionCalls[0].auth).toBe(`Bearer ${FAKE_TOKEN}`);
  // Strictly after the emailed code was verified.
  expect(a.order.indexOf('/auth/passkeys/register/options')).toBeGreaterThan(a.order.indexOf('/auth/mfa/challenge/email'));
  return turnOn;
}

/** A platform authenticator (Face ID stand-in) that holds NOTHING for this account. */
async function addVirtualAuthenticator(page: Page, isUserVerified = true) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('set up a passkey on this phone', () => {
  test.setTimeout(180_000);

  test.describe('chromium — real ceremonies, virtual authenticator with no credential for this account', () => {
    test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });

    test('two choices → "Set up a passkey on this iPhone" → emailed code → ONE button → a REAL passkey → signed in; next visit: only "Use your passkey", one tap', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the virtual authenticator is a CDP (Chromium) feature');
      const a = api();
      await installApiMocks(page, a);
      await page.addInitScript(() => {
        try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
      });
      const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

      await signInWithPassword(page);
      const { setUp } = await assertTwoEqualChoices(page);
      // Nothing started before a choice: no sheet, no QR code.
      expect(a.passkeyOptionCalls).toBe(0);
      await shot(page, '1-choices');

      // ONE tap sends the code — no "Email me a code" in between.
      await setUp.click();
      await enterTheEmailedCode(page, a);
      const turnOn = await assertTurnOnScreen(page, a);
      await shot(page, '3-turn-on');

      // The real create(), inside the tap → saved → straight to the dashboard.
      await turnOn.click();
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
      expect(a.regVerifyCalls).toHaveLength(1);
      expect(a.regVerifyCalls[0].label).toBe('iPhone');
      expect((a.regVerifyCalls[0].response as { type?: string }).type).toBe('public-key');
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      expect(credentials).toHaveLength(1);
      expect(credentials[0].rpId).toBe('localhost');
      // Never the QR code on this path: no sign-in ceremony was ever asked for.
      expect(a.passkeyOptionCalls).toBe(0);
      // This device remembers (an opaque tag — never the address).
      const memory = await page.evaluate(() => localStorage.getItem('venueos_passkey_on_device.v1'));
      expect(JSON.parse(memory || '[]')).toHaveLength(1);
      expect(memory).not.toContain('venueos.example');

      // ── The NEXT sign-in on this device ───────────────────────────────────
      await signInWithPassword(page);
      const usePasskey = page.getByRole('button', { name: 'Use your passkey' });
      await expect(usePasskey).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Use your passkey to finish signing in.')).toBeVisible();
      await expect(page.getByRole('button', { name: /Set up a passkey/ })).toHaveCount(0);
      await shot(page, '5-next-visit');
      // One tap: the passkey made a minute ago answers the real get().
      await usePasskey.click();
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
      expect(a.passkeyVerifyCalls).toHaveLength(1);
      expect((a.passkeyVerifyCalls[0].response as { id?: string }).id).toBe((a.regVerifyCalls[0].response as { id?: string }).id);
    });

    test('Face ID refused at "Turn on" → still signed in, one calm line, Continue → the dashboard', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the virtual authenticator is a CDP (Chromium) feature');
      const a = api();
      await installApiMocks(page, a);
      await page.addInitScript(() => {
        try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
      });
      // User verification FAILS on this authenticator: the create() the button starts is refused
      // — what a dismissed Face ID sheet looks like to the page (NotAllowedError).
      const { cdp, authenticatorId } = await addVirtualAuthenticator(page, false);

      await signInWithPassword(page);
      const { setUp } = await assertTwoEqualChoices(page);
      await setUp.click();
      await enterTheEmailedCode(page, a);
      const turnOn = await assertTurnOnScreen(page, a);
      await turnOn.click();

      await expect(page.getByRole('heading', { name: "You're signed in" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('phone-setup-later')).toHaveText(
        'You can add a passkey for this device later in Settings → My security.',
      );
      await expect(page.locator('.bg-rose-50')).toHaveCount(0);
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      expect(credentials).toHaveLength(0);
      expect(a.regVerifyCalls).toHaveLength(0);
      expect(a.passkeyOptionCalls).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem('venueos_passkey_on_device.v1'))).toBeNull();
      await shot(page, '4-cancelled');

      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
    });
  });

  test.describe('webkit at iPhone size — ceremony mocked', () => {
    test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });

    test('every screen of the path fits a thumb and an iPhone; a cancelled Face ID ends signed in', async ({ page, browserName }) => {
      test.skip(browserName !== 'webkit', 'the WebKit layout pass');
      const a = api();
      await installApiMocks(page, a);
      // The device sheet, mocked: whatever is asked, the "user" dismisses it — NotAllowedError,
      // exactly what Safari reports. Linux WebKit may lack the constructor, so a minimal one
      // stands in; the app's support check is "is it a function".
      await page.addInitScript(() => {
        try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
        const w = window as unknown as { PublicKeyCredential?: unknown; __creates?: number; __gets?: number };
        if (typeof w.PublicKeyCredential !== 'function') {
          const PKC = function PublicKeyCredential() {} as unknown as Record<string, unknown>;
          PKC.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(true);
          PKC.isConditionalMediationAvailable = () => Promise.resolve(false);
          w.PublicKeyCredential = PKC;
        } else {
          const PKC = w.PublicKeyCredential as unknown as Record<string, unknown>;
          PKC.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(true);
          PKC.isConditionalMediationAvailable = () => Promise.resolve(false);
        }
        const creds = navigator.credentials as unknown as Record<string, unknown>;
        Object.defineProperty(navigator, 'credentials', {
          configurable: true,
          value: {
            ...creds,
            get: () => {
              w.__gets = (w.__gets ?? 0) + 1;
              return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
            },
            create: () => {
              w.__creates = (w.__creates ?? 0) + 1;
              return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
            },
          },
        });
      });

      await signInWithPassword(page);
      const { setUp } = await assertTwoEqualChoices(page);
      await expect(setUp).toHaveAccessibleDescription("We'll email you a code first, to make sure it's you.");
      await axe(page, 'two choices');
      await shot(page, '1-choices');

      // Back from the code returns to the two choices.
      await setUp.click();
      await expect(page.locator('#mfa-email-code')).toBeFocused();
      await axe(page, 'set-up code');
      await assertNoSidewaysScroll(page);
      for (const name of ['Continue', 'Back', 'Send a new code']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await assertTwoEqualChoices(page);
      a.sendCalls.length = 0;

      await page.getByTestId('phone-passkey-choices').getByRole('button', { name: 'Set up a passkey on this iPhone' }).click();
      await enterTheEmailedCode(page, a);
      const turnOn = await assertTurnOnScreen(page, a);
      await axe(page, 'turn on');
      await shot(page, '3-turn-on');

      // The mocked sheet is dismissed → signed in, one calm line, Continue. Never red, never stuck,
      // never the QR code (no get() was ever started).
      await turnOn.click();
      expect(await page.evaluate(() => (window as unknown as { __creates?: number }).__creates)).toBe(1);
      await expect(page.getByRole('heading', { name: "You're signed in" })).toBeVisible();
      await expect(page.getByTestId('phone-setup-later')).toBeVisible();
      await expect(page.locator('.bg-rose-50')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __gets?: number }).__gets ?? 0)).toBe(0);
      const cont = page.getByRole('button', { name: 'Continue', exact: true });
      expect((await cont.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await assertNoSidewaysScroll(page);
      await axe(page, 'signed in, no passkey');
      await shot(page, '4-cancelled');
      await cont.click();
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
    });
  });
});
