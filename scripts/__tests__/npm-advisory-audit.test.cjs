#!/usr/bin/env node
/**
 * Tests for the prerelease blind spot in scripts/npm-advisory-audit.cjs.
 *
 * THE BUG THIS PINS (2026-09-02, audit appendix §B): `multer@1.4.5-lts.2` was
 * a DIRECT production dependency of apps/api with 8 HIGH advisories, npm
 * itself marked it deprecated, and this gate was green — because the npm bulk
 * advisory endpoint returns nothing for a version carrying a PRERELEASE tag.
 * Semver ranges like `<2.0.0` do not match `1.4.5-lts.2` unless the range
 * names a prerelease with the same [major, minor, patch]. OSV returned all 8
 * for the exact same string.
 *
 * Plain `node:test` — no jest, no deps, runnable as:
 *   node scripts/__tests__/npm-advisory-audit.test.cjs
 *   node --test scripts/__tests__/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const {
  prereleaseBase,
  prereleaseAliases,
  mergeAliasFindings,
  findWaiver,
  WAIVERS,
} = require('../npm-advisory-audit.cjs');

test('prereleaseBase strips the tag from a prerelease version', () => {
  assert.equal(prereleaseBase('1.4.5-lts.2'), '1.4.5');
  assert.equal(prereleaseBase('1.4.5-lts.1'), '1.4.5');
  assert.equal(prereleaseBase('2.0.0-rc.4'), '2.0.0');
  assert.equal(prereleaseBase('7.0.0-beta'), '7.0.0');
  assert.equal(prereleaseBase('0.1.0-alpha.1'), '0.1.0');
});

test('prereleaseBase returns null for a plain release or junk', () => {
  assert.equal(prereleaseBase('2.2.0'), null);
  assert.equal(prereleaseBase('1.4.13'), null);
  // Build metadata is not a prerelease — it does not change range matching.
  assert.equal(prereleaseBase('1.2.3+build.7'), null);
  assert.equal(prereleaseBase(''), null);
  assert.equal(prereleaseBase(undefined), null);
  assert.equal(prereleaseBase('workspace:*'), null);
});

test('THE REGRESSION: a prerelease-tagged prod package is re-queried by base version', () => {
  const pkgs = new Map([
    ['multer', new Set(['1.4.5-lts.2'])],
    ['express', new Set(['5.1.0'])],
  ]);
  const { aliasQuery, aliasedBy } = prereleaseAliases(pkgs);

  assert.deepEqual([...aliasQuery.keys()], ['multer']);
  assert.deepEqual([...aliasQuery.get('multer')], ['1.4.5']);
  // The finding must be reportable against what is ACTUALLY on disk.
  assert.deepEqual(aliasedBy.get('multer'), ['1.4.5-lts.2']);
});

test('a package with no prerelease versions produces no second-pass query at all', () => {
  const pkgs = new Map([
    ['multer', new Set(['2.2.0'])],
    ['express', new Set(['5.1.0', '4.21.2'])],
  ]);
  const { aliasQuery, aliasedBy } = prereleaseAliases(pkgs);
  assert.equal(aliasQuery.size, 0);
  assert.equal(aliasedBy.size, 0);
});

test('a base version that is ALSO installed is not re-queried (no double report)', () => {
  const pkgs = new Map([['multer', new Set(['1.4.5', '1.4.5-lts.2'])]]);
  const { aliasQuery } = prereleaseAliases(pkgs);
  assert.equal(aliasQuery.size, 0);
});

test('several prerelease versions of one package collapse to their distinct bases', () => {
  const pkgs = new Map([['pkg', new Set(['1.4.5-lts.1', '1.4.5-lts.2', '2.0.0-rc.4'])]]);
  const { aliasQuery, aliasedBy } = prereleaseAliases(pkgs);
  assert.deepEqual([...aliasQuery.get('pkg')].sort(), ['1.4.5', '2.0.0']);
  assert.deepEqual(aliasedBy.get('pkg').sort(), ['1.4.5-lts.1', '1.4.5-lts.2', '2.0.0-rc.4']);
});

test('mergeAliasFindings adds only what the direct pass could not see, tagged with the installed version', () => {
  const direct = [
    { name: 'express', severity: 'moderate', title: 'x', url: 'https://gh/adv/EXPRESS-1' },
  ];
  const alias = [
    { name: 'multer', severity: 'high', title: 'DoS', url: 'https://gh/adv/GHSA-multer-1' },
    { name: 'multer', severity: 'high', title: 'Other', url: 'https://gh/adv/GHSA-multer-2' },
  ];
  const aliasedBy = new Map([['multer', ['1.4.5-lts.2']]]);

  const extra = mergeAliasFindings(direct, alias, aliasedBy);
  assert.equal(extra.length, 2);
  assert.equal(extra[0].severity, 'high'); // still blocks — same severity gate
  assert.deepEqual(extra[0].viaPrerelease, ['1.4.5-lts.2']);
});

test('mergeAliasFindings does not double-report an advisory the direct pass already found', () => {
  const dup = { name: 'multer', severity: 'high', title: 'DoS', url: 'https://gh/adv/GHSA-1' };
  const extra = mergeAliasFindings([dup], [dup], new Map([['multer', ['1.4.5-lts.2']]]));
  assert.deepEqual(extra, []);
});

test('mergeAliasFindings dedupes by URL, falling back to title when a URL is missing', () => {
  const direct = [{ name: 'p', severity: 'high', title: 'Same title', url: '' }];
  const alias = [{ name: 'p', severity: 'high', title: 'Same title', url: '' }];
  assert.deepEqual(mergeAliasFindings(direct, alias, new Map()), []);
});

// ── Waivers (2026-11-17) ───────────────────────────────────────────────────

const PICOMATCH = { name: 'picomatch', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' };

test('a waiver that names its advisory covers that advisory and nothing else on the package', () => {
  const today = '2026-11-18';
  const w = findWaiver(PICOMATCH, today);
  assert.ok(w && !w.expired);
  assert.equal(w.ghsa, 'GHSA-fc5q-39xc-vjpf');
  // The id is matched whatever its case in the advisory URL.
  assert.ok(findWaiver({ ...PICOMATCH, url: PICOMATCH.url.toLowerCase() }, today));
  // Another advisory on the same package is NOT covered.
  assert.equal(findWaiver({ name: 'picomatch', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }, today), null);
  // A finding with no advisory URL is not covered.
  assert.equal(findWaiver({ name: 'picomatch' }, today), null);
  // Another package is not covered, even by the same advisory id.
  assert.equal(findWaiver({ ...PICOMATCH, name: 'micromatch' }, today), null);
});

test('a waiver stops applying on its expiry date', () => {
  assert.equal(findWaiver(PICOMATCH, '2026-12-16').expired, undefined);
  assert.equal(findWaiver(PICOMATCH, '2026-12-17').expired, true);
  assert.equal(findWaiver(PICOMATCH, '2027-06-01').expired, true);
});

test('every waiver names its advisory, says why, expires and has a proof module that exists', () => {
  for (const w of WAIVERS) {
    assert.match(String(w.name), /^[@a-z0-9][a-z0-9._/-]*$/, 'name');
    assert.match(String(w.ghsa), /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/, `${w.name}: ghsa`);
    assert.ok(String(w.reason).length >= 80, `${w.name}: a reason that names the unreachable path`);
    assert.match(String(w.expires), /^\d{4}-\d{2}-\d{2}$/, `${w.name}: expires`);
    assert.ok(typeof w.proof === 'string' && w.proof.length > 0, `${w.name}: proof`);
    assert.ok(fs.existsSync(path.resolve(__dirname, '..', w.proof)), `${w.name}: proof module ${w.proof} exists`);
    assert.equal(typeof require(path.resolve(__dirname, '..', w.proof)).verify, 'function', `${w.name}: proof exports verify()`);
  }
});

