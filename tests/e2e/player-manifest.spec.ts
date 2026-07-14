import { test, expect } from './fixtures';

/**
 * player-manifest.spec.ts — Player page fetches manifest without errors.
 *
 * Skipped: manifest content assertions require seeded schedule + screen.
 * TODO (Sprint 2): unskip once player manifest route is seeded.
 */

test.describe('Player manifest', () => {
  test('player page loads without a fatal render crash', async ({ page }) => {
    // An UNPAIRED player (no screen, no device token) legitimately logs data
    // errors — /branding/me returns 401, the manifest fetch has no auth. So
    // this smoke check does NOT assert zero pageerrors (that needs a seeded
    // paired screen — the skipped tests below, REL-002). It asserts the shell
    // mounted and the page is not a blank white-screen crash.
    // 'networkidle' is a trap here (the player keeps polling) → bounded wait.
    await page.goto('/player');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const bodyHtml = await page.content();
    // Something rendered (not an empty body from a mount-time throw).
    expect(bodyHtml.length).toBeGreaterThan(500);
    void bodyText;
  });

  test('player page returns non-5xx status', async ({ page }) => {
    const res = await page.goto('/player');
    expect(res?.status()).toBeLessThan(500);
  });

  test.skip('player manifest API returns 200 with items array', async ({
    page,
    tenantId,
  }) => {
    // TODO: requires seeded screen paired to a tenant with an active schedule (Sprint 2).
    // Provide PLAYWRIGHT_DEVICE_TOKEN env var for device-auth'd manifest fetch.
    const deviceToken = process.env.PLAYWRIGHT_DEVICE_TOKEN ?? '';
    const res = await page.request.get(
      `http://localhost:8080/api/v1/player/manifest?tenantId=${tenantId}`,
      { headers: deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {} },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  test.skip('player page renders at least one widget zone', async ({
    page,
    tenantId,
  }) => {
    // TODO: requires seeded schedule visible to the player (Sprint 2).
    await page.goto(`/player?tenantId=${tenantId}`);
    await expect(page.locator('[data-testid="widget-zone"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
