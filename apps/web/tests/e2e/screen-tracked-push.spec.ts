import { test, expect, type Page } from '@playwright/test';

/**
 * Tracked APK pushes in the screen drawer (2026-10-18, unattended-updates
 * piece 3; API: apps/api/src/player-ota/push-tracking.ts).
 *
 * A push used to be fire-and-forget: the server offered the APK on every
 * check for 24 h and then dropped it, while this row said "Updating…". The
 * server now keeps the push and says why it stopped offering it. The
 * Settings tab must show that state in plain words, when it was sent, how
 * often it was handed to the screen — and a Cancel that really ends it.
 */

const USER = { id: 'tracked-push-user', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-push', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const GROUP = { id: 'group-one', name: 'Front office', address: null };
const HOUR = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function screen(name: string, push: Record<string, unknown>) {
  return {
    id: name, name, status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
    osInfo: 'Android 9', hardwareModel: 'unknown',
    playerVersion: '1.1.23', managerVersion: '1.0.24',
    lastPingAt: new Date().toISOString(), authState: 'PROVEN',
    forceApkUpdatePendingAt: null, forceApkUpdateHold: null, forceApkUpdateHoldAt: null,
    forceApkUpdateHoldReason: null, forceApkUpdateOfferCount: 0, forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null, lastOtaState: null, lastOtaAt: null,
    ...push,
  };
}

const NEEDS_TAP = screen('M24', {
  forceApkUpdatePendingAt: ago(2 * HOUR), forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateHoldAt: ago(HOUR),
  forceApkUpdateHoldReason: 'did-not-land-needs-tap-class: v1.1.41 did not install; the screen is still on v1.1.23.',
  forceApkUpdateOfferCount: 2, forceApkUpdateLastOfferAt: ago(2 * HOUR - 60_000), forceApkUpdateTargetVersion: '1.1.41',
  lastOtaState: 'NEEDS_TAP', lastOtaAt: ago(HOUR),
});
const STALLED = screen('G43', {
  forceApkUpdatePendingAt: ago(20 * HOUR), forceApkUpdateHold: 'STALLED', forceApkUpdateHoldAt: ago(2 * HOUR),
  forceApkUpdateHoldReason: 'offer-limit-reached: v1.1.41 was offered 4 times and did not install.',
  forceApkUpdateOfferCount: 4, forceApkUpdateLastOfferAt: ago(3 * HOUR), forceApkUpdateTargetVersion: '1.1.41',
  lastOtaState: 'DOWNLOADING', lastOtaAt: ago(3 * HOUR),
});
const EXPIRED = screen('L55', {
  forceApkUpdatePendingAt: ago(30 * HOUR), forceApkUpdateHold: 'EXPIRED', forceApkUpdateHoldAt: ago(5 * HOUR),
  forceApkUpdateHoldReason: 'not-offered-within-24h: The update was not handed to this screen within 24 hours.',
});

async function openScreens(page: Page, screens: Array<Record<string, unknown>>) {
  const state = { screens, cancelled: [] as string[] };
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
    const cancel = /^\/screens\/([^/]+)\/force-update\/cancel$/.exec(path);
    if (cancel && req.method() === 'POST') {
      state.cancelled.push(cancel[1]);
      // What the API does: the push and its whole record are gone.
      state.screens = state.screens.map((s) => s.id === cancel[1]
        ? { ...s, forceApkUpdatePendingAt: null, forceApkUpdateHold: null, forceApkUpdateHoldAt: null, forceApkUpdateHoldReason: null, forceApkUpdateOfferCount: 0, forceApkUpdateLastOfferAt: null, forceApkUpdateTargetVersion: null }
        : s);
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify({ ok: true, screenId: cancel[1], cancelled: true }) });
    }
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/branding/me': {},
      '/tenants': [{ id: USER.tenantId, name: 'Tracked push', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Tracked push', slug: USER.tenantId }],
      '/screens': state.screens,
      '/screen-groups': [GROUP],
      '/schedules': [], '/playlists': [],
      // The page reads `schools.find(...)` off this: an empty list crashes it.
      '/emergency/readiness/district': { schools: [], notReadyCount: 0, computedAt: new Date().toISOString() },
      '/player/latest-version': { versionName: '1.1.41', versionCode: 10141, managerVersionName: '1.0.24' },
      '/screens/hardware-catalog': { models: [] },
      '/screens/hardware': { models: [] },
    };
    const body = path.endsWith('/device-inventory') ? { report: null, reportedAt: null }
      : path.endsWith('/events') ? { events: [] }
        : path.endsWith('/faces') ? { faces: [] }
          // The drawer's playback card reads `capability.*` off this.
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
  await page.goto('/e2e-push/screens');
  await expect(page.locator(`:text-is("${String(screens[0].name)}"):visible`).first()).toBeVisible();
  return state;
}

async function openSettings(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  const drawer = page.getByRole('dialog').first();
  await drawer.getByRole('tab', { name: 'Settings', exact: true }).click();
  return drawer;
}

test('a held push shows why, when it was sent and how often — and Cancel ends it', async ({ page }, info) => {
  const state = await openScreens(page, [NEEDS_TAP]);
  const drawer = await openSettings(page, 'M24');
  const row = drawer.getByTestId('apk-update-status');
  await expect(row.getByText('Needs an Install tap on the screen')).toBeVisible();
  await expect(row.getByText(/Press Install now on the screen, then tap Install/)).toBeVisible();
  await expect(row.getByTestId('apk-push-facts')).toHaveText('Sent 2 hours ago · offered 2 times · v1.1.41');
  await expect(row.getByText(/Updating/)).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('tracked-push-needs-tap.png'), fullPage: true });

  await row.getByTestId('apk-push-cancel').click();
  const confirm = page.getByRole('dialog', { name: 'Cancel the update for M24?' });
  await expect(confirm.getByText(/that prompt stays until someone answers it/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel update', exact: true }).click();

  await expect.poll(() => state.cancelled).toEqual(['M24']);
  // The list re-reads: no push, so the row offers a fresh one again.
  await expect(row.getByTestId('apk-push-tracked')).toHaveCount(0);
  await expect(drawer.getByTestId('apk-push')).toHaveText('Push update');
  await expect(row.getByText('Needs an Install tap on the screen')).toHaveCount(0);
});

test('stalled and expired pushes say what happened and offer Retry', async ({ page }, info) => {
  await openScreens(page, [STALLED, EXPIRED]);
  let drawer = await openSettings(page, 'G43');
  let row = drawer.getByTestId('apk-update-status');
  await expect(row.getByText('Update stalled — the screen did not install it')).toBeVisible();
  await expect(row.getByText(/It was offered 4 times and never installed/)).toBeVisible();
  await expect(row.getByTestId('apk-push-facts')).toHaveText(/offered 4 times · v1\.1\.41$/);
  await expect(drawer.getByTestId('apk-push')).toHaveText('Retry update');
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('tracked-push-stalled.png'), fullPage: true });
  await drawer.getByRole('button', { name: 'Close details' }).click();

  drawer = await openSettings(page, 'L55');
  row = drawer.getByTestId('apk-update-status');
  await expect(row.getByText('Update expired — not picked up within 24 hours')).toBeVisible();
  await expect(row.getByText(/so nothing will install later/)).toBeVisible();
  await expect(row.getByTestId('apk-push-facts')).toHaveText('Sent yesterday · not offered yet');
  await expect(drawer.getByTestId('apk-push')).toHaveText('Retry update');
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('tracked-push-expired.png'), fullPage: true });
});
