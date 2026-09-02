/**
 * /[schoolId]/settings/emergency in a REAL browser, chromium + webkit.
 *
 * Why this exists: the Settings Command Center page is assembled from the
 * shell (header + index + context rail) plus an editor of divider sections,
 * and the unit test renders the editor WITHOUT the shell. Only a browser can
 * answer "does the rail actually appear at 1440, does the editor survive at
 * 390, and does WebKit render the same thing Chromium does" — the exact
 * class of bug CLAUDE.md's cross-browser rule exists for.
 *
 * Every API call is intercepted (the suite's contract — see
 * apps/web/playwright.config.ts); nothing here touches a database.
 */
import { test, expect, type Page } from '@playwright/test';

const SCHOOL = 'springfield';
const PAGE_URL = `/${SCHOOL}/settings/emergency`;

const READINESS = {
  verdict: 'NEEDS_ATTENTION',
  score: 70,
  computedAt: new Date().toISOString(),
  items: [
    { key: 'content', status: 'warn', label: 'Alert content wired', detail: '4 of 6 alert types have content.', fixHint: 'Assign content below for: Hold, Medical.' },
    { key: 'delivery', status: 'ok', label: 'Delivery chain', detail: 'Database, realtime fan-out and message signer all responded.', fixHint: '' },
    { key: 'screens', status: 'warn', label: 'Screens ready to display', detail: '3 of 4 screens online; 3 confirmed fetching content.', fixHint: 'Check the offline screens on the Screens page.' },
    { key: 'staff', status: 'ok', label: 'People who can trigger', detail: '2 people can trigger an alert.', fixHint: '' },
    { key: 'exercise', status: 'warn', label: 'Last exercised', detail: 'Last triggered 120 days ago.', fixHint: 'Run a test alert during a maintenance window.' },
  ],
};

async function mockApi(page: Page, opts: { vertical: string; emergencyEnabled: boolean | null; locked: boolean }) {
  await page.addInitScript(
    ([token, user]) => {
      try {
        window.sessionStorage.setItem('edu_cms_token', token as string);
        window.sessionStorage.setItem('edu_cms_user', user as string);
      } catch {
        /* storage blocked — the test will fail loudly on the redirect */
      }
    },
    [
      'e2e-token',
      JSON.stringify({ id: 'u1', email: 'admin@example.test', role: 'DISTRICT_ADMIN', tenantId: 't1', canTriggerPanic: true }),
    ],
  );

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/tenants') {
      return json({
        id: 't1',
        name: 'Springfield',
        slug: SCHOOL,
        parentId: null,
        vertical: opts.vertical,
        emergencyStatus: 'INACTIVE',
        emergencyEnabled: opts.emergencyEnabled,
        emergencyEnabledEffective: opts.locked ? true : opts.emergencyEnabled === true,
        emergencyEnabledLocked: opts.locked,
      });
    }
    if (path === '/emergency/readiness') return json(READINESS);
    if (path === '/tenants/me/location-based-emergency') return json({ enabled: false });
    if (path.startsWith('/panic-content/')) return json({ items: [] });
    if (path === '/floor-plans') return json([]);
    if (path === '/audit') return json({ items: [], total: 0, limit: 1, offset: 0 });
    if (path === '/tenants/me/emergency-enabled') {
      return json({ ok: true, emergencyEnabled: false, emergencyEnabledEffective: false, emergencyEnabledLocked: false });
    }
    // Everything else the dashboard chrome asks for. An empty list/object is
    // the shape every one of those hooks tolerates.
    return json(path.endsWith('s') ? [] : {});
  });
}

test.describe('Settings → Emergency', () => {
  test('desktop: shell header, §7.5 section order, context rail, no drill control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockApi(page, { vertical: 'GYM', emergencyEnabled: true, locked: false });
    await page.goto(PAGE_URL);

    // The shell owns the page title; the editor body must not render its own
    // H1 on top of it (the old page did — that was its own <h1>Emergency
    // content</h1> under the shell's header).
    await expect(page.getByRole('heading', { level: 1, name: 'Emergency', exact: true })).toBeVisible();
    await expect(page.locator('section[id^="emergency-"] h1')).toHaveCount(0);

    // §7.5 content order, by anchor id.
    const ids = await page.locator('section[id^="emergency-"]').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual([
      'emergency-readiness',
      'emergency-enabled',
      'emergency-delivery',
      'emergency-content',
      'emergency-coverage',
      'emergency-history',
    ]);

    // The capability state is the server's, and it is actionable.
    await expect(page.locator('#emergency-enabled').getByText('Emergency alerts are on')).toBeVisible();
    await expect(page.getByRole('button', { name: /turn off emergency alerts/i })).toBeVisible();

    // Context rail (≥1280px) carries per-type readiness and effective scope.
    await expect(page.getByText('Alert content', { exact: true })).toBeVisible();
    await expect(page.getByText('Effective scope', { exact: true })).toBeVisible();

    // Item 6 of §7.5: no drill/test control exists server-side, so none renders.
    await expect(page.getByRole('button', { name: /drill|send a test|run a test/i })).toHaveCount(0);
    await expect(page.getByText(/coming soon/i)).toHaveCount(0);
  });

  test('K-12: the capability is stated as on, with no control to turn it off', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockApi(page, { vertical: 'K12', emergencyEnabled: null, locked: true });
    await page.goto(PAGE_URL);

    await expect(page.locator('#emergency-enabled').getByText('Emergency alerts are on')).toBeVisible();
    await expect(page.getByText(/stay on and cannot be turned off here/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /turn off emergency alerts/i })).toHaveCount(0);
  });

  test('capability off: the editor explains it and offers exactly one way forward', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockApi(page, { vertical: 'GYM', emergencyEnabled: false, locked: false });
    await page.goto(PAGE_URL);

    await expect(page.locator('#emergency-enabled').getByText('Emergency alerts are off')).toBeVisible();
    await expect(page.getByRole('button', { name: /turn on emergency alerts/i })).toBeVisible();
    // Nothing downstream is shown as configurable while the capability is off.
    await expect(page.locator('#emergency-delivery')).toHaveCount(0);
    await expect(page.locator('#emergency-content')).toHaveCount(0);
  });

  test('mobile 390: the editor is usable and never scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, { vertical: 'GYM', emergencyEnabled: true, locked: false });
    await page.goto(PAGE_URL);

    await expect(page.locator('#emergency-enabled').getByText('Emergency alerts are on')).toBeVisible();
    await expect(page.locator('#emergency-content')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
