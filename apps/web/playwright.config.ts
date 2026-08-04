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
  // The whole suite must complete in well under 30s per the audit brief.
  // Per-test cap at 20s — anything slower is a regression, not a slow test.
  timeout: 20_000,
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
    // `next dev` on apps/web. We rely on the global `pnpm install` having
    // run at workspace root. Running from this package keeps the cwd
    // correct for relative imports (`@/components/...`).
    command: 'pnpm dev',
    cwd: '.',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // First-boot Next compile of the player route ~30-60s on CI; allow
    // headroom but cap so a stuck build fails fast.
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Force the API base URL onto an obviously-fake host so a missed
      // mock blows up loud (DNS NXDOMAIN) rather than silently hitting
      // production. EVERY API call in this suite MUST be intercepted.
      NEXT_PUBLIC_API_URL: 'http://api.invalid/api/v1',
    },
  },
});
