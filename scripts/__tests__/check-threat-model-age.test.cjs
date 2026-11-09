#!/usr/bin/env node
/**
 * Tests for scripts/check-threat-model-age.cjs.
 *
 * Plain `node:test` — no jest, no deps, runnable as:
 *   node --test scripts/__tests__/check-threat-model-age.test.cjs
 *   node --test scripts/__tests__/*.test.cjs   (what CI runs)
 *
 * The check exists because the three security documents sat five months
 * behind the code with nothing noticing. These cases pin: fresh passes, stale
 * fails, the --max-days flag, and that a missing file or missing date is a
 * failure rather than a silent pass. The real documents are checked last only
 * for being parseable (their age is the report-only workflow's business).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { evaluate, readVerifiedDate, DOCUMENTS } = require('../check-threat-model-age.cjs');
const CLI = path.resolve(__dirname, '..', 'check-threat-model-age.cjs');
const REPO = path.resolve(__dirname, '..', '..');

/** Build a throwaway repo root holding the three documents with the given dates (null = omit file). */
function fixture(dates) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-age-'));
  DOCUMENTS.forEach((rel, i) => {
    const date = dates[i];
    if (date === null) return;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    const header = date === 'none' ? '**Status:** Current.' : `**Status:** Current / living. **Last verified against code:** ${date}.`;
    fs.writeFileSync(path.join(root, rel), `# Doc\n\n${header}\n`);
  });
  return root;
}

const today = new Date('2026-11-09T12:00:00Z');

test('reads the bold header form', () => {
  const d = readVerifiedDate('**Status:** x. **Last verified against code:** 2026-05-29.');
  assert.equal(d.toISOString().slice(0, 10), '2026-05-29');
  assert.equal(readVerifiedDate('no date here'), null);
  assert.equal(readVerifiedDate('Last verified against code: 2026-02-31'), null);
});

test('fresh documents pass and report their age', () => {
  const res = evaluate({ root: fixture(['2026-11-09', '2026-10-01', '2026-07-12']), today });
  assert.deepEqual(res.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(res.map((r) => r.days), [0, 39, 120]);
});

test('a document older than the limit fails', () => {
  const res = evaluate({ root: fixture(['2026-11-09', '2026-05-29', '2026-11-09']), today });
  assert.equal(res[1].ok, false);
  assert.equal(res[1].days, 164);
  assert.match(res[1].reason, /older than 120 days/);
});

test('--max-days changes the limit', () => {
  const root = fixture(['2026-10-01', '2026-10-01', '2026-10-01']);
  assert.ok(evaluate({ root, today, maxDays: 120 }).every((r) => r.ok));
  assert.ok(evaluate({ root, today, maxDays: 30 }).every((r) => !r.ok));
});

test('a missing file or missing date is a failure, never a pass', () => {
  const res = evaluate({ root: fixture([null, 'none', '2026-11-09']), today });
  assert.equal(res[0].ok, false);
  assert.match(res[0].reason, /not found/);
  assert.equal(res[1].ok, false);
  assert.match(res[1].reason, /Last verified/);
  assert.equal(res[2].ok, true);
});

test('a date more than a day in the future fails', () => {
  const res = evaluate({ root: fixture(['2026-11-10', '2026-11-20', '2026-11-09']), today });
  assert.deepEqual(res.map((r) => r.ok), [true, false, true]);
});

test('CLI: exit 0 + "ok · N days" when fresh, exit 1 when stale, exit 2 on bad args', () => {
  const fresh = fixture(['2026-11-01', '2026-11-01', '2026-11-01']);
  const ok = spawnSync(process.execPath, [CLI, '--root', fresh, '--today', '2026-11-09'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ok · 8 days · docs\/spec\/THREAT_MODEL\.md/);

  const stale = spawnSync(process.execPath, [CLI, '--root', fresh, '--today', '2026-11-09', '--max-days', '5'], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /older than 5 days/);

  const bad = spawnSync(process.execPath, [CLI, '--max-days', 'soon'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('the real documents each carry a readable date', () => {
  for (const rel of DOCUMENTS) {
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.ok(readVerifiedDate(text), `${rel} has no "Last verified against code" date`);
  }
});
