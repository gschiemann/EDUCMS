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

/**
 * WAIVERS — advisories with NO upstream fix whose vulnerable code path is
 * provably unreachable in our usage.
 *
 * Rules, so this never becomes a place to silence real findings:
 *   - Only for advisories where no fixed version exists. If a fix ships, pin a
 *     floor in root package.json `pnpm.overrides` instead and delete the entry.
 *   - `reason` must name the unreachable code path, not hand-wave.
 *   - `expires` is mandatory. Past that date the waiver STOPS applying and the
 *     gate goes red again, forcing a re-review. A waiver that silently lives
 *     forever is how a real vulnerability gets ignored.
 *   - A waived advisory is still printed, loudly, on every run.
 */
const WAIVERS = [
  {
    name: 'extract-zip',
    url: 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv',
    expires: '2026-11-15',
    reason:
      'No fixed version exists (advisory covers <=2.0.1, i.e. every published release). ' +
      'Reaches the prod graph only as puppeteer-core -> @puppeteer/browsers, whose ' +
      'extract-zip use is the browser DOWNLOAD-and-unzip path. apps/api/src/proxy/' +
      'renderer.service.ts launches with an explicit executablePath (PUPPETEER_EXECUTABLE_PATH ' +
      'or /usr/bin/chromium-browser) and never downloads a browser, so the symlink-traversal ' +
      'unzip path is unreachable. Re-check when @puppeteer/browsers drops extract-zip or a ' +
      'patched release lands.',
  },
];

/** Waiver for this finding, or null. Expired waivers deliberately do not match. */
function findWaiver(finding, today) {
  for (const w of WAIVERS) {
    if (w.name !== finding.name) continue;
    if (w.expires <= today) return { ...w, expired: true };
    return w;
  }
  return null;
}

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

/**
 * PRERELEASE BLIND SPOT (2026-09-02, appendix §B).
 *
 * `multer@1.4.5-lts.2` sat in the PROD graph with 8 HIGH advisories and this
 * gate was green. Not a bug in the enumerator — the npm bulk endpoint returns
 * NOTHING for that version, because semver ranges like `<2.0.0` do not match a
 * version carrying a PRERELEASE tag unless the range itself names a
 * prerelease with the same [major, minor, patch]. OSV returns all 8 for the
 * same string. So a package can be deprecated-by-its-own-author, in the
 * production graph, and invisible to this check forever.
 *
 * The fix is to ask the SAME endpoint about the base version too: for every
 * installed `X.Y.Z-tag`, also query `X.Y.Z`. A prerelease sorts BEFORE its
 * release, so anything that affects `X.Y.Z` under a `<W` range (W > X.Y.Z)
 * affects `X.Y.Z-tag` as well.
 *
 * Direction of error, stated plainly: this can OVER-report in one shape — a
 * `2.0.0-beta.1` whose advisory range starts exactly at `2.0.0` is flagged
 * even though the beta predates the vulnerable code. Over-reporting a
 * prerelease in a production dependency graph is the correct way to be wrong;
 * the alternative is what shipped 8 HIGH advisories under a green check.
 */

/** `1.4.5-lts.2` → `1.4.5`. Null for a plain release version or junk. */
function prereleaseBase(version) {
  const m = /^(\d+\.\d+\.\d+)-[0-9A-Za-z.-]+$/.exec(String(version || ''));
  return m ? m[1] : null;
}

/**
 * Split the collected closure into the versions we query directly and the
 * base-version aliases we must query on behalf of prerelease-tagged installs.
 *
 * @param pkgs Map<name, Set<version>> from `collectProdPackages`.
 * @returns {{ aliasQuery: Map<string, Set<string>>, aliasedBy: Map<string, string[]> }}
 *   `aliasQuery` is what to POST for the second pass; `aliasedBy` maps a
 *   package name to the INSTALLED prerelease versions the pass is standing in
 *   for, so a finding can name the version that is actually on disk.
 */
function prereleaseAliases(pkgs) {
  const aliasQuery = new Map();
  const aliasedBy = new Map();
  for (const [name, versions] of pkgs) {
    for (const v of versions) {
      const base = prereleaseBase(v);
      if (!base) continue;
      // Don't re-ask about a base that is ALSO installed — the direct pass
      // already covers it and a duplicate would double-report.
      if (versions.has(base)) continue;
      if (!aliasQuery.has(name)) aliasQuery.set(name, new Set());
      aliasQuery.get(name).add(base);
      if (!aliasedBy.has(name)) aliasedBy.set(name, []);
      if (!aliasedBy.get(name).includes(v)) aliasedBy.get(name).push(v);
    }
  }
  return { aliasQuery, aliasedBy };
}

/**
 * Merge second-pass (base-version) findings into the first-pass list, dropping
 * anything the direct pass already reported for the same package+advisory.
 *
 * @returns the findings to ADD (each tagged `viaPrerelease`).
 */
function mergeAliasFindings(direct, alias, aliasedBy) {
  const seen = new Set(direct.map((f) => `${f.name} ${f.url || f.title}`));
  const out = [];
  for (const f of alias) {
    const key = `${f.name} ${f.url || f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...f, viaPrerelease: aliasedBy.get(f.name) || [] });
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

/** POST one Map<name, Set<version>> and flatten the response into findings. */
async function queryFindings(pkgs) {
  const entries = [...pkgs.entries()];
  const findings = [];
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
  return findings;
}

async function main() {
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

  const findings = [];
  try {
    findings.push(...(await queryFindings(pkgs)));

    // SECOND PASS — the prerelease blind spot. See `prereleaseAliases` above:
    // npm returns nothing for a version carrying a prerelease tag, so we ask
    // again about its base version and attribute any hit to the tagged version
    // that is actually installed.
    const { aliasQuery, aliasedBy } = prereleaseAliases(pkgs);
    if (aliasQuery.size > 0) {
      const installed = [...aliasedBy.entries()]
        .map(([n, vs]) => `${n}@${vs.join(',')}`)
        .join(' ');
      console.log(
        `Prerelease-tagged prod packages re-checked against their base versions: ${installed}`,
      );
      const aliasFindings = await queryFindings(aliasQuery);
      const extra = mergeAliasFindings(findings, aliasFindings, aliasedBy);
      if (extra.length > 0) {
        console.log(
          `  → ${extra.length} advisor${extra.length === 1 ? 'y' : 'ies'} the direct query could not see.`,
        );
      }
      findings.push(...extra);
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
    const via = f.viaPrerelease?.length
      ? ` [installed as ${f.viaPrerelease.join(', ')} — matched via its base version; npm's ranges do not match prerelease tags]`
      : '';
    console.log(`  [${f.severity.toUpperCase()}] ${f.name} (vulnerable: ${f.vulnerable}) — ${f.title} ${f.url}${via}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const blocking = [];
  const waived = [];
  for (const f of findings.filter((x) => FAIL_SEVERITIES.has(x.severity))) {
    const w = findWaiver(f, today);
    if (w && !w.expired) waived.push({ ...f, waiver: w });
    else blocking.push({ ...f, expiredWaiver: w ? w.expires : null });
  }

  if (waived.length > 0) {
    console.log(`\nWAIVED (${waived.length}) — no upstream fix, vulnerable path unreachable here:`);
    for (const f of waived) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.name} — waiver expires ${f.waiver.expires}`);
      console.log(`      ${f.waiver.reason}`);
    }
    console.log('  Waivers are reviewed on expiry. See WAIVERS in scripts/npm-advisory-audit.cjs.');
  }

  if (blocking.length > 0) {
    console.error(`\nFAIL: ${blocking.length} HIGH/CRITICAL prod advisor${blocking.length === 1 ? 'y' : 'ies'}. Pin a fix floor in root package.json pnpm.overrides.`);
    for (const f of blocking) {
      if (f.expiredWaiver) {
        console.error(`  NOTE: ${f.name} had a waiver that EXPIRED on ${f.expiredWaiver} — re-review it, then extend or fix.`);
      }
    }
    process.exit(1);
  }
  console.log('\nOK: no HIGH/CRITICAL prod advisories (moderate/low reported above do not gate).');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { prereleaseBase, prereleaseAliases, mergeAliasFindings, findWaiver };
