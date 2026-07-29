/**
 * Frame-locked multi-screen sync — two-screen lockstep harness.
 * docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §10.
 *
 * Boots TWO fully-mocked players in ISOLATED browser contexts (separate
 * localStorage, separate device identities, separate WS stubs, different
 * page-load instants → genuinely different performance.now() origins),
 * both syncing to the same clock authority (the shared OS clock behind
 * the mocked TIME_PONG / /realtime/time responses — exactly the
 * production topology collapsed onto one machine).
 *
 * What is asserted (all read from the conductor's own server-time-stamped
 * flip log, window.__eduSyncFlips — so the assertions are IMMUNE to test-
 * process scheduling jitter; we compare what each screen says about the
 * same timeline boundary, not when Playwright happened to look):
 *
 *   1. Both screens lock their clocks (uncertainty gate passes).
 *   2. EPOCH ANCHORING: every flip on both screens lands on the shared
 *      absolute boundary grid (itemStart ≡ 0 mod slotMs — anchor is the
 *      Unix epoch, so with equal slot durations every boundary is an
 *      exact multiple of the slot in server time).
 *   3. LOCKSTEP: for each boundary both screens crossed, their flip
 *      decisions agree within SKEW_BOUND_MS — generous for CI runners;
 *      physical hardware measures far tighter (see HUD ?synchud=1).
 *   4. LATE JOINER: screen B boots seconds after A yet its flips land on
 *      A's grid with no start-from-zero (inherent to the stateless
 *      timeline — the property that makes the whole feature bulletproof).
 *
 * Per the repo Playwright config, EVERY request is intercepted (fake API
 * base http://api.invalid NXDOMAINs anything unmocked). No real ids or
 * tokens — repo is public.
 */
import { test, expect, type Page, type Route, type BrowserContext } from '@playwright/test';

const SLOT_MS = 2_500;
const ITEM_COUNT = 3;
/** CI-safe lockstep bound. Physical screens measure single-digit ms;
 *  shared CI runners add rAF/scheduling noise on top of the real skew. */
const SKEW_BOUND_MS = 40;
/** Boundary-grid tolerance (clock uncertainty + one rAF frame). */
const GRID_TOLERANCE_MS = 60;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fakeIds(tag: string) {
  return {
    screenId: `test-screen-sync-${tag}`,
    fingerprint: `test-fp-sync-${tag}`,
    deviceToken: `fake.device.token.sync.${tag}`,
  };
}

function syncManifest(screenId: string) {
  return {
    version: '1.0',
    screenId,
    tenantId: 'test-tenant-sync',
    tenantName: 'Sync Test Tenant',
    generatedAt: new Date().toISOString(),
    isEmergency: false,
    orientation: 'LANDSCAPE',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    sync: { enabled: true, groupId: 'grp-sync-test', trimMs: 0 },
    playlists: [
      {
        id: 'pl-sync',
        name: 'Sync Loop',
        schedule: { daysOfWeek: null, timeStart: null, timeEnd: null, mutedOverride: null },
        items: Array.from({ length: ITEM_COUNT }, (_, i) => ({
          item_id: `item-${i}`,
          asset_id: `asset-${i}`,
          url: `http://api.invalid/assets/sync-${i}.png`,
          duration_ms: SLOT_MS,
          sequence: i,
          mime_type: 'image/png',
          // NONE keeps flips crisp — no 1s crossfade ambiguity in the log.
          transition_type: 'NONE',
          muted: true,
        })),
      },
    ],
  };
}

async function installApiMocks(page: Page, ids: ReturnType<typeof fakeIds>) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // Catch-all FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));

  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: ids.screenId, name: `Sync ${ids.screenId}`, deviceToken: ids.deviceToken }),
  );
  await page.route(`**/api/v1/screens/${ids.screenId}/manifest`, (route) => ok(route, syncManifest(ids.screenId)));
  await page.route(`**/api/v1/screens/${ids.screenId}/emergency-assets`, (route) =>
    ok(route, { assets: [], setHash: 'empty-fake-hash' }),
  );
  await page.route(`**/api/v1/screens/${ids.screenId}/cache-status`, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route(`**/api/v1/screens/${ids.screenId}/render-proof`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: ids.screenId, name: 'Sync Screen', tenantId: 'test-tenant-sync' }),
  );
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/analytics/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/security/**', (route) => route.fulfill({ status: 204, body: '' }));
  // HTTP clock fallback — answered from the test process (shared OS clock).
  await page.route('**/api/v1/realtime/time*', (route) =>
    ok(route, { serverNow: Date.now() }),
  );
  // Tiny real PNGs so <img> slides decode instantly.
  await page.route('**/assets/sync-*.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );
}

/**
 * WS stub (cloned from emergency-path.spec.ts — see its comments for the
 * why of every quirk): delegates non-/realtime sockets to the real WS
 * (Next HMR), auto-AUTH_OKs, and — new here — answers TIME_PING with a
 * TIME_PONG from the page's OS clock after a few ms of simulated network
 * latency. Both pages share the OS clock, so it plays the role of the
 * single Redis-aligned server clock in production.
 */
async function installPlayerTestHarness(page: Page, ids: ReturnType<typeof fakeIds>) {
  await page.addInitScript(
    ({ deviceToken, fingerprint }) => {
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
      } catch { /* ignore */ }

      const RealWS = window.WebSocket;
      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        if (!url.includes('/realtime')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return new (RealWS as any)(url, protocols);
        }
        const inst: {
          url: string;
          readyState: number;
          onopen: ((ev: Event) => void) | null;
          onmessage: ((ev: MessageEvent) => void) | null;
          onerror: ((ev: Event) => void) | null;
          onclose: ((ev: CloseEvent) => void) | null;
          send: (d: string) => void;
          close: () => void;
          addEventListener: () => void;
          removeEventListener: () => void;
        } = {
          url,
          readyState: RealWS.CONNECTING,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send(data: string) {
            // Answer TIME_PING like the gateway: echo t0 + serverNow.
            try {
              const parsed = JSON.parse(data);
              if (parsed?.event === 'TIME_PING') {
                const t0 = parsed?.data?.t0;
                // 2-6ms simulated one-way-ish latency + jitter.
                const delay = 2 + Math.random() * 4;
                setTimeout(() => {
                  if (inst.onmessage && inst.readyState === RealWS.OPEN) {
                    inst.onmessage.call(
                      null as never,
                      new MessageEvent('message', {
                        data: JSON.stringify({
                          type: 'TIME_PONG',
                          payload: { t0, serverNow: Date.now() },
                          idempotencyKey: 'tp-' + Math.random(),
                          timestamp: Date.now(),
                        }),
                      }),
                    );
                  }
                }, delay);
              }
            } catch { /* non-JSON send — ignore */ }
          },
          close() {
            this.readyState = RealWS.CLOSED;
          },
          addEventListener() { /* unused by player */ },
          removeEventListener() { /* unused */ },
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (inst.onopen) inst.onopen.call(null as never, new Event('open'));
          setTimeout(() => {
            if (inst.onmessage) {
              inst.onmessage.call(
                null as never,
                new MessageEvent('message', {
                  data: JSON.stringify({
                    type: 'AUTH_OK',
                    payload: { deviceId: 'fake-device', expiresAt: Date.now() + 3_600_000, serverTime: Date.now() },
                    idempotencyKey: 'auth-ok-1',
                    timestamp: Date.now(),
                  }),
                }),
              );
            }
          }, 10);
        }, 5);
        return inst;
      }
      (StubWebSocket as unknown as { CONNECTING: number }).CONNECTING = RealWS.CONNECTING;
      (StubWebSocket as unknown as { OPEN: number }).OPEN = RealWS.OPEN;
      (StubWebSocket as unknown as { CLOSING: number }).CLOSING = RealWS.CLOSING;
      (StubWebSocket as unknown as { CLOSED: number }).CLOSED = RealWS.CLOSED;
      try {
        Object.defineProperty(window, 'WebSocket', { value: StubWebSocket, writable: true, configurable: true });
      } catch {
        (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;
      }

      class StubEventSource {
        url: string;
        readyState = 0;
        onopen: ((ev: Event) => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        constructor(url: string) { this.url = url; }
        addEventListener() { /* no-op */ }
        close() { /* no-op */ }
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { deviceToken: ids.deviceToken, fingerprint: ids.fingerprint },
  );
}

interface FlipEntry {
  toIdx: number;
  serverT: number;
  itemStartT: number;
}

async function bootSyncedPlayer(ctx: BrowserContext, tag: string): Promise<Page> {
  const ids = fakeIds(tag);
  const page = await ctx.newPage();
  page.on('pageerror', (err) => {
    // Next dev-overlay hydration noise is tolerated (same policy as the
    // emergency spec); anything else fails loudly.
    if (!/Hydration failed|hydration/i.test(err.message)) {
      throw new Error(`[${tag}] pageerror: ${err.message}`);
    }
  });
  await installPlayerTestHarness(page, ids);
  await installApiMocks(page, ids);
  await page.goto('/player?fp=' + ids.fingerprint);
  return page;
}

test.describe('frame-locked multi-screen sync', () => {
  test('two screens lock, land on the shared epoch grid, and flip in lockstep (late joiner included)', async ({ browser }) => {
    test.setTimeout(180_000);

    // Two ISOLATED contexts = two devices.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await bootSyncedPlayer(ctxA, 'a');
      // Late joiner: B boots after A is already up (different perf.now
      // origin, different boot instant — must still land on A's grid).
      await pageA.waitForFunction(
        () => (window as unknown as { __eduSyncState?: { locked?: boolean } }).__eduSyncState?.locked === true,
        undefined,
        { timeout: 90_000 },
      );
      const pageB = await bootSyncedPlayer(ctxB, 'b');
      await pageB.waitForFunction(
        () => (window as unknown as { __eduSyncState?: { locked?: boolean } }).__eduSyncState?.locked === true,
        undefined,
        { timeout: 90_000 },
      );

      // Let both record several boundary crossings (loop = 7.5s; the
      // first log entry per page may be its mid-slot engage snap, so ask
      // for 4 to guarantee ≥3 steady-state crossings each).
      await pageA.waitForFunction(
        () => ((window as unknown as { __eduSyncFlips?: unknown[] }).__eduSyncFlips?.length ?? 0) >= 4,
        undefined,
        { timeout: 45_000 },
      );
      await pageB.waitForFunction(
        () => ((window as unknown as { __eduSyncFlips?: unknown[] }).__eduSyncFlips?.length ?? 0) >= 4,
        undefined,
        { timeout: 45_000 },
      );

      const flipsA = (await pageA.evaluate(() => (window as unknown as { __eduSyncFlips: FlipEntry[] }).__eduSyncFlips)) as FlipEntry[];
      const flipsB = (await pageB.evaluate(() => (window as unknown as { __eduSyncFlips: FlipEntry[] }).__eduSyncFlips)) as FlipEntry[];

      // ── 2. Epoch anchoring: every boundary is a multiple of SLOT_MS in
      // server time (anchor = Unix epoch, equal slots) on BOTH screens.
      // This includes each page's very first "engage" flip — when the
      // conductor takes over from the free-running heartbeat it snaps to
      // the correct current item MID-slot (by design, once) — its target
      // boundary still sits on the grid even though the decision instant
      // is mid-item.
      for (const flips of [flipsA, flipsB]) {
        for (const f of flips) {
          const mod = ((f.itemStartT % SLOT_MS) + SLOT_MS) % SLOT_MS;
          const gridErr = Math.min(mod, SLOT_MS - mod);
          expect(gridErr, `boundary off epoch grid: ${JSON.stringify(f)}`).toBeLessThan(GRID_TOLERANCE_MS);
        }
      }

      // Steady-state boundary crossings = flips whose decision landed
      // NEAR their boundary. Excludes the engage snap; these are the
      // flips a viewer perceives as "the screens changed together" and
      // the only fair basis for the lockstep comparison. The lower bound
      // is negative because the tier-1 render-lead deliberately decides
      // flips up to ~150ms BEFORE the boundary so the painted frame
      // lands on it.
      const boundaryFlips = (flips: FlipEntry[]) =>
        flips.filter((f) => f.serverT - f.itemStartT >= -200 && f.serverT - f.itemStartT < 250);
      const bfA = boundaryFlips(flipsA);
      const bfB = boundaryFlips(flipsB);
      expect(bfA.length, 'screen A recorded no steady-state boundary flips').toBeGreaterThanOrEqual(2);
      expect(bfB.length, 'screen B recorded no steady-state boundary flips').toBeGreaterThanOrEqual(2);

      // ── 3+4. Lockstep across screens: match flips that crossed the SAME
      // boundary (same target index, boundary instants within half a slot)
      // and require their flip decisions to agree tightly.
      let matched = 0;
      for (const fa of bfA) {
        const fb = bfB.find(
          (f) => f.toIdx === fa.toIdx && Math.abs(f.itemStartT - fa.itemStartT) < SLOT_MS / 2,
        );
        if (!fb) continue; // B wasn't up yet for A's early flips (late joiner)
        matched++;
        expect(
          Math.abs(fb.serverT - fa.serverT),
          `lockstep skew for boundary idx=${fa.toIdx} @${fa.itemStartT}`,
        ).toBeLessThan(SKEW_BOUND_MS);
        // Same boundary identity — grid instants effectively identical.
        expect(Math.abs(fb.itemStartT - fa.itemStartT)).toBeLessThan(GRID_TOLERANCE_MS);
      }
      expect(matched, 'screens never crossed a shared boundary — no overlap window').toBeGreaterThanOrEqual(2);

      // ── Sanity: the visible slide agrees when sampled back-to-back.
      const stateA = (await pageA.evaluate(() => (window as unknown as { __eduSyncState: { idx: number; serverNow: number } }).__eduSyncState));
      const stateB = (await pageB.evaluate(() => (window as unknown as { __eduSyncState: { idx: number; serverNow: number } }).__eduSyncState));
      // Only assert when the two samples landed well inside the same slot
      // (a flip may legitimately sit between the two evaluate() calls).
      const offA = ((stateA.serverNow % SLOT_MS) + SLOT_MS) % SLOT_MS;
      if (Math.abs(stateA.serverNow - stateB.serverNow) < 500 && offA > 600 && offA < SLOT_MS - 600) {
        expect(stateB.idx).toBe(stateA.idx);
      }
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
