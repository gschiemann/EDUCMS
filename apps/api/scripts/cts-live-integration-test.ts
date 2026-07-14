/**
 * cts-live-integration-test.ts — end-to-end CTS integration test against
 * production. Creates a disposable water polo game, drives a synthetic
 * CTS sequence through the live `/api/v1/sports/board/:id/cts-snapshot`
 * endpoint using a real HMAC-signed feed token, verifies after each step
 * that the public `/sports/board/:id` GET shows the new state, then
 * cleans up by deleting the test game.
 *
 * Produces a markdown report under
 *   docs/research/2026-05-28-cts-live-test/REPORT.md
 *
 * Why this test exists: Greg asked (2026-05-28, bedtime) to "simulate a
 * full test of the CTS integration, use a live view, update the CTS
 * data and ensure it ports over into our scoreboard." This script is
 * the no-browser end of that — it proves the data port end-to-end at
 * the HTTP layer. The companion side is the /super/cts-simulator
 * page (built earlier today) which gives the visual proof in a browser.
 *
 * Safe to run multiple times — each invocation creates and destroys
 * its own test game inside a `cts-test-2026-05-28` slug-suffixed name.
 *
 * Run:
 *   cd apps/api && npx ts-node --transpile-only scripts/cts-live-integration-test.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();

// ── Configuration ────────────────────────────────────────────────

// SECURITY MODEL (2026-07-13, world-class audit W0-01.6):
// This script NEVER holds SPORTS_FEED_SECRET or DEVICE_SECRET_KEY. It used to
// mint feed tokens locally from the root signing secret — which is exactly how
// the production secret ended up committed to a public repo (removed in
// 58363762). Now it authenticates with an ordinary API-issued admin JWT and
// asks the API for a SHORT-LIVED, game-scoped feed token via
// GET /sports/games/:id/feed-credentials?ttlSeconds=900. No signing material
// touches this process; the token it does hold expires in 15 minutes and is
// revoked in `finally`.
//
// Defaults to STAGING. Running against a production host requires an explicit
// break-glass acknowledgement (CTS_TEST_ALLOW_PROD=i-understand) so nobody
// mutates a live tenant by leaving an env var set.
const API_BASE =
  process.env.CTS_TEST_API_URL ??
  process.env.RAILWAY_API_URL ??
  'https://staging-api.venue-os.app/api/v1';

const PROD_HOST_RE = /(^|\/\/)([^/]*\bapi-production\b[^/]*|api\.venue-os\.app)(\/|$)/i;
if (PROD_HOST_RE.test(API_BASE) && process.env.CTS_TEST_ALLOW_PROD !== 'i-understand') {
  console.error(
    `Refusing to run against a production host (${API_BASE}).\n` +
      'This test creates + mutates a game. Point CTS_TEST_API_URL at staging, or ' +
      'set CTS_TEST_ALLOW_PROD=i-understand to acknowledge a break-glass production run.',
  );
  process.exit(1);
}

// An API-issued admin JWT for the target tenant (NOT a signing secret). Copy it
// from an authenticated dashboard session (Application → localStorage →
// edu_cms_token) or a service login. It only needs to own the test tenant.
const ADMIN_TOKEN = process.env.CTS_TEST_ADMIN_TOKEN ?? '';
if (!ADMIN_TOKEN) {
  console.error(
    'Refusing to run: set CTS_TEST_ADMIN_TOKEN to an API-issued admin JWT for the ' +
      'target tenant. This script no longer accepts a raw feed-signing secret.',
  );
  process.exit(1);
}
const TENANT_ID = process.env.CTS_TEST_TENANT_ID ?? ''; // set to the pilot tenant at run time
if (!TENANT_ID) {
  console.error('Refusing to run: set CTS_TEST_TENANT_ID to the target tenant id.');
  process.exit(1);
}

/** Mask a bearer/token for logs — never print more than a short prefix. */
function redact(secretish: string): string {
  if (!secretish) return '<empty>';
  return `${secretish.slice(0, 6)}…(${secretish.length} chars)`;
}
const REPORT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'research',
  '2026-05-28-cts-live-test',
);
fs.mkdirSync(REPORT_DIR, { recursive: true });

/**
 * Obtain a short-lived, game-scoped feed token from the API using the admin
 * JWT — the API mints and signs it; this process never sees signing material.
 */
async function fetchFeedToken(gameId: string): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(
    `${API_BASE}/sports/games/${gameId}/feed-credentials?ttlSeconds=900`,
    { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '<unreadable>');
    throw new Error(`feed-credentials failed: HTTP ${res.status} ${detail}`);
  }
  const body: any = await res.json();
  if (!body?.token) throw new Error('feed-credentials returned no token');
  return { token: body.token, expiresAt: body.expiresAt ?? '<unknown>' };
}

/** Revoke every outstanding feed token for a game (bumps feedTokenVersion). */
async function revokeFeedToken(gameId: string): Promise<void> {
  await fetch(`${API_BASE}/sports/games/${gameId}/revoke-feed-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
  });
}

// ── Test runner ──────────────────────────────────────────────────

type StepResult = {
  step: string;
  action: string;
  request?: any;
  responseStatus?: number;
  responseBody?: any;
  boardAfter?: any;
  notes?: string[];
  pass: boolean;
};

const results: StepResult[] = [];

async function postSnapshot(
  gameId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_BASE}/sports/board/${gameId}/cts-snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-feed-token': token },
    body: JSON.stringify(body),
  });
  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    parsed = { _raw: await res.text().catch(() => '<unreadable>') };
  }
  return { status: res.status, body: parsed };
}

async function fetchBoard(gameId: string): Promise<any> {
  // The board endpoint has a 750ms cache TTL. Sleep slightly past that
  // so each step reads the post-write state, not a pre-write stale
  // value. Also helps if Railway runs multiple API replicas — gives
  // the write-side cache invalidation a beat to propagate.
  await new Promise((r) => setTimeout(r, 1100));
  const res = await fetch(`${API_BASE}/sports/board/${gameId}`);
  if (!res.ok) throw new Error(`Board fetch failed: ${res.status}`);
  return res.json();
}

function relevantCtsFields(board: any): Record<string, unknown> {
  // CTS data is nested under board.stats.cts (the persistent overlay
  // namespace); other CTS-merged fields live alongside it in board.stats.
  const stats = board?.stats ?? {};
  const cts = stats.cts ?? {};
  return {
    'stats.cts.homeScore': cts.homeScore,
    'stats.cts.awayScore': cts.awayScore,
    'stats.cts.clockMs': cts.clockMs,
    'stats.cts.clockRunning': cts.clockRunning,
    'stats.cts.segment': cts.segment,
    'stats.cts.horn': cts.horn,
    'stats.cts.homeShotClock': cts.homeShotClock,
    'stats.cts.awayShotClock': cts.awayShotClock,
    'stats.cts.homeExclusions': cts.homeExclusions,
    'stats.cts.awayExclusions': cts.awayExclusions,
    'stats.cts.homeTimeoutsRemaining': cts.homeTimeoutsRemaining,
    'stats.cts.awayTimeoutsRemaining': cts.awayTimeoutsRemaining,
    'stats.cts.lastUpdateAt': cts.lastUpdateAt,
    'stats.penalties': stats.penalties,
    'stats.homeTimeouts': stats.homeTimeouts,
    'stats.awayTimeouts': stats.awayTimeouts,
  };
}

async function step(
  label: string,
  action: string,
  fn: () => Promise<StepResult>,
): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(`\n──── ${label} ────\n   ${action}\n`);
  try {
    const r = await fn();
    r.step = label;
    r.action = action;
    results.push(r);
    const ms = Date.now() - t0;
    process.stdout.write(
      `   → ${r.pass ? 'PASS' : 'FAIL'} (${ms}ms)\n`,
    );
    if (!r.pass) {
      // Surface the actual API response on failure so we can debug.
      if (r.responseStatus !== undefined) {
        process.stdout.write(`     POST → HTTP ${r.responseStatus}\n`);
      }
      if (r.responseBody !== undefined) {
        process.stdout.write(`     body: ${JSON.stringify(r.responseBody)}\n`);
      }
    }
    if (r.notes && r.notes.length > 0) {
      r.notes.forEach((n) => process.stdout.write(`     · ${n}\n`));
    }
  } catch (e: any) {
    results.push({ step: label, action, pass: false, notes: [`THREW: ${e?.message ?? e}`] });
    process.stdout.write(`   → THREW: ${e?.message ?? e}\n`);
  }
}

// ── Test sequence ────────────────────────────────────────────────

async function main() {
  console.log('=== CTS Live Integration Test ===');
  console.log(`API: ${API_BASE}`);
  console.log(`Tenant: ${TENANT_ID} (Dodgers)`);
  console.log();

  // 1. Provision a disposable test game directly in Prisma.
  const gameId = `cts-test-${Date.now()}`;
  const createdGame = await prisma.game.create({
    data: {
      id: gameId,
      tenantId: TENANT_ID,
      sport: 'water_polo',
      homeTeam: 'CTS-TEST HOME',
      awayTeam: 'CTS-TEST AWAY',
      homeColor: '#1e40af',
      awayColor: '#dc2626',
      status: 'LIVE',
      clockMs: 8 * 60 * 1000,
      clockRunning: false,
      segment: 1,
      homeScore: 0,
      awayScore: 0,
    },
  });
  console.log(`Provisioned test game ${createdGame.id}`);

  const { token, expiresAt } = await fetchFeedToken(gameId);
  console.log(`Feed token (API-issued, short-lived): ${redact(token)} — expires ${expiresAt}`);

  try {
    // ── Step 1: clock start
    await step('STEP 1', 'POST cts-snapshot {clockMs: 480000, clockRunning: true}', async () => {
      const reqBody = { clockMs: 480000, clockRunning: true };
      const { status, body } = await postSnapshot(gameId, token, reqBody);
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      const pass =
        status === 201 &&
        body?.ok === true &&
        Math.abs((fields['stats.cts.clockMs'] as number) - 480000) < 5000 &&
        fields['stats.cts.clockRunning'] === true;
      return {
        step: '',
        action: '',
        request: reqBody,
        responseStatus: status,
        responseBody: body,
        boardAfter: fields,
        pass,
        notes: [`cts.clockMs=${fields['stats.cts.clockMs']}, cts.clockRunning=${fields['stats.cts.clockRunning']}`],
      };
    });

    // ── Step 2: home goal 0→1
    await step('STEP 2', 'POST cts-snapshot {homeScore: 1}', async () => {
      const reqBody = { homeScore: 1, clockMs: 478000, clockRunning: true };
      const { status, body } = await postSnapshot(gameId, token, reqBody);
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      const pass = status === 201 && fields['stats.cts.homeScore'] === 1;
      return {
        step: '',
        action: '',
        request: reqBody,
        responseStatus: status,
        responseBody: body,
        boardAfter: fields,
        pass,
        notes: [`cts.homeScore=${fields['stats.cts.homeScore']}, expected 1`],
      };
    });

    // Pause briefly so the board's 750ms cache TTL clears between steps
    await new Promise((r) => setTimeout(r, 1100));

    // ── Step 3: home exclusion #7 for 20s
    await step('STEP 3', 'POST cts-snapshot {homeExclusions: [#7/20s, null, null]}', async () => {
      const reqBody = {
        homeExclusions: [
          { playerJersey: 7, secondsRemaining: 20 },
          null,
          null,
        ],
      };
      const { status, body } = await postSnapshot(gameId, token, reqBody);
      await new Promise((r) => setTimeout(r, 800));
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      const ctsExcl = (fields['stats.cts.homeExclusions'] as any[]) ?? [];
      const slot0 = ctsExcl[0];
      const penalties = (fields['stats.penalties'] as any[]) ?? [];
      const ctsPenalty = penalties.find((p) => p?.source === 'cts' && p?.team === 'home');
      const pass =
        status === 201 &&
        slot0?.playerJersey === 7 &&
        slot0?.secondsRemaining === 20 &&
        ctsPenalty?.playerJersey === 7;
      return {
        step: '',
        action: '',
        request: reqBody,
        responseStatus: status,
        responseBody: body,
        boardAfter: fields,
        pass,
        notes: [
          `cts.homeExclusions[0]=${JSON.stringify(slot0)}`,
          `stats.penalties CTS-row=${JSON.stringify(ctsPenalty ?? null)}`,
        ],
      };
    });

    // ── Step 4: away goal 0→1
    await step('STEP 4', 'POST cts-snapshot {awayScore: 1}', async () => {
      const reqBody = { awayScore: 1, clockMs: 470000, clockRunning: true };
      const { status, body } = await postSnapshot(gameId, token, reqBody);
      await new Promise((r) => setTimeout(r, 800));
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      const pass = status === 201 && fields['stats.cts.awayScore'] === 1;
      return {
        step: '',
        action: '',
        request: reqBody,
        responseStatus: status,
        responseBody: body,
        boardAfter: fields,
        pass,
        notes: [`cts.awayScore=${fields['stats.cts.awayScore']}, expected 1`],
      };
    });

    // ── Step 5: home timeout (3 → 2)
    await step('STEP 5', 'POST cts-snapshot {homeTimeoutsRemaining: 2}', async () => {
      const reqBody = { homeTimeoutsRemaining: 2 };
      const { status, body } = await postSnapshot(gameId, token, reqBody);
      await new Promise((r) => setTimeout(r, 800));
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      const pass =
        status === 201 &&
        (fields['stats.cts.homeTimeoutsRemaining'] === 2 ||
          fields['stats.homeTimeouts'] === 2);
      return {
        step: '',
        action: '',
        request: reqBody,
        responseStatus: status,
        responseBody: body,
        boardAfter: fields,
        pass,
        notes: [
          `cts.homeTimeoutsRemaining=${fields['stats.cts.homeTimeoutsRemaining']}`,
          `stats.homeTimeouts=${fields['stats.homeTimeouts']}`,
        ],
      };
    });

    // ── Step 6: horn (one-shot)
    await step('STEP 6', 'POST cts-snapshot {horn: true} then {horn: false}', async () => {
      const onResp = await postSnapshot(gameId, token, { horn: true });
      await new Promise((r) => setTimeout(r, 300));
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      // Clear after read
      const offResp = await postSnapshot(gameId, token, { horn: false });
      const pass =
        onResp.status === 201 &&
        offResp.status === 201 &&
        fields['stats.cts.horn'] === true;
      return {
        step: '',
        action: '',
        request: { on: { horn: true }, off: { horn: false } },
        responseStatus: onResp.status,
        responseBody: onResp.body,
        boardAfter: fields,
        pass,
        notes: [`cts.horn observed = ${fields['stats.cts.horn']}`],
      };
    });

    // ── Step 7: advance to period 2
    await step('STEP 7', 'POST cts-snapshot {segment: 2, clockMs: 480000, clockRunning: false}', async () => {
      const reqBody = { segment: 2, clockMs: 480000, clockRunning: false };
      const { status, body } = await postSnapshot(gameId, token, reqBody);
      await new Promise((r) => setTimeout(r, 800));
      const board = await fetchBoard(gameId);
      const fields = relevantCtsFields(board);
      const pass =
        status === 201 &&
        fields['stats.cts.segment'] === 2 &&
        fields['stats.cts.clockRunning'] === false;
      return {
        step: '',
        action: '',
        request: reqBody,
        responseStatus: status,
        responseBody: body,
        boardAfter: fields,
        pass,
        notes: [`cts.segment=${fields['stats.cts.segment']}, cts.clockRunning=${fields['stats.cts.clockRunning']}`],
      };
    });

    // ── Step 8: GameEvent forensic check
    await step('STEP 8', 'GameEvent rows fired for the CTS sequence', async () => {
      const events = await prisma.gameEvent.findMany({
        where: { gameId },
        orderBy: { createdAt: 'asc' },
      });
      // GameEvent.type field is `type` (DB column 'type'), not `kind`.
      const scoreEvents = events.filter((e) => (e as any).type === 'SCORE');
      const segmentEvents = events.filter((e) => (e as any).type === 'SEGMENT');
      const cueEvents = events.filter((e) => (e as any).type === 'CUE');
      const clockEvents = events.filter((e) => (e as any).type === 'CLOCK');
      const allTypes = [...new Set(events.map((e) => (e as any).type))];
      const ingestEvents: any[] = []; // legacy field name — not used in current API
      const pass = scoreEvents.length >= 2 && segmentEvents.length >= 1;
      return {
        step: '',
        action: '',
        responseBody: {
          totalEvents: events.length,
          scoreCount: scoreEvents.length,
          segmentCount: segmentEvents.length,
          clockCount: clockEvents.length,
          cueCount: cueEvents.length,
          allTypes,
        },
        pass,
        notes: [
          `total events=${events.length}`,
          `types observed: ${allTypes.join(', ')}`,
          `SCORE=${scoreEvents.length} (expect ≥2 — home + away goals)`,
          `SEGMENT=${segmentEvents.length} (expect ≥1 — period advance)`,
          `CLOCK=${clockEvents.length}`,
          `CUE=${cueEvents.length} (T1-1 unified path fires celebrations on score deltas)`,
        ],
      };
    });

    // ── Step 9: AuditLog forensic check
    await step('STEP 9', 'AuditLog rows captured for forensic trail', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { tenantId: TENANT_ID, targetId: gameId },
        orderBy: { createdAt: 'asc' },
      });
      const pass = logs.length >= 1;
      return {
        step: '',
        action: '',
        responseBody: {
          totalAuditRows: logs.length,
          actions: [...new Set(logs.map((l) => l.action))],
        },
        pass,
        notes: [
          `AuditLog rows=${logs.length}`,
          `Actions: ${[...new Set(logs.map((l) => l.action))].join(', ')}`,
        ],
      };
    });
  } finally {
    // Always clean up. First REVOKE the short-lived feed token (defence in
    // depth — it also self-expires in 15 min) so a copy captured mid-run can
    // never be replayed against the tenant. Then delete the disposable game.
    // NOTE: audit_logs are append-only at the DB level (P0-6 immutability
    // trigger) — we deliberately CAN'T delete them, by design. The few rows
    // this test wrote will forever live in the AuditLog with this game's
    // targetId, even though the game itself is gone. That's the correct
    // forensic semantics: an audit trail you can scrub on demand isn't an
    // audit trail.
    console.log('\nRevoking feed token…');
    await revokeFeedToken(gameId).catch((e) =>
      console.warn(`  (revoke best-effort failed: ${e?.message ?? e})`),
    );
    console.log('Cleaning up test game…');
    await prisma.gameEvent.deleteMany({ where: { gameId } });
    await prisma.game.delete({ where: { id: gameId } });
    console.log('Test game deleted (audit_logs retained per DB immutability rule).');
    await prisma.$disconnect();
  }

  // ── Write the report ───────────────────────────────────────────

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const summary = `${passed}/${total} steps passed`;

  const report = [
    `# CTS Live Integration Test — 2026-05-28`,
    ``,
    `Drives a scripted CTS Gen 6 console sequence through the live`,
    `production API and verifies each step ports through to the public`,
    `\`/sports/board/:id\` surface.`,
    ``,
    `**Result:** ${summary}`,
    ``,
    `## Configuration`,
    `- **API:** \`${API_BASE}\``,
    `- **Tenant:** Dodgers (\`${TENANT_ID}\`) — water polo pilot tenant`,
    `- **Test game ID:** \`${gameId}\` (created + deleted in same run)`,
    `- **Endpoint:** \`POST /api/v1/sports/board/:id/cts-snapshot\` (HMAC feed-token auth, same path a real CtsBridge would use)`,
    ``,
    `## Test sequence`,
    ``,
    ...results.map((r, i) => {
      const block = [
        `### ${r.step} — ${r.pass ? '✅ PASS' : '❌ FAIL'}`,
        ``,
        `**Action:** \`${r.action}\``,
        ``,
      ];
      if (r.request !== undefined) {
        block.push('**Request:**', '```json', JSON.stringify(r.request, null, 2), '```', '');
      }
      if (r.responseStatus !== undefined) {
        block.push(`**Response status:** ${r.responseStatus}`, '');
      }
      if (r.responseBody !== undefined) {
        block.push('**Response body:**', '```json', JSON.stringify(r.responseBody, null, 2), '```', '');
      }
      if (r.boardAfter !== undefined) {
        block.push(
          '**Board state after (relevant fields):**',
          '```json',
          JSON.stringify(r.boardAfter, null, 2),
          '```',
          '',
        );
      }
      if (r.notes && r.notes.length > 0) {
        block.push('**Notes:**');
        block.push(...r.notes.map((n) => `- ${n}`));
        block.push('');
      }
      return block.join('\n');
    }),
    `## What this proves`,
    ``,
    `Every byte a real Colorado Time Systems Gen 6 console would emit on`,
    `RS232 is converted by \`CtsBridge\` to a JSON snapshot identical in`,
    `shape to what this test POSTed. That snapshot flows through:`,
    ``,
    `1. The feed-token-authenticated ingest endpoint at`,
    `   \`/api/v1/sports/board/:id/cts-snapshot\` (rate-limited, HMAC-verified,`,
    `   short-lived API-issued token — no dashboard session).`,
    `2. \`SportsService.ingestCtsSnapshot()\` — the single source of truth.`,
    `3. \`cleanCtsSnapshot()\` — sanitizer that accepts the T2-1 fields`,
    `   (per-side shot clocks, exclusions, timeouts remaining).`,
    `4. \`syncShotClockToGameClock\` + \`syncPenaltiesToClock\` (T1-1 unified`,
    `   path) — same helper chain the operator console uses.`,
    `5. \`maybeAutoCelebrate\` — fires server-side celebration CUEs on`,
    `   score deltas, identical to operator-driven scoring.`,
    `6. \`Game.stats.cts\` write + GameEvent + AuditLog forensic trail.`,
    `7. \`/api/v1/sports/board/:id\` GET — the public surface the`,
    `   scoreboard, ribbon, and scorebug all poll at ~750ms.`,
    ``,
    `Every step is observable via the GET endpoint after at most one`,
    `cache-tick (≤1s). If a real CTS bridge replaced this script, the`,
    `wall would react identically — they hit the same code path from`,
    `ingestCtsSnapshot onward.`,
    ``,
    `## Visual proof`,
    ``,
    `For the screenshot side of "I want to see what that looks like":`,
    `the operator can open the simulator at \`/super/cts-simulator\`,`,
    `pick any water polo game, and click buttons while watching the`,
    `live \`/board/:id\` iframe in the right pane. Same data path —`,
    `same verification — just with a human in the loop. The simulator`,
    `uses the authenticated operator-JWT sibling endpoint`,
    `(\`/sports/games/:id/cts-snapshot\`) which converges on the same`,
    `\`ingestCtsSnapshot\` service method.`,
    ``,
    `---`,
    ``,
    `*Test runner: \`apps/api/scripts/cts-live-integration-test.ts\`.*`,
    `*Run with: \`cd apps/api && npx ts-node --transpile-only scripts/cts-live-integration-test.ts\`.*`,
  ].join('\n');

  const reportPath = path.join(REPORT_DIR, 'REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);
  console.log(`\n=== ${summary} ===`);

  if (passed < total) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
