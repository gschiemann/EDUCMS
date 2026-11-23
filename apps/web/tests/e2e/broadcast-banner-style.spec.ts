import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, playerManifest, playerIds, ok } from './helpers/mock-player';

/**
 * Broadcast banner colour + static / scrolling (2026-11-01), on the real
 * player in Chromium AND WebKit. The options arrive exactly as the API signs
 * them (`banner` in the TEXT_BROADCAST payload).
 */
let pushSeq = 0;
async function push(page: Page, type: string, payload: unknown = {}) {
  // A slow runner may not have opened the (stubbed) realtime socket yet.
  await page.waitForFunction(() => !!(window as unknown as { __eduTestRealtime?: unknown }).__eduTestRealtime, undefined, { timeout: 60000 });
  // A unique eventId per push: two clears in the same millisecond must not read as a replay.
  const eventId = `${type}-${Date.now()}-${++pushSeq}`;
  await page.evaluate(({ type, payload, eventId }) => {
    const socket = (window as unknown as { __eduTestRealtime: { deliver(message: unknown): void } }).__eduTestRealtime;
    socket.deliver({ type, timestamp: Date.now(), signature: 'test-signature', eventId, payload });
  }, { type, payload, eventId });
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
  // EMG-04: every pushed message is held and the most severe is shown, so the
  // WARN scroll banner above is cleared (by its own id) before the INFO one.
  await push(page, 'ALL_CLEAR_MESSAGE', { messageId: 'style-scroll', clearedBy: 'u1' });
  await push(page, 'TEXT_BROADCAST', { messageId: 'style-none', severity: 'INFO', text: 'Plain announcement.' });
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(250, 204, 21)'); // INFO yellow
  await expect(banner(page).locator('[data-banner-text]')).toHaveCount(0);

  // A clear removes only the message it names: clear every one still held.
  for (const messageId of ['style-none', 'style-static-long', 'style-static']) {
    await push(page, 'ALL_CLEAR_MESSAGE', { messageId, clearedBy: 'u1' });
  }
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

/**
 * Text size and the real marquee speed (2026-11-23), at the two stage sizes
 * the fleet runs: 1920x1080 and 3840x2160. Measures, on the glass, the font
 * per size, the bar height a 2-line static message reaches at each size, and
 * the speed the track actually moves at for a SHORT message (the case that
 * used to run 2-3x the chosen speed). The longest messages are the next test.
 */
for (const [w, h] of [[1920, 1080], [3840, 2160]] as const) {
  test(`text size, bar height and real scroll speed on a ${w}x${h} stage`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: w, height: h });
    const tag = `broadcast-banner-size-${w}`;
    const manifest = playerManifest(playerIds(tag).screenId, 'website');
    await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
      await p.route('**/api/v1/proxy/web*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>content</body></html>' }));
      await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: [] }));
    } });
    const measured: Record<string, unknown> = { stage: `${w}x${h}` };
    const two = 'Buses are running fifteen minutes late today because of the snow, so please allow extra time this morning and use the south entrance.';
    const expectFont = { small: Math.round(w * 0.017), medium: Math.round(w * 0.022), large: Math.round(w * 0.03) };
    let n = 0;
    const held: string[] = [];
    const show = async (options: unknown, text: string) => {
      // Clear what is held first (EMG-04 shows the most severe, then newest).
      for (const id of held.splice(0)) await push(page, 'ALL_CLEAR_MESSAGE', { messageId: id, clearedBy: 'u1' });
      const id = `size-${w}-${++n}`;
      held.push(id);
      await push(page, 'TEXT_BROADCAST', { messageId: id, severity: 'INFO', text, banner: options });
      await expect(banner(page)).toBeVisible();
      await expect(banner(page).locator('[data-banner-text]')).toContainText(text.slice(0, 30));
    };
    const stageWidth = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--led-w')) || window.innerWidth);
    expect(stageWidth).toBe(w);

    for (const size of ['small', 'medium', 'large'] as const) {
      // A message that fills about 2 lines: the tallest a normal static banner gets.
      await show({ mode: 'static', size }, two);
      const s = banner(page).locator('[data-banner-text="static"]');
      await expect(s).toHaveAttribute('data-banner-size', size);
      const r = await banner(page).evaluate((el) => {
        const t = el.querySelector('[data-banner-text="static"]') as HTMLElement;
        const fs = parseFloat(getComputedStyle(t).fontSize);
        return { bar: (el as HTMLElement).offsetHeight, font: fs, lines: Math.round(t.scrollHeight / (fs * 1.25)) };
      });
      expect(r.lines).toBeLessThanOrEqual(2);
      expect(r.font).toBeLessThanOrEqual(expectFont[size]);
      expect(r.bar).toBeLessThanOrEqual(h * 0.2); // a 2-line banner never takes more than a fifth of the screen
      measured[`static-2line-${size}`] = r;

      // Scrolling: one line at the full size.
      await show({ mode: 'scroll', speed: 'slow', size }, 'Early dismissal at 1 pm');
      const sc = banner(page).locator('[data-banner-text="scroll"]');
      await expect(sc).toHaveCSS('font-size', `${expectFont[size]}px`);
      measured[`scroll-${size}`] = { bar: await banner(page).evaluate((el) => (el as HTMLElement).offsetHeight), font: expectFont[size] };
    }

    // The real speed of a SHORT message (3 copies fill the bar) at every speed.
    for (const [speed, stagesPerMin] of [['slow', 2], ['normal', 3], ['fast', 4.5]] as const) {
      await show({ mode: 'scroll', speed }, 'Early dismissal at 1 pm');
      const track = banner(page).locator('[data-banner-text="scroll"] [data-banner-track]');
      await expect(banner(page).locator(`[data-banner-speed="${speed}"]`)).toBeVisible();
      const v = await track.evaluate(async (el) => {
        // Position and time are read from the SAME clock: the animation's own
        // currentTime follows the document timeline that the painted position
        // is computed from. performance.now() runs ahead of the last frame, so
        // on a loaded runner rendering 4K a wall-clock window under-read the
        // speed (60 px/s against 64 once in review; 73-74 against 80 every run).
        const anim = (el as HTMLElement).getAnimations()[0];
        const sample = () => ({ x: (el as HTMLElement).getBoundingClientRect().left, t: Number(anim.currentTime) });
        await new Promise((r) => setTimeout(r, 300)); // past the first frame
        const a = sample();
        await new Promise((r) => setTimeout(r, 2000));
        const b = sample();
        return { pxPerSecond: (a.x - b.x) / ((b.t - a.t) / 1000), copies: el.children.length };
      });
      const expected = (w * stagesPerMin) / 60;
      measured[`speed-${speed}`] = { measuredPxPerSecond: Math.round(v.pxPerSecond), expected, copies: v.copies };
      expect(v.copies).toBeGreaterThanOrEqual(4); // a short message: 2+ copies per loop, the case that used to run 2-3x
      expect(v.pxPerSecond).toBeGreaterThan(expected * 0.8);
      expect(v.pxPerSecond).toBeLessThan(expected * 1.2);
    }
    console.log(`BANNER-MEASURE ${JSON.stringify(measured)}`);
    for (const id of held) await push(page, 'ALL_CLEAR_MESSAGE', { messageId: id, clearedBy: 'u1' });
    await expect(banner(page)).toHaveCount(0);
  });
}

/**
 * The longest static messages are shown WHOLE at every size (2026-11-23
 * review). The overlay caps the bar at 40% of the canvas and centres the text
 * column in an overflow-hidden bar, so text taller than the cap lost its first
 * AND last lines; Large at its own floor did that from about 1,300 characters
 * on a 1920 stage. Each message starts with START and ends with END; the text
 * column must sit wholly inside the bar's clip box (no line cut off at either
 * end), up to the 2,000 characters the API accepts, on 1280x720, 1920x1080
 * and 3840x2160 - and a message that fits is not shrunk for nothing (Large
 * stays larger than Medium at 400 characters).
 */
for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]] as const) {
  test(`a long static message is never clipped, at any size, on a ${w}x${h} stage`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: w, height: h });
    const tag = `broadcast-banner-clip-${w}`;
    const manifest = playerManifest(playerIds(tag).screenId, 'website');
    await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
      await p.route('**/api/v1/proxy/web*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>content</body></html>' }));
      await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: [] }));
    } });
    const core = 'Please remember that the north parking lot is closed for resurfacing until Friday. '.repeat(30);
    const message = (n: number) => `${`START ${core}`.slice(0, n - 4)} END`;
    const measured: Record<string, unknown> = { stage: `${w}x${h}`, cap: Math.round(h * 0.4) };
    const fonts: Record<string, number> = {};
    let n = 0;
    const held: string[] = [];
    for (const length of [400, 1500, 2000]) {
      for (const size of ['small', 'medium', 'large'] as const) {
        for (const id of held.splice(0)) await push(page, 'ALL_CLEAR_MESSAGE', { messageId: id, clearedBy: 'u1' });
        const id = `clip-${w}-${++n}`;
        held.push(id);
        const text = message(length);
        expect(text.length).toBe(length);
        await push(page, 'TEXT_BROADCAST', { messageId: id, severity: 'INFO', text, banner: { mode: 'static', size } });
        const s = banner(page).locator(`[data-banner-text="static"][data-banner-size="${size}"]`);
        await expect(s).toBeVisible();
        await expect(s).toContainText(text.slice(0, 40));
        const r = await banner(page).evaluate((el) => {
          const bar = el as HTMLElement;
          const t = bar.querySelector('[data-banner-text="static"]') as HTMLElement;
          const b = bar.getBoundingClientRect();
          const tr = t.getBoundingClientRect();
          // overflow clips at the padding box: inside the border.
          const clipTop = b.top + bar.clientTop;
          const clipBottom = clipTop + bar.clientHeight;
          const fs = parseFloat(getComputedStyle(t).fontSize);
          return {
            bar: bar.offsetHeight,
            font: fs,
            lines: Math.round(t.scrollHeight / (fs * 1.25)),
            cutTop: Math.round(Math.max(0, clipTop - tr.top)),
            cutBottom: Math.round(Math.max(0, tr.bottom - clipBottom)),
          };
        });
        measured[`${length}ch-${size}`] = r;
        expect(r.cutTop, `${length} characters at ${size}: lines cut off the top`).toBeLessThanOrEqual(1);
        expect(r.cutBottom, `${length} characters at ${size}: lines cut off the bottom`).toBeLessThanOrEqual(1);
        expect(r.bar).toBeLessThanOrEqual(Math.round(h * 0.4) + 1);
        if (length === 400) fonts[size] = r.font;
      }
    }
    // A message that fits is not shrunk for nothing: Large still reads larger.
    expect(fonts.large).toBeGreaterThan(fonts.medium);
    expect(fonts.medium).toBeGreaterThan(fonts.small);
    console.log(`BANNER-CLIP ${JSON.stringify(measured)}`);
    for (const id of held) await push(page, 'ALL_CLEAR_MESSAGE', { messageId: id, clearedBy: 'u1' });
    await expect(banner(page)).toHaveCount(0);
  });
}

test('the poll carries the text size to a screen that missed the push', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const tag = 'broadcast-banner-size-poll';
  const manifest = playerManifest(playerIds(tag).screenId, 'website');
  const message = {
    id: 'poll-size-1', type: 'TEXT_BROADCAST', severity: 'WARN', textBlob: 'Gym closed this afternoon.', mediaUrls: [], audioUrl: null,
    expiresAt: null, createdAt: new Date().toISOString(),
    banner: { mode: 'scroll', speed: 'slow', size: 'large' },
  };
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route('**/api/v1/proxy/web*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>content</body></html>' }));
    await p.route('**/api/v1/emergency/messages*', r => ok(r, { active: [message] }));
  } });
  await expect(banner(page)).toBeVisible({ timeout: 30000 });
  const scroll = banner(page).locator('[data-banner-text="scroll"][data-banner-speed="slow"][data-banner-size="large"]');
  await expect(scroll).toBeVisible();
  await expect(scroll).toHaveCSS('font-size', '58px');
});
