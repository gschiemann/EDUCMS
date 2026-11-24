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

/**
 * `holdSignInCheck`: `/users/me` waits for this promise before it answers, so
 * the page's "Checking sign-in…" line stays on screen until the test lets go
 * (2026-11-23, the landscape layout's "the buttons never move" checks).
 */
async function setUp(page: Page, opts: { holdSignInCheck?: Promise<unknown> } = {}): Promise<World> {
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
    if (path === '/users/me') {
      if (opts.holdSignInCheck) await opts.holdSignInCheck;
      return json(user);
    }
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

/**
 * Wait until none of the six trigger buttons is mid-transition. Each carries
 * `transition-all duration-150`, and since 2026-11-23 the first client render
 * changes their size cap (the server renders the 800 px-and-taller shape; the
 * client then picks this screen's), so for 150 ms after hydration a box is
 * neither the old size nor the new one: 844 × 390 read 150.4 × 148, not
 * 148 × 148, inside that window. Nothing on the button runs forever, so this
 * settles in well under a second; a button that never settles fails here.
 */
async function settleTriggers(page: Page) {
  await expect
    .poll(
      () => page.locator('button[data-mode]').evaluateAll((els) => els.filter((el) => el.getAnimations().length > 0).length),
      { message: 'a trigger button is still animating' },
    )
    .toBe(0);
}

async function triggerBoxes(page: Page): Promise<Box[]> {
  await settleTriggers(page);
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

/** The idle panel's own scroll box: the `fixed` root around the trigger grid. */
async function panelScroll(page: Page): Promise<{ top: number; height: number; client: number }> {
  return page.getByRole('button', { name: /Trigger Lockdown emergency/ }).evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    while (n && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
    if (!n) throw new Error('no fixed panel root around the trigger buttons');
    return { top: n.scrollTop, height: n.scrollHeight, client: n.clientHeight };
  });
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
    // An iPhone SE-class Safari window is about 548 px. The card must never
    // push a button below the fold, and must never take height from them.
    //
    // 2026-11-23 (landscape and short screens): round and at least 88 px are
    // now asserted here too. Under 800 px the grid is three across and the
    // stack above it is compacted, so at 390 wide every button is the
    // column's 111.3 px down to about 547 px tall (it was 54.7 × 79.2 here,
    // not round, before that change).
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
    expectSixRoundThumbTargets(withCard, 560);
    const bottomRow = Math.max(...withCard.map((b) => b.y + b.h));
    expect(await card.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(bottomRow);
    // The card is reached by scrolling the panel (so the probe below reads
    // the right box).
    const scrollWithCard = await panelScroll(page);
    expect(scrollWithCard.height).toBeGreaterThan(scrollWithCard.client);

    // Dismiss the card ("Not now"): the buttons are exactly the same size.
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('panic-phone-row-below')).toHaveCount(0);
    const withoutCard = await triggerBoxes(page);
    expectSixRoundThumbTargets(withoutCard, 560);
    withoutCard.forEach((b, i) => {
      expect(Math.abs(b.w - withCard[i].w)).toBeLessThan(0.5);
      expect(Math.abs(b.h - withCard[i].h)).toBeLessThan(0.5);
    });
    // …and with no row to show, the panel has nothing to scroll.
    const scrollWithoutCard = await panelScroll(page);
    expect(scrollWithoutCard.height).toBeLessThanOrEqual(scrollWithoutCard.client);
  });

  test('scrolled down to the keep-ready card (390×664), a short press still sends nothing and the full hold still sends', async ({ page }) => {
    // On a short screen the panel scrolls to reach the card. The 3-second
    // safeguard must hold there too: a 1.2 s press sends nothing, a full hold
    // sends exactly the pre-targeting arguments.
    const world = await setUp(page);
    world.active = [MEDICAL_ON_LOBBY];
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/panic');
    await expect(page.getByTestId('panic-active-alerts')).toBeVisible();
    await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    const card = page.getByTestId('panic-keep-ready');
    await expect(card).toBeAttached();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport({ ratio: 1 });
    expect((await panelScroll(page)).top).toBeGreaterThan(0);
    // Scrolled all the way to the card, the six buttons are still fully on screen.
    expectSixOnScreenApart(await triggerBoxes(page), 664);

    const lockdown = page.getByRole('button', { name: /Trigger Lockdown emergency/ });
    await hold(page, lockdown, 1200);
    await page.waitForTimeout(2500);
    expect(world.triggers).toHaveLength(0);

    await hold(page, lockdown);
    await expect(page.getByTestId('panic-sent-summary')).toHaveText('Lockdown on all 24 screens');
    expect(world.triggers).toHaveLength(1);
    expect(world.triggers[0]).toEqual({ schoolId: TENANT, type: 'lockdown', triggeredBy: 'u1', token: 'e2e-token' });
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

// ─────────────────────────────────────────────────────────────────────────
// 2026-11-23 — /panic on a phone held sideways, and on short portrait screens.
//
// Before this, the grid was a 2 × 3 `flex-1 min-h-0` column under a ~330 px
// header / title / LIVE | DRILL / alert line / "Send to" stack. In phone
// landscape (844 × 390) that left nothing for the rows: the six buttons
// measured about 2 px tall. At 390 × 480 they were 28 px, and below about
// 634 px tall with an alert line they were not circles. No spec covered it.
//
// Every size asserted here is a SMALLEST DIAMETER (min of width and height
// over the six) and each button must be round (|w − h| < 2).
//   • 88 px is the floor everywhere: the thumb-target floor this spec has held
//     the buttons to since 2026-10-05 (twice Apple's 44 pt minimum, for a
//     gloved or shaking hand on a life-safety control).
//   • On top of the floor, each viewport is held to the size its class
//     geometry gives (landscape: within 1 px; portrait under 800 px: at least
//     that size minus 1), so a change that shrinks the buttons fails here even
//     while they stay above 88.
//       landscape 3 across: min(156, (W − S − 60) / 3, (H − 36) / 2)
//       landscape 2 across: min(156, (W − S − 44) / 2, (H − 52) / 3)
//         S = the status column, clamp(340, 0.4 W, 400)
//       portrait  3 across: min(156, (W − 56) / 3, (H − stack − 28) / 2)
// Landscape sizes do not depend on the alert line, the sign-in line, DRILL,
// the language or the card: the buttons sit in their own fixed area to the
// right of the status column, so all of those are asserted not to move them.
// ─────────────────────────────────────────────────────────────────────────

type NamedBox = Box & { name: string };

/** The six trigger buttons: the only buttons on the panel that carry `data-mode`. */
const TRIGGERS = 'button[data-mode]';

async function namedTriggerBoxes(page: Page): Promise<NamedBox[]> {
  await settleTriggers(page);
  return page.locator(TRIGGERS).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, name: el.getAttribute('aria-label') || '' };
    }),
  );
}

/** The smallest diameter among the six. */
const sizeOf = (boxes: Box[]) => Math.min(...boxes.map((b) => Math.min(b.w, b.h)));
const roundness = (boxes: Box[]) => Math.max(...boxes.map((b) => Math.abs(b.w - b.h)));

/** How many rows the six sit in (centres more than 2 px apart start a new row). */
function rowCount(boxes: Box[]): number {
  const ys = boxes.map((b) => b.y + b.h / 2).sort((a, c) => a - c);
  let rows = 1;
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 2) rows += 1;
  return rows;
}

/** Visual reading order (top row first, left to right) equals DOM (and focus) order. */
function expectReadingOrderIsDomOrder(boxes: NamedBox[]) {
  const cy = (b: Box) => b.y + b.h / 2;
  const cx = (b: Box) => b.x + b.w / 2;
  const visual = [...boxes].sort((a, c) => (Math.abs(cy(a) - cy(c)) > 2 ? cy(a) - cy(c) : cx(a) - cx(c)));
  expect(visual.map((b) => b.name)).toEqual(boxes.map((b) => b.name));
}

const EN_TYPE_ORDER = ['Hold', 'Secure', 'Lockdown', 'Fire / Evacuate', 'Shelter', 'Medical'];
const typeNameOf = (b: NamedBox) => b.name.replace(/^Trigger (.*) emergency\..*$/, '$1');

/** Six round thumb targets of at least 88 px, wholly inside the viewport on both axes, none overlapping. */
function expectSixRoundInViewport(boxes: Box[], vw: number, vh: number) {
  expectSixRoundThumbTargets(boxes, vh);
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(vw);
  }
}

function expectSameBoxes(ref: Box[], got: Box[], what: string) {
  expect(got, what).toHaveLength(ref.length);
  ref.forEach((r, i) => {
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(Math.abs(got[i][k] - r[k]), `${what}: button ${i} ${k} ${got[i][k]} vs ${r[k]}`).toBeLessThan(0.5);
    }
  });
}

function logSize(label: string, boxes: Box[]) {
  // Read by the handoff's before / after table.
  console.log(`[panic-size] ${label}: ${sizeOf(boxes).toFixed(2)} px, rows ${rowCount(boxes)}, max |w-h| ${roundness(boxes).toFixed(2)}`);
}

/** The signed-in admin's panel is fully loaded: alert line, "Send to" count, and the keep-ready card. */
async function readyWithCard(page: Page, label: string | RegExp = 'All screens (24)') {
  await expect(page.getByTestId('panic-active-alerts')).toBeVisible();
  await expect(page.getByTestId('emergency-target-label')).toHaveText(label);
  await expect(page.getByTestId('panic-keep-ready')).toBeAttached();
}

/** The status column's own scroll box: the `fixed` root around the "Send to" bar (in landscape the grid is `fixed` too, so never start from a button). */
async function statusScroll(page: Page): Promise<{ top: number; height: number; client: number }> {
  return page.getByTestId('emergency-target-bar').evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    while (n && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
    if (!n) throw new Error('no fixed panel root around the Send-to bar');
    return { top: n.scrollTop, height: n.scrollHeight, client: n.clientHeight };
  });
}

/** Right edges of everything in the status column, and the two overflow probes. */
async function statusColumn(page: Page) {
  return page.evaluate(() => {
    const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    const identity = byId('panic-identity');
    if (!identity) throw new Error('no identity chip');
    const header = identity.parentElement!.parentElement!;
    const parts: Record<string, HTMLElement | null> = {
      header,
      identity,
      voiceHint: header.nextElementSibling as HTMLElement | null,
      signInLine: byId('panic-auth-status'),
      title: byId('panic-title'),
      holdHint: byId('panic-hold-hint'),
      liveDrill: byId('emergency-mode-switch'),
      alertLine: byId('panic-active-alerts'),
      sendTo: byId('emergency-target-bar'),
      card: byId('panic-keep-ready'),
      readyLine: byId('panic-phone-ready'),
    };
    const right: Record<string, number> = {};
    for (const [k, el] of Object.entries(parts)) if (el) right[k] = el.getBoundingClientRect().right;
    return {
      right,
      headerScroll: header.scrollWidth,
      headerClient: header.clientWidth,
      docScroll: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

/** Nothing in the status column reaches into the buttons' area (8 px clear of the leftmost button), and nothing overflows sideways. */
async function expectStatusColumnClear(page: Page, boxes: Box[]) {
  const s = await statusColumn(page);
  const edge = Math.min(...boxes.map((b) => b.x)) - 8;
  // Half a pixel of layout rounding: where the buttons fill their column the
  // header's edge and the grid's padding meet exactly.
  for (const [k, r] of Object.entries(s.right)) expect(r, `${k} right edge vs the buttons`).toBeLessThanOrEqual(edge + 0.5);
  expect(s.headerScroll, 'header overflows').toBeLessThanOrEqual(s.headerClient);
  expect(s.docScroll, 'page scrolls sideways').toBeLessThanOrEqual(s.innerWidth);
}

/** Computed position of the trigger grid (the six buttons' parent). */
const gridPosition = (page: Page) =>
  page.locator(TRIGGERS).nth(2).evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).position);

// Phones held sideways. `across` and `size` come from the class geometry
// above; 844 × 390 and 740 × 360 were also measured in Chromium.
const LANDSCAPE: Array<{ w: number; h: number; across: 2 | 3; size: number; status?: true }> = [
  { w: 667, h: 375, across: 2, size: 107.7, status: true },
  { w: 740, h: 360, across: 3, size: 113.3, status: true },
  { w: 844, h: 390, across: 3, size: 148, status: true },
  { w: 915, h: 412, across: 3, size: 156, status: true },
  { w: 932, h: 430, across: 3, size: 156, status: true },
  { w: 750, h: 340, across: 3, size: 116.7, status: true }, // a 390 × 844 iPhone in Safari, bars showing
  { w: 734, h: 343, across: 3, size: 111.3, status: true },
  { w: 712, h: 325, across: 3, size: 104 },
  { w: 568, h: 320, across: 2, size: 89.3 },
  { w: 658, h: 320, across: 2, size: 89.3 },
];

// Portrait under 800 px tall, with the card and the alert line: three across,
// sized by the column (the rows have room down to about 547 px at 390 wide).
const COMPACT: Array<{ w: number; h: number; size: number }> = [
  { w: 390, h: 799, size: 111.3 },
  { w: 390, h: 750, size: 111.3 },
  { w: 390, h: 700, size: 111.3 },
  { w: 390, h: 664, size: 111.3 },
  { w: 390, h: 600, size: 111.3 },
  { w: 390, h: 560, size: 111.3 },
  { w: 390, h: 548, size: 111.3 }, // an SE-class phone in Safari
  { w: 375, h: 548, size: 106.3 },
  { w: 360, h: 640, size: 101.3 },
];

const PRE_TARGETING_LOCKDOWN = { schoolId: TENANT, type: 'lockdown', triggeredBy: 'u1', token: 'e2e-token' };

test.describe('/panic — phone landscape and short portrait screens', () => {
  for (const v of LANDSCAPE) {
    test(`${v.w}×${v.h} landscape: six round buttons, ${v.across} across, ${v.size} px, no scroll${v.status ? '; the status column in full view' : ''}`, async ({ page }, testInfo) => {
      const world = await setUp(page);
      world.active = [MEDICAL_ON_LOBBY];
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.goto('/panic');
      await readyWithCard(page);
      await page.screenshot({ path: testInfo.outputPath(`panic-landscape-${v.w}x${v.h}.png`) });

      const boxes = await namedTriggerBoxes(page);
      logSize(`landscape ${v.w}x${v.h} (card + alert)`, boxes);
      expectSixRoundInViewport(boxes, v.w, v.h);
      expect(Math.abs(sizeOf(boxes) - v.size), `size ${sizeOf(boxes)} vs ${v.size}`).toBeLessThanOrEqual(1);
      expect(rowCount(boxes)).toBe(6 / v.across);
      expect(boxes.map(typeNameOf)).toEqual(EN_TYPE_ORDER);
      expectReadingOrderIsDomOrder(boxes);

      if (v.status) {
        // With no scroll: LIVE | DRILL, the alert line and "Send to" are in full view.
        expect((await statusScroll(page)).top).toBe(0);
        await expect(page.getByTestId('emergency-mode-switch')).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId('panic-active-alerts')).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId('emergency-target-bar')).toBeInViewport({ ratio: 1 });
        await expectStatusColumnClear(page, boxes);
      }
    });
  }

  for (const v of [{ w: 844, h: 390 }, { w: 667, h: 375 }]) {
    test(`${v.w}×${v.h}: the buttons do not move for the sign-in check line, the alert line, "Not now" or DRILL`, async ({ page }) => {
      let releaseSignIn!: () => void;
      const signInGate = new Promise<void>((r) => {
        releaseSignIn = r;
      });
      const world = await setUp(page, { holdSignInCheck: signInGate });
      world.active = [MEDICAL_ON_LOBBY];
      await page.setViewportSize({ width: v.w, height: v.h });
      const signInAsked = page.waitForRequest((r) => r.url().endsWith('/users/me'));
      await page.goto('/panic');
      // The page is hydrated (it asked), and the check is held open.
      await signInAsked;
      await expect(page.getByTestId('panic-auth-status')).toBeVisible();
      const checking = await namedTriggerBoxes(page);
      logSize(`landscape ${v.w}x${v.h} (sign-in check line)`, checking);

      releaseSignIn();
      await readyWithCard(page);
      await expect(page.getByTestId('panic-auth-status')).toHaveCount(0);
      const ref = await namedTriggerBoxes(page);
      expectSixRoundInViewport(ref, v.w, v.h);
      expectSameBoxes(ref, checking, 'while the sign-in check line showed');

      await page.getByRole('button', { name: 'Not now' }).click();
      await expect(page.getByTestId('panic-keep-ready')).toHaveCount(0);
      expectSameBoxes(ref, await namedTriggerBoxes(page), 'after "Not now"');

      await page.getByTestId('emergency-mode-drill').click();
      await expect(page.locator(TRIGGERS).nth(2)).toHaveAttribute('data-mode', 'drill');
      const drill = await namedTriggerBoxes(page);
      expect(drill[2].name).toMatch(/^Start Lockdown drill/);
      expectSameBoxes(ref, drill, 'in DRILL');

      world.active = [];
      await page.reload();
      await expect(page.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
      await expect(page.getByTestId('panic-keep-ready')).toBeAttached();
      await expect(page.getByTestId('panic-active-alerts')).toHaveCount(0);
      expectSameBoxes(ref, await namedTriggerBoxes(page), 'with no alert line');
    });
  }

  test('844×390 as a set-up phone: the same six buttons; the ready line and Turn off are one scroll away', async ({ page, context, baseURL }) => {
    const world = await setUp(page);
    world.active = [MEDICAL_ON_LOBBY];
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/panic');
    await readyWithCard(page);
    const ref = await namedTriggerBoxes(page);

    // The same browser, now a set-up phone (no session in this tab).
    const phone = await context.newPage();
    const phoneWorld = await setUpPhone(phone, baseURL!);
    phoneWorld.active = [MEDICAL_ON_LOBBY];
    await phone.setViewportSize({ width: 844, height: 390 });
    await phone.goto('/panic');
    const line = phone.getByTestId('panic-phone-ready');
    await expect(line).toContainText('iPhone · Safari');
    await expect(phone.getByTestId('panic-active-alerts')).toBeVisible();
    await expect(phone.getByTestId('emergency-target-label')).toHaveText('All screens (24)');
    await expect(phone.getByTestId('panic-keep-ready')).toHaveCount(0);
    const boxes = await namedTriggerBoxes(phone);
    logSize('landscape 844x390 (set-up phone)', boxes);
    expectSameBoxes(ref, boxes, 'a set-up phone');

    const turnOff = phone.getByTestId('panic-phone-turn-off');
    await turnOff.scrollIntoViewIfNeeded();
    await expect(line).toBeInViewport({ ratio: 1 });
    await expect(turnOff).toBeInViewport({ ratio: 1 });
    expectSameBoxes(ref, await namedTriggerBoxes(phone), 'a set-up phone, scrolled to Turn off');
    await phone.close();
  });

  test('750×340 scrolled down to the card: the buttons stay exactly where they were; a short press sends nothing, the full hold sends', async ({ page }) => {
    const world = await setUp(page);
    world.active = [MEDICAL_ON_LOBBY];
    await page.setViewportSize({ width: 750, height: 340 });
    await page.goto('/panic');
    await readyWithCard(page);
    const before = await namedTriggerBoxes(page);
    expectSixRoundInViewport(before, 750, 340);

    // Scroll the status column to its end, as a swipe or a mouse wheel over
    // it does. (Not scrollIntoViewIfNeeded: it lines the card's bottom edge up
    // with the screen's, and Chromium's whole-pixel scroll offset, 59 for
    // 59.48, then leaves the card 0.48 px short of fully in view. At the end
    // of the column the card has 3.5 px to spare.)
    const card = page.getByTestId('panic-keep-ready');
    await page.mouse.move(170, 170);
    await page.mouse.wheel(0, 600);
    await expect.poll(async () => {
      const s = await statusScroll(page);
      return s.height - s.client - s.top;
    }).toBeLessThanOrEqual(1);
    await expect(card).toBeInViewport({ ratio: 1 });
    expect((await statusScroll(page)).top).toBeGreaterThan(0);
    expectSameBoxes(before, await namedTriggerBoxes(page), 'scrolled to the card');

    const lockdown = page.getByRole('button', { name: /Trigger Lockdown emergency/ });
    await hold(page, lockdown, 1200);
    await page.waitForTimeout(2500);
    expect(world.triggers).toHaveLength(0);

    await hold(page, lockdown);
    await expect(page.getByTestId('panic-sent-summary')).toHaveText('Lockdown on all 24 screens');
    expect(world.triggers).toEqual([PRE_TARGETING_LOCKDOWN]);
  });

  for (const r of [
    { from: { width: 390, height: 844 }, to: { width: 844, height: 390 } },
    { from: { width: 390, height: 664 }, to: { width: 750, height: 340 } },
  ]) {
    test(`rotating ${r.from.width}×${r.from.height} → ${r.to.width}×${r.to.height} mid-hold never remounts the pressed button: an early release sends nothing, a full hold sends once`, async ({ page }) => {
      const world = await setUp(page);
      world.active = [MEDICAL_ON_LOBBY];
      await page.setViewportSize(r.from);
      await page.goto('/panic');
      await readyWithCard(page);
      const lockdown = page.getByRole('button', { name: /Trigger Lockdown emergency/ });
      await lockdown.evaluate((el) => {
        (window as unknown as { __panicLockdown: Element }).__panicLockdown = el;
      });
      const sameNode = () =>
        lockdown.evaluate((el) => el === (window as unknown as { __panicLockdown: Element }).__panicLockdown && el.isConnected);
      const startPosition = await gridPosition(page);
      expect(startPosition).not.toBe('fixed');

      const pressAndRotate = async () => {
        const box = await lockdown.boundingBox();
        if (!box) throw new Error('Lockdown not visible');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const t0 = Date.now();
        await page.waitForTimeout(500);
        await page.setViewportSize(r.to);
        await expect.poll(() => gridPosition(page)).toBe('fixed');
        expect(await sameNode()).toBe(true);
        return t0;
      };

      // 1. Rotated half a second in, released at 1.5 s: nothing is sent.
      const t0 = await pressAndRotate();
      const early = 1500 - (Date.now() - t0);
      expect(early, 'the rotation took too long to test an early release').toBeGreaterThan(0);
      await page.waitForTimeout(early);
      await page.mouse.up();
      await page.waitForTimeout(2500);
      expect(world.triggers).toHaveLength(0);
      await expect(page.getByTestId('panic-sent-summary')).toHaveCount(0);

      // 2. Back, then a full hold across the same rotation: exactly one send.
      await page.setViewportSize(r.from);
      await expect.poll(() => gridPosition(page)).toBe(startPosition);
      expect(await sameNode()).toBe(true);
      const t1 = await pressAndRotate();
      await page.waitForTimeout(Math.max(0, 3400 - (Date.now() - t1)));
      await page.mouse.up();
      await expect(page.getByTestId('panic-sent-summary')).toHaveText('Lockdown on all 24 screens');
      expect(world.triggers).toEqual([PRE_TARGETING_LOCKDOWN]);
    });
  }

  for (const v of COMPACT) {
    test(`${v.w}×${v.h} portrait with the card and an alert: six round buttons of at least ${(v.size - 1).toFixed(1)} px; the card below them costs nothing`, async ({ page }, testInfo) => {
      const world = await setUp(page);
      world.active = [MEDICAL_ON_LOBBY];
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.goto('/panic');
      await readyWithCard(page);
      await page.screenshot({ path: testInfo.outputPath(`panic-portrait-${v.w}x${v.h}.png`) });

      const withCard = await namedTriggerBoxes(page);
      logSize(`portrait ${v.w}x${v.h} (card + alert)`, withCard);
      expectSixRoundInViewport(withCard, v.w, v.h);
      expect(sizeOf(withCard)).toBeGreaterThanOrEqual(v.size - 1);
      expect(withCard.map(typeNameOf)).toEqual(EN_TYPE_ORDER);
      expectReadingOrderIsDomOrder(withCard);
      const bottomRow = Math.max(...withCard.map((b) => b.y + b.h));
      expect(await page.getByTestId('panic-keep-ready').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(bottomRow);

      await page.getByRole('button', { name: 'Not now' }).click();
      await expect(page.getByTestId('panic-keep-ready')).toHaveCount(0);
      expectSameBoxes(withCard, await namedTriggerBoxes(page), 'after "Not now"');
    });
  }

  for (const pair of [
    [{ width: 390, height: 799 }, { width: 390, height: 800 }],
    [{ width: 844, height: 540 }, { width: 844, height: 541 }],
    [{ width: 699, height: 390 }, { width: 700, height: 390 }],
  ]) {
    test(`either side of ${pair[0].width}×${pair[0].height} | ${pair[1].width}×${pair[1].height}: six round buttons of at least 88 px`, async ({ page }) => {
      const world = await setUp(page);
      world.active = [MEDICAL_ON_LOBBY];
      for (const vp of pair) {
        await page.setViewportSize(vp);
        await page.goto('/panic');
        await readyWithCard(page);
        const boxes = await namedTriggerBoxes(page);
        logSize(`boundary ${vp.width}x${vp.height} (card + alert)`, boxes);
        expectSixRoundInViewport(boxes, vp.width, vp.height);
        expectReadingOrderIsDomOrder(boxes);
      }
    });
  }

  for (const lang of ['es', 'zh'] as const) {
    for (const v of [
      { w: 844, h: 390, voice: true },
      { w: 667, h: 375, voice: true },
      { w: 390, h: 548, voice: false },
    ]) {
      test(`${lang} at ${v.w}×${v.h}${v.voice ? ' with Voice on' : ''}: nothing overflows, six round buttons of at least 88 px`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: 'venueos_locale', value: lang, url: baseURL! }]);
        if (v.voice) {
          await page.addInitScript(() => {
            try {
              window.localStorage.setItem('venueos_emergency_voice', 'on');
            } catch {
              /* storage blocked: the assertion on the pressed toggle below fails loudly */
            }
          });
        }
        const world = await setUp(page);
        world.active = [MEDICAL_ON_LOBBY];
        await page.setViewportSize({ width: v.w, height: v.h });
        await page.goto('/panic');
        await readyWithCard(page, /24/);
        // The language took: the catalog's own title for this page.
        await expect(page.getByTestId('panic-title')).toHaveText(lang === 'es' ? 'Activar emergencia' : '紧急触发');
        if (v.voice) await expect(page.locator('button[aria-pressed="true"]')).toBeVisible();

        const boxes = await namedTriggerBoxes(page);
        logSize(`${lang} ${v.w}x${v.h}${v.voice ? ' voice on' : ''} (card + alert)`, boxes);
        expectSixRoundInViewport(boxes, v.w, v.h);
        const s = await statusColumn(page);
        expect(s.headerScroll, 'header overflows').toBeLessThanOrEqual(s.headerClient);
        expect(s.docScroll, 'page scrolls sideways').toBeLessThanOrEqual(s.innerWidth);
        if (v.w > v.h) await expectStatusColumnClear(page, boxes);
      });
    }
  }

  for (const v of [{ w: 844, h: 390 }, { w: 750, h: 340 }]) {
    test(`${v.w}×${v.h}: a chosen screen's name fits the "Send to" bar`, async ({ page }) => {
      const world = await setUp(page);
      world.active = [MEDICAL_ON_LOBBY];
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.goto('/panic');
      await readyWithCard(page);
      await page.getByTestId('emergency-choose-screens').click();
      await expect(page.getByTestId('emergency-target-picker')).toBeVisible();
      await page.getByTestId('target-option-screen-s-lobby').click();
      await expect(page.getByTestId('emergency-target-picker')).toBeHidden();
      const label = page.getByTestId('emergency-target-label');
      await expect(label).toHaveText('Lobby · 1 screen');
      const fit = await label.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fit.scroll, 'the chosen target is truncated').toBeLessThanOrEqual(fit.client);
      await expect(page.getByTestId('emergency-target-bar')).toBeInViewport({ ratio: 1 });
      expectSixRoundInViewport(await namedTriggerBoxes(page), v.w, v.h);
    });
  }
});
