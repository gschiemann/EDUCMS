#!/usr/bin/env node
/**
 * Tests for scripts/check-doc-age.cjs.
 *
 * Plain `node:test` — no jest, no deps, runnable as:
 *   node scripts/__tests__/check-doc-age.test.cjs
 *   node --test scripts/__tests__/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { listFiles, headerDate, sweep, formatTable } = require('../check-doc-age.cjs');

const NOW = new Date('2026-11-09T00:00:00Z');

test('listFiles keeps living docs and drops dated records', () => {
  const tracked = [
    'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
    'apps/web/CLAUDE.md', 'apps/web/README.md',
    'docs/ENVIRONMENT.md', 'docs/governance/AUDIT-SURFACE.md', 'docs/notes.txt',
    'docs/research/x.md', 'docs/incidents/y.md', 'docs/handoffs/z.md', 'docs/governance/decisions/d.md',
  ];
  assert.deepEqual(listFiles('.', () => tracked), [
    'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'apps/web/CLAUDE.md',
    'docs/ENVIRONMENT.md', 'docs/governance/AUDIT-SURFACE.md',
  ]);
});

test('headerDate reads the supported header forms and picks the newest', () => {
  assert.equal(headerDate('Last verified: 2026-05-29').toISOString().slice(0, 10), '2026-05-29');
  assert.equal(headerDate('**Last updated:** 2026-08-01').toISOString().slice(0, 10), '2026-08-01');
  assert.equal(headerDate('Last verified against code: 2026-03-02').toISOString().slice(0, 10), '2026-03-02');
  assert.equal(headerDate('Last updated: 2026-01-01\nverified against code: 2026-02-02').toISOString().slice(0, 10), '2026-02-02');
  assert.equal(headerDate('no date here 2026-01-01'), null);
});

test('sweep prefers the header date, falls back to git, sorts oldest first', () => {
  const texts = { 'a.md': 'Last verified: 2026-05-29', 'b.md': 'nothing', 'c.md': 'Last updated: 2026-11-01' };
  const commits = { 'a.md': new Date('2026-11-08T00:00:00Z'), 'b.md': new Date('2026-01-01T00:00:00Z'), 'c.md': null };
  const rows = sweep('.', {
    files: Object.keys(texts), now: NOW,
    readFile: (f) => texts[f], commitDate: (f) => commits[f],
  });
  assert.deepEqual(rows.map((r) => [r.file, r.source, r.ageDays]), [
    ['b.md', 'git', 312], ['a.md', 'header', 164], ['c.md', 'header', 8],
  ]);
});

test('sweep skips unreadable files and files with no date at all', () => {
  const rows = sweep('.', {
    files: ['gone.md', 'undated.md'], now: NOW,
    readFile: (f) => { if (f === 'gone.md') throw new Error('ENOENT'); return 'x'; },
    commitDate: () => null,
  });
  assert.deepEqual(rows, []);
});

test('formatTable flags rows over the limit', () => {
  const rows = [{ file: 'old.md', date: '2026-01-01', source: 'git', ageDays: 312 }, { file: 'new.md', date: '2026-11-01', source: 'git', ageDays: 8 }];
  const lines = formatTable(rows, 180).split('\n');
  assert.match(lines[1], /old\.md.*YES$/);
  assert.doesNotMatch(lines[2], /YES/);
});
