import { test, expect, type Page } from '@playwright/test';
import { emptyScreenEvents, screenEventsScreenId } from '../fixtures/api-contract';

/**
 * The screen drawer, read by an end user (2026-10-22).
 *
 * Greg, on L55VEC's drawer from his iPhone: "the overview screen has so much
 * shit in it again, make sure we only show useful items here to an end user".
 * This fixture is that screen's shape: the live channel down for 14 hours
 * while its own check-ins keep delivering, a playlist proof that does not
 * match the schedule's signature, a two-day-old web video sample graded
 * "stuttered" for 0.5 % of frames, twenty hours of smooth per-file minutes —
 * and a "Push update" pressed while no newer build is allowed for it, which
 * the screen answers "already on the latest".
 *
 * The Overview must say: online, what is playing, video plays smoothly — and
 * nothing amber or red. Everything else is one tap away under Technical
 * details. The Settings card must settle on "Already on v… ✓", never beside
 * a disabled "Updating…".
 *
 * Every screen, id and number here is made up.
 */

const USER = { id: 'end-user-drawer', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-enduser', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const GROUP = { id: 'group-ranch', name: 'Ranch Community', address: null };
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const SCREEN_ID = 'drawer-l55';
const PLAYLIST = { id: 'pl-halloween', name: 'Halloween - 1080×1920', items: [] };

function l55(): Record<string, unknown> {
  return {
    id: SCREEN_ID, name: 'L55 test', status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
    osInfo: 'Android 11', hardwareModel: 'unknown', resolution: '2160x3840', orientation: 'PORTRAIT',
    playerVersion: '1.1.47-field.1', managerVersion: '1.0.24',
    lastPingAt: new Date().toISOString(), authState: 'PROVEN',
    pushChannel: 'stale', lastPushConnectedAt: ago(14 * HOUR),
    lastRenderedHash: 'pl:0|10000|item-old', lastRenderedAt: ago(16_000),
    lastVideoReport: {
      url: 'https://example.test/media/6bd9a41f-131e-4a96-a8e8-1b24f3ac2956.mp4',
      totalFrames: 1032, droppedFrames: 5, stalls: 3, stalledMs: 100, width: 2160, height: 3338, at: ago(49 * HOUR),
    },
    lastVideoReportAt: ago(49 * HOUR),
    forceApkUpdatePendingAt: null, forceApkUpdateHold: null, forceApkUpdateHoldAt: null,
    forceApkUpdateHoldReason: null, forceApkUpdateOfferCount: 0, forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null, lastOtaState: null, lastOtaAt: null,
  };
}

const PLAYBACK = {
  screenId: SCREEN_ID, summary: 'smooth', declared: null, demotions: [],
  capability: {
    deviceClass: null, maxShortEdge: 2160, stuttersAtShortEdge: null, maxFps: null, maxUnitConcurrentVideos: null,
    evidence: 'measured-screen', concurrencyEvidence: 'unknown', evidenceAt: ago(30 * HOUR), classScreens: 1, stale: true,
  },
  files: [
    { sha256: 'a'.repeat(64), name: 'Portrait promo 2026.mp4', verdict: 'smooth', droppedPct: 0.1, samples: 1181, settledSamples: 1173,
      excludedSamples: 8, excludedReason: 'player-update', copy: null, width: 2160, height: 3338, unitConcurrentMax: 1 },
    { sha256: 'b'.repeat(64), name: 'Portrait promo 2026.mp4', verdict: 'smooth', droppedPct: 0, samples: 831, settledSamples: 831,
      excludedSamples: 0, excludedReason: null, copy: '1080p', width: 1080, height: 1668, unitConcurrentMax: 1 },
  ],
};

async function openScreens(page: Page) {
  const state = { screen: l55(), pushes: 0 };
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
    if (path === `/screens/${SCREEN_ID}/force-update` && req.method() === 'POST') {
      state.pushes += 1;
      // What the API records, and what the screen answers on its next check:
      // no newer build is allowed for it, so "up to date" — and the server
      // keeps a push it never offered (not offered yet).
      state.screen = {
        ...state.screen,
        forceApkUpdatePendingAt: new Date().toISOString(),
        lastOtaState: 'UP_TO_DATE',
        lastOtaAt: new Date(Date.now() + 5_000).toISOString(),
      };
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify({ ok: true }) });
    }
    const bodies: Record<string, unknown> = {
      '/auth/me': USER, '/users/me': USER, '/branding/me': {},
      '/tenants': [{ id: USER.tenantId, name: 'End user', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'End user', slug: USER.tenantId }],
      '/screens': [state.screen],
      '/screen-groups': [GROUP],
      '/schedules': [{ id: 'sch-1', playlistId: PLAYLIST.id, playlist: PLAYLIST, screenId: SCREEN_ID, isActive: true, startTime: ago(24 * HOUR), priority: 0 }],
      '/playlists': [PLAYLIST],
      '/emergency/readiness/district': { schools: [], notReadyCount: 0, computedAt: new Date().toISOString() },
      // No published build is known for this screen's track: the push has nothing to offer.
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
  await page.goto(`/e2e-enduser/screens?screen=${SCREEN_ID}`);
  const drawer = page.getByRole('dialog').first();
  await expect(drawer.getByText('L55 test').first()).toBeVisible();
  return { state, drawer };
}

const VIEWPORTS = [
  { name: 'iphone', width: 390, height: 844 },
  // Greg's Safari window (in-app bug telemetry).
  { name: 'safari-1325', width: 1325, height: 758 },
];

test.describe('Screen drawer for an end user', () => {
  test.use({ deviceScaleFactor: 2 });

  for (const vp of VIEWPORTS) {
    test(`Overview shows only what an operator acts on (${vp.name})`, async ({ page }, info) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const { drawer } = await openScreens(page);
      await drawer.getByRole('tab', { name: 'Overview', exact: true }).click();
      await expect(drawer.getByTestId('screen-content-card')).toBeVisible();
      await expect(drawer.getByTestId('screen-playback-card')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`overview-${vp.name}.png`) });

      // No banner for a channel the screen's own check-ins are covering.
      await expect(drawer.getByText(/Push delayed/)).toHaveCount(0);
      // One line about what is playing — not "can't confirm … confirmed".
      const card = drawer.getByTestId('screen-content-card');
      await expect(card.getByText('Halloween - 1080×1920')).toBeVisible();
      await expect(card.getByText('Playing a playlist')).toBeVisible();
      await expect(card.getByText(/Can’t confirm/)).toHaveCount(0);
      // One video verdict on the Overview: smooth. The old sample is not news.
      await expect(drawer.getByTestId('screen-playback-summary')).toHaveText('Plays video smoothly');
      await expect(drawer.getByText(/Stuttered on this screen/)).toHaveCount(0);
      await expect(drawer.getByTestId('screen-playback-files')).toHaveCount(0);

      // Technical details: closed, then everything is still there.
      const tech = drawer.getByTestId('screen-technical-details');
      await tech.getByText('Technical details').click();
      await expect(tech.getByTestId('screen-live-link')).toContainText('Live connection: down since 14h ago');
      const sample = tech.getByTestId('screen-video-playback');
      await expect(sample).toHaveAttribute('data-video-news', 'false');
      await expect(sample).toContainText('5 of 1,032 frames dropped (0.5%)');
      await expect(tech.getByTestId('screen-playback-files')).toBeVisible();
      await expect(tech.getByTestId('screen-device-card')).toBeVisible();

      // Phone: nothing scrolls sideways.
      const widths = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
        return { viewport: window.innerWidth, doc: document.documentElement.scrollWidth, drawer: dlg ? dlg.scrollWidth - dlg.clientWidth : 0 };
      });
      expect(widths.doc).toBeLessThanOrEqual(widths.viewport);
      expect(widths.drawer).toBeLessThanOrEqual(0);
      await tech.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`overview-technical-${vp.name}.png`) });
    });

    test(`a push with nothing newer settles on "Already on" (${vp.name})`, async ({ page }, info) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const { state, drawer } = await openScreens(page);
      await drawer.getByRole('tab', { name: 'Settings', exact: true }).click();
      const row = drawer.getByTestId('apk-update-status');
      await drawer.getByTestId('apk-push').click();
      await expect.poll(() => state.pushes).toBe(1);
      await expect(row.getByText('Already on v1.1.47-field.1 ✓')).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`settings-push-${vp.name}.png`) });

      await expect(row.getByText(/Updating/)).toHaveCount(0);
      await expect(row.getByTestId('apk-push')).toHaveCount(0);
      await expect(row.getByText(/not offered yet/)).toHaveCount(0);
    });
  }
});
