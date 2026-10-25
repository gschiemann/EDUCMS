/**
 * Launch QA decisions U14 / U15 / U16 / S1 / S2 — walked in a REAL browser
 * against a REAL local stack (2026-10-24). Opt-in: skipped unless
 * E2E_LOCAL_API points at a running API, so CI (mocked APIs, no database)
 * never runs it.
 *
 * The stack it expects (nothing here touches production):
 *   scratch Postgres  → `prisma migrate deploy` + `prisma/seed.ts`
 *                       (admin@springfield.edu / teacher@springfield.edu) and
 *                       two ONLINE screens "Lobby Screen" / "Hall Screen" in
 *                       springfield-elementary;
 *   API (built dist)  → E2E_LOCAL_API, e.g. http://localhost:8096/api/v1;
 *   web (next dev)    → E2E_BASE, e.g. http://localhost:3196, built with
 *                       NEXT_PUBLIC_API_URL = E2E_LOCAL_API.
 *
 *   E2E_LOCAL_API=http://localhost:8096/api/v1 E2E_BASE=http://localhost:3196 \
 *   E2E_LOCAL_PASSWORD=<the seed password> E2E_SHOTS=<dir> \
 *     pnpm exec playwright test -c playwright.sandbox.config.ts \
 *     tests/e2e/launch-qa-decisions.local-stack.spec.ts --project=webkit
 *
 * Each test sets up what it needs through the API and leaves the scratch
 * database in a state the next run can live with (unique names per run).
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

const API = process.env.E2E_LOCAL_API || '';
const SEED_PASSWORD = process.env.E2E_LOCAL_PASSWORD || '';
const SHOTS = process.env.E2E_SHOTS || '';
const ADMIN = 'admin@springfield.edu';
const SLUG = 'springfield-elementary';
const RUN = Date.now().toString(36);

test.skip(!API || !SEED_PASSWORD, 'set E2E_LOCAL_API and E2E_LOCAL_PASSWORD to walk the local stack');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

type Session = { token: string; user: Record<string, any> };

async function apiLogin(email: string, password: string): Promise<Session> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json();
  if (!data?.access_token) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return { token: data.access_token, user: data.user };
}

async function api(s: Session, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // Let entry transitions settle first (a dialog fading in) — not the endless
  // pulses, which never finish — so the picture shows what a person reads.
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]),
    )
    .catch(() => undefined);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** The real sign-in form: email → password + (first time on this browser) the EULA box. */
async function signInThroughTheForm(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // A dev server can hydrate AFTER the first keystrokes and wipe them: keep
  // trying until step 2 (the password) is really on screen.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.locator('#login-email').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    const onStep2 = await page.locator('#login-password')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true, () => false);
    if (onStep2) break;
  }
  await page.locator('#login-password').fill(password);
  const eula = page.locator('input[type="checkbox"][aria-describedby="eula-text"]');
  if (await eula.count()) await eula.check();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function freshPage(browser: Browser, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ ...(viewport ? { viewport } : {}), serviceWorkers: 'block' });
  return ctx.newPage();
}

/**
 * A page already signed in as `s` — the session the sign-in form would have
 * stored, without spending one of the API's 10 sign-ins a minute per address
 * on a flow that is not about signing in. The user blob is refreshed from
 * GET /users/me first, so it carries what the account holds now.
 */
async function openAs(browser: Browser, s: Session, path: string, viewport?: { width: number; height: number }) {
  const me = (await api(s, '/users/me')).data || {};
  const user = { ...s.user, termsAcceptedVersion: me.termsAcceptedVersion ?? null, setupPasswordOnly: !!me.setupPasswordOnly };
  const page = await freshPage(browser, viewport);
  await page.addInitScript(({ token, user }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes');
  }, { token: s.token, user });
  await page.goto(path);
  return page;
}

let admin: Session;
let tenantId: string;

test.beforeAll(async () => {
  admin = await apiLogin(ADMIN, SEED_PASSWORD);
  tenantId = admin.user.tenantId;
});

// ─────────────────────────────────────────────────────────────────────────
// S2 (+ the login half): the box ticked on the sign-in form is recorded on
// the ACCOUNT, quietly, once the dashboard opens — no second prompt.
test('S2 — a sign-in tick is recorded on the account without asking again', async ({ browser }) => {
  const page = await freshPage(browser);
  await signInThroughTheForm(page, ADMIN, SEED_PASSWORD);
  await page.waitForURL(`**/${SLUG}/dashboard`, { timeout: 90_000 });
  await expect.poll(async () => (await api(admin, '/users/me')).data?.termsAcceptedVersion, { timeout: 30_000 }).toBe('1.0');
  await expect(page.getByTestId('terms-gate')).toHaveCount(0);
  await page.context().close();
});

// ─────────────────────────────────────────────────────────────────────────
test('U16 — during a DRILL every dashboard surface says DRILL, in indigo', async ({ browser }) => {
  const trig = await api(admin, '/emergency/trigger', {
    method: 'POST',
    body: { scopeType: 'tenant', scopeId: tenantId, overridePayload: { severity: 'CRITICAL', type: 'lockdown', isDrill: true } },
  });
  expect(trig.status, JSON.stringify(trig.data)).toBeLessThan(300);
  const overrideId = trig.data?.overrideId;
  try {
    // Desktop: the overlay, the Sidebar pill and the dashboard card behind it.
    const desk = await freshPage(browser, { width: 1325, height: 758 });
    await signInThroughTheForm(desk, ADMIN, SEED_PASSWORD);
    await desk.waitForURL(`**/${SLUG}/dashboard`, { timeout: 90_000 });
    const overlay = desk.getByTestId('emergency-overlay');
    await expect(overlay).toHaveAttribute('data-drill', 'true', { timeout: 30_000 });
    await expect(desk.getByTestId('sidebar-emergency-pill')).toHaveText(/Drill in progress/);
    await expect(desk.getByTestId('sidebar-emergency-pill')).toHaveAttribute('data-drill', 'true');
    const card = desk.getByTestId('dashboard-drill-card');
    await expect(card).toContainText('Drill in progress');
    await expect(card).not.toContainText(/ACTIVE EMERGENCY|CRITICAL/i);
    await shot(desk, 'u16-desktop-drill');
    await desk.context().close();

    // Phone: the strip under the header and the header pill.
    const phone = await openAs(browser, admin, `/${SLUG}/dashboard`, { width: 390, height: 844 });
    const strip = phone.getByTestId('toolbar-emergency-strip');
    await expect(strip).toHaveAttribute('data-drill', 'true', { timeout: 30_000 });
    await expect(strip).toContainText('Drill in progress');
    await expect(strip).toContainText('View drill');
    await expect(strip).not.toContainText(/critical|incident/i);
    const stripBg = await strip.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Indigo-700 (rgb 67 56 202 in Tailwind 4's oklch → sRGB), never red.
    expect(stripBg).not.toMatch(/rgb\(185, 28, 28\)/);
    await shot(phone, 'u16-phone-drill');
    await phone.context().close();
  } finally {
    await api(admin, `/emergency/${encodeURIComponent(overrideId || 'tenant')}/all-clear`, {
      method: 'POST',
      body: { scopeType: 'tenant', scopeId: tenantId, isDrill: true },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// U14 + U15 — the new-playlist wizard onto a screen that runs an ALWAYS-ON
// playlist.
async function screenIds() {
  const list = (await api(admin, '/screens')).data as any[];
  const byName = (n: string) => list.find((s) => s.name === n)?.id as string;
  return { lobby: byName('Lobby Screen'), hall: byName('Hall Screen') };
}

async function alwaysOnPlaylistOn(screenId: string, name: string) {
  const pl = (await api(admin, '/playlists', { method: 'POST', body: { name } })).data;
  const sched = await api(admin, '/schedules', {
    method: 'POST',
    body: { playlistId: pl.id, screenId, startTime: new Date(Date.now() - 60_000).toISOString(), mode: 'replace', priority: 0, isActive: true },
  });
  expect(sched.status, JSON.stringify(sched.data)).toBeLessThan(300);
  return { playlistId: pl.id as string, scheduleId: sched.data.id as string };
}

async function openWizardToReview(page: Page, name: string, screenName: string, windowed: boolean) {
  await page.goto(`/${SLUG}/playlists?newPlaylist=1`);
  const wizard = page.getByRole('dialog', { name: 'Create new playlist' });
  await expect(wizard).toBeVisible({ timeout: 60_000 });
  await wizard.getByPlaceholder(/e\.g\.|name/i).first().fill(name);
  await wizard.getByText('From Template', { exact: false }).first().click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  // Step 2 — the first template in the gallery.
  await wizard.locator('div.grid button[aria-pressed]').first().click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  // Step 3 — the screen.
  await wizard.getByText(screenName, { exact: true }).first().click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  // Step 4 — always on, or the default window (Mon–Fri 08:00–15:00).
  if (windowed) await wizard.getByText('Schedule a window').click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  return wizard;
}

test('U14 — Cancel on "Replace on 1 screen?" creates NOTHING and stays on Review', async ({ browser }) => {
  const { lobby } = await screenIds();
  await alwaysOnPlaylistOn(lobby, `QA always-on ${RUN} a`);
  const page = await openAs(browser, admin, `/${SLUG}/dashboard`, { width: 1325, height: 900 });

  const name = `QA U14 cancel ${RUN}`;
  const wizard = await openWizardToReview(page, name, 'Lobby Screen', false);
  await wizard.getByRole('button', { name: /Create Playlist|Create & Publish/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace on 1 screen?' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await shot(page, 'u14-replace-prompt');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click();

  // Still on Review, Create enabled again, and the API has no such playlist.
  await expect(wizard.getByRole('button', { name: /Create Playlist|Create & Publish/ })).toBeEnabled();
  const all = (await api(admin, '/playlists')).data as any[];
  expect(all.filter((p) => p.name === name)).toHaveLength(0);
  await shot(page, 'u14-after-cancel');
  await page.context().close();
});

test('U15 — a Mon–Fri 8–3 playlist onto an always-on one: "Keep both" keeps it as the fallback', async ({ browser }) => {
  const { lobby } = await screenIds();
  const base = await alwaysOnPlaylistOn(lobby, `QA lobby loop ${RUN}`);
  const page = await openAs(browser, admin, `/${SLUG}/dashboard`, { width: 1325, height: 900 });

  const name = `QA school hours ${RUN}`;
  const wizard = await openWizardToReview(page, name, 'Lobby Screen', true);
  await wizard.getByRole('button', { name: /Create Playlist|Create & Publish/ }).click();
  const dialog = page.getByRole('dialog', { name: /playing the rest of the time\?/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText('plays only at its scheduled times');
  await expect(dialog).toContainText('so that screen is never blank');
  await expect(dialog.getByRole('button', { name: 'Keep both' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Replace everything' })).toBeVisible();
  await shot(page, 'u15-keep-both-prompt');
  await dialog.getByRole('button', { name: 'Keep both' }).click();

  await expect.poll(async () => {
    const rows = (await api(admin, '/schedules')).data as any[];
    const old = rows.find((r) => r.id === base.scheduleId);
    const fresh = rows.find((r) => r.playlist?.name === name);
    return { oldActive: old?.isActive, oldPriority: old?.priority, freshActive: fresh?.isActive, freshWindow: fresh && `${fresh.daysOfWeek} ${fresh.timeStart}-${fresh.timeEnd}` };
  }, { timeout: 30_000 }).toEqual({ oldActive: true, oldPriority: -1, freshActive: true, freshWindow: 'Mon,Tue,Wed,Thu,Fri 08:00-15:00' });
  await page.context().close();
});

test('U15 — "Replace everything" switches the always-on one off', async ({ browser }) => {
  const { hall } = await screenIds();
  const base = await alwaysOnPlaylistOn(hall, `QA hall loop ${RUN}`);
  const page = await openAs(browser, admin, `/${SLUG}/dashboard`, { width: 1325, height: 900 });

  const name = `QA hall hours ${RUN}`;
  const wizard = await openWizardToReview(page, name, 'Hall Screen', true);
  await wizard.getByRole('button', { name: /Create Playlist|Create & Publish/ }).click();
  const dialog = page.getByRole('dialog', { name: /playing the rest of the time\?/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Replace everything' }).click();

  await expect.poll(async () => {
    const rows = (await api(admin, '/schedules')).data as any[];
    return rows.find((r) => r.id === base.scheduleId)?.isActive;
  }, { timeout: 30_000 }).toBe(false);
  await page.context().close();
});

// ─────────────────────────────────────────────────────────────────────────
test('S1 — "Set password now" is temporary: the person chooses their own at first sign-in', async ({ browser }) => {
  const email = `qa-s1-${RUN}@springfield.edu`;
  const temp = `Temp-${RUN}-pass`;
  const own = `Own-${RUN}-password`;

  // The admin adds them in People with a password.
  const adminPage = await openAs(browser, admin, `/${SLUG}/settings/people`, { width: 1325, height: 900 });
  await adminPage.getByRole('button', { name: 'Invite user' }).click({ timeout: 60_000 });
  await adminPage.getByRole('button', { name: 'Set password now' }).click();
  await adminPage.locator('#people-email').fill(email);
  await adminPage.locator('#people-password').fill(temp);
  await expect(adminPage.getByText('It only works for their first sign-in — then they choose their own.')).toBeVisible();
  await shot(adminPage, 's1-people-set-password');
  await adminPage.getByRole('button', { name: 'Create user' }).click();
  await expect(adminPage.getByText(`Added ${email}. They sign in once with the temporary password, then choose their own.`)).toBeVisible({ timeout: 30_000 });
  await adminPage.context().close();

  // They sign in with the temporary password → the password-only setup screen.
  const page = await freshPage(browser, { width: 1325, height: 900 });
  await signInThroughTheForm(page, email, temp);
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('setup-signin-email')).toContainText(email);
  await expect(page.getByLabel(/^Your work email/i)).toHaveCount(0);
  await shot(page, 's1-choose-own-password');
  await page.getByLabel(/^New password/i).fill(own);
  await page.getByLabel(/Confirm (new )?password/i).fill(own);
  await page.getByRole('button', { name: /save and continue/i }).click();
  await page.waitForURL(`**/${SLUG}/dashboard`, { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toHaveCount(0);

  // The admin's temporary password is dead; theirs works.
  const tempLogin = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: temp }),
  });
  expect(tempLogin.status).toBe(401);
  const mine = await apiLogin(email, own);
  expect(mine.user).toMatchObject({ mustSetupCredentials: false, setupPasswordOnly: false, termsAcceptedVersion: '1.0' });
  await page.context().close();
});

// ─────────────────────────────────────────────────────────────────────────
test('S2 — nothing on file (a browser that already accepted): asked once in the dashboard', async ({ browser }) => {
  // A brand-new account with no acceptance on file (made through the S1 API:
  // admin-set temporary password → its own password), so the case is the same
  // on every run.
  const email = `qa-s2-prompt-${RUN}@springfield.edu`;
  const created = await api(admin, '/users', { method: 'POST', body: { email, role: 'CONTRIBUTOR', password: `Temp-${RUN}-s2` } });
  expect(created.status, JSON.stringify(created.data)).toBeLessThan(300);
  const setupSession = await apiLogin(email, `Temp-${RUN}-s2`);
  const done = await api(setupSession, '/auth/complete-setup', { method: 'POST', body: { password: `Own-${RUN}-s2-pw` } });
  expect(done.status, JSON.stringify(done.data)).toBeLessThan(300);
  const teacher: Session = { token: done.data.access_token, user: done.data.user };
  expect(teacher.user.termsAcceptedVersion ?? null).toBeNull();
  const page = await freshPage(browser, { width: 1325, height: 900 });
  // A session restored without a sign-in tick: the per-browser record exists
  // (no checkbox would be shown), the account has none.
  await page.addInitScript(({ token, user }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', 'yes');
  }, { token: teacher.token, user: teacher.user });
  await page.goto(`/${SLUG}/dashboard`);
  const gate = page.getByTestId('terms-gate');
  await expect(gate).toBeVisible({ timeout: 90_000 });
  await expect(gate.getByRole('heading', { name: 'Before you continue' })).toBeVisible();
  await expect(gate.getByRole('link', { name: 'End User License Agreement' })).toHaveAttribute('href', '/terms/eula');
  await shot(page, 's2-terms-gate');
  await gate.getByTestId('terms-gate-accept').click();
  await expect(gate.getByRole('alert')).toContainText('You must accept the End User License Agreement');
  await gate.getByTestId('terms-gate-checkbox').check();
  await gate.getByTestId('terms-gate-accept').click();
  await expect(gate).toHaveCount(0, { timeout: 30_000 });
  expect((await api(teacher, '/users/me')).data?.termsAcceptedVersion).toBe('1.0');
  await page.context().close();
});

test('S2 — an invited teammate accepts the EULA on the invitation itself', async ({ browser }) => {
  const email = `qa-s2-${RUN}@springfield.edu`;
  const inv = await api(admin, '/invites', { method: 'POST', body: { email, role: 'CONTRIBUTOR' } });
  expect(inv.status, JSON.stringify(inv.data)).toBeLessThan(300);
  const acceptUrl: string = inv.data.acceptUrl;
  const page = await freshPage(browser, { width: 1325, height: 900 });
  await page.goto(acceptUrl.replace(/^https?:\/\/[^/]+/, ''));
  const password = `Invitee-${RUN}-pw`;
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'End User License Agreement' })).toContainText('You must accept the End User License Agreement');
  await page.getByTestId('invite-eula-checkbox').check();
  await shot(page, 's2-accept-invite');
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await page.waitForURL(`**/${SLUG}/dashboard`, { timeout: 90_000 });
  await expect(page.getByTestId('terms-gate')).toHaveCount(0);
  const me = await apiLogin(email, password);
  expect(me.user.termsAcceptedVersion).toBe('1.0');
  await page.context().close();
});
