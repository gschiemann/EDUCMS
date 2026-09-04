#!/usr/bin/env node
/*
 * Tenant-isolation static gate (audit TEN-001 / §16, 2026-07-17).
 *
 * The audit's finding: "tenant scope depends on controller convention" — there
 * is no framework backstop, so a bare-id Prisma lookup on a tenant-owned model
 * (`prisma.client.template.findUnique({ where: { id } })`) lets a tenant-A user
 * pass a tenant-B object id and read/mutate another tenant's data unless the
 * caller ALSO constrains `tenantId` (or checks ownership right after). That is
 * a cross-tenant data-leak class.
 *
 * This guard parses every TypeScript file under apps/api/src (compiler API — the
 * same AST approach as apps/web/tools/check-inset-serialization.cjs, no new
 * dep) and flags a call of the form:
 *
 *     <expr>.<tenantOwnedModel>.(findUnique|findFirst|update|delete|upsert)(
 *        { where: { id: ... } , ... }   // where has `id` but NO `tenantId`
 *     )
 *
 * A `where` that also carries `tenantId` — or a compound unique key that
 * includes tenant — is SAFE and not flagged. A lookup that is genuinely safe
 * because ownership is asserted on the NEXT line cannot be seen statically, so
 * it is flagged conservatively (a false positive costs one baseline entry; a
 * false negative is a breach). Existing hits are captured in
 * tenant-isolation-baseline.json so the gate is GREEN today and FAILS only on
 * a NEW unscoped access — baseline ratchets DOWN only, mirroring
 * taurus-safety / .a11y-baseline discipline.
 *
 * Exit 0 = no new unscoped access. Exit 1 = a new regression (or a stale
 * baseline entry mismatch). Exit 2 = the analyzer itself broke (a crashed
 * gate is never a pass — W0-05 discipline).
 *
 * Regenerate the baseline deliberately after review:  UPDATE_BASELINE=1 node apps/api/tools/check-tenant-isolation.cjs
 *
 * REVIEWED-SAFE ESCAPE HATCH (2026-07-20 burn-down): a site that is safe BY
 * DESIGN can carry `// ten-ok: <reason>` on the call's first line or the line
 * directly above it (mirrors perf-allow / taurus-safety culture — the reason is
 * mandatory and shows up in PR review). Legitimate uses ONLY:
 *   (a) ownership RESOLVERS — read an entity's tenantId in order to verify the
 *       caller owns it immediately after (403 on mismatch);
 *   (b) identity-derived self-lookups — the id IS the authenticated principal
 *       (device token sub, JWT sub), so there is no narrower scope;
 *   (c) system/webhook paths with no caller tenant, where tenant scope is
 *       derived FROM the row and verified against the event source.
 * An annotated site is reported as reviewed-safe and leaves the baseline —
 * "I'll check ownership later, trust me" is NOT a valid reason; scope the query
 * instead.
 *
 * ─── SEC-009 (2026-09-04): THE RATCHET NOW ACTUALLY RATCHETS ────────────────
 *
 * The independent security audit's finding was that a passing gate proved only
 * "no NEW unapproved pattern" while 180 grandfathered fingerprints sat in the
 * baseline forever, certified by nobody. Two holes made that permanent:
 *
 *   1. A fingerprint that no longer matched anything STAYED in the file. Since
 *      a fingerprint is path + model.method + a hash of the where clause, a
 *      developer who later re-introduced that exact query got grandfathered
 *      again, silently. So: a STALE baseline entry is now a FAILURE. Once a
 *      site is fixed, its grandfathering is gone for good.
 *   2. `UPDATE_BASELINE=1` would happily write a BIGGER baseline, which turned
 *      the one-way ratchet into a suggestion. It now refuses to write a count
 *      above BASELINE_CEILING, and the ceiling only ever moves down (lower it
 *      in the same commit that lowers the baseline — that edit is the review).
 *
 * Together those mean the number below can only fall. It is not a target to
 * hit by annotating; a `ten-ok` still has to name the invariant that makes the
 * site safe, and the two-tenant role matrix
 * (apps/api/src/tenant-isolation/two-tenant-role-matrix.spec.ts) is what
 * actually proves tenant A cannot reach tenant B.
 */

/**
 * Hard ceiling on grandfathered entries. LOWER THIS as sites are fixed; never
 * raise it. 2026-07-17 first baseline: 214. 2026-07-20 burn-down: 180.
 * 2026-09-04 SEC-009 remediation: 74 (everything outside sports/** and
 * screens.controller.ts converted to a compound tenant predicate or annotated).
 */
const BASELINE_CEILING = 74;

const fs = require('fs');
const path = require('path');
let ts;
try {
  ts = require('typescript');
} catch (e) {
  console.error('FATAL: `typescript` not installed. Run `pnpm install --ignore-scripts` first.');
  process.exit(2);
}

const TOOLS_DIR = __dirname; // apps/api/tools
const REPO_ROOT = path.resolve(TOOLS_DIR, '..', '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src');
const BASELINE_PATH = path.join(TOOLS_DIR, 'tenant-isolation-baseline.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages', 'database', 'prisma', 'schema.prisma');

const RISKY_METHODS = new Set(['findUnique', 'findFirst', 'update', 'delete', 'upsert']);

/** Derive the tenant-owned model set from schema.prisma: any `model X` whose
 *  body contains a `tenantId` field. Keeps the gate in sync with the schema
 *  automatically instead of hard-coding a list that drifts. */
function tenantOwnedAccessors() {
  const src = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const models = new Set();
  const re = /model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    if (/\btenantId\b/.test(body)) {
      // Prisma client accessor = model name with first letter lower-cased.
      models.add(name[0].toLowerCase() + name.slice(1));
    }
  }
  return models;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (e.isFile() && /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(abs);
    }
  }
}

/** From an object-literal `where` node, does it have a top-level `id` key and
 *  NO `tenantId` key and NO compound key that mentions tenant? */
/**
 * GATE-01 STEP 2 (2026-08-04) — peel casts and parens before any structural test.
 *
 * The gate matched on the SYNTAX of the argument, so the extremely common
 * `{ where: { id } } as any` wrapped the object literal in an AsExpression and
 * `ts.isObjectLiteralExpression` returned false — the call became invisible.
 * A cast is exactly what a developer writes when Prisma's types complain,
 * which made "add `as any`" an accidental way to silence the gate.
 */
function unwrapExpr(node) {
  let n = node;
  while (
    n &&
    (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isParenthesizedExpression(n))
  ) {
    n = n.expression;
  }
  return n;
}

function whereIsUnscopedById(whereObj) {
  whereObj = unwrapExpr(whereObj);
  if (!ts.isObjectLiteralExpression(whereObj)) return false;
  let hasId = false;
  let hasTenant = false;
  for (const prop of whereObj.properties) {
    let key = null;
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const n = prop.name;
      if (n && (ts.isIdentifier(n) || ts.isStringLiteralLike(n))) key = n.text;
    }
    if (!key) continue;
    if (key === 'id') hasId = true;
    if (key === 'tenantId') hasTenant = true;
    // A compound unique that includes tenant, e.g. `id_tenantId` or `tenantId_slug`.
    if (/tenant/i.test(key)) hasTenant = true;
  }
  return hasId && !hasTenant;
}

/** Find the `where:` object literal in a call's first argument. */
function whereArg(callExpr) {
  const arg0 = unwrapExpr(callExpr.arguments[0]);
  if (!arg0 || !ts.isObjectLiteralExpression(arg0)) return null;
  for (const prop of arg0.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      prop.name &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'where'
    ) {
      return prop.initializer;
    }
  }
  return null;
}

function fingerprint(relPath, model, method, whereText) {
  // Line-independent: path + model.method + a short digest of the where clause.
  const norm = whereText.replace(/\s+/g, ' ').trim();
  let h = 0;
  for (let i = 0; i < norm.length; i++) h = (h * 31 + norm.charCodeAt(i)) | 0;
  return `${relPath}::${model}.${method}::${(h >>> 0).toString(36)}`;
}

/** Scan one source string for unscoped bare-id tenant-resource access.
 *  Factored out so tests can exercise it on inline fixtures. */
// A reviewed-safe annotation is a `ten-ok:` comment WITH a real reason (≥10
// chars) on the call's first line or the line directly above. `//` or `*`
// prefix so a string literal can't accidentally arm it.
const TEN_OK_RE = /(?:\/\/|\*)\s*ten-ok:\s*\S.{9,}/;

function scanSourceText(text, relPath, accessors) {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split(/\r?\n/);
  const findings = [];
  findings.reviewed = []; // reviewed-safe (ten-ok annotated) sites, non-enumerable via spread
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      RISKY_METHODS.has(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression)
    ) {
      const method = node.expression.name.text;
      const model = node.expression.expression.name.text; // the `.template` in `x.template.findUnique`
      if (accessors.has(model)) {
        const where = whereArg(node);
        if (where && whereIsUnscopedById(where)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          // GATE-01 STEP 3 (2026-08-04) — accept a `ten-ok:` anywhere in the
          // CONTIGUOUS `//` comment block directly above the call, not just on
          // the single line above it.
          //
          // Step 2 above makes cast-wrapped calls visible, and several of them
          // already carry a real multi-line justification written by their
          // author — under the old one-line window those would fail CI despite
          // the reason sitting right there, and the practical response would
          // be to cram it onto one line or reach for UPDATE_BASELINE. Neither
          // improves safety.
          //
          // The block still has to TOUCH the call: a blank line or any code
          // between breaks it, so a stale annotation cannot drift onto an
          // unrelated query below it.
          const annotated = (() => {
            if (TEN_OK_RE.test(lines[line] || '')) return true;
            for (let i = line - 1; i >= 0; i--) {
              const text = (lines[i] || '').trim();
              if (text === '') break;                 // blank line ends the block
              if (TEN_OK_RE.test(text)) return true;
              const isComment =
                text.startsWith('//') || text.startsWith('*') || text.startsWith('/*');
              if (!isComment) break;                  // hit code — stop
            }
            return false;
          })();
          if (annotated) {
            findings.reviewed.push({ file: relPath, line: line + 1, model, method });
          } else {
            findings.push({
              fp: fingerprint(relPath, model, method, where.getText(sf)),
              file: relPath,
              line: line + 1,
              model,
              method,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function scan() {
  const accessors = tenantOwnedAccessors();
  if (accessors.size < 10) {
    console.error(`FATAL: only ${accessors.size} tenant-owned models parsed from schema — parser drift, refusing to green-light.`);
    process.exit(2);
  }
  const files = [];
  walk(SCAN_ROOT, files);
  const findings = [];
  let reviewedCount = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const r = scanSourceText(text, path.relative(REPO_ROOT, file), accessors);
    findings.push(...r);
    reviewedCount += r.reviewed ? r.reviewed.length : 0;
  }
  return { findings, modelCount: accessors.size, reviewedCount };
}

module.exports = { scanSourceText, whereIsUnscopedById, tenantOwnedAccessors };

function loadBaseline() {
  try {
    const j = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const set = new Set(j.fingerprints || []);
    // SEC-009: the RAW count matters as well as the fingerprint set. A
    // fingerprint is path + model.method + a hash of the where clause, so two
    // identical unscoped calls in the same file collapse to one entry —
    // meaning a second copy of an already-grandfathered query would otherwise
    // slip in as "not new". The count closes that.
    set.recordedCount = typeof j.count === 'number' ? j.count : set.size;
    return set;
  } catch {
    return null;
  }
}

function main() {
  const { findings, modelCount, reviewedCount } = scan();
  const current = findings.map((f) => f.fp);
  console.log(
    `Tenant-isolation scan: ${modelCount} tenant-owned models, ${findings.length} unscoped bare-id access(es), ` +
    `${reviewedCount} reviewed-safe (ten-ok) in apps/api/src.`,
  );

  if (process.env.UPDATE_BASELINE === '1') {
    // SEC-009: the ratchet is one-way. Regenerating can only ever shrink the
    // grandfathered set; growing it requires a deliberate edit to
    // BASELINE_CEILING above, which is what a reviewer sees in the diff.
    if (findings.length > BASELINE_CEILING) {
      console.error(
        `\nFAIL: refusing to write a baseline of ${findings.length} — the ceiling is ${BASELINE_CEILING} (SEC-009).\n` +
        'Scope the new query with a compound `{ id, tenantId }` predicate, or annotate the site with\n' +
        '`// ten-ok: <the invariant that makes it safe>`. Raising BASELINE_CEILING is not the fix.',
      );
      process.exit(1);
    }
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comment: 'Unscoped bare-id Prisma access on tenant-owned models (TEN-001 / SEC-009). Ratchets DOWN only — a stale entry FAILS the gate, so a fixed site can never be silently re-grandfathered. Regenerate deliberately: UPDATE_BASELINE=1 node apps/api/tools/check-tenant-isolation.cjs',
          ceiling: BASELINE_CEILING,
          count: findings.length,
          fingerprints: current.sort(),
          detail: findings.map((f) => `${f.file}:${f.line} ${f.model}.${f.method}`).sort(),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`Baseline written (${findings.length} entries).`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error('FATAL: no baseline. Create it once with UPDATE_BASELINE=1 after review.');
    process.exit(2);
  }

  // SEC-009 guard #1 — a baseline file that has grown past the ceiling (hand
  // edited, or restored from an older commit) is not a pass. `baseline.size`
  // counts UNIQUE fingerprints and the ceiling counts raw findings; unique is
  // always ≤ raw, so this is the conservative direction — it fires only when
  // the file is unambiguously inflated.
  if (baseline.size > BASELINE_CEILING) {
    console.error(
      `\nFAIL: the baseline holds ${baseline.size} grandfathered entries but the ceiling is ${BASELINE_CEILING} (SEC-009).\n` +
      'The ratchet only turns one way. Regenerate from a clean tree, or fix the sites.',
    );
    process.exit(1);
  }

  // SEC-009 guard #1b — the raw count may never grow either, so a SECOND copy
  // of an already-grandfathered query cannot ride in on the first one's
  // fingerprint.
  if (findings.length > baseline.recordedCount) {
    console.error(
      `\nFAIL: ${findings.length} unscoped access(es) but the baseline recorded ${baseline.recordedCount}.\n` +
      'Every fingerprint is known, so this is a DUPLICATE of a grandfathered query — the same unscoped\n' +
      'call written a second time in the same file. Scope it with `{ id, tenantId }` instead.',
    );
    process.exit(1);
  }

  const isNew = findings.filter((f) => !baseline.has(f.fp));
  if (isNew.length > 0) {
    console.error(`\nFAIL: ${isNew.length} NEW unscoped tenant-resource access(es) — a bare id: lookup on a tenant-owned model with no tenantId constraint is a cross-tenant leak:`);
    for (const f of isNew) {
      console.error(`  ${f.file}:${f.line}  ${f.model}.${f.method}({ where: { id, /* NO tenantId */ } })`);
    }
    console.error('\nFix: add tenantId to the where clause (or assert ownership), then re-run. Do NOT add to the baseline to get green.');
    process.exit(1);
  }

  // SEC-009 guard #2 — a baseline entry that no longer matches any finding is
  // STALE, and a stale entry is a live re-grandfathering slot: re-introduce the
  // same query in the same file and the gate would wave it through. Removing it
  // is a one-line regenerate, and the ceiling above means that regenerate can
  // only shrink the file.
  const currentFps = new Set(current);
  const stale = [...baseline].filter((fp) => !currentFps.has(fp));
  if (stale.length > 0) {
    console.error(
      `\nFAIL: ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} STALE — the query ${stale.length === 1 ? 'it' : 'they'} grandfathered no longer exists:`,
    );
    for (const fp of stale.slice(0, 20)) console.error(`  ${fp}`);
    if (stale.length > 20) console.error(`  … and ${stale.length - 20} more`);
    console.error(
      '\nThis is usually GOOD NEWS — you fixed something. Lock it in so it cannot come back:\n' +
      '  UPDATE_BASELINE=1 node apps/api/tools/check-tenant-isolation.cjs\n' +
      `and lower BASELINE_CEILING in that file to the new count in the same commit (currently ${BASELINE_CEILING}).`,
    );
    process.exit(1);
  }

  console.log(
    `OK: no new unscoped tenant-resource access; ${findings.length}/${BASELINE_CEILING} grandfathered (${baseline.size} distinct), no stale entries.`,
  );
  process.exit(0);
}

if (require.main === module) main();
