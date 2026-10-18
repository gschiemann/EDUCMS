#!/usr/bin/env node
/**
 * The verdict for ONE browser's sharded E2E run (`e2e-report` in
 * .github/workflows/ci.yml, 2026-10-18).
 *
 * Each shard runs a contiguous slice of the suite and uploads a blob report;
 * e2e-report merges them (`playwright merge-reports --reporter=html,json`) and
 * then runs this. It fails unless:
 *
 *   1. the build every shard served was made (e2e-build succeeded);
 *   2. at least one shard reported;
 *   3. the shards between them ran EXACTLY the tests e2e-build listed for this
 *      browser — a shard that never reported (crash, timeout, a matrix entry
 *      someone forgot) shows up here as missing tests, never as a green check;
 *   4. no test failed (`unexpected`). A test that passed on a retry is reported
 *      by name as flaky — visible, but not a failure, exactly as before
 *      sharding (playwright.config.ts `retries`).
 *
 * Inputs (environment): BROWSER, LISTED (count from `playwright test --list`),
 * MERGED (path of the merged JSON report), BLOBS (directory of shard blobs),
 * E2E_BUILD_RESULT (needs.e2e-build.result). Writes a summary to
 * $GITHUB_STEP_SUMMARY when it is set.
 */
const fs = require('node:fs');
const path = require('node:path');

const browser = process.env.BROWSER || '(unknown browser)';
const problems = [];
const lines = [];

function summary(text) {
  lines.push(text);
  // eslint-disable-next-line no-console
  console.log(text);
}

function walk(suite, out) {
  for (const s of suite.suites || []) walk(s, out);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) out.push({ spec, test: t });
  }
}

const buildResult = process.env.E2E_BUILD_RESULT || 'unknown';
if (buildResult !== 'success') problems.push(`e2e-build did not succeed (${buildResult}) — no shard had a build to serve.`);

const listed = Number(process.env.LISTED);
if (!Number.isInteger(listed) || listed <= 0) problems.push(`no test count from e2e-build for ${browser} (LISTED=${JSON.stringify(process.env.LISTED || '')}).`);

const blobDir = process.env.BLOBS || '';
const blobs = blobDir && fs.existsSync(blobDir) ? fs.readdirSync(blobDir).filter((f) => f.endsWith('.zip')).sort() : [];
summary(`### E2E — ${browser}`);
summary(`Shard reports: ${blobs.length ? blobs.join(', ') : 'none'}`);
if (!blobs.length) problems.push('no shard uploaded a report.');

let report = null;
const mergedPath = process.env.MERGED || '';
if (blobs.length) {
  try {
    report = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  } catch (err) {
    problems.push(`the merged report could not be read (${path.basename(mergedPath) || 'MERGED unset'}): ${String(err.message || err).slice(0, 200)}`);
  }
}

if (report) {
  const st = report.stats || {};
  const ran = (st.expected || 0) + (st.unexpected || 0) + (st.flaky || 0) + (st.skipped || 0);
  summary(`Listed ${Number.isInteger(listed) ? listed : '?'} · ran ${ran}: ${st.expected || 0} passed, ${st.flaky || 0} flaky, ${st.skipped || 0} skipped, ${st.unexpected || 0} failed`);
  if (Number.isInteger(listed) && ran !== listed) {
    problems.push(`the shards ran ${ran} tests but e2e-build listed ${listed} — a shard is missing or the shard totals in the matrix do not add up.`);
  }

  const all = [];
  for (const s of report.suites || []) walk(s, all);
  const label = ({ spec, test }) => `${spec.file}:${spec.line} › ${spec.title}${test.projectName ? ` [${test.projectName}]` : ''}`;
  const failed = all.filter(({ test }) => test.status === 'unexpected');
  const flaky = all.filter(({ test }) => test.status === 'flaky');
  if (failed.length) {
    problems.push(`${failed.length} test(s) failed.`);
    summary('Failed:');
    for (const f of failed) summary(`- ${label(f)}`);
  }
  if (flaky.length) {
    summary('Flaky (failed, then passed on a retry — each needs a root-cause fix, not a retry):');
    for (const f of flaky) summary(`- ${label(f)}`);
  }
}

if (problems.length) {
  summary('');
  summary('**FAIL**');
  for (const p of problems) summary(`- ${p}`);
} else {
  summary('**PASS** — every listed test ran in some shard, and none failed.');
}

if (process.env.GITHUB_STEP_SUMMARY) {
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n'); } catch { /* the log has it */ }
}
process.exit(problems.length ? 1 : 0);
