/**
 * K-12 launch program, register row K12-F32 — a scoreboard console is set up
 * from the game's console, in a real browser (chromium + webkit projects):
 * pick a console model that decodes the sport and the screen wired to it,
 * Connect, see what the console sends, confirm — no kiosk URL, no feed
 * token, and a sport with no decoder says so instead of falling back to
 * football.
 *
 * Every API call is intercepted (the suite's contract — see
 * apps/web/playwright.config.ts); nothing here touches a database. The
 * box's packets are simulated by changing what the setup endpoint reports,
 * exactly what the API does when the box posts a preview. Set E2E_SHOTS_DIR
 * to keep a screenshot per step.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const SCHOOL = 'e2e-school';
const GAME = 'e2e-console-setup-000000001';
const SHOTS = process.env.E2E_SHOTS_DIR || '';

type Write = { method: string; path: string; body: Record<string, unknown> };

const MODELS = [
  { id: 'cts-gen6', label: 'Colorado Time Systems (Gen 6 / System 6)', source: 'Colorado Time Systems console', supportedSportNames: ['Water Polo'] },
  { id: 'cts-gen7', label: 'Colorado Time Systems (Gen 7 — RS-232 output)', source: 'Colorado Time Systems console', supportedSportNames: ['Water Polo'] },
  { id: 'daktronics-allsport', label: 'Daktronics All Sport 5000', source: 'Daktronics All Sport', supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'] },
];

function gameFor(sport: string) {
  const now = new Date().toISOString();
  return {
    id: GAME,
    tenantId: 't1',
    sport,
    status: 'SCHEDULED',
    segment: 1,
    homeTeam: 'Central Comets',
    awayTeam: 'Westview Wolves',
    homeScore: 0,
    awayScore: 0,
    homeColor: '#184a9d',
    awayColor: '#b52032',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 480_000,
    clockRunning: false,
    clockUpdatedAt: now,
    possession: null,
    stats: {} as Record<string, unknown>,
    spotlight: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    scheduledAt: now,
  };
}

function consoleView(sport: string, sportName: string, supportedFor: (id: string) => boolean) {
  return {
    gameId: GAME,
    sport,
    sportName,
    final: false,
    supported: MODELS.some((m) => supportedFor(m.id)),
    models: MODELS.map((m) => ({ ...m, supported: supportedFor(m.id) })),
    screens: [
      { id: 'box-gym', name: 'Gym console box', online: true, consoleProfile: null, otherGame: null },
      { id: 'lobby-tv', name: 'Lobby TV', online: true, consoleProfile: null, otherGame: null },
    ],
    binding: null as null | Record<string, unknown>,
    preview: null as null | Record<string, unknown>,
    link: null as null | Record<string, unknown>,
    serverTime: Date.now(),
  };
}

async function mockConsole(
  context: BrowserContext,
  game: ReturnType<typeof gameFor>,
  view: ReturnType<typeof consoleView>,
  writes: Write[],
) {
  const user = {
    id: 'u1',
    email: 'operator@example.test',
    role: 'SCHOOL_ADMIN',
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
    const consolePath = `/sports/games/${GAME}/scoreboard-console`;
    if (path === consolePath && req.method() === 'GET') return json({ ...view, serverTime: Date.now() });
    if (path === consolePath && req.method() === 'POST') {
      const body = (req.postDataJSON() || {}) as Record<string, unknown>;
      writes.push({ method: 'POST', path, body });
      const model = MODELS.find((m) => m.id === body.consoleProfile)!;
      view.binding = {
        screenId: body.screenId,
        screenName: view.screens.find((s) => s.id === body.screenId)!.name,
        screenOnline: true,
        consoleProfile: body.consoleProfile,
        modelLabel: model.label,
        decoderSport: game.sport,
        supportedSportNames: model.supportedSportNames,
        boundAt: new Date().toISOString(),
        confirmedAt: null,
      };
      return json({ ...view, serverTime: Date.now() });
    }
    if (path === `${consolePath}/confirm` && req.method() === 'POST') {
      writes.push({ method: 'POST', path, body: {} });
      view.binding = { ...view.binding!, confirmedAt: new Date().toISOString() };
      view.preview = null;
      // The box's next confirmed packet lands in the game record.
      game.stats = { cts: { lastUpdateAt: new Date().toISOString(), homeScore: 45, awayScore: 38 } };
      return json({ ...view, serverTime: Date.now() });
    }
    if (req.method() !== 'GET') {
      writes.push({ method: req.method(), path, body: (req.postDataJSON() || {}) as Record<string, unknown> });
      return json(game);
    }
    if (path === `/sports/games/${GAME}` || path === `/sports/board/${GAME}`) {
      // Keep the confirmed console fresh on every read, as a box posting at 5 Hz does.
      if (view.binding?.confirmedAt) {
        game.stats = { cts: { lastUpdateAt: new Date().toISOString(), homeScore: 45, awayScore: 38 } };
      }
      return json({ ...game, serverTime: Date.now() });
    }
    // The other Setup cards read their own endpoints: answer with the shapes
    // the API sends, so the page renders the whole Setup view.
    if (path === `/sports/games/${GAME}/auto-celebrate`) {
      return json({ enabled: true, off: [], cooldownSec: 0, cooldownOptions: [0, 10, 30, 60], available: [] });
    }
    if (path === `/sports/games/${GAME}/auto-push`) {
      return json({ armed: false, screenIds: [], surface: 'BOARD', leadMs: 300_000, holdMin: 10, holdOptions: [0, 2, 5, 10, 15, 30, 60], returnAt: null });
    }
    if (path === '/tenants') return json({ id: 't1', slug: SCHOOL, name: 'E2E High', vertical: 'K12', emergencyStatus: 'INACTIVE' });
    if (path === '/users/me') return json(user);
    return json(path.endsWith('s') ? [] : {});
  });
}

async function openSetupCard(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${SCHOOL}/sports/${GAME}`);
  const card = page.getByTestId('scoreboard-console-setup');
  await card.scrollIntoViewIfNeeded({ timeout: 60_000 });
  await expect(card).toBeVisible();
  return card;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.getByTestId('scoreboard-console-setup').screenshot({ path: `${SHOTS}/${name}-${test.info().project.name}.png` });
}

test.describe('K12-F32 — scoreboard console setup without a URL', () => {
  test.describe.configure({ timeout: 120_000 });

  test('basketball: model + screen → Connect → the console’s preview → confirm → live', async ({ page, context }) => {
    const writes: Write[] = [];
    const game = gameFor('basketball');
    const view = consoleView('basketball', 'Basketball', (id) => id === 'daktronics-allsport');
    await mockConsole(context, game, view, writes);
    const card = await openSetupCard(page);

    // Only the model that decodes basketball is offered; nothing asks for a URL.
    const model = card.getByTestId('scoreboard-console-model');
    await expect(model.locator('option')).toHaveText(['Choose the console', 'Daktronics All Sport 5000 — reads Football, Basketball, Baseball, Softball only']);
    await expect(page.locator('body')).not.toContainText('?cts=1');
    await expect(page.locator('body')).not.toContainText('feedToken=');
    await shot(page, 'f32-1-unbound');

    await model.selectOption('daktronics-allsport');
    await card.getByTestId('scoreboard-console-screen').selectOption('box-gym');
    await card.getByTestId('scoreboard-console-connect').click();
    await expect(card.getByTestId('scoreboard-console-state')).toHaveAttribute('data-state', 'waiting-box');
    expect(writes.find((w) => w.path.endsWith('/scoreboard-console'))?.body).toEqual({
      screenId: 'box-gym',
      consoleProfile: 'daktronics-allsport',
    });
    await shot(page, 'f32-2-waiting');

    // The box opens its port and the console starts talking (preview only).
    view.link = { reportedAt: new Date().toISOString(), status: 'connected', bytes: 4096, goodFrames: 31, badFrames: 0, native: true };
    view.preview = {
      receivedAt: new Date().toISOString(),
      screenId: 'box-gym',
      decoderSport: 'basketball',
      clockMs: 435_000,
      clockRunning: true,
      segment: 2,
      homeScore: 45,
      awayScore: 38,
    };
    const preview = card.getByTestId('scoreboard-console-preview');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview).toContainText('7:15');
    await expect(preview).toContainText('45');
    await expect(preview).toContainText('38');
    await shot(page, 'f32-3-preview');

    await card.getByTestId('scoreboard-console-confirm').click();
    await expect.poll(() => writes.some((w) => w.path.endsWith('/scoreboard-console/confirm'))).toBe(true);
    await expect(card.getByTestId('scoreboard-console-state')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
    await expect(card.getByTestId('scoreboard-console-state')).toContainText('Live from the console');
    await shot(page, 'f32-4-live');
  });

  test('volleyball: no console decodes it — the card says so, and offers nothing to pick', async ({ page, context }) => {
    const writes: Write[] = [];
    const game = gameFor('volleyball');
    const view = consoleView('volleyball', 'Volleyball', () => false);
    await mockConsole(context, game, view, writes);
    const card = await openSetupCard(page);
    await expect(card.getByTestId('scoreboard-console-unsupported')).toContainText('No scoreboard console decodes Volleyball yet.');
    await expect(card.getByTestId('scoreboard-console-model')).toHaveCount(0);
    await shot(page, 'f32-5-unsupported');
    expect(writes.filter((w) => w.path.includes('scoreboard-console'))).toEqual([]);
  });
});
