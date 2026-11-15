#!/usr/bin/env node
/*
 * Request-budget guard - the player's periodic network calls may not get
 * faster, and no new one may appear, without the budget file changing in the
 * same pull request.
 *
 * WHY (2026-11-15 cost audit, docs/COST.md). A paired screen talks to the
 * API on timers, around the clock. Whatever those timers add up to is
 * multiplied by every screen in every fleet, and - for a screen whose control
 * plane is on the same-origin gateway - billed by Vercel on four meters per
 * request. The 2026-09-02 efficiency audit cut that traffic and wrote the
 * reasoning into code comments; nothing ENFORCED it, so by November the API
 * was serving more than twice the requests per day it had then and the
 * 2026-11-14 Vercel invoice carried a $100 tier nobody chose. A rule that
 * lives only in a comment is a rule the next session does not see.
 *
 * WHAT IT CHECKS (static - no build, no network, under a second):
 *   A. FLOORS. Every call in `request-budget.json` is read back from the
 *      source with its own pattern, and its interval must be >= its floor.
 *      A pattern that no longer matches exactly once FAILS: the timer was
 *      moved or renamed, and the guard must be taught where it went - never
 *      deleted, never left silently passing.
 *   B. CEILINGS. The floors add up to requests per screen per day, healthy
 *      (push channel up) and degraded (push down). Neither total may exceed
 *      its ceiling. The ceilings equal today's totals, so adding a call means
 *      raising a ceiling where a reviewer sees it.
 *   C. TRIPWIRE. The number of `setInterval(` call sites in the player source
 *      may not rise above the baseline. Not every timer is a poll - that is
 *      the point of a tripwire: a new one stops here and is either shown to
 *      be free (raise the baseline, say why in the PR) or added to the table.
 *
 * WHAT IT CANNOT SEE: a poll built from chained setTimeout, traffic caused by
 * retries, and which origin a screen is actually using. Those are runtime
 * facts; `docs/COST.md` names the measurements that cover them.
 *
 * This is a COST guard. A floor says how fast a call may run, never how slow
 * a life-safety poll is allowed to become - that belongs to
 * apps/api/src/emergency/CLAUDE.md and the emergency tests.
 *
 * Run:
 *   node apps/web/tools/check-request-budget.cjs              # check (CI mode)
 *   node apps/web/tools/check-request-budget.cjs --self-test  # negative controls
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BUDGET_PATH = path.join(__dirname, 'request-budget.json');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `10_000`, `15 * 60_000`, `5 * 60 * 1000` → milliseconds. Anything that is
 * not plain arithmetic on number literals is refused (returns null) rather
 * than guessed at: an interval that became a variable needs a human.
 */
function evalIntervalMs(expr) {
  const cleaned = String(expr).replace(/_/g, '').trim();
  if (!cleaned || !/^[0-9\s*+().]+$/.test(cleaned)) return null;
  let value;
  try {
    value = Function(`"use strict"; return (${cleaned});`)();
  } catch {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Non-test source files under a directory, recursively. */
function sourceFiles(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(abs));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function countTimers(text) {
  return (text.match(/\bsetInterval\(/g) || []).length;
}

/**
 * The whole check as a pure function of (budget, a file reader, a timer
 * counter), so the self-test can drive it with synthetic sources.
 *
 * @returns {{ failures: string[], rows: object[], totals: {healthy:number, degraded:number}, timers: object[] }}
 */
function evaluateBudget(budget, readFile, timerCount) {
  const failures = [];
  const rows = [];
  let healthy = 0;
  let degraded = 0;

  for (const call of budget.calls || []) {
    const row = { id: call.id, route: call.route, floorMs: call.floorMs, mode: call.mode, ms: null };
    rows.push(row);
    let text;
    try {
      text = readFile(call.file);
    } catch {
      failures.push(`[${call.id}] cannot read ${call.file} - the file moved; teach the guard where the timer went.`);
      continue;
    }
    const matches = [...text.matchAll(new RegExp(call.pattern, 'g'))];
    if (matches.length !== 1) {
      failures.push(
        `[${call.id}] pattern matched ${matches.length} time(s) in ${call.file} (expected exactly 1): /${call.pattern}/ - ` +
          'the timer was moved, renamed or duplicated. Update request-budget.json to point at it; do not delete the entry.',
      );
      continue;
    }
    const ms = evalIntervalMs(matches[0][1]);
    if (ms === null) {
      failures.push(
        `[${call.id}] interval "${matches[0][1].trim()}" in ${call.file} is not plain arithmetic on number literals - ` +
          'an interval that became a variable needs a reviewer; point the pattern at the literal.',
      );
      continue;
    }
    row.ms = ms;
    if (ms < call.floorMs) {
      failures.push(
        `[${call.id}] runs every ${ms} ms, faster than its floor of ${call.floorMs} ms (${call.route}). ` +
          'A faster poll is multiplied by every screen. If it is truly needed, change the floor and the ceilings in ' +
          'apps/web/tools/request-budget.json in this pull request and say why in its body.',
      );
    }
    const perDay = DAY_MS / ms;
    row.perDay = perDay;
    if (call.mode === 'healthy' || call.mode === 'both') healthy += perDay;
    if (call.mode === 'degraded' || call.mode === 'both') degraded += perDay;
  }

  const ceilings = budget.ceilings || {};
  if (typeof ceilings.healthyPerScreenDay !== 'number' || typeof ceilings.degradedPerScreenDay !== 'number') {
    failures.push('request-budget.json has no numeric ceilings.healthyPerScreenDay / degradedPerScreenDay.');
  } else {
    if (Math.round(healthy) > ceilings.healthyPerScreenDay) {
      failures.push(
        `healthy total is ${Math.round(healthy)} requests per screen per day, above the ceiling of ${ceilings.healthyPerScreenDay}.`,
      );
    }
    if (Math.round(degraded) > ceilings.degradedPerScreenDay) {
      failures.push(
        `degraded total is ${Math.round(degraded)} requests per screen per day, above the ceiling of ${ceilings.degradedPerScreenDay}.`,
      );
    }
  }

  const timers = [];
  for (const [dir, baseline] of Object.entries(budget.timerBaseline || {})) {
    const count = timerCount(dir);
    timers.push({ dir, baseline, count });
    if (count > baseline) {
      failures.push(
        `${dir} has ${count} setInterval( call sites, baseline ${baseline}. A new timer on a screen runs on every screen, all day. ` +
          'If it makes a network call, add it to "calls" in request-budget.json; either way raise the baseline in this pull request and say what the timer does.',
      );
    }
  }

  return { failures, rows, totals: { healthy: Math.round(healthy), degraded: Math.round(degraded) }, timers };
}

function selfTest() {
  const budget = {
    ceilings: { healthyPerScreenDay: 8640, degradedPerScreenDay: 8640 },
    timerBaseline: { 'src/player': 1 },
    calls: [{ id: 'poll', route: 'GET /x', file: 'a.ts', pattern: 'export const POLL_MS = ([^;]+);', floorMs: 10000, mode: 'both' }],
  };
  const run = (source, timers) => evaluateBudget(budget, () => source, () => timers).failures;
  const cases = [
    ['clean source passes', run('export const POLL_MS = 10_000;', 1), 0],
    ['slower is allowed', run('export const POLL_MS = 60 * 1000;', 1), 0],
    ['faster than the floor fails (floor + ceilings)', run('export const POLL_MS = 5_000;', 1), 3],
    ['a renamed constant fails', run('export const OTHER_MS = 10_000;', 1), 1],
    ['a duplicated constant fails', run('export const POLL_MS = 10_000;\nexport const POLL_MS = 10_000;', 1), 1],
    ['a non-literal interval fails', run('export const POLL_MS = cadence();', 1), 1],
    ['a new timer fails', run('export const POLL_MS = 10_000;', 2), 1],
  ];
  let bad = 0;
  for (const [name, failures, expected] of cases) {
    const ok = failures.length === expected;
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} - ${failures.length} failure(s), expected ${expected}`);
  }
  if (evalIntervalMs('process.exit(1)') !== null || evalIntervalMs('15 * 60_000') !== 900000) {
    bad += 1;
    console.log('  FAIL evalIntervalMs');
  } else {
    console.log('  ok   evalIntervalMs refuses code and evaluates arithmetic');
  }
  if (bad) {
    console.error(`\n[request-budget] self-test FAILED (${bad}).`);
    process.exit(1);
  }
  console.log('\n[request-budget] self-test OK - every negative control fails the way it should.');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let budget;
  try {
    budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
  } catch (e) {
    console.error(`[request-budget] cannot read ${path.relative(REPO_ROOT, BUDGET_PATH)}: ${e.message}`);
    process.exit(2);
  }

  const result = evaluateBudget(
    budget,
    (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
    (dir) => sourceFiles(path.join(REPO_ROOT, dir)).reduce((n, f) => n + countTimers(fs.readFileSync(f, 'utf8')), 0),
  );

  console.log('\n  Player request budget (per paired screen):\n');
  for (const r of result.rows) {
    const every = r.ms === null ? '   ?' : `${String(Math.round(r.ms / 1000)).padStart(4)} s`;
    const perDay = r.perDay ? String(Math.round(r.perDay)).padStart(6) : '     ?';
    console.log(`    ${every}  ${perDay}/day  ${String(r.mode).padEnd(8)}  ${r.id}`);
  }
  const { healthy, degraded } = result.totals;
  console.log(`\n    healthy  ${healthy} requests/screen/day (ceiling ${budget.ceilings?.healthyPerScreenDay})`);
  console.log(`    degraded ${degraded} requests/screen/day (ceiling ${budget.ceilings?.degradedPerScreenDay})`);
  if (healthy > 0 && degraded > 0) {
    // The only Vercel-billed share is the traffic of screens on the gateway.
    const perMonth = (n) => Math.round((n * 30) / 1000) / 1000;
    console.log(
      `\n    One screen on the same-origin gateway for a month: ${perMonth(healthy)} M requests through Vercel healthy, ${perMonth(degraded)} M degraded.`,
    );
  }
  for (const t of result.timers) {
    const note = t.count < t.baseline ? '  (below the baseline - lower it in request-budget.json)' : '';
    console.log(`    timers   ${t.dir}: ${t.count} (baseline ${t.baseline})${note}`);
  }

  if (result.failures.length === 0) {
    console.log('\n[request-budget] OK\n');
    process.exit(0);
  }
  console.error('\n[request-budget] FAIL\n');
  for (const f of result.failures) console.error(`  - ${f}`);
  console.error('\n  Rules and the reasoning behind every number: docs/COST.md\n');
  process.exit(1);
}

main();
