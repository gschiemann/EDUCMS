#!/usr/bin/env node
/**
 * Tests for scripts/check-hardware-qual.cjs.
 *
 * Plain `node:test` — no jest, no deps, runnable as:
 *   node scripts/__tests__/check-hardware-qual.test.cjs
 *   node --test scripts/__tests__/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { evaluate, readCell, parseMatrix, recordOverride } = require('../check-hardware-qual.cjs');
const CLI = path.resolve(__dirname, '..', 'check-hardware-qual.cjs');
const REAL_MATRIX = path.resolve(__dirname, '..', '..', 'apps', 'player', 'HARDWARE-QUALIFICATION.md');

const CHECKS = ['cold-install', 'pairing', 'boot-proof'];

/** Build a fixture matrix: `rows` maps class id -> array of cell strings. */
function fixture({ classes, releases }) {
  const classRows = classes.map((c) => `| \`${c.id}\` | ${c.tier} | fixture hw | fixture soc |`).join('\n');
  const releaseSections = releases
    .map((r) => {
      const body = Object.entries(r.rows)
        .map(([id, cells]) => `| ${id} | ${cells.join(' | ')} |`)
        .join('\n');
      return [
        `## Release: ${r.app} ${r.version}`,
        '',
        `| class | ${CHECKS.join(' | ')} |`,
        `|---|${CHECKS.map(() => '---').join('|')}|`,
        body,
        '',
      ].join('\n');
    })
    .join('\n');

  return [
    '# Fixture matrix',
    '',
    '## Hardware classes',
    '',
    '| Class id | Tier | Hardware | SoC |',
    '|---|---|---|---|',
    classRows,
    '',
    releaseSections,
  ].join('\n');
}

const TWO_CLASSES = [
  { id: 'goodview-lcd-a9', tier: 'REQUIRED' },
  { id: 'generic-android-emulator', tier: 'OPTIONAL' },
];

function write(text) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hwqual-')), 'matrix.md');
  fs.writeFileSync(p, text);
  return p;
}

// ── parsing ────────────────────────────────────────────────────────────────

test('parses classes and release sections', () => {
  const m = parseMatrix(
    fixture({
      classes: TWO_CLASSES,
      releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': ['UNQUALIFIED', 'UNQUALIFIED', 'UNQUALIFIED'] } }],
    }),
  );
  assert.equal(m.classes.length, 2);
  assert.equal(m.classes[0].tier, 'REQUIRED');
  assert.ok(m.releases.has('player 9.9.9'));
  assert.deepEqual(m.releases.get('player 9.9.9').header, CHECKS);
});

test('readCell classifies every status', () => {
  assert.equal(readCell('PASS 2026-09-02 GS -- worked').ok, true);
  assert.equal(readCell('PASS GS').ok, false); // no date
  assert.equal(readCell('PASS 2026-09-02').ok, false); // no initials
  assert.equal(readCell('NA -- no OTA channel on this controller').ok, true);
  assert.equal(readCell('NA').ok, false); // no reason
  assert.equal(readCell('FAIL 2026-09-02 GS -- black screen').ok, false);
  assert.equal(readCell('UNQUALIFIED').status, 'UNQUALIFIED');
  assert.equal(readCell('').status, 'UNQUALIFIED');
  assert.equal(readCell('probably fine').status, 'MALFORMED');
  assert.equal(readCell('OVERRIDE 2026-09-02 GS -- hotfix').ok, true);
});

// ── gate semantics ─────────────────────────────────────────────────────────

test('a fully-PASSing required class qualifies', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [
      {
        app: 'player',
        version: '9.9.9',
        rows: {
          'goodview-lcd-a9': CHECKS.map(() => 'PASS 2026-09-02 GS -- ok'),
          'generic-android-emulator': CHECKS.map(() => 'UNQUALIFIED'),
        },
      },
    ],
  });
  const r = evaluate(text, 'player', '9.9.9');
  assert.equal(r.ok, true, JSON.stringify(r.missing));
});

test('an OPTIONAL class never blocks', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [
      {
        app: 'player',
        version: '9.9.9',
        rows: {
          'goodview-lcd-a9': CHECKS.map(() => 'PASS 2026-09-02 GS'),
          'generic-android-emulator': CHECKS.map(() => 'FAIL 2026-09-02 GS -- broken'),
        },
      },
    ],
  });
  assert.equal(evaluate(text, 'player', '9.9.9').ok, true);
});

test('one UNQUALIFIED cell on a REQUIRED class fails, and is named', () => {
  const cells = CHECKS.map(() => 'PASS 2026-09-02 GS');
  cells[2] = 'UNQUALIFIED';
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': cells } }],
  });
  const r = evaluate(text, 'player', '9.9.9');
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].class, 'goodview-lcd-a9');
  assert.equal(r.missing[0].check, 'boot-proof');
});

test('FAIL blocks even though it was tested', () => {
  const cells = CHECKS.map(() => 'PASS 2026-09-02 GS');
  cells[0] = 'FAIL 2026-09-02 GS -- INSTALL_FAILED_NO_MATCHING_ABIS';
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': cells } }],
  });
  const r = evaluate(text, 'player', '9.9.9');
  assert.equal(r.ok, false);
  assert.match(r.missing[0].reason, /FAIL/);
});

test('PASS without a date or initials is not accepted', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': ['PASS', 'PASS 2026-09-02 GS', 'PASS 2026-09-02 GS'] } }],
  });
  const r = evaluate(text, 'player', '9.9.9');
  assert.equal(r.ok, false);
  assert.match(r.missing[0].reason, /date/);
});

test('a justified NA satisfies the gate and is reported as a note', () => {
  const cells = CHECKS.map(() => 'PASS 2026-09-02 GS');
  cells[1] = 'NA -- controller has no pairing UI, provisioned by ViPlex';
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': cells } }],
  });
  const r = evaluate(text, 'player', '9.9.9');
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /ViPlex/);
});

test('a REQUIRED class with no row at all fails', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'generic-android-emulator': CHECKS.map(() => 'PASS 2026-09-02 GS') } }],
  });
  const r = evaluate(text, 'player', '9.9.9');
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].check, '(all)');
});

test('a version with no release section fails with an actionable message', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': CHECKS.map(() => 'PASS 2026-09-02 GS') } }],
  });
  const r = evaluate(text, 'player', '1.0.0');
  assert.equal(r.ok, false);
  assert.match(r.missing[0].reason, /no "## Release: player 1\.0\.0" section/);
});

test('app namespaces are independent (player PASS does not qualify manager)', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [
      { app: 'player', version: '1.0.0', rows: { 'goodview-lcd-a9': CHECKS.map(() => 'PASS 2026-09-02 GS') } },
      { app: 'manager', version: '1.0.0', rows: { 'goodview-lcd-a9': CHECKS.map(() => 'UNQUALIFIED') } },
    ],
  });
  assert.equal(evaluate(text, 'player', '1.0.0').ok, true);
  assert.equal(evaluate(text, 'manager', '1.0.0').ok, false);
});

// ── override ───────────────────────────────────────────────────────────────

test('recordOverride marks the missing cells, logs the debt, and satisfies the gate', () => {
  const text = fs.readFileSync(REAL_MATRIX, 'utf8');
  const res = recordOverride(text, {
    app: 'player',
    version: '1.1.12',
    operator: 'GS',
    reason: 'prod incident hotfix',
    date: '2026-09-02',
  });
  assert.equal(res.missing.length, 54); // 6 REQUIRED classes x 9 checks
  assert.equal(evaluate(res.text, 'player', '1.1.12').ok, true);
  // The debt is visible, grouped, and attributed.
  assert.match(res.text, /\| 2026-09-02 \| player \| 1\.1\.12 \| GS \|/);
  assert.match(res.text, /goodview-lcd-a9\/\*/);
  assert.match(res.text, /UNPAID DEBT/);
  // It must not silently qualify a DIFFERENT version.
  assert.equal(evaluate(res.text, 'manager', '1.0.24').ok, false);
});

test('recordOverride preserves cells that already PASS', () => {
  const cells = CHECKS.map(() => 'UNQUALIFIED');
  cells[0] = 'PASS 2026-09-01 GS -- installed fine';
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': cells } }],
  });
  const res = recordOverride(text, { app: 'player', version: '9.9.9', operator: 'GS', reason: 'hotfix', date: '2026-09-02' });
  assert.match(res.text, /PASS 2026-09-01 GS -- installed fine/);
  assert.equal(res.missing.length, 2);
  assert.equal(evaluate(res.text, 'player', '9.9.9').ok, true);
});

test('recordOverride creates a section for a version that has none', () => {
  const text = fixture({
    classes: TWO_CLASSES,
    releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': CHECKS.map(() => 'UNQUALIFIED') } }],
  });
  const res = recordOverride(text, { app: 'player', version: '9.9.10', operator: 'GS', reason: 'hotfix', date: '2026-09-02' });
  assert.match(res.text, /## Release: player 9\.9\.10/);
  assert.equal(evaluate(res.text, 'player', '9.9.10').ok, true);
  assert.equal(evaluate(res.text, 'player', '9.9.9').ok, false, 'the old release must stay unqualified');
});

test('CLI --record-override rewrites the file and then passes', () => {
  const p = write(fs.readFileSync(REAL_MATRIX, 'utf8'));
  assert.equal(runCli(['--matrix', p, 'player', '1.1.12']).code, 1);
  const rec = runCli(['--matrix', p, 'player', '1.1.12', '--record-override', '--operator', 'gs', '--reason', 'hotfix', '--date', '2026-09-02']);
  assert.equal(rec.code, 0, rec.out);
  assert.equal(runCli(['--matrix', p, 'player', '1.1.12']).code, 0);
  assert.match(fs.readFileSync(p, 'utf8'), /OVERRIDE 2026-09-02 GS/);
});

test('CLI --record-override rejects bad operator initials and dates', () => {
  const p = write(fs.readFileSync(REAL_MATRIX, 'utf8'));
  assert.equal(runCli(['--matrix', p, 'player', '1.1.12', '--record-override', '--operator', 'Gregory']).code, 1);
  assert.equal(runCli(['--matrix', p, 'player', '1.1.12', '--record-override', '--operator', 'GS', '--date', 'today']).code, 1);
});

// ── CLI ────────────────────────────────────────────────────────────────────

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('CLI exits 1 on the seeded real matrix for the in-field build 1.1.12', () => {
  const r = runCli(['player', '1.1.12']);
  assert.equal(r.code, 1);
  assert.match(r.out, /NOT QUALIFIED/);
  assert.match(r.out, /goodview-lcd-a9/);
});

test('CLI exits 1 for manager 1.0.24 too', () => {
  assert.equal(runCli(['manager', '1.0.24']).code, 1);
});

test('CLI exits 0 on a passing fixture', () => {
  const p = write(
    fixture({
      classes: TWO_CLASSES,
      releases: [{ app: 'player', version: '9.9.9', rows: { 'goodview-lcd-a9': CHECKS.map(() => 'PASS 2026-09-02 GS -- ok') } }],
    }),
  );
  const r = runCli(['--matrix', p, '--app', 'player', '--version', '9.9.9']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /QUALIFIED/);
});

test('CLI accepts --tag', () => {
  const p = write(
    fixture({
      classes: TWO_CLASSES,
      releases: [{ app: 'manager', version: '2.0.0', rows: { 'goodview-lcd-a9': CHECKS.map(() => 'PASS 2026-09-02 GS') } }],
    }),
  );
  assert.equal(runCli(['--matrix', p, '--tag', 'manager-v2.0.0']).code, 0);
  assert.equal(runCli(['--matrix', p, '--tag', 'nonsense']).code, 1);
});

test('CLI --json emits machine-readable missing cells', () => {
  const r = runCli(['--json', 'player', '1.1.12']);
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.missing.length > 0);
});

test('CLI defaults the version to build.gradle.kts and the real matrix', () => {
  // The in-field builds are unqualified by design, so the default run must fail.
  assert.equal(runCli([]).code, 1);
});

test('the real matrix parses and declares the whole production fleet as REQUIRED', () => {
  const m = parseMatrix(fs.readFileSync(REAL_MATRIX, 'utf8'));
  const required = m.classes.filter((c) => c.tier === 'REQUIRED').map((c) => c.id);
  for (const id of [
    'goodview-t982-a11',
    'goodview-t982-a13',
    'maxhub-l55vec-a13',
    'rockchip-rk3288-a7',
    'novastar-taurus-rk356x-a11',
    'goodview-lcd-a9',
  ]) {
    assert.ok(required.includes(id), `${id} must be a REQUIRED class`);
  }
});

test('the real matrix contains no fabricated PASS rows', () => {
  const text = fs.readFileSync(REAL_MATRIX, 'utf8');
  const releaseBody = text.split(/^## Release:/m).slice(1).join('\n');
  assert.ok(!/\|\s*PASS\b/.test(releaseBody), 'seeded releases must not claim any PASS');
});
