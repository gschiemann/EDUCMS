/**
 * Pill cleanup, admin wave (2026-11-02): Audit categories, Notifications tabs,
 * Reviews status and Super bugs status filter use the shared TabRow /
 * Segmented / FilterMenu; read-only statuses are StatusPills. Fully mocked API.
 *
 *   PILL_WAVE_SHOTS=1 E2E_PORT=3123 pnpm --filter web exec playwright test \
 *     tests/e2e/pill-wave-admin.spec.ts --project=webkit
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const TENANT = 'e2e-school';
const PORT = process.env.E2E_PORT || '3000';
const CORS = { 'Access-Control-Allow-Origin': `http://localhost:${PORT}`, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
const SHOTS = process.env.PILL_WAVE_SHOTS === '1';
const OUT = path.resolve(__dirname, '../../../../docs/research/2026-11-02-pill-audit/screens');

const NOTES = [
  { id: 'off1', kind: 'SCREEN_OFFLINE', title: 'Screen offline: Lobby', body: 'No heartbeat since 10:02.', link: '/screens', isRead: false, createdAt: '2026-10-30T10:00:00Z' },
  { id: 'rev1', kind: 'INFO', title: 'New submission awaiting your review', body: '3 item(s) submitted.', link: '/reviews?id=s1', isRead: false, createdAt: '2026-10-29T10:00:00Z' },
  { id: 'sys1', kind: 'INFRA_EVENT', title: 'Licence renewed', body: null, link: null, isRead: true, createdAt: '2026-10-28T09:00:00Z' },
];
const SUBS = [
  { id: 's1', status: 'PENDING', createdAt: '2026-10-30T10:00:00Z', note: 'Fall concert flyer', assetIds: ['a'], playlistIds: [], scheduleIds: [], submittedBy: { email: 'teacher@example.test' } },
  { id: 's2', status: 'PENDING', createdAt: '2026-10-29T10:00:00Z', note: null, assetIds: ['a', 'b'], playlistIds: ['p'], scheduleIds: [], submittedBy: { email: 'coach@example.test' } },
];
const BUGS = ['NEW', 'ANALYZING', 'PROPOSED', 'SHIPPED'].map((status, i) => ({
  id: `b${i}`, createdAt: '2026-10-30T10:00:00Z', status, description: `Sample report ${i + 1}`, screenshotUrl: null,
  reporter: { userId: 'u', email: 'user@example.test', tenantSlug: 'demo' }, pathname: '/assets', aiConfidence: null,
}));

async function open(page: Page, role: string, url: string, mobile: boolean) {
  const user = { id: 'user', tenantId: TENANT, role, email: 'test@example.test' };
  await page.addInitScript(u => {
    sessionStorage.setItem('edu_cms_token', 'e2e-token'); sessionStorage.setItem('edu_cms_user', JSON.stringify(u)); localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, user);
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), p = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (p === '/auth/me') return json(route, user);
    if (p === '/tenants' || p === '/tenants/accessible') return json(route, [{ id: TENANT, slug: TENANT, name: 'Demo School' }]);
    if (p.startsWith('/notifications')) return json(route, NOTES);
    if (p.startsWith('/submissions')) return json(route, SUBS);
    if (p.startsWith('/bugs')) return json(route, BUGS);
    if (p.startsWith('/audit')) return json(route, { items: [], total: 0 });
    return json(route, p.endsWith('s') ? [] : {});
  });
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1325, height: 758 });
  await page.goto(url);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, name) });
}

for (const mobile of [false, true]) {
  const tag = mobile ? 'iphone' : 'desktop';
  test.describe(`admin pill wave (${tag})`, () => {
    test('audit categories are one TabRow', async ({ page }) => {
      await open(page, 'SCHOOL_ADMIN', `/${TENANT}/audit`, mobile);
      const tabs = page.getByTestId('audit-category-tabs');
      await expect(tabs).toBeVisible();
      await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
      await tabs.getByRole('tab').nth(2).click();
      await expect(tabs.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true');
      await shot(page, `wave-admin-audit-${tag}.png`);
    });
    test('notifications tabs are one TabRow', async ({ page }) => {
      await open(page, 'SCHOOL_ADMIN', `/${TENANT}/notifications`, mobile);
      const tabs = page.getByTestId('notifications-tabs');
      await expect(tabs.getByRole('tab').first()).toBeVisible();
      await shot(page, `wave-admin-notifications-${tag}.png`);
    });
    test('reviews status is a Segmented', async ({ page }) => {
      await open(page, 'SCHOOL_ADMIN', `/${TENANT}/reviews`, mobile);
      const group = page.getByRole('radiogroup').first();
      await expect(group.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
      await group.getByRole('radio').nth(1).click();
      await expect(group.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true');
      await group.getByRole('radio').nth(0).click();
      await shot(page, `wave-admin-reviews-${tag}.png`);
    });
    test('super bugs status is one FilterMenu', async ({ page }) => {
      await open(page, 'SUPER_ADMIN', '/super/bugs', mobile);
      const btn = page.getByTestId('bugs-status-filter');
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(page.getByTestId('bugs-status-filter-panel')).toBeVisible();
      await shot(page, `wave-admin-bugs-filter-open-${tag}.png`);
      await page.getByRole('radio', { name: 'Shipped' }).click();
      await page.keyboard.press('Escape');
      await shot(page, `wave-admin-bugs-${tag}.png`);
    });
  });
}
