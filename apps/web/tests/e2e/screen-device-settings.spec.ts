import { test, expect, type Page } from '@playwright/test';

/**
 * Android settings in the screen drawer (2026-10-18; API:
 * apps/api/src/device-settings/, player: settings/ package).
 *
 * The section must show a control only where the unit says it can set the
 * setting, say "Not possible on this unit: <reason>" everywhere else, show
 * what Android READ BACK, store a change with exactly one PUT — and fit a
 * phone without horizontal scrolling.
 */

const USER = { id: 'device-settings-user', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-ds', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const GROUP = { id: 'group-one', name: 'Front office', address: null };

const SCREEN = {
  id: 'GUQ55', name: 'GUQ55', status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
  osInfo: 'Android 13', hardwareModel: 'unknown', playerVersion: '1.1.43', managerVersion: '1.0.25',
  lastPingAt: new Date().toISOString(), authState: 'PROVEN',
  forceApkUpdatePendingAt: null, forceApkUpdateHold: null, lastOtaState: null, lastOtaAt: null,
};

const now = Date.now();
const VIEW = {
  screenId: 'GUQ55',
  faceOfScreenId: null,
  revision: 3,
  desired: {
    screenOffTimeoutMs: { value: 2_147_483_647, id: 'r3', changedAt: new Date(now - 3_600_000).toISOString() },
  },
  report: {
    schema: 1, rev: 3, sdk: 33,
    cap: {
      brightness: 'ok', volume: 'ok', screenOffTimeoutMs: 'ok', attentiveTimeoutMs: 'no-secure-settings', rotationLock: 'ok',
      autoTime: 'no-secure-settings', autoTimeZone: 'no-secure-settings', ntpServer: 'no-secure-settings', wifi: 'ok',
    },
    obs: { brightness: 70, volume: 40, screenOffTimeoutMs: 2_147_483_647, rotationLock: false, ntpServer: '', wifi: { ssid: null, approval: 'unknown' } },
    ack: { screenOffTimeoutMs: { id: 'r3', st: 'applied', n: 1, at: now - 3_000_000 } },
    load: { thermal: 0, headroom: 0.2, cpu: 9, memAvailMb: 1420, memTotalMb: 3870, socC: 54, zones: 3 },
  },
  reportChangedAt: new Date(now - 120_000).toISOString(),
  reportedAt: new Date(now - 30_000).toISOString(),
};

async function openScreens(page: Page) {
  const state = { puts: [] as Array<Record<string, unknown>>, view: structuredClone(VIEW) as typeof VIEW & { desired: Record<string, unknown> } };
  await page.addInitScript(({ user, token }) => {
    sessionStorage.setItem('edu_cms_token', token);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
  }, { user: USER, token });
  await page.route(/^http:\/\/api\.invalid\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/screens/GUQ55/device-settings') {
      if (req.method() === 'PUT') {
        const patch = JSON.parse(req.postData() || '{}');
        state.puts.push(patch);
        const revision = state.view.revision + 1;
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete state.view.desired[k];
          else state.view.desired[k] = { value: v, id: `r${revision}`, changedAt: new Date().toISOString() };
        }
        state.view.revision = revision;
        return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify({ ...state.view, changed: Object.keys(patch) }) });
      }
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(state.view) });
    }
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/branding/me': {},
      '/tenants': [{ id: USER.tenantId, name: 'Device settings', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Device settings', slug: USER.tenantId }],
      '/screens': [SCREEN],
      '/screen-groups': [GROUP],
      '/schedules': [], '/playlists': [],
      '/emergency/readiness/district': { schools: [], notReadyCount: 0, computedAt: new Date().toISOString() },
      '/player/latest-version': { versionName: '1.1.43', versionCode: 10143, managerVersionName: '1.0.25' },
      '/screens/hardware-catalog': { models: [] },
      '/screens/hardware': { models: [] },
    };
    const body = path.endsWith('/device-inventory') ? { report: null, reportedAt: null }
      : path.endsWith('/events') ? { events: [] }
        : path.endsWith('/faces') ? { faces: [] }
          : path.endsWith('/playback-capability') ? {
            screenId: path.split('/')[2], summary: 'unknown', declared: null, files: [], demotions: [],
            capability: {
              deviceClass: null, maxShortEdge: null, stuttersAtShortEdge: null, maxFps: null, maxUnitConcurrentVideos: null,
              evidence: 'unknown', concurrencyEvidence: 'unknown', evidenceAt: null, classScreens: 0, stale: false,
            },
          }
            : bodies[path] ?? [];
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.goto('/e2e-ds/screens');
  await expect(page.locator(':text-is("GUQ55"):visible').first()).toBeVisible();
  return state;
}

async function openAndroidSettings(page: Page) {
  // Desktop renders the row as a button named exactly "GUQ55"; a phone renders
  // a card whose button name starts with it.
  await page.getByRole('button', { name: /^GUQ55\b/ }).first().click();
  const drawer = page.getByRole('dialog').first();
  await drawer.getByRole('tab', { name: 'Settings', exact: true }).click();
  const section = drawer.getByTestId('device-settings-section');
  await section.getByRole('button', { name: 'Android settings' }).click();
  await expect(section.getByLabel('Brightness')).toBeVisible();
  return section;
}

test('controls only where the unit can set it, the reason elsewhere, and one PUT per change', async ({ page }, info) => {
  const state = await openScreens(page);
  const section = await openAndroidSettings(page);

  await expect(section.getByTestId('device-setting-brightness')).toContainText('Android reports 70%');
  await expect(section.getByTestId('device-setting-screenOffTimeoutMs')).toContainText('Set on the screen');
  await expect(section.getByText('Not possible on this unit: needs the one-time install command (adb) on this unit')).toHaveCount(4);
  await expect(section.getByRole('combobox', { name: 'Automatic date & time' })).toHaveCount(0);
  await expect(section.getByTestId('device-load-facts')).toContainText('Heat: normal');

  await section.getByLabel('Brightness').selectOption('80');
  await expect.poll(() => state.puts).toEqual([{ brightness: 80 }]);
  await expect(section.getByTestId('device-setting-brightness')).toContainText('Saved — waiting for the screen to pick it up');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('device-settings-desktop.png'), fullPage: true });
});

test('fits a phone: no horizontal scroll, controls at least 40 px tall', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreens(page);
  const section = await openAndroidSettings(page);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  const box = await section.getByLabel('Brightness').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  await section.getByTestId('device-setting-wifi').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('device-settings-iphone-390.png'), fullPage: false });
});
