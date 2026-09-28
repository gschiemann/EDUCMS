/**
 * "Loading content" on a screen that is playing — the render-proof regression
 * (Greg, 2026-09-28: "why do all the screens saying loading content?").
 *
 * The player tells the dashboard what is on its glass in the `render.hash` of
 * every telemetry POST. `pl:…` means "operator content is playing";
 * `idle:content-loading` means "a playlist is applied and its first item has
 * not reported loaded yet" and the dashboard says "Loading content".
 *
 * Commit 12d65e8dd (2026-09-24, "honest playback readiness") made that verdict
 * depend on a `mediaReady` flag that is reset to false at EVERY slide change
 * and set true only by a media element's load event. Two kinds of slide can
 * never fire one again:
 *
 *   1. An IMAGE slideshow. Every image is mounted at once and only its opacity
 *      changes, so after the first advance each `<img>` is already loaded — no
 *      new `load` event — and the flag stays false for the rest of the show.
 *   2. A WEBSITE slide shown by the APK's native viewer. The page renders only
 *      a black placeholder; nothing on the page ever reports "loaded".
 *
 * Both read "Loading content" on the dashboard for as long as they play. This
 * spec boots a fully mocked player (every request intercepted — no real ids or
 * tokens, the repo is public) and asserts the proof becomes `pl:…`.
 *
 * Telemetry posts at load and again ≥ 30 s later (TELEMETRY_MIN_INTERVAL_MS),
 * so each case waits for a `render.hash` that says `pl:`.
 */
import { test, expect } from '@playwright/test';
import { bootMockPlayer, type Posted } from './helpers/mock-player';

/** Every proof string the player has reported so far. */
const hashes = (posted: Posted[]) => posted.map((p) => p.render?.hash).filter((h): h is string => typeof h === 'string');

test.describe('render proof: a playing screen must not read "Loading content"', () => {
  test('an IMAGE slideshow reports pl:, not idle:content-loading, after its slides advance', async ({ page }) => {
    test.setTimeout(90_000);
    page.on('pageerror', (err) => {
      if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
    });
    const { telemetry } = await bootMockPlayer(page, { tag: 'images', kind: 'images' });

    // Sanity: the slideshow really is mounted (all three images at once), so a
    // failure below is the proof verdict — not a page that never reached content.
    await expect(page.locator('img[data-slide-id]')).toHaveCount(3, { timeout: 30_000 });

    // Several slides have advanced long before the second post (≥ 30 s).
    await expect
      .poll(() => hashes(telemetry).some((h) => h.startsWith('pl:')), {
        timeout: 60_000,
        intervals: [1_000],
        message: `proofs seen: ${JSON.stringify(hashes(telemetry))}`,
      })
      .toBe(true);
    expect(hashes(telemetry).filter((h) => h === 'idle:content-loading')).toHaveLength(0);
  });

  test('a WEBSITE slide on the native viewer reports pl:, not idle:content-loading', async ({ page }) => {
    test.setTimeout(90_000);
    page.on('pageerror', (err) => {
      if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
    });
    const { telemetry } = await bootMockPlayer(page, { tag: 'website', kind: 'website' });

    // Sanity: the page handed the site to the native viewer (its placeholder is
    // all that renders here).
    await expect(page.locator('[aria-label="Native URL overlay active"]')).toHaveCount(1, { timeout: 30_000 });

    await expect
      .poll(() => hashes(telemetry).some((h) => h.startsWith('pl:')), {
        timeout: 60_000,
        intervals: [1_000],
        message: `proofs seen: ${JSON.stringify(hashes(telemetry))}`,
      })
      .toBe(true);
    expect(hashes(telemetry).filter((h) => h === 'idle:content-loading')).toHaveLength(0);
  });
});
