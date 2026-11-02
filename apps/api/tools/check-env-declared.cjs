#!/usr/bin/env node
/**
 * Environment-declaration gate (Foundry mechanism #15, "kill switches + decided failure
 * directions"; configuration audit, 2026-10).
 *
 * The audits found the API reading far more environment variables than any document named: a
 * `grep` counted 168, the AST count is 243, and most of the newer `*_DISABLED` kill switches
 * were written down nowhere. A variable nobody declared has no reviewed default, no purpose and
 * no written answer to "what happens when it is missing?". The declaration is
 * apps/api/src/config/env-schema.ts; this gate keeps it complete.
 *
 *   FAILS (exit 1) when
 *     - the code reads a variable with no ENV_VARS entry - `process.env.X`, `process.env['X']`, a
 *       `const`-held name, an `env.X` read through a NodeJS.ProcessEnv parameter, a name handed
 *       to a helper such as `intEnv('X', 5)`, a loop over a constant array of names, or a
 *       destructure (apps/api/tools/env-scan.cjs documents every shape it resolves);
 *     - a read assembles its name at run time, or hands the whole environment to a function that
 *       lives in another package, and DYNAMIC_ENV_READS has no row for that site;
 *     - a DYNAMIC_ENV_READS row covers a name that is not declared, or names a `reader` file
 *       that does not contain the name;
 *     - the declaration itself is malformed (the zod schema in env-schema.ts: duplicate names,
 *       a kill switch with no decided failure direction, a default of the wrong type, ...).
 *   WARNS (never fails) when an entry is read by nothing, or a registry row matches no site.
 *
 * Scope: non-spec source under apps/api/src. Spec files SET variables to exercise code; they are
 * not readers.
 *
 * HOW THIS GATE IS WIRED. `node scripts/venueos.cjs gates|verify` does not keep a list: it
 * DERIVES the gates from `node <path>/check-*.cjs` lines in .github/workflows/*.yml. So this
 * file becomes a CI gate - and appears in `venueos verify` - the day a workflow step runs
 *     node apps/api/tools/check-env-declared.cjs
 * (it needs `pnpm install` first: it loads the TypeScript compiler and zod from apps/api). The
 * same completeness check also runs inside the API Jest suite
 * (apps/api/src/config/env-schema.spec.ts), so it is enforced by the existing blocking Jest job
 * even before any workflow lists this file.
 *
 * Run: node apps/api/tools/check-env-declared.cjs
 */
'use strict';

const { scanEnvReads, loadEnvSchema, compareToSchema } = require('./env-scan.cjs');

const inActions = !!process.env.GITHUB_ACTIONS;

function emit(level, message, file, line) {
  if (inActions) {
    const loc = file ? ` file=${file}${line ? `,line=${line}` : ''}` : '';
    console.log(`::${level}${loc}::${message.replace(/\r?\n/g, ' ')}`);
  } else {
    const where = file ? `  ${file}${line ? `:${line}` : ''}` : '';
    console.log(`${level === 'error' ? 'ERROR' : 'warn '}${where}\n       ${message}`);
  }
}

function main() {
  let schema;
  let scan;
  try {
    schema = loadEnvSchema();
    scan = scanEnvReads();
  } catch (e) {
    console.error(`::error::check-env-declared could not run: ${e && e.message ? e.message : e}`);
    return 2;
  }

  const errors = [];
  const warnings = [];

  // The declaration must be well-formed before it can vouch for anything.
  const list = schema.envVarListSchema.safeParse(schema.ENV_VARS);
  if (!list.success) {
    for (const issue of list.error.issues) {
      const idx = typeof issue.path[0] === 'number' ? issue.path[0] : null;
      const name = idx !== null && schema.ENV_VARS[idx] ? schema.ENV_VARS[idx].name : '?';
      errors.push({ file: 'apps/api/src/config/env-schema.ts', message: `${name}: ${issue.path.slice(1).join('.') || 'entry'} - ${issue.message}` });
    }
  }
  schema.DYNAMIC_ENV_READS.forEach((row, i) => {
    const r = schema.dynamicEnvReadSchema.safeParse(row);
    if (!r.success) {
      errors.push({ file: 'apps/api/src/config/env-schema.ts', message: `DYNAMIC_ENV_READS[${i}] is malformed: ${r.error.issues.map((x) => x.message).join('; ')}` });
    }
  });

  const cmp = compareToSchema(scan, schema);
  errors.push(...cmp.errors);
  warnings.push(...cmp.warnings);

  for (const w of warnings) emit('warning', w.message);
  for (const e of errors) emit('error', e.message, e.file, e.line);

  const names = new Set(scan.sites.map((s) => s.name));
  const switches = schema.ENV_VARS.filter((v) => v.killSwitch).length;
  const summary =
    `env-declared gate: ${scan.files} source files scanned, ${names.size} variables read directly, ` +
    `${schema.ENV_VARS.length} declared (${switches} kill switches, ${schema.DYNAMIC_ENV_READS.length} dynamic-read rows), ` +
    `${errors.length} error(s), ${warnings.length} warning(s).`;
  if (errors.length) {
    console.error(`\n${summary}\nFix: declare the variable in apps/api/src/config/env-schema.ts (copy the reader's fallback), then rerun.`);
    return 1;
  }
  console.log(summary);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main };
