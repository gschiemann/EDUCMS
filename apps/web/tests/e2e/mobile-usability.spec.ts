import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const ALPHA = 'mobile-alpha';
const BETA = 'mobile-beta';
const tenants = [ALPHA, BETA].map((id, index) => ({ id, slug: id, name: `Test ${index ? 'Beta' : 'Alpha'}`,
  vertical: 'CORPORATE', parentId: null, latitude: 38 + index, longitude: -122 + index }));
const user = (tenantId = ALPHA) => ({ id: 'mobile-test-user', email: 'operator@example.test', role: 'SUPER_ADMIN', tenantId, tenantSlug: tenantId });
const token = (tenantId: string) => {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ sub: user().id, tenantId, role: user().role, exp: 4102444800 })}.test`;
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');

async function setup(page: Page, opts: { failFirst?: boolean; delayBetaBrand?: boolean } = {}) {
  const requests: Array<{ path: string; data: any }> = [];
  const errors: string[] = [];
  const storage = { active: 0, max: 0, attempts: 0 };
  let releaseBetaBrand!: () => void;
  const betaBrandGate = new Promise<void>((resolve) => { releaseBetaBrand = resolve; });
  page.on('pageerror', error => { errors.push(error.message); console.error('mobile page error:', error.message); });
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.route('https://cdn.example.test/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.route('https://storage.example.test/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'PUT,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    storage.active++; storage.max = Math.max(storage.max, storage.active); storage.attempts++;
    const fail = opts.failFirst && storage.attempts === 1;
    await new Promise(resolve => setTimeout(resolve, 150));
    storage.active--;
    return route.fulfill({ status: fail ? 503 : 200, headers, body: '{}' });
  });
  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const data = req.postDataJSON();
    requests.push({ path, data });
    const bearer = req.headers().authorization?.replace('Bearer ', '');
    const tenantId = bearer ? JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).tenantId : ALPHA;
    const tenant = tenants.find(t => t.id === tenantId) ?? tenants[0];
    const screens = tenants.map((location, index) => ({ id: `screen-${index}`, tenantId: tenantId,
      name: `Test screen ${index}`, status: 'ONLINE', resolution: '1920x1080', lastPingAt: new Date().toISOString(),
      effectiveLatitude: location.latitude, effectiveLongitude: location.longitude, sourceTenant: tenant,
      screenGroupId: `group-${index}`, screenGroup: { id: `group-${index}`, name: `Test site ${index}` } }));
    let body: unknown = [];
    const bodies: Record<string, unknown> = {
      '/auth/me': user(tenantId), '/users/me': user(tenantId), '/tenants': tenant, '/tenants/me': tenant,
      '/tenants/accessible': { current: tenantId, tenants },
      '/branding/me': { displayName: tenant.name, logoUrl: `https://cdn.example.test/${tenantId}.png`, palette: { primary: tenantId === ALPHA ? '#003b5c' : '#dc2626' } },
      '/screens': screens, '/screen-groups': screens.map(s => ({ ...s.screenGroup, latitude: s.effectiveLatitude, longitude: s.effectiveLongitude })),
      '/screens/fleet': { root: tenant, locations: [tenant], screens, stats: { total: 2, online: 2, offline: 0, locationCount: 1 } },
      '/assets': { assets: [], total: 0 }, '/assets/folders': [{ id: 'videos', name: 'Test videos', parentId: null, _count: { assets: 0 }, updatedAt: new Date().toISOString() }],
      '/assets/storage-summary': { totalBytes: 0, totalFiles: 0, videos: { bytes: 0, files: 0 }, images: { bytes: 0, files: 0 }, other: { bytes: 0, files: 0 } },
      '/assets/storage': { usedBytes: 0, includedBytes: 10 * 1024 ** 3, percent: 0, screens: 2, warn: false },
      '/notifications': { notifications: [], unreadCount: 0 }, '/passkeys': { passkeys: [], max: 10 },
      '/super/tenants': [],
      '/super/activation-funnel': { recentTenants: [], aggregate: { totalTenants: 0, excludedTenants: 0,
        stageCounts: { SIGNED_UP: 0, BOARD_CREATED: 0, SCREEN_PAIRED: 0, PUBLISHED: 0, RENDER_PROVEN: 0 },
        medianHoursToMilestone: { boardCreated: null, screenPaired: null, published: null, renderProven: null },
        activationRate: { overall: { reached: 0, total: 0, pct: null }, last30Days: { reached: 0, total: 0, pct: null } } },
        excluded: { count: 0, note: 'Synthetic test accounts' }, meta: { generatedAt: new Date().toISOString(), definition: 'Test data' } },
    };
    body = bodies[path] ?? body;
    if (path === '/branding/me' && tenantId === BETA && opts.delayBetaBrand) await betaBrandGate;
    if (path === '/tenants/switch') body = { access_token: token(data.tenantId), user: user(data.tenantId) };
    if (path === '/assets/presign') body = { uploadUrl: `https://storage.example.test/${encodeURIComponent(data.filename)}`,
      storagePath: `${tenantId}/${data.filename}`, mimeType: data.contentType, maxFileSize: 500 * 1024 * 1024 };
    if (path === '/assets/complete-upload') body = { id: data.filename, status: 'PUBLISHED', originalName: data.filename, mimeType: data.contentType };
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(({ sessionUser, jwt }) => {
    sessionStorage.setItem('edu_cms_token', jwt);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(sessionUser));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    // A legacy cache must never lend Alpha's logo to Beta during a switch.
    localStorage.setItem('edu-cms-branding-cache-v1', JSON.stringify({ displayName: 'Test Alpha', logoUrl: 'https://cdn.example.test/mobile-alpha.png' }));
  }, { sessionUser: user(), jwt: token(ALPHA) });
  return { requests, errors, storage, releaseBetaBrand };
}

test('five videos retain their selection, confirm the folder, serialize storage and retry a failure', async ({ page }, info) => {
  const state = await setup(page, { failFirst: true });
  await page.goto(`/${ALPHA}/assets`);
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Add asset' });
  await expect(menu).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const rect = await menu.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(8);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width - 8);
  }
  await page.screenshot({ animations: 'disabled', path: info.outputPath('upload-menu.png') });
  const chooserEvent = page.waitForEvent('filechooser');
  await menu.getByRole('menuitem', { name: 'Upload files', exact: true }).click();
  const chooser = await chooserEvent;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(Array.from({ length: 5 }, (_, i) => ({ name: `video-${i}.mp4`, mimeType: 'video/mp4', buffer: Buffer.from('synthetic video payload') })));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Upload 5 files to…' })).toBeVisible();
  expect(state.requests.filter(r => r.path === '/assets/presign')).toHaveLength(0);
  await dialog.getByRole('button', { name: /Test videos/ }).click();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('confirm-five-videos.png') });
  await dialog.getByRole('button', { name: 'Upload 5 files', exact: true }).click();
  const queue = page.getByTestId('upload-queue');
  await expect(queue.getByText('Ready', { exact: true })).toHaveCount(4, { timeout: 20_000 });
  await queue.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect(queue.getByText('Ready', { exact: true })).toHaveCount(5);
  expect(state.storage.max).toBe(1);
  const presigns = state.requests.filter(r => r.path === '/assets/presign');
  expect(presigns).toHaveLength(6);
  expect(presigns.every(r => r.data.folderId === 'videos')).toBe(true);
  expect(state.requests.filter(r => r.path === '/assets/complete-upload')).toHaveLength(5);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('five-video-upload-results.png') });
  expect(state.errors).toEqual([]);
});

test('switching accounts removes the old logo while new branding loads', async ({ page }, info) => {
  const state = await setup(page, { delayBetaBrand: true });
  await page.goto(`/${ALPHA}/assets`);
  const header = page.locator('header');
  await expect(header.getByRole('img', { name: 'Test Alpha' })).toBeVisible();
  await header.getByRole('button', { name: 'Test Alpha', exact: true }).click();
  await header.getByRole('button', { name: /Primary Test Beta/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${BETA}/assets`));
  await expect(header.getByRole('img', { name: 'Test Alpha' })).toHaveCount(0);
  state.releaseBetaBrand();
  await expect(header.getByRole('img', { name: 'Test Beta' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('beta-account-branding.png') });
  expect(state.errors).toEqual([]);
});

test('the map cannot cover primary tabs or More and one finger can scroll past it', async ({ page, browserName }, info) => {
  const state = await setup(page);
  await page.goto(`/${ALPHA}/screens`);
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  const map = page.locator('.leaflet-container');
  await expect(map).toBeVisible();
  await expect(map).not.toHaveClass(/leaflet-touch-drag/);
  await map.scrollIntoViewIfNeeded();
  if (browserName === 'chromium') {
    const rect = (await map.boundingBox())!;
    const before = await page.locator('#main-content').evaluate(el => el.scrollTop);
    const cdp = await page.context().newCDPSession(page);
    const y = Math.min(620, rect.y + rect.height - 30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
    for (let n = 1; n <= 8; n++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: y - n * 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.locator('#main-content').evaluate(el => el.scrollTop)).toBeGreaterThan(before);
    await cdp.detach();
  }
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByTestId('more-sheet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Owner console', exact: true })).toBeVisible();
  await expect(nav).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('more-above-map-with-tabs.png') });
  await nav.getByRole('link', { name: 'Media', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${ALPHA}/assets`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('standalone owner pages retain an exit and correct tenant navigation', async ({ page }, info) => {
  const state = await setup(page);
  await page.goto('/super');
  const back = page.getByRole('link', { name: 'Back to dashboard', exact: true });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute('href', `/${ALPHA}/dashboard`);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Media', exact: true })).toHaveAttribute('href', `/${ALPHA}/assets`);
  await expect(page.getByRole('heading', { name: 'Owner control panel', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('owner-console-with-exit.png') });
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/${ALPHA}/dashboard`));
  await expect(nav).toBeVisible();
  expect(state.errors).toEqual([]);
});
