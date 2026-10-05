import { test, expect, type Page } from '@playwright/test';

// Synthetic continental fleet with one Hawaii office and unresolved Canadian
// addresses. No customer data or production requests are used by this test.
const HQ = 'atlas-test-hq';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const USER = { id: 'atlas-test-user', email: 'atlas@example.test', role: 'DISTRICT_ADMIN', tenantId: HQ };
const CITIES = [
  [47.61, -122.33], [45.52, -122.68], [37.77, -122.42], [34.05, -118.24],
  [32.72, -117.16], [33.45, -112.07], [36.17, -115.14], [40.76, -111.89],
  [39.74, -104.99], [44.98, -93.27], [41.88, -87.63], [38.63, -90.20],
  [32.78, -96.80], [29.76, -95.37], [30.27, -97.74], [35.47, -97.52],
  [39.10, -94.58], [36.16, -86.78], [33.75, -84.39], [35.23, -80.84],
  [25.76, -80.19], [28.54, -81.38], [29.95, -90.07], [36.85, -75.98],
  [38.91, -77.04], [39.29, -76.61], [39.95, -75.17], [40.71, -74.01],
  [42.36, -71.06], [41.50, -81.69], [42.33, -83.05], [39.96, -82.99],
  [40.44, -79.99], [39.77, -86.16], [38.25, -85.76], [35.15, -90.05],
  [27.95, -82.46], [21.31, -157.86],
];
const located = CITIES.map(([latitude, longitude], index) => ({
  id: `office-${index}`, slug: `office-${index}`, name: index === 37 ? 'Island office' : `Office ${index + 1}`,
  latitude, longitude, address: 'Test office address',
}));
const fleet = {
  root: { id: HQ, name: 'Atlas Test Corporate', slug: HQ, vertical: 'CORPORATE' },
  locations: [
    { id: HQ, name: 'Atlas Test Corporate', slug: HQ }, ...located,
    { id: 'toronto', name: 'Toronto office', slug: 'toronto', address: '100 Queen St W, Toronto, ON, Canada' },
    { id: 'vancouver', name: 'Vancouver office', slug: 'vancouver', address: '453 W 12th Ave, Vancouver, BC, Canada' },
  ],
  stats: { total: 1, online: 0, offline: 1, locationCount: 41 },
  screens: [{
    id: 'offline-screen', name: 'Lobby', status: 'OFFLINE', screenGroup: null,
    sourceTenant: { id: 'office-29', name: 'Office 30', slug: 'office-29' },
    effectiveLatitude: 41.50, effectiveLongitude: -81.69, effectiveAddress: 'Test office address',
    renderHealth: 'OK', renderStale: false, pushChannel: 'unknown', lastPingAt: null,
  }],
};

async function openFleet(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const headers = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (path === '/auth/me') body = USER;
    if (path === '/tenants') body = { id: HQ, name: 'Atlas Test Corporate', slug: HQ, vertical: 'CORPORATE' };
    if (path === '/tenants/accessible') body = fleet.locations;
    if (path === '/branding/me') body = { displayName: 'Atlas Test Corporate', primaryColor: '#e11d48' };
    if (path === '/screens/fleet') body = fleet;
    if (path === '/screens/fleet-pulse') body = { fleet: [], locations: {} };
    if (path === '/emergency/readiness/district') body = { schools: [], notReadyCount: 0, delivery: { key: 'delivery', status: 'ok' } };
    if (path === '/submissions/pending-counts') body = { byTenant: [], total: 0 };
    if (path === '/deployments') body = { deployments: [] };
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
  await page.goto(`/${HQ}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'map', exact: true }).click({ timeout: 90_000 });
  await page.locator('.leaflet-container').waitFor();
}

test('fleet map opens close, with lists collapsed and honest unresolved-address copy', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFleet(page);
  const map = page.locator('[data-testid="location-map-surface"]');
  await map.scrollIntoViewIfNeeded();
  // Zoom 4 tiles are continental scale. The previous 830px side reservation
  // forced this same spread down to a world view (zoom 2/3).
  await expect.poll(() => page.locator('.leaflet-tile').evaluateAll((tiles) =>
    Math.max(...tiles.map((tile) => Number((tile as HTMLImageElement).src.match(/\/(\d+)\/\d+\/\d+\.png/)?.[1] ?? 0))),
  )).toBeGreaterThanOrEqual(4);
  const inbox = page.getByRole('group', { name: 'Exception inbox' });
  for (const heading of await inbox.getByRole('button').all()) {
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(inbox.getByText('Lobby · Offline')).toHaveCount(0);
  const unresolved = page.getByRole('group', { name: 'Locations not on the map yet' });
  await expect(unresolved.getByRole('button', { name: /Not on the map yet/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(unresolved.getByText('Toronto office')).toBeHidden();
  await map.screenshot({ path: info.outputPath('fleet-map-default.png') });

  await inbox.getByRole('button', { name: /^Offline/ }).click();
  await expect(inbox.getByText('Lobby · Offline')).toBeVisible();
  await inbox.getByRole('button', { name: /^Offline/ }).click();
  await expect(inbox.getByText('Lobby · Offline')).toHaveCount(0);
  await unresolved.getByRole('button', { name: /Not on the map yet/ }).click();
  await expect(unresolved.getByText('Toronto office')).toBeVisible();
  await expect(unresolved.getByText('Address not located yet.')).toHaveCount(2);
  await expect(unresolved.getByRole('button', { name: /Review address/ })).toHaveCount(2);
  await expect(map.getByText(/Locating/)).toHaveCount(0);
  await map.screenshot({ path: info.outputPath('fleet-map-address-drawer.png') });

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Fit all locations', exact: true }).click();
  await expect(page.locator('.venueos-locpin-row').filter({ hasText: 'Island office' })).toBeVisible();
  expect(errors).toEqual([]);
});
