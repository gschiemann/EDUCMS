/**
 * OFF-HOURS BACKGROUND UPDATE (2026-10-10) — Greg: "keep content running and
 * update in the background … force update off hours."
 *
 * A fully mocked player (helpers/mock-player.ts: every request intercepted,
 * fake identities, repo is public) with a three-slide playlist on the glass
 * and a build-info answer that advertises a NEWER bundle. The browser's zone
 * is pinned to America/Chicago and the page clock is installed at a chosen
 * wall time, so the window decision is exercised exactly as on a screen:
 *
 *   1. 14:00 — daytime playback: the new bundle is detected and prepared,
 *      the screen does NOT reload (marker survives, no splash)
 *   2. 03:30 — inside the nightly window: it reloads at an item boundary,
 *      the new document comes up under the last frame (never the splash),
 *      the gap is measured, and the `update` evidence rides telemetry
 *   3. 03:30 with an emergency on the glass: blocked
 *   4. 14:00 — an operator's REFRESH_WEB still reloads immediately
 *
 * Harness rules (player rule 14): the realtime socket is the helper's stub,
 * mocks key on STATE, every wait is on a rendered element or an exposed
 * state hook. Runs on chromium + webkit. Service workers are blocked by the
 * suite config, so "prepared" is the no-worker branch here; the worker half
 * is proven against the real sw-player.js in sw-shell-swap.test.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Chicago' });

const SLIDES = 'img[data-slide-id]';
const SPLASH = /Connecting to your CMS/;
const NEW_BUNDLE = 'bbbbbbbbbbbb';

type BundleUpdateState = {
  pending: { mine: string; theirs: string; prepared: boolean; prepareAttempts: number } | null;
  lastDecision: string;
  boundaryArmed: boolean;
  zone: { zone: string; source: string };
};
type Sample = { t: number; cover: boolean; splashVisible: boolean; slides: number; marker: string | null };
type TestWindow = Window & {
  preservedDocument?: string;
  __eduTestRealtime?: { deliver(message: unknown): void };
  __eduRenderProof?: () => { rendering: boolean; sig: string; kind: string };
  __eduBundleUpdate?: { checkNow(): Promise<void>; evaluate(): void; state(): BundleUpdateState };
  __eduCoverSamples?: Sample[];
};

/** Chicago wall time → epoch ms (CDT in October). */
const chicago = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}:00-05:00`);

async function markLive(page: Page) {
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as TestWindow).__eduRenderProof?.()?.sig ?? ''), { timeout: 20_000 })
    .toMatch(/^pl:/);
  await page.evaluate(() => { (window as unknown as TestWindow).preservedDocument = 'live'; });
}

async function marker(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => (window as unknown as TestWindow).preservedDocument ?? null);
  } catch {
    return null; // execution context destroyed mid-navigation = reloaded
  }
}

async function updateState(page: Page): Promise<BundleUpdateState | null> {
  try {
    return await page.evaluate(() => (window as unknown as TestWindow).__eduBundleUpdate?.state() ?? null);
  } catch {
    return null;
  }
}

/**
 * A per-document sampler (installed before boot, so it runs in the document
 * that comes up after the reload too): every 25 ms, is the cover up, is the
 * splash text VISIBLE (present and not hidden by the cover), how many slides.
 */
async function installSampler(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as TestWindow;
    w.__eduCoverSamples = [];
    const sample = () => {
      try {
        const html = document.documentElement;
        const wrap = document.querySelector('.player-root-wrapper') as HTMLElement | null;
        const vis = wrap ? getComputedStyle(wrap).visibility : 'visible';
        const text = document.body ? document.body.innerText : '';
        w.__eduCoverSamples!.push({
          t: Date.now(),
          cover: !!html.getAttribute('data-edu-update-cover'),
          splashVisible: /Connecting to your CMS/.test(text) && vis !== 'hidden',
          slides: document.querySelectorAll('img[data-slide-id]').length,
          marker: w.preservedDocument ?? null,
        });
        if (w.__eduCoverSamples!.length > 4000) w.__eduCoverSamples!.splice(0, 1000);
      } catch { /* sampling only */ }
    };
    // A REAL interval, untouched by the page's fake clock: the sampler is
    // installed before clock.install() patches setInterval in this document.
    const realSetInterval = window.setInterval.bind(window);
    realSetInterval(sample, 25);
  });
}

async function bootInfo(p: Page): Promise<void> {
  await p.route('**/api/build-info*', (r) => ok(r, { sha: NEW_BUNDLE, bundleId: NEW_BUNDLE }));
}

test.describe('off-hours background update', () => {
  test('1. daytime: a newer bundle is detected and prepared, but the playing screen does not reload', async ({ page }) => {
    test.setTimeout(90_000);
    const drift: string[] = [];
    page.on('console', (m) => { if (/\[bundle-(drift|update)\]/.test(m.text())) drift.push(m.text()); });
    await page.clock.install({ time: chicago('14:00') });
    await bootMockPlayer(page, { tag: 'ohu-day', kind: 'images', extraRoutes: bootInfo });
    await markLive(page);

    await page.clock.fastForward(31_000); // the first build-info check
    await expect.poll(() => drift.some((l) => l.includes(`server=${NEW_BUNDLE}`)), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await updateState(page))?.pending?.theirs ?? null, { timeout: 10_000 }).toBe(NEW_BUNDLE);

    // Six minutes of daytime ticks, several playlist wraps.
    for (let i = 0; i < 12; i++) await page.clock.fastForward(30_000);
    const st = await updateState(page);
    expect(st?.lastDecision).toBe('wait:outside-window');
    expect(st?.zone.zone).toBe('America/Chicago');
    expect(st?.boundaryArmed).toBe(false);
    expect(await marker(page)).toBe('live');
    await expect(page.locator(SLIDES)).toHaveCount(3);
    await expect(page.getByText(SPLASH)).toHaveCount(0);
    expect(drift.some((l) => l.includes('applying'))).toBe(false);
  });

  test('2. inside the nightly window: reloads at an item boundary under the last frame, never the splash; evidence rides telemetry', async ({ page }) => {
    test.setTimeout(120_000);
    const logs: string[] = [];
    page.on('console', (m) => { if (/\[bundle-(drift|update)\]/.test(m.text())) logs.push(m.text()); });
    await installSampler(page);
    await page.clock.install({ time: chicago('03:30') }); // past any per-screen jitter (≤ 20 min)
    const booted = await bootMockPlayer(page, { tag: 'ohu-night', kind: 'images', extraRoutes: bootInfo });
    await markLive(page);

    await page.clock.fastForward(31_000); // build-info check → pending → window open → armed at the next boundary
    await expect.poll(() => logs.some((l) => l.includes('applying at the next item boundary')), { timeout: 10_000, message: 'the nightly window did not arm' }).toBe(true);

    // The next slide advance (≤ 1.2 s) is the boundary. From here the clock
    // ticks in REAL time — a jump would land inside the capture/navigation
    // and inflate the measured gap — while Node watches the swap from
    // outside: the moment the old document's context dies, and the first
    // moment the new document answers with the cover on.
    let died = 0;
    let coverSeen = 0;
    let firstAnswer = 0;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(died && firstAnswer)) {
      try {
        const r = await page.evaluate(() => ({
          marker: (window as unknown as TestWindow).preservedDocument ?? null,
          cover: !!document.documentElement.getAttribute('data-edu-update-cover'),
        }));
        if (died && !firstAnswer) firstAnswer = Date.now();
        if (died && r.cover && !coverSeen) coverSeen = Date.now();
        if (!died && r.marker === null) died = Date.now(); // replaced synchronously
      } catch {
        if (!died) died = Date.now(); // execution context destroyed = navigated
      }
    }
    expect(died, 'the screen did not reload inside the window').toBeGreaterThan(0);
    expect(firstAnswer, 'the new document never came up').toBeGreaterThan(0);
    // Upper bound on the blank from outside: old context gone → new document
    // executing script (each probe is one round trip, so ± a few ms).
    const nodeGapMs = firstAnswer - died;
    expect(logs.some((l) => l.includes('[bundle-update] applying') && l.includes('nightly window') && l.includes('at item'))).toBe(true);

    // The new document: slides back on the glass, and the cover came down.
    await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => !!document.documentElement.getAttribute('data-edu-update-cover')), { timeout: 20_000 }).toBe(false);
    await expect.poll(() => logs.some((l) => l.includes('[bundle-update] applied')), { timeout: 20_000 }).toBe(true);

    // NEVER the splash: no sample in the new document saw the connecting text
    // without the cover over it. (The sampler restarted with the document.)
    const samples = await page.evaluate(() => (window as unknown as TestWindow).__eduCoverSamples ?? []);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    const uncoveredSplash = samples.filter((s) => s.splashVisible && !s.cover);
    expect(uncoveredSplash, 'the connecting splash was visible during the update').toEqual([]);
    // The cover was on: seen by the 25 ms in-page sampler, or by the outside probe.
    expect(samples.some((s) => s.cover) || coverSeen > 0, 'the new document never painted the cover').toBe(true);

    // The measured gap, as the device reports it.
    await page.clock.fastForward(65_000); // the next telemetry tick carries the evidence
    await expect.poll(() => booted.telemetry.some((t) => !!(t as { update?: unknown }).update), { timeout: 20_000 }).toBe(true);
    const update = (booted.telemetry.find((t) => !!(t as { update?: unknown }).update) as { update: Record<string, unknown> }).update;
    expect(update).toMatchObject({ window: 'nightly', boundary: 'item', zone: 'America/Chicago', zoneSource: 'device' });
    expect(['live', 'refetch', 'color']).toContain(update.capture);
    expect(typeof update.blankMs).toBe('number');
    expect(update.blankMs as number).toBeLessThan(3_000);
    expect(typeof update.coverMs).toBe('number');
    // Evidence is sent once.
    expect(booted.telemetry.filter((t) => !!(t as { update?: unknown }).update)).toHaveLength(1);
    // eslint-disable-next-line no-console
    console.log(`[offhours-update e2e] capture=${update.capture} device.blankMs=${update.blankMs} device.coverMs=${update.coverMs} node.oldDocGoneToNewDocMs=${nodeGapMs} node.coverSeenByProbe=${coverSeen > 0} samplesCovered=${samples.filter((s) => s.cover).length}`);
  });

  test('3. an emergency on the glass blocks the window', async ({ page }) => {
    test.setTimeout(90_000);
    const id = playerIds('ohu-em');
    const logs: string[] = [];
    page.on('console', (m) => { if (/\[bundle-(drift|update)\]/.test(m.text())) logs.push(m.text()); });
    await page.clock.install({ time: chicago('03:30') });
    await bootMockPlayer(page, {
      tag: 'ohu-em', identity: id, kind: 'images',
      extraRoutes: async (p) => {
        await bootInfo(p);
        await p.route(`**/api/v1/screens/${id.screenId}/manifest`, (r) => ok(r, {
          ...playerManifest(id.screenId, 'images'),
          isEmergency: true, emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL', emergencyScope: 'tenant',
        }));
      },
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as TestWindow).__eduRenderProof?.()?.sig ?? ''), { timeout: 30_000 })
      .toMatch(/^em:/);
    await page.evaluate(() => { (window as unknown as TestWindow).preservedDocument = 'live'; });

    await page.clock.fastForward(31_000);
    await expect.poll(async () => (await updateState(page))?.pending?.theirs ?? null, { timeout: 10_000 }).toBe(NEW_BUNDLE);
    for (let i = 0; i < 8; i++) await page.clock.fastForward(30_000);
    expect((await updateState(page))?.lastDecision).toBe('wait:emergency');
    expect(await marker(page)).toBe('live');
    expect(logs.some((l) => l.includes('applying'))).toBe(false);
  });

  test("4. an operator's REFRESH_WEB still reloads immediately, in the daytime", async ({ page }) => {
    test.setTimeout(90_000);
    const id = playerIds('ohu-op');
    await page.clock.install({ time: chicago('14:00') });
    await bootMockPlayer(page, { tag: 'ohu-op', identity: id, kind: 'images', extraRoutes: bootInfo });
    await markLive(page);
    await expect.poll(() => page.evaluate(() => !!(window as unknown as TestWindow).__eduTestRealtime), { timeout: 20_000 }).toBe(true);
    await page.evaluate((m) => (window as unknown as TestWindow).__eduTestRealtime!.deliver(m), {
      type: 'REFRESH_WEB', eventId: 'evt-op-ohu-1', timestamp: Date.now(),
      payload: { scope: 'screen', scopeId: id.screenId, tenantId: 'test-tenant-proof', requestedBy: 'user-operator-1', jitterMs: 0, corrId: 'ohu-op-1' },
    });
    await expect.poll(() => marker(page), { timeout: 20_000, message: 'operator refresh did not reload' }).toBeNull();
    await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  });
});
