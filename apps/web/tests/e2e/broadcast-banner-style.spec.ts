import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, playerManifest, playerIds, ok } from './helpers/mock-player';

/**
 * Broadcast banner colour + static / scrolling (2026-11-01), on the real
 * player in Chromium AND WebKit. The options arrive exactly as the API signs
 * them (`banner` in the TEXT_BROADCAST payload).
 */
async function push(page: Page, type: string, payload: unknown = {}) {
  await page.evaluate(({ type, payload }) => {
    const socket = (window as unknown as { __eduTestRealtime: { deliver(message: unknown): void } }).__eduTestRealtime;
    socket.deliver({ type, timestamp: Date.now(), signature: 'test-signature', eventId: `${type}-${Date.now()}`, payload });
  }, { type, payload });
}

const banner = (page: Page) => page.locator('[data-edu-emergency-root="banner"]');

test('static and scrolling banners render with the sender colour on the player', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const tag = 'broadcast-banner-style';
  const manifest = playerManifest(playerIds(tag).screenId, 'website');
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route('**/api/v1/proxy/web*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="background:#1e293b;color:white"><h1>Playing content</h1></body></html>' }));
    await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: [] }));
  } });

  // ── Static: custom colour, centred text, light text on a dark colour ──
  await push(page, 'TEXT_BROADCAST', {
    messageId: 'style-static', severity: 'INFO', text: 'Buses are running 15 minutes late today.',
    banner: { color: '#6d28d9', mode: 'static', speed: 'normal' },
  });
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(109, 40, 217)');
  await expect(banner(page)).toHaveCSS('color', 'rgb(255, 255, 255)');
  const staticText = banner(page).locator('[data-banner-text="static"]');
  await expect(staticText).toHaveText('Buses are running 15 minutes late today.');
  await expect(staticText).toHaveCSS('text-align', 'center');
  if (process.env.BROADCAST_SHOTS) await page.screenshot({ path: `${process.env.BROADCAST_SHOTS}/banner-static-${test.info().project.name}.png` });

  // Long text wraps to at most 2 lines (it shrinks, down to a floor).
  const long = 'Please remember that the north parking lot is closed for resurfacing until Friday, so use the south entrance and allow extra time to walk to class. '.repeat(2);
  await push(page, 'TEXT_BROADCAST', { messageId: 'style-static-long', severity: 'INFO', text: long, banner: { color: '#6d28d9', mode: 'static' } });
  await expect(staticText).toContainText('north parking lot');
  const lines = await staticText.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return Math.round((el as HTMLElement).scrollHeight / parseFloat(cs.lineHeight));
  });
  expect(lines).toBeLessThanOrEqual(3); // 2 lines + at most one floor-size spill on a 1280 canvas

  // ── Scrolling: dark text on a light colour, a moving seamless track ──
  await push(page, 'TEXT_BROADCAST', {
    messageId: 'style-scroll', severity: 'WARN', text: 'Parent pickup moves to the gym doors.',
    banner: { color: '#facc15', mode: 'scroll', speed: 'fast' },
  });
  const scroll = banner(page).locator('[data-banner-text="scroll"]');
  await expect(scroll).toBeVisible();
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(250, 204, 21)');
  await expect(banner(page)).toHaveCSS('color', 'rgb(15, 23, 42)');
  const track = scroll.locator('[data-banner-track]');
  const x0 = await track.evaluate((el) => (el as HTMLElement).getBoundingClientRect().left);
  await page.waitForTimeout(700);
  const x1 = await track.evaluate((el) => (el as HTMLElement).getBoundingClientRect().left);
  expect(x1).toBeLessThan(x0 - 5); // it is moving left
  // Seamless: an even number of identical copies, wider than the viewport it loops across.
  const info = await track.evaluate((el) => ({
    copies: el.children.length,
    width: (el as HTMLElement).offsetWidth,
    clip: ((el as HTMLElement).parentElement as HTMLElement).offsetWidth,
  }));
  expect(info.copies % 2).toBe(0);
  expect(info.width / 2).toBeGreaterThanOrEqual(info.clip);
  if (process.env.BROADCAST_SHOTS) await page.screenshot({ path: `${process.env.BROADCAST_SHOTS}/banner-scroll-${test.info().project.name}.png` });

  // ── An older message with no options keeps today's look ──
  await push(page, 'TEXT_BROADCAST', { messageId: 'style-none', severity: 'INFO', text: 'Plain announcement.' });
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(250, 204, 21)'); // INFO yellow
  await expect(banner(page).locator('[data-banner-text]')).toHaveCount(0);

  await push(page, 'ALL_CLEAR_MESSAGE');
  await expect(banner(page)).toHaveCount(0);
});

test('a screen that missed the push renders the same banner from the poll', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const tag = 'broadcast-banner-poll';
  const manifest = playerManifest(playerIds(tag).screenId, 'website');
  const message = {
    id: 'poll-1', type: 'TEXT_BROADCAST', severity: 'INFO', textBlob: 'Library closes early.', mediaUrls: [], audioUrl: null,
    expiresAt: null, createdAt: new Date().toISOString(),
    banner: { color: '#15803d', mode: 'scroll', speed: 'slow' },
  };
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route('**/api/v1/proxy/web*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>content</body></html>' }));
    await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: [message] }));
  } });
  await expect(banner(page)).toBeVisible({ timeout: 30000 });
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(21, 128, 61)');
  await expect(banner(page).locator('[data-banner-text="scroll"][data-banner-speed="slow"]')).toBeVisible();
});
