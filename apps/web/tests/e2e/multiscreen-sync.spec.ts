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
 * Everything is read from the conductor's own flip log,
 * window.__eduSyncFlips (fields documented beside the push in
 * player/page.tsx), so it is immune to when Playwright happens to look.
 *
 * What is asserted (2026-11-23 — measurement fixed; see below):
 *
 *   1. Both screens lock their clocks (uncertainty gate passes).
 *   2. EVERY flip on both screens resolves the right slide for its slot on
 *      the epoch grid: boundaryT is a multiple of SLOT_MS and
 *      toIdx === (boundaryT / SLOT_MS) mod ITEM_COUNT. That proves the
 *      timeline is anchored to the Unix-epoch grid. For every ENGAGE it is
 *      also checked against the shared clock: the decision instant (wallT,
 *      moved onto the mocked server clock by the page's measured wall
 *      basis) plus its lead falls inside the slot it resolved, within
 *      ENGAGE_CLOCK_TOLERANCE_MS. For B's engage that is the late-joiner
 *      property itself — it boots seconds after A and lands on the slot
 *      that was current, with no start-from-zero.
 *   3. EPOCH ANCHORING against the shared clock: paintWallT - boundaryT
 *      (when the new slide was painted, on the machine's wall clock, versus
 *      the boundary it belongs to) within GRID_TOLERANCE_MS.
 *   4. LOCKSTEP: for each boundary both screens crossed while conducting,
 *      |paintWallT_A - paintWallT_B| within the skew bound — what a viewer
 *      sees, including each screen's clock-estimate error and its own
 *      render lead.
 *   5. THE JOIN WINDOW: B's first boundary crossing after its engage is
 *      asserted on its own, with JOIN_SKEW_BOUND_MS, never folded into 4:
 *      paint skew, and both screens' anchors at that boundary.
 *   6. CONTINUITY: B's boundary crossings from the join on are consecutive
 *      slots, so a crossing B took as a re-engage after joining (a stand-down
 *      and re-lock, or a multi-slot jump) cannot drop out of 4 unseen.
 *
 * NOT asserted, annotated only ('sync-a-before-join'): A's crossings before
 * B's first boundary. B is booting then, and on this one machine B's boot
 * competes with A for CPU: in 24 local runs A's anchors there went up to
 * 276 ms, with decision-to-paint up to 187 ms, over the anchoring tolerance,
 * while every anchor from the join on stayed under 20 ms. That is harness
 * contention, not the product, and the check before 2026-11-23 never
 * measured it either (it measured the render lead), so leaving it out is not
 * a loosening.
 *
 * Crossings are chosen by the log's `kind` ('boundary' — the screen was
 * conducting when the boundary passed), not by a timing window. Until
 * 2026-11-23 a window (decision - itemStart in [-200, 250) ms) did the
 * choosing, and it let B's engage snap through whenever B locked within
 * ~250 ms after a boundary: the snap was then compared with A's real
 * crossing as if it were skew. Nov 2-23: 38 first-attempt failures in 347
 * CI jobs, all passing on retry; every one whose data was still retained
 * (4, at 112-205 ms) was this. The old grid check measured the render
 * lead, because the log's itemStartT was the boundary minus it.
 *
 * Every run attaches per-boundary values (paint and decision skew, both
 * anchors, leads, frame gaps) as test annotations, pass or fail, so CI
 * builds the distribution the bounds are later tuned on.
 *
 * HARNESS LIMIT: each page answers its own TIME_PING with its own
 * Date.now(), after a symmetric 2-6 ms delay, so clock-estimate error here
 * is about 1-3 ms by construction. This spec catches regressions in the
 * clock, lead and timeline math; it cannot see Wi-Fi round-trip asymmetry
 * between physical screens. A claim about real glass needs the on-glass
 * check (/player?synchud=1 on each screen, filmed).
 *
 * Per the repo Playwright config, EVERY request is intercepted (fake API
 * base http://api.invalid NXDOMAINs anything unmocked). No real ids or
 * tokens — repo is public.
 */
import { test, expect, type Page, type Route, type BrowserContext } from '@playwright/test';

const SLOT_MS = 2_500;
const ITEM_COUNT = 3;
/** CI-safe lockstep bound, on |paintWallT_A - paintWallT_B| for a shared
 *  boundary crossed by two conducting screens. Physical screens measure
 *  single-digit ms; shared CI runners add rAF/scheduling noise on top.
 *
 *  2026-11-23 — not tightened yet. Before the measurement was fixed, the
 *  steady-state data (engage excluded, 50 attempts) was: decision skew max
 *  35.5 ms WebKit / 18.1 ms Chromium. The WebKit bound below can come down
 *  to this one only on about 20 annotated CI runs per engine of the NEW
 *  measurement (paint, not decision). */
const SKEW_BOUND_MS = 40;

/**
 * WebKit-under-CI lockstep bound.
 *
 * 2026-08-04 — this spec previously ran ONLY in chromium in CI, so the 40ms
 * bound above was calibrated against one engine. Adding the chromium+webkit
 * matrix surfaced 57ms on WebKit.
 *
 * That number is mostly the HARNESS, not the product. The fixture is two
 * BrowserContexts inside ONE browser instance, so both "screens" share a
 * single renderer main thread and compete for the same rAF callbacks. Two
 * physical screens — the thing this feature actually ships to — have
 * independent CPUs and measure single-digit ms. Compounding it, the sync
 * feature's real target is Android System WebView (Blink), not WebKit; WebKit
 * is here to catch protocol/DOM regressions, not to certify frame timing.
 *
 * So the bound is raised for WebKit-on-CI specifically rather than globally:
 * chromium keeps the strict 40ms everywhere, and every local run keeps 40ms.
 * 90ms still leaves the guard meaningful — it is 3.6% of a 2.5s slot, and the
 * worst observed sample was 57ms, so a genuine desync has real headroom before
 * it could hide. If WebKit ever needs to go past this, that is a signal to
 * investigate rather than to raise it again.
 *
 * 2026-11-23 — the "one shared renderer main thread" explanation above is
 * unproven: CI data showed no rAF throttling of either page and contention
 * only while B boots. Of the 11 WebKit first-attempt failures over 90 ms in
 * Nov 2-23, the 2 whose data was still retained were B's engage snap
 * compared as if it were a crossing (see the header); the other 9 are known
 * only from their error line. Value kept until the new measurement has
 * about 20 annotated CI runs per engine; tightening to 40 ms waits on that.
 */
const WEBKIT_CI_SKEW_BOUND_MS = 90;
/**
 * Epoch-anchoring tolerance: |paintWallT - boundaryT| — how far from the
 * shared boundary, on the machine's wall clock, each screen painted the new
 * slide. It carries the screen's error in estimating server time (the
 * TIME_PING/TIME_PONG offset), its render-lead error, and frame
 * quantisation.
 *
 * 2026-11-23 — the check now measures what this name says. Until then it
 * read the log's itemStartT, which was the boundary minus the render lead,
 * so it measured the lead: the CI values quoted when this was raised to
 * 120 ms (64.3, 70.2 and 75.0 ms, 2026-08-04) were most likely leads
 * inflated by a stalled sample. The values are unchanged; with a real
 * measurement they can be re-derived from the annotations.
 *
 * The guarantee a viewer perceives is the lockstep bound (screens changing
 * TOGETHER); an offset shared by both screens moves the whole wall a little
 * and is invisible. This check catches a screen whose clock or lead math
 * has gone wrong on its own.
 */
const GRID_TOLERANCE_MS = process.env.CI ? 120 : 60;

/**
 * The join window: B's FIRST boundary crossing after it engaged, asserted on
 * its own (paint skew against A, and B's own anchor) rather than folded into
 * the lockstep bound or silently dropped.
 *
 * A screen that has just booted is still settling: right after its engage
 * commit the main thread can stall (131-181 ms, inferred from the lock wait,
 * in 3 of the 50 CI attempts retained for 2026-11-16..23). When such a stall
 * straddles the next boundary the screen decides that flip late by up to
 * the stall. The worst real join sample in
 * that data was 88.5 ms of decision skew (WebKit; B 83 ms late after a
 * 181 ms post-engage stall). 250 ms covers a 181 ms stall plus a normal
 * decision-to-paint and still catches a joiner that is on the wrong slide,
 * a boundary off, or off by a clock offset the lock gate (80 ms uncertainty)
 * should have refused. It is a first bound: revisit it with the
 * 'sync-join' annotations.
 */
const JOIN_SKEW_BOUND_MS = 250;

/**
 * Engage-on-the-shared-clock tolerance: how far an engage's decision instant,
 * on the mocked server clock, may sit outside the slot the engage resolved
 * (decision + lead must fall in [boundaryT, boundaryT + SLOT_MS)).
 *
 * Everything inside it is the screen's clock-estimate error at the engage:
 * the wall basis (Date.now() - performance wall, annotated as
 * 'sync-clock-basis', -0.9..0 ms locally) is applied first. Here that
 * error is about 1-3 ms by construction (see HARNESS LIMIT; locally -1.8 to
 * -0.1 ms over 24 runs), so 10 ms is margin, not slack. The check can only
 * fail when the clock error exceeds the tolerance, and then only for an
 * engage that lands within that error of a slot edge; a clock wrong by a
 * slot, or a resolver off by one, fails it wherever the engage lands.
 * Smaller clock errors are caught later by the anchoring checks.
 */
const ENGAGE_CLOCK_TOLERANCE_MS = 10;

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

/** One __eduSyncFlips entry (player/page.tsx, the sync conductor). */
interface FlipEntry {
  toIdx: number;
  /** 'engage': first locked tick or a resync jump; 'boundary': a real crossing (classifySyncFlip). */
  kind: 'engage' | 'boundary';
  /** Synced time of the decision (led by leadMs on purpose). */
  serverT: number;
  /** The slot start this flip resolved, synced time (on the grid by construction). */
  boundaryT: number;
  /** Same as boundaryT (kept for older readers). */
  itemStartT: number;
  /** The flip lead the decision used: 8 + render lead. */
  leadMs: number;
  /** Synced time of the previous locked tick; null at an engage. */
  prevT: number | null;
  /** Decision instant, performance.timeOrigin-based wall clock. */
  wallT: number | null;
  /** Paint (double-rAF after the decision), wall clock; null until painted. */
  paintWallT: number | null;
  /** Paint, synced time. */
  paintT: number | null;
}

const r1 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const slotIndexOf = (boundaryT: number) => {
  const k = Math.round(boundaryT / SLOT_MS);
  return ((k % ITEM_COUNT) + ITEM_COUNT) % ITEM_COUNT;
};
const gridErrOf = (boundaryT: number) => {
  const mod = ((boundaryT % SLOT_MS) + SLOT_MS) % SLOT_MS;
  return Math.min(mod, SLOT_MS - mod);
};
const readFlips = (page: Page) =>
  page.evaluate(() => (window as unknown as { __eduSyncFlips?: FlipEntry[] }).__eduSyncFlips ?? []) as Promise<FlipEntry[]>;

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
  test('two screens lock, land on the shared epoch grid, and flip in lockstep (late joiner included)', async ({ browser, browserName }) => {
    test.setTimeout(180_000);

    // Per-engine lockstep bound — see WEBKIT_CI_SKEW_BOUND_MS. chromium and
    // every local run keep the strict 40ms.
    const skewBound =
      process.env.CI && browserName === 'webkit' ? WEBKIT_CI_SKEW_BOUND_MS : SKEW_BOUND_MS;

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

      // Wait until B has crossed its first boundary while conducting (the
      // join window) plus STEADY_BOUNDARIES more, all painted.
      const STEADY_BOUNDARIES = 3;
      await pageB.waitForFunction(
        (need) => {
          const f = (window as unknown as { __eduSyncFlips?: FlipEntry[] }).__eduSyncFlips ?? [];
          return f.filter((e) => e.kind === 'boundary' && e.paintWallT !== null).length >= need;
        },
        STEADY_BOUNDARIES + 1,
        { timeout: 45_000 },
      );
      // The last PAINTED crossing bounds the comparison (a newer one may have
      // been decided but not painted yet when we read).
      const lastB = (await readFlips(pageB)).filter((e) => e.kind === 'boundary' && e.paintWallT !== null).pop()!;
      // A crosses the same boundaries within a frame or two; wait for its paint.
      await pageA.waitForFunction(
        (bt) => {
          const f = (window as unknown as { __eduSyncFlips?: FlipEntry[] }).__eduSyncFlips ?? [];
          return f.some((e) => e.boundaryT >= bt - 1 && e.paintWallT !== null);
        },
        lastB.boundaryT,
        { timeout: 15_000 },
      );

      const flipsA = await readFlips(pageA);
      const flipsB = await readFlips(pageB);
      // Wall-clock basis check (annotated, not asserted): paintWallT/wallT
      // come from performance.timeOrigin + performance.now(); the mocked
      // server clock is Date.now(). Their difference on each page is the
      // basis error of the wall-clock measurements below.
      const wallBasis = async (page: Page) =>
        page.evaluate(() => {
          const a = Date.now();
          const b = performance.timeOrigin + performance.now();
          const c = Date.now();
          return (a + c) / 2 - b;
        });
      const basisA = await wallBasis(pageA);
      const basisB = await wallBasis(pageB);

      const ann = (type: string, value: unknown) =>
        test.info().annotations.push({ type, description: JSON.stringify(value) });
      ann('sync-clock-basis', { browserName, dateNowMinusPerfWallA: r1(basisA), dateNowMinusPerfWallB: r1(basisB) });
      const describeFlip = (f: FlipEntry) => ({
        kind: f.kind,
        toIdx: f.toIdx,
        boundaryT: f.boundaryT,
        decisionToBoundaryMs: r1(f.serverT - f.boundaryT),
        leadMs: r1(f.leadMs),
        frameGapMs: f.prevT === null ? null : r1(f.serverT - f.prevT),
        anchorMs: f.paintWallT === null ? null : r1(f.paintWallT - f.boundaryT),
        decisionToPaintMs: f.paintWallT === null || f.wallT === null ? null : r1(f.paintWallT - f.wallT),
      });

      const boundaryB = flipsB.filter((f) => f.kind === 'boundary' && f.boundaryT <= lastB.boundaryT);
      const boundaryA = flipsA.filter((f) => f.kind === 'boundary' && f.boundaryT <= lastB.boundaryT);
      const partnerA = (fb: FlipEntry) =>
        boundaryA.find((fa) => fa.toIdx === fb.toIdx && Math.abs(fa.boundaryT - fb.boundaryT) < SLOT_MS / 2);
      const pairOf = (fb: FlipEntry) => {
        const fa = partnerA(fb);
        return {
          fa,
          fb,
          row: {
            toIdx: fb.toIdx,
            boundaryT: fb.boundaryT,
            paintSkewMs: fa && fa.paintWallT !== null && fb.paintWallT !== null ? r1(Math.abs(fa.paintWallT - fb.paintWallT)) : null,
            decisionSkewMs: fa && fa.wallT !== null && fb.wallT !== null ? r1(Math.abs(fa.wallT - fb.wallT)) : null,
            A: fa ? describeFlip(fa) : null,
            B: describeFlip(fb),
          },
        };
      };
      // B's first crossing while conducting is the join window; the rest are
      // steady state (both screens conducting).
      const join = boundaryB.length ? pairOf(boundaryB[0]) : null;
      const steady = boundaryB.slice(1).map(pairOf);

      // Annotate everything BEFORE asserting, so a failing run carries it too.
      for (const [tag, flips] of [['A', flipsA], ['B', flipsB]] as const) {
        for (const f of flips) if (f.kind === 'engage') ann('sync-engage', { screen: tag, ...describeFlip(f) });
      }
      if (join) {
        ann('sync-join', join.row);
        for (const fa of boundaryA.filter((f) => f.boundaryT < join.fb.boundaryT)) ann('sync-a-before-join', describeFlip(fa));
      }
      for (const p of steady) ann('sync-boundary', p.row);

      // ── 2. Every flip resolves the right slide for its slot on the epoch
      // grid (anchor = Unix epoch, equal slots). For an engage this is the
      // late-joiner property: B lands on A's timeline mid-slot, no
      // start-from-zero.
      for (const [tag, flips] of [['A', flipsA], ['B', flipsB]] as const) {
        for (const f of flips) {
          expect(gridErrOf(f.boundaryT), `[${tag}] boundary off the epoch grid: ${JSON.stringify(f)}`).toBeLessThan(1);
          expect(f.toIdx, `[${tag}] wrong slide for its slot on the epoch grid: ${JSON.stringify(f)}`).toBe(slotIndexOf(f.boundaryT));
        }
      }
      // The two checks above come from the page's own resolveTimeline call,
      // so they prove the grid, not the clock. For each engage, also check
      // the slot it resolved against the SHARED clock: the decision instant
      // on the mocked server clock (wallT + this page's wall basis) plus the
      // lead it used must fall inside [boundaryT, boundaryT + SLOT_MS).
      for (const [tag, flips, basis] of [['A', flipsA, basisA], ['B', flipsB, basisB]] as const) {
        for (const f of flips) {
          if (f.kind !== 'engage') continue;
          expect(f.wallT, `[${tag}] engage has no wall-clock decision instant: ${JSON.stringify(f)}`).not.toBeNull();
          const offsetOnSharedClock = f.wallT! + basis + f.leadMs - f.boundaryT;
          const msg = `[${tag}] engage resolved a slot that was not current on the shared clock ` +
            `(decision + lead at ${r1(offsetOnSharedClock)} ms into the slot, tolerance ${ENGAGE_CLOCK_TOLERANCE_MS} ms): ${JSON.stringify(f)}`;
          expect(offsetOnSharedClock, msg).toBeGreaterThanOrEqual(-ENGAGE_CLOCK_TOLERANCE_MS);
          expect(offsetOnSharedClock, msg).toBeLessThan(SLOT_MS + ENGAGE_CLOCK_TOLERANCE_MS);
        }
      }

      expect(join, 'screen B recorded no boundary crossing').not.toBeNull();
      const joinB = join!.fb;

      // ── 5. The join window, on its own bound.
      expect(join!.fa, `A has no crossing for B's first boundary: ${JSON.stringify(join!.row)}`).toBeTruthy();
      expect(join!.row.paintSkewMs, `join window: paint skew not measurable: ${JSON.stringify(join!.row)}`).not.toBeNull();
      expect(
        join!.row.paintSkewMs!,
        `join-window paint skew, B's first boundary after engage (bound ${JOIN_SKEW_BOUND_MS}ms, ${browserName}): ${JSON.stringify(join!.row)}`,
      ).toBeLessThan(JOIN_SKEW_BOUND_MS);
      for (const [tag, f] of [['A', join!.fa!], ['B', joinB]] as const) {
        expect(
          Math.abs(f.paintWallT! - f.boundaryT),
          `join-window anchor, ${tag} (bound ${JOIN_SKEW_BOUND_MS}ms, ${browserName}): ${JSON.stringify(join!.row)}`,
        ).toBeLessThan(JOIN_SKEW_BOUND_MS);
      }

      // ── 6. Continuity: from the join on, B crossed every slot as a
      // 'boundary'. A crossing B took as an 'engage' after joining (a
      // stand-down and re-lock, or a multi-slot jump) would otherwise be
      // left out of the steady-state pairs without a trace. (A duplicate
      // re-log of the same flip, from a tick that runs before React commits
      // the index, is correctly an 'engage' and leaves no gap here.)
      const boundarySeqB = boundaryB.map((f) => f.boundaryT);
      for (let i = 1; i < boundarySeqB.length; i++) {
        expect(
          Math.abs(boundarySeqB[i] - boundarySeqB[i - 1] - SLOT_MS),
          `B's boundary crossings after the join are not consecutive slots: ${JSON.stringify(boundaryB.map(describeFlip))}`,
        ).toBeLessThan(1);
      }

      // ── 3+4. Steady state: both screens conducting.
      expect(steady.length, 'too few steady-state boundaries after the join').toBeGreaterThanOrEqual(STEADY_BOUNDARIES);
      for (const { fa, fb, row } of steady) {
        expect(fa, `A has no crossing for B's boundary: ${JSON.stringify(row)}`).toBeTruthy();
        expect(row.paintSkewMs, `paint skew not measurable: ${JSON.stringify(row)}`).not.toBeNull();
        expect(
          row.paintSkewMs!,
          `lockstep paint skew for boundary idx=${row.toIdx} @${row.boundaryT} (bound ${skewBound}ms, ${browserName}): ${JSON.stringify(row)}`,
        ).toBeLessThan(skewBound);
        for (const f of [fa!, fb]) {
          expect(
            Math.abs(f.paintWallT! - f.boundaryT),
            `epoch anchoring (paint vs boundary, bound ${GRID_TOLERANCE_MS}ms, ${browserName}): ${JSON.stringify(row)}`,
          ).toBeLessThan(GRID_TOLERANCE_MS);
        }
      }

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
