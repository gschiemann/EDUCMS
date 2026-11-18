/**
 * The pure parts of the picomatch waiver's proof (scripts/check-picomatch-unreachable.cjs).
 * The closure walk itself needs node_modules and runs inside the gate; what is
 * pinned here is the import detector, because a detector that matches nothing
 * would make claim 3 ("no first-party file imports a glob matcher") vacuous.
 *
 *   node --test scripts/__tests__/check-picomatch-unreachable.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { MATCHER_IMPORT, ALLOWED_IMPORTERS, ALLOWED_ROOTS, ALLOWED_PARENTS } = require('../check-picomatch-unreachable.cjs');

test('the detector sees every way a file can load a glob matcher', () => {
  for (const line of [
    "import picomatch from 'picomatch';",
    'import pm from "picomatch";',
    "import { isMatch } from 'micromatch';",
    "const mm = require('minimatch');",
    'const { glob } = require( "glob" );',
    "const fg = await import('fast-glob');",
    "import posix from 'picomatch/posix';",
    "export { globby } from 'globby';",
    "import chokidar from 'chokidar';",
    "import { glob } from 'tinyglobby';",
    "import anymatch from 'anymatch';",
  ]) {
    assert.ok(MATCHER_IMPORT.test(line), line);
  }
});

test('the detector is not set off by look-alikes', () => {
  for (const line of [
    "import globals from 'globals';",
    "import agent from 'global-agent';",
    "import { glob } from './glob';",
    "import x from 'minimatch-like';",
    "const s = 'picomatch is mentioned in a string';",
    "// see picomatch for the syntax",
    "import y from '@scope/picomatch-wrapper';",
  ]) {
    assert.equal(MATCHER_IMPORT.test(line), false, line);
  }
});

test('the reviewed lists are the ones the decision record names', () => {
  assert.deepEqual([...ALLOWED_IMPORTERS], ['web']);
  assert.deepEqual([...ALLOWED_ROOTS].sort(), ['@sentry/nextjs', 'next-intl']);
  assert.deepEqual([...ALLOWED_PARENTS].sort(), ['@parcel/watcher', '@rollup/plugin-commonjs', '@rollup/pluginutils', 'fdir']);
});
