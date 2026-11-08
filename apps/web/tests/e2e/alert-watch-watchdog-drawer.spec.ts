import { test, expect, type Page } from '@playwright/test';
import { emptyScreenEvents, screenEventsScreenId } from '../fixtures/api-contract';

/**
 * The companion Manager's verdict on the native alert watch, on the screen
 * drawer's Device card (Manager wave 5, 2026-11-08).
 *
 * The fixture is a made-up Android bench screen whose Player carried a
 * `nativeRuntimeReport.alertWatchWatchdog` block: the Manager found the
 * native alert watch silent behind a dark panel and sent a re-arm one minute
 * before the heartbeat left. The Device card must show that as a fact, in
 * amber, under Technical details — and nothing on the Overview changes.
 *
 * Every screen, id and number here is made up.
 */

const USER = { id: 'wave5-drawer', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-wave5', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const GROUP = { id: 'group-bench', name: 'Bench', address: null };
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const SCREEN_ID = 'drawer-wave5';

function screen(verdict: Record<string, unknown>): Record<string, unknown> {
  return {
    id: SCREEN_ID, name: 'Bench GUQ55', status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
    osInfo: 'Android 11', hardwareModel: 'goodview-guq55', resolution: '3840x2160', orientation: 'LANDSCAPE',
    playerVersion: '1.1.66-field.1', managerVersion: '1.1.66-field.1',
    lastPingAt: new Date().toISOString(), authState: 'PROVEN',
    pushChannel: 'live', lastPushConnectedAt: ago(10_000),
    lastRenderedHash: 'content:9f2', lastRenderedAt: ago(16_000),
    nativeRuntimeReport: { schema: 1, interactive: false, foreground: false, standbySinceMs: Date.now() - 2 * HOUR, elapsedRealtimeMs: 9_000_000, powerOnAck: null, alertWatchWatchdog: verdict },
    nativeRuntimeReportAt: ago(20_000),
    forceApkUpdatePendingAt: null, forceApkUpdateHold: null, forceApkUpdateHoldAt: null,
    forceApkUpdateHoldReason: null, forceApkUpdateOfferCount: 0, forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null, lastOtaState: null, lastOtaAt: null,
  };
}

// The playback card needs a capability block (the real route always sends one).
const PLAYBACK = {
  screenId: SCREEN_ID, summary: 'unknown', declared: null, demotions: [],
  capability: {
    deviceClass: null, maxShortEdge: 2160, stuttersAtShortEdge: null, maxFps: null, maxUnitConcurrentVideos: null,
    evidence: 'unknown', concurrencyEvidence: 'unknown', evidenceAt: null, classScreens: 0, stale: false,
  },
  files: [],
};

const REARM = { v: 1, verdict: 'rearm-sent', mode: 'on', ageMs: 60_000, stampAgeMs: 250_000, stampState: 'watching', faces: 1, ladder: { rung: 'rearm', ageMs: 60_000 }, n24h: 1 };

async function openDrawer(page: Page, verdict: Record<string, unknown>) {
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
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/branding/me': {},
      '/tenants': [{ id: USER.tenantId, name: 'Wave 5', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Wave 5', slug: USER.tenantId }],
      '/screens': [screen(verdict)],
      '/screen-groups': [GROUP],
      '/schedules': [],
      '/playlists': [],
      '/emergency/readiness/district': { schools: [], notReadyCount: 0, computedAt: new Date().toISOString() },
      '/player/latest-version': {},
      '/screens/hardware-catalog': { models: [] },
      '/screens/hardware': { models: [] },
    };
    const body = path.endsWith('/device-inventory') ? { report: null, reportedAt: null }
      : screenEventsScreenId(path) ? emptyScreenEvents(screenEventsScreenId(path)!)
        : path.endsWith('/faces') ? { faces: [] }
          : path.endsWith('/playback-capability') ? PLAYBACK
            : bodies[path] ?? [];
    return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.goto(`/e2e-wave5/screens?screen=${SCREEN_ID}`);
  const drawer = page.getByRole('dialog').first();
  await expect(drawer.getByText('Bench GUQ55').first()).toBeVisible();
  return drawer;
}

const VIEWPORTS = [
  { name: 'iphone', width: 390, height: 844 },
  { name: 'safari-1325', width: 1325, height: 758 },
];

test.describe('Alert-watch watchdog verdict on the Device card', () => {
  test.use({ deviceScaleFactor: 2 });

  for (const vp of VIEWPORTS) {
    test(`a re-arm is a fact under Technical details (${vp.name})`, async ({ page }, info) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const drawer = await openDrawer(page, REARM);
      await drawer.getByRole('tab', { name: 'Overview', exact: true }).click();
      const tech = drawer.getByTestId('screen-technical-details');
      await tech.getByText('Technical details').click();
      const card = tech.getByTestId('screen-device-card');
      await expect(card).toBeVisible();
      const row = card.locator('[data-device-fact="alertWatch"]');
      await expect(row).toContainText('Dark panel; native watch silent — re-arm sent to the Player');
      await expect(row).toContainText(/rearm 1 minute ago · 1 intervention in 24 h/);
      await expect(card.getByText('Alert watch')).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`device-card-rearm-${vp.name}.png`) });
      const out = process.env.WAVE5_SHOTS;
      if (out) await page.screenshot({ path: `${out}/device-card-rearm-${vp.name}.png` });
    });
  }

  test('a healthy watch is plain, observe mode says so, no block means no row', async ({ page }) => {
    await page.setViewportSize({ width: 1325, height: 758 });
    const drawer = await openDrawer(page, { v: 1, verdict: 'healthy', mode: 'observe', ageMs: 5_000, stampAgeMs: 12_000, stampState: 'watching', faces: 2, n24h: 0 });
    await drawer.getByRole('tab', { name: 'Overview', exact: true }).click();
    const tech = drawer.getByTestId('screen-technical-details');
    await tech.getByText('Technical details').click();
    const row = tech.getByTestId('screen-device-card').locator('[data-device-fact="alertWatch"]');
    await expect(row).toContainText('Native alert watch alive behind the dark panel');
    await expect(row).toContainText('Observe mode');
    await expect(row.locator('p').first()).toHaveClass(/text-slate-700/);
  });
});
