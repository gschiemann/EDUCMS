import { test, expect } from '@playwright/test';
import { bootMockPlayer } from './helpers/mock-player';

for (const scenario of [
  { name: 'sub-GB capacity', estimate: { usage: 96 * 1024 * 1024, quota: 256 * 1024 * 1024 }, expected: '96 MB of 256 MB' },
  { name: 'zero usage', estimate: { usage: 0, quota: 256 * 1024 * 1024 }, expected: '0 B of 256 MB' },
  { name: 'estimate unavailable', estimate: null, expected: '\u2014' },
]) {
  test(`Back menu shows truthful storage: ${scenario.name}`, async ({ page }, info) => {
    await page.addInitScript(({ estimate }) => {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: {
        estimate: () => estimate ? Promise.resolve(estimate) : Promise.reject(new Error('unavailable')),
      } });
    }, { estimate: scenario.estimate });
    await bootMockPlayer(page, { tag: 'storage-estimate', kind: 'images' });
    await expect(page.locator('img[src*="slide-"]').first()).toBeAttached({ timeout: 60000 });
    await page.keyboard.press('Escape');
    const row = page.getByText('Local storage', { exact: true }).locator('..');
    await expect(row).toContainText(scenario.expected);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('storage-estimate-menu.png') });
  });
}
