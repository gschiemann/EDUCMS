/**
 * Scheduled restart (2026-11-08) — the group ⋮ menu → "Scheduled restart…"
 * sheet on the real Screens page, every API call mocked (fictional names; the
 * repo is public). Proves the entry is reachable from the route, that the
 * sheet says which screens cannot restart and shows "Didn't come back after
 * its scheduled restart", that Save sends the policy, and that a phone has no
 * sideways scroll. With SR_SHOTS=<dir> it writes the screenshots.
 *
 *   E2E_BASE=http://localhost:3100 SR_SHOTS=<dir> \
 *     pnpm --filter web exec playwright test -c playwright.sandbox.config.ts \
 *     tests/e2e/scheduled-restart.spec.ts --project=webkit
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import { emptyDistrictReadiness, emptyScreenEvents, screenEventsScreenId } from '../fixtures/api-contract';

const SCHOOL = 'restart-test-school';
const SHOTS = process.env.SR_SHOTS || '';
const USER = { id: 'restart-user', email: 'operator@example.test', role: 'SCHOOL_ADMIN', tenantId: SCHOOL, canTriggerPanic: false };
const groups = [{ id: 'g-gym', tenantId: SCHOOL, name: 'North Gym', address: null }];
const now = new Date().toISOString();
const screen = (id: string, name: string, model: string) => ({
  id, name, tenantId: SCHOOL, status: 'ONLINE', screenGroupId: 'g-gym', screenGroup: groups[0],
  hardwareModel: model, resolution: '1920x1080', lastPingAt: now, renderHealth: 'OK', renderStale: false,
  lastRenderedAt: now, lastRenderedHash: 'idle:no-content', pushChannel: 'live', authState: 'PROVEN',
});
const screens = [
  screen('s-1', 'Gym Entrance', 'Goodview GUQ'),
  screen('s-2', 'Scoreboard Left', 'Goodview GUQ'),
  screen('s-3', 'Concessions', 'Goodview EP6N'),
];
const t = (mins: number) => new Date(Date.parse('2026-11-08T09:00:00Z') + mins * 60_000).toISOString();
const restartState = (policy: unknown) => ({
  disabled: false,
  policy,
  screens: [
    { id: 's-1', name: 'Gym Entrance', hardwareClass: 'goodview guq', canRestart: true, restartedRecently: false,
      lastRun: { status: 'BACK', reason: null, scheduledFor: t(0), dispatchedAt: t(12), returnedAt: t(14), restartProven: true } },
    { id: 's-2', name: 'Scoreboard Left', hardwareClass: 'goodview guq', canRestart: true, restartedRecently: false,
      lastRun: { status: 'NOT_BACK', reason: null, scheduledFor: t(0), dispatchedAt: t(20), returnedAt: null, restartProven: false } },
    { id: 's-3', name: 'Concessions', hardwareClass: 'goodview ep6n', canRestart: false, restartedRecently: true,
      lastRun: { status: 'SKIPPED', reason: 'cannot-restart', scheduledFor: t(0), dispatchedAt: null, returnedAt: null, restartProven: false } },
  ],
});

async function open(page: Page, finalWidth: number, finalHeight: number) {
  const width = 1325;
  const height = 758;
  const puts: unknown[] = [];
  let policy: unknown = { id: 'p1', cadence: 'WEEKLY', dayOfWeek: 0, time: '03:00', isActive: true };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url() || 'http://localhost').origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const apiPath = new URL(req.url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (apiPath === '/auth/me') body = USER;
    if (apiPath === '/tenants') body = { id: SCHOOL, name: 'Restart Test School', vertical: 'EDU' };
    if (apiPath === '/tenants/accessible') body = { current: SCHOOL, tenants: [{ id: SCHOOL, slug: SCHOOL, name: 'Restart Test School' }] };
    if (apiPath === '/branding/me') body = { displayName: 'Restart Test School', primaryColor: '#4f46e5' };
    if (apiPath === '/screens') body = screens;
    if (apiPath === '/screen-groups') body = groups;
    if (apiPath === '/emergency/readiness/district') body = emptyDistrictReadiness();
    const eventsScreen = screenEventsScreenId(apiPath);
    if (eventsScreen) body = emptyScreenEvents(eventsScreen);
    if (apiPath === '/scheduled-reboots/groups/g-gym') {
      if (req.method() === 'PUT') {
        const b = req.postDataJSON();
        puts.push(b);
        policy = { id: 'p1', isActive: true, ...b };
        body = policy;
      } else {
        body = restartState(policy);
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.route('**/api/build-info', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((user) => {
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
    const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem('edu_cms_token', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
  }, USER);
  await page.setViewportSize({ width, height });
  await page.goto(`/${SCHOOL}/screens`, { waitUntil: 'domcontentloaded' });
  const kebab = page.getByRole('button', { name: 'More actions for North Gym' }).first();
  await expect(kebab).toBeVisible({ timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `screens-${width}.png`) });
  await kebab.click();
  const item = page.getByTestId('group-scheduled-restart-g-gym').first();
  await expect(item).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `group-menu-${width}.png`) });
  await item.click();
  const sheet = page.getByTestId('scheduled-restart-modal');
  await expect(sheet).toBeVisible();
  // The phone list has no group ⋮ for a group WITH screens (only for an empty
  // group) — true of the on/off schedule entry too. So the phone shot opens
  // the sheet at desktop width and then narrows the window to the phone.
  if (finalWidth !== width) await page.setViewportSize({ width: finalWidth, height: finalHeight });
  return { sheet, puts };
}

for (const [w, h] of [[1325, 758], [390, 844]] as const) {
  test(`scheduled restart sheet at ${w}x${h}`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const { sheet, puts } = await open(page, w, h);

    await expect(sheet.getByRole('heading', { name: 'Scheduled restart' })).toBeVisible();
    await expect(sheet.getByRole('radio', { name: 'Once a week' })).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.getByText("Didn't come back after its scheduled restart")).toBeVisible();
    await expect(sheet.getByTestId('scheduled-restart-cannot')).toHaveText("1 of 3 screens can't restart remotely and will be skipped.");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sheet-weekly-${w}.png`) });

    await sheet.getByRole('radio', { name: 'Every night' }).click();
    await sheet.getByTestId('scheduled-restart-save').click();
    await expect(sheet.getByRole('status')).toContainText('every night at');
    expect(puts).toEqual([{ cadence: 'DAILY', dayOfWeek: null, time: '03:00', isActive: true }]);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sheet-saved-${w}.png`) });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
