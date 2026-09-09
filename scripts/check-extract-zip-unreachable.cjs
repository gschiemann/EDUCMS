#!/usr/bin/env node
/**
 * extract-zip (GHSA-jmr9-qjv8-65gv, HIGH, CVSS 8.1) — REGRESSION GUARD.
 *
 * ── WHAT THIS FILE USED TO BE, AND WHY IT CHANGED (2026-09-08) ────────────
 *
 * Until today this script proved a WAIVER: extract-zip was in the production
 * dependency graph (puppeteer-core -> @puppeteer/browsers -> extract-zip), the
 * advisory had no fixed version — it covers `<=2.0.1`, i.e. every release ever
 * published, and 2.0.1 is from 2023 — and the honest posture was "present but
 * unreachable", re-derived mechanically on every audit run.
 *
 * That waiver is GONE, because the underlying fact changed. extract-zip is no
 * longer in the production graph:
 *
 *   * `@puppeteer/browsers` drops extract-zip at 3.0.2 (tar-fs instead).
 *   * The first `puppeteer-core` on that line is 25.0.2.
 *   * Both declare `engines.node >= 22.12.0`, and every 3.x
 *     `@puppeteer/browsers` is ESM-only — which is why this sat blocked behind
 *     a Node-20 -> Node-22 base-image migration rather than a version bump.
 *   * That migration landed (Dockerfile `ARG NODE_IMAGE` is node:22-alpine,
 *     Node v22.23.2), so `apps/api` moved puppeteer-core ^22 -> ^25.
 *
 * ── SO WHAT IS THIS SCRIPT FOR NOW ───────────────────────────────────────
 *
 * The inverse claim, asserted the same way the old one was: extract-zip is NOT
 * in the production closure. That is a stronger statement than the waiver ever
 * made, and it is the one that can silently stop being true — a puppeteer-core
 * downgrade, a new prod dependency that pulls @puppeteer/browsers 2.x, or a
 * `pnpm.overrides` entry that pins the old line would all re-introduce a HIGH
 * with no fixed version and nothing in the diff would say so by name.
 *
 * `scripts/npm-advisory-audit.cjs` would also go red in that case (the
 * advisory would arrive unwaived), and that remains the real automatic
 * control. This script exists so the failure names the CAUSE — "puppeteer-core
 * was downgraded to 22.x" — instead of only the advisory id, which is the
 * difference between a five-minute fix and an afternoon.
 *
 * Run standalone: `node scripts/check-extract-zip-unreachable.cjs`
 *                 (or `pnpm extract-zip-proof`)
 * Requires node_modules to be installed (same precondition as the audit).
 * Exit 0 = extract-zip absent from prod. Exit 1 = it is back. Exit 2 = the
 * check could not run, which is a RED, never a silent green (W0-05).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ADVISORY = 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv';

/** The first puppeteer-core whose @puppeteer/browsers has no extract-zip. */
const FIRST_CLEAN_PUPPETEER_MAJOR = 25;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The authoritative production closure, straight from pnpm — the same
 * enumerator `npm-advisory-audit.cjs` uses, so the two gates can never
 * disagree about what "production" means.
 *
 * @returns {{ ok: true, names: Set<string>, tree: any } | { ok: false, why: string }}
 */
function prodClosure() {
  const res = spawnSync(
    'pnpm',
    ['ls', '-r', '--prod', '--depth', 'Infinity', '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.error) return { ok: false, why: `could not run pnpm ls: ${res.error.message}` };
  if (res.status !== 0) {
    return { ok: false, why: `pnpm ls exited ${res.status}: ${(res.stderr || '').slice(0, 400)}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    return { ok: false, why: `pnpm ls did not emit parseable JSON: ${e.message}` };
  }

  const names = new Set();
  const versions = new Map();
  const walk = (deps) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, node] of Object.entries(deps)) {
      if (!node || typeof node !== 'object') continue;
      names.add(name);
      if (node.version) {
        const set = versions.get(name) || new Set();
        set.add(node.version);
        versions.set(name, set);
      }
      walk(node.dependencies);
    }
  };
  for (const ws of Array.isArray(parsed) ? parsed : [parsed]) {
    walk(ws.dependencies);
    walk(ws.optionalDependencies);
  }
  if (names.size === 0) {
    return { ok: false, why: 'the production closure enumerated as EMPTY — that is a broken check, not a clean tree' };
  }
  return { ok: true, names, versions };
}

function verify() {
  const lines = [];
  const failures = [];
  const say = (s) => lines.push(s);
  const fail = (s) => failures.push(s);

  const closure = prodClosure();
  if (!closure.ok) {
    // Scope we cannot determine is a RED. A check that cannot see the tree has
    // not proved anything about it.
    return { ok: false, lines, failures: [closure.why], indeterminate: true };
  }

  say(`  production closure: ${closure.names.size} distinct packages`);

  // ── 1. the claim itself ──────────────────────────────────────────────────
  const present = closure.names.has('extract-zip');
  const versions = [...(closure.versions.get('extract-zip') || [])];
  say(`  1. extract-zip in the production closure: ${present ? `YES (${versions.join(', ')})` : 'no'}`);
  if (present) {
    fail(
      `extract-zip@${versions.join(', ')} is back in the PRODUCTION graph. The advisory ` +
        `(${ADVISORY}) has NO fixed version — every published release is affected — so this ` +
        'cannot be resolved with a `pnpm.overrides` floor. Find what pulled it in ' +
        '(`pnpm why -r --prod extract-zip`); the usual cause is puppeteer-core being ' +
        'downgraded below 25, which drags @puppeteer/browsers back to 2.x.',
    );
  }

  // ── 2. the mechanism that keeps it out ───────────────────────────────────
  const pptrVersions = [...(closure.versions.get('puppeteer-core') || [])];
  say(`  2. puppeteer-core in production: ${pptrVersions.join(', ') || '(absent)'}`);
  for (const v of pptrVersions) {
    const major = Number.parseInt(String(v).split('.')[0], 10);
    if (Number.isFinite(major) && major < FIRST_CLEAN_PUPPETEER_MAJOR) {
      fail(
        `puppeteer-core@${v} is in the production graph. @puppeteer/browsers only drops ` +
          `extract-zip at 3.0.2, whose first puppeteer-core is ${FIRST_CLEAN_PUPPETEER_MAJOR}.0.2 — ` +
          `so anything below ${FIRST_CLEAN_PUPPETEER_MAJOR}.x re-introduces the advisory.`,
      );
    }
  }

  const browsers = [...(closure.versions.get('@puppeteer/browsers') || [])];
  say(`  3. @puppeteer/browsers in production: ${browsers.join(', ') || '(absent)'}`);
  for (const v of browsers) {
    const major = Number.parseInt(String(v).split('.')[0], 10);
    if (Number.isFinite(major) && major < 3) {
      fail(`@puppeteer/browsers@${v} still depends on extract-zip; 3.0.2+ uses tar-fs instead.`);
    }
  }

  // ── 3. the declared floor, so a range edit is caught before install ──────
  const api = readJson(path.join(ROOT, 'apps', 'api', 'package.json'));
  const declared = api && api.dependencies && api.dependencies['puppeteer-core'];
  say(`  4. apps/api declares puppeteer-core: ${declared || '(not a prod dependency)'}`);
  if (declared && /\^?(\d+)/.test(declared)) {
    const declaredMajor = Number.parseInt(declared.replace(/^[^\d]*/, '').split('.')[0], 10);
    if (Number.isFinite(declaredMajor) && declaredMajor < FIRST_CLEAN_PUPPETEER_MAJOR) {
      fail(
        `apps/api/package.json declares puppeteer-core "${declared}", which allows a major ` +
          `below ${FIRST_CLEAN_PUPPETEER_MAJOR} and therefore allows extract-zip back in.`,
      );
    }
  }

  // ── 4. the Node floor the clean line requires ───────────────────────────
  // puppeteer-core 25.x and @puppeteer/browsers 3.x both declare
  // engines.node >= 22.12.0 AND are ESM-only. A base image below that would
  // fail at runtime, not here — but naming it keeps the two facts joined.
  const dockerfile = (() => {
    try {
      return fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    } catch {
      return '';
    }
  })();
  const nodeImage = /ARG NODE_IMAGE=(\S+)/.exec(dockerfile);
  say(`  5. runtime base image: ${nodeImage ? nodeImage[1].split('@')[0] : '(Dockerfile unreadable)'}`);
  if (nodeImage) {
    const major = /node:(\d+)-/.exec(nodeImage[1]);
    if (major && Number.parseInt(major[1], 10) < 22) {
      fail(
        `the runtime image is ${nodeImage[1].split('@')[0]}, but puppeteer-core ` +
          `${FIRST_CLEAN_PUPPETEER_MAJOR}.x / @puppeteer/browsers 3.x require Node >= 22.12.0 ` +
          'and are ESM-only. Rolling the base image back below Node 22 forces puppeteer-core ' +
          'back to 24.x, which re-introduces extract-zip.',
      );
    }
  }

  return { ok: failures.length === 0, lines, failures };
}

function main() {
  const { ok, lines, failures, indeterminate } = verify();
  console.log('extract-zip (GHSA-jmr9-qjv8-65gv) — production-closure regression guard');
  for (const l of lines) console.log(l);
  if (ok) {
    console.log('\nCLEAN: extract-zip is not in the production dependency graph. ✅');
    process.exit(0);
  }
  if (indeterminate) {
    console.error('\nINDETERMINATE — the production closure could not be enumerated:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('A check that cannot see the tree has not proved anything about it.');
    process.exit(2);
  }
  console.error(`\nREGRESSION (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { verify };
