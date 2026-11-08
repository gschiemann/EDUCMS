import { test, expect, type Page } from '@playwright/test';
import {
  emptyDistrictReadiness,
  emptyScreenEvents,
  playbackCapabilityScreenId,
  screenEventsScreenId,
  unknownPlaybackCapability,
} from '../fixtures/api-contract';

/**
 * Companion health in the screen drawer (2026-11-08, Manager deep dive §5
 * item 1). Opens the REAL /<slug>/screens route (the drawer's mount — CLAUDE.md
 * §11 reachability), opens each screen's drawer → Technical details → Device,
 * and checks the companion row, once per state. Synthetic tenant only; every
 * API answer is mocked and no write reaches anything.
 *
 * Screenshots: set COMPANION_SHOTS=<dir> to save one PNG per state and size.
 */
const T = 'company-test-hq';
const USER = { id: 'test-user', email: 'operator@example.test', role: 'SCHOOL_ADMIN', tenantId: T };
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const health = (over: Record<string, unknown> = {}) => ({
  schema: 1, reportedAt: iso(now - 2 * MIN), version: '1.1.66-field.1',
  watchdogTickAt: iso(now - 2 * MIN - 10_000), relaunches: { total: 0, recent: [] },
  rollback: null, quarantined: [], installPermission: true, installTapPendingSince: null, ...over,
});

const STATES = {
  healthy: { health: health(), expect: 'Companion healthy' },
  restarts: {
    health: health({ relaunches: { total: 2, recent: [
      { at: iso(now - 3 * DAY), reason: 'player-unresponsive' }, { at: iso(now - DAY), reason: 'player-unresponsive' },
    ] } }),
    expect: 'Companion healthy · restarted the player 2 times this week (it stopped responding)',
  },
  tap: { health: health({ installTapPendingSince: iso(now - 7 * MIN) }), expect: 'Waiting for an Install tap on the panel' },
  silent: { health: health({ watchdogTickAt: iso(now - 45 * MIN) }), expect: 'Companion not reporting since' },
  quarantined: { health: health({ quarantined: [10165] }), expect: 'Holding back 1 player build that failed to start' },
  legacy: { health: null, expect: null },
} as const;
type StateName = keyof typeof STATES;

const screenFor = (name: StateName) => ({
  id: `scr-${name}`, name: `Hallway ${name}`, tenantId: T, status: 'ONLINE',
  screenGroupId: null, screenGroup: null, hardwareModel: 'Test LCD', resolution: '1920x1080', osInfo: 'Android 13',
  ipAddress: '192.0.2.10', lastPingAt: iso(now - 5_000), renderHealth: 'OK', renderStale: false,
  lastRenderedAt: iso(now - 10_000), lastRenderedHash: 'idle:no-content', pushChannel: 'live',
  playerVersion: '1.1.66-field.1', managerVersion: name === 'legacy' ? '1.0.24' : '1.1.66-field.1',
  managerHealth: STATES[name].health, managerHealthAt: STATES[name].health?.reportedAt ?? null,
});

async function openScreens(page: Page, width: number, height: number) {
  const screens = (Object.keys(STATES) as StateName[]).map(screenFor);
  const root = { id: T, slug: T, name: 'Test School', vertical: 'K12' };
  const fleet = {
    root, locations: [root], screens, stats: { total: screens.length, online: screens.length, offline: 0, locationCount: 1 },
    operations: { groups: [], schedules: [], playlists: [] },
  };
  await page.route('**/api/v1/**', (route) => {
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const apiPath = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (apiPath === '/auth/me') body = USER;
    if (apiPath === '/tenants') body = root;
    if (apiPath === '/tenants/accessible') body = { current: T, tenants: [root] };
    if (apiPath === '/branding/me') body = { displayName: 'Test School', primaryColor: '#4f46e5' };
    if (apiPath === '/screens/fleet') body = fleet;
    if (apiPath === '/screens') body = screens;
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
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
  await page.setViewportSize({ width, height });
  await page.goto(`/${T}/screens`, { waitUntil: 'domcontentloaded' });
}

for (const [label, width, height] of [['desktop', 1325, 758], ['phone', 390, 844]] as const) {
  test(`companion row in the drawer — every state (${label})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openScreens(page, width, height);
    for (const name of Object.keys(STATES) as StateName[]) {
      const screenName = `Hallway ${name}`;
      await page.getByRole('button', { name: new RegExp(`^${screenName}( |$)`) }).locator('visible=true').first().click({ timeout: 90_000 });
      const drawer = page.getByRole('dialog', { name: new RegExp(screenName) });
      await drawer.getByTestId('screen-technical-details').getByText('Technical details').click();
      const card = drawer.getByTestId('screen-device-card');
      await expect(card).toBeVisible();
      const row = card.locator('[data-device-fact="companion"]');
      const want = STATES[name].expect;
      if (want) await expect(row).toContainText(want);
      else {
        await expect(row).toHaveCount(0);
        await expect(card.locator('[data-device-fact="player"]')).toContainText('Manager 1.0.24');
      }
      await card.scrollIntoViewIfNeeded();
      const dir = process.env.COMPANION_SHOTS;
      if (dir) {
        await page.screenshot({ path: `${dir}/${info.project.name}-${label}-${width}x${height}-${name}.png` });
      }
      await drawer.getByRole('button', { name: 'Close details' }).click();
      await expect(drawer).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
