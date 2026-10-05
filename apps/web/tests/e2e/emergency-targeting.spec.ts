/**
 * /panic alert targeting on a phone, in WebKit (2026-10-05).
 *
 * The owner: "all screens, a group, or single screens. All screens needs to
 * be on by default and needs to be easy to use." /panic is the surface used
 * on phones, so this runs at 390×844 and proves, through the real page:
 *   1. the target is All screens by default, with its count;
 *   2. a held button with the default sends EXACTLY the pre-targeting
 *      arguments (no `target`);
 *   3. choosing one screen changes the words on the page AND the request;
 *   4. that alert's all-clear sends ITS id and ITS scope.
 *
 * Every API call is intercepted (this suite's contract — playwright.config).
 * The trigger and all-clear are Next SERVER ACTIONS: the browser POSTs the
 * action's arguments to the page route and Next's server calls the API from
 * there, out of `page.route`'s reach. So the action POST itself is
 * intercepted: its arguments are what the action turns into the API body
 * (that mapping is pinned byte-for-byte by
 * src/actions/__tests__/trigger-emergency.test.ts), and it is answered with a
 * minimal React Flight payload carrying the action's result.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const TENANT = 't1';

const TARGETS = {
  tenantId: TENANT,
  tenantName: 'Lincoln High',
  allScreensCount: 24,
  groups: [{ id: 'g-gym', name: 'Gym', tenantId: TENANT, tenantName: 'Lincoln High', screenCount: 6 }],
  screens: [
    { id: 's-lobby', name: 'Lobby', location: 'Main entrance', online: true, groupId: null, groupName: null, tenantId: TENANT, tenantName: 'Lincoln High', displayScreenCount: 1 },
    { id: 's-gym-1', name: 'Gym east', location: null, online: false, groupId: 'g-gym', groupName: 'Gym', tenantId: TENANT, tenantName: 'Lincoln High', displayScreenCount: 1 },
  ],
};

interface World {
  active: unknown[];
  triggers: any[];
  clears: any[];
}

async function setUp(page: Page): Promise<World> {
  const world: World = { active: [], triggers: [], clears: [] };
  const user = { id: 'u1', email: 'admin@lincoln.test', role: 'SCHOOL_ADMIN', tenantId: TENANT, canTriggerPanic: true };

  await page.addInitScript(
    ([token, u]) => {
      try {
        window.sessionStorage.setItem('edu_cms_token', token as string);
        window.sessionStorage.setItem('edu_cms_user', u as string);
      } catch {
        /* storage blocked — the page would redirect to /login and fail loudly */
      }
    },
    ['e2e-token', JSON.stringify(user)],
  );

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/users/me') return json(user);
    if (path === '/emergency/targets') return json(TARGETS);
    if (path === '/emergency/active') return json({ alerts: world.active });
    return json(path.endsWith('s') ? [] : {});
  });

  // The two server actions. Arguments arrive as the action's encoded reply —
  // plain JSON for plain objects.
  await page.route(
    (url) => url.pathname === '/panic',
    async (route: Route) => {
      const req = route.request();
      if (req.method() !== 'POST' || !req.headers()['next-action']) return route.continue();
      const args = JSON.parse(req.postData() || '[]');
      const payload = args[0] ?? {};
      let result: unknown;
      if (typeof payload.type === 'string') {
        world.triggers.push(payload);
        const scoped = payload.target?.scopeType === 'device';
        // The server has now written the alert — the page's poll will see it.
        world.active = [
          scoped
            ? { alertId: 'ovr_e2e', scopeType: 'device', scopeId: payload.target.scopeId, targetName: 'Lobby', tenantId: TENANT, tenantName: 'Lincoln High', type: 'LOCKDOWN', severity: 'CRITICAL', screenCount: 1, showingCount: 1, triggeredAt: new Date().toISOString() }
            : { alertId: null, scopeType: 'tenant', scopeId: TENANT, targetName: 'Lincoln High', tenantId: TENANT, tenantName: 'Lincoln High', type: 'LOCKDOWN', severity: 'CRITICAL', screenCount: 24, showingCount: null, triggeredAt: null },
        ];
        result = { success: true, overrideId: 'ovr_e2e', ...(scoped ? { affectedScreenCount: 1 } : {}) };
      } else {
        world.clears.push(payload);
        world.active = [];
        result = { success: true };
      }
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/x-component' },
        body: `0:${JSON.stringify({ a: result, f: '' })}\n`,
      });
    },
  );

  return world;
}

/** Press and hold for the full 3-second safeguard, then let go. */
async function hold(page: Page, locator: ReturnType<Page['locator']>, ms = 3400) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('hold target not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe('/panic — all screens, a group, or one screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('default is All screens; holding Lockdown sends exactly the pre-targeting arguments', async ({ page }, testInfo) => {
    const world = await setUp(page);
    await page.goto('/panic');

    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    await expect(page.getByTestId('emergency-choose-screens')).toHaveText('Choose screens');
    await page.screenshot({ path: testInfo.outputPath('panic-default-390.png') });

    await hold(page, page.getByRole('button', { name: /Trigger Lockdown emergency/ }));

    await expect(page.getByTestId('panic-sent-summary')).toHaveText('Lockdown on all 24 screens');
    expect(world.triggers).toHaveLength(1);
    // No `target` at all: the identical call /panic always made.
    expect(world.triggers[0]).toEqual({ schoolId: TENANT, type: 'lockdown', triggeredBy: 'u1', token: 'e2e-token' });
  });

  test('choosing one screen changes the words and the request; its all-clear sends its own scope', async ({ page }, testInfo) => {
    const world = await setUp(page);
    await page.goto('/panic');
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');

    // Choose screens → Lobby.
    await page.getByTestId('emergency-choose-screens').click();
    const picker = page.getByTestId('emergency-target-picker');
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('target-option-group-g-gym')).toContainText('Gym group');
    await expect(page.getByTestId('target-option-group-g-gym')).toContainText('6 screens');
    await expect(page.getByTestId('target-option-screen-s-lobby')).toContainText('Online');
    await expect(page.getByTestId('target-option-screen-s-gym-1')).toContainText('Offline');
    await page.screenshot({ path: testInfo.outputPath('panic-picker-390.png') });
    await page.getByTestId('target-option-screen-s-lobby').click();
    await expect(picker).toBeHidden();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('Lobby · 1 screen');
    await page.screenshot({ path: testInfo.outputPath('panic-one-screen-390.png') });

    // The same 3-second hold — unchanged.
    await hold(page, page.getByRole('button', { name: /Trigger Lockdown emergency/ }));

    await expect(page.getByTestId('panic-sent-summary')).toHaveText('Lockdown on 1 screen — Lobby');
    expect(world.triggers).toHaveLength(1);
    expect(world.triggers[0]).toEqual({
      schoolId: TENANT,
      type: 'lockdown',
      triggeredBy: 'u1',
      token: 'e2e-token',
      target: { scopeType: 'device', scopeId: 's-lobby' },
    });
    await page.screenshot({ path: testInfo.outputPath('panic-sent-390.png') });

    // Back to the panel: the alert is listed with its target and its own
    // all-clear — and the NEXT alert starts from All screens again.
    await page.getByTestId('panic-back-to-panel').click();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    const banner = page.getByTestId('panic-active-alerts');
    await expect(banner).toContainText('Lockdown — Lobby, 1 screen');
    await page.screenshot({ path: testInfo.outputPath('panic-active-390.png') });
    await banner.click();
    await expect(page.getByTestId('panic-alerts-sheet')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('panic-end-sheet-390.png') });

    await hold(page, page.getByTestId('panic-hold-to-end'));
    await expect.poll(() => world.clears.length).toBe(1);
    expect(world.clears[0]).toEqual({
      schoolId: TENANT,
      token: 'e2e-token',
      overrideId: 'ovr_e2e',
      scopeType: 'device',
      scopeId: 's-lobby',
    });
    await expect(page.getByTestId('panic-active-alerts')).toBeHidden();
  });

  test('in a phone browser with its address bar (390×664) the six buttons never overlap', async ({ page }, testInfo) => {
    // Safari's toolbars leave ~664 of 844 px. The "Send to" line and a live
    // alert line take height; the buttons must shrink with their rows rather
    // than spill into each other.
    const world = await setUp(page);
    world.active = [
      { alertId: 'ovr_x', scopeType: 'device', scopeId: 's-lobby', targetName: 'Lobby', tenantId: TENANT, tenantName: null, type: 'MEDICAL', severity: 'CRITICAL', screenCount: 1, showingCount: 1, triggeredAt: null },
    ];
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/panic');
    await expect(page.getByTestId('panic-active-alerts')).toBeVisible();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    await page.screenshot({ path: testInfo.outputPath('panic-short-viewport-390x664.png') });

    const boxes = await page.getByRole('button', { name: /^Trigger .* emergency/ }).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(boxes).toHaveLength(6);
    for (const b of boxes) {
      expect(b.w).toBeGreaterThanOrEqual(88); // still a big thumb target
      expect(Math.abs(b.w - b.h)).toBeLessThan(2); // still a circle
      expect(b.y + b.h).toBeLessThanOrEqual(664);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const c = boxes[j];
        const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
        expect(overlap, `buttons ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  test('a short press does nothing — the 3-second hold is unchanged', async ({ page }) => {
    const world = await setUp(page);
    await page.goto('/panic');
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    await hold(page, page.getByRole('button', { name: /Trigger Lockdown emergency/ }), 1200);
    await page.waitForTimeout(2500);
    expect(world.triggers).toHaveLength(0);
  });
});
