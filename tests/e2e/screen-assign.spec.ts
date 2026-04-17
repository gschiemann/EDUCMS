import { test, expect } from './fixtures';

/**
 * screen-assign.spec.ts — Assign a screen to a playlist.
 *
 * Skipped: requires seeded screen + playlist records and authenticated session.
 * TODO (Sprint 2): unskip with seeded DB + admin auth.
 */

test.describe('Screen assignment', () => {
  test('screens page responds without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/screens');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test.skip('screen list is visible to authenticated admin', async ({
    csrfPage: page,
    adminToken,
  }) => {
    // TODO: requires auth session + seeded screens (Sprint 2).
    await page.goto('/screens');
    await expect(page.locator('[data-testid="screen-list"]')).toBeVisible({ timeout: 8_000 });
  });

  test.skip('assigning a screen to a playlist updates the screen record', async ({
    csrfPage: page,
    adminToken,
  }) => {
    // TODO: requires seeded screen ID + playlist ID (Sprint 2).
    await page.goto('/screens');
    await page.click('[data-testid="screen-item"]:first-child [data-testid="assign-btn"]');
    await page.click('[data-testid="playlist-option"]:first-child');
    await page.click('[data-testid="assign-confirm-btn"]');
    await expect(page.locator('[data-testid="assign-success-toast"]')).toBeVisible({
      timeout: 8_000,
    });
  });
});
