import { test, expect, type Page } from '@playwright/test';

const ADDRESS = '100 Market Street, Sacramento, CA';
const GROUP = { id: 'group-one', name: 'Allora Neighborhood', address: ADDRESS, latitude: 38.58, longitude: -121.49 };
const LOGO = 'http://localhost:3000/test-brookfield-logo.svg';
const USER = { id: 'screen-settings-user', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-settings', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const SCREENS = ['DH43', 'L55VEC'].map((name, i) => ({
  id: name, name, status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
  address: null, effectiveAddress: ADDRESS, geoSource: 'group', effectiveLatitude: GROUP.latitude, effectiveLongitude: GROUP.longitude,
  osInfo: 'Android 11', hardwareModel: 'goodview-ep6n',
  playerVersion: i === 0 ? '1.1.17' : '1.1.20', managerVersion: '1.0.24',
  lastPingAt: new Date().toISOString(), authState: 'PROVEN',
}));

async function openScreens(page: Page) {
  await page.route('**/test-brookfield-logo.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#063051"/><text x="20" y="80" fill="white" font-size="85" font-family="sans-serif">B</text></svg>',
  }));
  // Keep map verification independent of the public tile service.
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, { user: USER, token });
  await page.route(/^http:\/\/api\.invalid\//, async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/branding/me': { logoUrl: LOGO },
      '/tenants': [{ id: USER.tenantId, name: 'Screen settings', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Screen settings', slug: USER.tenantId }],
      '/screens': SCREENS,
      '/screen-groups': [GROUP, { id: 'group-empty', name: 'No location yet', address: null }],
      '/schedules': [], '/playlists': [],
      '/player/latest-version': { versionName: '1.1.20', versionCode: 10120, managerVersionName: '1.0.24' },
      '/screens/hardware-catalog': { models: [] },
      '/screens/hardware': { models: [] },
    };
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = path.endsWith('/device-inventory') ? { report: null, reportedAt: null }
      : path.endsWith('/events') ? { events: [] }
        : path.endsWith('/faces') ? { faces: [] }
          : bodies[path] ?? [];
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.goto('/e2e-settings/screens');
  await expect(page.locator(':text-is("DH43"):visible').first()).toBeVisible();
}

test('group headers show saved addresses and menus distinguish Set from Edit', async ({ page }) => {
  await openScreens(page);
  await expect(page.getByText(ADDRESS, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('(2)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('(0)', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions for Allora Neighborhood', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit group address', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More actions for No location yet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set group address', exact: true })).toBeVisible();
  await expect(page.getByText('No group address').first()).toBeVisible();
});

test('an acknowledged resync is captured in Content without duplicate delivery or an indefinite spinner', async ({ page }, info) => {
  await openScreens(page);
  await page.route('**/api/v1/screens/DH43/events**', route => route.fulfill({
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' },
    body: JSON.stringify({ events: [{ id: 'ack-one', kind: 'refresh-acked', createdAt: new Date(Date.now() - 60_000).toISOString() }] }),
  }));
  await page.getByRole('button', { name: 'DH43', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('screen-content-card')).toBeVisible();
  await expect(dialog.getByText('Delivery', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Update confirmed', { exact: true })).toHaveCount(0);
  await expect(dialog.getByTestId('screen-content-update')).toHaveCount(0);
  await expect(dialog.locator('svg.animate-spin')).toHaveCount(0);
  await expect.poll(async () => {
    const box = await dialog.getByTestId('screen-content-card').boundingBox();
    return !!box && box.x + box.width <= page.viewportSize()!.width;
  }).toBe(true);
  await page.screenshot({ path: info.outputPath('screen-overview-content.png'), fullPage: true });
});

test('Settings inherits the group address and offers one clear update action', async ({ page }, info) => {
  await openScreens(page);
  await page.getByRole('button', { name: 'DH43', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(dialog.getByText(ADDRESS, { exact: true })).toBeVisible();
  await expect(dialog.getByText('From group address')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Resync content/ })).toHaveCount(1);
  await expect(dialog.getByRole('link', { name: 'Open live preview', exact: true })).toHaveCount(1);
  await expect(dialog.getByTestId('apk-push')).toBeVisible();
  await expect(dialog.getByTestId('apk-push')).toHaveText('Push update');
  await expect(dialog.getByTestId('apk-push')).toHaveClass(/bg-indigo-600/);
  await page.screenshot({ path: info.outputPath('screen-settings-update.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'L55VEC', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(dialog.getByText('Player app v1.1.20 — up to date')).toBeVisible();
  await expect(dialog.getByTestId('apk-push')).toHaveCount(0);
});


test('Map uses account branding for a shared group location and opens its equipment', async ({ page }, info) => {
  await openScreens(page);
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  const pin = page.getByRole('img', { name: /^Allora Neighborhood —/ });
  await expect(pin).toBeVisible();
  await expect(pin).toHaveCount(1); // two devices at one address, one physical location
  const logo = pin.locator('img.venueos-locpin-logo');
  await expect(logo).toHaveAttribute('src', LOGO);
  await expect.poll(() => logo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await pin.click();
  // Same floating navigation, filters and zoom controls as the corporate dashboard.
  await expect(page.getByRole('group', { name: 'Location navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit all locations', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Allora Neighborhood details' })).toBeVisible();
  await expect(page.getByText('DH43', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('L55VEC', { exact: true }).first()).toBeVisible();
  await expect.poll(() => logo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('screen-map-logo.png'), fullPage: true });
  await logo.evaluate(img => img.dispatchEvent(new Event('error')));
  await expect(pin.locator('img')).toHaveCount(0);
  await expect(pin.locator('.venueos-locpin-initials')).toHaveText('AN');
});

test('map navigation filters keep the map visible and location equipment opens screen details', async ({ page }) => {
  await openScreens(page);
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await page.getByRole('radio', { name: 'Offline', exact: true }).click();
  await expect(page.getByText('No locations match this filter.')).toBeVisible();
  await expect(page.getByTestId('location-map-surface').locator('.leaflet-container')).toBeVisible();
  await page.getByRole('radio', { name: 'All', exact: true }).click();
  await page.getByRole('group', { name: 'Location navigation' }).getByRole('button', { name: 'Allora Neighborhood', exact: true }).click();
  await page.getByRole('group', { name: 'Allora Neighborhood details' }).getByRole('button', { name: /^DH43/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('DH43');
});

test('mobile map location navigation stays inside the viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreens(page);
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await page.getByRole('group', { name: 'Location navigation' }).getByRole('button', { name: 'Allora Neighborhood', exact: true }).click();
  const details = page.getByRole('group', { name: 'Allora Neighborhood details' });
  await expect(details).toBeVisible();
  const box = await details.boundingBox();
  const filters = await page.getByRole('radiogroup', { name: 'Filter locations on the map' }).boundingBox();
  expect(filters!.y + filters!.height).toBeLessThanOrEqual(box!.y);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(details.getByRole('button', { name: /^DH43/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile-location-map.png'), fullPage: true });
});
