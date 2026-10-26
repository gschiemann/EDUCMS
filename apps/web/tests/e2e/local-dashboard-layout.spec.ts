import { test, expect, type Page } from '@playwright/test';

// The only difference between these accounts is their parent relationship.
// All data is synthetic and every API request is intercepted. `failing` paths
// answer 500, to prove the page still draws every section without them.
async function openLocalDashboard(page: Page, child: boolean, width = 1840, failing: readonly string[] = []) {
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
    if (failing.includes(path)) {
      return route.fulfill({ status: 500, contentType: 'application/json', headers, body: JSON.stringify({ message: 'synthetic outage' }) });
    }
    const bodies: Record<string, unknown> = {
      // What a person did, already worded by the API's customer allowlist.
      '/audit/recent': [{ id: 'activity-1', action: 'PLAYLIST_CREATED', category: 'content', createdAt: new Date().toISOString(),
        targetType: 'Playlist', targetId: 'playlist-1', actor: { kind: 'person', userId: 'teammate', name: 'Sam' },
        subject: 'Lobby loop', target: null, targetKey: null, facts: {} }],
      // The offline screen is a real outage: not on a schedule, not dormant.
      '/screens/attention': { generatedAt: new Date().toISOString(), resting: [], dormant: [],
        down: [{ id: screens[1].id, name: screens[1].name, tenantId: tenant.id, location: null,
          groupName: groups[1].name, lastSeenAt: screens[1].lastPingAt, reason: null }] },
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
    // The feed reads what a person did; the red card lists the real outage.
    await expect(page.getByTestId('recent-activity')).toContainText('Sam created the playlist “Lobby loop”');
    await expect(page.getByTestId('screens-down')).toContainText('Meeting rooms display');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(corporateReads).toEqual([]);
    expect(errors).toEqual([]);
    await page.locator('a[href$="screens?group=lobby"]').locator('xpath=ancestor::section').screenshot({ path: info.outputPath(`sites-${width}.png`), animations: 'disabled' });
    await page.screenshot({ path: info.outputPath(`${child ? 'child' : 'standalone'}-${width}-dashboard.png`), fullPage: true });
  });
}

}

// When the activity feed and the screen verdicts both fail, the page loses
// their content, never their cards: Recent Activity says it could not load,
// and the offline screen stays in the red "Screens down" card (a failed
// verdict falls back to "down", so it can never hide an outage).
for (const width of [1840, 390]) {
  test(`the local dashboard draws every section when activity and screen verdicts fail at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openLocalDashboard(page, false, width, ['/audit/recent', '/screens/attention']);
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible();
    await expect(page.locator('.dash-kpi-card')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: /Today.s Schedule/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Activity', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick Actions', exact: true })).toBeVisible();
    await expect(page.getByTestId('screens-down')).toContainText('Meeting rooms display');
    await expect(page.getByRole('link', { name: /Fleet health/i })).toContainText('50.0%');
    // React Query retries a failed read three times (about 7 s) before it gives up.
    await expect(page.getByTestId('recent-activity')).toContainText('Couldn’t load activity', { timeout: 15_000 });
    expect(errors).toEqual([]);
  });
}
