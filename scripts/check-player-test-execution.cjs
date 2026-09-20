#!/usr/bin/env node
/**
 * check-player-test-execution.cjs — turn "Gradle exited 0" into "these tests
 * actually ran".
 *
 * ============================================================
 * WHY THIS EXISTS (SEC-002 re-audit, 2026-09-04)
 * ============================================================
 *
 * `./gradlew testDebugUnitTest` exits 0 when it runs a thousand tests AND when
 * it runs none. A `--tests` filter that matches nothing, a source set that
 * stopped being compiled, a module that silently dropped out of
 * `settings.gradle.kts`, a JUnit `Assume` that skips a whole class because the
 * sources it reads are not on disk in the runner's layout — every one of those
 * is GREEN. This repo has already shipped the general shape of that bug twice:
 * "112 green tests, no caller" (2026-08-14), and a lint/a11y gate that was
 * false-green for weeks (2026-07-13).
 *
 * That matters more than usual for the SEC-002 classes. They are the only
 * automated evidence that the legacy every-frame bridge is default-deny, and
 * two of them (`LegacyBridgeExposureTest`, `BootBridgeWiringTest`) are SOURCE
 * GUARDS built on `Assume.assumeTrue(...)` — by construction they SKIP rather
 * than fail when they cannot find the files they read. A skip is reported as a
 * pass by every summary in the pipeline.
 *
 * So this script reads the JUnit XML that Gradle actually wrote and asserts:
 *
 *   1. result files exist at all (the task ran, and wrote where we expect);
 *   2. the whole suite cleared a floor, so a catastrophic "nothing ran" is
 *      caught even if every named class below is present;
 *   3. every REQUIRED class is present, executed at least one case, and has
 *      zero failures/errors;
 *   4. no REQUIRED class was entirely skipped — the Assume trapdoor.
 *
 * ⚠️ WHAT IT IS NOT. This proves a JVM unit test executed. It says NOTHING
 * about hardware: it does not exercise Android's `@JavascriptInterface`
 * reflection dispatch, the WebView's origin rules, or an OEM WebView build.
 * That is `apps/player/HARDWARE-QUALIFICATION.md`'s job, and the two must
 * never be conflated — green CI has never been a fleet claim.
 *
 * Usage:
 *   node scripts/check-player-test-execution.cjs
 *   node scripts/check-player-test-execution.cjs --json
 *
 * Dependency-free plain Node, like the other release guards, so CI needs no
 * `pnpm install` to run it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLAYER = path.join(REPO_ROOT, 'apps', 'player');

/** Modules whose `testDebugUnitTest` results we read. */
const MODULES = ['app', 'manager'];

/**
 * Classes that MUST have executed, with the minimum number of cases each.
 *
 * The minimums are deliberately BELOW the current counts — this guard exists
 * to catch "zero ran", not to freeze the suite. Raise one only when a class's
 * coverage is itself the thing being protected.
 */
const REQUIRED = [
  // ── SEC-002: the legacy every-frame bridge boundary ──────────────
  // The behavioural half. If this does not run, nothing in CI checks that
  // an un-nonced frame is refused.
  { cls: 'com.educms.player.security.BridgeNonceTest', min: 6 },
  { cls: 'com.educms.player.security.HostileFrameBridgeTest', min: 6 },
  // The wiring half — and an Assume-based source guard, so the
  // "not entirely skipped" rule below is doing real work here.
  { cls: 'com.educms.player.security.LegacyBridgeExposureTest', min: 8 },
  // The three-file bridge contract (Kotlin METHODS <-> nativeBridge.ts).
  { cls: 'com.educms.player.boot.BootBridgeWiringTest', min: 3 },
  // ── Double-sided displays (2026-09-19) — LIFE SAFETY ─────────────
  // The emergency hold's membership rules: a hold credited to a face nothing
  // hosts could once never be released. If these stop running, nothing in CI
  // checks that a box cannot be pinned into a permanent hold.
  { cls: 'com.educms.player.face.FaceEmergencyHoldTest', min: 10 },
  // What the face host DOES (hot-plug, re-enumeration, failed attach) and the
  // storage-isolation proof. All four 1.1.18 hosting defects lived in code
  // with no behavioural test.
  { cls: 'com.educms.player.face.FaceHostPlanTest', min: 12 },
  // Source-shape guards: no page can name a face; a torn-down face never
  // releases the hold. Assume-based, so "not entirely skipped" matters here.
  { cls: 'com.educms.player.face.FaceBridgeIsolationTest', min: 5 },
  // The server → native activation path: silence must never un-host a side.
  { cls: 'com.educms.player.face.FaceActivationTest', min: 4 },
];

/**
 * Floor for the whole suite. Well under the real count (472 at the time of
 * writing) so ordinary churn never trips it; its only job is to catch a
 * configuration change that stops most tests from running.
 */
const TOTAL_FLOOR = 300;

/** Minimal JUnit-XML reader — attributes off <testsuite>, plus <testcase> tags. */
function readSuite(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const open = xml.match(/<testsuite\b[^>]*>/);
  if (!open) return null;
  const attr = (name) => {
    const m = open[0].match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? m[1] : '';
  };
  const num = (name) => {
    const v = parseInt(attr(name), 10);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    file,
    name: attr('name'),
    tests: num('tests'),
    failures: num('failures'),
    errors: num('errors'),
    skipped: num('skipped'),
  };
}

function collect() {
  const suites = [];
  const searched = [];
  for (const mod of MODULES) {
    const dir = path.join(PLAYER, mod, 'build', 'test-results', 'testDebugUnitTest');
    searched.push(path.relative(REPO_ROOT, dir));
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('TEST-') || !f.endsWith('.xml')) continue;
      const s = readSuite(path.join(dir, f));
      if (s) suites.push(s);
    }
  }
  return { suites, searched };
}

function main() {
  const asJson = process.argv.includes('--json');
  const { suites, searched } = collect();
  const problems = [];

  if (suites.length === 0) {
    problems.push(
      'no JUnit result files were found. `testDebugUnitTest` either did not run, ' +
        'or wrote somewhere else. Searched:\n    ' + searched.join('\n    '),
    );
  }

  const byName = new Map(suites.map((s) => [s.name, s]));
  const total = suites.reduce((n, s) => n + s.tests, 0);
  const executed = suites.reduce((n, s) => n + (s.tests - s.skipped), 0);
  const failed = suites.reduce((n, s) => n + s.failures + s.errors, 0);

  if (suites.length > 0 && executed < TOTAL_FLOOR) {
    problems.push(
      `only ${executed} test case(s) actually executed across ${suites.length} class(es) — ` +
        `below the floor of ${TOTAL_FLOOR}. Gradle exited 0, so something stopped the ` +
        'suite from running rather than breaking it.',
    );
  }

  for (const req of REQUIRED) {
    const s = byName.get(req.cls);
    const short = req.cls.split('.').pop();
    if (!s) {
      problems.push(
        `${short} produced NO result file — it did not run. This class is required ` +
          'evidence; a suite without it is not a pass.',
      );
      continue;
    }
    const ran = s.tests - s.skipped;
    if (ran === 0) {
      problems.push(
        `${short} ran ${s.tests} case(s) and SKIPPED all of them. It is an ` +
          '`Assume`-guarded source test: a skip means it could not find the files it ' +
          'checks, which is a false green, not a pass.',
      );
      continue;
    }
    if (ran < req.min) {
      problems.push(`${short} executed only ${ran} case(s); at least ${req.min} are expected.`);
    }
    if (s.failures + s.errors > 0) {
      problems.push(`${short} has ${s.failures} failure(s) and ${s.errors} error(s).`);
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { ok: problems.length === 0, classes: suites.length, total, executed, failed, problems },
        null,
        2,
      ),
    );
    process.exit(problems.length === 0 ? 0 : 1);
  }

  if (problems.length > 0) {
    console.error('player-test-execution: the unit-test gate did not prove what it claims.\n');
    for (const p of problems) console.error(`  • ${p}\n`);
    console.error(
      '  A green `testDebugUnitTest` with these tests missing is exactly the false-green\n' +
        '  this guard exists to stop. Fix the run; do not delete the requirement.',
    );
    process.exit(1);
  }

  console.log(
    `player-test-execution: OK — ${executed} case(s) executed across ${suites.length} class(es), ` +
      `0 failures.`,
  );
  for (const req of REQUIRED) {
    const s = byName.get(req.cls);
    console.log(`  ✓ ${req.cls.split('.').pop()} — ${s.tests - s.skipped} executed`);
  }
  console.log(
    '\n  NOTE: this is a JVM unit-test claim only. It proves nothing about OEM WebViews,\n' +
      '  Chromium-83/87 panels or any physical display — see apps/player/HARDWARE-QUALIFICATION.md.',
  );
}

main();
