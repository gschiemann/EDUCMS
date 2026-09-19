#!/usr/bin/env node
/**
 * A schema.prisma change that alters the DATABASE must ship a migration file.
 *
 * WHY THIS EXISTS — the 2026-09-16 production incident. Commit 684f8576 added
 * three columns to `Screen` in schema.prisma and shipped NO migration.
 * Production only ever applies migration FILES: scripts/railway-start.sh runs
 * `prisma migrate deploy` before node boots. So the regenerated Prisma client
 * selected columns that did not exist — on the table every manifest poll,
 * heartbeat and register reads — and the fleet errored until the code was
 * reverted. Every CI gate was green. `pnpm db:push` had made the columns exist
 * on the developer's machine, which is precisely why nothing looked wrong.
 *
 * WHAT IT CHECKS, with no database:
 *   1. Did packages/database/prisma/schema.prisma change in this push / PR?
 *   2. If so, does the change produce real DDL? Prisma itself answers, via
 *      `migrate diff` between the OLD and NEW datamodel — a comment, a
 *      reordering or a `///` doc change produces "empty migration" and passes.
 *   3. If it does, the same range must ADD a prisma/migrations/<dir>/migration.sql.
 *
 * It does NOT prove the migration's SQL matches the DDL — that needs a shadow
 * database and 120 migrations that replay cleanly, which this repo (whose dev
 * flow is db:push) does not have today. It proves the file was not FORGOTTEN,
 * which is the failure that actually happened.
 *
 * A range it cannot resolve is a FAILURE, not a skip: a guard that silently
 * stands down is how a green check ends up meaning nothing.
 *
 *   BASE_SHA=<sha> node scripts/check-schema-has-migration.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA = 'packages/database/prisma/schema.prisma';
const MIGRATIONS = 'packages/database/prisma/migrations/';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const exists = (rev) => { try { git('cat-file', '-e', `${rev}^{commit}`); return true; } catch { return false; } };

function resolveBase() {
  const given = (process.env.BASE_SHA || '').trim();
  if (given && !/^0+$/.test(given) && exists(given)) return given;
  // A brand-new branch pushes with before=000…0. Compare against where it left master.
  for (const ref of ['origin/master', 'master']) {
    if (!exists(ref)) continue;
    try {
      const mb = git('merge-base', 'HEAD', ref).trim();
      if (mb && mb !== git('rev-parse', 'HEAD').trim()) return mb;
    } catch { /* try the next ref */ }
  }
  if (exists('HEAD~1')) return 'HEAD~1';
  return null;
}

const base = resolveBase();
if (!base) {
  console.error('FAIL: cannot resolve a base commit to compare against (shallow clone? use fetch-depth: 0).');
  process.exit(2);
}

const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
if (!changed.includes(SCHEMA)) {
  console.log(`OK — ${SCHEMA} unchanged since ${base.slice(0, 8)}.`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-guard-'));
const oldFile = path.join(tmp, 'old.prisma');
const newFile = path.join(tmp, 'new.prisma');
try { fs.writeFileSync(oldFile, git('show', `${base}:${SCHEMA}`)); }
catch { fs.writeFileSync(oldFile, 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n'); }
fs.writeFileSync(newFile, fs.readFileSync(SCHEMA, 'utf8'));

// Resolved from THIS file, not the cwd, so it also runs from a git worktree.
const prismaBin = path.join(__dirname, '..', 'packages', 'database', 'node_modules', '.bin', 'prisma');
let ddl;
try {
  ddl = execFileSync(prismaBin, [
    'migrate', 'diff', '--from-schema-datamodel', oldFile, '--to-schema-datamodel', newFile, '--script',
  ], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://x:x@localhost:5432/x' } });
} catch (e) {
  console.error('FAIL: `prisma migrate diff` could not compare the two schemas:\n' + (e.stderr || e.message));
  process.exit(2);
}

const statements = ddl.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
if (statements.length === 0) {
  console.log(`OK — ${SCHEMA} changed, but not in a way that alters the database (comments / ordering).`);
  process.exit(0);
}

const added = git('diff', '--name-only', '--diff-filter=A', base, 'HEAD', '--', MIGRATIONS)
  .split('\n').filter((f) => f.endsWith('/migration.sql'));
if (added.length > 0) {
  console.log(`OK — schema DDL changed and a migration ships with it:\n  ${added.join('\n  ')}`);
  process.exit(0);
}

console.error(`
FAIL: ${SCHEMA} changes the database, and no migration file was added.

Production applies MIGRATION FILES ONLY (scripts/railway-start.sh runs
\`prisma migrate deploy\` before node boots). Without one, the deployed Prisma
client will select columns/tables that do not exist. That is the 2026-09-16
incident: every screen in the fleet errored until the code was reverted.
\`pnpm db:push\` makes it work on YOUR machine and nowhere else.

The DDL this change needs:

${ddl.trim().split('\n').map((l) => '    ' + l).join('\n')}

Fix: add packages/database/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql
containing it — additive, and guarded with IF NOT EXISTS (dev databases take
shape via db:push). See 20260919120000_screen_faces for the pattern.
`);
process.exit(1);
