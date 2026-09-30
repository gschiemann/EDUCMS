import { test, expect, type Page } from '@playwright/test';

const TENANT = { id: 'e2e-followups', name: 'Setup test', slug: 'e2e-followups', vertical: 'K12', parentId: null };
const USER = { id: 'followups-user', email: 'setup@example.com', role: 'SCHOOL_ADMIN', tenantId: TENANT.id, canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const PLAYLIST = { id: 'test-video-playlist', name: 'Three videos', items: [{
  id: 'item-one', assetId: 'asset-one', sequenceOrder: 0, durationMs: 2000, transitionType: 'FADE', muted: true,
  asset: { id: 'asset-one', originalName: 'Opening.mp4', mimeType: 'video/mp4', fileUrl: 'http://api.invalid/assets/opening.mp4', status: 'PUBLISHED' },
}] };

async function prepare(page: Page) {
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    localStorage.removeItem('edu_dashboard_hint_dismissed');
  }, { user: USER, token });
  await page.route(/^http:\/\/api\.invalid\//, route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER,
      '/tenants': TENANT, '/tenants/accessible': [TENANT], '/tenants/me': TENANT,
      '/screens/fleet': { locations: [], totals: {} },
      '/screens': [], '/screen-groups': [], '/schedules': [], '/templates': [],
      '/assets': [], '/assets/folders': [], '/branding/me': {},
      '/playlists': [PLAYLIST], [`/playlists/${PLAYLIST.id}`]: PLAYLIST,
    };
    const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(bodies[path] ?? []) });
  });
}

test('getting started connects a screen, uploads an asset, then creates a playlist', async ({ page }, info) => {
  await prepare(page);
  await page.goto(`/${TENANT.id}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible();
  const steps = page.locator('a').filter({ has: page.locator('h3') });
  const setup = steps.filter({ hasText: /^(1\.|2\.|3\.)/ });
  await expect(setup).toHaveCount(3);
  await expect(setup.nth(0)).toContainText('Connect a Screen');
  await expect(setup.nth(0)).toHaveAttribute('href', `/${TENANT.id}/screens`);
  await expect(setup.nth(1)).toContainText('Upload an asset');
  await expect(setup.nth(1)).toHaveAttribute('href', `/${TENANT.id}/assets`);
  await expect(setup.nth(2)).toContainText('Create a playlist');
  await expect(setup.nth(2)).toHaveAttribute('href', `/${TENANT.id}/playlists`);
  await page.screenshot({ path: info.outputPath('getting-started-order.png'), fullPage: true });
});

test('normal video settings explain direct switching and offer no unsupported transition choices', async ({ page }, info) => {
  await prepare(page);
  await page.goto(`/${TENANT.id}/playlists/${PLAYLIST.id}?tab=content`);
  const settings = page.getByRole('button', { name: 'Slide settings', exact: true });
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page.getByText('Videos switch directly when the next frame is ready.', { exact: true })).toBeVisible();
  await expect(page.locator('select').filter({ has: page.locator('option[value="FADE"]') })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('video-direct-switch-settings.png'), fullPage: true });
});
