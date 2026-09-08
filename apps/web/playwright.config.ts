import { defineConfig, devices } from '@playwright/test';

/**
 * Web-app-scoped Playwright config.
 *
 * Existence rationale: the repo-root `playwright.config.ts` requires a live
 * NestJS API (`pnpm --filter api run start:dev`) with a real database; those
 * tests need seeded admin sessions / device tokens. The E2E suite under
 * `apps/web/tests/e2e/` is intentionally self-contained — every API call is
 * intercepted with `page.route()` and the only running server is `next dev`.
 *
 * Why a second config instead of extending the root one:
 *   - We DO NOT want to boot the API for a test that mocks every endpoint.
 *     Coupling these tests to a Railway/Postgres pool would re-introduce
 *     the very flakiness this suite exists to prevent.
 *   - The root config's `webServer` array doesn't compose cleanly with a
 *     "Next-only" subset; a sibling config with its own `webServer` is
 *     cleaner than gating the root one on env.
 *   - Locating the config next to the tests keeps `playwright test`
 *     discoverable from `apps/web/` (`pnpm test:e2e` script).
 *
 * Per CLAUDE.md "Cross-browser support — non-negotiable": run BOTH chromium
 * AND webkit. The 2026-05-09 holiday-bridge bug shipped because local dev
 * was Chrome-only; we don't repeat that mistake on a life-safety surface.
 */
export default defineConfig({
  // Compile /player once before any browser starts — see the file header.
  // This is what fixes the webkit-only Emergency Path red; the per-test
  // budget bump and the beforeAll warm-up both failed for reasons
  // documented there.
  globalSetup: require.resolve('./tests/global-setup.ts'),

  testDir: './tests/e2e',
  // The emergency-path spec is fully self-contained per-test (each test
  // installs its own routes/init scripts and tears down on close). Running
  // in parallel inside a single file is fine; serialize across browsers via
  // the project workers below to keep CI logs readable.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // 2026-08-30 — 20s → 60s. The 20s cap predates the credential-lifecycle
  // suite: with multiple heavy specs in PARALLEL local workers against ONE
  // dev-compiling Next server, a bare page.goto can exceed 20s from
  // contention alone (CI is immune — workers:1 above serializes it). A
  // ceiling only bounds failures; passing tests are exactly as fast as
  // before, and genuinely slow tests still declare their own setTimeout.
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // The player page does NOT use service workers in test mode (we never
    // call register on it in this spec), but explicitly opt out so the
    // post-mount SW poll doesn't add real network noise on top of routes.
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      // 2026-08-04 — templates-gallery-perf is CHROMIUM-ONLY and must not even
      // be scheduled on this project.
      //
      // That spec declares worker-scoped Chromium launch flags
      // (`--disable-features=IsolateOrigins,site-per-process`,
      // `--disable-site-isolation-trials`) via `test.use({ launchOptions })`,
      // because its whole measurement depends on iframe long-tasks surfacing
      // on the PARENT thread. Its body then calls
      // `test.skip(browserName !== 'chromium')` — but that skip runs INSIDE the
      // test, which is far too late: Playwright must launch a browser for the
      // worker first, and the distinct launchOptions force a NEW worker to spawn
      // just for this file. On the CI runner that launch dies with
      // `browserType.launch: Target page, context or browser has been closed`,
      // and the file failed 3x (initial + 2 retries) as the sole red in an
      // otherwise 45-passing run. Locally WebKit tolerates the flags and reports
      // "1 skipped", which is exactly why this hid for so long.
      //
      // testIgnore is the right lever because it excludes the file at
      // SCHEDULING time — WebKit is never launched for it at all. A file-level
      // `test.skip(({browserName}) => ...)` was tried first and REVERTED: it
      // broke the skip on both engines.
      //
      // Chromium still runs the spec in full; nothing about the guard weakens.
      testIgnore: /templates-gallery-perf\.spec\.ts$/,
    },
  ],

  webServer: {
    // A PREBUILT production server (`next build` → `next start`), never
    // `next dev`.
    //
    // 2026-09-05 — this was `pnpm dev`. `next dev` compiles a route on its
    // FIRST request, and when the repo went private on 2026-09-04 the
    // GitHub-hosted Linux runner dropped from the public 4-vCPU / 16 GB
    // class to the private 2-vCPU / 7 GB one. Every run of `Emergency Path`
    // and both `CI & Security` E2E jobs died from that push onward, always
    // in the same place — compiling /board/[gameId], then
    // "##[error]The runner has received a shutdown signal" — including on a
    // re-run of an unchanged commit and on a first-red commit that touched
    // only Kotlin.
    //
    // Reproduced in a container capped to the private-runner spec: under
    // `next dev` the /board compile drove the cgroup to 6.83 GB and the
    // kernel OOM-killer fired (memory.events oom_kill 1) with the request
    // never returning. Prebuilt, the same box builds in 69 s at 5.23 GB peak
    // with zero OOM events and then SERVES at 0.70 GB, answering /player in
    // 1 s and /board in 0 s. Full write-up in tests/e2e-webserver.cjs.
    //
    // Serving the production bundle is also strictly closer to what ships:
    // no dev overlay, no HMR socket, real chunking, and the enforced
    // nonce-based CSP that only a real build can emit (SEC-010).
    command: 'node ./tests/e2e-webserver.cjs',
    cwd: '.',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Two very different budgets, deliberately:
    //   E2E_PREBUILT=1 — the workflow already built, so `next start` answers
    //     in ~1 s. 120 s makes a missing or broken build fail FAST instead of
    //     idling out a job.
    //   otherwise — e2e-webserver.cjs builds first (local `pnpm test:e2e` from
    //     a clean tree, and cross-browser.yml's widget-render job, which has
    //     no build step of its own). `next build` measured 69 s on a 2-vCPU
    //     box; 600 s is generous headroom for a cold, loaded runner.
    timeout: process.env.E2E_PREBUILT === '1' ? 120_000 : 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Force the API base URL onto an obviously-fake host so a missed
      // mock blows up loud (DNS NXDOMAIN) rather than silently hitting
      // production. EVERY API call in this suite MUST be intercepted.
      //
      // ⚠️ NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, so
      // this value MUST also be set for the build — in CI that is the
      // workflow's build step; locally e2e-webserver.cjs passes the same
      // default through to the build it runs. Setting it only here (which is
      // all `next dev` ever needed) would bake the localhost fallback into
      // the bundle and quietly defeat the NXDOMAIN tripwire.
      NEXT_PUBLIC_API_URL: 'http://api.invalid/api/v1',
      // (E2E_PREBUILT / E2E_REBUILD arrive through process.env — Playwright
      // merges it into the webServer environment, so they need no entry here.)
    },
  },
});
