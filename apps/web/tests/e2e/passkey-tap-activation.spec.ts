/**
 * THE PASSKEY SHEET OPENS INSIDE THE TAP — in a real browser (2026-10-11).
 *
 * Owner, Safari on a Mac, several accounts: "Use your passkey" PERIODICALLY opened nothing.
 * Safari runs navigator.credentials.get() only inside the tap's user activation; the old handler
 * awaited the options request first, so a slow request spent the activation and Safari refused
 * (NotAllowedError) or showed nothing. The fix fetches the options when the step comes on screen
 * and starts the ceremony synchronously in the click.
 *
 * Playwright's virtual authenticator is CDP — Chromium only — and Playwright's WebKit rejects
 * EVERY modal get() within ~4 ms with NotAllowedError (measured 2026-10-11: a get() 1 ms after
 * the tap and one 6 s after it were refused identically), so real WebKit cannot show the
 * difference. The proof here is a SAFARI-LIKE STUB, run in chromium AND webkit: an init script
 * replaces `credentials.get`, records how long after the last real pointer press the page called
 * it, and behaves like Safari — more than a second after the tap → reject NotAllowedError at
 * once; inside it → a sheet that stays open. (`navigator.userActivation.isActive` is recorded
 * too, but not asserted: both headless engines kept it true 6 s after a click, so it cannot tell
 * the two orders apart — the time since the tap can.) The real Safari check is by hand.
 *
 *   E2E_BASE=http://localhost:3417 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/passkey-tap-activation.spec.ts
 *   (a dev server started with NEXT_PUBLIC_API_URL=http://api.invalid/api/v1)
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const API_ROOT = 'http://api.invalid/api/v1';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const EMAIL = 'owner@venueos.example';
const PASSWORD = 'correct horse battery staple';
const TAP_AGAIN = "Your browser didn't open the passkey prompt. Tap the passkey button again — it's ready now.";
const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const at = (p: string) => new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${p}(\\?.*)?$`);

/** A slow API: longer than any engine's activation window. */
const SLOW_MS = 6_000;

interface Plan {
  /** Per options request, in order: delay, and whether it succeeds. Last entry repeats. */
  options: Array<{ delayMs: number; ok: boolean }>;
}

async function installApiMocks(page: Page, plan: Plan) {
  const seen = { optionCalls: 0 };
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const json = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));

  await page.addInitScript(() => {
    // This browser already accepted the EULA (a returning operator).
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes'); } catch { /* ignore */ }
  });
  await page.route(/^http:\/\/api\.invalid\//, (route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })));
  await page.route(at('/auth/sign-in-options'), (route) => json(route, { password: true, sso: null }));
  await page.route(at('/auth/passkeys/login/options'), (route) => json(route, { message: 'not in this test' }, 404));
  await page.route(at('/auth/login'), (route) =>
    json(route, { mfaRequired: true, mfaToken: 'mfa-token-e2e', mfaMethods: ['passkey'], mfaFallbacks: ['backup'] }),
  );
  await page.route(at('/auth/mfa/challenge/passkey/options'), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
    const step = plan.options[Math.min(seen.optionCalls, plan.options.length - 1)];
    seen.optionCalls += 1;
    const n = seen.optionCalls;
    await new Promise((r) => setTimeout(r, step.delayMs));
    if (!step.ok) return json(route, { message: 'blip' }, 503);
    return json(route, {
      options: {
        challenge: b64url(`mfa-challenge-${n}-0123456789abcdef`),
        rpId: 'localhost',
        allowCredentials: [{ id: b64url('credential-id-0123456789'), type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
  });
  return seen;
}

interface GetCall { sinceTapMs: number | null; active: boolean | null; mediation: string | null }

/** Record each get() and refuse it like Safari when the tap is more than a second old. */
async function installSafariLikeCredentials(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __getCalls: GetCall[]; __lastTapAt: number | null };
    w.__getCalls = [];
    w.__lastTapAt = null;
    window.addEventListener('pointerdown', () => { w.__lastTapAt = performance.now(); }, true);
    const fakeGet = function (opts?: CredentialRequestOptions) {
      const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
      const sinceTapMs = w.__lastTapAt === null ? null : performance.now() - w.__lastTapAt;
      w.__getCalls.push({ sinceTapMs, active: ua ? ua.isActive : null, mediation: (opts?.mediation as string | undefined) ?? null });
      if (opts?.mediation === 'conditional') return new Promise(() => { /* autofill: never settles */ });
      if (sinceTapMs === null || sinceTapMs > 1_000) {
        return Promise.reject(new DOMException('The request is not allowed by the user agent.', 'NotAllowedError'));
      }
      return new Promise(() => { /* the sheet is open for the rest of the test */ });
    };
    // On the PROTOTYPE: WebKit ignores an assignment to the instance property.
    Object.defineProperty(CredentialsContainer.prototype, 'get', { value: fakeGet, configurable: true, writable: true });
  });
}

const modalGets = (page: Page) =>
  page.evaluate(() => (window as unknown as { __getCalls: GetCall[] }).__getCalls.filter((c) => c.mediation !== 'conditional'));

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

test.describe('the passkey ceremony starts inside the tap (Safari-like stub)', () => {
  test.setTimeout(120_000);

  test('a SLOW options request no longer costs the tap its activation', async ({ page }) => {
    // The options take 6 s. The old order (tap → fetch → get) called get() 6 s after the tap.
    const seen = await installApiMocks(page, { options: [{ delayMs: SLOW_MS, ok: true }] });
    await installSafariLikeCredentials(page);
    await signInWithPassword(page);
    const btn = page.getByRole('button', { name: 'Use your passkey' });
    await expect(btn).toBeVisible({ timeout: 30_000 });
    // Fetched when the step came on screen — before any tap.
    await expect.poll(() => seen.optionCalls).toBe(1);
    await page.waitForTimeout(SLOW_MS + 500); // the slow reply lands

    await btn.click();
    await expect.poll(async () => (await modalGets(page)).length).toBe(1);
    const [call] = await modalGets(page);
    expect(call.sinceTapMs).not.toBeNull();
    expect(call.sinceTapMs!).toBeLessThan(500); // in the same task as the click, in practice ~0
    expect(seen.optionCalls).toBe(1); // no request in front of the ceremony
    await page.waitForTimeout(500);
    await expect(page.getByText(TAP_AGAIN)).toHaveCount(0);
  });

  test('options NOT ready: the late ceremony is refused → "tap again" → the next tap goes straight to the device', async ({ page }) => {
    // The prefetch fails (a blip); the tap's own request is slow, so its get() comes 6 s after
    // the tap and is refused; the re-fetch after it is fast, so the SECOND tap has options.
    const seen = await installApiMocks(page, {
      options: [{ delayMs: 0, ok: false }, { delayMs: SLOW_MS, ok: true }, { delayMs: 0, ok: true }],
    });
    await installSafariLikeCredentials(page);
    await signInWithPassword(page);
    const btn = page.getByRole('button', { name: 'Use your passkey' });
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => seen.optionCalls).toBe(1);

    await btn.click();
    await expect.poll(async () => (await modalGets(page)).length, { timeout: SLOW_MS + 10_000 }).toBe(1);
    let gets = await modalGets(page);
    expect(gets[0].sinceTapMs!).toBeGreaterThan(SLOW_MS - 500); // the old order, every slow tap
    await expect(page.getByText(TAP_AGAIN)).toBeVisible();
    // Not the "your passkey is on another device" detour.
    await expect(page.getByTestId('passkey-elsewhere-note')).toHaveCount(0);
    await expect.poll(() => seen.optionCalls).toBe(3);

    await page.getByRole('button', { name: 'Use your passkey' }).click();
    await expect.poll(async () => (await modalGets(page)).length).toBe(2);
    gets = await modalGets(page);
    expect(gets[1].sinceTapMs!).toBeLessThan(500);
    expect(seen.optionCalls).toBe(3);
  });
});
