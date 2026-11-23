import { test, expect, type Page, type Request, type Route } from '@playwright/test';

/**
 * BROWSER ERROR REPORTING STARTS (2026-11-23, launch audit LIV-03 / OPS-04 /
 * PLW-02 / SSC-06).
 *
 * The browser Sentry SDK is initialised from `src/instrumentation-client.ts`,
 * the file Next runs on every page before hydration. This spec proves it on a
 * production build, for an operator page (`/login`) and for the screen
 * (`/player`):
 *
 *   - built WITH `NEXT_PUBLIC_SENTRY_DSN` (set the same value for the build
 *     and for this run, like `NEXT_PUBLIC_API_URL`): a deliberate uncaught
 *     error reaches the DSN's ingest host as an `event` envelope, intercepted
 *     here with `route()` so nothing leaves the machine. On `/player` no
 *     session or transaction envelope is sent and no API request carries a
 *     `sentry-trace` / `baggage` header: the screen's own traffic is unchanged.
 *   - built WITHOUT it (CI's builds): the SDK stays off, the page logs the one
 *     "not set" warning, and nothing is sent to any Sentry host.
 *
 * Either way the assertion fails if the init is not wired into the bundle.
 */

const BUILD_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || '';
const PROBE = 'venueos-sentry-e2e-probe';
const NOT_SET_WARNING = '[sentry] NEXT_PUBLIC_SENTRY_DSN not set';
const SENTRY_HOST_RE = /^https:\/\/[^/]*sentry\.io\//;

type EnvelopeItem = { type: string; payload: unknown };

/** Split a Sentry envelope (newline-delimited JSON) into its items. */
function parseEnvelope(body: string): EnvelopeItem[] {
  const lines = body.split('\n').filter((l) => l.trim() !== '');
  const items: EnvelopeItem[] = [];
  // Line 0 is the envelope header; then item header / payload pairs.
  for (let i = 1; i + 1 < lines.length; i += 2) {
    let header: { type?: string } = {};
    let payload: unknown = null;
    try { header = JSON.parse(lines[i]); } catch { /* not JSON */ }
    try { payload = JSON.parse(lines[i + 1]); } catch { payload = lines[i + 1]; }
    items.push({ type: String(header.type ?? ''), payload });
  }
  return items;
}

function eventHasProbe(item: EnvelopeItem): boolean {
  if (item.type !== 'event') return false;
  return JSON.stringify(item.payload).includes(PROBE);
}

async function installApiMocks(page: Page) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  const handler = async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/screens/register') {
      // An unpaired screen: the splash with a pairing code.
      return json(route, { screenId: 'test-screen-sentry-probe', paired: false, pairingCode: 'SNT123' });
    }
    return json(route, {});
  };
  await page.route(/http:\/\/api\.invalid\/.*/, handler);
  await page.route('**/api/v1/**', handler);
}

type Capture = {
  items: EnvelopeItem[];
  sentryRequests: string[];
  tracedRequests: string[];
  warnings: string[];
};

async function capture(page: Page): Promise<Capture> {
  const c: Capture = { items: [], sentryRequests: [], tracedRequests: [], warnings: [] };
  await page.route(SENTRY_HOST_RE, async (route) => {
    c.sentryRequests.push(route.request().url());
    c.items.push(...parseEnvelope(route.request().postData() || ''));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  page.on('request', (req: Request) => {
    if (SENTRY_HOST_RE.test(req.url())) return;
    const h = req.headers();
    if (h['sentry-trace'] || h['baggage']) c.tracedRequests.push(req.url());
  });
  page.on('console', (msg) => {
    if (msg.text().includes(NOT_SET_WARNING)) c.warnings.push(msg.text());
  });
  return c;
}

/**
 * The runtime surface of a Chromium-83 WebView (NovaStar Taurus): every
 * builtin that shipped later is deleted before the first page script. Same
 * list as player-chromium83-shim.spec.ts, plus WeakRef / FinalizationRegistry
 * (84), which the SDK feature-detects.
 */
async function stripPost83Apis(page: Page) {
  await page.addInitScript(() => {
    const kill = (o: object | undefined, k: string) => {
      try {
        const r = o as Record<string, unknown> | undefined;
        if (r && k in r) { delete r[k]; if (k in r) r[k] = undefined; }
      } catch { /* ignore */ }
    };
    kill(Object, 'hasOwn');
    kill(Object, 'groupBy');
    kill(Array.prototype, 'at');
    kill(String.prototype, 'at');
    kill(Array.prototype, 'findLast');
    kill(Array.prototype, 'findLastIndex');
    kill(Array.prototype, 'toSorted');
    kill(Array.prototype, 'toReversed');
    kill(Array.prototype, 'with');
    kill(String.prototype, 'replaceAll');
    kill(Promise, 'any');
    kill(Promise, 'withResolvers');
    kill(URL, 'canParse');
    kill(window, 'structuredClone');
    kill(window, 'reportError');
    kill(window, 'WeakRef');
    kill(window, 'FinalizationRegistry');
    kill(Element.prototype, 'replaceChildren');
    kill(AbortSignal, 'timeout');
    kill(AbortSignal, 'any');
    try { kill(crypto, 'randomUUID'); } catch { /* ignore */ }
  });
}

async function throwProbe(page: Page) {
  await page.evaluate((message) => {
    setTimeout(() => {
      throw new Error(message);
    }, 0);
  }, PROBE);
}

for (const target of [
  { name: 'an operator page', path: '/login', screen: false, post83: false },
  { name: 'the screen', path: '/player', screen: true, post83: false },
  { name: 'the screen on a Chromium-83 runtime', path: '/player', screen: true, post83: true },
]) {
  test(`browser Sentry reports a client error on ${target.name} (${target.path})`, async ({ page }) => {
    if (target.post83) await stripPost83Apis(page);
    await installApiMocks(page);
    const c = await capture(page);

    await page.goto(target.path, { waitUntil: 'load' });
    // Let hydration and the first boot requests settle before the probe.
    await page.waitForTimeout(1_500);
    await throwProbe(page);

    if (BUILD_DSN) {
      await expect
        .poll(() => c.items.some(eventHasProbe), { timeout: 15_000, message: 'no event envelope reached the DSN host' })
        .toBe(true);
      expect(c.warnings, 'a configured DSN logs no "not set" warning').toEqual([]);
      const ingestHost = new URL(BUILD_DSN).host;
      for (const u of c.sentryRequests) expect(new URL(u).host).toBe(ingestHost);

      if (target.screen) {
        // Give a session or pageload envelope time to show up if one were sent.
        await page.waitForTimeout(2_500);
        const types = c.items.map((i) => i.type);
        expect(types, 'the screen sends no release-health session').not.toContain('session');
        expect(types, 'the screen sends no tracing transaction').not.toContain('transaction');
        expect(types, 'the screen sends no client report').not.toContain('client_report');
        expect(c.tracedRequests, 'the screen adds no trace headers to its own requests').toEqual([]);
      }
    } else {
      await page.waitForTimeout(2_500);
      expect(c.warnings, 'with no DSN the page logs exactly one "not set" warning').toHaveLength(1);
      expect(c.sentryRequests, 'with no DSN nothing is sent to Sentry').toEqual([]);
    }
  });
}
