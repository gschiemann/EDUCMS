/**
 * PASSKEY SETUP PATH in a real browser (2026-09-24) — chromium + webkit for the way in, chromium
 * for the ceremony (a CDP virtual authenticator stands in for Touch ID / Windows Hello).
 *
 * Operator (SUPER_ADMIN, 2026-09-24): "it seems like the passkey still has no way to get setup
 * for me". The sign-in offer is one screen, once per sign-in, and a single "Not now" used to put
 * it away for THIRTY DAYS with nothing else in the product naming the Settings path. Now:
 *
 *   - the account menu (the avatar) carries "Set up a passkey" → Settings → My security with the
 *     Add panel ALREADY open and the password field focused (`?add=passkey`);
 *   - the ceremony runs to a saved passkey: creation options from the API (password re-auth),
 *     the platform authenticator, the attestation verified, the list updated — and the menu
 *     entry then reads "Manage passkeys" (→ the list, `#sec-passkeys`).
 *
 * The dashboard against the dev server with every API call intercepted ON THE API ORIGIN (the
 * harness of ai-board-history-credits.spec.ts).
 *
 *   E2E_BASE=http://localhost:3217 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/passkey-setup-path.spec.ts
 *   (a dev server started with NEXT_PUBLIC_API_URL=http://api.invalid/api/v1 — the `web-e2e-mock` preview)
 */
import * as path from 'path';
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const EMAIL = 'e2e@example.com';
const PASSWORD = 'correct horse battery staple';
const FAKE_USER = { id: 'u1', email: EMAIL, role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;

/** What POST /auth/passkeys/register/options answers: creation options for THIS origin (localhost). */
const CREATION_OPTIONS = {
  rp: { name: 'VenueOS', id: 'localhost' },
  user: { id: b64url('u1'), name: EMAIL, displayName: 'E2E Operator' },
  challenge: b64url('e2e-challenge-0123456789abcdef'),
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
  timeout: 60_000,
  attestation: 'none',
  excludeCredentials: [],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  extensions: { credProps: true },
};

interface PasskeyRow { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; transports: string[] }
interface Api {
  passkeys: PasskeyRow[];
  optionsCalls: Array<Record<string, unknown>>;
  verifyCalls: Array<Record<string, unknown>>;
}

const API_ROOT = 'http://api.invalid/api/v1';
const at = (pathPattern: string) => new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${pathPattern}(\\?.*)?$`);

async function installApiMocks(page: Page, a: Api) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const okJson = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));

  // Broadest catch-all FIRST (Playwright matches last-registered first).
  await page.route(/^http:\/\/api\.invalid\//, empty);
  await page.route(at('/auth/me'), (route) => okJson(route, FAKE_USER));
  await page.route(at('/tenants'), (route) => okJson(route, [{ id: SCHOOL_ID, name: 'Super Taco', slug: SCHOOL_ID, vertical: 'RESTAURANT' }]));
  await page.route(at('/tenants/accessible'), (route) => okJson(route, [{ id: SCHOOL_ID, name: 'Super Taco', slug: SCHOOL_ID }]));
  await page.route(at('/templates'), (route) => okJson(route, []));
  await page.route(at('/templates/usage-summary'), (route) => okJson(route, {}));
  await page.route(at('/screens'), (route) => okJson(route, []));
  await page.route(at('/branding/me'), (route) => okJson(route, {}));
  await page.route(at('/auth/mfa/status'), (route) => okJson(route, { enabled: false, passkeyCount: a.passkeys.length }));

  // ── the surfaces under test ──
  await page.route(at('/auth/passkeys'), (route) => okJson(route, { passkeys: a.passkeys, max: 10 }));
  await page.route(at('/auth/passkeys/register/options'), (route) =>
    cors(route, () => {
      const body = JSON.parse(route.request().postData() || '{}');
      a.optionsCalls.push(body);
      if (body.password !== PASSWORD) {
        return okJson(route, { error: true, code: 'INVALID_PASSWORD', message: 'That password is not right.' }, 403);
      }
      return okJson(route, { options: CREATION_OPTIONS });
    }),
  );
  await page.route(at('/auth/passkeys/register/verify'), (route) =>
    cors(route, () => {
      const body = JSON.parse(route.request().postData() || '{}');
      a.verifyCalls.push(body);
      const row: PasskeyRow = {
        id: `pk-${a.passkeys.length + 1}`,
        label: typeof body.label === 'string' ? body.label : null,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        transports: ['internal'],
      };
      a.passkeys.push(row);
      return okJson(route, { passkey: row });
    }),
  );
}

function api(): Api {
  return { passkeys: [], optionsCalls: [], verifyCalls: [] };
}

async function signedIn(page: Page, a: Api) {
  await installApiMocks(page, a);
  await page.addInitScript(
    ({ token, user }: { token: string; user: string }) => {
      try {
        localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
        sessionStorage.setItem('edu_cms_token', token);
        sessionStorage.setItem('edu_cms_user', user);
      } catch {
        /* ignore */
      }
    },
    { token: FAKE_TOKEN, user: JSON.stringify(FAKE_USER) },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${test.info().project.name}-passkey-${name}.png`) });
}

/**
 * Exactly the app's own support check (`passkeysSupported` → simplewebauthn's
 * `browserSupportsWebAuthn`): `PublicKeyCredential` must be a FUNCTION. CI's Linux WebKit
 * defines the name without the constructor, so the entry and the Add panel are (correctly)
 * absent there — a test that expected them would be testing the browser, not the product.
 */
const webAuthnCapable = (page: Page) =>
  page.evaluate(() => typeof (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function');

/** The avatar button carries the operator's email as its title. */
const avatar = (page: Page) => page.getByTitle(EMAIL).first();

test.describe('Passkeys — the always-there way to set one up', () => {
  test.setTimeout(180_000);

  test('the account menu names the way in: "Set up a passkey" → My security with the Add panel open and the password focused', async ({ page }) => {
    const a = api();
    await signedIn(page, a);
    await page.goto(`/${SCHOOL_ID}/templates`, { waitUntil: 'domcontentloaded' });
    await expect(avatar(page)).toBeVisible({ timeout: 60_000 });

    // The entry exists only on a device that can hold a passkey — a headless build may not.
    test.skip(!(await webAuthnCapable(page)), 'this browser build has no WebAuthn — the entry is (correctly) absent');

    await avatar(page).click();
    const entry = page.getByTestId('passkey-menu-entry');
    await expect(entry).toBeVisible();
    await expect(entry).toHaveText(/Set up a passkey/);
    await expect(entry).toHaveAttribute('href', `/${SCHOOL_ID}/settings/security?add=passkey`);
    await shot(page, 'menu');
    await entry.click();

    await expect(page).toHaveURL(new RegExp(`/${SCHOOL_ID}/settings/security\\?add=passkey`));
    const password = page.locator('#passkey-add-password');
    await expect(password).toBeVisible({ timeout: 60_000 });
    await expect(password).toBeFocused();
    await shot(page, 'add-panel');
  });

  test('the ceremony runs to a saved passkey: password → options → the device → verified → in the list; the menu then reads "Manage passkeys"', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a CDP (Chromium) feature');
    const a = api();
    await signedIn(page, a);

    // A platform authenticator that answers every prompt — Touch ID without the finger.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await page.goto(`/${SCHOOL_ID}/settings/security?add=passkey`, { waitUntil: 'domcontentloaded' });
    const password = page.locator('#passkey-add-password');
    await expect(password).toBeVisible({ timeout: 60_000 });
    await password.fill(PASSWORD);
    await page.locator('form:has(#passkey-add-password) button[type="submit"]').click();

    // The list has the new passkey — labelled with what the page guessed for this device.
    await expect.poll(() => a.verifyCalls.length, { timeout: 30_000 }).toBe(1);
    expect(a.optionsCalls[0]).toEqual({ password: PASSWORD });
    const verify = a.verifyCalls[0] as { response?: { id?: string; type?: string }; label?: string };
    expect(verify.response?.type).toBe('public-key');
    expect(verify.response?.id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(typeof verify.label).toBe('string');
    const section = page.locator('#sec-passkeys');
    await expect(section.getByText(verify.label as string, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(password).toBeHidden();
    await shot(page, 'saved');

    // The way in now leads to the list.
    await avatar(page).click();
    const entry = page.getByTestId('passkey-menu-entry');
    await expect(entry).toHaveText(/Manage passkeys/, { timeout: 30_000 });
    await expect(entry).toHaveAttribute('href', `/${SCHOOL_ID}/settings/security#sec-passkeys`);
  });

  test('a wrong password is refused in place — the panel stays, nothing is created', async ({ page }) => {
    const a = api();
    await signedIn(page, a);
    await page.goto(`/${SCHOOL_ID}/settings/security?add=passkey`, { waitUntil: 'domcontentloaded' });
    await expect(avatar(page)).toBeVisible({ timeout: 60_000 });
    test.skip(!(await webAuthnCapable(page)), 'this browser build has no WebAuthn — the Add panel is (correctly) absent');
    const password = page.locator('#passkey-add-password');
    await expect(password).toBeVisible({ timeout: 60_000 });
    await password.fill('not it');
    await page.locator('form:has(#passkey-add-password) button[type="submit"]').click();
    await expect.poll(() => a.optionsCalls.length, { timeout: 30_000 }).toBe(1);
    await expect(password).toBeVisible();
    expect(a.verifyCalls).toHaveLength(0);
    expect(a.passkeys).toHaveLength(0);
  });
});
