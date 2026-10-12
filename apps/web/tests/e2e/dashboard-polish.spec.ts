/**
 * Dashboard polish (2026-10-12, owner feedback before the launch) in a REAL
 * browser — chromium + webkit, at the owner's Safari size (1325×758) and an
 * iPhone (390×844):
 *
 *   1. the fleet map's live summary (replaced the static "Status guide");
 *   2. Settings → Emergency: every alert-content card shares one style;
 *   3. Settings → People: a person row never paints text over text;
 *   4. Settings: headers are one sentence, the rest behind "Learn more".
 *
 * Every API call is intercepted; nothing touches a database. Set
 * `POLISH_SHOTS=<dir>` to also save a screenshot of each page.
 */
import { test, expect, type Page } from '@playwright/test';

const HQ = 'polish-hq';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const SHOTS = process.env.POLISH_SHOTS;
const USER = { id: 'me', email: 'owner@example.test', role: 'DISTRICT_ADMIN', tenantId: HQ, canTriggerPanic: true };

const VIEWPORTS = [
  { name: 'safari-1325', width: 1325, height: 758 },
  { name: 'iphone-390', width: 390, height: 844 },
] as const;

const scr = (id: string, tenant: string, lat: number, lng: number, over: Record<string, unknown> = {}) => ({
  id, name: id, status: 'ONLINE', screenGroup: null,
  sourceTenant: { id: tenant, name: tenant, slug: tenant },
  effectiveLatitude: lat, effectiveLongitude: lng, effectiveAddress: 'Test address',
  renderHealth: 'OK', renderStale: false, renderStaleSeconds: 10, pushChannel: 'live',
  lastPingAt: new Date(Date.now() - 30_000).toISOString(), lastCacheReport: null,
  ...over,
});

const fleet = {
  root: { id: HQ, name: 'Polish Test Co', slug: HQ, vertical: 'CORPORATE' },
  locations: [
    { id: HQ, name: 'Polish Test Co', slug: HQ },
    { id: 'houston', name: 'Houston', slug: 'houston', latitude: 29.76, longitude: -95.37, address: '1 Main St, Houston, TX' },
    { id: 'chicago', name: 'Chicago', slug: 'chicago', latitude: 41.88, longitude: -87.63, address: '1 State St, Chicago, IL' },
    { id: 'denver', name: 'Denver', slug: 'denver', latitude: 39.74, longitude: -104.99, address: '1 Colfax, Denver, CO' },
  ],
  stats: { total: 7, online: 5, offline: 2, locationCount: 4 },
  screens: [
    scr('hou-1', 'houston', 29.76, -95.37, { status: 'OFFLINE', lastPingAt: new Date(Date.now() - 3 * 3600_000).toISOString() }),
    scr('hou-2', 'houston', 29.76, -95.37, { status: 'OFFLINE', lastPingAt: new Date(Date.now() - 2 * 3600_000).toISOString() }),
    scr('hou-3', 'houston', 29.76, -95.37),
    scr('chi-1', 'chicago', 41.88, -87.63),
    scr('chi-2', 'chicago', 41.88, -87.63, { renderHealth: 'STALE', renderStale: true }),
    scr('den-1', 'denver', 39.74, -104.99),
    scr('den-2', 'denver', 39.74, -104.99),
  ],
};

const base = { firstName: null, lastName: null, mfaRequired: false, mfaEnrolled: false, status: 'ACTIVE', canTriggerPanic: false, mfaMethods: [] };
const USERS = [
  { ...base, id: 'u-admin', firstName: 'Alexandra', lastName: 'Montgomery-Whitfield', email: 'alexandra.montgomery-whitfield@example.test', role: 'SCHOOL_ADMIN', mfaRequired: true, mfaEnrolled: true, mfaMethods: ['passkey'], extraLocationCount: 3, screenLimited: true },
  { ...base, id: 'u-editor', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.test', role: 'CONTRIBUTOR' },
  { ...base, id: 'u-viewer', email: 'viewer@example.test', role: 'RESTRICTED_VIEWER', status: 'INVITED' },
];

const ACCESS = {
  user: { id: 'u-editor', email: 'sam@example.test', role: 'CONTRIBUTOR', homeTenantId: 'houston' },
  scopable: true,
  canEditLocations: true,
  locations: [
    { id: 'houston', name: 'Houston', isHome: true, granted: true, scopeEditable: true },
    { id: 'chicago', name: 'Chicago', isHome: false, granted: true, scopeEditable: true },
    { id: 'cincinnati', name: 'Cincinnati', isHome: false, granted: true, scopeEditable: true },
    { id: 'denver', name: 'Denver', isHome: false, granted: true, scopeEditable: true },
  ],
  screenScopes: {},
  options: {
    houston: { screens: [{ id: 'hou-1', name: 'Lobby', screenGroupId: null }], groups: [{ id: 'g1', name: 'Front of house' }] },
    chicago: { screens: [], groups: [] },
    cincinnati: { screens: [], groups: [] },
    denver: { screens: [], groups: [] },
  },
};

async function mockApi(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const headers = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
    let body: unknown = path.endsWith('s') ? [] : {};
    if (path === '/auth/me') body = USER;
    if (path === '/tenants') body = { id: HQ, name: 'Polish Test Co', slug: HQ, vertical: 'CORPORATE', emergencyStatus: 'INACTIVE', emergencyEnabled: true, emergencyEnabledEffective: true, emergencyEnabledLocked: false };
    if (path === '/tenants/accessible') body = fleet.locations;
    if (path === '/branding/me') body = { displayName: 'Polish Test Co', primaryColor: '#4f46e5' };
    if (path === '/screens/fleet') body = fleet;
    if (path === '/screens/fleet-pulse') body = { fleet: [], locations: {} };
    if (path === '/emergency/readiness/district') body = { schools: [], notReadyCount: 0, delivery: { key: 'delivery', status: 'ok' } };
    if (path === '/submissions/pending-counts') body = { byTenant: [], total: 0 };
    if (path === '/deployments') body = { deployments: [] };
    if (path === '/users') body = USERS;
    if (/^\/users\/[^/]+\/access$/.test(path)) body = ACCESS;
    if (path.startsWith('/panic-content/')) body = { items: [] };
    if (path === '/emergency/readiness') {
      body = { verdict: 'READY', score: 100, computedAt: new Date().toISOString(), items: [
        { key: 'content', status: 'ok', label: 'Alert content wired', detail: '6 of 6 alert types have content.', fixHint: '' },
      ] };
    }
    if (path === '/audit') body = { items: [], total: 0, limit: 1, offset: 0 };
    if (path === '/audit/recent') body = [];
    if (path === '/tenants/me/location-based-emergency') body = { enabled: false };
    if (path === '/tenants/me/content-approval') body = { enabled: false };
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
}

async function shot(page: Page, name: string, browserName: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}-${browserName}.png`, fullPage: true });
}

/** No two of these boxes may overlap (a 1px hairline is tolerated). */
async function expectNoOverlap(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlapX = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const overlapY = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      expect(overlapX > 1 && overlapY > 1, `boxes ${i} and ${j} overlap: ${JSON.stringify([a, b])}`).toBe(false);
    }
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await mockApi(page);
    });

    test('fleet map: the live summary counts what the map shows', async ({ page, browserName }) => {
      test.setTimeout(150_000);
      await page.goto(`/${HQ}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'map', exact: true }).click({ timeout: 120_000 });
      await page.locator('.leaflet-container').waitFor();
      const summary = page.getByTestId('fleet-live-summary').filter({ visible: true });
      await expect(summary).toBeVisible();
      await expect(summary.getByText('7 screens')).toBeVisible();
      await expect(summary.getByText('4 playing')).toBeVisible();
      await expect(summary.getByRole('button', { name: /2 offline \(since 3 hours ago\)/ })).toBeVisible();
      await expect(summary.getByRole('button', { name: /2 screens offline at Houston — check power and network/ })).toBeVisible();
      await expect(page.getByText('Status guide')).toHaveCount(0);
      await summary.scrollIntoViewIfNeeded();
      await shot(page, `fleet-map-${vp.name}`, browserName);
      if (SHOTS) await summary.screenshot({ path: `${SHOTS}/fleet-live-summary-${vp.name}-${browserName}.png` });
      await summary.getByRole('button', { name: /2 offline/ }).click();
      await expect(summary.getByText('3 screens')).toBeVisible();
      await shot(page, `fleet-map-filtered-offline-${vp.name}`, browserName);
    });

    test('settings/emergency: drill cards share one neutral style', async ({ page, browserName }) => {
      test.setTimeout(150_000);
      await page.goto(`/${HQ}/settings/emergency`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('emergency-content-tab-drill').click({ timeout: 120_000 });
      const cards = page.locator('[data-alert-content-card][data-alert-content-mode="drill"]');
      await expect(cards).toHaveCount(6);
      const backgrounds = await cards.evaluateAll((els) => els.map((e) => {
        const cs = getComputedStyle(e);
        return `${cs.backgroundColor}|${cs.borderTopColor}`;
      }));
      expect(new Set(backgrounds).size).toBe(1);
      await page.locator('#emergency-content').scrollIntoViewIfNeeded();
      await shot(page, `settings-emergency-drill-${vp.name}`, browserName);
    });

    test('settings/people: a person row never paints text over text', async ({ page, browserName }) => {
      test.setTimeout(150_000);
      await page.goto(`/${HQ}/settings/people`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('li', { hasText: 'alexandra.montgomery-whitfield@example.test' }).first();
      await row.waitFor({ timeout: 120_000 });
      // Every pill, the role select and every action button in the row.
      await expectNoOverlap(page, `li:has-text("alexandra.montgomery-whitfield@example.test") :is(button, select, span.rounded-full)`);
      await shot(page, `settings-people-${vp.name}`, browserName);
      // The scope editor says the limit rule once and folds empty locations.
      const sam = page.locator('li', { hasText: 'sam@example.test' }).first();
      await sam.getByRole('button', { name: /Locations & screens/ }).click();
      await expect(page.getByText('No screens yet: Chicago, Cincinnati, Denver')).toBeVisible();
      await expect(page.getByText(/Emergency alerts are never limited/)).toHaveCount(1);
      await sam.scrollIntoViewIfNeeded();
      await shot(page, `settings-people-access-${vp.name}`, browserName);
    });
  });
}
