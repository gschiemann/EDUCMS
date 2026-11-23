import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  emptyDistrictReadiness,
  emptyScreenEvents,
  playbackCapabilityScreenId,
  screenEventsScreenId,
  unknownPlaybackCapability,
} from '../fixtures/api-contract';

/**
 * The dashboard's spell-check default (src/lib/spellcheck-default.ts, mounted
 * by DashboardLayout). Owner, 2026-11-23: "even when I'm typing like the
 * screen group names … some type of spell check that was just built in".
 *
 * In a real browser: a word field gets `spellcheck="true"` on focus (and the
 * engine reports `element.spellcheck === true`), a code/URL field that says
 * `spellCheck={false}` stays off, and a screen surface (/player) installs
 * nothing at all. Every API call is mocked; the company is synthetic.
 */

const HQ = 'spellcheck-test-hq';
const USER = { id: 'spellcheck-test-user', email: 'operator@example.test', role: 'DISTRICT_ADMIN', tenantId: HQ };
const location = { id: HQ, slug: HQ, name: 'Spellcheck Test Co', latitude: 39.74, longitude: -104.99 };
const screen = {
  id: 'spellcheck-screen', name: 'Lobby screen', tenantId: HQ, status: 'ONLINE', sourceTenant: location,
  screenGroupId: null, screenGroup: null, hardwareModel: 'Test LCD', resolution: '1920x1080', osInfo: 'Test OS',
  ipAddress: '192.0.2.10', lastPingAt: new Date().toISOString(), renderHealth: 'OK', renderStale: false,
  lastRenderedAt: new Date().toISOString(), lastRenderedHash: 'idle:no-content',
  effectiveLatitude: location.latitude, effectiveLongitude: location.longitude, geoSource: 'tenant',
};
const fleet = {
  root: { ...location, vertical: 'CORPORATE' }, locations: [location], screens: [screen],
  stats: { total: 1, online: 1, offline: 0, locationCount: 1 },
  operations: { groups: [], schedules: [], playlists: [] },
};

async function mockApi(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.route('**/api/v1/**', (route) => {
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const apiPath = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (apiPath === '/auth/me') body = USER;
    if (apiPath === '/tenants') body = fleet.root;
    if (apiPath === '/tenants/accessible') body = { current: HQ, tenants: [location] };
    if (apiPath === '/branding/me') body = { displayName: location.name };
    if (apiPath === '/screens/fleet') body = fleet;
    if (apiPath === '/screens') body = [screen];
    if (apiPath === '/screens/fleet-pulse') body = { fleet: [], locations: {} };
    if (apiPath === '/emergency/readiness/district') body = emptyDistrictReadiness();
    if (apiPath === '/submissions/pending-counts') body = { byTenant: [], total: 0 };
    if (apiPath === '/deployments') body = { deployments: [] };
    const playbackScreen = playbackCapabilityScreenId(apiPath);
    if (playbackScreen) body = unknownPlaybackCapability(playbackScreen);
    const eventsScreen = screenEventsScreenId(apiPath);
    if (eventsScreen) body = emptyScreenEvents(eventsScreen);
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
}

async function signIn(page: Page) {
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
}

/** The attribute and the engine's own verdict, read after focusing the field. */
async function spellState(field: Locator) {
  await field.focus();
  await expect(field).toBeFocused();
  return field.evaluate((el) => ({ attr: el.getAttribute('spellcheck'), on: (el as HTMLElement).spellcheck }));
}

/** Append a bare text input (no spellcheck attribute), focus it, report what the page did to it. */
async function probe(page: Page) {
  return page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'spellcheck probe');
    document.body.appendChild(input);
    input.focus();
    const state = { focused: document.activeElement === input, attr: input.getAttribute('spellcheck') };
    input.remove();
    return state;
  });
}

test('dashboard word fields get spell check on focus; code fields stay off; a screen route installs nothing', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Chromium only for now: WebKit has not been run against this spec yet; the unit suite covers the rules.');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockApi(page);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/${HQ}/screens`, { waitUntil: 'domcontentloaded' });

  // The screen group name — the owner's own example.
  await page.getByRole('button', { name: 'New group', exact: true }).click({ timeout: 90_000 });
  const groupName = page.getByLabel('New group name', { exact: true });
  // The field renders with no spellCheck prop and `autoFocus`, so the focus
  // that opened it is what turned spell check on.
  await expect(groupName).toBeFocused();
  await expect(groupName).toHaveAttribute('spellcheck', 'true');
  await groupName.fill('Cafateria');
  expect(await spellState(groupName)).toEqual({ attr: 'true', on: true });
  await page.screenshot({ path: info.outputPath('spellcheck-group-name.png') });

  // The address field in the same form says spellCheck={false}: it stays off.
  expect(await spellState(page.locator('#new-group-address'))).toEqual({ attr: 'false', on: false });
  await groupName.focus();
  await groupName.press('Escape');
  await expect(groupName).toHaveCount(0);

  // Pairing: the code is a code (spellCheck={false} since this change); the
  // optional screen name is words.
  await page.getByRole('button', { name: 'Pair screen', exact: true }).click();
  const pairCode = page.locator('#pair-code-input');
  await expect(pairCode).toBeVisible();
  expect(await spellState(pairCode)).toEqual({ attr: 'false', on: false });
  expect(await spellState(page.locator('#pair-name-input'))).toEqual({ attr: 'true', on: true });

  // Positive control for the probe used on the screen route below.
  expect(await probe(page)).toEqual({ focused: true, attr: 'true' });

  // A screen surface: /player never imports the installer.
  await page.goto('/player?fp=spellcheck-probe-0000');
  // With every API call mocked, the player lands on its pairing screen: client
  // state, so React has mounted and any mount-time installer would have run.
  await expect(page.getByText('Waiting for pairing')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('group', { name: 'Screen orientation' })).toBeVisible();
  expect(await probe(page)).toEqual({ focused: true, attr: null });

  expect(errors).toEqual([]);
});
