/**
 * The solo-video repeat in a REAL browser (video-loop audit F1/F2).
 *
 * A mocked player (every request intercepted — no real ids or tokens) plays a
 * 2.5 s numbered WebM. Three questions, each answered by the page itself:
 *
 *   1. With the default manifest the browser's own loop runs, and the native
 *      probe MEASURES its seam (`window.__eduLoopBoundary`).
 *   2. With `playback.loopMode: 'twodeck'` the hand-off happens lap after lap
 *      without a fallback, the top element alternates, and the seam is measured
 *      as a hand-off.
 *   3. When the standby cannot load, the page gives up ON ITS OWN, the picture
 *      keeps playing on the native loop, and the device is blocked from trying
 *      again — the safety net, end to end.
 *
 * This proves the logic against real `<video>` elements and real rVFC timing on
 * a desktop browser. It does NOT prove a 4K Android WebView behaves the same:
 * that is what `lastVideoReport.loop` on the real screens is for.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer } from './helpers/mock-player';

type Snap = { backend: string; boundaries: number; maxHoldMs: number; p95HoldMs: number; lastHoldMs: number; maxSkipMs: number; swaps: number; fallbacks: number; fallbackReason?: string } | null;
const snap = (page: Page) => page.evaluate(() => (window as unknown as { __eduLoopBoundary?: () => Snap }).__eduLoopBoundary?.() ?? null);

test.describe('solo video repeat', () => {
  // Chromium only: the clip is VP8 WebM and the timing evidence is rVFC, both
  // qualified there — and an Android WebView is Chromium. (Safari's engine is
  // not a target of the two-deck path; the eligibility rules keep it native
  // where requestVideoFrameCallback is missing.)
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebM/VP8 + rVFC timing are Chromium-qualified');

  test('default: the native loop runs and its seam is measured', async ({ page }) => {
    test.setTimeout(90_000);
    await bootMockPlayer(page, { tag: 'loop-native', kind: 'video' });
    await expect(page.locator('video').first()).toBeAttached({ timeout: 40_000 });
    await expect(page.locator('[data-loop-backend="twodeck"]')).toHaveCount(0);
    // 2.5 s clip: the first wrap arrives a few seconds after playback starts.
    await expect.poll(async () => (await snap(page))?.boundaries ?? 0, { timeout: 30_000, intervals: [500] }).toBeGreaterThanOrEqual(1);
    const s = (await snap(page))!;
    expect(s.backend).toBe('native');
    expect(s.maxSkipMs).toBe(0); // a native loop trims nothing
    expect(s.maxHoldMs).toBeGreaterThanOrEqual(0);
  });

  test('two-deck: hands off lap after lap, alternates the top element, never falls back', async ({ page }) => {
    test.setTimeout(120_000);
    await bootMockPlayer(page, { tag: 'loop-twodeck', kind: 'video', playback: { loopMode: 'twodeck' } });
    await expect(page.locator('[data-loop-backend="twodeck"]')).toBeAttached({ timeout: 40_000 });

    const topDeck = () => page.evaluate(() => {
      const d = Array.from(document.querySelectorAll<HTMLVideoElement>('[data-loop-deck]'));
      return d.find((v) => v.style.zIndex === '2')?.getAttribute('data-loop-deck') ?? null;
    });
    const seen = new Set<string>();
    await expect
      .poll(async () => {
        const t = await topDeck();
        if (t) seen.add(t);
        return (await snap(page))?.swaps ?? 0;
      }, { timeout: 60_000, intervals: [250] })
      .toBeGreaterThanOrEqual(3);

    const s = (await snap(page))!;
    expect(s.backend).toBe('twodeck');
    expect(s.fallbacks).toBe(0);
    expect(s.boundaries).toBeGreaterThanOrEqual(3);
    expect([...seen].sort()).toEqual(['0', '1']); // the picture really moved between the two elements
    // A desktop browser should hand off within a few frames; the bound is loose on purpose (a busy CI runner).
    expect(s.maxHoldMs).toBeLessThan(300);
    // The active element keeps the native loop as its safety net.
    const loops = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLVideoElement>('[data-loop-deck]')).map((v) => ({ z: v.style.zIndex, loop: v.loop })));
    expect(loops.find((l) => l.z === '2')?.loop).toBe(true);
    // And it is still playing.
    const t1 = await page.evaluate(() => (document.querySelector('[data-loop-deck][style*="z-index: 2"]') as HTMLVideoElement | null)?.currentTime ?? -1);
    await page.waitForTimeout(600);
    const t2 = await page.evaluate(() => (document.querySelector('[data-loop-deck][style*="z-index: 2"]') as HTMLVideoElement | null)?.currentTime ?? -1);
    expect(t2).not.toBe(t1);
  });

  // RIOT Cleveland: the operator added ONE video three times to work around the hitch. Three items
  // are three slides, and every lap ended in a cut to black and a one-second fade up. On a screen the
  // manifest switched to the two-deck loop that playlist is ONE video that repeats.
  test('two-deck: the same clip added three times is ONE seamless loop — one slide, two elements, hand-offs lap after lap', async ({ page }) => {
    test.setTimeout(120_000);
    await bootMockPlayer(page, { tag: 'loop-copies', kind: 'video', videoCopies: 3, playback: { loopMode: 'twodeck' } });
    await expect(page.locator('[data-loop-backend="twodeck"]')).toBeAttached({ timeout: 40_000 });
    await expect.poll(async () => (await snap(page))?.swaps ?? 0, { timeout: 60_000, intervals: [250] }).toBeGreaterThanOrEqual(3);
    const dom = await page.evaluate(() => ({
      slides: document.querySelectorAll('[data-loop-backend="twodeck"]').length,
      videos: document.querySelectorAll('video').length,
      decks: document.querySelectorAll('[data-loop-deck]').length,
    }));
    // ONE slide holding two elements — no hidden next-up copy, no third decoder.
    expect(dom).toEqual({ slides: 1, videos: 2, decks: 2 });
    const s = (await snap(page))!;
    expect(s.backend).toBe('twodeck');
    expect(s.fallbacks).toBe(0);
    expect(s.maxHoldMs).toBeLessThan(300);
  });

  // Every screen — not only the two-deck ones — plays N copies of one video as ONE video: one slide,
  // one decoder, the native loop (and the native seam measured), no cut to black between laps.
  test('a screen on the native loop plays the same clip added three times as ONE video, not three slides', async ({ page }) => {
    test.setTimeout(90_000);
    await bootMockPlayer(page, { tag: 'loop-copies-native', kind: 'video', videoCopies: 3 });
    await expect(page.locator('video').first()).toBeAttached({ timeout: 40_000 });
    await expect(page.locator('[data-loop-backend="twodeck"]')).toHaveCount(0);
    // ONE <video> — no hidden next-up copy of the same file beside it.
    await expect.poll(() => page.locator('video').count(), { timeout: 20_000 }).toBe(1);
    // It loops natively and the native probe measures the seam (it only runs for a solo video).
    await expect.poll(async () => (await snap(page))?.boundaries ?? 0, { timeout: 30_000, intervals: [500] }).toBeGreaterThanOrEqual(1);
    const s = (await snap(page))!;
    expect(s.backend).toBe('native');
    const looping = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).loop);
    expect(looping).toBe(true);
  });

  test('two-deck: a standby that cannot load is abandoned on its own — native loop keeps playing, the device is blocked', async ({ page }) => {
    test.setTimeout(120_000);
    const videoRequests = { count: 0 };
    await bootMockPlayer(page, { tag: 'loop-fallback', kind: 'video', playback: { loopMode: 'twodeck' }, videoFailAfterFirst: 404, videoRequests });
    await expect(page.locator('[data-loop-backend="twodeck"]')).toBeAttached({ timeout: 40_000 });
    await expect.poll(async () => (await snap(page))?.fallbacks ?? 0, { timeout: 60_000, intervals: [500] }).toBeGreaterThanOrEqual(1);
    const s = (await snap(page))!;
    expect(s.backend).toBe('native');
    expect(s.fallbackReason).toBe('standby-error');
    expect(s.swaps).toBe(0);
    // The picture never stopped: the active element still advances and still loops.
    const a = await page.evaluate(() => (document.querySelector('[data-loop-deck="0"]') as HTMLVideoElement).currentTime);
    await page.waitForTimeout(700);
    const b = await page.evaluate(() => {
      const v = document.querySelector('[data-loop-deck="0"]') as HTMLVideoElement;
      return { t: v.currentTime, loop: v.loop, paused: v.paused };
    });
    expect(b.loop).toBe(true);
    expect(b.paused).toBe(false);
    expect(b.t).not.toBe(a);
    // The device will not try again for a day.
    const blocked = await page.evaluate(() => Number(localStorage.getItem('edu_loop_twodeck_blocked_until') || 0));
    expect(blocked).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});
