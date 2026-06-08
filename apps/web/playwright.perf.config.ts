import { defineConfig, devices } from '@playwright/test';

/**
 * Performance-spec Playwright config — for `tests/e2e/templates-gallery-perf.spec.ts`.
 *
 * Why a THIRD config (alongside `playwright.config.ts`)?
 *   - The default `playwright.config.ts` boots `next dev` as a global
 *     `webServer` for every spec. The templates-gallery perf spec is
 *     intentionally self-contained: it starts its OWN tiny static server
 *     (over `apps/web/public`) inside `beforeAll`, and never touches Next.
 *     Coupling it to a 60-120s `next dev` boot would only add latency and a
 *     flake source — the opposite of what a perf canary wants.
 *   - It runs chromium-only: the measurement relies on the `longtask`
 *     PerformanceObserver entry type and on disabling site-isolation, both
 *     Chromium-only. (The spec itself also `test.skip`s on non-chromium, so
 *     it's safe under the default config too — this config just makes the
 *     happy path fast and dependency-free.)
 *
 * Run it directly:
 *   pnpm --filter web run test:e2e:gallery-perf
 *   # or
 *   playwright test -c playwright.perf.config.ts
 *
 * The spec ALSO runs under the default config (`playwright test
 * tests/e2e/templates-gallery-perf.spec.ts --project=chromium`) on any tree
 * where `next dev` can boot — it just pays the Next-boot tax there.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'templates-gallery-perf.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // The single test budgets ~90s internally (4 measurement windows + a probe);
  // give headroom over that so a genuinely-stuck run still fails fast.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    trace: 'on-first-retry',
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No `webServer`: the spec starts its own static server in beforeAll.
});
