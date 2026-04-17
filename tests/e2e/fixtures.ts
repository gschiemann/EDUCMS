import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared fixtures for EDU CMS E2E tests.
 *
 * Auth values come from environment variables — never hardcode real secrets.
 * Set PLAYWRIGHT_ADMIN_TOKEN and PLAYWRIGHT_TENANT_ID in your local .env or CI secrets.
 */

export type CmsFixtures = {
  /** Page with CSRF token already primed */
  csrfPage: Page;
  /** Valid JWT for a SCHOOL_ADMIN account (stubbed / from env) */
  adminToken: string;
  /** Tenant ID under test (from env, default 'test-school-1') */
  tenantId: string;
};

export const test = base.extend<CmsFixtures>({
  adminToken: async ({}, use) => {
    const token = process.env.PLAYWRIGHT_ADMIN_TOKEN ?? 'STUB_ADMIN_TOKEN_NOT_REAL';
    await use(token);
  },

  tenantId: async ({}, use) => {
    const id = process.env.PLAYWRIGHT_TENANT_ID ?? 'test-school-1';
    await use(id);
  },

  csrfPage: async ({ page }, use) => {
    // Prime the CSRF token by hitting the csrf endpoint before each test.
    // The API is running with CSRF_ENFORCE=false (warn mode) so this is
    // belt-and-suspenders for production-readiness.
    try {
      await page.goto('http://localhost:8080/api/v1/security/csrf', {
        waitUntil: 'domcontentloaded',
        timeout: 10_000,
      });
    } catch {
      // API may not be running in offline fixture mode — tests that need it will skip.
    }
    await use(page);
  },
});

export { expect };
