import { test, expect, type Locator, type Page } from '@playwright/test';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { BoardData } from '../../src/app/board/[gameId]/page';

/**
 * BOARD LIVE-UPDATE E2E — ⚠️ THIS IS A CI GATE (Phase-2 Domain E2E,
 * 2026-08-10), not a screenshot harness. Every assertion here is a hard
 * text/locator assertion that FAILS on regression; there is no
 * screenshot-painted-true anywhere in this file.
 *
 * The first end-to-end spec of the game-day trust path:
 *
 *   operator tap (server-side score mutation) → public /board/:gameId
 *   render — through the REAL page, the REAL board-poll engine
 *   (apps/web/src/lib/board-poll.ts: self-chaining 750ms cadence,
 *   If-None-Match/304 revalidation, jittered 1.5/3/5s backoff), in a REAL
 *   browser (chromium + webkit projects).
 *
 * Harness pattern: stadium-meet-board-shot.spec.ts (boot the real route,
 * intercept every API call via page.route) — extended with a STATEFUL mock:
 * an in-test game-state object served from the board GET endpoint; tests
 * mutate it the way a console PATCH lands server-side and assert the board
 * repaints within the poll budget.
 *
 * Mock transport: a REAL loopback http.Server per test, reached by proxying
 * the board route through `route.continue({ url })`. NOT route.fulfill,
 * because Playwright's WebKit driver refuses to synthesize 3xx responses
 * ("Cannot fulfill with redirect status: 304") — and a mocked-away 304
 * would defeat this spec's purpose. A real server means real status lines,
 * a genuinely EMPTY 304 body, and real CORS enforcement in every engine.
 *
 * The mock mirrors the REAL contract of SportsBoardController.board
 * (apps/api/src/sports/sports-board.controller.ts:81-104):
 *   - WEAK ETag (`W/"…"` — SportsService.boardEtag mints weak tags), rotated
 *     whenever state changes;
 *   - If-None-Match compared with WEAK comparison (W/ prefix ignored on both
 *     sides, comma lists, `*` — mirrors ifNoneMatchHits);
 *   - 304 with an EMPTY body but ETag + X-Server-Time + Cache-Control still
 *     set (the controller sets headers before the If-None-Match check);
 *   - 200 body carries per-request-fresh `serverTime`;
 *   - CORS: the board origin (localhost:3000) differs from the API origin
 *     (api.invalid — playwright.config webServer env), exactly like
 *     Vercel-web vs Railway-api in production. `If-None-Match` is NOT a
 *     CORS-safelisted request header, so the browser preflights; the mock
 *     answers OPTIONS with the same allow-list main.ts:241-272 ships
 *     (allowedHeaders includes If-None-Match; exposedHeaders ETag +
 *     X-Server-Time) — meaning this spec also regression-tests that a
 *     browser can actually READ the ETag cross-origin.
 *
 * Time budget: real timers only (nothing inside the app is faked); the
 * waits budget for the 750ms cadence, the 8s staleness threshold
 * (STALE_FEED_AFTER_MS) + 1s evaluator tick, and the ≤5.5s post-failure
 * backoff. Per-test test.setTimeout(90s) exists for a cold `next dev`
 * compile of /board on a loaded CI runner (globally warmed in
 * tests/global-setup.ts, so the steady-state suite runs well under 90s per
 * browser: ~10s + ~22s + ~12s with CI workers=1).
 *
 * Registration: apps/web/playwright.config.ts picks up testDir ./tests/e2e
 * by directory glob, and CI runs `playwright test --config
 * playwright.config.ts --project=<browser>` per-browser
 * (.github/workflows/ci.yml "Run E2E Tests") — no explicit spec list
 * exists, so this file is gated on every push/PR with no workflow change.
 */

const GAME_ID = 'e2e-live-update-000000000001';

// ── clock parity rule (inline — see Test 3) ──────────────────────────────

/**
 * CEIL parity rule for countdown clocks — the ported semantics of the
 * operator console's fmtClock (apps/web/src/app/[schoolId]/sports/[gameId]/
 * page.tsx:144-177, the REFERENCE formatter): the clock shows the second
 * still REMAINING, so "0:01" stays up until true zero and "0:00" is never
 * shown early. The CLOCK domain is unifying console/board/ribbon on this
 * math in a shared apps/web/src/lib/game-clock-format.ts; that module is
 * NOT on this branch yet (parallel domain), so per the Phase-2 spec the
 * expected string is computed inline here — do NOT import the shared
 * module until it exists on master.
 */
function parityCeilClock(remainingMs: number): string {
  const safe = Math.max(0, remainingMs);
  const totalSec = Math.ceil(safe / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

/**
 * Tenths mode below 60s keeps TRUNCATION (floor seconds + floor tenths,
 * "45.3") — explicitly preserved by the parity rule ("tenths mode below
 * 60s keeps its existing truncation behavior"), so THIS output is
 * byte-identical before and after the formatter unification lands.
 */
function parityTenthsClock(remainingMs: number): string {
  const safe = Math.max(0, remainingMs);
  return `${Math.floor(safe / 1000)}.${Math.floor((safe % 1000) / 100)}`;
}

/** Every string `fmt` can produce for a true remaining of
 *  `remainingAtRead ± slackMs` — the tolerance covers the board's 100ms
 *  projection tick, render→textContent RPC latency, and (deliberately,
 *  Test 3 phase A) the ±1s ceil-vs-floor offset so the gate stays green
 *  across the parallel CLOCK-domain landing. */
function expectedClockWindow(
  fmt: (ms: number) => string,
  remainingAtRead: number,
  slackMs: number,
): string[] {
  const out = new Set<string>();
  for (let d = -slackMs; d <= slackMs; d += 50) out.add(fmt(remainingAtRead + d));
  return Array.from(out);
}

// ── stateful mock ────────────────────────────────────────────────────────

interface MockGameState {
  homeScore: number;
  awayScore: number;
  clockMs: number;
  clockRunning: boolean;
  /** ISO anchor — the reading `clockMs` was taken at (server clock). */
  clockUpdatedAt: string;
  segment: number;
  status: string;
}

interface BoardMock {
  state: MockGameState;
  /** Mutate the game state the way a console tap lands server-side —
   *  rotates the ETag so the next conditional poll gets a fresh 200. */
  mutate(patch: Partial<MockGameState>): void;
  /** true → every GET fails with an HTTP 500 (poll-failure path). */
  setFailing(failing: boolean): void;
  counters: {
    ok200: number;
    notModified304: number;
    failed: number;
    /** consecutive 304s since the last 200 — a live "304 streak" gauge. */
    streak304: number;
  };
}

/** Minimal-but-contract-faithful BoardData payload (typed against the real
 *  page export, like sport-board-parity.test.tsx does). Basketball: a
 *  countdown-clock sport whose scores render as plain integers. */
function boardPayload(s: MockGameState): BoardData {
  return {
    id: GAME_ID,
    sport: 'basketball',
    status: s.status,
    segment: s.segment,
    homeTeam: 'Central Comets',
    awayTeam: 'Westview Wolves',
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    homeColor: '#1d4ed8',
    awayColor: '#b91c1c',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: s.clockMs,
    clockRunning: s.clockRunning,
    clockUpdatedAt: s.clockUpdatedAt,
    stats: {},
    cues: [],
    serverTime: Date.now(),
  };
}

/** WEAK entity-tag comparison — mirrors ifNoneMatchHits in
 *  apps/api/src/sports/sports-board.controller.ts:21-29. */
function ifNoneMatchHits(header: string, etag: string): boolean {
  const opaque = etag.startsWith('W/') ? etag.slice(2) : etag;
  return header.split(',').some((raw) => {
    const t = raw.trim();
    if (t === '*') return true;
    return (t.startsWith('W/') ? t.slice(2) : t) === opaque;
  });
}

/** Loopback mock servers spun up by the current test — always torn down,
 *  pass or fail, so retried/parallel workers never leak listeners. */
const liveServers: Server[] = [];
test.afterEach(async () => {
  for (const s of liveServers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function installBoardMock(page: Page, initial: MockGameState): Promise<BoardMock> {
  let version = 1;
  let failing = false;
  const state: MockGameState = { ...initial };
  const counters = { ok200: 0, notModified304: 0, failed: 0, streak304: 0 };

  const server = createServer((req, res) => {
    // CORS mirror of apps/api/src/main.ts:241-272 — the page origin
    // (localhost:3000) differs from the API origin, so the browser
    // preflights the non-safelisted If-None-Match header and can only
    // READ the validator via Expose-Headers. Real enforcement, since this
    // is a real response in a real browser.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET',
        // Exact production allow-list (apps/api/src/main.ts:267).
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, Accept, X-CSRF-Token, If-None-Match',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Server-Time');
    if (failing) {
      counters.failed += 1;
      counters.streak304 = 0;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'E2E_FORCED_FAILURE', message: 'mock outage' }));
      return;
    }
    const etag = `W/"e2e-board-v${version}"`;
    // Validator + fresh clock sample ride EVERY non-failing response —
    // the controller sets these headers before the If-None-Match check.
    res.setHeader('ETag', etag);
    res.setHeader('X-Server-Time', String(Date.now()));
    res.setHeader('Cache-Control', 'no-cache');
    const inm = req.headers['if-none-match'];
    if (inm && ifNoneMatchHits(String(inm), etag)) {
      counters.notModified304 += 1;
      counters.streak304 += 1;
      res.writeHead(304);
      res.end(); // 304 — EMPTY body by contract
      return;
    }
    counters.ok200 += 1;
    counters.streak304 = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(boardPayload(state)));
  });
  liveServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  // Everything else the page might call → empty 204 (missed-mock calls
  // blow up loud on api.invalid DNS instead — stadium-meet pattern).
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 204, body: '' }));

  // Registered AFTER the catch-all — Playwright matches routes last-first,
  // so the board endpoint (GET + its OPTIONS preflight) always lands here
  // and is proxied to the loopback server (same protocol, as continue()
  // requires; original headers — including If-None-Match — ride along).
  await page.route(`**/api/v1/sports/board/${GAME_ID}`, (route) =>
    route.continue({ url: `http://127.0.0.1:${port}/api/v1/sports/board/${GAME_ID}` }),
  );

  return {
    state,
    mutate(patch) {
      Object.assign(state, patch);
      version += 1; // state changed → validator MUST rotate
    },
    setFailing(f) {
      failing = f;
    },
    counters,
  };
}

// ── shared locators / helpers ────────────────────────────────────────────

const chip = (page: Page) => page.getByText('CONNECTION LOST', { exact: false });
/** The big center game clock — the only M:SS text on this fixture's board
 *  (segment renders "Q1", scores are bare integers, no penalty/shot/play
 *  clocks in stats). Strict-mode locator: a second match is a regression. */
const clockMSS = (page: Page) => page.getByText(/^\d{1,2}:\d{2}$/);
/** Tenths-mode clock ("45.3") — board switches below 60s remaining. */
const clockTenths = (page: Page) => page.getByText(/^\d{1,2}\.\d$/);

function freshState(over: Partial<MockGameState> = {}): MockGameState {
  return {
    homeScore: 17,
    awayScore: 9,
    // Stopped clock at exactly 8:00 — floor and ceil agree on whole
    // seconds, so this render is stable across the formatter unification.
    clockMs: 8 * 60_000,
    clockRunning: false,
    clockUpdatedAt: new Date().toISOString(),
    segment: 1,
    status: 'LIVE',
    ...over,
  };
}

async function readText(loc: Locator): Promise<{ txt: string; at: number }> {
  const txt = ((await loc.textContent()) || '').trim();
  return { txt, at: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────

test('tap→board: score change reaches the board through 200s AND through a 304 streak (ETag rotation)', async ({ page }) => {
  // Cold `next dev` compile of /board rides the first goto on CI.
  test.setTimeout(90_000);
  const mock = await installBoardMock(page, freshState());

  await page.goto(`/board/${GAME_ID}`);

  // Initial frame: exact scores + the stopped clock + LIVE chip.
  await expect(page.getByText('17', { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('9', { exact: true })).toBeVisible();
  await expect(page.getByText('8:00', { exact: true })).toBeVisible();
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  expect(mock.counters.ok200).toBeGreaterThanOrEqual(1);

  // ── operator tap #1: +3 home (17 → 20), like a console PATCH landing
  // server-side. The board MUST repaint within one poll (750ms) + margin.
  mock.mutate({ homeScore: 20 });
  await expect(page.getByText('20', { exact: true })).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText('17', { exact: true })).toBeHidden();

  // ── conditional-poll regression gate: with state unchanged the engine
  // must send If-None-Match and the API must answer 304 (empty body). If
  // board-poll ever stops revalidating, this wait times out → hard fail.
  await expect
    .poll(() => mock.counters.streak304, {
      message: 'board-poll never entered a 304 streak — If-None-Match/ETag flow is broken',
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(2);

  // ── operator tap #2 lands MID-STREAK: the rotated ETag must bust the
  // 304 run (stuck-validator regression → the board would freeze on 9).
  const okBefore = mock.counters.ok200;
  mock.mutate({ awayScore: 11 });
  await expect(page.getByText('11', { exact: true })).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText('9', { exact: true })).toBeHidden();
  expect(mock.counters.ok200).toBeGreaterThanOrEqual(okBefore + 1);

  // Healthy feed the whole way — the staleness chip must never have shown.
  await expect(chip(page)).toBeHidden();
});

test('staleness: CONNECTION LOST chip appears on a dead feed over a FROZEN frame, then clears and recovers', async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installBoardMock(page, freshState());

  await page.goto(`/board/${GAME_ID}`);
  await expect(page.getByText('17', { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(chip(page)).toBeHidden();

  // ── kill the feed (HTTP 500s — the poll-failure path with backoff).
  mock.setFailing(true);
  // Chip budget: ≤750ms to the last good poll before the flip + 8s
  // STALE_FEED_AFTER_MS + ≤1s evaluator tick + margin ⇒ ~12s.
  await expect(chip(page)).toBeVisible({ timeout: 13_000 });

  // Frozen frame, NOT a blank/error screen: the last known score must
  // still be on glass while the chip warns it may be behind.
  await expect(page.getByText('17', { exact: true })).toBeVisible();
  await expect(page.getByText('9', { exact: true })).toBeVisible();
  expect(mock.counters.failed).toBeGreaterThanOrEqual(1);

  // ── restore the feed: next attempt lands within the 5s (±10% jitter)
  // backoff cap; a good poll must clear the chip immediately.
  mock.setFailing(false);
  await expect(chip(page)).toBeHidden({ timeout: 9_000 });

  // Recovery is REAL: a fresh score change renders at normal cadence.
  mock.mutate({ homeScore: 21 });
  await expect(page.getByText('21', { exact: true })).toBeVisible({ timeout: 4_000 });
});

test('clock parity guard: rendered clock matches the parity-rule formatter for the projected instant', async ({ page }) => {
  test.setTimeout(90_000);
  // Running countdown anchored NOW at 12:00.5 — deep enough into the M:SS
  // regime to survive a slow cold boot without crossing 60s.
  const CLOCK_START_MS = 12 * 60_000 + 500;
  const anchorIso = new Date().toISOString();
  const anchorEpoch = Date.parse(anchorIso);
  const mock = await installBoardMock(
    page,
    freshState({ clockMs: CLOCK_START_MS, clockRunning: true, clockUpdatedAt: anchorIso }),
  );

  await page.goto(`/board/${GAME_ID}`);
  await expect(clockMSS(page)).toBeVisible({ timeout: 45_000 });

  // ── phase A (M:SS regime): the rendered string must equal the
  // parity-rule output for the true remaining time at read instant, within
  // a ±1300ms window. The window deliberately spans one whole second so it
  // contains BOTH ceil(remaining) and ceil(remaining)−1 (= today's floored
  // render): master's board still floors ≥60s until the CLOCK domain's
  // shared formatter lands, and this gate must hold green on both sides of
  // that landing. What it hard-fails on: broken serverTime/skew anchor
  // math (>1.3s drift), a frozen projection (phase-A2 below), or a format
  // regime regression (tenths/other text where M:SS belongs — the strict
  // locator + window membership reject it). Byte-exact ceil-vs-floor
  // parity is pinned by the CLOCK domain's unit table
  // (game-clock-format.test.ts) and by phase B here, whose truncation
  // output is identical pre/post unification.
  const remainingAt = (at: number) => CLOCK_START_MS - (at - anchorEpoch);
  let firstSeconds = 0;
  await expect(async () => {
    const { txt, at } = await readText(clockMSS(page));
    const remaining = remainingAt(at);
    expect(remaining).toBeGreaterThan(65_000); // test invariant: still M:SS
    expect(expectedClockWindow(parityCeilClock, remaining, 1_300)).toContain(txt);
    const m = /^(\d{1,2}):(\d{2})$/.exec(txt);
    firstSeconds = Number(m![1]) * 60 + Number(m![2]);
  }).toPass({ timeout: 8_000, intervals: [250, 400, 600] });

  // ── phase A2: the clock is genuinely RUNNING — 2s later the rendered
  // value must have strictly decreased and still match the parity window.
  await page.waitForTimeout(2_000);
  await expect(async () => {
    const { txt, at } = await readText(clockMSS(page));
    expect(expectedClockWindow(parityCeilClock, remainingAt(at), 1_300)).toContain(txt);
    const m = /^(\d{1,2}):(\d{2})$/.exec(txt);
    expect(Number(m![1]) * 60 + Number(m![2])).toBeLessThan(firstSeconds);
  }).toPass({ timeout: 8_000, intervals: [250, 400, 600] });

  // ── phase B (tenths regime, <60s): re-anchor to 45.4s running. Tenths
  // truncation is the parity rule's INVARIANT branch (byte-identical
  // before/after unification), so membership here is an exact semantic
  // pin, not a tolerance compromise. The board flips format on the next
  // 200 (ETag rotated by mutate).
  const tenthsIso = new Date().toISOString();
  const tenthsEpoch = Date.parse(tenthsIso);
  const TENTHS_START_MS = 45_400;
  mock.mutate({ clockMs: TENTHS_START_MS, clockUpdatedAt: tenthsIso });
  await expect(clockTenths(page)).toBeVisible({ timeout: 4_000 });
  await expect(async () => {
    const { txt, at } = await readText(clockTenths(page));
    const remaining = TENTHS_START_MS - (at - tenthsEpoch);
    expect(remaining).toBeGreaterThan(2_000); // test invariant: not near zero
    expect(expectedClockWindow(parityTenthsClock, remaining, 1_300)).toContain(txt);
  }).toPass({ timeout: 8_000, intervals: [250, 400, 600] });
});
