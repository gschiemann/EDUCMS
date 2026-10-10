/**
 * NEVER INTERRUPT (2026-10-10) — Greg's #1 player requirement: "playing
 * content must NEVER be interrupted unless someone changes it."
 *
 * Seen in the field several times: a screen suddenly refreshes, shows the
 * connecting page, then plays again. These tests boot a fully mocked player
 * (every request intercepted, fake identities, repo is public — see
 * helpers/mock-player.ts) with a three-slide playlist on the glass, mark the
 * live document, and then throw each known interrupter at it:
 *
 *   1. a wedge-detector REFRESH_WEB push      → declined, content untouched;
 *      an operator's REFRESH_WEB push         → still reloads (kept working)
 *   2. a durable (manifest) SYSTEM refresh    → acknowledged, no reload;
 *      a durable OPERATOR refresh             → reloads
 *   3. an API outage + the reconnect after it → content never leaves the glass
 *   4. a credential renewal (manifest 401)    → content never leaves the glass
 *   5. a new web deployment                   → picked up ONLY when nothing is
 *      on the glass (the companion spec, player-live-deployment, proves it is
 *      NOT picked up while content plays)
 *
 * "Interrupted" is measured two ways: a window marker that a reload would
 * erase, and the absence of the connecting splash. Runs on chromium + webkit
 * (CLAUDE.md cross-browser rule). Harness rules (player rule 14): the
 * realtime socket is the helper's stub (non-/realtime sockets are delegated
 * to the real WebSocket), mocks key on STATE, and every wait is on a
 * rendered element, never a count.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

test.use({ serviceWorkers: 'block' });

const SLIDES = 'img[data-slide-id]';
const SPLASH = /Connecting to your CMS/;

type TestWindow = Window & {
  preservedDocument?: string;
  __eduTestRealtime?: { deliver(message: unknown): void };
  __eduRenderProof?: () => { rendering: boolean; sig: string; kind: string };
};

/** Wait for the slideshow to be on the glass, then mark THIS document. */
async function markLive(page: Page) {
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  // Operator content proven on glass (`pl:` sig) — the evidence the
  // admission reads. An `idle:` sig here would make the decline vacuous.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as TestWindow).__eduRenderProof?.()?.sig ?? ''), { timeout: 20_000 })
    .toMatch(/^pl:/);
  await page.evaluate(() => { (window as unknown as TestWindow).preservedDocument = 'live'; });
}

/** The marker survives only while the ORIGINAL document is still running. */
async function marker(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => (window as unknown as TestWindow).preservedDocument ?? null);
  } catch {
    return null; // execution context destroyed mid-navigation = reloaded
  }
}

async function expectStillLive(page: Page) {
  expect(await marker(page)).toBe('live');
  await expect(page.locator(SLIDES)).toHaveCount(3);
  await expect(page.getByText(SPLASH)).toHaveCount(0);
}

/** Deliver a pushed message exactly as the server would, through the stubbed realtime socket. */
async function deliver(page: Page, message: unknown) {
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as TestWindow).__eduTestRealtime), { timeout: 20_000, message: 'realtime stub never opened' })
    .toBe(true);
  await page.evaluate((m) => (window as unknown as TestWindow).__eduTestRealtime!.deliver(m), message);
}

let eventSeq = 0;
function refreshPush(screenId: string, requestedBy: string | null, corrId: string) {
  return {
    type: 'REFRESH_WEB',
    eventId: `evt-${corrId}-${++eventSeq}`,
    timestamp: Date.now(),
    payload: { scope: 'screen', scopeId: screenId, tenantId: 'test-tenant-proof', requestedBy, jitterMs: 0, corrId },
  };
}
function syncPush() {
  return { type: 'SYNC', eventId: `evt-sync-${++eventSeq}`, timestamp: Date.now(), payload: {} };
}

test.describe('never interrupt playing content', () => {
  test('1. a wedge-detector REFRESH_WEB is declined by a playing, painting screen; an operator refresh still reloads', async ({ page }) => {
    test.setTimeout(90_000);
    const id = playerIds('ni-push');
    const logs: string[] = [];
    page.on('console', (m) => { if (m.text().includes('REFRESH_WEB')) logs.push(m.text()); });
    await bootMockPlayer(page, { tag: 'ni-push', identity: id, kind: 'images' });
    await markLive(page);

    // The wedge detector signs `requestedBy: null` — a SYSTEM refresh.
    await deliver(page, refreshPush(id.screenId, null, 'wedge-test-1'));
    await expect
      .poll(() => logs.some((l) => l.includes('wedge-test-1') && l.includes('declined')), { timeout: 10_000 })
      .toBe(true);
    await page.waitForTimeout(3_000); // longer than any reload jitter it could have scheduled
    await expectStillLive(page);
    expect(logs.some((l) => l.includes('wedge-test-1') && l.includes('reloading in'))).toBe(false);

    // A person pressed Refresh — honoured exactly as before.
    await deliver(page, refreshPush(id.screenId, 'user-operator-1', 'rw-test-1'));
    await expect.poll(() => marker(page), { timeout: 20_000, message: 'operator refresh did not reload' }).toBeNull();
    // …and the screen comes back playing.
    await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  });

  test("2. a durable SYSTEM refresh in the manifest is acknowledged without a reload; an operator's reloads", async ({ page }) => {
    test.setTimeout(90_000);
    const id = playerIds('ni-durable');
    const state: { refreshRequestedAt: number | null; refreshRequestedBy: string | null } = { refreshRequestedAt: null, refreshRequestedBy: null };
    const logs: string[] = [];
    page.on('console', (m) => { if (m.text().includes('REFRESH_WEB')) logs.push(m.text()); });
    await bootMockPlayer(page, {
      tag: 'ni-durable', identity: id, kind: 'images',
      extraRoutes: async (p) => {
        await p.route(`**/api/v1/screens/${id.screenId}/manifest`, (r) =>
          ok(r, { ...playerManifest(id.screenId, 'images'), ...state }));
      },
    });
    await markLive(page);

    // The wedge detector's durable ride (its only delivery to a push-dead box).
    state.refreshRequestedAt = 1_790_000_000_000;
    state.refreshRequestedBy = 'system';
    await deliver(page, syncPush()); // bring the next reconcile forward
    await expect
      .poll(() => logs.some((l) => l.includes('durable REFRESH_WEB (system) declined')), { timeout: 20_000 })
      .toBe(true);
    // Consumed by value identity: the server clears its flag on the next post.
    expect(await page.evaluate(() => localStorage.getItem('edu_refresh_ack'))).toBe('1790000000000');
    await page.waitForTimeout(2_000);
    await expectStillLive(page);

    // A person's Resync, delivered the same durable way — honoured.
    state.refreshRequestedAt = 1_790_000_000_001;
    state.refreshRequestedBy = 'operator';
    await deliver(page, syncPush());
    await expect
      .poll(() => logs.some((l) => l.includes('arrived via manifest — reloading once')), { timeout: 20_000 })
      .toBe(true);
    await expect.poll(() => marker(page), { timeout: 20_000 }).toBeNull();
    await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  });

  test('3. an API outage, and the reconnect after it, never take content off the glass', async ({ page }) => {
    test.setTimeout(120_000);
    const id = playerIds('ni-outage');
    const state = { outage: false, manifest200s: 0, manifest503s: 0 };
    const fail = (r: Parameters<typeof ok>[0]) => r.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"code":"DOWN"}' });
    await bootMockPlayer(page, {
      tag: 'ni-outage', identity: id, kind: 'images',
      extraRoutes: async (p) => {
        await p.route(`**/api/v1/screens/${id.screenId}/manifest`, (r) => {
          if (state.outage) { state.manifest503s++; return fail(r); }
          state.manifest200s++;
          return ok(r, playerManifest(id.screenId, 'images'));
        });
        await p.route('**/api/v1/screens/register', (r) => state.outage ? fail(r) : ok(r, { paired: true, screenId: id.screenId, name: 'Outage', deviceToken: id.deviceToken }));
        await p.route(`**/api/v1/screens/${id.screenId}/telemetry`, (r) => state.outage ? fail(r) : ok(r, { ok: true, nextTelemetryInMs: 30_000 }));
        await p.route(`**/api/v1/screens/${id.screenId}/cache-status`, (r) => state.outage ? fail(r) : r.fulfill({ status: 204, body: '' }));
      },
    });
    await markLive(page);

    // The API goes away (a Railway deploy window, a pooler hiccup…).
    state.outage = true;
    for (let i = 0; i < 6; i++) {
      await deliver(page, syncPush()); // each reconcile now fails
      await page.waitForTimeout(2_500);
      await expectStillLive(page);
    }
    expect(state.manifest503s).toBeGreaterThanOrEqual(3);

    // …and comes back. The reconnect must be invisible too.
    state.outage = false;
    const before = state.manifest200s;
    await deliver(page, syncPush());
    await expect.poll(() => state.manifest200s, { timeout: 20_000 }).toBeGreaterThan(before);
    await page.waitForTimeout(3_000);
    await expectStillLive(page);
  });

  test('4. a credential renewal (manifest 401 → re-register) keeps content on the glass', async ({ page }) => {
    test.setTimeout(90_000);
    const id = playerIds('ni-renew');
    const state = { mode: 'ok' as 'ok' | '401', registerCalls: 0, manifest200sAfterRenewal: 0, renewed: false };
    await bootMockPlayer(page, {
      tag: 'ni-renew', identity: id, kind: 'images',
      extraRoutes: async (p) => {
        await p.route(`**/api/v1/screens/${id.screenId}/manifest`, (r) => {
          if (state.mode === '401') return r.fulfill({ status: 401, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"expired"}' });
          if (state.renewed) state.manifest200sAfterRenewal++;
          return ok(r, playerManifest(id.screenId, 'images'));
        });
        await p.route('**/api/v1/screens/register', (r) => {
          state.registerCalls++;
          if (state.registerCalls >= 2) { state.mode = 'ok'; state.renewed = true; } // the recovery re-register mints a fresh credential
          return ok(r, { paired: true, screenId: id.screenId, name: 'Renew', deviceToken: `renewed.token.${state.registerCalls}` });
        });
      },
    });
    await markLive(page);
    const bootRegisters = state.registerCalls;

    state.mode = '401'; // the credential dies server-side
    await deliver(page, syncPush());
    await expect.poll(() => state.registerCalls, { timeout: 30_000, message: 'no recovery re-register' }).toBeGreaterThan(bootRegisters);
    await expect.poll(() => state.manifest200sAfterRenewal, { timeout: 30_000, message: 'manifests never resumed on the renewed credential' }).toBeGreaterThan(0);
    await page.waitForTimeout(2_000);
    await expectStillLive(page);
  });

  test('5. a new web deployment is picked up when nothing is on the glass — the only time it may be', async ({ page }) => {
    test.setTimeout(90_000);
    const id = playerIds('ni-idle');
    const drift: string[] = [];
    page.on('console', (m) => { if (m.text().includes('[bundle-drift]')) drift.push(m.text()); });
    await page.clock.install();
    await bootMockPlayer(page, {
      tag: 'ni-idle', identity: id, kind: 'images',
      // Paired, connected, NOTHING scheduled: the "nothing scheduled" splash.
      manifest: { ...playerManifest(id.screenId, 'images'), playlists: [] },
      extraRoutes: async (p) => {
        await p.route('**/api/build-info*', (r) => ok(r, { sha: 'bbbbbbbbbbbb', bundleId: 'bbbbbbbbbbbb' }));
      },
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as TestWindow).__eduRenderProof?.()?.sig ?? ''), { timeout: 30_000 })
      .toBe('idle:playing');
    await page.evaluate(() => { (window as unknown as TestWindow).preservedDocument = 'live'; });

    await page.clock.fastForward(31_000); // first build-info check
    await expect.poll(() => drift.some((l) => l.includes('server=bbbbbbbbbbbb')), { timeout: 10_000 }).toBe(true);
    await page.clock.fastForward(301_000); // past the 60–300 s spread
    // Nothing was on the glass, so the pending bundle is taken: the document reloads.
    await expect.poll(() => marker(page), { timeout: 20_000, message: 'idle screen never picked up the new bundle' }).toBeNull();
    expect(drift.some((l) => l.includes('waiting for idle'))).toBe(false);
  });
});
