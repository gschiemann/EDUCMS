import { test, expect, type Page } from '@playwright/test';

// Synthetic tenants and intercepted writes only; never publish customer content.
const HQ = { id: 'wizard-company', slug: 'wizard-company', name: 'Test Corporate' };
const A = { id: 'wizard-alpha', slug: 'wizard-alpha', name: 'Alpha office' };
const B = { id: 'wizard-beta', slug: 'wizard-beta', name: 'Beta office' };
const USER = { id: 'wizard-operator', email: 'operator@example.test', role: 'DISTRICT_ADMIN', tenantId: HQ.id };
const own = { id: 'own-screen', name: 'Corporate lobby', status: 'ONLINE', sourceTenant: HQ };
const front = { id: 'alpha-front', name: 'Entrance display', status: 'ONLINE', sourceTenant: A };
const back = { ...front, id: 'alpha-back', name: 'Entrance back', faceOfScreenId: front.id, faceContentMode: 'MIRROR', faceIndex: 1 };
const beta = { id: 'beta-screen', name: 'Reception screen', status: 'OFFLINE', sourceTenant: B };
const fleet = { root: HQ, locations: [HQ, A, B], screens: [own, front, back, beta],
  stats: { total: 4, online: 3, offline: 1, locationCount: 3 }, operations: { groups: [], playlists: [], schedules: [] } };
const asset = { id: 'welcome-image', originalName: 'Welcome.png', mimeType: 'image/png', fileUrl: '/welcome-test.png', folderId: null };

async function openWizard(page: Page) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/welcome-test.png', (route) => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (request.method() !== 'GET') {
      const input = request.postDataJSON() ?? {};
      writes.push({ path, body: input });
      body = { id: 'new-playlist', name: 'Company welcome' };
      if (path.endsWith('/publish-to-fleet')) {
        const ids = input.screenIds as string[];
        const targetLocations = [HQ, A, B].filter((location) => fleet.screens.some((screen) => ids.includes(screen.id) && screen.sourceTenant.id === location.id));
        body = { sourcePlaylistId: 'new-playlist', totalScreens: ids.length, totalLocations: targetLocations.length,
          screensScheduled: ids.length, screensPending: 0, ok: true, failures: [],
          perLocation: targetLocations.map((location) => ({ tenantId: location.id, tenantName: location.name, playlistId: 'child-copy',
            screensScheduled: fleet.screens.filter((screen) => ids.includes(screen.id) && screen.sourceTenant.id === location.id).length, isParent: location.id === HQ.id })) };
      }
    } else {
      if (path === '/auth/me') body = USER;
      if (path === '/tenants') body = HQ;
      if (path === '/tenants/accessible') body = { current: HQ.id, tenants: fleet.locations };
      if (path === '/branding/me') body = { displayName: HQ.name, primaryColor: '#e11d48' };
      if (path === '/screens/fleet') body = fleet;
      if (path === '/screens') body = [own];
      if (path === '/assets') body = [{ ...asset, fileUrl: new URL('/welcome-test.png', page.url()).href }];
      if (path === '/submissions/pending-counts') body = { byTenant: [], total: 0 };
      if (path === '/notifications') body = { items: [], unreadCount: 0 };
    }
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
  await page.goto(`/${HQ.id}/playlists?newPlaylist=1`);
  const wizard = page.getByRole('dialog', { name: 'Create new playlist' });
  await wizard.getByPlaceholder(/e\.g\.|name/i).fill('Company welcome');
  await wizard.getByText('Media Playlist', { exact: true }).click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await wizard.getByText('Welcome.png', { exact: true }).click();
  await wizard.getByRole('button', { name: /Next/ }).click();
  await expect(wizard.getByRole('button', { name: 'All company screens', exact: true })).toHaveAttribute('aria-pressed', 'true');
  return { wizard, writes };
}

test('corporate creates and publishes to all company screens from the wizard', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard, writes } = await openWizard(page);
  await wizard.getByRole('button', { name: 'Filter by location' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await wizard.getByRole('button', { name: 'Select all matching screens' }).click();
  await expect(wizard.getByText('4 of 4 screens', { exact: true })).toBeVisible();
  await wizard.screenshot({ path: info.outputPath('company-wizard-screens.png') });
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await expect(wizard.getByText('Publishing across the company')).toBeVisible();
  await expect(wizard.getByText('Schedule a window')).toHaveCount(0);
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await expect(wizard.getByText('Publishes to 4 screens across 3 locations')).toBeVisible();
  await wizard.screenshot({ path: info.outputPath('company-wizard-review.png') });
  await wizard.getByRole('button', { name: 'Create & Publish', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Playlist published', exact: true });
  await expect(result).toContainText('4 screens scheduled to play now across 3 locations');
  expect(writes.map((write) => write.path)).toEqual(['/playlists', '/playlists/new-playlist/items', '/playlists/new-playlist/publish-to-fleet']);
  expect(writes[2].body).toEqual({ screenIds: [own.id, front.id, beta.id] });
  await result.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(wizard).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('edu_cms_user')!).tenantId)).toBe(HQ.id);
  expect(errors).toEqual([]);
});

test('corporate can filter and publish to one child display on a phone', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const { wizard, writes } = await openWizard(page);
  await wizard.getByRole('button', { name: 'Filter by location' }).click();
  await page.getByRole('checkbox', { name: 'Select Alpha office' }).check();
  await page.getByRole('checkbox', { name: 'Select Beta office' }).check();
  await expect(wizard.getByText('Corporate lobby', { exact: true })).toHaveCount(0);
  await expect(wizard.getByText('Reception screen', { exact: true })).toBeVisible();
  const panel = page.getByRole('group', { name: 'Filter by location options' });
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('location-checkboxes-mobile.png') });
  await page.getByRole('checkbox', { name: 'Select Beta office' }).uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(wizard.getByText('Reception screen', { exact: true })).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Play this on both sides', exact: true }).click();
  await wizard.screenshot({ path: info.outputPath('company-wizard-mobile.png') });
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await expect(wizard.getByText('Publishes to 2 screens across 1 location')).toBeVisible();
  await wizard.getByRole('button', { name: 'Create & Publish', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Playlist published', exact: true })).toBeVisible();
  expect(writes.find((write) => write.path.endsWith('/publish-to-fleet'))?.body).toEqual({ screenIds: [front.id] });
  expect(writes.some((write) => write.path === '/schedules' || write.path === '/tenants/switch')).toBe(false);
  expect(errors).toEqual([]);
});

test('corporate local screens still use the regular schedule publish path', async ({ page }) => {
  const { wizard, writes } = await openWizard(page);
  await wizard.getByRole('button', { name: 'Local screens', exact: true }).click();
  await expect(wizard.getByText('Reception screen', { exact: true })).toHaveCount(0);
  await wizard.getByRole('button', { name: /Corporate lobby/ }).click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await expect(wizard.getByText('Schedule a window')).toBeVisible();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await wizard.getByRole('button', { name: 'Create Playlist', exact: true }).click();
  await expect(wizard).toHaveCount(0);
  expect(writes.some((write) => write.path === '/schedules')).toBe(true);
  expect(writes.some((write) => write.path.endsWith('/publish-to-fleet'))).toBe(false);
});

test('corporate publishes to two checked offices without including its local screens', async ({ page }) => {
  const { wizard, writes } = await openWizard(page);
  await wizard.getByRole('button', { name: 'Filter by location' }).click();
  await page.getByRole('checkbox', { name: 'Select Alpha office' }).check();
  await page.getByRole('checkbox', { name: 'Select Beta office' }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await wizard.getByRole('button', { name: 'Select all matching screens' }).click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await wizard.getByRole('button', { name: /^Next/ }).click();
  await expect(wizard.getByText('Publishes to 3 screens across 2 locations')).toBeVisible();
  await wizard.getByRole('button', { name: 'Create & Publish', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Playlist published', exact: true })).toBeVisible();
  expect(writes.find((write) => write.path.endsWith('/publish-to-fleet'))?.body).toEqual({ screenIds: [front.id, beta.id] });
});
