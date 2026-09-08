/**
 * Playwright globalSetup — prove the heavy routes actually SERVE, once,
 * before any browser starts.
 *
 * ── HISTORY, because the shape of this file only makes sense with it ─────
 *
 * 2026-08-04: `next dev` compiles a route on its FIRST request. `/player` is
 * the heaviest route in the app, so every spec that cold-booted it paid that
 * compile inside its own per-test budget, and the first test to arrive lost a
 * race it was never given time to win. It looked exactly like a
 * browser-specific product bug, because chromium and webkit run as separate
 * CI jobs: whichever hit a warm server passed. Two earlier attempts failed —
 * raising the per-test manifest budget (helped chromium, not webkit) and a
 * `test.beforeAll` warm-up using the `browser` fixture (torn down around the
 * hook under retries: "Target page, context or browser has been closed"). A
 * plain HTTP GET before any browser exists was the fix, with a deliberately
 * huge 180 s budget because the compile was the thing being waited on.
 *
 * 2026-09-05: the server is now PREBUILT (`next build` → `next start`; see
 * playwright.config.ts and tests/e2e-webserver.cjs). There is no on-demand
 * compilation left to wait for — the same /board request that could not
 * finish in 180 s under `next dev` on a 2-vCPU / 7 GB runner returns in under
 * a second from a built bundle. So this file keeps its job but loses its
 * reason to be patient: it is now a READINESS + SSR-SANITY probe, not a
 * compile barrier. The 180 s budget is gone, and with it the 6 minutes of
 * dead wall-clock two failing warms used to burn out of a 15-minute job.
 *
 * Still deliberately NEVER FAILS the run. If a route does not answer, the
 * specs still execute and fail with their own honest assertions; a warm-up
 * that can red the suite on its own would just move the flake rather than
 * remove it. It DOES now say plainly when a route came back non-OK, because
 * against a prebuilt server that is a real signal rather than a slow compile.
 */
const ROUTES = [
  '/player?fp=globalsetup-warm',
  // board-live-update.spec.ts (Phase-2 E2E gate, 2026-08-10) cold-boots the
  // public /board/[gameId] route — 4.5k lines + the sport widget graph. The
  // gameId is fake on purpose: the page is a client component, so the GET
  // returns the SSR shell (the data poll only ever runs in a browser).
  '/board/globalsetup-warm-000000000000',
];

// A prebuilt route answers in ~1 s. 45 s is pure headroom for a loaded
// runner, and it is short enough that two failures cost 90 s, not 6 minutes.
const BUDGET_MS = 45_000;
const PER_REQUEST_MS = 20_000;
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

async function warm(path: string): Promise<void> {
  const url = `${BASE}${path}`;
  const deadline = Date.now() + BUDGET_MS;
  let attempt = 0;
  let lastErr: unknown = null;

  while (Date.now() < deadline) {
    attempt++;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(PER_REQUEST_MS, deadline - Date.now())),
      });
      if (res.ok) {
        await res.text(); // drain, so the response is fully delivered
        // eslint-disable-next-line no-console
        console.log(`[global-setup] warmed ${path} in ${Date.now() - started}ms (attempt ${attempt})`);
        return;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err; // server not up yet — retry
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[global-setup] ${path} did NOT answer OK within ${BUDGET_MS}ms ` +
      `(last: ${String(lastErr).slice(0, 160)}). The server is PREBUILT, so this is a real ` +
      `route/SSR failure rather than a slow compile — expect the specs that use it to fail. ` +
      `Continuing so they report it themselves.`,
  );
}

export default async function globalSetup(): Promise<void> {
  for (const r of ROUTES) await warm(r);
}
