/**
 * sign-in-form.cjs — fill the dashboard's sign-in page from a Playwright script.
 *
 * ONE copy, shared by every harness that signs in through the real form
 * (prod-smoke, webkit-nav-smoke, settings-cc-workspace-shot, the a11y audit,
 * the beta persona runner), so the next change to the sign-in page is one edit
 * here instead of five scripts going red after a deploy.
 *
 * THE PAGE IS IDENTIFIER-FIRST since 2026-10-04:
 *
 *   step 1   the email, "Continue"
 *            (the page asks the API what applies to the email's domain; it
 *            gives up after 3 s and shows the password form regardless)
 *   step 2   the password, "Sign in" — plus the EULA checkbox for a browser
 *            that has not accepted it yet, which every fresh Playwright
 *            context is.
 *
 * WRITTEN FOR BOTH SHAPES, ON PURPOSE. These harnesses run against the LIVE
 * deploy, and a push reaches Vercel (the page) and the runner (this file) at
 * different moments — prod-smoke.yml says so itself: it "may smoke a Vercel
 * build that is a minute or two behind". So if the password field is already
 * on screen (the single-screen form that shipped before) the Continue step is
 * simply skipped. Element ids are the contract: `#login-email`,
 * `#login-password`, and the EULA checkbox's `aria-describedby="eula-text"`.
 *
 * WebKit, twice bitten: a `fill` that lands before React hydrates is wiped by
 * the first controlled render (the field looks typed, submits empty), and a
 * Continue pressed before hydration is a NATIVE form submit that just reloads
 * the page. So every step is verified and, if it did not hold, repeated.
 *
 * It only FILLS. Pressing the final button is `submitSignIn`, kept separate
 * because some callers start listening for the /auth/login response first.
 */

const EMAIL_FIELD = '#login-email';
const PASSWORD_FIELD = '#login-password';
const EULA_CHECKBOX = 'input[type="checkbox"][aria-describedby="eula-text"]';
const CONTINUE_BUTTON = 'button[type="submit"]:has-text("Continue")';
const SIGN_IN_BUTTON = 'button[type="submit"]:has-text("Sign in")';

const visible = (locator) => locator.isVisible().catch(() => false);
const valueOf = (locator) => locator.inputValue().catch(() => '');

/**
 * @param {import('@playwright/test').Page} page  already on /login
 * @param {string} email
 * @param {string} password
 * @param {{ stepTimeoutMs?: number }} [opts]
 */
async function fillSignInForm(page, email, password, opts = {}) {
  const stepTimeoutMs = opts.stepTimeoutMs ?? 15_000;
  const emailField = page.locator(EMAIL_FIELD);
  const passwordField = page.locator(PASSWORD_FIELD);

  // Either field means the form is up (step 2 of the new page has no email field).
  await page.locator(`${EMAIL_FIELD}, ${PASSWORD_FIELD}`).first().waitFor({ state: 'visible', timeout: 30_000 });
  // Wait for React to OWN the field before typing: a hydrated host node
  // carries a `__reactProps$…` key. Best-effort — if React ever renames it the
  // verify-and-repeat loop below still gets there, just more slowly.
  await page
    .waitForFunction(
      (selector) => {
        const el = document.querySelector(selector);
        return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'));
      },
      `${EMAIL_FIELD}, ${PASSWORD_FIELD}`,
      { timeout: 10_000 },
    )
    .catch(() => {});

  let reached = false;
  for (let attempt = 0; attempt < 5 && !reached; attempt++) {
    if (await visible(emailField)) {
      await emailField.fill(email);
      await page.waitForTimeout(400);
      // Wiped by hydration — type it again.
      if ((await valueOf(emailField)) !== email) continue;
    }
    // The old single-screen form, or step 2 already: nothing to continue past.
    if (await visible(passwordField)) { reached = true; break; }

    await page.locator(CONTINUE_BUTTON).click({ timeout: 5_000 }).catch(() => {});
    // The domain lookup answers in well under a second; the page itself stops
    // waiting at 3 s. A Continue pressed before hydration reloads the page
    // instead — the loop types the email again.
    reached = await passwordField.waitFor({ state: 'visible', timeout: stepTimeoutMs }).then(() => true, () => false);
  }
  if (!reached) throw new Error('sign-in form: the password step never appeared');

  for (let i = 0; i < 3; i++) {
    await passwordField.fill(password);
    await page.waitForTimeout(200);
    if ((await valueOf(passwordField)) === password) break;
  }

  // The EULA click-through. Shown to a browser that has not accepted this EULA
  // version; absent for one that has. If the selector ever drifts, tick every
  // checkbox on the page rather than fail a smoke run on a rename.
  const eula = page.locator(EULA_CHECKBOX);
  if (await visible(eula)) {
    await eula.check({ timeout: 5_000 }).catch(async () => {
      for (const box of await page.$$('input[type="checkbox"]')) await box.check().catch(() => {});
    });
  }
}

/** Press "Sign in" (waits briefly for it to be enabled). */
async function submitSignIn(page) {
  const submit = page.locator(SIGN_IN_BUTTON);
  for (let i = 0; i < 30; i++) {
    if (await submit.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(100);
  }
  await submit.click({ timeout: 5_000 });
}

module.exports = { fillSignInForm, submitSignIn };
