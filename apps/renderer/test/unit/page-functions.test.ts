/**
 * Functions that run INSIDE the board are serialised with Function#toString
 * and evaluated with no module scope. A compiler helper (__awaiter, __name…)
 * or a reference to a module-level binding would compile fine here and throw
 * a ReferenceError in the page — only the integration suite would notice, and
 * only with a browser. These checks catch it without one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurePage } from '../../src/page/measure.js';
import { hideTextInk } from '../../src/page/backplate.js';
import { preloadSource, toPreloadFaces } from '../../src/page/preload.js';
import { substituteFaces } from '../../src/fonts/google-css.js';
import { testCatalog } from '../helpers/server.js';

const HELPERS = /\b(__awaiter|__generator|__rest|__spreadArray|__assign|__name|__classPrivateField\w*|_interopRequire\w*|require\()/;

for (const [name, fn] of [
  ['measurePage', measurePage],
  ['hideTextInk', hideTextInk],
] as const) {
  test(`${name} serialises to a self-contained function`, () => {
    const src = fn.toString();
    assert.doesNotMatch(src, HELPERS, 'compiler helpers leak into the page');
    assert.doesNotMatch(src, /\bimport\s*\(|\bimport\s+/, 'no imports inside a page function');
    // It must compile on its own, the way Puppeteer ships it.
    const compiled = new Function(`return (${src});`)();
    assert.equal(typeof compiled, 'function');
  });
}

test('the preload script is valid JavaScript, keyed, and carries the look-alike faces', () => {
  const faces = toPreloadFaces(substituteFaces(testCatalog()));
  const src = preloadSource('__vosr_test', faces);
  assert.doesNotThrow(() => new Function(src));
  assert.match(src, /__vosr_test/);
  assert.match(src, /"family":"Impact"/);
  assert.ok(faces.length > 20);
  // Hooks are read-only and non-enumerable: the board cannot find or swap them.
  assert.match(src, /enumerable: false, configurable: false, writable: false/);
});
