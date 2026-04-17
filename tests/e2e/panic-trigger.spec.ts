import { test, expect } from './fixtures';

/**
 * panic-trigger.spec.ts — SAFETY-CRITICAL emergency trigger flow.
 *
 * Skipped: live API calls require a running DB + valid admin session cookie.
 * TODO (Sprint 2): unskip with seeded admin session + live API.
 *
 * The CSRF fixture IS primed here (production-readiness) even while skipped.
 */

test.describe('Panic trigger — lockdown', () => {
  test('panic page loads without console errors', async ({ csrfPage: page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/panic');
    await page.waitForLoadState('networkidle');
    // Page should render (even if unauthenticated it may redirect — that's fine)
    expect(errors).toHaveLength(0);
  });

  test.skip('admin sees panic button UI after auth', async ({ csrfPage: page, adminToken }) => {
    // TODO: requires valid session cookie from login flow (Sprint 2).
    // Store cookie via page.context().addCookies([...]) once auth is seeded.
    await page.goto('/panic');
    await page.waitForSelector('[data-testid="panic-trigger-btn"]', { timeout: 10_000 });
    await expect(page.locator('[data-testid="panic-trigger-btn"]')).toBeVisible();
  });

  test.skip('3-second hold triggers lockdown and shows success UI', async ({
    csrfPage: page,
    adminToken,
    tenantId,
  }) => {
    // TODO: requires auth session + live API + seeded tenant (Sprint 2).
    // The hold UX requires mouse-down for 3000ms — use page.mouse.down() + waitForTimeout.
    await page.goto('/panic');
    const btn = page.locator('[data-testid="panic-trigger-btn"]');
    await btn.waitFor({ state: 'visible' });
    await page.mouse.move(0, 0);
    await btn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3100);
    await page.mouse.up();
    await expect(page.locator('[data-testid="panic-success"]')).toBeVisible({ timeout: 8_000 });
  });
});
