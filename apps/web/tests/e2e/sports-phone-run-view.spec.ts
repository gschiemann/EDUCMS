/**
 * K-12 launch program, register row K12-F15 — the phone Run view carries
 * EVERY control the desktop Run view has, at 360 / 390 / 430 px upright and
 * at 844 × 390 / 740 × 360 held sideways, in a real browser (chromium +
 * webkit projects). Plus the desktop typed fields: Escape cancels, never
 * saves.
 *
 * Audit evidence this pins shut (docs/research/2026-09-23-k12-sports-
 * readiness-audit, verified-console-phone-webkit.png): at 390 px the desktop
 * grid with team fouls / timeouts, the shot clock, possession and exact-time
 * correction was hidden; "End game" was cut in half and More was off-screen
 * in a sideways scroller; the event log's Undo appeared only on hover.
 *
 * Every assertion is a hard locator / geometry check that FAILS on
 * regression:
 *   - no horizontal page scroll and no element past the right edge;
 *   - every visible button / input / link inside the game console is at
 *     least 44 × 44 px (the phone touch floor);
 *   - the timeout / foul / possession / shot-reset / exact-time / undo /
 *     penalty scenarios send the SAME API calls the desktop controls send,
 *     each carrying a durable command id (K12-F10);
 *   - sideways, the score and the clock stay on screen while the controls
 *     scroll (K12-F15 landscape);
 *   - Escape on a typed field restores the old value and sends nothing.
 *
 * Every API call is intercepted (the suite's contract — see
 * apps/web/playwright.config.ts); nothing here touches a database. Set
 * E2E_SHOTS_DIR to keep a screenshot per sport and width.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const SCHOOL = 'e2e-school';
const GAME = 'e2e-phone-run-000000000001';
const WIDTHS = [360, 390, 430] as const;
const LANDSCAPE = [
  { width: 844, height: 390 },
  { width: 740, height: 360 },
] as const;
const SHOTS = process.env.E2E_SHOTS_DIR || '';
const COMMAND_ID = /^cmd-[0-9a-f]{32}$/;

type Write = { method: string; path: string; body: Record<string, unknown> };

function gameFor(sport: string) {
  const now = new Date().toISOString();
  return {
    id: GAME,
    tenantId: 't1',
    sport,
    status: 'LIVE',
    segment: 2,
    homeTeam: 'Central Comets',
    awayTeam: 'Westview Wolves',
    homeScore: 32,
    awayScore: 28,
    homeColor: '#184a9d',
    awayColor: '#b52032',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 252_000,
    clockRunning: false,
    clockUpdatedAt: now,
    possession: 'home',
    stats: {
      homeFouls: 5,
      awayFouls: 7,
      homeTimeouts: 3,
      awayTimeouts: 2,
      shotClock: { len: 35, ms: 35_000, running: false, at: now },
      penalties: [],
    },
    spotlight: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    scheduledAt: null,
  };
}

async function mockConsole(context: BrowserContext, sport: string, writes: Write[]) {
  const user = {
    id: 'u1',
    email: 'operator@example.test',
    role: 'CONTRIBUTOR',
    tenantId: 't1',
    tenantSlug: SCHOOL,
    tenantName: 'E2E High',
    tenantVertical: 'K12',
    firstName: 'Game',
    lastName: 'Operator',
    canTriggerPanic: false,
  };
  await context.addInitScript(
    ([u]) => {
      try {
        window.sessionStorage.setItem('edu_cms_token', 'e2e-token');
        window.sessionStorage.setItem('edu_cms_user', u as string);
      } catch {
        /* storage blocked — the test fails loudly on the login redirect */
      }
    },
    [JSON.stringify(user)],
  );
  const state = gameFor(sport);
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
    const origin = req.headers()['origin'] || '*';
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (req.method() !== 'GET') {
      writes.push({ method: req.method(), path, body: (req.postDataJSON() || {}) as Record<string, unknown> });
      return json(state);
    }
    if (path === `/sports/games/${GAME}` || path === `/sports/board/${GAME}`) {
      return json({ ...state, serverTime: Date.now() });
    }
    if (path === `/sports/games/${GAME}/events`) {
      return json([
        {
          id: 'ev1',
          type: 'SCORE',
          payload: { team: 'home', delta: 2, homeScore: 32, awayScore: 28 },
          undoable: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    if (path === '/tenants') return json({ id: 't1', slug: SCHOOL, name: 'E2E High', vertical: 'K12', emergencyStatus: 'INACTIVE' });
    if (path === '/users/me') return json(user);
    // Everything else the dashboard chrome asks for — an empty list/object is
    // the shape every one of those hooks tolerates.
    return json(path.endsWith('s') ? [] : {});
  });
}

async function openRunView(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/${SCHOOL}/sports/${GAME}`);
  await expect(page.getByTestId('phone-run-trays')).toBeVisible({ timeout: 60_000 });
}

/** Page never scrolls sideways and nothing pokes past the right edge. */
async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const past = Array.from(document.querySelectorAll('[data-testid="game-console"] *'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1;
      })
      .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)}`);
    return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, past };
  });
  expect(report.scroll).toBeLessThanOrEqual(1);
  expect(report.past).toEqual([]);
}

/** Every visible control in the game console is at least 44 × 44 px. */
async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const root = document.querySelector('[data-testid="game-console"]');
    if (!root) return ['no game console'];
    for (const el of Array.from(root.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.width < 44 || r.height < 44) {
        const name = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30);
        // Name the nearest test id too, so a failure says WHERE the control lives.
        const host = el.parentElement?.closest('[data-testid]')?.getAttribute('data-testid') || '?';
        out.push(`${name} ${Math.round(r.width)}×${Math.round(r.height)} in ${host}`);
      }
    }
    return out;
  });
  expect(small).toEqual([]);
}

test.describe('K12-F15 — phone Run view parity', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const width of WIDTHS) {
    test(`basketball at ${width} px: every desktop control, no sideways scroll, 44 px targets`, async ({ page, context }) => {
      const writes: Write[] = [];
      await mockConsole(context, 'basketball', writes);
      await openRunView(page, width);

      const trays = page.getByTestId('phone-run-trays');
      // The controls the audit found missing on the phone.
      await expect(trays.getByTestId('phone-clock-tray')).toBeVisible();
      await expect(trays.getByRole('button', { name: /take one second off/i })).toBeVisible();
      await expect(trays.getByRole('button', { name: /add one second/i })).toBeVisible();
      await expect(trays.getByRole('button', { name: 'Set time' })).toBeVisible();
      await expect(trays.getByTestId('phone-shot-clock-tray')).toBeVisible();
      await expect(trays.getByRole('button', { name: /reset the shot clock to 35/i })).toBeVisible();
      await expect(trays.getByTestId('phone-possession-tray')).toBeVisible();
      await expect(trays.getByTestId('team-stat-grid')).toBeVisible();
      await expect(trays.getByRole('button', { name: /increase central comets fouls/i })).toBeVisible();
      await expect(trays.getByRole('button', { name: /timeout — central comets/i })).toBeVisible();
      await expect(trays.getByTestId('phone-last-change')).toBeVisible();
      await expect(trays.getByTestId('phone-scoring-source')).toContainText(/this console/i);

      // Header: the state transitions and More are fully on screen.
      for (const name of [/^halftime$/i, /end game/i, /^more$/i]) {
        const box = await page.getByRole('button', { name }).first().boundingBox();
        expect(box, `${name} is rendered`).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }

      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      if (SHOTS) {
        const tag = `${test.info().project.name}-${width}`;
        await page.screenshot({ path: `${SHOTS}/run-basketball-${tag}.png`, fullPage: false });
        // The deck scrolls inside the console: bring the trays up, then the stat grid.
        await trays.getByTestId('phone-clock-tray').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/run-basketball-trays-${tag}.png`, fullPage: false });
        await trays.getByTestId('team-stat-grid').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/run-basketball-stats-${tag}.png`, fullPage: false });
      }
    });
  }

  test('basketball at 390 px: timeout, foul, possession, shot reset, exact time and undo send the desktop calls', async ({
    page,
    context,
  }) => {
    const writes: Write[] = [];
    await mockConsole(context, 'basketball', writes);
    await openRunView(page, 390);
    const trays = page.getByTestId('phone-run-trays');

    await trays.getByRole('button', { name: /timeout — westview wolves/i }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith('/timeout'))?.body).toMatchObject({ team: 'away' });

    await trays.getByRole('button', { name: /increase central comets fouls/i }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith('/stats'))?.body).toMatchObject({ stats: { homeFouls: 6 } });

    await trays.getByTestId('phone-possession-tray').getByRole('button', { name: /westview wolves/i }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith('/possession'))?.body).toMatchObject({ team: 'away' });

    // The game runs a 35-second shot clock — the reset is 35, not the sport's 24.
    await trays.getByRole('button', { name: /reset the shot clock to 35/i }).click();
    await expect
      .poll(() => writes.find((w) => w.path.endsWith('/shot-clock'))?.body)
      .toMatchObject({ action: 'reset', value: 35 });

    await trays.getByRole('button', { name: 'Set time' }).click();
    const field = trays.getByRole('textbox', { name: /exact game clock time/i });
    await field.fill('0:30');
    await trays.getByRole('button', { name: 'Set', exact: true }).click();
    await expect
      .poll(() => writes.find((w) => w.path.endsWith('/clock'))?.body)
      .toMatchObject({ action: 'set', ms: 30_000 });

    // Tenths are typable in the final seconds (K12-F17): "4.3".
    await trays.getByRole('button', { name: 'Set time' }).click();
    await trays.getByRole('textbox', { name: /exact game clock time/i }).fill('4.3');
    await trays.getByRole('button', { name: 'Set', exact: true }).click();
    await expect
      .poll(() => writes.filter((w) => w.path.endsWith('/clock')).map((w) => w.body.ms))
      .toContain(4300);

    // Escape throws a typed time away.
    const clockWrites = writes.filter((w) => w.path.endsWith('/clock')).length;
    await trays.getByRole('button', { name: 'Set time' }).click();
    const typed = trays.getByRole('textbox', { name: /exact game clock time/i });
    await typed.fill('9:59');
    await typed.press('Escape');
    await expect(typed).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(writes.filter((w) => w.path.endsWith('/clock')).length).toBe(clockWrites);

    // Undo is deliberate on a phone: the first tap arms, the second sends.
    const undo = trays.getByTestId('phone-last-change').getByRole('button');
    await undo.click();
    await expect(undo).toHaveText(/tap again to undo/i);
    expect(writes.some((w) => w.path.includes('/undo'))).toBe(false);
    await undo.click();
    await expect.poll(() => writes.some((w) => w.path === `/sports/games/${GAME}/events/ev1/undo`)).toBe(true);

    // Every operator write carries its durable command id (K12-F10). An
    // event undo is keyed by the event it reverses (single-use server-side,
    // K12-F09), so it needs none.
    for (const w of writes.filter((x) => !x.path.endsWith('/undo'))) {
      expect(String(w.body.commandId), `${w.method} ${w.path}`).toMatch(COMMAND_ID);
    }
  });

  test('hockey at 390 px: the penalty box is one tap from the phone trays', async ({ page, context }) => {
    await mockConsole(context, 'hockey', []);
    await openRunView(page, 390);
    await page.getByTestId('phone-run-trays').getByRole('button', { name: /penalty box/i }).click();
    await expect(page.getByRole('dialog', { name: /penalty box/i })).toBeVisible();
  });

  for (const sport of ['football', 'baseball', 'volleyball', 'gymnastics', 'water_polo', 'wrestling']) {
    test(`${sport} at 360 px: no sideways scroll, 44 px targets`, async ({ page, context }) => {
      await mockConsole(context, sport, []);
      await openRunView(page, 360);
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/run-${sport}-${test.info().project.name}-360.png`, fullPage: false });
    });
  }

  test('gymnastics at 390 px: judged totals are typed as decimals, never +1 chips', async ({ page, context }) => {
    const writes: Write[] = [];
    await mockConsole(context, 'gymnastics', writes);
    await openRunView(page, 390);
    // No +1/+5/+10 chips — on a scaled total a +1 would add 0.001.
    await expect(page.getByRole('button', { name: '+1', exact: true })).toHaveCount(0);
    const home = page.getByRole('textbox', { name: /central comets total/i });
    await home.fill('195.825');
    await home.press('Enter');
    await expect.poll(() => writes.find((w) => w.path.endsWith('/score'))?.body).toMatchObject({ homeScore: 195825 });
  });
});

/** Is this element fully inside the viewport? Returns its box. */
async function inView(page: Page, testId: string) {
  const box = await page.getByTestId(testId).first().boundingBox();
  const vp = page.viewportSize()!;
  expect(box, `${testId} is rendered`).not.toBeNull();
  expect(box!.y, `${testId} top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${testId} bottom`).toBeLessThanOrEqual(vp.height + 1);
  expect(box!.x + box!.width, `${testId} right`).toBeLessThanOrEqual(vp.width + 1);
  return box!;
}

test.describe('K12-F15 — the Run view on a phone held sideways', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const size of LANDSCAPE) {
    for (const sport of ['basketball', 'football', 'hockey']) {
      test(`${sport} at ${size.width}×${size.height}: score and clock pinned, controls scroll, 44 px targets`, async ({
        page,
        context,
      }) => {
        await mockConsole(context, sport, []);
        await page.setViewportSize(size);
        await page.goto(`/${SCHOOL}/sports/${GAME}`);
        await expect(page.getByTestId('run-landscape')).toBeVisible({ timeout: 60_000 });

        // The two scores and the clock are fully on screen…
        const home = await inView(page, 'dock-score-home');
        await inView(page, 'dock-score-away');
        await inView(page, 'dock-clock');
        // …and stay put while the controls pane scrolls to its end.
        const controls = page.getByTestId('run-landscape-controls');
        const scrollable = await controls.evaluate((el) => el.scrollHeight - el.clientHeight);
        await controls.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const after = await inView(page, 'dock-score-home');
        expect(Math.abs(after.y - home.y)).toBeLessThanOrEqual(1);
        await inView(page, 'dock-clock');
        // The controls really do scroll on their own when they overflow.
        if (scrollable > 0) {
          expect(await controls.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        }

        await expectNoHorizontalOverflow(page);
        await expectTouchTargets(page);
        if (SHOTS) {
          await controls.evaluate((el) => {
            el.scrollTop = 0;
          });
          await page.screenshot({
            path: `${SHOTS}/run-${sport}-${test.info().project.name}-${size.width}x${size.height}.png`,
          });
        }
      });
    }
  }
});

test.describe('K12-F15 — desktop typed fields: Escape cancels, never saves', () => {
  test.describe.configure({ timeout: 120_000 });

  test('gymnastics judged total and Current Apparatus at 1280 px', async ({ page, context }) => {
    const writes: Write[] = [];
    await mockConsole(context, 'gymnastics', writes);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${SCHOOL}/sports/${GAME}`);
    const total = page.getByRole('textbox', { name: 'Home team total' });
    await expect(total).toBeVisible({ timeout: 60_000 });

    // The judged total: Escape restores the live value and writes nothing.
    const before = await total.inputValue();
    await total.fill('199.500');
    await total.press('Escape');
    await expect(total).toHaveValue(before);
    // Current Apparatus (a game-scope text field): same contract.
    const apparatus = page.getByRole('textbox', { name: /current apparatus/i });
    await apparatus.fill('Vault');
    await apparatus.press('Escape');
    await expect(apparatus).toHaveValue('');
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);

    // Enter commits once; tapping into a field and out writes nothing.
    await total.fill('195.825');
    await total.press('Enter');
    await expect
      .poll(() => writes.filter((w) => w.path.endsWith('/score')).map((w) => w.body))
      .toEqual([expect.objectContaining({ homeScore: 195825 })]);
    await apparatus.fill('Beam');
    await apparatus.press('Enter');
    await expect
      .poll(() => writes.filter((w) => w.path.endsWith('/stats')).map((w) => w.body))
      .toEqual([expect.objectContaining({ stats: { currentApparatus: 'Beam' } })]);
    await apparatus.focus();
    await apparatus.blur();
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.path.endsWith('/stats')).length).toBe(1);
  });
});
