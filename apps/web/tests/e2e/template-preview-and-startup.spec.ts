import { test, expect, type Page } from '@playwright/test';

const TENANT = 'e2e-preview';
const USER = { id: 'preview-user', role: 'SCHOOL_ADMIN', email: 'preview@example.test', tenantId: TENANT };
const TEMPLATE = { id: 'board', name: 'Demo template', screenWidth: 3840, screenHeight: 2160, bgColor: '#fff', zones: [{ id: 'board-zone', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 0, defaultConfig: JSON.stringify({ url: '/templates/custom/brookfield/07-tour-takeaway.html' }) }] };
const PLAYLIST = { id: 'demo-playlist', name: 'Demo board', templateId: TEMPLATE.id, template: TEMPLATE, items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const SCHEDULE = { id: 'rule', playlistId: PLAYLIST.id, screenId: 'display', screen: { id: 'display', name: 'Demo display' }, isActive: true, startTime: new Date(Date.now() - 86400000).toISOString() };

async function setup(page: Page, command = false) {
  let failure = false;
  const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
  const tenant = { id: TENANT, slug: TENANT, name: 'Preview test', vertical: 'CORPORATE' };
  const screen = () => ({ id: 'display', name: 'Demo display', tenantId: TENANT, status: 'ONLINE', resolution: '1920x1080', orientation: 'LANDSCAPE', authState: 'PROVEN', renderHealth: 'OK', renderStale: false, lastPingAt: new Date().toISOString(), lastRenderedAt: new Date(Date.now() - (failure ? 1000 : 10000)).toISOString(), lastRenderedHash: failure ? 'idle:content-unavailable' : 'idle:content-loading', pendingRefreshAt: new Date(Date.now() - (failure ? 20000 : 5000)).toISOString() });
  await page.addInitScript(user => {
    sessionStorage.setItem('edu_cms_token', 'e2e-token'); sessionStorage.setItem('edu_cms_user', JSON.stringify(user)); localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, USER);
  await page.route('**/api/v1/**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/tenants': [tenant], '/tenants/accessible': [tenant], '/branding/me': {},
      '/screens': [screen()], '/screen-groups': [], '/schedules': [SCHEDULE], '/playlists': [PLAYLIST], '/playlists/demo-playlist': PLAYLIST,
      // No gallery hit: preview must come from the saved playlist data.
      '/templates': [], '/templates/board': TEMPLATE, '/assets': [],
      '/screens/fleet': { root: tenant, locations: command ? [tenant, { id: 'other', slug: 'other', name: 'Other location' }] : [], screens: [screen()], stats: { total: 1, online: 1, offline: 0, locationCount: command ? 2 : 1 } },
      '/playlists/demo-playlist/delivery': { latest: { id: 'push', createdAt: new Date(Date.now() - 5000).toISOString(), targetCount: 1, acknowledged: 0, targets: [{ screenId: 'display', name: 'Demo display', online: true, state: 'not-updated', ackAt: null, lastProofAt: null, pushChannel: 'live' }] }, history: [] },
      '/screens/display/faces': { faces: [] }, '/screens/display/events': { events: [] }, '/screens/display/device-inventory': { report: null },
      '/player/latest-version': { versionName: '1.1.20', versionCode: 10120 },
    };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(bodies[path] ?? []) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { fail: () => { failure = true; } };
}

for (const command of [false, true]) {
  test(`saved template previews across dashboard ${command ? 'fleet' : 'standard'}, playlist library and screen details`, async ({ page }, info) => {
    await setup(page, command);
    await page.goto(`/${TENANT}/dashboard`);
    const schedule = command ? page.getByRole('group', { name: 'Today’s Schedule' }) : page.locator('main').filter({ has: page.getByText('Demo board', { exact: true }) }).last();
    const poster = schedule.locator('[data-tpl-poster] img').first();
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('dashboard-template.png'), fullPage: true });
    await page.goto(`/${TENANT}/playlists`);
    await expect(page.locator('[data-tpl-poster] img').first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select Demo board', exact: true }).check();
    const remove = page.getByTestId('bulk-remove');
    await expect(remove).toHaveText('Remove 1');
    const removeBox = await remove.boundingBox();
    const searchBox = await page.getByRole('searchbox', { name: 'Search playlists' }).boundingBox();
    expect(removeBox!.y + removeBox!.height).toBeLessThan(searchBox!.y);
    await page.screenshot({ path: info.outputPath('playlist-template-toolbar.png'), fullPage: true });
    await page.goto(`/${TENANT}/screens`);
    await expect(page.locator('[data-tpl-poster] img').first()).toBeVisible();
    await page.getByRole('button', { name: 'Demo display', exact: true }).click();
    const content = page.getByTestId('screen-content-card');
    await expect(content.locator('[data-tpl-poster] img')).toBeVisible();
    await expect(content).toContainText('Preview of the saved template.');
    await page.screenshot({ path: info.outputPath('screen-template-preview.png'), fullPage: true });
  });
}

test('playlist startup has no failure banner; a newer explicit content failure stays visible', async ({ page }, info) => {
  const scenario = await setup(page);
  await page.goto(`/${TENANT}/playlists/demo-playlist`);
  await expect(page.getByRole('heading', { name: 'Demo board', exact: true }).first()).toBeVisible();
  await expect(page.getByText(/playback problem/)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Screens', exact: true }).click();
  await expect(page.getByText(/playback problem/)).toHaveCount(0);
  await expect(page.getByText('Sending update', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('playlist-starting.png'), fullPage: true });
  scenario.fail();
  await page.reload();
  await expect(page.getByText(/Demo display: playback problem/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('playlist-real-failure.png'), fullPage: true });
});
