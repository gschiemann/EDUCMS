#!/usr/bin/env node
/**
 * Production dependency advisory gate — bulk-endpoint edition (2026-07-16).
 *
 * Replaces `pnpm audit --prod --audit-level high`, which broke on every push:
 * npm retired the legacy audit endpoint it calls
 * (`/-/npm/v1/security/audits` now returns HTTP 410 "use the bulk advisory
 * endpoint"). Verified before writing this — pnpm 9.0.0, 9.15.9, AND 10.15.1
 * all still call the dead endpoint, so no version bump fixes it.
 *
 * This preserves the ORIGINAL gate's exact contract — audit the PRODUCTION
 * graph, fail on HIGH/CRITICAL — using npm's replacement API with zero new
 * dependencies:
 *
 *   1. Ask pnpm itself for the authoritative prod closure
 *      (`pnpm ls -r --prod --depth Infinity --json`). Using pnpm's own
 *      resolution avoids coupling to the lockfile's on-disk format and keeps
 *      dev-only advisories out of scope — exactly what `--prod` did.
 *   2. POST the deduped name@version set to the bulk advisories endpoint
 *      (`registry.npmjs.org/-/npm/v1/security/advisories/bulk`), which returns
 *      only advisories affecting the submitted versions.
 *   3. Exit 1 on any HIGH or CRITICAL; report moderate/low without failing
 *      (same thresholds as `--audit-level high`). Fix floors live in root
 *      package.json `pnpm.overrides`.
 *   4. Exit 2 on any inability to determine scope or reach the endpoint — an
 *      outage or a broken enumerator must be a visible RED, never a silent
 *      green (W0-05 discipline: a crashed check is not a pass).
 *
 * Requires node_modules to be present (CI installs before running this).
 * Revert path: when `pnpm audit --prod` speaks the bulk endpoint, the CI job
 * can switch back and this script can retire.
 */

const { spawnSync } = require('child_process');

const BULK_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const CHUNK = 800; // package names per request — well under endpoint limits
const FAIL_SEVERITIES = new Set(['high', 'critical']);

/** Deduped `name -> Set(version)` for the entire production closure. */
function collectProdPackages() {
  const res = spawnSync(
    'pnpm',
    ['ls', '-r', '--prod', '--depth', 'Infinity', '--json'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0 || !res.stdout) {
    throw new Error(
      `pnpm ls failed (status ${res.status}). Is node_modules installed? ${(res.stderr || '').slice(0, 300)}`,
    );
  }
  let tree;
  try {
    tree = JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`could not parse pnpm ls JSON: ${e.message}`);
  }

  const out = new Map();
  const add = (name, version) => {
    if (!name || !version || !/^\d/.test(version)) return; // skip links/workspace refs
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(version);
  };
  const walk = (deps) => {
    if (!deps) return;
    for (const [name, node] of Object.entries(deps)) {
      if (!node || typeof node !== 'object') continue;
      add(name, node.version);
      walk(node.dependencies);
      walk(node.optionalDependencies);
    }
  };
  for (const importer of Array.isArray(tree) ? tree : [tree]) {
    walk(importer.dependencies);
    walk(importer.optionalDependencies);
    // NOT devDependencies — this is the --prod contract.
  }
  return out;
}

async function postChunk(entries) {
  const body = {};
  for (const [name, versions] of entries) body[name] = [...versions];
  const res = await fetch(BULK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bulk advisory endpoint HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

(async () => {
  let pkgs;
  try {
    pkgs = collectProdPackages();
  } catch (e) {
    console.error(`FATAL: cannot enumerate the production graph — treating as RED: ${e.message}`);
    process.exit(2);
  }

  if (pkgs.size < 50) {
    // This monorepo's prod closure is ~800 packages — a tiny count means the
    // enumerator broke, and a broken enumerator must not pass as "all clear."
    console.error(`FATAL: prod enumeration produced only ${pkgs.size} packages — drift, refusing to green-light.`);
    process.exit(2);
  }
  console.log(`Auditing ${pkgs.size} production packages against npm bulk advisories…`);

  const entries = [...pkgs.entries()];
  const findings = [];
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const data = await postChunk(entries.slice(i, i + CHUNK));
      for (const [name, advisories] of Object.entries(data || {})) {
        for (const adv of advisories || []) {
          findings.push({
            name,
            severity: String(adv.severity || 'unknown').toLowerCase(),
            title: adv.title || '(untitled advisory)',
            url: adv.url || '',
            vulnerable: adv.vulnerable_versions || '?',
          });
        }
      }
    }
  } catch (e) {
    console.error(`FATAL: advisory lookup failed — treating as RED, not green: ${e.message}`);
    process.exit(2);
  }

  const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const f of findings) bySeverity[f.severity in bySeverity ? f.severity : 'unknown'] += 1;

  if (findings.length === 0) {
    console.log('No known advisories affect any production package version. ✅');
    process.exit(0);
  }

  console.log(`Prod advisories: critical=${bySeverity.critical} high=${bySeverity.high} moderate=${bySeverity.moderate} low=${bySeverity.low}`);
  for (const f of findings.sort((a, b) => a.severity.localeCompare(b.severity))) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.name} (vulnerable: ${f.vulnerable}) — ${f.title} ${f.url}`);
  }

  const blocking = findings.filter((f) => FAIL_SEVERITIES.has(f.severity));
  if (blocking.length > 0) {
    console.error(`\nFAIL: ${blocking.length} HIGH/CRITICAL prod advisor${blocking.length === 1 ? 'y' : 'ies'}. Pin a fix floor in root package.json pnpm.overrides.`);
    process.exit(1);
  }
  console.log('\nOK: no HIGH/CRITICAL prod advisories (moderate/low reported above do not gate).');
  process.exit(0);
})();
