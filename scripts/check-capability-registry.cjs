#!/usr/bin/env node
/*
 * Capability Registry gate — §21 verification-before-claim enforcement (2026-07-17).
 *
 * The enforcing CONSUMER of packages/api-types/src/capability-registry.ts. A
 * registry with no consumer is a dead catalog (the audit's widget-layer
 * anti-pattern); this gate is what makes it real. It fails CI when:
 *
 *   1. A VERIFIED / PRODUCTION / HARDWARE_CERTIFIED capability has no
 *      `evidenceTest`, OR its evidenceTest is a repo path that does not exist
 *      (a claim of proof with no proof).
 *   2. A capability carries a `publicClaim` while in a non-claimable state
 *      (NOT_BUILT / INTERNAL / EXPERIMENTAL / DEPRECATED / RETIRED) — i.e. a
 *      customer-facing claim for something not shippable.
 *   3. Duplicate capability ids, or a `dependsOn` pointing at an unknown id.
 *
 * WARN (not fail): a VERIFIED capability whose `expiresAt` is in the past
 * (stale evidence — surface it, but don't red the build on a date alone).
 *
 * Reads the registry from the built @cms/api-types dist if present, else
 * transpiles the source on the fly with the TS compiler API (no ts-node dep).
 * Exit 0 clean, 1 on a violation, 2 if the registry can't be loaded (a crashed
 * gate is never a pass — W0-05 discipline).
 *
 * NOTE: a CI job name (not a file path) is an allowed evidenceTest; it must
 * appear in KNOWN_CI_JOBS below so a typo can't masquerade as proof.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'packages', 'api-types', 'src', 'capability-registry.ts');
const DIST = path.join(REPO_ROOT, 'packages', 'api-types', 'dist', 'capability-registry.js');

// Evidence that is a CI job rather than a repo file. Keep in sync with the
// workflows; an evidenceTest naming a job not here is treated as unresolved.
const KNOWN_CI_JOBS = new Set([]);

function loadRegistry() {
  // Prefer the compiled dist (CI builds @cms/api-types before this runs).
  if (fs.existsSync(DIST)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(DIST);
    if (Array.isArray(mod.CAPABILITY_REGISTRY)) return mod;
  }
  // Fallback: transpile the source module in-memory.
  let ts;
  try {
    ts = require('typescript');
  } catch {
    throw new Error('no dist and `typescript` not installed — run `pnpm install --ignore-scripts` or build @cms/api-types');
  }
  const source = fs.readFileSync(SRC, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const Module = require('module');
  const m = new Module(SRC);
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  m._compile(js, SRC);
  return m.exports;
}

(function main() {
  let reg;
  try {
    reg = loadRegistry();
  } catch (e) {
    console.error(`FATAL: cannot load capability registry — treating as RED: ${e.message}`);
    process.exit(2);
  }
  const caps = reg.CAPABILITY_REGISTRY;
  const CLAIMABLE = reg.CLAIMABLE_STATES;
  const EVIDENCE_REQ = reg.EVIDENCE_REQUIRED_STATES;
  if (!Array.isArray(caps) || caps.length === 0) {
    console.error('FATAL: CAPABILITY_REGISTRY is empty or not an array — RED.');
    process.exit(2);
  }

  const errors = [];
  const warnings = [];
  const ids = new Set();
  const now = Date.now();

  for (const c of caps) {
    if (ids.has(c.id)) errors.push(`duplicate capability id: ${c.id}`);
    ids.add(c.id);

    const needsEvidence = EVIDENCE_REQ.has ? EVIDENCE_REQ.has(c.state) : false;
    if (needsEvidence) {
      if (!c.evidenceTest) {
        errors.push(`${c.id}: state ${c.state} requires an evidenceTest, but it is null.`);
      } else if (!KNOWN_CI_JOBS.has(c.evidenceTest)) {
        const abs = path.join(REPO_ROOT, c.evidenceTest);
        if (!fs.existsSync(abs)) {
          errors.push(`${c.id}: evidenceTest "${c.evidenceTest}" does not resolve to a repo file or known CI job.`);
        }
      }
    }

    const claimable = CLAIMABLE.has ? CLAIMABLE.has(c.state) : false;
    if (c.publicClaim && !claimable) {
      errors.push(`${c.id}: has a publicClaim ("${String(c.publicClaim).slice(0, 50)}…") but state ${c.state} is not customer-claimable.`);
    }

    for (const dep of c.dependsOn || []) {
      if (!caps.some((x) => x.id === dep)) errors.push(`${c.id}: dependsOn unknown capability "${dep}".`);
    }

    if (c.expiresAt && Date.parse(c.expiresAt) < now && EVIDENCE_REQ.has && EVIDENCE_REQ.has(c.state)) {
      warnings.push(`${c.id}: evidence expired ${c.expiresAt} — re-verify.`);
    }
  }

  console.log(`Capability registry: ${caps.length} capabilities checked.`);
  for (const w of warnings) console.log(`  ::warning:: ${w}`);

  if (errors.length) {
    console.error(`\nFAIL: ${errors.length} capability-truth violation(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nFix the registry to reflect reality (state, evidenceTest, publicClaim). Do NOT mark VERIFIED without evidence, and do NOT publicly claim an unbuilt feature.');
    process.exit(1);
  }
  console.log('OK: every VERIFIED capability has resolvable evidence; no unbuilt feature carries a public claim.');
  process.exit(0);
})();
