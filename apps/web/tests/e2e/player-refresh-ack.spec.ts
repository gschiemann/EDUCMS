/**
 * A resync confirms right away — the refresh-ack regression
 * (Greg, 2026-09-28: "i would have thought a resync checks and reports back
 * right away").
 *
 * A Resync reloads the screen within seconds. Before the reload the page
 * persists the `refreshRequestedAt` VALUE it acted on (`edu_refresh_ack`, player
 * rule 6). Until now that value reached the server only inside the routine
 * telemetry post, which the server accepts once per 30 s per screen — a reloaded
 * page whose pre-reload post was recent had its first post (ack included)
 * refused, and the confirmation arrived a minute later. The dashboard called
 * the screen "Content behind" for that whole minute.
 *
 * The page now posts the value to `POST /screens/:id/refresh-ack` (its own
 * accept spacing) as soon as it holds a device credential. This spec boots a
 * fully mocked player (every request intercepted — no real ids or tokens, the
 * repo is public) with a persisted ack and asserts what that endpoint sees.
 *
 * The telemetry mock here answers 200 always: the point is that the ack does
 * NOT depend on it.
 */
import { test, expect } from '@playwright/test';
import { bootMockPlayer } from './helpers/mock-player';

/** A durable-REFRESH value the page "acted on" before it reloaded. */
const ACKED = '1790600000000';

test.describe('a Resync is confirmed as soon as the page is back', () => {
  test('reports the persisted ack to the server within seconds, with the device credential', async ({ page }) => {
    test.setTimeout(60_000);
    const { refreshAcks } = await bootMockPlayer(page, {
      tag: 'ack-now',
      kind: 'images',
      storage: { edu_refresh_ack: ACKED },
    });

    await expect
      .poll(() => refreshAcks.length, { timeout: 20_000, intervals: [250], message: 'no refresh-ack POST arrived' })
      .toBeGreaterThan(0);

    expect(refreshAcks[0].body).toEqual({ refreshAckMs: Number(ACKED) });
    expect(refreshAcks[0].hasBearer).toBe(true);
  });

  test('tells the server ONCE — a reload after it was answered does not repeat the report', async ({ page }) => {
    test.setTimeout(75_000);
    const { refreshAcks } = await bootMockPlayer(page, {
      tag: 'ack-once',
      kind: 'images',
      storage: { edu_refresh_ack: ACKED },
    });
    await expect.poll(() => refreshAcks.length, { timeout: 20_000, intervals: [250] }).toBe(1);
    // The page marks the value reported only after the 2xx is read.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('edu_refresh_ack_reported')), {
        timeout: 5_000,
        intervals: [100],
      })
      .toBe(ACKED);

    await page.reload();
    await expect(page.locator('img[data-slide-id]').first()).toBeAttached({ timeout: 30_000 });
    // Longer than the first ladder rung (1.5 s) and the second (4 s) combined.
    await page.waitForTimeout(8_000);
    expect(refreshAcks).toHaveLength(1);
  });

  test('a failed answer is retried on a short ladder, not left for the routine post', async ({ page }) => {
    test.setTimeout(75_000);
    const { refreshAcks } = await bootMockPlayer(page, {
      tag: 'ack-retry',
      kind: 'images',
      storage: { edu_refresh_ack: ACKED },
      refreshAckStatuses: [503, 200], // the server has a bad moment, then answers
    });

    await expect
      .poll(() => refreshAcks.length, { timeout: 30_000, intervals: [250], message: 'no retry after the 503' })
      .toBeGreaterThanOrEqual(2);
    // The same value both times — a retry is never a different claim.
    expect(refreshAcks[1].body).toEqual({ refreshAckMs: Number(ACKED) });
    // …and it is a ladder step (a few seconds), not the minute the routine post takes.
    expect(refreshAcks[1].at - refreshAcks[0].at).toBeLessThan(15_000);
    // A 503 must not have been recorded as "reported".
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('edu_refresh_ack_reported')), {
        timeout: 5_000,
        intervals: [100],
      })
      .toBe(ACKED);
  });

  test('says nothing when no Resync was ever acted on', async ({ page }) => {
    test.setTimeout(60_000);
    const { refreshAcks } = await bootMockPlayer(page, { tag: 'ack-none', kind: 'images' });
    await expect(page.locator('img[data-slide-id]').first()).toBeAttached({ timeout: 30_000 });
    await page.waitForTimeout(8_000); // well past the first ladder rung
    expect(refreshAcks).toHaveLength(0);
  });
});
