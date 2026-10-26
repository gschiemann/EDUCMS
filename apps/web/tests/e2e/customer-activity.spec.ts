/**
 * Customer-facing Home (2026-10-24) in a REAL browser — chromium + webkit, at
 * an iPhone (390×844) and the owner's Safari size (1325×758).
 *
 * The owner's phone showed backend rows on Home ("Field Build Window Expire ·
 * field_build_window", "Ota Push Held · screen"), a phone-browser test screen
 * silent since Aug 6 in the red "Screens down" card, and a bell reading 31.
 * The fixture is that tenant's shape (fictional names): the API now answers
 * with customer activity only, one real outage, one quiet test screen and ONE
 * notification that still needs someone.
 *
 * Every API call is intercepted; nothing touches a database. Set
 * `ACTIVITY_SHOTS=<dir>` to also save screenshots.
 *
 *   E2E_BASE=http://localhost:3157 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/customer-activity.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const T = 'northwind-media';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const SHOTS = process.env.ACTIVITY_SHOTS;
const USER = { id: 'me', email: 'pat@northwind.example', firstName: 'Pat', role: 'DISTRICT_ADMIN', tenantId: T, canTriggerPanic: true };

const VIEWPORTS = [
  { name: 'iphone-390', width: 390, height: 844, mobile: true },
  { name: 'safari-1325', width: 1325, height: 758, mobile: false },
] as const;

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

function fixture() {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const person = (userId: string, name: string) => ({ kind: 'person', userId, name });
  const pat = person('me', 'Pat');
  const maria = person('u-maria', 'Maria');
  let n = 0;
  const item = (over: Record<string, unknown>) => ({
    id: `a${++n}`, category: 'content', targetType: 'Playlist', targetId: null, subject: null, target: null, targetKey: null, facts: {}, actor: pat, ...over,
  });

  const screens = [
    { id: 'mp', name: 'Venue Media Player', status: 'OFFLINE', screenGroupId: 'g-mp', screenGroup: { id: 'g-mp', name: 'Media Player' }, lastPingAt: ago(41 * H), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.42', renderHealth: 'UNKNOWN', pushChannel: 'stale', orientation: 'PORTRAIT' },
    { id: 't1', name: 'Test 1', status: 'OFFLINE', screenGroupId: 'g-web', screenGroup: { id: 'g-web', name: 'Web App' }, lastPingAt: new Date(now - 79 * D).toISOString(), hardwareModel: 'web', osInfo: 'iOS', playerVersion: null, renderHealth: 'UNKNOWN', pushChannel: 'stale' },
  ];

  // What GET /audit/recent answers now: the allowlist, names resolved.
  const activity = [
    item({ action: 'SCREEN_ORIENTATION_CHANGED', category: 'screens', targetType: 'Screen', targetId: 'mp', subject: 'Venue Media Player', facts: { orientation: 'PORTRAIT' }, createdAt: ago(3 * H) }),
    item({ action: 'SCREEN_ORIENTATION_CHANGED', category: 'screens', targetType: 'Screen', targetId: 'mp', subject: 'Venue Media Player', facts: { orientation: 'AUTO' }, createdAt: ago(3 * H + 2 * MIN) }),
    item({ action: 'SCHEDULE_CREATED', targetType: 'Schedule', subject: 'Fall promo', target: 'Venue Media Player', targetKey: 'mp', createdAt: ago(3 * H + 5 * MIN) }),
    item({ action: 'PLAYLIST_ITEMS_REPLACED', targetId: 'p1', subject: 'Fall promo', createdAt: ago(3 * H + 5 * MIN + 6_000) }),
    item({ action: 'PLAYLIST_CREATED', targetId: 'p1', subject: 'Fall promo', createdAt: ago(3 * H + 5 * MIN + 9_000) }),
    item({ action: 'ASSET_UPLOADED', targetType: 'Asset', targetId: 'f1', subject: 'fall-promo.mp4', actor: maria, createdAt: ago(5 * H) }),
    item({ action: 'ASSET_UPLOADED', targetType: 'Asset', targetId: 'f2', subject: 'menu.jpg', actor: maria, createdAt: ago(5 * H + MIN) }),
    item({ action: 'CLEAR_EMERGENCY_DRILL', category: 'emergency', targetType: 'tenant', facts: { drill: true }, createdAt: ago(D + 2 * H) }),
    item({ action: 'TRIGGER_EMERGENCY_DRILL', category: 'emergency', targetType: 'tenant', facts: { alertType: 'EVACUATE', drill: true, scope: 'tenant' }, createdAt: ago(D + 2 * H + 30_000) }),
    item({ action: 'CLEAR_EMERGENCY', category: 'emergency', targetType: 'tenant', createdAt: ago(D + 3 * H) }),
    item({ action: 'TRIGGER_EMERGENCY', category: 'emergency', targetType: 'tenant', facts: { alertType: 'EVACUATE', scope: 'tenant' }, createdAt: ago(D + 3 * H + 40_000) }),
    item({ action: 'REFRESH_WEB', category: 'screens', targetType: 'screen', targetId: 'mp', targetKey: 'mp', subject: 'Venue Media Player', createdAt: ago(3 * D) }),
    item({ action: 'USER_INVITED', category: 'team', targetType: 'User', subject: 'sam@northwind.example', facts: { role: 'CONTRIBUTOR' }, createdAt: ago(4 * D) }),
  ];

  const attention = {
    generatedAt: new Date(now).toISOString(),
    down: [{ id: 'mp', name: 'Venue Media Player', tenantId: T, location: null, groupName: 'Media Player', lastSeenAt: screens[0].lastPingAt, reason: null }],
    resting: [],
    dormant: [{ id: 't1', name: 'Test 1', tenantId: T, location: null, groupName: 'Web App', lastSeenAt: screens[1].lastPingAt, reason: 'not-seen-30-days' }],
  };

  // What GET /notifications answers a customer now: no push-dead rows, one
  // row per screen, unread only while the screen is still down.
  const notifications = {
    unreadCount: 1,
    items: [
      { id: 'n1', kind: 'SCREEN_OFFLINE', title: 'Screen offline: Venue Media Player', body: `No heartbeat since ${screens[0].lastPingAt}.`, link: '/screens', isRead: false, createdAt: ago(41 * H - 5 * MIN), health: { state: 'offline', reason: null, screenId: 'mp', screenName: 'Venue Media Player', lastSeenAt: screens[0].lastPingAt } },
      { id: 'n2', kind: 'SCREEN_OFFLINE', title: 'Screen offline: Test 1', body: 'No heartbeat since 2026-08-06T19:03:58.372Z.', link: '/screens', isRead: true, createdAt: new Date(now - 79 * D).toISOString(), health: { state: 'dormant', reason: 'not-seen-30-days', screenId: 't1', screenName: 'Test 1', lastSeenAt: screens[1].lastPingAt } },
    ],
  };

  const fleet = {
    root: { id: T, name: 'Northwind Media', slug: T, vertical: 'CORPORATE' },
    locations: [{ id: T, name: 'Northwind Media', slug: T }],
    stats: { total: 2, online: 0, offline: 2, locationCount: 1 },
    screens: screens.map((s) => ({ ...s, sourceTenant: { id: T, name: 'Northwind Media', slug: T } })),
  };
  return { screens, activity, attention, notifications, fleet };
}

async function mockApi(page: Page) {
  const f = fixture();
  await page.route('**/api/v1/**', (route) => {
    const headers = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    let body: unknown = path.endsWith('s') ? [] : {};
    if (path === '/auth/me' || path === '/users/me') body = USER;
    if (path === '/tenants') body = { id: T, name: 'Northwind Media', slug: T, vertical: 'CORPORATE', emergencyStatus: 'INACTIVE', emergencyEnabled: true, emergencyEnabledEffective: true };
    if (path === '/tenants/accessible') body = f.fleet.locations;
    if (path === '/branding/me') body = {};
    if (path === '/screens/fleet') body = f.fleet;
    if (path === '/screens') body = f.screens;
    if (path === '/screens/attention') body = f.attention;
    if (path === '/screen-groups') body = [{ id: 'g-mp', name: 'Media Player' }, { id: 'g-web', name: 'Web App' }];
    if (path === '/playlists') body = [{ id: 'p1', name: 'Fall promo', items: [], schedules: [] }];
    if (path === '/assets') body = [{ id: 'f1', originalName: 'fall-promo.mp4', status: 'PUBLISHED', createdAt: new Date().toISOString() }];
    if (path === '/audit/recent') body = f.activity;
    if (path === '/audit') {
      const category = url.searchParams.get('category');
      const rows = category ? f.activity.filter((a) => a.category === category) : f.activity;
      body = { items: rows, total: rows.length, limit: 50, offset: 0, view: 'activity' };
    }
    if (path === '/users') body = [{ id: 'me', email: USER.email, firstName: 'Pat', role: 'DISTRICT_ADMIN' }, { id: 'u-maria', email: 'maria@northwind.example', firstName: 'Maria', role: 'CONTRIBUTOR' }];
    if (path === '/notifications') body = f.notifications;
    if (path === '/submissions') body = [];
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    localStorage.setItem('edu_dashboard_hint_dismissed', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
}

async function shot(page: Page, name: string, browserName: string, locator?: ReturnType<Page['locator']>) {
  if (!SHOTS) return;
  if (locator) await locator.screenshot({ path: `${SHOTS}/after-${name}-${browserName}.png` });
  else await page.screenshot({ path: `${SHOTS}/after-${name}-${browserName}.png` });
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await mockApi(page);
    });

    test('Home: people\'s activity in sentences, one real outage, the test screen quiet', async ({ page, browserName }) => {
      test.setTimeout(240_000);
      await page.goto(`/${T}/dashboard`, { waitUntil: 'domcontentloaded' });
      const activity = page.getByTestId('recent-activity');
      await activity.waitFor({ timeout: 200_000 });
      await shot(page, `home-top-${vp.name}`, browserName);

      // Sentences, grouped: the publish wizard is one line, the orientation
      // flip reads as its final state, the two uploads are one line.
      await expect(activity.getByText('You created “Fall promo” and published it to “Venue Media Player”')).toBeVisible();
      await expect(activity.getByText('You turned “Venue Media Player” to portrait')).toBeVisible();
      await expect(activity.getByText('Maria uploaded 2 files')).toBeVisible();
      await expect(activity.getByText('You started a Fire / Evacuate drill on every screen')).toBeVisible();
      // Never a backend row, never a raw action name.
      await expect(page.getByText(/Field Build|Ota Push|Player Field Apk|field_build_window/)).toHaveCount(0);
      await activity.scrollIntoViewIfNeeded();
      await shot(page, `recent-activity-${vp.name}`, browserName, activity);

      // The red card holds the real outage only.
      const down = page.getByTestId('screens-down');
      await expect(down).toBeVisible();
      await expect(down.getByText('Venue Media Player')).toBeVisible();
      await expect(down.getByText('Test 1')).toHaveCount(0);
      // The test screen is in the collapsed quiet line.
      const dormant = page.getByTestId('screens-dormant');
      await expect(dormant).toContainText('1 screen not seen in 30+ days');
      await expect(dormant.getByText('Test 1')).toBeHidden();
      await dormant.locator('summary').click();
      await expect(dormant.getByText('Test 1')).toBeVisible();
      await down.scrollIntoViewIfNeeded();
      await shot(page, `screens-down-${vp.name}`, browserName, page.getByTestId('screens-down').locator('xpath=..'));

      // One notification still needs someone.
      if (!vp.mobile) {
        const bell = page.getByRole('button', { name: /Notifications \(1 unread\)/ });
        await expect(bell).toBeVisible();
        await bell.click();
        await expect(page.getByTestId('notification-health').first()).toHaveText(/Still offline/);
        await page.waitForTimeout(300);
        await shot(page, `bell-${vp.name}`, browserName);
      }
    });

    test('Activity page: sentences by day, kinds as chips', async ({ page, browserName }) => {
      test.setTimeout(240_000);
      await page.goto(`/${T}/audit`, { waitUntil: 'domcontentloaded' });
      const list = page.getByTestId('activity-list');
      await list.waitFor({ timeout: 200_000 });
      await expect(list.getByText('You created “Fall promo” and published it to “Venue Media Player”')).toBeVisible();
      await expect(page.getByText(/FIELD_BUILD|OTA_PUSH/)).toHaveCount(0);
      await shot(page, `activity-page-${vp.name}`, browserName);
      await page.getByRole('tab', { name: 'Alerts' }).click();
      await expect(list.getByText('You sent the all-clear')).toBeVisible();
      await expect(list.getByText(/Fall promo/)).toHaveCount(0);
    });
  });
}
