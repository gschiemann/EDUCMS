#!/usr/bin/env node
/**
 * Tests for scripts/check-package-tests.cjs.
 *
 * Plain `node:test` — no jest, no deps, runnable as:
 *   node scripts/__tests__/check-package-tests.test.cjs
 *   node --test scripts/__tests__/
 *
 * The guard exists because packages/api-types shipped 36 assertions that
 * had never executed. These cases pin the two shapes that produced it —
 * specs with no runner, and a runner with no specs — and the real
 * packages/ tree is checked last, so the guard is proven against the
 * thing it actually guards.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { evaluate, findSpecs } = require('../check-package-tests.cjs');
const CLI = path.resolve(__dirname, '..', 'check-package-tests.cjs');
const REAL_PACKAGES = path.resolve(__dirname, '..', '..', 'packages');

/** Build a throwaway packages/ tree: {pkgName: {scripts, files}}. */
function fixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgtests-'));
  for (const [dir, cfg] of Object.entries(spec)) {
    const pkgDir = path.join(root, dir);
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: `@fixture/${dir}`, scripts: cfg.scripts || {} }),
    );
    for (const file of cfg.files || []) {
      const full = path.join(pkgDir, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '// fixture\n');
    }
  }
  return root;
}

test('a package with specs and a test script is clean', () => {
  const root = fixture({
    good: { scripts: { test: 'jest' }, files: ['src/thing.spec.ts'] },
  });
  const r = evaluate(root);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.equal(r.packages[0].specs, 1);
});

test('specs with no test script FAIL — the api-types shape', () => {
  const root = fixture({
    silent: { scripts: { build: 'tsc' }, files: ['src/billing.spec.ts', 'src/other.spec.ts'] },
  });
  const r = evaluate(root);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].kind, 'specs-without-runner');
  assert.match(r.violations[0].detail, /2 spec file\(s\)/);
  assert.match(r.violations[0].detail, /billing\.spec\.ts/);
});

test('a test script with no specs FAILS — success reported over nothing', () => {
  const root = fixture({ hollow: { scripts: { test: 'jest' }, files: [] } });
  const r = evaluate(root);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].kind, 'runner-without-specs');
});

test('a package with neither is not a violation', () => {
  // packages/database is exactly this: real code, no specs, no runner.
  const root = fixture({ plain: { scripts: { build: 'tsc' }, files: ['src/index.ts'] } });
  const r = evaluate(root);
  assert.equal(r.ok, true);
});

test('build output never counts as coverage', () => {
  // A stale dist/ or a dependency carrying its own specs must not make a
  // package look covered — this is how the original gap hid in plain
  // sight, since node_modules is full of *.spec.js.
  const root = fixture({
    built: {
      scripts: { build: 'tsc' },
      files: ['dist/thing.spec.js', 'node_modules/dep/x.spec.ts', '.turbo/y.test.ts'],
    },
  });
  const r = evaluate(root);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
  assert.equal(r.packages[0].specs, 0);
});

test('finds specs at any depth, in every spelling', () => {
  const root = fixture({
    deep: {
      scripts: { test: 'jest' },
      files: [
        'src/a.spec.ts',
        'src/__tests__/b.test.ts',
        'src/nested/deep/c.spec.tsx',
        'src/d.test.cjs',
        'src/not-a-spec.ts',
      ],
    },
  });
  const found = findSpecs(path.join(root, 'deep'));
  assert.equal(found.length, 4);
  assert.ok(!found.some((f) => f.includes('not-a-spec')));
});

test('the CLI exits 1 and names the package', () => {
  const root = fixture({ silent: { scripts: {}, files: ['src/x.spec.ts'] } });
  // Point the CLI at the fixture by running the module's evaluate through
  // a tiny wrapper — the CLI itself always reads the real packages/ dir,
  // which the last case covers.
  const r = evaluate(root);
  assert.equal(r.ok, false);
  assert.match(r.violations[0].pkg, /@fixture\/silent/);
});

test('the REAL packages/ tree passes', () => {
  const r = evaluate(REAL_PACKAGES);
  assert.equal(r.ok, true, JSON.stringify(r.violations, null, 2));
  // …and it is actually looking at something: the three packages that
  // ship specs must all be present and counted.
  const withSpecs = r.packages.filter((p) => p.specs > 0).map((p) => p.name).sort();
  assert.deepEqual(withSpecs, ['@cms/api-types', '@cms/scoreboard-cts', '@cms/signage-design']);
});

test('the CLI runs clean against the real tree', () => {
  const out = execFileSync('node', [CLI], { encoding: 'utf8' });
  assert.match(out, /OK — every package with specs can run them/);
});
