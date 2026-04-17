import { test, expect } from './fixtures';

/**
 * playlist-create.spec.ts — New playlist creation happy path.
 *
 * Skipped: form submission and list verification require auth + live DB.
 * TODO (Sprint 2): unskip once seeded admin session + playlist endpoint tested.
 */

test.describe('Playlist creation', () => {
  test('playlists page responds without crash when unauthenticated', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test.skip('new playlist form is visible to authenticated admin', async ({
    csrfPage: page,
    adminToken,
  }) => {
    // TODO: requires auth session + navigate to playlist management (Sprint 2).
    await page.goto('/dashboard');
    await page.click('[data-testid="nav-playlists"]');
    await page.click('[data-testid="create-playlist-btn"]');
    await expect(page.locator('[data-testid="playlist-form"]')).toBeVisible({ timeout: 8_000 });
  });

  test.skip('creating a playlist persists it in the list', async ({
    csrfPage: page,
    adminToken,
  }) => {
    // TODO: requires auth + seeded DB (Sprint 2).
    const name = `E2E Test Playlist ${Date.now()}`;
    await page.goto('/dashboard');
    await page.click('[data-testid="nav-playlists"]');
    await page.click('[data-testid="create-playlist-btn"]');
    await page.fill('[name="name"]', name);
    await page.click('[data-testid="playlist-save-btn"]');
    await expect(page.locator(`text=${name}`)).toBeVisible({ timeout: 8_000 });
  });
});
