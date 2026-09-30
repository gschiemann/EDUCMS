import { test, expect, type Page } from '@playwright/test';

const ADDRESS = '100 Market Street, Sacramento, CA';
const GROUP = { id: 'group-one', name: 'Allora Neighborhood', address: ADDRESS };
const USER = { id: 'screen-settings-user', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-settings', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const SCREENS = ['DH43', 'L55VEC'].map((name, i) => ({
  id: name, name, status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
  address: null, effectiveAddress: ADDRESS, geoSource: 'group',
  osInfo: 'Android 11', hardwareModel: 'goodview-ep6n',
  playerVersion: i === 0 ? '1.1.17' : '1.1.20', managerVersion: '1.0.24',
  lastPingAt: new Date().toISOString(), authState: 'PROVEN',
}));

async function openScreens(page: Page) {
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, { user: USER, token });
  await page.route(/^http:\/\/api\.invalid\//, async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER,
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
  await expect(page.getByRole('button', { name: 'DH43', exact: true })).toBeVisible();
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
