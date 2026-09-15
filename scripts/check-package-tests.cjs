#!/usr/bin/env node
/**
 * check-package-tests — a workspace package that ships spec files must
 * also ship a way to RUN them.
 *
 * Why this exists (2026-09-15): `packages/api-types` carried three spec
 * files and 36 assertions that had NEVER executed. The package declared
 * only a `build` script, so `turbo run test` skipped it silently, and no
 * workflow ran jest over `packages/` at all. Two sibling packages —
 * scoreboard-cts (88 tests) and signage-design (326) — DID declare a
 * `test` script and were equally unrun, because CI only ever invoked
 * `pnpm --filter api exec jest` and `pnpm --filter web exec jest`.
 *
 * 450 assertions that looked like coverage and were not. This repo has
 * documented that failure class twice already (CLAUDE.md rule 9, and the
 * `continue-on-error: true` API gate before 2026-05-29), so the fix is a
 * gate, not a habit.
 *
 * What it checks, per directory under packages/:
 *   1. If it contains any *.spec.ts / *.test.ts outside node_modules and
 *      dist, its package.json MUST declare a `test` script.
 *   2. A package that declares a `test` script must actually have specs —
 *      otherwise the script is a no-op that reports success (jest exits 1
 *      on "no tests found" only with --passWithNoTests off, and a future
 *      edit could flip that).
 *
 * It deliberately does NOT run the tests; CI runs them. This only makes
 * sure they CAN be run.
 *
 * Usage:  node scripts/check-package-tests.cjs [--json]
 * Exit:   0 clean, 1 violations, 2 usage/IO error.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const SPEC_RE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Every spec file under `dir`, relative to it, skipping build output. */
function findSpecs(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findSpecs(full, base, out);
    } else if (SPEC_RE.test(entry.name)) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

/**
 * Grade every package under `packagesDir`.
 * Pure apart from the reads, so the test can point it at a fixture tree.
 */
function evaluate(packagesDir) {
  const violations = [];
  const packages = [];
  let names;
  try {
    names = fs.readdirSync(packagesDir, { withFileTypes: true });
  } catch (e) {
    return { ok: false, packages, violations: [{ kind: 'unreadable', detail: String(e.message) }] };
  }

  for (const entry of names) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const dir = path.join(packagesDir, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      violations.push({ kind: 'bad-manifest', pkg: entry.name, detail: String(e.message) });
      continue;
    }

    const specs = findSpecs(dir);
    const hasTestScript = Boolean(manifest.scripts && manifest.scripts.test);
    packages.push({ name: manifest.name || entry.name, dir: entry.name, specs: specs.length, hasTestScript });

    if (specs.length > 0 && !hasTestScript) {
      violations.push({
        kind: 'specs-without-runner',
        pkg: manifest.name || entry.name,
        detail:
          `${specs.length} spec file(s) and no "test" script — they cannot run. ` +
          `First: ${specs.slice(0, 3).join(', ')}`,
      });
    }
    if (specs.length === 0 && hasTestScript) {
      violations.push({
        kind: 'runner-without-specs',
        pkg: manifest.name || entry.name,
        detail: 'declares a "test" script but has no spec files — it reports success over nothing.',
      });
    }
  }

  return { ok: violations.length === 0, packages, violations };
}

function main(argv) {
  const json = argv.includes('--json');
  const packagesDir = path.resolve(__dirname, '..', 'packages');
  const result = evaluate(packagesDir);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }

  for (const p of result.packages) {
    process.stdout.write(
      `  ${p.hasTestScript && p.specs > 0 ? 'ok  ' : '    '}${p.name}: ${p.specs} spec file(s), ` +
        `test script ${p.hasTestScript ? 'declared' : 'MISSING'}\n`,
    );
  }
  if (result.ok) {
    process.stdout.write(
      `OK — every package with specs can run them (${result.packages.length} package(s) scanned).\n`,
    );
    return 0;
  }
  process.stdout.write('\nFAIL — a package cannot run the tests it ships:\n');
  for (const v of result.violations) {
    process.stdout.write(`  • ${v.pkg ?? '(packages/)'}: ${v.detail}\n`);
  }
  process.stdout.write(
    '\nAdd a "test" script (copy the jest block from packages/signage-design/package.json)\n' +
      'and make sure ci.yml runs it — a script nothing invokes is the same silence.\n',
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { evaluate, findSpecs };
