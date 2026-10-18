import { test, expect, type Page } from '@playwright/test';

/**
 * "Panel and playback pacing" on the screen drawer's Overview (2026-10-18,
 * player 1.1.42 field candidate; src/components/screens/displayFacts.ts).
 *
 * The facts come from the native video report the player relays
 * (`Screen.lastVideoReport.native`): the panel's active and offered display
 * modes, how steadily frames reached the display, the experiments requested for
 * the screen, and whether the player window held keep-screen-on. The owner
 * reads this on an iPhone, so the phone-width case is the one that matters:
 * stacked label-over-value rows, no horizontal scroll, nothing to tap.
 *
 * Every screen, id and number here is made up.
 */

const USER = { id: 'display-facts-user', email: 'screens@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-facts', canTriggerPanic: false };
const token = `e30.${Buffer.from(JSON.stringify({ sub: USER.id, exp: 4102444800 })).toString('base64url')}.test`;
const GROUP = { id: 'group-one', name: 'Front office', address: null };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A 30 fps clip on a 4K panel whose only display mode is 30 Hz: 41,191 of 41,203 intervals on the source period. */
const BUCKETS = [0, 0, 4, 0, 41_191, 5, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0];

function nativeReport() {
  return {
    url: 'https://example.test/media/clip.mp4',
    totalFrames: 900,
    droppedFrames: 3,
    at: ago(10 * 60_000),
    native: {
      version: 1,
      state: 'presenting',
      at: ago(2 * 60_000),
      evidence: 'surface-render-callback',
      sha256: 'a'.repeat(64),
      sessionId: '3f2b6a52-0000-4000-8000-000000000001',
      revision: 'rev-1',
      faceIndex: 0,
      output: {
        attached: true, visible: true, hardwareAccelerated: true, viewUpdates: 4, uniqueFrames: 41_203, sourcePtsUs: 1_000,
        width: 3840, height: 2160, lastUpdateElapsedMs: 10, ageMs: 40,
      },
      timing: {
        decodedFrames: 41_210, submittedFrames: 41_203, lateFrames: 143, lastLateUs: 120, maxLateUs: 4_100,
        maxSubmitGapMs: 96, leadUs: 66_666, sourceWidth: 3840, sourceHeight: 2160,
        droppedFrames: 0, sourceFps: 30, refreshRate: 30, displayMode: '1:3840x2160@30.00',
        intervalUnitNs: 8_333_333, intervalBuckets: BUCKETS, intervalCount: 41_203,
        snappedFrames: 41_000, snapErrorMeanUs: 9, snapErrorMaxUs: 120, vsyncPeriodUs: 16_666, vsyncSamples: 1_204, clockSlewUs: -3_200,
        supportedModes: ['1:3840x2160@30.00'],
        keepScreenOn: false,
      },
      device: {
        class: 'amlogic/android-13', soc: 'amlogic', sdk: 33, webviewMajor: 120, nativeSolo: true, protocol3: false,
        silentUpdate: 'tap', refreshRate: 30, activeMode: '1:3840x2160@30.00', supportedModes: ['1:3840x2160@30.00'],
      },
      experiments: {
        requested: { vsyncSnap: true, webviewInvisible: true, prefer60hz: true },
        applied: { webviewInvisible: true, vsyncSnap: true, prefer60hz: 'no-60hz-mode' },
        guard: { disabled: {}, applied: {} },
      },
    },
  };
}

function screen(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, status: 'ONLINE', screenGroupId: GROUP.id, screenGroup: GROUP,
    osInfo: 'Android 13', hardwareModel: 'unknown', resolution: '3840x2160',
    playerVersion: '1.1.42', managerVersion: '1.0.24',
    lastPingAt: new Date().toISOString(), authState: 'PROVEN',
    forceApkUpdatePendingAt: null, lastOtaState: null, lastOtaAt: null,
    ...extra,
  };
}

const WITH_REPORT = screen('facts-with-report', 'Lobby test A', { lastVideoReport: nativeReport(), lastVideoReportAt: ago(10 * 60_000) });
const WITHOUT_REPORT = screen('facts-without-report', 'Hallway test B');

async function openDrawerFor(page: Page, screenId: string, firstName: string) {
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
      '/tenants': [{ id: USER.tenantId, name: 'Display facts', slug: USER.tenantId }],
      '/tenants/accessible': [{ id: USER.tenantId, name: 'Display facts', slug: USER.tenantId }],
      '/screens': [WITH_REPORT, WITHOUT_REPORT],
      '/screen-groups': [GROUP],
      '/schedules': [], '/playlists': [],
      // The page reads `schools.find(...)` off this: an empty list crashes it.
      '/emergency/readiness/district': { schools: [], notReadyCount: 0, computedAt: new Date().toISOString() },
      '/player/latest-version': { versionName: '1.1.42', versionCode: 10142, managerVersionName: '1.0.24' },
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
  // `?screen=` is the page's own deep link: it opens that screen's drawer on the Overview.
  await page.goto(`/e2e-facts/screens?screen=${screenId}`);
  const drawer = page.getByRole('dialog').first();
  await expect(drawer.getByText(firstName).first()).toBeVisible();
  return drawer;
}

async function expectTheFacts(drawer: ReturnType<Page['getByRole']>) {
  const section = drawer.getByTestId('display-facts-section');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Panel and playback pacing' })).toBeVisible();
  // Two minutes old when the fixture was cut; a loaded runner can take a while to paint the page.
  await expect(section.getByTestId('display-facts-provenance')).toHaveText(/^From the player’s last native video report, \d+ minutes ago\.$/);
  await expect(section.getByTestId('display-facts-panel')).toContainText('3840×2160 at 30 Hz');
  await expect(section.getByTestId('display-facts-panel')).toContainText('No 60 Hz mode offered at 3840×2160.');
  await expect(section.getByTestId('display-facts-panel')).toContainText('Modes offered: 3840×2160 at 30 Hz');
  await expect(section.getByTestId('display-facts-cadence')).toContainText('99.97 % on cadence · 143 late · 0 dropped · max gap 96 ms');
  await expect(section.getByTestId('display-facts-experiments')).toContainText('Vsync snap: on, locked to a 16.67 ms vsync grid (error 9 µs mean, 120 µs max)');
  await expect(section.getByTestId('display-facts-experiments')).toContainText('WebView hidden: requested, applied');
  await expect(section.getByTestId('display-facts-experiments')).toContainText('60 Hz mode: requested, no 60 Hz mode offered');
  await expect(section.getByTestId('display-facts-keepScreenOn')).toContainText('The player window did not hold keep-screen-on at the last report.');
  // Facts only: nothing in it takes a click, a tap or a keystroke.
  await expect(section.locator('button, a, input, select, textarea, summary, [role="button"], [tabindex]')).toHaveCount(0);
  return section;
}

test.describe('Panel and playback pacing', () => {
  // A phone and a retina laptop both paint at 2×; the screenshots are for people to read.
  test.use({ deviceScaleFactor: 2 });

  test('on a phone: every fact, stacked, with no sideways scroll', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = await openDrawerFor(page, WITH_REPORT.id, 'Lobby test A');
    const section = await expectTheFacts(drawer);

    // It fits the phone: the page, the drawer and the card itself never scroll sideways.
    const widths = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const card = document.querySelector('[data-testid="display-facts-section"]') as HTMLElement | null;
      return {
        viewport: window.innerWidth,
        doc: document.documentElement.scrollWidth,
        drawer: dlg ? { scroll: dlg.scrollWidth, client: dlg.clientWidth } : null,
        card: card ? { scroll: card.scrollWidth, client: card.clientWidth, right: card.getBoundingClientRect().right } : null,
      };
    });
    expect(widths.doc).toBeLessThanOrEqual(widths.viewport);
    expect(widths.drawer!.scroll).toBeLessThanOrEqual(widths.drawer!.client);
    expect(widths.card!.scroll).toBeLessThanOrEqual(widths.card!.client);
    expect(widths.card!.right).toBeLessThanOrEqual(widths.viewport);

    // Rows read top to bottom, each label above its value.
    const labels = await section.locator('dt').allTextContents();
    expect(labels).toEqual(['Panel mode', 'Frame cadence', 'Experiments on this screen', 'Keep screen on']);
    const tops = await section.locator('dt').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);

    await section.screenshot({ path: info.outputPath('display-facts-phone-390.png') });
    await page.screenshot({ path: info.outputPath('display-facts-phone-390-drawer.png') });
  });

  test('on a desktop: the same facts in the drawer', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const drawer = await openDrawerFor(page, WITH_REPORT.id, 'Lobby test A');
    const section = await expectTheFacts(drawer);
    await section.screenshot({ path: info.outputPath('display-facts-desktop-1440.png') });
    await page.screenshot({ path: info.outputPath('display-facts-desktop-1440-drawer.png') });
  });

  test('a screen with no native report gets no box at all', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = await openDrawerFor(page, WITHOUT_REPORT.id, 'Hallway test B');
    // The rest of the Overview is there…
    await expect(drawer.getByTestId('screen-content-card')).toBeVisible();
    // …and this section is not, neither as a box nor as a heading.
    await expect(drawer.getByTestId('display-facts-section')).toHaveCount(0);
    await expect(drawer.getByText('Panel and playback pacing')).toHaveCount(0);
  });
});
