/**
 * Chrome-66 boot (Android-9 Goodview LCDs, 2026-09-02). The real proof is
 * the Chromium-68 harness described in legacyPolyfills.ts; these pin the
 * three things a refactor could silently break: the UA gate, the placement
 * (FIRST child of <head>, ahead of every async chunk), and that the ES5 body
 * parses and runs its `globalThis`-missing branch.
 */

import {
  LEGACY_POLYFILL_MARKER,
  LEGACY_POLYFILLS_JS,
  injectLegacyPolyfills,
  needsLegacyPolyfills,
} from '../legacyPolyfills';

const GOODVIEW_UA =
  'Mozilla/5.0 (Linux; Android 9; rk3399_all Build/PQ3A.190705.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.158 Safari/537.36';
const TAURUS_UA =
  'Mozilla/5.0 (Linux; Android 11; rk356x_box Build/RQ3A.210805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.106 Safari/537.36';

describe('needsLegacyPolyfills', () => {
  it.each([
    [GOODVIEW_UA, true],
    ['Chrome/70.0.3538.77', true],
    ['Chrome/71.0.3578.98', false],
    [TAURUS_UA, false],
    ['Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', false],
    ['Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/128.0', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (ua, expected) => {
    expect(needsLegacyPolyfills(ua as string | null | undefined)).toBe(expected);
  });
});

describe('injectLegacyPolyfills', () => {
  const doc =
    '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><script src="/_next/static/chunks/a.js" async=""></script></head><body><script data-edu-shim="chromium83">1</script></body></html>';

  it('lands as the first child of <head>, before the first chunk tag', () => {
    const out = injectLegacyPolyfills(doc);
    const marker = out.indexOf(LEGACY_POLYFILL_MARKER);
    expect(marker).toBeGreaterThan(0);
    expect(marker).toBeLessThan(out.indexOf('/_next/static/chunks/a.js'));
    expect(out.indexOf('<head>') + '<head>'.length).toBe(marker - '<script '.length);
  });

  it('is idempotent', () => {
    const once = injectLegacyPolyfills(doc);
    expect(injectLegacyPolyfills(once)).toBe(once);
  });

  it('still precedes the first script when a document has no <head>', () => {
    const out = injectLegacyPolyfills('<html><script src="/x.js"></script></html>');
    expect(out.indexOf(LEGACY_POLYFILL_MARKER)).toBeLessThan(out.indexOf('/x.js'));
  });
});

describe('LEGACY_POLYFILLS_JS', () => {
  it('is ES5 with nothing a template literal could eat', () => {
    expect(LEGACY_POLYFILLS_JS).not.toMatch(/[`\\]|\$\{|=>|\blet\b|\bconst\b/);
  });

  it('parses, and takes the globalThis-missing branch without throwing', () => {
    const fakeWindow: Record<string, unknown> = {};
    // Shadow `globalThis` as undefined so the polyfill's Object.prototype
    // getter trick runs; it resolves the real global through the bare
    // identifier and (re)assigns its own `globalThis` — a no-op here.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const run = new Function('globalThis', 'window', LEGACY_POLYFILLS_JS);
    expect(() => run(undefined, fakeWindow)).not.toThrow();
    expect(Object.prototype).not.toHaveProperty('__venueos_gt__');
    expect(typeof fakeWindow.WeakRef).toBe('function');
  });
});
