import { test, expect } from './fixtures';

/**
 * schedule-publish.spec.ts — Schedule a playlist and verify manifest updates.
 *
 * Skipped: requires seeded playlist + screen + live schedule API.
 * TODO (Sprint 2): unskip with seeded DB + auth session.
 */

test.describe('Schedule publish', () => {
  test('schedules page loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/schedules');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test.skip('schedule form is visible to authenticated admin', async ({
    csrfPage: page,
    adminToken,
  }) => {
    // TODO: requires auth session (Sprint 2).
    await page.goto('/schedules');
    await page.click('[data-testid="create-schedule-btn"]');
    await expect(page.locator('[data-testid="schedule-form"]')).toBeVisible({ timeout: 8_000 });
  });

  test.skip('publishing a schedule returns 201 from the API', async ({
    csrfPage: page,
    adminToken,
    tenantId,
  }) => {
    // TODO: requires seeded playlistId + screenId (Sprint 2).
    const res = await page.request.post('http://localhost:8080/api/v1/schedules', {
      data: {
        playlistId: 'STUB_PLAYLIST_ID',
        screenId: 'STUB_SCREEN_ID',
        startTime: new Date().toISOString(),
        isActive: true,
        priority: 1,
      },
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([200, 201]).toContain(res.status());
  });

  test.skip('manifest endpoint reflects the published schedule', async ({
    page,
    tenantId,
  }) => {
    // TODO: requires live schedule + player manifest route (Sprint 2).
    const res = await page.request.get(
      `http://localhost:8080/api/v1/player/manifest?tenantId=${tenantId}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
  });
});
