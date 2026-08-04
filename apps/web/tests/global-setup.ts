/**
 * Playwright globalSetup — compile the heavy routes ONCE, before any test.
 *
 * WHY (2026-08-04): `next dev` compiles a route on its FIRST request. `/player`
 * is the heaviest route in the app (~12s cold on a developer laptop, materially
 * slower on a loaded CI runner). Every spec that cold-boots the player was
 * therefore paying that compile inside its own per-test budget, and the first
 * test to arrive lost a race it was never given time to win.
 *
 * The symptom looked exactly like a browser-specific product bug: chromium and
 * webkit run as SEPARATE CI jobs, so whichever job happened to hit an already-warm
 * server passed while the other went red. On 2026-08-03/04 the Emergency Path
 * gate — a life-safety gate — failed on webkit ONLY, with chromium failing just
 * test #1 and then recovering. The spec passes 9/9 on webkit locally against a
 * warm server.
 *
 * TWO EARLIER ATTEMPTS AND WHY THIS ONE IS DIFFERENT:
 *   1. Raising the per-test manifest budget (10s -> 45s). Helped chromium,
 *      did not save webkit — the compile plus webkit's slower boot still
 *      exceeded it under CI load.
 *   2. A `test.beforeAll` warm-up using the `browser` fixture. REVERTED: in a
 *      suite with retries the browser fixture is torn down around the hook, so
 *      every attempt died on `browser.newPage: Target page, context or browser
 *      has been closed`. It became a second failure source on top of the first.
 *
 * This runs BEFORE any browser exists and needs none — a plain HTTP GET is all
 * it takes to make Next compile the route. No fixtures, nothing to tear down,
 * and it warms the server once for every project rather than once per spec.
 *
 * Deliberately NEVER FAILS the run. If warming does not succeed the tests still
 * execute and fail with their own honest assertions; a warm-up that can red the
 * suite on its own would just move the flake rather than remove it.
 */
const ROUTES = ['/player?fp=globalsetup-warm'];
const BUDGET_MS = 180_000;
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
      // A long per-request timeout is the point: the FIRST request is the one
      // that pays the compile, and aborting it early would throw that work away
      // and start over.
      const res = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(120_000, deadline - Date.now())),
      });
      if (res.ok) {
        await res.text(); // drain, so the compile is fully finished
        // eslint-disable-next-line no-console
        console.log(`[global-setup] warmed ${path} in ${Date.now() - started}ms (attempt ${attempt})`);
        return;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err; // server not up yet, or still compiling — retry
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[global-setup] could NOT warm ${path} within ${BUDGET_MS}ms ` +
      `(last: ${String(lastErr).slice(0, 160)}). Continuing — tests will report their own failures.`,
  );
}

export default async function globalSetup(): Promise<void> {
  for (const r of ROUTES) await warm(r);
}
