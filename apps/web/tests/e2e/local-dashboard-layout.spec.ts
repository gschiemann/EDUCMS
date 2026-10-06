import { test, expect, type Page } from '@playwright/test';

// The only difference between these accounts is their parent relationship.
// All data is synthetic and every API request is intercepted.
async function openLocalDashboard(page: Page, child: boolean, width = 1840) {
  const tenant = { id: 'local-layout-test', slug: 'local-layout-test', name: 'Test Office',
    vertical: 'CORPORATE', parentId: child ? 'test-corporate-parent' : null };
  const user = { id: 'layout-test-user', email: 'operator@example.test', role: 'SCHOOL_ADMIN', tenantId: tenant.id };
  const groups = [{ id: 'lobby', name: 'Lobby' }, { id: 'meeting', name: 'Meeting rooms' }];
  const screens = groups.map((group, index) => ({
    id: `display-${index}`, name: `${group.name} display`, tenantId: tenant.id,
    status: index === 0 ? 'ONLINE' : 'OFFLINE', screenGroupId: group.id, screenGroup: group,
    lastPingAt: new Date().toISOString(), resolution: '1920x1080',
  }));
  const corporateReads: string[] = [];
  await page.addInitScript((user) => {
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: 4102444800 })}.test`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    localStorage.removeItem('edu_dashboard_hint_dismissed');
  }, user);
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (['/emergency/readiness/district', '/submissions/pending-counts', '/deployments', '/screens/fleet-pulse'].includes(path)) corporateReads.push(path);
    const bodies: Record<string, unknown> = {
      '/auth/me': user, '/users/me': user, '/tenants': tenant, '/tenants/me': tenant,
      '/tenants/accessible': { current: tenant.id, tenants: [tenant] },
      '/branding/me': { displayName: tenant.name, primaryColor: '#003b5c' },
      '/screens/fleet': { root: tenant, locations: [tenant], screens, stats: { total: 2, online: 1, offline: 1, locationCount: 1 } },
      '/screens': screens, '/screen-groups': groups, '/schedules': [], '/templates': [],
      '/assets': [0, 1, 2].map(id => ({ id: `asset-${id}`, status: 'PUBLISHED', mimeType: 'image/png', originalName: `Image ${id}.png` })),
      '/assets/folders': [], '/playlists': [],
    };
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(bodies[path] ?? []) });
  });
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1100 });
  await page.goto(`/${tenant.id}/dashboard`);
  return corporateReads;
}

for (const child of [false, true]) {
 for (const width of [1840, 390, 320]) {
  test(`${child ? 'child location' : 'standalone account'} uses the full local dashboard at ${width}px`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const corporateReads = await openLocalDashboard(page, child, width);
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible();
    await expect(page.locator('.dash-kpi-card')).toHaveCount(5);
    if (width < 768) {
      const setup = page.getByTestId('dashboard-setup');
      const expand = setup.getByRole('button', { name: 'Getting started', exact: true });
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      expect((await setup.boundingBox())!.height).toBeLessThan(100);
      for (const card of await page.locator('.dash-kpi-card').all()) {
        expect((await card.boundingBox())!.height).toBeLessThan(115);
      }
      expect((await page.getByTestId('dashboard-health').boundingBox())!.height).toBeLessThan(320);
      await expand.click();
      await expect(setup.getByRole('link')).toHaveCount(3);
      expect((await setup.boundingBox())!.height).toBeLessThan(330);
      await expand.click();
      const main = page.locator('#main-content');
      expect(await main.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    }
    await expect(page.getByRole('link', { name: /Fleet health/i })).toContainText('50.0%');
    await expect(page.getByRole('link', { name: /^Library\b/i })).toContainText('3');
    await expect(page.getByRole('link', { name: /^Sites\b/i })).toContainText('2');
    await expect(page.locator('a[href$="screens?group=lobby"]')).toContainText('Lobby');
    await expect(page.locator('a[href$="screens?group=meeting"]')).toContainText('Meeting rooms');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Today.s Schedule/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Activity', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick Actions', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(corporateReads).toEqual([]);
    expect(errors).toEqual([]);
    await page.locator('a[href$="screens?group=lobby"]').locator('xpath=ancestor::section').screenshot({ path: info.outputPath(`sites-${width}.png`), animations: 'disabled' });
    await page.screenshot({ path: info.outputPath(`${child ? 'child' : 'standalone'}-${width}-dashboard.png`), fullPage: true });
  });
}

}
