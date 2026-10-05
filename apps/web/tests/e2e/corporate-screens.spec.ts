import { test, expect, type Page } from '@playwright/test';

// Synthetic company only. Browser requests never touch customer tenants.
const HQ = 'company-test-hq';
const USER = { id: 'company-test-user', email: 'operator@example.test', role: 'DISTRICT_ADMIN', tenantId: HQ };
const locations = [
  { id: HQ, slug: HQ, name: 'Test Corporate', latitude: 39.74, longitude: -104.99 },
  { id: 'austin', slug: 'austin', name: 'Austin office', latitude: 30.27, longitude: -97.74 },
  { id: 'boston', slug: 'boston', name: 'Boston office', latitude: 42.36, longitude: -71.06 },
  { id: 'seattle', slug: 'seattle', name: 'Seattle office', latitude: 47.61, longitude: -122.33 },
];
const groups = [
  { id: 'a-group', tenantId: 'austin', name: 'Lobby', sourceTenant: locations[1] },
  { id: 'b-group', tenantId: 'boston', name: 'Lobby', sourceTenant: locations[2] },
];
const makeScreen = (id: string, location: typeof locations[number], group?: typeof groups[number]) => ({
  id, name: `${location.name} screen`, tenantId: location.id, status: 'ONLINE', sourceTenant: location,
  screenGroupId: group?.id ?? null, screenGroup: group ?? null,
  hardwareModel: 'Test LCD', resolution: '1920x1080', osInfo: 'Test OS', ipAddress: '192.0.2.10',
  lastPingAt: new Date().toISOString(), renderHealth: 'OK', renderStale: false,
  lastRenderedAt: new Date().toISOString(), lastRenderedHash: 'idle:no-content',
  effectiveLatitude: location.latitude, effectiveLongitude: location.longitude, geoSource: 'tenant',
});
const own = makeScreen('hq-screen', locations[0]);
const fleet = {
  root: { ...locations[0], vertical: 'CORPORATE' }, locations,
  screens: [own, makeScreen('a-screen', locations[1], groups[0]), makeScreen('b-screen', locations[2], groups[1])],
  stats: { total: 3, online: 3, offline: 0, locationCount: 4 },
  operations: { groups, schedules: [], playlists: [] },
};

async function openCompany(page: Page, path: string) {
  const writes: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.route('**/api/v1/**', (route) => {
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace('/api/v1', '');
    if (route.request().method() !== 'GET') writes.push(apiPath);
    let body: unknown = [];
    if (apiPath === '/auth/me') body = USER;
    if (apiPath === '/tenants') body = fleet.root;
    if (apiPath === '/tenants/accessible') body = { current: HQ, tenants: locations };
    if (apiPath === '/branding/me') body = { displayName: 'Test Corporate', primaryColor: '#e11d48' };
    if (apiPath === '/screens/fleet') body = fleet;
    if (apiPath === '/screens') body = [own];
    if (apiPath === '/screens/fleet-pulse') body = { fleet: [], locations: {} };
    if (apiPath === '/emergency/readiness/district') body = { schools: [], notReadyCount: 0, delivery: { key: 'delivery', status: 'ok' } };
    if (apiPath === '/submissions/pending-counts') body = { byTenant: [], total: 0 };
    if (apiPath === '/deployments') body = { deployments: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
  await page.setViewportSize({ width: 1840, height: 1100 });
  await page.goto(`/${HQ}/${path}`, { waitUntil: 'domcontentloaded' });
  return writes;
}

test('corporate sees local and company group cards, details and location map without switching tenants', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const writes = await openCompany(page, 'screens');
  await expect(page.getByRole('button', { name: 'Local screens', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 90_000 });
  const desktop = page.getByTestId('screens-desktop');
  await expect(desktop.getByRole('button', { name: own.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair screen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'All company screens', exact: true }).click();
  await expect(desktop.locator('[data-screen-group="a-group"]')).toContainText('Austin office · Lobby');
  await expect(desktop.locator('[data-screen-group="b-group"]')).toContainText('Boston office · Lobby');
  await expect(page.getByRole('button', { name: 'Pair screen', exact: true })).toBeDisabled();
  await desktop.getByRole('button', { name: 'Austin office screen', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /Austin office screen/ });
  await expect(drawer.getByText('Test LCD · Test OS', { exact: true })).toBeVisible();
  await expect(drawer.getByText('192.0.2.10', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Open live preview' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close details' }).click();
  const filter = page.getByRole('combobox', { name: 'Filter by location' });
  await filter.selectOption('austin');
  await expect(desktop.locator('[data-screen-group="b-group"]')).toHaveCount(0);
  await expect(filter.locator('option')).toHaveCount(5);
  await filter.selectOption('all');
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await page.locator('.leaflet-container').waitFor();
  await expect(page.locator('.venueos-locpin-row').filter({ hasText: 'Seattle office' })).toBeVisible();
  await page.locator('.leaflet-tile-loaded').first().waitFor({ timeout: 20_000 });
  await page.locator('[data-testid="location-map-surface"]').screenshot({ path: info.outputPath('company-screen-map.png') });
  await page.locator('.venueos-locpin-row').filter({ hasText: 'Austin office' }).click();
  await page.getByRole('region', { name: 'Austin office screens' }).getByRole('button', { name: 'View location in list' }).click();
  await expect(filter).toHaveValue('austin');
  await expect(page.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: info.outputPath('company-screen-groups.png') });
  await page.getByRole('button', { name: 'Local screens', exact: true }).click();
  await expect(desktop.getByRole('button', { name: own.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair screen', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('edu_cms_user')!).tenantId)).toBe(HQ);
  expect(writes).not.toContain('/tenants/switch');
  expect(errors).toEqual([]);
});

test('dashboard offers all location names and totals link into company Screens', async ({ page }) => {
  test.setTimeout(120_000);
  await openCompany(page, 'dashboard');
  const filter = page.getByRole('combobox', { name: 'Filter offices by name' });
  await expect(filter).toBeVisible({ timeout: 90_000 });
  await filter.selectOption('boston');
  await expect(filter.locator('option')).toHaveCount(5);
  await expect(page.getByRole('combobox', { name: 'Show one office or all of them' })).toHaveValue('boston');
  await filter.selectOption('all');
  await page.getByRole('tab', { name: 'map', exact: true }).click();
  await page.getByRole('group', { name: 'Fleet totals' }).getByRole('link', { name: /Screens/ }).click();
  await expect(page.getByRole('button', { name: 'All company screens', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('screens-desktop').locator('[data-screen-group="b-group"]')).toBeVisible();
});
