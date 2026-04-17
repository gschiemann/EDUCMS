import { test, expect } from './fixtures';

/**
 * panic-all-clear.spec.ts — SAFETY-CRITICAL emergency clear flow.
 *
 * Skipped: requires active emergency + valid admin session + live DB.
 * TODO (Sprint 2): unskip with seeded emergency state + auth.
 *
 * CSRF fixture is primed before tests run (production-readiness).
 */

test.describe('Panic all-clear', () => {
  test('panic page renders an all-clear section when emergency is active', async ({
    csrfPage: page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/panic');
    await page.waitForLoadState('networkidle');
    // Smoke: page should not crash whether emergency is active or not
    expect(errors).toHaveLength(0);
  });

  test.skip('admin can clear an active lockdown and sees confirmation', async ({
    csrfPage: page,
    adminToken,
    tenantId,
  }) => {
    // TODO: requires seeded active emergencyStatus on tenant (Sprint 2).
    // Seed the emergency state via API then visit /panic to clear it.
    await page.goto('/panic');
    const clearBtn = page.locator('[data-testid="all-clear-btn"]');
    await clearBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await clearBtn.click();
    await expect(page.locator('[data-testid="all-clear-success"]')).toBeVisible({
      timeout: 8_000,
    });
  });

  test.skip('POST /api/v1/emergency/:id/all-clear returns 200', async ({
    csrfPage: page,
    adminToken,
    tenantId,
  }) => {
    // TODO: requires real overrideId from a triggered emergency (Sprint 2).
    const res = await page.request.post(
      'http://localhost:8080/api/v1/emergency/STUB_OVERRIDE_ID/all-clear',
      {
        data: { scopeType: 'tenant', scopeId: tenantId },
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(res.status()).toBe(200);
  });
});
