#!/usr/bin/env node
/**
 * Tests for scripts/check-incident-records.cjs.
 *
 * Plain `node:test` — no jest, no deps, runnable as:
 *   node --test scripts/__tests__/check-incident-records.test.cjs
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const { checkRecord, GAP_SENTENCE } = require('../check-incident-records.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const CLI = path.resolve(__dirname, '..', 'check-incident-records.cjs');

function record({ pins = '`scripts/check-incident-records.cjs`', skip = [], swap = false } = {}) {
  const body = {
    'What happened': 'x',
    'Root cause': 'x',
    'Why our system let it reach a customer': 'x',
    'What pins it': pins,
    'What worked': 'x',
    'The rule it produced': 'x',
    Evidence: 'x',
  };
  let names = Object.keys(body).filter((n) => !skip.includes(n));
  if (swap) names = [names[3], names[2], ...names.filter((n, i) => i !== 2 && i !== 3)];
  return '# T\n\n' + names.map((n) => `## ${n}\n\n${body[n]}\n`).join('\n');
}

test('a complete record passes', () => {
  assert.deepEqual(checkRecord(record(), REPO), []);
});

test('the GAP sentence is accepted in place of a path', () => {
  assert.deepEqual(checkRecord(record({ pins: GAP_SENTENCE }), REPO), []);
});

test('a missing heading is reported by name', () => {
  const p = checkRecord(record({ skip: ['What worked'] }), REPO);
  assert.equal(p.length, 1);
  assert.match(p[0], /What worked/);
});

test('headings out of order are reported', () => {
  const p = checkRecord(record({ swap: true }), REPO);
  assert.ok(p.some((x) => /out of order/.test(x)));
});

test('a dead pin path fails', () => {
  const p = checkRecord(record({ pins: '`scripts/does-not-exist.cjs`' }), REPO);
  assert.equal(p.length, 1);
  assert.match(p[0], /no path that exists/);
});

test('one dead path among live ones fails', () => {
  const p = checkRecord(record({ pins: '- `scripts/check-incident-records.cjs`\n- `scripts/nope.cjs`' }), REPO);
  assert.ok(p.some((x) => /dead path: scripts\/nope\.cjs/.test(x)));
});

test('prose without a path or the GAP sentence fails', () => {
  const p = checkRecord(record({ pins: 'a test somewhere' }), REPO);
  assert.equal(p.length, 1);
});

test('the real records all pass (CLI exit 0)', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS/);
});

test('--list-gaps exits 0 and lists only .md files', () => {
  const r = spawnSync(process.execPath, [CLI, '--list-gaps'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const line of r.stdout.split('\n').filter(Boolean)) assert.match(line, /\.md$/);
});
