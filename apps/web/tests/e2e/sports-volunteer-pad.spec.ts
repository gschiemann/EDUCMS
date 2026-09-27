/**
 * K-12 launch program, register row K12-F16 — the volunteer scorekeeper pad
 * (/console/<token>) in a real browser (chromium + webkit projects): phones
 * held upright at 360 / 390 / 430 px and sideways at 844 × 390 / 740 × 360.
 *
 * Audit evidence this pins shut (docs/research/2026-09-23-k12-sports-
 * readiness-audit, verified-volunteer-offline-webkit.png): the pad had
 * score / clock / period / timeouts / cues only, the same controls for every
 * link, and after 11 seconds of failed board reads it still showed a red
 * "LIVE" with no warning.
 *
 * What is asserted (hard locator / geometry checks, never a painted-true
 * screenshot):
 *   - each link SCOPE sees exactly its duties — the pad renders the `allows`
 *     list the server's /session answers with (the mock computes it with the
 *     real consoleAllows, as the API does); the API enforces the same table on
 *     every tap (apps/api/src/sports/sports-console.controller.spec.ts);
 *   - every tap carries a durable command id; a tap with no response is
 *     queued and replayed under the SAME id; "Send again" reuses the id;
 *   - Undo reverses THIS link's latest action by its command id, once;
 *   - a FINAL game says so and refuses taps;
 *   - no sideways scroll, every control ≥ 44 × 44 px; sideways, the score
 *     and the clock never scroll away while the controls do;
 *   - a stalled read stream → persistent "connection lost", never LIVE,
 *     controls paused; reads back → the volunteer confirms the score first;
 *   - the clock takes "4.3" (tenths) and Escape cancels the typed time.
 *
 * Every API call is intercepted (the suite's contract — see
 * apps/web/playwright.config.ts). Set E2E_SHOTS_DIR to keep screenshots.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { consoleAllows, findSport, type ConsoleScope } from '@cms/api-types';

const GAME = 'e2e-volunteer-pad-00000000001';
const WIDTHS = [360, 390, 430] as const;
const LANDSCAPE = [
  { width: 844, height: 390 },
  { width: 740, height: 360 },
] as const;
const SHOTS = process.env.E2E_SHOTS_DIR || '';
const COMMAND_ID = /^cmd-[0-9a-f]{32}$/;

/** The scope lives inside the MAC, never in the token text — so the mock
 *  tells links apart by their MAC, exactly as opaquely as the pad must. */
const MAC: Record<ConsoleScope, string> = {
  full: 'f'.repeat(32),
  table: 'a'.repeat(32),
  scorer: 'b'.repeat(32),
  timer: 'c'.repeat(32),
  shot: 'd'.repeat(32),
  presentation: 'e'.repeat(32),
};
const tokenFor = (scope: ConsoleScope) => `${GAME}.3.1789999999.86400.${MAC[scope]}`;
const scopeOfToken = (token: string): ConsoleScope | null => {
  const mac = token.split('.')[4];
  const hit = (Object.keys(MAC) as ConsoleScope[]).find((s) => MAC[s] === mac);
  return hit || null;
};

/** What each basketball link must show — written out by hand, so a change
 *  to the scope table is a deliberate edit here, not a silent drift. */
const BASKETBALL_SECTIONS: Record<ConsoleScope, string[]> = {
  full: ['pad-score', 'pad-clock', 'pad-period', 'pad-team', 'pad-cues'],
  table: ['pad-score', 'pad-clock', 'pad-shot-clock', 'pad-period', 'pad-team', 'pad-possession', 'pad-cues'],
  scorer: ['pad-score', 'pad-team', 'pad-possession', 'pad-cues'],
  timer: ['pad-clock', 'pad-period', 'pad-team'],
  shot: ['pad-shot-clock'],
  presentation: ['pad-cues'],
};
const ALL_SECTIONS = [
  'pad-score',
  'pad-clock',
  'pad-shot-clock',
  'pad-play-clock',
  'pad-period',
  'pad-team',
  'pad-possession',
  'pad-penalties',
  'pad-cues',
];
const ROLE_TEXT: Record<ConsoleScope, RegExp> = {
  full: /limited controls/i,
  table: /scorer's table link/i,
  scorer: /scorekeeper link — score, timeouts and team stats/i,
  timer: /clock operator link/i,
  shot: /shot clock link/i,
  presentation: /celebrations link/i,
};

type Write = { method: string; path: string; body: Record<string, unknown> };

interface PadMock {
  writes: Write[];
  state: Record<string, unknown> & { stats: Record<string, unknown> };
  /** Board reads fail at the network level while true. */
  boardDown: boolean;
  /** Status (and API error code) to answer console mutations with. */
  mutationStatus: number;
  mutationCode: string;
  /** Abort console mutations at the network level. */
  mutationNetworkFail: boolean;
  /** Status / code for POST /undo. */
  undoStatus: number;
  undoCode: string;
}

async function mockPad(
  page: Page,
  opts: { sport?: string; session?: 'ok' | 'revoked' | 'pre-scope-api'; status?: string } = {},
): Promise<PadMock> {
  const sport = opts.sport || 'basketball';
  const now = new Date().toISOString();
  const mock: PadMock = {
    writes: [],
    boardDown: false,
    mutationStatus: 200,
    mutationCode: '',
    mutationNetworkFail: false,
    undoStatus: 200,
    undoCode: '',
    state: {
      id: GAME,
      sport,
      status: opts.status || 'LIVE',
      segment: 2,
      homeTeam: 'Central Comets',
      awayTeam: 'Westview Wolves',
      homeScore: 32,
      awayScore: 28,
      homeColor: '#38bdf8',
      awayColor: '#f472b6',
      clockMs: 252_000,
      clockRunning: false,
      clockUpdatedAt: now,
      possession: 'home',
      revision: 40,
      stats: {
        homeFouls: 5,
        awayFouls: 2,
        homeTimeouts: 3,
        awayTimeouts: 2,
        shotClock: { len: 35, ms: 35_000, running: false, at: now },
        playClock: { ms: 40_000, running: false, at: now },
        down: 2,
        distance: 7,
        ballOn: 35,
      },
    },
  };
  let lastScore: { team: string; delta: number } | null = null;
  await page.context().route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
    const origin = req.headers()['origin'] || '*';
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const s = mock.state;

    const m = /^\/sports\/console\/([^/]+)(\/.*)$/.exec(path);
    if (m && m[2] === '/session') {
      if (opts.session === 'revoked') return json({ code: 'SPORTS_CONSOLE_TOKEN_INVALID' }, 401);
      const scope = scopeOfToken(decodeURIComponent(m[1]));
      if (!scope) return json({ code: 'SPORTS_CONSOLE_TOKEN_INVALID' }, 401);
      return json({
        ok: true,
        gameId: GAME,
        sport,
        status: s.status,
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        // An API from before scopes answered with neither field.
        ...(opts.session === 'pre-scope-api' ? {} : { scope, allows: consoleAllows(scope, findSport(sport)) }),
      });
    }
    if (path === `/sports/board/${GAME}`) {
      if (mock.boardDown) return route.abort('internetdisconnected');
      return json({ ...s, serverTime: Date.now() });
    }
    if (m) {
      const body = (req.postDataJSON() || {}) as Record<string, unknown>;
      mock.writes.push({ method: req.method(), path: m[2], body });
      if (mock.mutationNetworkFail) return route.abort('internetdisconnected');
      if (m[2] === '/undo') {
        if (mock.undoStatus !== 200) return json({ code: mock.undoCode }, mock.undoStatus);
        if (lastScore) {
          const key = lastScore.team === 'home' ? 'homeScore' : 'awayScore';
          s[key] = Number(s[key]) - lastScore.delta;
          lastScore = null;
        }
        s.revision = Number(s.revision) + 1;
        return json({ ...s, version: s.revision });
      }
      if (mock.mutationStatus !== 200) {
        if (mock.mutationCode === 'GAME_FINAL') s.status = 'FINAL';
        return json({ code: mock.mutationCode }, mock.mutationStatus);
      }
      if (m[2] === '/score' && typeof body.delta === 'number') {
        const key = body.team === 'home' ? 'homeScore' : 'awayScore';
        s[key] = Number(s[key]) + body.delta;
        lastScore = { team: String(body.team), delta: body.delta };
      }
      s.revision = Number(s.revision) + 1;
      return json({ ...s, version: s.revision });
    }
    return json(path.endsWith('s') ? [] : {});
  });
  return mock;
}

async function openPad(page: Page, scope: ConsoleScope, size: { width: number; height: number } = { width: 390, height: 844 }) {
  await page.setViewportSize(size);
  await page.goto(`/console/${tokenFor(scope)}`);
  await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'live-game', { timeout: 60_000 });
}

/** No sideways scroll; every visible control ≥ 44 × 44 px. */
async function expectPhoneLayout(page: Page) {
  const report = await page.evaluate(() => {
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll('button, a[href], input, select, textarea'))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('nextjs-portal')) continue; // Next's dev-only overlay button
      if (r.width < 44 || r.height < 44) {
        const name = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30);
        small.push(`${name} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
  });
  expect(report.scroll).toBeLessThanOrEqual(1);
  expect(report.small).toEqual([]);
}

/** Sideways: nothing scrolls sideways, the score and clock sit fully on
 *  screen and stay there — whether the document or the controls pane is
 *  scrolled. (The pad is pinned to the viewport; the root layout's 384 px
 *  decorative backdrop still makes a 360 px-tall document scroll 24 px, which
 *  must move nothing on the pad.) */
async function expectLandscapeLayout(page: Page) {
  const inView = async (testId: string) => {
    const box = await page.getByTestId(testId).boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box, `${testId} is rendered`).not.toBeNull();
    expect(box!.y, `${testId} top`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `${testId} bottom`).toBeLessThanOrEqual(vh + 1);
    return box!;
  };
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, 'the page does not scroll sideways').toBeLessThanOrEqual(1);
  const before = await inView('pad-scoreboard');
  await inView('pad-clock-readout');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const pinned = await inView('pad-scoreboard');
  expect(Math.abs(pinned.y - before.y), 'a document scroll moves nothing on the pad').toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Scroll the controls pane to its end: the last section comes on screen,
  // the scoreboard does not move.
  await page.getByTestId('pad-controls').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const lastSection = await page
    .getByTestId('pad-controls')
    .evaluate((el) => Array.from(el.querySelectorAll('section[data-testid]')).pop()?.getAttribute('data-testid') || '');
  expect(lastSection).not.toBe('');
  await inView(lastSection);
  const after = await inView('pad-scoreboard');
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  await expectPhoneLayout(page);
}

const plus = (page: Page, n: number) =>
  page.getByTestId('pad-score').getByRole('button', { name: `+${n}`, exact: true }).first();

test.describe('K12-F16 — volunteer pad', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const width of WIDTHS) {
    for (const scope of ['table', 'scorer', 'timer', 'shot', 'presentation'] as ConsoleScope[]) {
      test(`basketball ${scope} link at ${width} px shows exactly its duties`, async ({ page }) => {
        await mockPad(page);
        await openPad(page, scope, { width, height: 844 });
        await expect(page.getByTestId('pad-role')).toContainText(ROLE_TEXT[scope]);
        for (const id of ALL_SECTIONS) {
          await expect(page.getByTestId(id), `${scope}: ${id}`).toHaveCount(BASKETBALL_SECTIONS[scope].includes(id) ? 1 : 0);
        }
        // Inside the team card: fouls need `stats`, the timeout call needs `timeout`.
        const allows = consoleAllows(scope, findSport('basketball'));
        await expect(page.getByRole('button', { name: /increase central comets fouls/i })).toHaveCount(
          allows.includes('stats') ? 1 : 0,
        );
        await expect(page.getByRole('button', { name: /timeout — central comets/i })).toHaveCount(
          allows.includes('timeout') ? 1 : 0,
        );
        await expectPhoneLayout(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-basketball-${scope}-${test.info().project.name}-${width}.png`, fullPage: true });
      });
    }
  }

  for (const size of LANDSCAPE) {
    for (const [sport, scope] of [
      ['basketball', 'table'],
      ['basketball', 'scorer'],
      ['football', 'table'],
      ['hockey', 'table'],
    ] as [string, ConsoleScope][]) {
      test(`${sport} ${scope} link held sideways at ${size.width}×${size.height}: score and clock stay put, controls scroll`, async ({
        page,
      }) => {
        await mockPad(page, { sport });
        await openPad(page, scope, size);
        await expectLandscapeLayout(page);
        if (SHOTS) {
          await page.getByTestId('pad-controls').evaluate((el) => {
            el.scrollTop = 0;
          });
          await page.screenshot({ path: `${SHOTS}/pad-${sport}-${scope}-${test.info().project.name}-${size.width}x${size.height}.png` });
        }
      });
    }
  }

  test('sideways at 740×360: while the reads are stale the score is still on screen and says "last known"', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'table', { width: 740, height: 360 });
    mock.boardDown = true;
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'stale', { timeout: 15_000 });
    const box = await page.getByTestId('pad-scoreboard').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(361);
    await expect(page.getByTestId('pad-scoreboard')).toContainText(/last known/i);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-stale-${test.info().project.name}-740x360.png` });
  });

  test('every tap carries a durable command id', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'table');
    await plus(page, 3).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/score')?.body).toMatchObject({ team: 'home', delta: 3 });
    await page.getByTestId('pad-possession').getByRole('button', { name: /westview wolves/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/possession')?.body).toMatchObject({ team: 'away' });
    const ids = mock.writes.map((w) => String(w.body.commandId));
    for (const id of ids) expect(id).toMatch(COMMAND_ID);
    expect(new Set(ids).size).toBe(ids.length);
    // The scoreboard folds the server's answer in.
    await expect(page.getByTestId('pad-scoreboard')).toContainText('35');
  });

  test('a clock-operator link runs the clock and has no score controls', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'timer');
    await expect(page.getByRole('button', { name: '+2', exact: true })).toHaveCount(0);
    await page.getByTestId('pad-clock').getByRole('button', { name: /start clock/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/clock')?.body).toMatchObject({ action: 'start' });
  });

  test('the clock takes seconds and tenths ("4.3"); Escape cancels the typed time', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'timer');
    const clock = page.getByTestId('pad-clock');
    await clock.getByRole('button', { name: 'Set', exact: true }).click();
    const field = clock.getByRole('textbox', { name: /set the game clock/i });
    await field.fill('1:00');
    await field.press('Escape');
    await expect(field).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(mock.writes.filter((w) => w.path === '/clock')).toEqual([]);

    await clock.getByRole('button', { name: 'Set', exact: true }).click();
    await clock.getByRole('textbox', { name: /set the game clock/i }).fill('4.3');
    await clock.getByRole('button', { name: /apply/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/clock')?.body).toMatchObject({ action: 'set', ms: 4300 });
  });

  test('a football play-clock link resets to 25 and does nothing else', async ({ page }) => {
    const mock = await mockPad(page, { sport: 'football' });
    await openPad(page, 'shot');
    await expect(page.getByTestId('pad-role')).toContainText(/play clock link/i);
    await expect(page.getByTestId('pad-score')).toHaveCount(0);
    await expect(page.getByTestId('pad-shot-clock')).toHaveCount(0);
    await page.getByTestId('pad-play-clock').getByRole('button', { name: '25', exact: true }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/play-clock')?.body).toMatchObject({ action: 'reset', value: 25 });
    await expectPhoneLayout(page);
  });

  test('a scorekeeper sets team fouls and the possession arrow', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    await page.getByRole('button', { name: /increase westview wolves fouls/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/stats')?.body).toMatchObject({ stats: { awayFouls: 3 } });
    await page.getByTestId('pad-possession').getByRole('button', { name: /westview wolves/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/possession')?.body).toMatchObject({ team: 'away' });
  });

  test("Undo reverses this link's own last tap by its command id, once", async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    await plus(page, 2).click();
    const card = page.getByTestId('pad-undo');
    await expect(card).toContainText(/central comets \+2/i);
    const scoreId = mock.writes.find((w) => w.path === '/score')!.body.commandId;

    const undo = card.getByRole('button');
    await undo.click();
    await expect(undo).toHaveText(/tap again to undo/i);
    expect(mock.writes.some((w) => w.path === '/undo')).toBe(false);
    await undo.click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/undo')?.body).toEqual({ undoOf: scoreId });
    await expect(page.getByTestId('pad-undone')).toContainText(/undone: central comets \+2/i);
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('pad-scoreboard')).toContainText('32');
  });

  test('an Undo the server refuses (not the latest) says why and is not offered again', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    await plus(page, 1).click();
    await expect(page.getByTestId('pad-undo')).toBeVisible();
    mock.undoStatus = 409;
    mock.undoCode = 'CONSOLE_UNDO_NOT_LATEST';
    const undo = page.getByTestId('pad-undo').getByRole('button');
    await undo.click();
    await undo.click();
    await expect(page.getByTestId('pad-rejected')).toContainText(/made another change after that one/i);
    await expect(page.getByTestId('pad-undo')).toHaveCount(0);
  });

  test('a tap with no response is queued and replayed under the SAME command id', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    mock.mutationNetworkFail = true;
    await plus(page, 2).click();
    await expect(page.getByTestId('pad-queued')).toContainText(/1 tap is waiting/i);
    // Nothing the server has not confirmed is offered as Undo.
    await expect(page.getByTestId('pad-undo')).toHaveCount(0);
    mock.mutationNetworkFail = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('pad-queued')).toHaveCount(0, { timeout: 15_000 });
    const sent = mock.writes.filter((w) => w.path === '/score').map((w) => w.body);
    expect(sent.length).toBe(2);
    expect(sent[0].commandId).toMatch(COMMAND_ID);
    expect(sent[1]).toEqual(sent[0]); // same payload, same command id — counted once
  });

  test('a possession tap with no response offers "Send again" under the same id', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    mock.mutationNetworkFail = true;
    await page.getByTestId('pad-possession').getByRole('button', { name: /westview wolves/i }).click();
    const strip = page.getByTestId('pad-rejected');
    await expect(strip).toContainText(/no answer from the server: possession → westview wolves/i);
    mock.mutationNetworkFail = false;
    await strip.getByRole('button', { name: /send again/i }).click();
    await expect.poll(() => mock.writes.filter((w) => w.path === '/possession').length).toBe(2);
    const [first, second] = mock.writes.filter((w) => w.path === '/possession').map((w) => w.body);
    expect(second.commandId).toBe(first.commandId);
    await expect(strip).toHaveCount(0);
  });

  test('a FINAL game says so, and a tap the server refuses as final is named', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    mock.mutationStatus = 409;
    mock.mutationCode = 'GAME_FINAL';
    await plus(page, 2).click();
    await expect(page.getByTestId('pad-rejected')).toContainText(/the game is final/i);
    await expect(page.getByTestId('pad-final')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'game-status');
    await expect(page.getByTestId('pad-chip')).toHaveText(/final/i);
    await expect(plus(page, 2)).toBeDisabled();
  });

  test('THE AUDIT CASE: failed reads → persistent "connection lost", never LIVE; recovery needs a confirm', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    await expect(plus(page, 2)).toBeEnabled();

    mock.boardDown = true;
    // LINK_STALE_AFTER_MS (8 s) + the 1 s ticker — the board's own threshold.
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'stale', { timeout: 15_000 });
    await expect(page.getByTestId('pad-chip')).not.toHaveText(/live/i);
    await expect(page.getByTestId('pad-lost')).toBeVisible();
    await expect(page.getByTestId('pad-scoreboard')).toContainText(/last known/i);
    await expect(plus(page, 2)).toBeDisabled();
    // Persistent: still there well after a toast would have gone.
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId('pad-lost')).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-lost-${test.info().project.name}-390.png`, fullPage: true });

    mock.boardDown = false;
    await expect(page.getByTestId('pad-resync')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'recovering');
    await expect(plus(page, 2)).toBeDisabled();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-resync-${test.info().project.name}-390.png`, fullPage: true });
    await page.getByTestId('pad-resync').getByRole('button').click();
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'live-game');
    await expect(plus(page, 2)).toBeEnabled();
  });

  test('a refused tap stays on screen, named, until dismissed', async ({ page }) => {
    const mock = await mockPad(page);
    await openPad(page, 'scorer');
    mock.mutationStatus = 403;
    mock.mutationCode = 'SPORTS_CONSOLE_SCOPE';
    await plus(page, 2).click();
    const strip = page.getByTestId('pad-rejected');
    await expect(strip).toContainText(/central comets \+2: this link can't do that/i);
    await page.waitForTimeout(3_000); // the old flash cleared after 2.5 s
    await expect(strip).toBeVisible();
    await strip.getByRole('button', { name: /dismiss/i }).click();
    await expect(strip).toHaveCount(0);
  });

  test('a revoked link shows the revoked screen and no controls', async ({ page }) => {
    await mockPad(page, { session: 'revoked' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/console/${tokenFor('scorer')}`);
    await expect(page.getByRole('heading', { name: /no longer active/i })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid^="pad-"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^\+\d$/ })).toHaveCount(0);
  });

  test('a link minted before scopes (API answers without one) keeps the original five controls', async ({ page }) => {
    await mockPad(page, { session: 'pre-scope-api' });
    await openPad(page, 'full');
    await expect(page.getByTestId('pad-role')).toContainText(/limited controls/i);
    for (const id of ALL_SECTIONS) {
      await expect(page.getByTestId(id), id).toHaveCount(BASKETBALL_SECTIONS.full.includes(id) ? 1 : 0);
    }
    await expect(page.getByRole('button', { name: /increase central comets fouls/i })).toHaveCount(0);
  });
});
