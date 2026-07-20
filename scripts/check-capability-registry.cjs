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

// ── TRUTH-001: public-surface claim scan (2026-07-20) ─────────────────────
// High-risk feature phrases appearing on PUBLIC surfaces must map to a
// registered capability in a customer-claimable state. Deterministic curated
// regex list — no NLP, no false-positive machine. Entries whose capability is
// NOT registered are TRIPWIRES: the moment marketing copy adds that phrase,
// CI reds until a real capability is registered honestly (or the copy is cut).
const PUBLIC_SURFACES = [
  'apps/web/src/app/page.tsx', // marketing landing
  'apps/web/src/app/signup/page.tsx', // signup promises
];

const CLAIM_PHRASES = [
  { re: /\bSAML\b/i, capability: 'saml-sso', label: 'SAML SSO' },
  { re: /\bSSO\b|single sign[- ]?on/i, capability: 'oidc-multi-replica-login', label: 'SSO sign-in' },
  { re: /\bClever\b/, capability: 'clever-rostering', label: 'Clever rostering' },
  { re: /free (trial|pilot)|no credit card/i, capability: 'free-trial-14d-3screen', label: 'free trial' },
  { re: /per screen per month|\$25[^0-9][^.]{0,24}screen/i, capability: 'pricing-plan-truth', label: 'per-screen pricing' },
  { re: /\bIPAWS\b/i, capability: 'ipaws-inbound', label: 'IPAWS alerts' },
  { re: /Common Alerting Protocol|\bCAP feeds\b/i, capability: 'cap-inbound', label: 'CAP alerts' },
  { re: /\bCanva\b/i, capability: 'canva-import', label: 'Canva import' },
  { re: /\bFigma\b/i, capability: 'figma-import', label: 'Figma import' },
  { re: /Google Slides|PowerPoint Online/i, capability: 'slides-import', label: 'cloud slides import' },
  // FERPA/COPPA on signup are links to our PUBLISHED policy commitments —
  // backed by a registered capability. Certification-style claims (SOC 2 /
  // HIPAA / PCI) remain unregistered tripwires: we hold no such attestations.
  { re: /\bFERPA\b|\bCOPPA\b/i, capability: 'ferpa-coppa-commitments', label: 'FERPA/COPPA commitments' },
  { re: /\bSOC ?2\b|\bHIPAA\b|\bPCI[- ]DSS\b/i, capability: 'compliance-attestation', label: 'compliance attestation' },
  { re: /99\.9\d*\s?%|uptime (guarantee|SLA)/i, capability: 'uptime-sla', label: 'uptime SLA' },
];

/** Scan public surfaces for claim phrases lacking a claimable capability.
 *  `surfaces` may be injected for tests: [{file, text}]. Returns problem strings. */
function scanPublicClaims(caps, claimableStates, surfaces) {
  const byId = new Map(caps.map((c) => [c.id, c]));
  const list =
    surfaces ||
    PUBLIC_SURFACES.map((rel) => {
      const abs = path.join(REPO_ROOT, rel);
      return fs.existsSync(abs) ? { file: rel, text: fs.readFileSync(abs, 'utf8') } : null;
    }).filter(Boolean);
  const problems = [];
  for (const s of list) {
    for (const p of CLAIM_PHRASES) {
      if (!p.re.test(s.text)) continue;
      const cap = byId.get(p.capability);
      if (!cap) {
        problems.push(
          `${s.file}: public copy claims "${p.label}" but capability "${p.capability}" is not registered — register it honestly or cut the copy.`,
        );
      } else if (!(claimableStates.has ? claimableStates.has(cap.state) : false)) {
        problems.push(
          `${s.file}: public copy claims "${p.label}" but capability "${p.capability}" is ${cap.state} — not customer-claimable.`,
        );
      }
    }
  }
  return problems;
}

module.exports = { scanPublicClaims, CLAIM_PHRASES, PUBLIC_SURFACES };

function main() {
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

  // TRUTH-001 — public marketing/signup copy must not out-claim the registry.
  const claimProblems = scanPublicClaims(caps, CLAIMABLE);
  errors.push(...claimProblems);

  console.log(`Capability registry: ${caps.length} capabilities checked; TRUTH-001 scanned ${PUBLIC_SURFACES.length} public surfaces × ${CLAIM_PHRASES.length} claim phrases.`);
  for (const w of warnings) console.log(`  ::warning:: ${w}`);

  if (errors.length) {
    console.error(`\nFAIL: ${errors.length} capability-truth violation(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nFix the registry to reflect reality (state, evidenceTest, publicClaim). Do NOT mark VERIFIED without evidence, and do NOT publicly claim an unbuilt feature.');
    process.exit(1);
  }
  console.log('OK: every VERIFIED capability has resolvable evidence; no unbuilt feature carries a public claim; public copy is registry-backed.');
  process.exit(0);
}

if (require.main === module) main();
