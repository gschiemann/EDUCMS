#!/usr/bin/env node
/**
 * PROOF for the picomatch waiver in scripts/npm-advisory-audit.cjs (2026-11-17).
 *
 * THE ADVISORY. GHSA-fc5q-39xc-vjpf / CVE-2026-112366, high: picomatch through
 * 4.0.7 compiles a single-branch repeated extglob such as `+(*)` or `+(*a)`
 * into a regular expression that backtracks exponentially, so whoever SUPPLIES
 * THE GLOB PATTERN can block the event loop. Published 2026-10-19; widened on
 * 2026-11-17 to `<= 4.0.7`, the newest release, so no fixed version exists and
 * no override can pin one.
 *
 * THE CLAIM THIS FILE RE-DERIVES, on every run of the gate, against the tree
 * as installed:
 *
 *   1. picomatch is in the PRODUCTION closure of `web` only. It is not in the
 *      closure of `api` or `renderer`, the two long-running servers that
 *      parse requests.
 *   2. Inside `web` it arrives only under @sentry/nextjs and next-intl, and
 *      its direct parents are bundler and file-watcher tooling
 *      (@rollup/plugin-commonjs, @rollup/pluginutils, fdir, @parcel/watcher).
 *      Those compile globs that come from plugin configuration at build time,
 *      not from a request.
 *   3. No first-party source file imports a glob matcher at all, so no code of
 *      ours can hand a string from a request to one.
 *
 * If any of the three stops being true - a new parent, a new importer, a
 * first-party `import picomatch` - `verify()` fails, the waiver stops applying
 * and the gate goes red again. That is the point of a proof instead of prose.
 *
 * WHAT IT DOES NOT CLAIM. It does not read the parents' source to show how
 * they call picomatch; it pins WHICH packages may bring it in and leaves a
 * new one to a human. It says nothing about the development graph, which the
 * gate does not audit.
 *
 * Run by hand:  node scripts/check-picomatch-unreachable.cjs
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE = 'picomatch';

/** Workspace projects whose production closure may contain picomatch. */
const ALLOWED_IMPORTERS = new Set(['web']);
/** The top-level dependencies it may arrive under. */
const ALLOWED_ROOTS = new Set(['@sentry/nextjs', 'next-intl']);
/** The packages that may depend on it directly: build and watch tooling. */
const ALLOWED_PARENTS = new Set([
  '@rollup/plugin-commonjs',
  '@rollup/pluginutils',
  'fdir',
  '@parcel/watcher',
]);

/**
 * A line that loads a glob matcher: picomatch, micromatch, anymatch, minimatch,
 * fast-glob, tinyglobby, glob, globby or chokidar, by `from`, `require(` or
 * `import(`, with or without a subpath. Written as a literal on purpose: no
 * pattern is assembled from strings here.
 */
const MATCHER_IMPORT =
  /(?:from\s+|require\(\s*|import\(\s*)['"](?:picomatch|micromatch|anymatch|minimatch|fast-glob|tinyglobby|glob|globby|chokidar)(?:\/[^'"]*)?['"]/;
const SOURCE_ROOTS = ['apps/api/src', 'apps/web/src', 'apps/renderer/src', 'apps/edge/src', 'packages'];
const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.next', '.turbo', 'build', 'coverage', 'generated']);

/**
 * Every path from a workspace project to picomatch in the production closure.
 * @returns {{ ok: true, paths: Array<{ importer: string, chain: string[] }>, importers: string[] } | { ok: false, why: string }}
 */
function productionPaths() {
  const res = spawnSync('pnpm', ['ls', '-r', '--prod', '--depth', 'Infinity', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) return { ok: false, why: `could not run pnpm ls: ${res.error.message}` };
  if (res.status !== 0) return { ok: false, why: `pnpm ls exited ${res.status}: ${(res.stderr || '').slice(0, 400)}` };
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    return { ok: false, why: `pnpm ls did not emit parseable JSON: ${e.message}` };
  }
  const projects = Array.isArray(parsed) ? parsed : [parsed];
  const paths = [];
  let seenAnyDependency = false;
  const walk = (importer, deps, chain) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, node] of Object.entries(deps)) {
      if (!node || typeof node !== 'object') continue;
      seenAnyDependency = true;
      const next = chain.concat(name);
      if (name === PACKAGE) paths.push({ importer, chain: next });
      walk(importer, node.dependencies, next);
      walk(importer, node.optionalDependencies, next);
    }
  };
  for (const p of projects) {
    walk(String(p.name || '(unnamed)'), p.dependencies, []);
    walk(String(p.name || '(unnamed)'), p.optionalDependencies, []);
  }
  if (!seenAnyDependency) {
    return { ok: false, why: 'the production closure enumerated as EMPTY: a broken check, not a clean tree' };
  }
  return { ok: true, paths, importers: projects.map((p) => String(p.name || '(unnamed)')) };
}

/** First-party files that import a glob matcher. */
function firstPartyMatcherImports() {
  const hits = [];
  let scanned = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name));
        continue;
      }
      if (!SOURCE_EXT.test(e.name)) continue;
      if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(e.name)) continue;
      const file = path.join(dir, e.name);
      scanned += 1;
      const text = fs.readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (MATCHER_IMPORT.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
  };
  for (const r of SOURCE_ROOTS) walk(path.join(ROOT, r));
  return { hits, scanned };
}

function verify() {
  const lines = [];
  const failures = [];

  const closure = productionPaths();
  if (!closure.ok) return { ok: false, lines, failures: [closure.why], indeterminate: true };

  const importers = [...new Set(closure.paths.map((p) => p.importer))].sort();
  const roots = [...new Set(closure.paths.map((p) => p.chain[0]))].sort();
  const parents = [...new Set(closure.paths.map((p) => p.chain[p.chain.length - 2]).filter(Boolean))].sort();

  lines.push(`1. production closures holding ${PACKAGE}: ${importers.join(', ') || '(none)'} (of ${closure.importers.length} workspace projects)`);
  for (const i of importers) {
    if (!ALLOWED_IMPORTERS.has(i)) failures.push(`${PACKAGE} is now in the production closure of "${i}"; only ${[...ALLOWED_IMPORTERS].join(', ')} was reviewed`);
  }
  lines.push(`2. it arrives under: ${roots.join(', ') || '(nothing)'}; direct parents: ${parents.join(', ') || '(none)'}`);
  for (const r of roots) {
    if (!ALLOWED_ROOTS.has(r)) failures.push(`${PACKAGE} now arrives under "${r}", which was not reviewed`);
  }
  for (const p of parents) {
    if (!ALLOWED_PARENTS.has(p)) failures.push(`"${p}" now depends on ${PACKAGE} directly; it is not on the reviewed list of build and watch tooling`);
  }
  if (closure.paths.some((p) => p.chain.length < 2)) {
    failures.push(`${PACKAGE} is a DIRECT production dependency of a workspace project`);
  }

  const scan = firstPartyMatcherImports();
  lines.push(`3. first-party files importing a glob matcher: ${scan.hits.length} (of ${scan.scanned} source files scanned)`);
  if (scan.scanned === 0) failures.push('the source scan found no files at all: a broken check, not a clean tree');
  for (const h of scan.hits) failures.push(`${h} imports a glob matcher; show that no request data reaches its pattern, or remove it`);

  return { ok: failures.length === 0, lines, failures };
}

module.exports = { verify, MATCHER_IMPORT, ALLOWED_IMPORTERS, ALLOWED_ROOTS, ALLOWED_PARENTS };

if (require.main === module) {
  const { ok, lines, failures, indeterminate } = verify();
  for (const l of lines) console.log(l);
  if (ok) {
    console.log(`OK: ${PACKAGE} is reachable only from reviewed build tooling.`);
    process.exit(0);
  }
  console.error(indeterminate ? 'INDETERMINATE: the check could not run.' : `FAIL: the ${PACKAGE} unreachability claim no longer holds.`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(indeterminate ? 2 : 1);
}
