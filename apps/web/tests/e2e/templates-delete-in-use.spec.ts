/**
 * One delete confirmation: GET fresh usage before enabling Delete, then one
 * informed DELETE. Real dashboard with mocked APIs, Chromium and WebKit.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

const TEMPLATE = {
  id: 'tpl-club',
  name: 'Club Welcome',
  tenantId: SCHOOL_ID,
  isSystem: false,
  category: 'CUSTOM',
  screenWidth: 1920,
  screenHeight: 1080,
  bgColor: '#ffffff',
  zones: [],
  scenes: [],
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  _count: { playlists: 2 },
};
const USED_BY = [
  { id: 'pl-morning', name: 'Morning Loop' },
  { id: 'pl-desk', name: 'Front Desk' },
];

type Scenario = {
  unused?: boolean;
  protected?: boolean;
  usageFailsOnce?: boolean;
  usageGate?: Promise<void>;
  concurrentUse?: boolean;
  deleteFails?: boolean;
};
async function open(page: Page, calls: string[], scenario: Scenario = {}) {
  const cors = (route: Route, fn: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS, body: '' }) : fn();
  const json = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) }));
  let deleted = false;

  await page.route(/http:\/\/api\.invalid\/.*/, (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/**', (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/auth/me', (r) => json(r, USER));
  await page.route('**/api/v1/tenants', (r) => json(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/api/v1/tenants/accessible', (r) => json(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route('**/api/v1/branding/me', (r) => json(r, {}));
  await page.route('**/api/v1/screens', (r) => json(r, []));
  await page.route('**/api/v1/playlists', (r) => json(r, []));
  await page.route('**/api/v1/schedules', (r) => json(r, []));
  await page.route('**/api/v1/assets**', (r) => json(r, []));
  await page.route(/\/api\/v1\/templates(\?.*)?$/, (r) => json(r, deleted ? [] : [TEMPLATE]));
  await page.route('**/api/v1/templates/usage-summary', (r) => json(r, {}));
  let usageReads = 0;
  await page.route('**/api/v1/templates/tpl-club/usage', async (r) => {
    if (r.request().method() === 'OPTIONS') return json(r, {});
    usageReads += 1;
    await scenario.usageGate;
    if (scenario.usageFailsOnce && usageReads === 1) return json(r, { message: 'Usage unavailable' }, 500);
    return json(r, {
      playlists: scenario.unused ? [] : USED_BY,
      total: scenario.unused ? 0 : 2,
      screensReached: scenario.unused ? 0 : 3,
      locations: scenario.unused ? 0 : 1,
      protectedEmergency: scenario.protected ?? false,
    });
  });
  await page.route(/\/api\/v1\/templates\/tpl-club(\?.*)?$/, (r) => {
    if (r.request().method() !== 'DELETE') return json(r, TEMPLATE);
    const force = new URL(r.request().url()).searchParams.get('force');
    calls.push(force ? `DELETE force=${force}` : 'DELETE');
    if (scenario.deleteFails) return json(r, { message: 'Could not delete this template.' }, 500);
    if ((!scenario.unused || scenario.concurrentUse) && force !== 'true') {
      return json(r, {
        code: 'TEMPLATE_IN_USE',
        message: 'This layout is assigned to 2 playlists (“Morning Loop”, “Front Desk”). Deleting removes it from them — they fall back to the next layout.',
        playlists: USED_BY,
        total: 2,
        usage: { playlists: USED_BY, screensReached: 3, locations: 1 },
      }, 409);
    }
    deleted = true;
    return json(r, { deleted: true });
  });

  await page.addInitScript((user) => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
    try {
      const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
      sessionStorage.setItem('edu_cms_token', token);
      sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    } catch { /* ignore */ }
  }, USER);
  await page.setViewportSize({ width: 1325, height: 758 });
  await page.goto(`/${SCHOOL_ID}/templates`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /more actions for club welcome/i }).first().waitFor({ state: 'visible', timeout: 90_000 });
}

async function chooseDelete(page: Page) {
  await page.getByRole('button', { name: /more actions for club welcome/i }).first().click();
  await page.getByRole('menuitem', { name: 'Delete template' }).click();
  await page.getByRole('alertdialog').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('deleting a template that playlists use', () => {
  test('warns, names the playlists, and Review goes to THE PLAYLIST — not the template', async ({ page }, info) => {
    test.setTimeout(120_000);
    const calls: string[] = [];
    await open(page, calls);
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('“Club Welcome” is currently in use');
    await expect(dialog).toContainText('Morning Loop');
    await expect(dialog).toContainText('Front Desk');
    await expect(dialog.getByRole('button', { name: 'Review' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete anyway' })).toBeVisible();

    await page.screenshot({ path: info.outputPath('template-one-confirmation.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Review' }).click();
    await expect(page).toHaveURL(new RegExp(`/${SCHOOL_ID}/playlists/pl-morning`));
    expect(calls).toEqual([]); // checking and Review change nothing
  });

  test('a listed playlist opens itself', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, []);
    await chooseDelete(page);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Front Desk' }).click();
    await expect(page).toHaveURL(new RegExp(`/${SCHOOL_ID}/playlists/pl-desk`));
  });

  test('Delete anyway deletes it (force) and the card is gone', async ({ page }) => {
    test.setTimeout(120_000);
    const calls: string[] = [];
    await open(page, calls);
    await chooseDelete(page);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete anyway' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect.poll(() => calls, { timeout: 10_000 }).toEqual(['DELETE force=true']);
    await expect(page.getByRole('button', { name: /more actions for club welcome/i })).toHaveCount(0);
  });

  test('Cancel deletes nothing', async ({ page }) => {
    test.setTimeout(120_000);
    const calls: string[] = [];
    await open(page, calls);
    await chooseDelete(page);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(calls).toEqual([]);
    await expect(page.getByRole('button', { name: /more actions for club welcome/i }).first()).toBeVisible();
  });
});


test.describe('first confirmation usage and failure handling', () => {
  test.setTimeout(120_000);

  test('unused template deletes with one confirmation and no force', async ({ page }) => {
    const calls: string[] = [];
    await open(page, calls, { unused: true });
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Delete template' })).toBeEnabled();
    expect(calls).toEqual([]);
    await dialog.getByRole('button', { name: 'Delete template' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls).toEqual(['DELETE']);
  });

  test('usage check keeps Delete disabled; cancelling ignores the late answer', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    await open(page, calls, { usageGate: gate });
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Checking where this template is used');
    await expect(dialog.getByRole('button', { name: 'Delete template' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const response = page.waitForResponse('**/templates/tpl-club/usage');
    release();
    await response;
    await expect(dialog).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test('usage read failure retries inside the same dialog', async ({ page }) => {
    const calls: string[] = [];
    await open(page, calls, { usageFailsOnce: true });
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('alert')).toContainText('Usage unavailable');
    await expect(dialog.getByRole('button', { name: 'Delete template' })).toBeDisabled();
    await dialog.evaluate(el => el.setAttribute('data-original-dialog', 'yes'));
    await dialog.getByRole('button', { name: 'Check again' }).click();
    await expect(dialog.getByRole('button', { name: 'Delete anyway' })).toBeEnabled();
    await expect(dialog).toHaveAttribute('data-original-dialog', 'yes');
    expect(calls).toEqual([]);
  });

  test('protected use is disclosed before the first Delete click', async ({ page }) => {
    const calls: string[] = [];
    await open(page, calls, { protected: true });
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('used by emergency content');
    await expect(dialog.getByRole('button', { name: 'Delete anyway' })).toBeDisabled();
    expect(calls).toEqual([]);
  });

  test('usage added after the read updates the existing warning without silently forcing', async ({ page }) => {
    const calls: string[] = [];
    await open(page, calls, { unused: true, concurrentUse: true });
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Delete template' })).toBeEnabled();
    await dialog.evaluate(el => el.setAttribute('data-original-dialog', 'yes'));
    await dialog.getByRole('button', { name: 'Delete template' }).click();
    await expect(dialog).toContainText('Usage changed while this confirmation was open');
    await expect(dialog).toHaveAttribute('data-original-dialog', 'yes');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls).toEqual(['DELETE']);
    await dialog.getByRole('button', { name: 'Delete anyway' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls).toEqual(['DELETE', 'DELETE force=true']);
  });

  test('delete failures stay inside the same confirmation', async ({ page }) => {
    const calls: string[] = [];
    await open(page, calls, { deleteFails: true });
    await chooseDelete(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Delete anyway' })).toBeEnabled();
    await dialog.evaluate(el => el.setAttribute('data-original-dialog', 'yes'));
    await dialog.getByRole('button', { name: 'Delete anyway' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Could not delete');
    await expect(dialog).toHaveAttribute('data-original-dialog', 'yes');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls).toEqual(['DELETE force=true']);
  });
});
