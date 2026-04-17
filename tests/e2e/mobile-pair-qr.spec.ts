/**
 * Sprint 6 — Mobile QR pairing flow.
 *
 * We can't grant a real camera to Chromium headless in CI, so we use the
 * `__pairFromQrData` window hook that the /pair page exposes. The hook feeds
 * the same pipeline a real decoded QR payload would hit, so this exercises
 * code extraction, API call, and success UI.
 */
import { test, expect } from '@playwright/test';

test.describe('Mobile QR pairing', () => {
  test('decodes a QR payload URL and pairs the screen', async ({ page }) => {
    // Stub the pair endpoint so we don't need a real screen in pairing state.
    await page.route('**/screens/pair', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      expect(body.pairingCode).toBe('ABC123');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'scr-1', name: 'Test Screen' }),
      });
    });

    await page.goto('/pair');
    await expect(page.getByRole('heading', { name: /pair a screen/i })).toBeVisible();

    // Simulate a QR decoder firing with a URL-form payload (as the admin
    // "Scan instead" QR encodes it).
    await page.evaluate(() => {
      (window as unknown as { __pairFromQrData: (s: string) => void })
        .__pairFromQrData('https://example.test/pair?code=ABC123');
    });

    await expect(page.getByText(/paired!/i)).toBeVisible({ timeout: 5000 });
  });

  test('manual code entry still works', async ({ page }) => {
    await page.route('**/screens/pair', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'scr-2', name: 'Typed Screen' }),
      });
    });

    await page.goto('/pair');
    await page.getByTestId('manual-pair-code').fill('xyz789');
    await page.getByRole('button', { name: /^pair$/i }).click();
    await expect(page.getByText(/paired!/i)).toBeVisible({ timeout: 5000 });
  });
});
