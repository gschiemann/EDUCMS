/**
 * THE PASSKEY IS ON ANOTHER DEVICE — in a real browser (2026-10-05).
 *
 * Owner (SUPER_ADMIN): his only passkey was made on his Mac. On his iPhone the second sign-in
 * step asked for it, iOS showed its cross-device QR code (useless on the phone itself), and there
 * was no way through and no way to add a passkey for the phone. "I should be able to add the
 * passkey right from the mobile device, the idea is to make this workflow super user friendly."
 *
 *   chromium — the REAL WebAuthn ceremonies against a CDP virtual authenticator that holds NO
 *              credential for this account (= the passkey lives on another device): the sheet
 *              ends with nothing → "Your passkey may be on another device…" → "Email me a code"
 *              → a wrong code, then the right one → signed in → "Add a passkey for this iPhone"
 *              → a REAL credential is created on the authenticator → saved → the dashboard.
 *   webkit   — at iPhone width (390×844) with the ceremony mocked: the same cancel → another-way
 *              path, the layout (no sideways scroll, thumb-sized targets), the emailed code, the
 *              offer.
 *
 * Every API call is intercepted on the API origin (`http://api.invalid/api/v1`). No database.
 *
 *   E2E_BASE=http://localhost:3417 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/passkey-other-device.spec.ts
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

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;
const USER = { id: 'u1', email: EMAIL, role: 'SUPER_ADMIN', tenantId: SLUG, tenantSlug: SLUG, canTriggerPanic: true };

interface Api {
  sendCalls: Array<Record<string, unknown>>;
  verifyCalls: Array<Record<string, unknown>>;
  regOptionCalls: Array<{ body: Record<string, unknown>; auth: string | undefined }>;
  regVerifyCalls: Array<Record<string, unknown>>;
  passkeyOptionCalls: number;
}
const api = (): Api => ({ sendCalls: [], verifyCalls: [], regOptionCalls: [], regVerifyCalls: [], passkeyOptionCalls: 0 });

const at = (p: string) => new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${p}(\\?.*)?$`);

async function installApiMocks(page: Page, a: Api) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const json = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const postBody = (route: Route) => JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;

  // Broadest catch-all FIRST (Playwright matches last-registered first).
  await page.route(/^http:\/\/api\.invalid\//, (route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })));
  await page.route(at('/auth/me'), (route) => json(route, USER));
  await page.route(at('/auth/sign-in-options'), (route) => json(route, { password: true, sso: null }));
  // Step 1's passkey autofill: refused (silently) — this spec is about the SECOND step.
  await page.route(at('/auth/passkeys/login/options'), (route) => json(route, { message: 'not in this test' }, 404));
  // The password is right; the account's second factor is a passkey (on the Mac), it has backup
  // codes, and mail is configured — exactly the owner's account.
  await page.route(at('/auth/login'), (route) =>
    json(route, { mfaRequired: true, mfaToken: 'mfa-token-e2e', mfaMethods: ['passkey'], mfaFallbacks: ['backup', 'email'] }),
  );
  // The second-factor request names the account's ONE credential — which is on the Mac, so the
  // authenticator here cannot answer it.
  await page.route(at('/auth/mfa/challenge/passkey/options'), (route) =>
    cors(route, () => {
      a.passkeyOptionCalls += 1;
      return json(route, {
        options: {
          challenge: b64url('mfa-challenge-0123456789abcdef'),
          rpId: 'localhost',
          allowCredentials: [{ id: b64url('the-macs-credential-id-0123456789'), type: 'public-key', transports: ['internal', 'hybrid'] }],
          userVerification: 'required',
          timeout: 10_000,
        },
      });
    }),
  );
  await page.route(at('/auth/mfa/challenge/email/send'), (route) =>
    cors(route, () => {
      a.sendCalls.push(postBody(route));
      return json(route, { challenge: CHALLENGE, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    }),
  );
  await page.route(at('/auth/mfa/challenge/email'), (route) =>
    cors(route, () => {
      const body = postBody(route);
      a.verifyCalls.push(body);
      if (body.challenge !== CHALLENGE || body.code !== RIGHT_CODE) {
        return json(route, { code: 'MFA_EMAIL_CODE_INVALID', message: 'english', attemptsLeft: 4 }, 401);
      }
      return json(route, { access_token: FAKE_TOKEN, user: USER, passkeyEnrollment: { grant: GRANT, expiresAt: new Date(Date.now() + 600_000).toISOString() } });
    }),
  );
  // The offer: the single-use grant buys creation options for THIS origin (localhost).
  await page.route(at('/auth/passkeys/register/options'), (route) =>
    cors(route, () => {
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
          excludeCredentials: [{ id: b64url('the-macs-credential-id-0123456789'), type: 'public-key', transports: ['internal', 'hybrid'] }],
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        },
      });
    }),
  );
  await page.route(at('/auth/passkeys/register/verify'), (route) =>
    cors(route, () => {
      const body = postBody(route);
      a.regVerifyCalls.push(body);
      return json(route, { passkey: { id: 'pk-iphone', label: body.label ?? null, createdAt: new Date().toISOString(), lastUsedAt: null, transports: ['internal'] } });
    }),
  );
}

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${test.info().project.name}-other-device-${name}.png`), fullPage: true });
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

/** No sideways scroll, and every way through is a thumb-sized target. */
async function assertPhoneLayout(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const b of await page.getByTestId('mfa-other-ways').getByRole('button').all()) {
    const box = await b.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }
}

async function emailCodeToSignIn(page: Page, a: Api) {
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect.poll(() => a.sendCalls.length).toBe(1);
  expect(a.sendCalls[0]).toEqual({ mfaToken: 'mfa-token-e2e' });
  await expect(page.getByText(`We emailed a 6-digit code to ${EMAIL}.`)).toBeVisible();
  const code = page.locator('#mfa-email-code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await shot(page, '3-code-form');

  // A wrong code first: the tries left, in the catalog's words.
  await code.fill('000000');
  await page.getByRole('button', { name: 'Verify & sign in' }).click();
  await expect(page.getByText("That code doesn't match. 4 tries left.")).toBeVisible();
  // Then the right one.
  await code.fill(RIGHT_CODE);
  await page.getByRole('button', { name: 'Verify & sign in' }).click();
  await expect.poll(() => a.verifyCalls.length).toBe(2);
  expect(a.verifyCalls[1]).toEqual({ challenge: CHALLENGE, code: RIGHT_CODE });
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('the passkey is on another device', () => {
  test.setTimeout(180_000);

  test.describe('chromium — real ceremonies, virtual authenticator with no credential for this account', () => {
    test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });

    test('miss → another way → emailed code → signed in → a REAL passkey created for this device', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the virtual authenticator is a CDP (Chromium) feature');
      const a = api();
      await installApiMocks(page, a);
      await page.addInitScript(() => {
        try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
      });
      // A platform authenticator (Face ID stand-in) that holds NOTHING for this account.
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

      await signInWithPassword(page);
      const usePasskey = page.getByRole('button', { name: 'Use your passkey' });
      await expect(usePasskey).toBeVisible({ timeout: 30_000 });
      // "Use another way" is there from the start.
      await expect(page.getByRole('button', { name: 'Use another way', exact: true })).toBeVisible();
      await shot(page, '1-passkey-step');

      // The real get(): this authenticator has no such credential → the ceremony ends empty.
      await usePasskey.click();
      await expect(page.getByTestId('passkey-elsewhere-note')).toHaveText(
        'Your passkey may be on another device. Sign in another way on this one:',
        { timeout: 60_000 },
      );
      const ways = page.getByTestId('mfa-other-ways');
      // On a phone, setting a passkey up HERE leads the list (2026-10-05 —
      // passkey-phone-setup.spec.ts walks that path).
      await expect(ways.getByRole('button')).toHaveText(['Set up a passkey on this iPhone', 'Use a backup code', 'Email me a code']);
      await expect(page.getByRole('button', { name: 'Try your passkey again' })).toBeVisible();
      await expect(page.locator('.bg-rose-50')).toHaveCount(0);
      await assertPhoneLayout(page);
      await shot(page, '2-another-way');

      await emailCodeToSignIn(page, a);

      // Signed in → the offer for THIS device, prepared before it is shown.
      await expect(page.getByRole('heading', { name: 'Sign in with Face ID or Touch ID next time?' })).toBeVisible({ timeout: 30_000 });
      expect(a.regOptionCalls).toHaveLength(1);
      expect(a.regOptionCalls[0].body).toEqual({ enrollmentGrant: GRANT });
      expect(a.regOptionCalls[0].auth).toBe(`Bearer ${FAKE_TOKEN}`);
      await shot(page, '4-offer');

      // The real create(), inside the tap.
      await page.getByRole('button', { name: 'Add a passkey for this iPhone' }).click();
      await expect(page.getByRole('heading', { name: 'Passkey saved' })).toBeVisible({ timeout: 30_000 });
      expect(a.regVerifyCalls).toHaveLength(1);
      expect(a.regVerifyCalls[0].label).toBe('iPhone');
      expect((a.regVerifyCalls[0].response as { type?: string }).type).toBe('public-key');
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      expect(credentials).toHaveLength(1);
      expect(credentials[0].rpId).toBe('localhost');
      await shot(page, '5-saved');

      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
    });
  });

  test.describe('webkit at iPhone width — ceremony mocked', () => {
    test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });

    test('cancel → "may be on another device" → the ways that work here → emailed code → the offer', async ({ page, browserName }) => {
      test.skip(browserName !== 'webkit', 'the WebKit layout pass');
      const a = api();
      await installApiMocks(page, a);
      // The device sheet, mocked: whatever is asked, the "user" dismisses it (iOS's QR code
      // closed) — NotAllowedError, exactly what Safari reports. Linux WebKit may lack the
      // constructor, so a minimal one stands in; the app's support check is "is it a function".
      await page.addInitScript(() => {
        try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
        const w = window as unknown as { PublicKeyCredential?: unknown; __creates?: number };
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
            get: () => Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError')),
            create: () => {
              w.__creates = (w.__creates ?? 0) + 1;
              return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
            },
          },
        });
      });

      await signInWithPassword(page);
      const usePasskey = page.getByRole('button', { name: 'Use your passkey' });
      await expect(usePasskey).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Use another way', exact: true })).toBeVisible();
      await usePasskey.click();

      await expect(page.getByTestId('passkey-elsewhere-note')).toHaveText(
        'Your passkey may be on another device. Sign in another way on this one:',
      );
      await expect(page.getByTestId('mfa-other-ways').getByRole('button')).toHaveText([
        'Set up a passkey on this iPhone',
        'Use a backup code',
        'Email me a code',
      ]);
      await expect(page.locator('.bg-rose-50')).toHaveCount(0);
      await assertPhoneLayout(page);
      await axe(page, 'another way');
      await shot(page, '2-another-way');

      await page.getByRole('button', { name: 'Email me a code' }).click();
      await expect(page.locator('#mfa-email-code')).toBeFocused();
      await axe(page, 'emailed-code form');
      await page.getByRole('button', { name: 'Use another way' }).click();
      await expect(page.getByTestId('mfa-other-ways')).toBeVisible();
      a.sendCalls.length = 0;

      await emailCodeToSignIn(page, a);
      await expect(page.getByRole('heading', { name: 'Sign in with Face ID or Touch ID next time?' })).toBeVisible({ timeout: 30_000 });
      const add = page.getByRole('button', { name: 'Add a passkey for this iPhone' });
      await expect(add).toBeVisible();
      await shot(page, '4-offer');
      // The mocked sheet is dismissed → a calm note and Continue, never red, never stuck.
      await add.click();
      expect(await page.evaluate(() => (window as unknown as { __creates?: number }).__creates)).toBe(1);
      await expect(page.getByText('No passkey was set up. You can add one anytime in Settings → My security.')).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard`), { timeout: 30_000 });
    });
  });
});
