import { test, expect, type Page } from '@playwright/test';

// Synthetic accounts, intercepted configuration writes; never send a live alert.
async function openSettings(page: Page, local = false) {
  const id = local ? 'alert-office' : 'alert-company';
  const user = { id: 'alert-admin', email: 'admin@example.test', role: local ? 'SCHOOL_ADMIN' : 'DISTRICT_ADMIN', tenantId: id };
  let enabled = local;
  let removed = false;
  const writes: string[] = [];
  await page.route('**/alert-test.png', (route) => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    let body: unknown = [];
    if (request.method() !== 'GET') {
      writes.push(path);
      if (path === '/tenants/me/emergency-enabled') {
        enabled = request.postDataJSON().enabled;
        const allLocations = request.postDataJSON().applyToAllLocations === true;
        body = { ok: true, emergencyEnabled: enabled, locationsEnabled: allLocations ? 2 : 0, locationsInitialized: allLocations ? 2 : 0, defaultBucketsLoaded: allLocations ? 24 : 0 };
      } else if (request.method() === 'DELETE') { removed = true; body = { ok: true }; }
    } else {
      if (path === '/auth/me') body = user;
      if (path === '/tenants') body = { id, name: local ? 'Test office' : 'Test corporate', slug: id,
        vertical: 'CORPORATE', parentId: local ? 'alert-company' : null, emergencyEnabled: enabled,
        emergencyEnabledEffective: enabled, emergencyEnabledLocked: false, emergencyVerticalStated: true };
      if (path === '/tenants/accessible') body = { current: id, tenants: [{ id, name: 'Test corporate', slug: id }] };
      if (path === '/branding/me') body = { displayName: 'Test organization', primaryColor: '#e11d48' };
      if (path === '/emergency/readiness') body = { verdict: 'NEEDS_ATTENTION', score: 60, items: [], computedAt: new Date().toISOString() };
      if (path === '/tenants/me/location-based-emergency') body = { enabled: false };
      if (path.startsWith('/panic-content/')) {
        const kind = path.split('/')[2];
        const orientation = url.searchParams.get('orientation');
        body = { kind, orientation, playlistId: `${id}-${kind}-${orientation}`, items: removed && kind === 'lockdown' && orientation === 'landscape' ? [] : [{
          id: `${id}-${kind}-item`, assetId: `${id}-${kind}-media`, durationMs: 10000, sequenceOrder: 0,
          asset: { id: `${id}-${kind}-media`, originalName: `${kind}-default.png`, mimeType: 'image/png', fileUrl: new URL('/alert-test.png', page.url()).href },
        }] };
      }
      if (path === '/notifications') body = { items: [], unreadCount: 0 };
      if (path === '/audit-log') body = { items: [], total: 0 };
    }
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, user);
  await page.goto(`/${id}/settings/emergency`);
  return writes;
}

test('corporate enablement explains all locations and displays confirmed initialization counts', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const writes = await openSettings(page);
  const applyAll = page.getByRole('checkbox', { name: /Apply to all current locations/ });
  await expect(applyAll).not.toBeChecked();
  await applyAll.check();
  await page.getByRole('button', { name: 'Turn on emergency alerts', exact: true }).click();
  await expect(page.getByText(/including locations without screens/)).toBeVisible();
  await expect(page.getByText(/Existing local content and admin changes are kept/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to all locations', exact: true }).click();
  await expect(page.getByText(/setup enabled for 2 locations; initial alert content loaded for 2 locations/)).toBeVisible();
  await expect(page.locator('[data-alert-content-card="lockdown"]').getByText('lockdown-default.png')).toBeVisible();
  await page.screenshot({ path: info.outputPath('corporate-emergency-enabled.png'), fullPage: true });
  expect(writes).toEqual(['/tenants/me/emergency-enabled']);
  expect(errors).toEqual([]);
});

test('corporate account-only enablement leaves locations outside the request', async ({ page }) => {
  const writes = await openSettings(page);
  await expect(page.getByRole('checkbox', { name: /Apply to all current locations/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Turn on emergency alerts', exact: true }).click();
  await expect(page.getByText(/This enables emergency setup for this account only/)).toBeVisible();
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(page.getByText('Saved. The server confirms emergency alerts are on.')).toBeVisible();
  expect(writes).toEqual(['/tenants/me/emergency-enabled']);
});

test('local administrator sees populated landscape and portrait defaults and can edit their copy', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const writes = await openSettings(page, true);
  const card = page.locator('[data-alert-content-card="lockdown"]');
  await expect(card.getByText('1L · 1P')).toBeVisible();
  await expect(card.getByText('lockdown-default.png')).toBeVisible();
  await card.getByRole('tab', { name: /Portrait/ }).click();
  await expect(card.getByText('lockdown-default.png')).toBeVisible();
  await card.getByRole('tab', { name: /Landscape/ }).click();
  await page.screenshot({ path: info.outputPath('local-emergency-defaults.png'), fullPage: true });
  await card.getByRole('button', { name: /Remove/ }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await expect(card.getByText('0L · 1P')).toBeVisible();
  await expect(page.locator('[data-alert-content-card="weather"]').getByText('weather-default.png')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain('/panic-content/lockdown/assets/alert-office-lockdown-item');
  expect(errors).toEqual([]);
});
