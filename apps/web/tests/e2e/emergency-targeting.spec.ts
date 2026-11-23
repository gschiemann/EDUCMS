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

/**
 * A phone that is already SET UP (2026-11-14 panic phones): no session in the
 * tab, the readable marker cookie, and this origin's /api/panic/* answering
 * with the phone's own credential. The cold start uses the phone first.
 */
async function setUpPhone(page: Page, baseURL: string): Promise<World> {
  const world: World = { active: [], triggers: [], clears: [] };
  const user = { id: 'u1', email: 'admin@lincoln.test', role: 'SCHOOL_ADMIN', tenantId: TENANT, tenantName: 'Lincoln High', canTriggerPanic: true };
  await page.context().addCookies([{ name: 'venueos_pm', value: '1', url: baseURL }]);

  await page.route('**/api/v1/**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  // No remembered session in this browser — only the phone's credential.
  await page.route('**/api/session/**', async (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ refreshed: false, reason: 'no-cookie' }) }),
  );
  await page.route('**/api/panic/**', async (route) => {
    const action = new URL(route.request().url()).pathname.replace(/^.*\/api\/panic\//, '');
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'status') return json(200, { device: { id: 'pd-1', label: 'iPhone · Safari' }, user });
    if (action === 'targets') return json(200, TARGETS);
    if (action === 'active') return json(200, { alerts: world.active });
    return json(404, {});
  });
  return world;
}

type Box = { x: number; y: number; w: number; h: number };

async function triggerBoxes(page: Page): Promise<Box[]> {
  return page.getByRole('button', { name: /^Trigger .* emergency/ }).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
}

/** Six buttons, each inside the viewport, none overlapping another. */
function expectSixOnScreenApart(boxes: Box[], viewportHeight: number) {
  expect(boxes).toHaveLength(6);
  for (const b of boxes) {
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.h).toBeLessThanOrEqual(viewportHeight);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const c = boxes[j];
      const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
      expect(overlap, `buttons ${i} and ${j} overlap`).toBe(false);
    }
  }
}

/** …and each one still a big round thumb target. */
function expectSixRoundThumbTargets(boxes: Box[], viewportHeight: number) {
  expectSixOnScreenApart(boxes, viewportHeight);
  for (const b of boxes) {
    expect(b.w).toBeGreaterThanOrEqual(88);
    expect(Math.abs(b.w - b.h)).toBeLessThan(2);
  }
}

const MEDICAL_ON_LOBBY = { alertId: 'ovr_x', scopeType: 'device', scopeId: 's-lobby', targetName: 'Lobby', tenantId: TENANT, tenantName: null, type: 'MEDICAL', severity: 'CRITICAL', screenCount: 1, showingCount: 1, triggeredAt: null };

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
    // 2026-11-23 — this admin has no ready phone, so the "Keep this phone
    // ready" card is on the page: measure WITH it (the 2026-11-16 regression).
    const card = page.getByTestId('panic-keep-ready');
    await expect(card).toBeAttached();
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
    // The card gives way to the buttons: it starts at or below the bottom
    // row, and one short scroll brings it fully into view.
    const bottomRow = Math.max(...boxes.map((b) => b.y + b.h));
    const cardTop = await card.evaluate((el) => el.getBoundingClientRect().top);
    expect(cardTop).toBeGreaterThanOrEqual(bottomRow);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('panic-keep-ready-button')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('panic-short-viewport-390x664-scrolled.png') });
  });

  test('at 390×844 (the installed app) the keep-ready card stays above the buttons, as before', async ({ page }, testInfo) => {
    const world = await setUp(page);
    world.active = [MEDICAL_ON_LOBBY];
    await page.goto('/panic');
    await expect(page.getByTestId('panic-active-alerts')).toBeVisible();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    const card = page.getByTestId('panic-keep-ready');
    await expect(card).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('panic-phone-row-below')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('panic-card-above-390x844.png') });

    const boxes = await triggerBoxes(page);
    const topRow = Math.min(...boxes.map((b) => b.y));
    const cardBottom = await card.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(cardBottom).toBeLessThanOrEqual(topRow);
    expectSixRoundThumbTargets(boxes, 844);
  });

  test('a set-up phone in a phone browser (390×664): the ready line sits below the buttons, which keep their size', async ({ page, baseURL }, testInfo) => {
    const world = await setUpPhone(page, baseURL!);
    world.active = [MEDICAL_ON_LOBBY];
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/panic');
    const line = page.getByTestId('panic-phone-ready');
    await expect(line).toContainText('iPhone · Safari');
    await expect(page.getByTestId('panic-active-alerts')).toBeVisible();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    await expect(page.getByTestId('panic-keep-ready')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('panic-phone-ready-390x664.png') });

    const boxes = await triggerBoxes(page);
    expectSixRoundThumbTargets(boxes, 664);
    const bottomRow = Math.max(...boxes.map((b) => b.y + b.h));
    const lineTop = await line.evaluate((el) => el.getBoundingClientRect().top);
    expect(lineTop).toBeGreaterThanOrEqual(bottomRow);
    await line.scrollIntoViewIfNeeded();
    await expect(line).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('panic-phone-turn-off')).toBeInViewport({ ratio: 1 });
  });

  test('on a smaller phone (390×560) with the card and a live alert, the six buttons stay on screen and apart, and the card costs them nothing', async ({ page }, testInfo) => {
    // An iPhone SE-class Safari window is about 548 px. There the buttons
    // shrink with their rows (as they always did) — the card must never push
    // one below the fold, and must never take height from them.
    //
    // Not asserted here: round. At this height the rows are 54.7 px and a
    // button cannot be narrower than its label (Lockdown measured 79.2 ×
    // 54.7, Fire / Evacuate 71.2), with or without the card — the same as
    // before the card existed. The buttons are round from about 634 px with
    // the alert line (578 px without); below that it is a button-size
    // question for the owner, not something the card causes.
    const world = await setUp(page);
    world.active = [MEDICAL_ON_LOBBY];
    await page.setViewportSize({ width: 390, height: 560 });
    await page.goto('/panic');
    await expect(page.getByTestId('panic-active-alerts')).toBeVisible();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    const card = page.getByTestId('panic-keep-ready');
    await expect(card).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath('panic-short-viewport-390x560.png') });

    const withCard = await triggerBoxes(page);
    expectSixOnScreenApart(withCard, 560);
    const bottomRow = Math.max(...withCard.map((b) => b.y + b.h));
    expect(await card.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(bottomRow);

    // Dismiss the card ("Not now"): the buttons are exactly the same size.
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('panic-phone-row-below')).toHaveCount(0);
    const withoutCard = await triggerBoxes(page);
    expectSixOnScreenApart(withoutCard, 560);
    withoutCard.forEach((b, i) => {
      expect(Math.abs(b.w - withCard[i].w)).toBeLessThan(0.5);
      expect(Math.abs(b.h - withCard[i].h)).toBeLessThan(0.5);
    });
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
