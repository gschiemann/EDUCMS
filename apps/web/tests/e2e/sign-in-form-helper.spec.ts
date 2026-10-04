/**
 * `tests/cross-browser/sign-in-form.cjs` — the ONE helper every harness that signs in through
 * the real form uses (prod-smoke, webkit-nav-smoke, settings-cc-workspace-shot, the a11y audit,
 * the beta persona runner). Those run against the LIVE deploy with real credentials, so they
 * cannot be run from a pull request — and a helper that is wrong goes red only AFTER a deploy.
 * This spec is where it is proved instead (chromium + webkit):
 *
 *   • against the real page as built here — identifier-first, first-time browser (EULA
 *     checkbox), returning browser (no checkbox), and a domain lookup that never answers;
 *   • against the SINGLE-SCREEN form that shipped before 2026-10-04, because the smoke jobs
 *     can reach the live site a minute before OR after Vercel has the new page. That one is a
 *     fixture cut from the old page's own markup (ids, attributes, the required EULA checkbox);
 *     delete the case once the two-step page has been live for a release.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fillSignInForm, submitSignIn } from '../cross-browser/sign-in-form.cjs';

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const API_ROOT = 'http://api.invalid/api/v1';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const SLUG = 'e2e-school';
const EMAIL = 'smoke@elsewhere.example';
const PASSWORD = 'correct horse battery staple';
const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;
const SESSION = {
  access_token: FAKE_TOKEN,
  user: { id: 'u1', email: EMAIL, role: 'CONTRIBUTOR', tenantId: SLUG, tenantSlug: SLUG, canTriggerPanic: false },
};

const at = (p: string) => new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${p}(\\?.*)?$`);

async function mockApi(page: Page, lookup: 'answers' | 'hangs') {
  const loginCalls: Array<Record<string, unknown>> = [];
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const json = (route: Route, body: unknown) =>
    cors(route, () => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  await page.route(/^http:\/\/api\.invalid\//, (route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })));
  await page.route(at('/auth/me'), (route) => json(route, SESSION.user));
  await page.route(at('/auth/sign-in-options'), (route) =>
    cors(route, () => (lookup === 'hangs' ? undefined : json(route, { password: true, sso: null }))),
  );
  await page.route(at('/auth/login'), (route) =>
    cors(route, () => {
      loginCalls.push(JSON.parse(route.request().postData() || '{}'));
      return json(route, SESSION);
    }),
  );
  return loginCalls;
}

test.describe('the shared sign-in helper drives the page the smoke jobs will meet', () => {
  test('identifier-first, a fresh browser: email → Continue → password → EULA → Sign in', async ({ page }) => {
    const loginCalls = await mockApi(page, 'answers');
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await fillSignInForm(page, EMAIL, PASSWORD);
    // It filled; it did not submit.
    expect(loginCalls).toHaveLength(0);
    await expect(page.locator('#login-password')).toHaveValue(PASSWORD);
    await expect(page.getByRole('checkbox', { name: /End User License Agreement/ })).toBeChecked();
    // Only the EULA box — "Keep me signed in" is the operator's choice, not the helper's.
    await expect(page.getByRole('checkbox', { name: 'Keep me signed in' })).not.toBeChecked();

    await submitSignIn(page);
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(loginCalls).toEqual([{ email: EMAIL, password: PASSWORD, rememberMe: false }]);
  });

  test('a returning browser (no EULA checkbox to tick)', async ({ page }) => {
    const loginCalls = await mockApi(page, 'answers');
    await page.addInitScript(() => {
      try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
    });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await fillSignInForm(page, EMAIL, PASSWORD);
    await submitSignIn(page);
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(loginCalls).toHaveLength(1);
  });

  test('a domain lookup that never answers (an API one deploy behind): the page moves on after 3 s, and so does the helper', async ({ page }) => {
    const loginCalls = await mockApi(page, 'hangs');
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await fillSignInForm(page, EMAIL, PASSWORD);
    await submitSignIn(page);
    await page.waitForURL(new RegExp(`/${SLUG}/dashboard`));
    expect(loginCalls).toHaveLength(1);
  });

  test('the SINGLE-SCREEN form that shipped before 2026-10-04 (a live site one deploy behind)', async ({ page }) => {
    // The old page's form, reduced to what the helper touches: the two ids, the required EULA
    // checkbox with its aria-describedby, "Keep me signed in", and the submit button.
    await page.route('**/old-sign-in-form', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><title>old</title>
<form id="f">
  <label for="login-email">Email</label>
  <input id="login-email" type="email" required autocomplete="email">
  <label for="login-password">Password</label>
  <input id="login-password" type="password" required autocomplete="current-password">
  <label><input type="checkbox" id="keep"> Keep me signed in</label>
  <label><input type="checkbox" id="eula" required aria-describedby="eula-text"><span id="eula-text">I have read and agree to the End User License Agreement</span></label>
  <button type="submit">Sign in</button>
  <button type="button">Sign in with a passkey</button>
  <button type="button">Sign in with SSO</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault();
    window.__submitted = {
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value,
      eula: document.getElementById('eula').checked,
      keep: document.getElementById('keep').checked,
    };
  });
</script>`,
      }),
    );
    await page.goto('/old-sign-in-form');

    await fillSignInForm(page, EMAIL, PASSWORD);
    await submitSignIn(page);

    expect(await page.evaluate(() => (window as unknown as { __submitted?: unknown }).__submitted)).toEqual({
      email: EMAIL,
      password: PASSWORD,
      eula: true,
      keep: false,
    });
  });
});
