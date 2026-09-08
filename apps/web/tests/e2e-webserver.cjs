#!/usr/bin/env node
/**
 * Playwright `webServer` entrypoint for the apps/web E2E suite.
 *
 * THE JOB: serve a PREBUILT Next production bundle. Never compile on demand.
 *
 * ── WHY (2026-09-05) ─────────────────────────────────────────────────────
 * This used to be `pnpm dev`, i.e. `next dev`, which compiles a route on its
 * FIRST request. On 2026-09-04 the repo went private, which moves GitHub's
 * standard Linux runner from the public 4-vCPU / 16 GB class to the private
 * 2-vCPU / 7 GB class. From the first push after that flip, `Emergency Path`
 * and both `CI & Security` E2E jobs died the same way on every run —
 * including a re-run of an unchanged commit and a first-red commit that
 * touched only Kotlin:
 *
 *     ○ Compiling /board/[gameId] ...
 *     [global-setup] could NOT warm /board/... within 180000ms
 *     ##[error]The runner has received a shutdown signal.
 *
 * Reproduced locally in a container capped to the private-runner spec
 * (`--cpus=2 --memory=7g --memory-swap=7g`): warming /player then
 * /board/[gameId] under `next dev` drove the cgroup to 6.83 GB and the kernel
 * OOM-killer fired — `memory.events: max 177, oom 3, oom_kill 1` — with the
 * /board request never returning. On a GitHub VM that same kill lands on the
 * runner agent, which is reported as "the runner has received a shutdown
 * signal". Nothing about the app regressed; the machine halved.
 *
 * Same container, same cap, prebuilt instead:
 *     next build   69 s, peak 5.23 GB, memory.events all zero
 *     next start   /player 1 s, /board 0 s, peak 0.70 GB, no OOM
 *
 * So the fix is not a bigger timeout — it is not compiling at test time.
 * A prebuilt server is also deterministic (no first-request-pays-the-compile
 * race, which is what the global-setup warm-up existed to paper over) and it
 * exercises the SAME production bundle customers get, including the enforced
 * CSP that only a real build can produce.
 *
 * ── CONTRACT ─────────────────────────────────────────────────────────────
 *  • CI sets `E2E_PREBUILT=1` and builds in its own workflow step, so a build
 *    failure is a legible red step instead of an opaque webServer timeout.
 *    This script then only starts the server, and FAILS LOUDLY if there is no
 *    build to serve.
 *  • Locally, `pnpm test:e2e` still works from a clean tree: if `.next` has no
 *    BUILD_ID we build once, then start. Set `E2E_REBUILD=1` to force a
 *    rebuild after changing app code — a stale `.next` will otherwise be
 *    served silently, which is the one real footgun of this design.
 *  • `NEXT_PUBLIC_API_URL` MUST be identical at build time and at serve time.
 *    Next inlines `NEXT_PUBLIC_*` into the client bundle at BUILD time, so
 *    setting it only on the server process (which is what the old `next dev`
 *    config did) would silently bake `http://localhost:8080/api/v1` into the
 *    tests instead of the deliberately-unroutable host. See playwright.config.
 */
const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const WEB_DIR = path.resolve(__dirname, '..');
const BUILD_ID = path.join(WEB_DIR, '.next', 'BUILD_ID');

// Kept in lockstep with playwright.config.ts — see the contract note above.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://api.invalid/api/v1';

const env = {
  ...process.env,
  NEXT_PUBLIC_API_URL: API_URL,
  NODE_ENV: 'production',
};

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[e2e-webserver] ${msg}`);
}

const prebuilt = process.env.E2E_PREBUILT === '1';
const forceRebuild = process.env.E2E_REBUILD === '1';
const haveBuild = existsSync(BUILD_ID);

if (prebuilt && !haveBuild) {
  // Loud, specific failure. The alternative — silently building here — would
  // put a 70-second build inside Playwright's webServer timeout on the exact
  // job class this change exists to stop overloading.
  // eslint-disable-next-line no-console
  console.error(
    '[e2e-webserver] E2E_PREBUILT=1 but apps/web/.next/BUILD_ID is missing.\n' +
      '  The workflow must run `pnpm --filter web build` (with the SAME\n' +
      '  NEXT_PUBLIC_API_URL) before invoking Playwright.',
  );
  process.exit(1);
}

if (!prebuilt && (forceRebuild || !haveBuild)) {
  log(
    forceRebuild
      ? 'E2E_REBUILD=1 — rebuilding apps/web…'
      : 'no .next/BUILD_ID — building apps/web once (set E2E_REBUILD=1 to force later rebuilds)…',
  );
  const built = spawnSync('pnpm', ['run', 'build'], {
    cwd: WEB_DIR,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) {
    // eslint-disable-next-line no-console
    console.error('[e2e-webserver] `next build` failed — see the output above.');
    process.exit(built.status ?? 1);
  }
}

log(`starting next start (NEXT_PUBLIC_API_URL=${API_URL})`);
const server = spawn('pnpm', ['exec', 'next', 'start'], {
  cwd: WEB_DIR,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

// Playwright kills this process to tear the server down; forward it so we
// never leave an orphan holding port 3000 (which would then be "reused" by
// the next run and serve a stale build).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.kill(sig);
  });
}
server.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
