/**
 * Bulk screen actions (2026-10-11) — select all → Resync, end to end on the
 * real Screens page with every API call mocked.
 *
 * Greg: "If I want to manually push a resync, an update of the player, allow
 * me to do a select-all and push — by group at least."
 *
 * Proves, in Chromium AND WebKit (the operator runs Safari and an iPhone):
 *   1. the select-all box selects every screen shown and the bar appears;
 *   2. Resync asks the server for the plan first (dryRun) and sends nothing
 *      until Confirm;
 *   3. the results sheet names the screen that did not go, with its reason;
 *   4. on an iPhone-sized window the group box selects the group and the same
 *      flow works, with no horizontal page scroll.
 */
import { test, expect, type Page } from '@playwright/test';

const SCHOOL = 'bulk-test-school';
const USER = { id: 'bulk-user', email: 'operator@example.test', role: 'SCHOOL_ADMIN', tenantId: SCHOOL, canTriggerPanic: false };
const groups = [
  { id: 'g-lobby', tenantId: SCHOOL, name: 'Lobby', address: null },
  { id: 'g-gym', tenantId: SCHOOL, name: 'Gym', address: null },
];
const now = new Date().toISOString();
const screen = (id: string, name: string, group: typeof groups[number] | null) => ({
  id, name, tenantId: SCHOOL, status: 'ONLINE', screenGroupId: group?.id ?? null, screenGroup: group,
  hardwareModel: 'Test LCD', resolution: '1920x1080', lastPingAt: now, renderHealth: 'OK', renderStale: false,
  lastRenderedAt: now, lastRenderedHash: 'idle:no-content', pushChannel: 'live', authState: 'PROVEN',
});
const screens = [
  screen('s-lobby-1', 'Lobby Left', groups[0]),
  screen('s-lobby-2', 'Lobby Right', groups[0]),
  screen('s-gym-1', 'Gym Scoreboard', groups[1]),
  screen('s-front', 'Front Desk', null),
];

type BulkBody = { screenIds?: string[]; dryRun?: boolean };

async function open(page: Page, width: number) {
  const bulkCalls: Array<{ path: string; body: BulkBody }> = [];
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
    if (apiPath === '/tenants') body = { id: SCHOOL, name: 'Bulk Test School', vertical: 'EDU' };
    if (apiPath === '/tenants/accessible') body = { current: SCHOOL, tenants: [{ id: SCHOOL, slug: SCHOOL, name: 'Bulk Test School' }] };
    if (apiPath === '/branding/me') body = { displayName: 'Bulk Test School', primaryColor: '#4f46e5' };
    if (apiPath === '/screens') body = screens;
    if (apiPath === '/screen-groups') body = groups;
    if (apiPath.startsWith('/screens/bulk/') && req.method() === 'POST') {
      const b = (req.postDataJSON() ?? {}) as BulkBody;
      bulkCalls.push({ path: apiPath, body: b });
      const results = (b.screenIds ?? []).map((id) => {
        const name = screens.find((s) => s.id === id)?.name ?? null;
        // The Front Desk screen's push does not go — the sheet must say so.
        return !b.dryRun && id === 's-front'
          ? { screenId: id, name, outcome: 'failed', reason: 'not-delivered' }
          : { screenId: id, name, outcome: 'sent' };
      });
      const summary = { requested: results.length, sent: 0, skipped: 0, failed: 0 } as Record<string, number>;
      for (const r of results) summary[r.outcome] += 1;
      body = { action: 'resync', dryRun: !!b.dryRun, corrId: b.dryRun ? null : 'rw-bulk-e2e', summary, results };
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
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  await page.goto(`/${SCHOOL}/screens`, { waitUntil: 'domcontentloaded' });
  return bulkCalls;
}

test('desktop: select all → Resync → plan → confirm → per-screen results', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = await open(page, 1325);

  const selectAll = page.getByTestId('screens-select-all');
  await expect(selectAll).toBeVisible({ timeout: 90_000 });
  // click, not check(): once anything is selected the heading box gives way to the bar.
  await selectAll.click();
  const bar = page.getByTestId('screens-bulk-bar');
  await expect(bar.getByTestId('screens-bulk-count')).toHaveText('4 screens selected');

  await bar.getByTestId('screens-bulk-resync').click();
  const sheet = page.getByTestId('screens-bulk-sheet');
  await expect(sheet.getByRole('heading')).toHaveText('Resync 4 screens?');
  await expect(sheet.getByText('4 screens will get it')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/screens/bulk/resync');
  expect(calls[0].body.dryRun).toBe(true);
  expect([...(calls[0].body.screenIds ?? [])].sort()).toEqual(['s-front', 's-gym-1', 's-lobby-1', 's-lobby-2']);

  await sheet.getByTestId('screens-bulk-confirm').click();
  await expect(sheet.getByTestId('screens-bulk-summary')).toHaveText('3 sent · 0 skipped · 1 failed');
  expect(calls[1].body.dryRun).toBe(false);
  const failed = sheet.getByTestId('screens-bulk-failed');
  await expect(failed.getByText('Front Desk')).toBeVisible();
  await expect(failed.getByText('could not be delivered')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('iPhone: the group box selects the group; the same sheet; no sideways scroll', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = await open(page, 390);
  const groupBox = page.getByTestId('screens-select-group-g-lobby-m');
  await expect(groupBox).toBeVisible({ timeout: 90_000 });
  await groupBox.check();
  const bar = page.getByTestId('screens-bulk-bar');
  await expect(bar.getByTestId('screens-bulk-count')).toHaveText('2 screens selected');
  await bar.getByTestId('screens-bulk-resync').click();
  const sheet = page.getByTestId('screens-bulk-sheet');
  await expect(sheet.getByText('2 screens will get it')).toBeVisible();
  expect([...(calls[0].body.screenIds ?? [])].sort()).toEqual(['s-lobby-1', 's-lobby-2']);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
