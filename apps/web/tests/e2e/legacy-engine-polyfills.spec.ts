/**
 * The APK's legacy-engine compatibility layer, in a real browser.
 *
 * Field case: a Metabase 0.64 dashboard logs in on Android 14 panels and
 * shows "failed" on a frozen Android 11 panel whose system WebView is 95 —
 * its bundle calls builtins Chrome 95 lacks. The site forbids framing and
 * its CSP forbids inline script, so the APK registers the asset
 * `apps/player/app/src/main/assets/legacy-engine-polyfills.js` as a
 * document-start script on the WebView.
 *
 * Here: a locally served, Metabase-like "login" page (its own CSP with no
 * `unsafe-inline`, `frame-ancestors 'none'`, X-Frame-Options DENY) whose
 * bundle uses each API. `addInitScript` stands in for
 * `addDocumentStartJavaScript` (both run before page script, outside CSP).
 * A first init script removes the builtins to make an "engine 95".
 *
 *  1. negative control — engine 95, no layer: the login fails;
 *  2. engine 95 + the layer: the login succeeds, and the page's CSP is
 *     still enforced (its inline script stays blocked);
 *  3. a modern engine + the layer: every builtin is still the engine's own.
 *
 * Self-contained: every request is served by page.route; the Next server is
 * not used.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const POLYFILL = fs.readFileSync(
  path.resolve(__dirname, '../../../player/app/src/main/assets/legacy-engine-polyfills.js'),
  'utf8',
);
const ORIGIN = 'https://dashboard.example.test';

/** Everything the layer supplies, removed — what a Chrome 95 engine looks like to the page. */
const MAKE_ENGINE_95 = `(() => {
  const TA = Object.getPrototypeOf(Int8Array.prototype);
  const IP = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  const drop = (o, keys) => { if (o) for (const k of keys) { try { delete o[k]; } catch (e) {} } };
  drop(Object, ['hasOwn', 'groupBy']);
  drop(Map, ['groupBy']);
  drop(Array, ['fromAsync']);
  drop(Array.prototype, ['at', 'findLast', 'findLastIndex', 'toReversed', 'toSorted', 'toSpliced', 'with']);
  drop(TA, ['at', 'findLast', 'findLastIndex', 'toReversed', 'toSorted', 'with']);
  drop(String.prototype, ['at', 'isWellFormed', 'toWellFormed']);
  drop(Promise, ['withResolvers', 'try']);
  drop(Set.prototype, ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']);
  drop(IP, ['map', 'filter', 'take', 'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find', 'constructor']);
  drop(globalThis, ['Iterator', 'structuredClone']);
  drop(typeof Crypto === 'function' ? Crypto.prototype : null, ['randomUUID']);
  drop(AbortSignal, ['timeout', 'any']);
  drop(AbortSignal.prototype, ['throwIfAborted']);
  drop(URL, ['canParse', 'parse']);
  drop(ReadableStream.prototype, [Symbol.asyncIterator, 'values']);
  window.__engine95 = typeof Array.prototype.findLast === 'undefined' && typeof structuredClone === 'undefined';
})();`;

/** The "Metabase-like" bundle: the login runs only if every API it touches works. */
const BUNDLE = `
(async () => {
  const out = document.getElementById('status');
  const failures = [];
  const check = async (name, fn) => { try { if (!(await fn())) failures.push(name); } catch (e) { failures.push(name + ': ' + e.message); } };
  await check('Object.hasOwn', () => Object.hasOwn({ a: 1 }, 'a'));
  await check('Array.at', () => [1, 2, 3].at(-1) === 3);
  await check('String.at', () => 'abc'.at(-1) === 'c');
  await check('TypedArray.at', () => new Uint8Array([4, 5]).at(-1) === 5);
  await check('findLast', () => [1, 2, 3].findLast((x) => x < 3) === 2 && [1, 2].findLastIndex((x) => x > 5) === -1);
  await check('toSorted/toReversed/toSpliced/with', () => {
    const a = [3, 1, 2];
    return a.toSorted().join() === '1,2,3' && a.toReversed().join() === '2,1,3' &&
      a.toSpliced(0, 1).join() === '1,2' && a.with(0, 9).join() === '9,1,2' && a.join() === '3,1,2';
  });
  await check('structuredClone', () => { const o = { d: new Date(1), m: new Map([[1, 2]]) }; const c = structuredClone(o); return c !== o && c.m.get(1) === 2 && c.d.getTime() === 1; });
  await check('Object.groupBy', () => Object.groupBy([1, 2, 3], (x) => (x % 2 ? 'odd' : 'even')).odd.length === 2);
  await check('Map.groupBy', () => Map.groupBy([1, 2, 3], (x) => x % 2).get(1).length === 2);
  await check('crypto.randomUUID', () => /^[0-9a-f-]{36}$/.test(crypto.randomUUID()));
  await check('Promise.withResolvers', async () => { const r = Promise.withResolvers(); r.resolve(1); return (await r.promise) === 1; });
  await check('Promise.try', async () => (await Promise.try(() => 2)) === 2);
  await check('Set methods', () => new Set([1, 2]).union(new Set([3])).size === 3 && new Set([1]).isSubsetOf(new Set([1, 2])));
  await check('Iterator helpers', () => [1, 2, 3].values().map((x) => x * 2).filter((x) => x > 2).toArray().join() === '4,6');
  await check('Array.fromAsync', async () => (await Array.fromAsync([Promise.resolve(1), 2])).join() === '1,2');
  await check('AbortSignal.timeout/any', async () => {
    const s = AbortSignal.any([AbortSignal.timeout(10)]);
    await new Promise((r) => setTimeout(r, 60));
    return s.aborted && s.reason.name === 'TimeoutError';
  });
  await check('AbortSignal.throwIfAborted', () => { try { AbortSignal.abort('x').throwIfAborted(); return false; } catch (e) { return e === 'x'; } });
  await check('URL.canParse', () => URL.canParse('/x', '${ORIGIN}') && URL.parse('nope') === null);
  await check('isWellFormed', () => 'a'.isWellFormed() && '\\uD800'.toWellFormed() === '\\uFFFD');
  await check('ReadableStream for-await', async () => {
    const res = new Response('chunk');
    let n = 0; for await (const c of res.body) n += c.length;
    return n === 5;
  });
  // The "login" itself: a session request whose body is built with the APIs above.
  const session = await fetch('/api/session', { method: 'POST', body: JSON.stringify({ id: failures.length ? null : crypto.randomUUID?.() }) }).then((r) => r.json());
  out.textContent = failures.length === 0 && session.ok ? 'Login succeeded' : 'Login failed: ' + failures.join(' | ');
  out.dataset.done = '1';
})().catch((e) => { const out = document.getElementById('status'); out.textContent = 'Login failed: ' + e.message; out.dataset.done = '1'; });
`;

async function serveDashboard(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const strict = {
      'content-security-policy': "default-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
    };
    if (url.pathname === '/app.js') {
      return route.fulfill({ status: 200, headers: { ...strict, 'content-type': 'application/javascript' }, body: BUNDLE });
    }
    if (url.pathname === '/api/session') {
      const body = route.request().postDataJSON() as { id: string | null };
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: !!body.id }) });
    }
    return route.fulfill({
      status: 200,
      headers: { ...strict, 'content-type': 'text/html' },
      body: `<!doctype html><html><head><title>Sign in</title></head><body>
        <p id="status">Signing in…</p><p id="inline">inline script blocked</p>
        <script>document.getElementById('inline').textContent = 'inline script RAN';</script>
        <script src="/app.js"></script></body></html>`,
    });
  });
}

async function login(page: Page) {
  await serveDashboard(page);
  await page.goto(`${ORIGIN}/auth/login`);
  await expect(page.locator('#status[data-done="1"]')).toBeVisible({ timeout: 10_000 });
  return (await page.locator('#status').textContent()) ?? '';
}

test.describe('legacy-engine compatibility layer', () => {
  test('negative control: on an engine-95 page without the layer, the login fails', async ({ page }) => {
    await page.addInitScript(MAKE_ENGINE_95);
    const status = await login(page);
    expect(await page.evaluate(() => (window as unknown as { __engine95: boolean }).__engine95)).toBe(true);
    expect(status).toContain('Login failed');
    expect(status).toContain('findLast');
    expect(status).toContain('structuredClone');
  });

  test('on an engine-95 page with the layer at document start, the login succeeds and the page CSP still holds', async ({ page }) => {
    await page.addInitScript(MAKE_ENGINE_95);
    await page.addInitScript(POLYFILL);
    const status = await login(page);
    expect(await page.evaluate(() => (window as unknown as { __engine95: boolean }).__engine95)).toBe(true);
    expect(status).toBe('Login succeeded');
    await expect(page.locator('#inline')).toHaveText('inline script blocked');
  });

  test('on a modern engine the layer changes nothing: every builtin stays the engine’s own', async ({ page }) => {
    await serveDashboard(page);
    const probe = () => {
      const TA = Object.getPrototypeOf(Int8Array.prototype);
      const IP = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
      const g = globalThis as unknown as Record<string, unknown>;
      const pick: Array<[string, unknown]> = [
        ['Object.hasOwn', Object.hasOwn], ['Array.at', Array.prototype.at], ['TA.at', TA.at],
        ['Array.findLast', Array.prototype.findLast], ['Array.toSorted', (Array.prototype as unknown as Record<string, unknown>).toSorted],
        ['Array.with', (Array.prototype as unknown as Record<string, unknown>).with], ['String.at', String.prototype.at],
        ['structuredClone', g.structuredClone], ['crypto.randomUUID', crypto.randomUUID],
        ['AbortSignal.timeout', AbortSignal.timeout], ['AbortSignal.any', (AbortSignal as unknown as Record<string, unknown>).any],
        ['Promise.withResolvers', (Promise as unknown as Record<string, unknown>).withResolvers],
        ['Object.groupBy', (Object as unknown as Record<string, unknown>).groupBy],
        ['Set.union', (Set.prototype as unknown as Record<string, unknown>).union], ['Iterator.map', IP.map],
        ['Array.fromAsync', (Array as unknown as Record<string, unknown>).fromAsync],
        ['URL.canParse', (URL as unknown as Record<string, unknown>).canParse],
        ['ReadableStream.asyncIterator', (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator]],
        ['AbortController.abort', AbortController.prototype.abort],
      ];
      return pick.map(([name, fn]) => {
        if (typeof fn !== 'function') return `${name}:absent`;
        return `${name}:${/\[native code\]/.test(Function.prototype.toString.call(fn)) ? 'native' : 'POLYFILLED'}`;
      });
    };
    await page.goto(`${ORIGIN}/auth/login`);
    const bare = await page.evaluate(probe);
    await page.addInitScript(POLYFILL);
    await page.reload();
    const withLayer = await page.evaluate(probe);
    // Whatever this engine ships natively stays native; only an API this
    // engine genuinely lacks may be supplied.
    bare.forEach((line, i) => {
      if (line.endsWith(':native')) expect(withLayer[i]).toBe(line);
    });
  });
});
