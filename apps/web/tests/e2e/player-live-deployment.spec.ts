import { test, expect } from '@playwright/test';
import { bootMockPlayer, ok, type MockKind } from './helpers/mock-player';

test.use({ serviceWorkers: 'block' });

for (const kind of ['website', 'images', 'video'] as MockKind[]) {
  test(`a new deployment preserves the running ${kind} past the former forced-reload limit and playlist wraps`, async ({ page }) => {
    const drift: string[] = [];
    page.on('console', msg => { if (msg.text().includes('[bundle-drift]')) drift.push(msg.text()); });
    await page.clock.install();
    await bootMockPlayer(page, { tag: `live-deployment-${kind}`, kind,
      playback: { loopMode: 'native' }, videoMp4: kind === 'video',
      extraRoutes: async p => {
        await p.route('**/api/build-info*', r => ok(r, { sha: 'bbbbbbbbbbbb', bundleId: 'bbbbbbbbbbbb' }));
      } });
    if (kind === 'website') await expect(page.locator('[aria-label="Native URL overlay active"]')).toHaveCount(1, { timeout: 30_000 });
    if (kind === 'images') await expect(page.locator('img[data-slide-id]')).toHaveCount(3, { timeout: 30_000 });
    if (kind === 'video') await expect.poll(() => page.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames || 0), { timeout: 30_000 }).toBeGreaterThan(5);
    await page.evaluate(() => { (window as unknown as { preservedDocument: string }).preservedDocument = 'live'; });
    await page.clock.fastForward(31_000);
    // Prove the comparison ran: a missing build stamp cannot make this pass.
    await expect.poll(() => drift.some(line => line.includes('server=bbbbbbbbbbbb'))).toBe(true);
    // Cross several slideshow wraps while drift is pending.
    for (let i = 0; i < 4; i++) await page.clock.fastForward(2_000);
    await page.clock.fastForward(6 * 60_000);
    await expect.poll(() => drift.some(line => line.includes('waiting for idle'))).toBe(true);
    const checks = drift.filter(line => line.includes('server=bbbbbbbbbbbb')).length;
    await page.clock.fastForward(15 * 60_000);
    await expect.poll(() => drift.filter(line => line.includes('server=bbbbbbbbbbbb')).length).toBeGreaterThan(checks);
    await page.clock.fastForward(6 * 60_000);
    expect(await page.evaluate(() => (window as unknown as { preservedDocument: string }).preservedDocument)).toBe('live');
    expect(drift.some(line => line.includes('forcing reload') || line.includes('reloading at the seam'))).toBe(false);
  });
}
