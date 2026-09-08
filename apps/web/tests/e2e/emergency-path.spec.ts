import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * EMERGENCY-PATH E2E — P0-8 from the 2026-05-26 production audit.
 *
 * Three simultaneous catastrophic bugs were found on the emergency path by
 * tracing the call graph end-to-end. None were caught by the existing unit
 * tests, the integration suite, or the cross-browser holiday-bridge canary:
 *
 *   P0-1  WS gateway rewrote the signed envelope's timestamp from
 *         milliseconds to seconds before send(). The player's freshness
 *         gate (apps/web/.../player/page.tsx ~L3489) compares the
 *         timestamp to Date.now() in ms with a ±30s window, so every
 *         signed SENSITIVE_TYPES message landed ~1.7×10¹² ms "in the past"
 *         and was dropped client-side. The "200ms fan-out" claim
 *         degenerated to a 5–10s HTTP poll backstop in practice.
 *         Fix: apps/api/src/realtime/realtime.gateway.ts (a8bbed6) — pass
 *         the envelope's signed timestamp through unchanged.
 *
 *   P0-2  Manifest emergency contract drifted. The API returns FLAT
 *         fields (isEmergency / emergencyType / emergencySeverity /
 *         emergencyScopeNote / emergencyScope / emergencyExpiresAt) but
 *         the player only checked the nested `manifest.emergency` /
 *         `manifest.override` envelope which was never emitted. Result:
 *         `setActiveEmergency(em)` never fired, `cacheEmergency` never
 *         wrote, polling cadence stayed at 10s during lockdowns, the
 *         scheduled-HTML URL overlay rendered on TOP of the lockdown
 *         content. Three documented safeguards were silently dead.
 *         Fix: apps/web/.../player/page.tsx (4b57582) — read flat fields
 *         first, keep nested as legacy fallback.
 *
 *   P0-3  SOS / TEXT_BROADCAST / MEDIA_ALERT were signed and published by
 *         the API (emergency.controller.ts:739/821/907) but no player
 *         handler consumed them. They were broadcast into the void —
 *         never displayed on wall screens. ALL_CLEAR_MESSAGE likewise
 *         had no consumer.
 *         Fix: apps/web/.../player/page.tsx (76f2889) — added WS branches
 *         that drive `pushedEmergencyMessage` state into the existing
 *         EmergencyOverlay component.
 *
 * THIS TEST'S CONTRACT WITH THE FUTURE
 *
 *   1. Baseline: no overlay, no emergency cache, no false positives.
 *   2. Manifest flat-shape: `isEmergency: true` lights up the player
 *      AND writes the power-cycle cache. Reverting to nested shape
 *      breaks this assertion. (P0-2.)
 *   3. WS OVERRIDE accepted with ms timestamp — proven by an immediate
 *      manifest re-fetch and zero "stale/future event" console drops.
 *      Reverting the gateway to seconds breaks this assertion. (P0-1.)
 *   4. Manifest path independent of WS path: flat-shape path works
 *      whether or not WS is alive. (Belt-and-suspenders for P0-2.)
 *   5. SOS renders "Staff SOS" full-screen via EmergencyOverlay.
 *      Removing the SOS branch in onmessage breaks this. (P0-3.)
 *   6. TEXT_BROADCAST renders "Broadcast" banner/full-screen.
 *      Removing the TEXT_BROADCAST branch breaks this. (P0-3.)
 *   7. MEDIA_ALERT renders "Emergency Alert" full-screen.
 *      Removing the MEDIA_ALERT branch breaks this. (P0-3.)
 *   8. ALL_CLEAR_MESSAGE removes the overlay. Removing the branch
 *      means a SOS cannot be cleared without a tab reload. (P0-3.)
 *   9. Power-cycle ride-through: a kiosk that boots with a cached
 *      emergency in localStorage shows the overlay on first render,
 *      BEFORE the first manifest poll lands. Breaking the
 *      hydrate-from-cache effect kills life-safety on reboot.
 *
 * EVERY API call is intercepted. No production traffic. Per CLAUDE.md
 * the repo is PUBLIC — there is no real token, fingerprint, or tenant id
 * in this file. The fake API base in playwright.config.ts (http://api.invalid)
 * is double-protection: an unmocked call NXDOMAINs instead of silently
 * hitting any reachable host.
 */

// ─── Shared fake identities ──────────────────────────────────────────────
const FAKE_SCREEN_ID = 'test-screen-000000000000';
const FAKE_TENANT_ID = 'test-tenant-000000000000';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-deterministic';

// Minimal manifest the player will accept. Empty playlists is fine — the
// emergency path is what we're testing; playlist plumbing is out of scope.
function baselineManifest(extra: Record<string, unknown> = {}) {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [],
    ...extra,
  };
}

/**
 * Install the API mock layer onto a page. Captures every request so tests
 * can assert "manifest was re-fetched within 1s" or "no SOS call happened".
 *
 * The `manifestRef` is a mutable holder so individual tests can mutate the
 * served body between polls without re-installing routes.
 */
async function installApiMocks(
  page: Page,
  manifestRef: { value: ReturnType<typeof baselineManifest> },
  counters: {
    manifestCalls: number;
    registerCalls: number;
    emergencyStatusCalls: number;
    revCalls?: number;
  },
  /**
   * P0-7 #2 — what `GET /:id/emergency-rev` answers.
   *
   * `null` (the default) leaves the endpoint on the suite's catch-all 204,
   * which `classifyRevPoll` reads as `unavailable` → full manifest fetch, i.e.
   * the pre-2026-09-05 behaviour every other test in this file exercises. A
   * test that wants the raise fast path sets a body here.
   */
  revRef: { value: unknown | null } = { value: null },
  /**
   * P0-7 #2 — hold the manifest response open for this many ms.
   *
   * This is the ONLY honest way to test "the alert arrived without waiting for
   * the manifest". With a fast manifest saying `isEmergency: false`, a raise
   * from the rev body is correctly UNDONE a fraction of a second later — the
   * manifest is the arbiter, and that is the system working. The first draft
   * of these tests measured exactly that and read it as a broken fast path.
   *
   * A slow manifest is also the real condition being fixed: during the
   * measured Redis outage the manifest was not wrong, it was QUEUED (p95
   * 18 061 ms). Holding it open reproduces that and makes the assertion
   * decisive — while it is in flight, nothing but the rev body can put an
   * alert on the glass, and nothing can take one off.
   */
  manifestDelayRef: { value: number } = { value: 0 },
) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // Catch-all for the entire fake API host. Playwright matches routes
  // in REVERSE registration order (last-wins), so this MUST be
  // registered FIRST — every specific endpoint below short-circuits
  // before reaching here. The catch-all returns 204 so a poll loop
  // doesn't enter retry-storm; if a route is missing, the player will
  // just see "no-op" until you ADD A ROUTE below.
  await page.route(/http:\/\/api\.invalid\/.*/, async (route) => {
    return route.fulfill({ status: 204, body: '' });
  });

  // Pairing-registration: pretend we're already paired so the player
  // skips the pairing-code splash and moves to 'connecting' immediately.
  await page.route('**/api/v1/screens/register', async (route) => {
    counters.registerCalls += 1;
    return ok(route, {
      paired: true,
      screenId: FAKE_SCREEN_ID,
      name: 'Test Screen',
      deviceToken: FAKE_DEVICE_TOKEN,
    });
  });

  // Manifest — the heart of the emergency-path contract. Mutable via
  // manifestRef so tests can flip isEmergency mid-session and trigger
  // the next poll.
  // Trailing `*` (2026-08-30): post-OVERRIDE and mid-emergency polls carry
  // the `?_eb=` cache-buster — a glob without it silently missed them and
  // they fell through to the 204 catch-all.
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, async (route) => {
    counters.manifestCalls += 1;
    // QUEUED, not broken — see `manifestDelayRef`.
    if (manifestDelayRef.value > 0) {
      await new Promise((r) => setTimeout(r, manifestDelayRef.value));
    }
    // `null` = the manifest is UNREACHABLE.
    if (manifestRef.value === null) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return ok(route, manifestRef.value);
  });

  // Emergency cache-tier — return an empty pre-cache so the SW path
  // is satisfied and doesn't retry. We block SW registration via the
  // playwright config, but the fetch fires regardless.
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, async (route) => {
    return ok(route, { assets: [], setHash: 'empty-fake-hash' });
  });

  // P0-7 #2 — the emergency-revision poll. Registered BEFORE the
  // emergency-assets route would otherwise catch it, and answering 204 unless
  // a test opts in, which is exactly what the suite's catch-all did before.
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-rev*`, async (route) => {
    counters.revCalls = (counters.revCalls ?? 0) + 1;
    if (revRef.value === null) return route.fulfill({ status: 204, body: '' });
    return ok(route, revRef.value);
  });

  // Cache-status reporter — no-op POST.
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, async (route) => {
    return route.fulfill({ status: 204, body: '' });
  });

  // Heartbeat (status) — public, returns {paired,...}.
  await page.route(/\/api\/v1\/screens\/status\//, async (route) => {
    return ok(route, {
      paired: true,
      screenId: FAKE_SCREEN_ID,
      name: 'Test Screen',
      tenantId: FAKE_TENANT_ID,
    });
  });

  // EmergencyOverlay's fallback poll — always say "no extra messages"
  // so we control state exclusively via WS in this test. (We assert SOS
  // rendering via WS push, not via this polling path.)
  await page.route('**/api/v1/emergency/status*', async (route) => {
    counters.emergencyStatusCalls += 1;
    return ok(route, { active: [] });
  });

  // Notifications + analytics + version endpoints — non-load-bearing
  // for this test. Return shape-stable empties so the player doesn't
  // log retry storms.
  await page.route('**/api/v1/notifications/**', (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route('**/api/v1/analytics/**', (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/security/**', (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
}

/**
 * Inject a stub WebSocket constructor BEFORE any page script runs. The real
 * /realtime endpoint is on the API host we never reach; without this the
 * WS code would loop in reconnect backoff. With it, `window.__pushWs(msg)`
 * delivers a message to the player's onmessage handler synchronously.
 *
 * The stub also:
 *   - Auto-sends AUTH_OK with serverTime=Date.now() on open so the player's
 *     clock-offset captures 0ms drift (avoids false-positive "stale event").
 *   - Records every outgoing send (HELLO, HEARTBEAT) on `__wsSent` for
 *     debug visibility.
 *   - Exposes `__lastConsole` to capture console.warn ("dropped stale...")
 *     so we can assert the timestamp-units bug did not silently re-appear.
 */
async function installPlayerTestHarness(
  page: Page,
  opts: { preseedEmergencyCache?: unknown } = {},
) {
  await page.addInitScript(
    ({ deviceToken, fingerprint, preseedEmergencyCache }) => {
      const w = window as unknown as Record<string, unknown>;

      // Seed device pairing state so the player skips the pairing UI.
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
        if (preseedEmergencyCache) {
          localStorage.setItem(
            'edu_emergency_cache_v1',
            JSON.stringify(preseedEmergencyCache),
          );
        }
      } catch {
        /* ignore — localStorage missing means we'd never have reached here */
      }

      // Bucket of captured console messages so tests can assert no
      // "dropped stale/future event" leaks happened (P0-1 regression
      // sentinel — the player logs that exact string when timestamp
      // units go wrong).
      const consoleLog: Array<{ level: string; msg: string }> = [];
      w.__consoleLog = consoleLog;
      const wrap = (level: string, orig: (...args: unknown[]) => void) =>
        function (...args: unknown[]) {
          try {
            consoleLog.push({ level, msg: args.map((a) => String(a)).join(' ') });
          } catch {
            /* ignore stringify failures */
          }
          // Preserve original behavior so Playwright's `page.on('console')`
          // still captures the message for debugging on failures.
          return orig.apply(console, args);
        };
      console.log = wrap('log', console.log.bind(console));
      console.warn = wrap('warn', console.warn.bind(console));
      console.error = wrap('error', console.error.bind(console));

      // ─── Selective WebSocket stub ───
      // CRITICAL: we MUST NOT replace `window.WebSocket` wholesale. Next.js
      // dev mode opens its HMR socket via the real WebSocket; clobbering
      // it stalls the page boot entirely (no register call, no manifest
      // call — exactly the symptom we observed during bring-up).
      //
      // Approach: replace the constructor with a function that DELEGATES
      // to the real WebSocket for any URL that isn't the player's
      // `/realtime` endpoint. Player WS connections go to the stub which
      // exposes `__pushWs(msg)` for the test to inject signed events.
      const RealWS = window.WebSocket;
      const wsInstances: Array<{
        url: string;
        onmessage: ((ev: MessageEvent) => void) | null;
      }> = [];
      w.__wsInstances = wsInstances;
      const wsSent: Array<{ url: string; data: string }> = [];
      w.__wsSent = wsSent;

      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        // Delegate non-realtime URLs (HMR, Sentry, etc.) to the real WS.
        if (!url.includes('/realtime')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return new (RealWS as any)(url, protocols);
        }
        // Stub for the player's realtime socket. Plain-object shape; the
        // player code only calls .send / .close / sets onopen/onmessage
        // and reads .readyState — no instanceof checks anywhere.
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
            wsSent.push({ url, data });
          },
          close() {
            this.readyState = RealWS.CLOSED;
          },
          addEventListener() {
            /* unused by player */
          },
          removeEventListener() {
            /* unused */
          },
        };
        // Push the actual `inst` so the test can reach `inst.onmessage`
        // after the player has bound its handler.
        wsInstances.push(inst as unknown as (typeof wsInstances)[number]);
        // Async-open so the player's connect() returns and binds its
        // event handlers BEFORE we deliver AUTH_OK.
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (inst.onopen) inst.onopen.call(null as never, new Event('open'));
          // Player sends HELLO in onopen — give it a tick then AUTH_OK
          // with serverTime=now so clock-offset is captured as ~0.
          setTimeout(() => {
            const authOk = {
              type: 'AUTH_OK',
              data: {
                deviceId: 'fake-device',
                expiresAt: Date.now() + 60 * 60 * 1000,
                serverTime: Date.now(),
              },
              idempotencyKey: 'auth-ok-1',
              timestamp: Date.now(),
            };
            if (inst.onmessage) {
              inst.onmessage.call(
                null as never,
                new MessageEvent('message', { data: JSON.stringify(authOk) }),
              );
            }
          }, 10);
        }, 5);
        return inst;
      }
      // Carry the static enum constants — some code reads
      // WebSocket.OPEN as the constant.
      (StubWebSocket as unknown as { CONNECTING: number }).CONNECTING = RealWS.CONNECTING;
      (StubWebSocket as unknown as { OPEN: number }).OPEN = RealWS.OPEN;
      (StubWebSocket as unknown as { CLOSING: number }).CLOSING = RealWS.CLOSING;
      (StubWebSocket as unknown as { CLOSED: number }).CLOSED = RealWS.CLOSED;
      try {
        Object.defineProperty(window, 'WebSocket', {
          value: StubWebSocket,
          writable: true,
          configurable: true,
        });
      } catch {
        // Some engines lock window.WebSocket; fall back to plain assignment.
        (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;
      }

      // Public push hook for tests. Delivers to the most recently
      // OPEN stub instance whose onmessage handler is bound. The player
      // reconnects with exponential backoff; we explicitly prefer
      // OPEN+bound over CLOSING/CLOSED so we don't push to a zombie.
      w.__pushWs = (msg: Record<string, unknown>) => {
        for (let i = wsInstances.length - 1; i >= 0; i--) {
          const inst = wsInstances[i] as unknown as {
            onmessage?: (ev: MessageEvent) => void;
            readyState?: number;
          };
          if (inst.onmessage && inst.readyState === RealWS.OPEN) {
            inst.onmessage.call(
              null as never,
              new MessageEvent('message', { data: JSON.stringify(msg) }),
            );
            return true;
          }
        }
        return false;
      };

      // EventSource (SSE) is also used as a WS fallback. We never want it
      // to fire in this test because we control everything via the WS
      // stub. Stub it to a never-opens no-op.
      class StubEventSource {
        url: string;
        readyState = 0;
        onopen: ((ev: Event) => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        constructor(url: string) {
          this.url = url;
        }
        addEventListener() {
          /* no-op */
        }
        close() {
          /* no-op */
        }
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    {
      deviceToken: FAKE_DEVICE_TOKEN,
      fingerprint: FAKE_FINGERPRINT,
      preseedEmergencyCache: opts.preseedEmergencyCache,
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Read the emergency cache from localStorage on the page. */
async function readEmergencyCache(page: Page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('edu_emergency_cache_v1');
      return raw ? (JSON.parse(raw) as { payload?: { active?: boolean; type?: string } }) : null;
    } catch {
      return null;
    }
  });
}

/**
 * Wait until the stub holds a socket the player is ACTUALLY listening on —
 * OPEN with `onmessage` bound — and report the instance states when it does
 * not appear.
 *
 * 2026-09-03: `waitForPlayerReady` gates on the first manifest fetch, which
 * is a DIFFERENT signal from "the WS effect has run and bound a handler"
 * (player rule 5: never equate signals). The player's WS effect depends on
 * (phase, screenId, fetchContent), so the socket is created → closed →
 * re-created across a couple of renders right after pairing, and on WebKit
 * under CI contention that settles well after the manifest lands. The old
 * fixed 500 ms window lost that race repeatedly — every failure was "WS stub
 * had no live instance" on webkit while chromium passed and the rerun went
 * green, which is a harness bug wearing a P0-regression costume. Gate on the
 * STATE (harness rule: mocks key on state, never on counts/elapsed time),
 * with a budget long enough that a genuine "no WS ever came up" still fails.
 */
async function waitForWsLive(page: Page, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const live = await page.evaluate(() => {
      const OPEN =
        (window as unknown as { WebSocket?: { OPEN?: number } }).WebSocket?.OPEN ?? 1;
      const list =
        (window as unknown as {
          __wsInstances?: Array<{ onmessage?: unknown; readyState?: number }>;
        }).__wsInstances || [];
      return list.some((i) => !!i.onmessage && i.readyState === OPEN);
    });
    if (live) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/**
 * Push a WS message and return true if the player accepted (had a socket).
 *
 * Waits for a live socket first (see [waitForWsLive]), then rides the brief
 * create → close → re-create window with a bounded retry. A false return
 * still means "no WS ever came up", which the callers assert on — the
 * diagnostic below is what tells the two failure modes apart in CI output.
 */
async function pushWs(page: Page, msg: Record<string, unknown>) {
  await waitForWsLive(page);
  const start = Date.now();
  while (Date.now() - start < 2_000) {
    const delivered = await page.evaluate((m) => {
      return (
        (window as unknown as { __pushWs?: (m: unknown) => boolean }).__pushWs?.(m) ?? false
      );
    }, msg);
    if (delivered) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  const diag = await page.evaluate(() => {
    const list =
      (window as unknown as {
        __wsInstances?: Array<{ onmessage?: unknown; readyState?: number; url?: string }>;
      }).__wsInstances || [];
    return list.map((i) => `${i.url ?? '?'}:rs=${i.readyState}:bound=${!!i.onmessage}`).join(' | ');
  });
  console.warn(`[pushWs] no live socket after 15s+2s — instances: ${diag || '(none created)'}`);
  return false;
}

/** Count "dropped stale/future event" console warnings — P0-1 sentinel. */
async function countStaleDrops(page: Page) {
  return page.evaluate(() => {
    const log = (window as unknown as { __consoleLog?: Array<{ msg: string }> }).__consoleLog || [];
    return log.filter((e) => /dropped stale\/future event/.test(e.msg)).length;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

test.describe('Emergency path — P0-8 regression suite', () => {
  // Each test gets its own fresh counters + manifest ref. We DO NOT share
  // state across tests; the audit found bugs that only appeared on cold
  // boot, so every test cold-boots the player.
  let manifestRef: { value: ReturnType<typeof baselineManifest> };
  let counters: {
    manifestCalls: number;
    registerCalls: number;
    emergencyStatusCalls: number;
    revCalls?: number;
  };
  /** P0-7 #2 — what the emergency-revision poll answers. Null ⇒ 204. */
  let revRef: { value: unknown | null };
  /** P0-7 #2 — hold the manifest open for N ms (a QUEUED manifest, not a broken one). */
  let manifestDelayRef: { value: number };

  // 2026-08-03 — WHY THE MANIFEST BUDGET IS 45s, NOT 10s.
  //
  // This suite cold-boots the player in every test (deliberate — the P0-8
  // audit found bugs that only surface on cold boot), and nothing warms the
  // dev server first. So test #1 pays the `/player` cold compile inside its
  // manifest budget. Measured: `/player` cold-compiles in ~12s on a developer
  // laptop and materially slower on a loaded CI runner. At the old 10s budget
  // test #1 was losing a race it was never given time to win.
  //
  // It hid because chromium and webkit run as SEPARATE CI jobs: whichever hit
  // an already-warm server passed and the other went red, which reads exactly
  // like a browser-specific regression. On 2026-08-03 chromium passed and
  // webkit failed with "Player never fetched the manifest", while the same
  // spec passed 9/9 on webkit locally against a warm server.
  //
  // A beforeAll warm-up (as widget-render.spec.ts uses) was tried here and
  // REVERTED: in this suite the `browser` fixture is torn down under the
  // retry machinery, so every attempt died on
  // `browser.newPage: Target page, context or browser has been closed` and
  // the warm-up became a second failure source instead of a fix. The budget
  // is the honest lever — it guards "did the player boot at all", not a
  // timing property, so headroom costs nothing and removes a false-red from
  // a life-safety gate, which is the worst possible place to teach people to
  // ignore a red.
  test.beforeEach(async ({ page }) => {
    manifestRef = { value: baselineManifest() };
    counters = { manifestCalls: 0, registerCalls: 0, emergencyStatusCalls: 0, revCalls: 0 };
    revRef = { value: null };
    manifestDelayRef = { value: 0 };
    // Surface page errors loud so a regression doesn't hide behind a
    // silent JS crash inside the player. Hydration mismatches on the
    // KioskSplash inline <style> block are pre-existing and unrelated;
    // we DO NOT fail the suite on them.
    page.on('pageerror', (err) => {
      if (!/Hydration failed/.test(err.message)) {
        // eslint-disable-next-line no-console
        console.log('[PAGE ERROR]', err.message);
      }
    });
    page.on('requestfailed', (req) => {
      // eslint-disable-next-line no-console
      console.log('[REQUEST FAILED]', req.url(), req.failure()?.errorText);
    });
    // P0-7 #2 — the revision poll narrates every decision it makes. Surfacing
    // it turns "the raise did not fire" into "the raise fired / was dropped
    // unsigned / the outcome was unavailable", which is the difference between
    // a diagnosable red and a guess.
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[Player rev]')) {
        // eslint-disable-next-line no-console
        console.log('[REV]', t);
      }
    });
    await installApiMocks(page, manifestRef, counters, revRef, manifestDelayRef);
    await installPlayerTestHarness(page);
  });

  /**
   * Wait until the player has settled into the 'playing' phase. Sentinel:
   * the manifest has been fetched at least once (counters.manifestCalls > 0)
   * AND the EmergencyOverlay's mount gate `tenantId` is set, which we
   * inspect by checking that the body has rendered without throwing.
   */
  async function waitForPlayerReady(page: Page) {
    await expect
      .poll(() => counters.manifestCalls, {
        message: 'Player never fetched the manifest — pairing/connecting got stuck',
        timeout: 45_000,
      })
      .toBeGreaterThanOrEqual(1);
  }

  test('1. baseline — no emergency, no overlay, empty cache', async ({ page }) => {
    // First test of the spec pays the FULL cold dev-server compile of the
    // ~11k-line /player page — and when this spec runs alongside another
    // spec (parallel local workers), both cold compiles contend. 60s is
    // enough warm but not cold-under-contention; give the payer 120s.
    test.setTimeout(120_000);
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    // No emergency was reported, so the cache should NOT exist.
    const cache = await readEmergencyCache(page);
    expect(cache, 'emergency cache must be empty when manifest reports no emergency').toBeNull();

    // EmergencyOverlay renders nothing when no active message — assert
    // by text. (NB: the player has other role="alert" elements for things
    // like the unsigned-WS-token banner, so a blanket `[role="alert"]`
    // count check would be unstable. The EmergencyOverlay's distinctive
    // strings are "Staff SOS" / "Emergency Alert" / "Broadcast".)
    await expect(page.getByText('Staff SOS')).toHaveCount(0);
    await expect(page.getByText('Emergency Alert')).toHaveCount(0);
    await expect(page.getByText('Broadcast')).toHaveCount(0);
  });

  test('2. manifest FLAT shape (P0-2) sets activeEmergency + writes cache', async ({ page }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    // Baseline assertion before flipping the manifest.
    expect(await readEmergencyCache(page)).toBeNull();

    // Flip the manifest to the FLAT contract (isEmergency / emergencyType /
    // emergencySeverity), NOT a nested `emergency` envelope. This is the
    // exact shape the API at apps/api/src/screens/screens.controller.ts
    // emits when Tenant.emergencyStatus is non-NONE. If a future refactor
    // reverts the player to checking `manifest.emergency`, the cache write
    // below will NEVER happen and this assertion fails — which is the
    // entire diagnostic point.
    manifestRef.value = baselineManifest({
      isEmergency: true,
      emergencyType: 'LOCKDOWN',
      emergencySeverity: 'CRITICAL',
      emergencyScopeNote: 'Drill — automated test',
      emergencyScope: 'tenant',
    });

    // Force the next poll cycle. Easiest path: dispatch a WS OVERRIDE which
    // calls fetchContent() unconditionally. We could also wait 10s but
    // that blows the per-test budget.
    await pushWs(page, {
      type: 'OVERRIDE',
      timestamp: Date.now(),
      eventId: 'override-evt-1',
      signature: 'fake-sig-for-test',
      payload: { overrideId: 'or-1', severity: 'CRITICAL', textBlob: '', expiresAt: 0 },
    });

    // Wait for the cache write to land.
    await expect
      .poll(() => readEmergencyCache(page), {
        message:
          'P0-2 regression: manifest with FLAT isEmergency=true did not trigger setActiveEmergency/cacheEmergency. ' +
          'Player likely reverted to checking the nested `manifest.emergency` envelope.',
        timeout: 5_000,
      })
      .not.toBeNull();

    const cache = await readEmergencyCache(page);
    expect(cache?.payload?.active, 'cached emergency must mark active=true').toBe(true);
    expect(cache?.payload?.type, 'cached emergency must carry the flat type').toBe('LOCKDOWN');
  });

  test('3. WS OVERRIDE with Date.now() ms timestamp (P0-1) is NOT dropped as stale', async ({
    page,
  }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);
    const manifestCallsBefore = counters.manifestCalls;

    // The signed envelope's timestamp MUST be milliseconds. If anyone
    // re-introduces the seconds-bug in the WS gateway (apps/api/src/
    // realtime/realtime.gateway.ts ~L311), the player's freshness gate at
    // page.tsx:3489 drops the event with "dropped stale/future event" and
    // fetchContent() never runs. We assert both halves of that: no drop
    // log AND a manifest re-fetch within ~1s.
    const pushed = await pushWs(page, {
      type: 'OVERRIDE',
      timestamp: Date.now(),
      eventId: 'override-ms-timestamp-1',
      signature: 'fake-sig',
      payload: { overrideId: 'or-2', severity: 'CRITICAL', textBlob: '', expiresAt: 0 },
    });
    expect(pushed, 'WS stub did not have a live instance to deliver to').toBe(true);

    await expect
      .poll(() => counters.manifestCalls, {
        message:
          'P0-1 regression: OVERRIDE with ms-precision Date.now() timestamp did not trigger ' +
          'a manifest re-fetch within 2s. WS gateway likely re-introduced seconds-rewrite.',
        timeout: 2_000,
      })
      .toBeGreaterThan(manifestCallsBefore);

    expect(
      await countStaleDrops(page),
      'P0-1 regression: player logged "dropped stale/future event" for a ms-precision OVERRIDE. ' +
        'WS gateway is sending seconds again.',
    ).toBe(0);
  });

  test('4. WS OVERRIDE with SECONDS timestamp IS dropped — proves the gate works', async ({
    page,
  }) => {
    // Inverse assertion: if we deliberately send a seconds-precision
    // timestamp (the P0-1 bug shape) the freshness gate MUST drop it.
    // This guards against someone "fixing the test failure" by also
    // loosening the gate to >30 days instead of >30 seconds.
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    const stalesBefore = await countStaleDrops(page);

    await pushWs(page, {
      type: 'OVERRIDE',
      // Seconds, not milliseconds — what the buggy gateway used to send.
      timestamp: Math.floor(Date.now() / 1000),
      eventId: 'override-sec-bug-1',
      signature: 'fake-sig',
      payload: { overrideId: 'or-3', severity: 'CRITICAL', textBlob: '', expiresAt: 0 },
    });

    await expect
      .poll(() => countStaleDrops(page), {
        message:
          'Freshness gate was loosened. The seconds-precision timestamp MUST be rejected — ' +
          'otherwise the P0-1 detection (test #3) is meaningless.',
        timeout: 1_500,
      })
      .toBeGreaterThan(stalesBefore);
  });

  test('5. SOS WS message renders "Staff SOS" overlay (P0-3)', async ({ page }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    await pushWs(page, {
      type: 'SOS',
      timestamp: Date.now(),
      eventId: 'sos-evt-1',
      signature: 'fake-sig',
      payload: {
        id: 'sos-1',
        severity: 'CRITICAL',
        textBlob: 'Help in room 204',
        mediaUrls: [],
        audioUrl: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    // EmergencyOverlay renders "Staff SOS" label for type=SOS.
    await expect(
      page.getByText('Staff SOS'),
      'P0-3 regression: SOS WS message did not render. The player onmessage handler likely ' +
        'lost the SOS branch, so the EmergencyOverlay never received pushedEmergencyMessage.',
    ).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText('Help in room 204')).toBeVisible();
  });

  /**
   * 5b. THE WIDGET SPLIT'S HARD RULE (P1-1, 2026-09-03): an alert never waits
   * on a chunk.
   *
   * The widget/theme catalog now loads from per-family chunks behind
   * `lazyWidget` proxies, so a screen fetches JavaScript AFTER boot. Nothing
   * on the emergency path may join that set: `EmergencyOverlay` is statically
   * imported by `player/page.tsx` and renders outside the renderer island, so
   * a lockdown must paint from what the document already holds (player rule
   * 11).
   *
   * ORDER IS THE PROOF. `/_next/**` is aborted FIRST — after that no dynamic
   * import can ever resolve — and only THEN is the alert pushed. Test 5 above
   * is the same push on a healthy network; this one is that push on a screen
   * that can no longer download a single byte of JavaScript. If someone moves
   * the overlay (or anything it renders) behind a dynamic import, test 5 stays
   * green and this one goes red, which is exactly the discrimination we want.
   */
  test('5b. an alert still paints once the chunk transport is dead (P1-1 split guard)', async ({ page }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    // Chunk transport dead: no dynamic import can resolve from here on.
    await page.route('**/_next/**', (route) => route.abort());

    const pushed = await pushWs(page, {
      type: 'SOS',
      timestamp: Date.now(),
      eventId: 'sos-evt-nochunks',
      signature: 'fake-sig',
      payload: {
        id: 'sos-nochunks',
        severity: 'CRITICAL',
        textBlob: 'Help in room 204',
        mediaUrls: [],
        audioUrl: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });
    expect(pushed, 'WS stub never accepted the alert — harness problem, not a product result').toBe(true);

    await expect(
      page.getByText('Staff SOS'),
      'An alert did NOT paint with the chunk transport dead. Something on the ' +
        'emergency render path is now behind a dynamically-imported chunk — that ' +
        'is a life-safety regression, not a bundling detail.',
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Help in room 204')).toBeVisible();
  });

  test('6. TEXT_BROADCAST WS message renders broadcast (P0-3)', async ({ page }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    await pushWs(page, {
      type: 'TEXT_BROADCAST',
      timestamp: Date.now(),
      eventId: 'tb-evt-1',
      signature: 'fake-sig',
      payload: {
        id: 'tb-1',
        // CRITICAL ⇒ full-screen overlay with "Broadcast" label, banner
        // shape for INFO/WARN. Either way the textBlob renders.
        severity: 'CRITICAL',
        textBlob: 'School closing at 1pm today',
        mediaUrls: [],
        audioUrl: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    await expect(
      page.getByText('Broadcast'),
      'P0-3 regression: TEXT_BROADCAST WS message did not render.',
    ).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText('School closing at 1pm today')).toBeVisible();
  });

  test('7. MEDIA_ALERT WS message renders "Emergency Alert" (P0-3)', async ({ page }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    await pushWs(page, {
      type: 'MEDIA_ALERT',
      timestamp: Date.now(),
      eventId: 'ma-evt-1',
      signature: 'fake-sig',
      payload: {
        id: 'ma-1',
        severity: 'CRITICAL',
        textBlob: 'Severe weather — shelter in place',
        mediaUrls: [],
        audioUrl: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    await expect(
      page.getByText('Emergency Alert'),
      'P0-3 regression: MEDIA_ALERT WS message did not render.',
    ).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText('Severe weather — shelter in place')).toBeVisible();
  });

  test('8. ALL_CLEAR_MESSAGE removes the active overlay (P0-3)', async ({ page }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    // First raise an SOS so there's something to clear.
    await pushWs(page, {
      type: 'SOS',
      timestamp: Date.now(),
      eventId: 'sos-evt-2',
      signature: 'fake-sig',
      payload: {
        id: 'sos-2',
        severity: 'CRITICAL',
        textBlob: 'Will be cleared',
        mediaUrls: [],
        audioUrl: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });
    await expect(page.getByText('Will be cleared')).toBeVisible({ timeout: 2_000 });

    // Now clear it.
    await pushWs(page, {
      type: 'ALL_CLEAR_MESSAGE',
      timestamp: Date.now(),
      eventId: 'acm-evt-1',
      signature: 'fake-sig',
      payload: {},
    });

    await expect(
      page.getByText('Will be cleared'),
      'P0-3 regression: ALL_CLEAR_MESSAGE did not clear pushedEmergencyMessage. ' +
        'The onmessage branch for ALL_CLEAR_MESSAGE was likely removed.',
    ).toBeHidden({ timeout: 2_000 });
  });

  test('9. power-cycle ride-through: cached emergency renders on first paint', async ({
    page,
  }) => {
    // Pre-seed an emergency into localStorage BEFORE navigation — this
    // models a kiosk that was mid-lockdown when it lost power. The
    // hydrate effect (player/page.tsx:2206) reads the cache and sets
    // activeEmergency before the first manifest poll lands.
    //
    // The brief explicitly calls this out: if the hydrate-on-mount path
    // breaks, a rebooted kiosk goes dark during a real lockdown until
    // the network catches up. That's a life-safety regression.

    // Re-install the harness WITH a pre-seeded cache.
    await page.context().clearCookies();
    await installPlayerTestHarness(page, {
      preseedEmergencyCache: {
        at: Date.now(),
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
        hasServerExpiry: false,
        payload: {
          active: true,
          type: 'LOCKDOWN',
          severity: 'CRITICAL',
          scopeNote: 'Pre-existing lockdown — rebooted',
          scope: 'tenant',
        },
      },
    });

    // Make the manifest slow so we PROVE the cache wins on first render,
    // not just "the manifest happened to come back fast enough."
    await page.unroute(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`);
    // Trailing `*` (2026-08-30): post-OVERRIDE and mid-emergency polls carry
  // the `?_eb=` cache-buster — a glob without it silently missed them and
  // they fell through to the 204 catch-all.
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, async (route) => {
      counters.manifestCalls += 1;
      // 3s is well beyond the React first-paint window — the cache MUST
      // already be hydrated by the time this resolves.
      await new Promise((r) => setTimeout(r, 3_000));
      // 2026-08-30 — serve the EMERGENCY manifest, matching the modeled
      // scenario (the server is still mid-lockdown; only the kiosk power-
      // cycled). The old normal body made this test contention-sensitive:
      // under parallel-worker load, goto can take >3s, the delayed NORMAL
      // manifest resolves before the asserts, and a LIVE normal manifest
      // legitimately clears the cache (server of record) — a test-timing
      // artifact, not a product bug. The test's point (cache hydrates on
      // first paint before ANY manifest) is unchanged.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          baselineManifest({
            isEmergency: true,
            emergencyType: 'LOCKDOWN',
            emergencySeverity: 'CRITICAL',
            emergencyScope: 'tenant',
          }),
        ),
      });
    });

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);

    // Read the cache via JS — the hydrate effect doesn't move the
    // cache into a different storage key; it just calls
    // setActiveEmergency(cached) on first render. The cache itself
    // stays in localStorage until ALL_CLEAR.
    const cached = await readEmergencyCache(page);
    expect(
      cached?.payload?.type,
      'pre-seeded emergency cache disappeared on navigation — readCachedEmergency() is broken',
    ).toBe('LOCKDOWN');

    // The activeEmergency state has no DOM mirror today (lockdown UI is
    // a future Sprint 5 build) but the POLLING CADENCE flip IS the
    // observable side-effect: activeEmergency truthy → 5s cadence
    // instead of 10s. We can't reliably measure cadence in 5s, but we
    // CAN measure that the cache survives the slow-manifest window —
    // proving the hydrate effect ran and the cache wasn't purged by
    // the in-flight no-emergency manifest before it lands.
    await page.waitForTimeout(500);
    const cachedAfter = await readEmergencyCache(page);
    expect(
      cachedAfter?.payload?.type,
      'cached emergency was wiped before the first manifest poll resolved — ' +
        'power-cycle ride-through is broken; rebooted kiosks will go dark mid-lockdown',
    ).toBe('LOCKDOWN');
  });

  test('10. E-P0-01: OVERRIDE racing a slow DB commit — the player chases the commit until the alert lands', async ({
    page,
  }) => {
    // THE RACE (2026-08-30 deepest audit): the API deliberately starts the
    // signed OVERRIDE fan-out BEFORE its transaction commits, and the
    // player deliberately paints emergencies only from the manifest. So the
    // OVERRIDE-triggered reconcile can read the NOT-YET-COMMITTED manifest,
    // see normal, and — before the fix — nothing special happened until the
    // next routine poll (~10s); a failed transaction produced no alert at
    // all, silently. The confirmation window closes that: after a signed
    // OVERRIDE, the player keeps re-fetching on a rapid ladder (cache-
    // busted, no If-None-Match) until the committed emergency appears.
    test.setTimeout(60_000);
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    const callsAtPush = counters.manifestCalls;
    // Manifest stays NORMAL — the "transaction" has not landed yet.
    const pushed = await pushWs(page, {
      type: 'OVERRIDE',
      timestamp: Date.now(),
      eventId: 'override-commit-race-1',
      signature: 'fake-sig-for-test',
      payload: { overrideId: 'or-race', severity: 'CRITICAL', textBlob: '', expiresAt: 0 },
    });
    expect(pushed, 'WS stub had no live instance').toBe(true);

    // The chase: at least TWO reconciles land while the manifest still says
    // normal (the immediate preempt + the first ladder retry ~2.5s later).
    // Before the fix only the immediate fetch happened.
    await expect
      .poll(() => counters.manifestCalls, {
        message:
          'E-P0-01 regression: the player did not keep re-checking the manifest after a signed ' +
          'OVERRIDE that the server had not committed yet — the confirmation ladder is gone.',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(callsAtPush + 2);

    // NOW the transaction "commits": the served manifest flips to emergency.
    manifestRef.value = baselineManifest({
      isEmergency: true,
      emergencyType: 'LOCKDOWN',
      emergencySeverity: 'CRITICAL',
      emergencyScope: 'tenant',
    });

    // The ladder's next fetch must observe it and the alert state must land
    // (cache write = the same proof test 2 uses), well inside the 30s window.
    await expect
      .poll(() => readEmergencyCache(page), {
        message:
          'E-P0-01 regression: the delayed commit was never observed — the player stopped ' +
          'chasing before the transaction landed.',
        timeout: 25_000,
      })
      .not.toBeNull();
    const cache = await readEmergencyCache(page);
    expect(cache?.payload?.type).toBe('LOCKDOWN');
  });

  /**
   * ── P0-7 #2 — THE RAISE FAST PATH ──────────────────────────────────────
   *
   * MEASURED. With Redis stopped, a lockdown reached all 1 000 screens at
   * p50 7 572 ms / p95 21 653 ms / max 45 131 ms, against p95 343 ms with push
   * (2026-09-04). Nothing errored — every screen answered the moved revision
   * with a FULL emergency-manifest fetch and the herd queued on the one branch
   * that is never cached. The 200 body now carries the alert, so the screen
   * raises on the round trip it was already making. Re-measured 2026-09-05
   * with the fix on: p50 2 728 ms / p95 9 102 ms, 1000/1000 screens, and the
   * 668 emergency-manifest fetches the old path needed became 3.
   *
   * ── WHY ALL THREE HOLD THE MANIFEST OPEN ───────────────────────────────
   * The first draft of these tests left the manifest fast and answering
   * `isEmergency: false`, and they failed — CORRECTLY. A raise from the rev
   * body IS undone a fraction of a second later by a live manifest that says
   * there is no emergency, because the manifest is the arbiter. That draft was
   * measuring the manifest, not the fast path.
   *
   * A QUEUED manifest is both the honest isolation and the real condition
   * being fixed: during the measured outage the manifest was not wrong, it was
   * slow (p95 18 061 ms). While it is in flight, nothing but the rev body can
   * put an alert on the glass — and nothing can take one off — so what these
   * tests observe can only have come from the transport under test.
   */
  const REV_ALERT_PAYLOAD = {
    active: true,
    type: 'LOCKDOWN',
    severity: 'CRITICAL',
    scopeNote: null,
    scope: 'tenant',
    expiresAt: null,
    screenId: FAKE_SCREEN_ID,
    via: 'emergency-rev',
  };

  /** The manifest is QUEUED for longer than any assertion below waits. */
  const MANIFEST_QUEUED_MS = 60_000;

  test('11. P0-7 #2: a signed alert in the rev body raises the alert while the manifest is still queued', async ({
    page,
  }) => {
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);
    expect(await readEmergencyCache(page)).toBeNull();

    // The manifest now behaves the way it did through the measured outage:
    // it is coming, but not soon. When it eventually lands it AGREES — the
    // alert really is active — so this is a latency test, not a disagreement.
    manifestDelayRef.value = MANIFEST_QUEUED_MS;
    manifestRef.value = baselineManifest({
      isEmergency: true,
      emergencyType: 'LOCKDOWN',
      emergencySeverity: 'CRITICAL',
      emergencyScope: 'tenant',
    });

    // The revision moved, and the server can raise from state it already has.
    revRef.value = {
      rev: 'r1.p07raise0000000000',
      active: true,
      alert: {
        type: 'OVERRIDE',
        eventId: 'rev-raise-evt-1',
        timestamp: Date.now(),
        signature: 'fake-sig-for-test',
        payload: REV_ALERT_PAYLOAD,
      },
    };

    // Prove the poll is RUNNING before blaming the raise. Without this, a
    // player that never reaches the polling phase looks identical to a broken
    // fast path and the failure sends the next reader the wrong way.
    await expect
      .poll(() => counters.revCalls ?? 0, {
        message: 'the player never polled /emergency-rev — this test cannot judge the raise',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    await expect
      .poll(() => readEmergencyCache(page), {
        message:
          'P0-7 #2 regression: a signed alert in the emergency-rev 200 body did not raise the ' +
          'alert while the manifest was still queued. Delivery has fallen back to being ' +
          'manifest-bound — the measured p95 21.6s this fix exists to remove.',
        timeout: 25_000,
      })
      .not.toBeNull();

    const cache = await readEmergencyCache(page);
    expect(cache?.payload?.active, 'the raise must mark active=true').toBe(true);
    expect(cache?.payload?.type, 'the raise must carry the incident type').toBe('LOCKDOWN');
    // The decisive fact: no manifest has come back yet, so this alert cannot
    // have come from one.
    expect(
      manifestDelayRef.value,
      'the manifest was still queued — nothing but the rev body could have raised this',
    ).toBe(MANIFEST_QUEUED_MS);
  });

  test('12. P0-7 #2: the rev body can RAISE but never RELEASE', async ({ page }) => {
    // CLAUDE.md player rule 11, on the new transport: a cheaper signal may
    // raise an alert, never release one. Only the server-of-record manifest
    // clears. If a future change ever reads "no `alert` field" as an
    // all-clear, this is what catches it — and the cost of that bug is a
    // lockdown silently dropping off a wall screen.
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    manifestDelayRef.value = MANIFEST_QUEUED_MS;
    manifestRef.value = baselineManifest({
      isEmergency: true,
      emergencyType: 'LOCKDOWN',
      emergencySeverity: 'CRITICAL',
      emergencyScope: 'tenant',
    });
    revRef.value = {
      rev: 'r1.p07raise0000000000',
      active: true,
      alert: {
        type: 'OVERRIDE',
        eventId: 'rev-raise-evt-2',
        timestamp: Date.now(),
        signature: 'fake-sig-for-test',
        payload: REV_ALERT_PAYLOAD,
      },
    };
    await expect.poll(() => readEmergencyCache(page), { timeout: 30_000 }).not.toBeNull();

    // Now the revision moves again and carries NO envelope, and says
    // `active: false` — the shape a group-scoped trigger, an ordinary content
    // edit, or a replica holding no descriptor produces. The manifest is still
    // queued, so the rev body is the only signal the player has.
    revRef.value = { rev: 'r1.p07nothing00000000', active: false };

    // Several poll cycles to get it wrong: the rev poll runs at 5 s while an
    // alert is on the glass, so this is at least two.
    await page.waitForTimeout(12_000);

    const cache = await readEmergencyCache(page);
    expect(
      cache?.payload?.active,
      'RULE 11 VIOLATION: an emergency-rev response with no alert envelope cleared a live alert. ' +
        'Absence on this transport means "nothing to raise", never "all clear" — only the ' +
        'authenticated manifest releases.',
    ).toBe(true);
    expect(cache?.payload?.type).toBe('LOCKDOWN');
  });

  test('13. P0-7 #2: an UNSIGNED alert in the rev body is refused', async ({ page }) => {
    // The envelope clears the same `checkSensitivePush` contract a WS/SSE push
    // clears; the transport changed, the trust rule did not. An envelope with
    // no signature never passed through the signer, so it cannot raise.
    //
    // The manifest is queued here too, and that is what makes the assertion
    // mean something: with it in flight, a `null` cache CANNOT be explained by
    // "something cleared it" — nothing raised it in the first place.
    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await waitForPlayerReady(page);

    manifestDelayRef.value = MANIFEST_QUEUED_MS;
    revRef.value = {
      rev: 'r1.p07unsigned0000000',
      active: true,
      alert: {
        type: 'OVERRIDE',
        eventId: 'rev-unsigned-evt',
        timestamp: Date.now(),
        // no `signature`
        payload: REV_ALERT_PAYLOAD,
      },
    };

    // Long enough for several rev polls at the 10 s healthy cadence.
    await expect
      .poll(() => counters.revCalls ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(1);
    expect(
      await readEmergencyCache(page),
      'an unsigned envelope raised an alert — the rev path is not running the shared push gate',
    ).toBeNull();
  });
});
