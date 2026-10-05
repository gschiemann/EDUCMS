/**
 * One bad file must never freeze a screen or leave a black slot (2026-10-05,
 * the media beta-test campaign: docs/research/2026-10-04-media-matrix/
 * limits-findings.md T2/T4/T5/T13, img-findings.md ANSWER 2).
 *
 * Measured on the real web player before this fix:
 *   - [broken video, good image]: the video errors, the image shows, the
 *     rotation comes back to the video and the screen sits on it FOREVER — the
 *     same errored <video> element stayed mounted as the hidden next-up slide,
 *     its one-shot `error` event never fired again, and videos advance only on
 *     `ended`/`error`.
 *   - a broken image (or an audio file, which falls through to <img>) took its
 *     full slot as a black slide on every lap.
 *
 * A fully mocked player (tests/e2e/helpers/mock-player.ts): every request is
 * intercepted and the broken files are made right here — a text body served
 * as video/mp4, garbage served as image/jpeg — nothing binary is committed.
 * What is "on glass" is sampled in the page every 200 ms: the slide element
 * with computed opacity 1 (every item uses transition NONE, so there is no
 * fade to land between).
 */
import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, playerIds, playerManifest } from './helpers/mock-player';

const SLOT_MS = 1_500;
const BROKEN_VIDEO = 'http://api.invalid/assets/bad-text.mp4';
const BROKEN_IMAGE = 'http://api.invalid/assets/bad-garbage.jpg';
const AUDIO = 'http://api.invalid/assets/tone.mp3';
const GOOD_IMAGE = 'http://api.invalid/assets/slide-good.png'; // the helper serves a real 1-px PNG

type Spec = { key: string; url: string; mime: string };

function manifestFor(tag: string, items: Spec[]) {
  const m = playerManifest(playerIds(tag).screenId, 'images');
  m.playlists[0].id = 'pl-bad';
  m.playlists[0].name = 'Bad file';
  m.playlists[0].items = items.map((it, i) => ({
    item_id: it.key,
    asset_id: `asset-${it.key}`,
    url: it.url,
    duration_ms: SLOT_MS,
    sequence: i,
    mime_type: it.mime,
    transition_type: 'NONE',
    muted: true,
    // Small: never held by the large-file readiness gate.
    asset_size: 64,
  })) as unknown as typeof m.playlists[0]['items'];
  return m;
}

async function brokenRoutes(page: Page) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  // 53 bytes of text named .mp4 and served as video/mp4 — the tester's a04.
  await page.route(BROKEN_VIDEO, (route) => route.fulfill({
    status: 200, headers: { ...cors, 'Content-Type': 'video/mp4' }, body: 'this is not a video, it is a text file named .mp4 !!',
  }));
  // Non-image bytes served as image/jpeg — the tester's text-as-jpg.
  await page.route(BROKEN_IMAGE, (route) => route.fulfill({
    status: 200, headers: { ...cors, 'Content-Type': 'image/jpeg' }, body: Buffer.from('GARBAGE-NOT-A-JPEG'.repeat(8)),
  }));
  await page.route(AUDIO, (route) => route.fulfill({
    status: 200, headers: { ...cors, 'Content-Type': 'audio/mpeg' }, body: Buffer.alloc(64, 0xff),
  }));
}

interface Sample { t: number; on: string[]; unavailable: boolean; proof: string }

/** Start the in-page sampler: what is on glass, the card, and the render proof. */
async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __bf: Sample[]; __eduRenderProof?: () => { sig: string } };
    w.__bf = [];
    setInterval(() => {
      const on: string[] = [];
      document.querySelectorAll<HTMLElement>('img[data-slide-id], video').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.opacity !== '1' || cs.display === 'none' || cs.visibility === 'hidden') return;
        on.push(el.tagName === 'VIDEO'
          ? `video:${(el as HTMLVideoElement).currentSrc || el.getAttribute('src') || ''}`
          : `img:${(el as HTMLImageElement).getAttribute('src') || ''}`);
      });
      w.__bf.push({
        t: Date.now(),
        on,
        unavailable: (document.body.innerText || '').includes('Content Unavailable'),
        proof: w.__eduRenderProof?.().sig ?? '',
      });
    }, 200);
  });
}

const samples = (page: Page) => page.evaluate(() => (window as unknown as { __bf: Sample[] }).__bf);
const shows = (s: Sample, url: string) => s.on.some((o) => o.endsWith(url) || o.includes(url));

function guardPageErrors(page: Page) {
  page.on('pageerror', (err) => {
    if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
  });
}

test.describe('a bad file never freezes the screen or leaves a black slot', () => {
  test('[broken video, good image]: after its first failure the video is never on glass; the image keeps showing', async ({ page }) => {
    test.setTimeout(120_000);
    guardPageErrors(page);
    let firstVideoErrorAt = 0;
    page.on('console', (msg) => {
      if (!firstVideoErrorAt && msg.text().includes('[Player] video error, skipping')) firstVideoErrorAt = Date.now();
    });
    const tag = 'bad-video';
    await bootMockPlayer(page, {
      tag, kind: 'images',
      manifest: manifestFor(tag, [
        { key: 'item-bad-video', url: BROKEN_VIDEO, mime: 'video/mp4' },
        { key: 'item-good-image', url: GOOD_IMAGE, mime: 'image/png' },
      ]),
      extraRoutes: brokenRoutes,
    });
    await expect(page.locator('img[data-slide-id]')).toHaveCount(1, { timeout: 45_000 });
    await startSampler(page);
    await expect.poll(() => firstVideoErrorAt, { timeout: 20_000, message: 'the broken video never reported its error' }).toBeGreaterThan(0);
    await page.waitForTimeout(30_000);

    const after = (await samples(page)).filter((s) => s.t > firstVideoErrorAt + 400);
    expect(after.length).toBeGreaterThan(100);
    const videoOnGlass = after.filter((s) => shows(s, BROKEN_VIDEO));
    const imageOnGlass = after.filter((s) => shows(s, GOOD_IMAGE));
    expect(videoOnGlass.length, `broken video on glass in ${videoOnGlass.length}/${after.length} samples`).toBe(0);
    expect(imageOnGlass.length / after.length).toBeGreaterThan(0.95);
    // The proof says content is playing — not "Loading content".
    expect(after[after.length - 1].proof.startsWith('pl:'), `proof: ${after[after.length - 1].proof}`).toBe(true);
  });

  test('[good image, broken image, audio]: neither the broken image nor the audio item is ever a slide', async ({ page }) => {
    test.setTimeout(120_000);
    guardPageErrors(page);
    const tag = 'bad-image';
    await bootMockPlayer(page, {
      tag, kind: 'images',
      manifest: manifestFor(tag, [
        { key: 'item-good-image', url: GOOD_IMAGE, mime: 'image/png' },
        { key: 'item-bad-image', url: BROKEN_IMAGE, mime: 'image/jpeg' },
        { key: 'item-audio', url: AUDIO, mime: 'audio/mpeg' },
      ]),
      extraRoutes: brokenRoutes,
    });
    await expect.poll(async () => page.locator(`img[src="${GOOD_IMAGE}"]`).count(), { timeout: 45_000 }).toBe(1);
    await startSampler(page);
    await page.waitForTimeout(20_000);

    const all = await samples(page);
    expect(all.length).toBeGreaterThan(70);
    const bad = all.filter((s) => shows(s, BROKEN_IMAGE) || shows(s, AUDIO));
    const good = all.filter((s) => shows(s, GOOD_IMAGE));
    const black = all.filter((s) => s.on.length === 0 && !s.unavailable);
    expect(bad.length, `bad item on glass in ${bad.length}/${all.length} samples`).toBe(0);
    expect(black.length, `nothing on glass in ${black.length}/${all.length} samples`).toBe(0);
    expect(good.length / all.length).toBeGreaterThan(0.95);
    expect(all[all.length - 1].proof.startsWith('pl:'), `proof: ${all[all.length - 1].proof}`).toBe(true);
  });

  test('every item broken: the Content Unavailable card, proven as such — never black, never pl:', async ({ page }) => {
    test.setTimeout(120_000);
    guardPageErrors(page);
    const tag = 'all-bad';
    await bootMockPlayer(page, {
      tag, kind: 'images',
      manifest: manifestFor(tag, [
        { key: 'item-bad-video', url: BROKEN_VIDEO, mime: 'video/mp4' },
        { key: 'item-bad-image', url: BROKEN_IMAGE, mime: 'image/jpeg' },
        { key: 'item-audio', url: AUDIO, mime: 'audio/mpeg' },
      ]),
      extraRoutes: brokenRoutes,
    });
    await expect(page.getByText('Content Unavailable')).toBeVisible({ timeout: 45_000 });
    await startSampler(page);
    await page.waitForTimeout(12_000);

    const all = await samples(page);
    const card = all.filter((s) => s.unavailable);
    expect(card.length / all.length, 'the card stays up').toBeGreaterThan(0.95);
    expect(all.filter((s) => s.proof.startsWith('pl:')).length).toBe(0);
    expect(all[all.length - 1].proof).toBe('idle:content-unavailable');
  });
});
