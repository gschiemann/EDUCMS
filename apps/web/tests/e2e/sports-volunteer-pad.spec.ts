/**
 * K-12 launch program, register row K12-F16 — the volunteer scorekeeper pad
 * (/console/<token>) in a real browser (chromium + webkit projects), at
 * 360 / 390 / 430 px.
 *
 * Audit evidence this pins shut (docs/research/2026-09-23-k12-sports-
 * readiness-audit, verified-volunteer-offline-webkit.png): the pad had
 * score / clock / period / timeouts / cues only, the same controls for every
 * link, and after 11 seconds of failed board reads it still showed a red
 * "LIVE" with no warning.
 *
 * What is asserted (hard locator checks, never a painted-true screenshot):
 *   - each ROLE sees exactly its duties (the server's /session capability
 *     list drives the pad; the API enforces the same table on every tap —
 *     apps/api/src/sports/sports-console.controller.spec.ts);
 *   - no sideways scroll, every control ≥ 44 × 44 px;
 *   - a stalled read stream → persistent "connection lost", never LIVE,
 *     controls paused; reads back → the volunteer must confirm the score;
 *   - a refused or unsent tap stays on screen, named, until dismissed.
 *
 * Every API call is intercepted (the suite's contract — see
 * apps/web/playwright.config.ts). Set E2E_SHOTS_DIR to keep screenshots.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const GAME = 'e2e-volunteer-pad-00000000001';
const MAC = 'a'.repeat(32);
const WIDTHS = [360, 390, 430] as const;
const SHOTS = process.env.E2E_SHOTS_DIR || '';

type Role = 'table' | 'scorer' | 'timer' | 'shot';
type Write = { method: string; path: string; body: unknown };

/** The capability table for basketball / football, as
 *  packages/api-types/src/sports-console-roles.spec.ts pins it. */
const CAPS: Record<string, Record<Role, string[]>> = {
  basketball: {
    table: ['score', 'clock', 'segment', 'timeout', 'cue', 'stats', 'possession', 'shotClock'],
    scorer: ['score', 'timeout', 'cue', 'stats', 'possession'],
    timer: ['clock', 'segment', 'timeout'],
    shot: ['shotClock'],
  },
  football: {
    table: ['score', 'clock', 'segment', 'timeout', 'cue', 'stats', 'possession', 'playClock'],
    scorer: ['score', 'timeout', 'cue', 'stats', 'possession'],
    timer: ['clock', 'segment', 'timeout'],
    shot: ['playClock'],
  },
};

const tokenFor = (role: Role | null) =>
  role ? `${GAME}.0.1789999999.86400.${role}.${MAC}` : `${GAME}.0.1789999999.86400.${MAC}`;

interface PadMock {
  writes: Write[];
  /** Board reads fail while true (network-level abort). */
  boardDown: boolean;
  /** Status to answer console mutations with (200 = accept). */
  mutationStatus: number;
  /** Abort console mutations at the network level. */
  mutationNetworkFail: boolean;
}

async function mockPad(
  page: Page,
  opts: { sport?: string; role: Role | null; session?: 'ok' | 'revoked'; sendCapabilities?: boolean },
): Promise<PadMock> {
  const sport = opts.sport || 'basketball';
  const mock: PadMock = { writes: [], boardDown: false, mutationStatus: 200, mutationNetworkFail: false };
  const now = new Date().toISOString();
  const state = {
    id: GAME,
    sport,
    status: 'LIVE',
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
  };
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

    if (path.startsWith('/sports/console/') && path.endsWith('/session')) {
      if (opts.session === 'revoked') return json({ code: 'SPORTS_CONSOLE_TOKEN_INVALID' }, 401);
      return json({
        ok: true,
        gameId: GAME,
        sport,
        status: 'LIVE',
        homeTeam: state.homeTeam,
        awayTeam: state.awayTeam,
        ...(opts.sendCapabilities === false
          ? {}
          : { role: opts.role, capabilities: opts.role ? CAPS[sport][opts.role] : ['score', 'clock', 'segment', 'timeout', 'cue'] }),
      });
    }
    if (path === `/sports/board/${GAME}`) {
      if (mock.boardDown) return route.abort('internetdisconnected');
      return json({ ...state, serverTime: Date.now() });
    }
    if (path.startsWith('/sports/console/')) {
      mock.writes.push({ method: req.method(), path: path.replace(/^\/sports\/console\/[^/]+/, ''), body: req.postDataJSON() });
      if (mock.mutationNetworkFail) return route.abort('internetdisconnected');
      if (mock.mutationStatus !== 200) return json({ code: 'SPORTS_CONSOLE_NOT_PERMITTED' }, mock.mutationStatus);
      return json(state);
    }
    return json(path.endsWith('s') ? [] : {});
  });
  return mock;
}

async function openPad(page: Page, role: Role | null, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/console/${tokenFor(role)}`);
  await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'live-game', { timeout: 60_000 });
}

const SECTION_FOR: Record<string, string> = {
  score: 'pad-score',
  clock: 'pad-clock',
  shotClock: 'pad-shot-clock',
  playClock: 'pad-play-clock',
  segment: 'pad-period',
  possession: 'pad-possession',
  cue: 'pad-cues',
};

async function expectPhoneLayout(page: Page) {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll('button, a[href], input, select, textarea'))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('nextjs-portal')) continue; // Next's dev-only overlay button
      if (r.width < 44 || r.height < 44) {
        small.push(`${((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
  });
  expect(report.scroll).toBeLessThanOrEqual(1);
  expect(report.small).toEqual([]);
}

test.describe('K12-F16 — volunteer pad', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const width of WIDTHS) {
    for (const role of ['table', 'scorer', 'timer', 'shot'] as Role[]) {
      test(`basketball ${role} link at ${width} px shows exactly its duties`, async ({ page }) => {
        await mockPad(page, { role });
        await openPad(page, role, width);
        const caps = CAPS.basketball[role];
        for (const [cap, testId] of Object.entries(SECTION_FOR)) {
          await expect(page.getByTestId(testId), `${role}: ${cap}`).toHaveCount(caps.includes(cap) ? 1 : 0);
        }
        // Team stats (fouls) only with `stats`; the timeout row only with `timeout`.
        await expect(page.getByTestId('pad-team')).toHaveCount(caps.includes('stats') || caps.includes('timeout') ? 1 : 0);
        await expect(page.getByRole('button', { name: /increase central comets fouls/i })).toHaveCount(caps.includes('stats') ? 1 : 0);
        await expect(page.getByRole('button', { name: /timeout — central comets/i })).toHaveCount(caps.includes('timeout') ? 1 : 0);
        await expectPhoneLayout(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-basketball-${role}-${test.info().project.name}-${width}.png`, fullPage: true });
      });
    }
  }

  test('a clock-operator link runs the clock and has no score controls', async ({ page }) => {
    const mock = await mockPad(page, { role: 'timer' });
    await openPad(page, 'timer');
    await expect(page.getByTestId('pad-role')).toContainText(/clock operator/i);
    await expect(page.getByRole('button', { name: '+2', exact: true })).toHaveCount(0);
    await page.getByTestId('pad-clock').getByRole('button', { name: /start clock/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/clock')?.body).toEqual({ action: 'start' });
  });

  test('a football play-clock link resets to 25 and does nothing else', async ({ page }) => {
    const mock = await mockPad(page, { sport: 'football', role: 'shot' });
    await openPad(page, 'shot');
    await expect(page.getByTestId('pad-role')).toContainText(/play clock/i);
    await expect(page.getByTestId('pad-score')).toHaveCount(0);
    await page.getByTestId('pad-play-clock').getByRole('button', { name: '25', exact: true }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/play-clock')?.body).toEqual({ action: 'reset', value: 25 });
    await expectPhoneLayout(page);
  });

  test('a scorekeeper sets team fouls and the possession arrow', async ({ page }) => {
    const mock = await mockPad(page, { role: 'scorer' });
    await openPad(page, 'scorer');
    await page.getByRole('button', { name: /increase westview wolves fouls/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/stats')?.body).toEqual({ stats: { awayFouls: 3 } });
    await page.getByTestId('pad-possession').getByRole('button', { name: /westview wolves/i }).click();
    await expect.poll(() => mock.writes.find((w) => w.path === '/possession')?.body).toEqual({ team: 'away' });
  });

  test('THE AUDIT CASE: failed reads → persistent "connection lost", never LIVE; recovery needs a confirm', async ({ page }) => {
    const mock = await mockPad(page, { role: 'scorer' });
    await openPad(page, 'scorer');
    const plus2 = page.getByTestId('pad-score').getByRole('button', { name: '+2', exact: true }).first();
    await expect(plus2).toBeEnabled();

    mock.boardDown = true;
    // STALE_FEED_AFTER_MS (8 s) + the 1 s ticker — the board's own threshold.
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'lost', { timeout: 15_000 });
    await expect(page.getByTestId('pad-chip')).not.toHaveText(/live/i);
    await expect(page.getByTestId('pad-lost')).toBeVisible();
    await expect(page.getByTestId('pad-scoreboard')).toContainText(/last known/i);
    await expect(plus2).toBeDisabled();
    // Persistent: still there well after a toast would have gone.
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId('pad-lost')).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-lost-${test.info().project.name}-390.png`, fullPage: true });

    mock.boardDown = false;
    await expect(page.getByTestId('pad-resync')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'resync');
    await expect(plus2).toBeDisabled();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-resync-${test.info().project.name}-390.png`, fullPage: true });
    await page.getByTestId('pad-resync').getByRole('button').click();
    await expect(page.getByTestId('pad-chip')).toHaveAttribute('data-chip', 'live-game');
    await expect(plus2).toBeEnabled();
  });

  test('a refused tap stays on screen, named, until dismissed', async ({ page }) => {
    const mock = await mockPad(page, { role: 'scorer' });
    await openPad(page, 'scorer');
    mock.mutationStatus = 403;
    await page.getByTestId('pad-score').getByRole('button', { name: '+2', exact: true }).first().click();
    const strip = page.getByTestId('pad-rejected');
    await expect(strip).toContainText(/central comets \+2: this link can't do that/i);
    await page.waitForTimeout(3_000); // the old flash cleared after 2.5 s
    await expect(strip).toBeVisible();
    await strip.getByRole('button', { name: /dismiss/i }).click();
    await expect(strip).toHaveCount(0);
  });

  test('a tap that never reached the server says so and asks for a board check', async ({ page }) => {
    const mock = await mockPad(page, { role: 'scorer' });
    await openPad(page, 'scorer');
    mock.mutationNetworkFail = true;
    await page.getByTestId('pad-score').getByRole('button', { name: '+1', exact: true }).first().click();
    await expect(page.getByTestId('pad-rejected')).toContainText(/didn't reach the server: central comets \+1/i);
  });

  test('a revoked link shows the revoked screen and no controls', async ({ page }) => {
    await mockPad(page, { role: 'scorer', session: 'revoked' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/console/${tokenFor('scorer')}`);
    await expect(page.getByRole('heading', { name: /no longer active/i })).toBeVisible({ timeout: 60_000 });
    // No pad section renders (global chrome such as a dev overlay is not the pad's).
    await expect(page.locator('[data-testid^="pad-"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^\+\d$/ })).toHaveCount(0);
  });

  test('a pre-role link against an API without capability lists keeps the original five controls', async ({ page }) => {
    await mockPad(page, { role: null, sendCapabilities: false });
    await openPad(page, null);
    await expect(page.getByTestId('pad-role')).toContainText(/limited controls/i);
    await expect(page.getByTestId('pad-score')).toHaveCount(1);
    await expect(page.getByTestId('pad-clock')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /increase central comets fouls/i })).toHaveCount(0);
    await expect(page.getByTestId('pad-shot-clock')).toHaveCount(0);
  });
});
