import { defineConfig, devices } from '@playwright/test';

/**
 * EDU CMS Playwright configuration.
 * Chromium-only (zero-budget constraint). See docs/E2E_TESTING.md.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // W0-06 (2026-07-13): only *.spec.ts are Playwright tests. Jest-style
  // *.test.ts files in this dir used to crash collection ("describe is not
  // defined") leaving the gate at "Total: 0 tests" while CI stayed green.
  // The theater files now live in tests/quarantine-jest-theater/.
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // emergency tests must not race
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  expect: {
    timeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter api run start:dev',
      url: 'http://localhost:8080/api/v1/health',
      reuseExistingServer: !process.env.CI,
      // Nest ts watch-compile from cold takes minutes on a 2-vCPU CI
      // runner — 180s timed out on the first real CI run (2026-07-14).
      timeout: 300_000,
      stdout: 'pipe', // boot logs land in CI output when startup fails
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter web run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
