import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.BUSINESS_PROFIT_PORT || '3263';
const BASE_URL = process.env.BUSINESS_PROFIT_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `node scripts/emit-locale-catalogs.cjs && pnpm exec next dev --hostname 127.0.0.1 --port ${PORT}`,
    cwd: '../../../../',
    url: `${BASE_URL}/super/profit`,
    reuseExistingServer: !!process.env.BUSINESS_PROFIT_URL,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_URL: 'http://localhost:8080/api/v1' },
  },
});
