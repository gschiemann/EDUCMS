import { test, expect } from './fixtures';

/**
 * dashboard-load.spec.ts — Dashboard renders without JS console errors.
 *
 * Skipped: deep content assertions require authenticated session.
 * TODO (Sprint 2): unskip the auth check once seeded users exist.
 */

test.describe('Dashboard load', () => {
  test('root page responds with HTML (no 5xx)', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBeLessThan(500);
  });

  test('root page loads without uncaught JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test.skip('authenticated admin sees the dashboard layout', async ({ page }) => {
    // TODO: requires valid admin session cookie (Sprint 2).
    await page.goto('/dashboard');
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible({ timeout: 8_000 });
  });

  test('login redirect on unauthenticated dashboard visit returns a page (not crash)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    // May redirect to /login — just verify no crash
    expect(errors).toHaveLength(0);
  });
});
