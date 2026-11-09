#!/usr/bin/env node
/**
 * guard-destructive-db.cjs — refuse to run a database command that can change
 * data or schema against anything that looks like a real/shared database.
 *
 * WHY THIS EXISTS: `pnpm db:reset` runs `prisma migrate reset --force`, which
 * DROPS EVERY TABLE. It reads DATABASE_URL — and this repo's local `.env`
 * points at the PRODUCTION Supabase pooler, because that is what local tooling
 * and the MCP clients talk to. So the documented, friendly-looking dev command
 * was one keystroke away from dropping the live fleet's database, on a
 * life-safety product, with no confirmation step. An `echo` warning in the
 * npm script is not a guard: it prints and then runs the command anyway.
 *
 * 2026-10-31 (Foundry Standard Phase 1, #5): that same `.env` could reach
 * production through `db:push`, `db:migrate` and `db:seed` too, none of which
 * called this guard — `db:seed` would plant seed accounts whose passwords are
 * public in this repo. EVERY pnpm script that can change data or schema now
 * runs this guard first (`EFFECTS` below names them; the test
 * `scripts/__tests__/guard-destructive-db.test.cjs` fails on any `db:*`
 * script that is neither routed here nor listed as deliberately unguarded).
 * Deliberately unguarded: `db:generate` (no database; `postinstall` runs it)
 * and `db:deploy` — `scripts/railway-start.sh` can fall back to it, and the
 * production boot must never depend on this file.
 *
 * WHAT "THE TARGET" IS: every URL the command can dial — DATABASE_URL, and
 * DIRECT_URL, which Prisma Migrate (`db push`, `migrate dev`, `migrate reset`)
 * dials INSTEAD whenever it is set. A non-empty value in the process
 * environment wins, as it does for Prisma and dotenv; otherwise every
 * occurrence in every `.env` those commands load (repo root,
 * packages/database, packages/database/prisma — Prisma run from
 * packages/database reads the last two, never the root one). Until
 * 2026-10-31 this guard read DATABASE_URL from the root `.env` only, so the
 * escape it printed (`DATABASE_URL=<local> pnpm db:reset`) passed it while
 * Prisma dialled whatever DIRECT_URL a `.env` it loads still named.
 *
 * The rule: a command that can change data or schema must FAIL CLOSED on
 * anything it cannot prove is a local throwaway database.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OVERRIDE_VAR = 'VENUEOS_ALLOW_DB_RESET';
const OVERRIDE = 'i-know-this-drops-every-table';

/** Every connection-string variable a guarded command can dial. */
const URL_KEYS = ['DATABASE_URL', 'DIRECT_URL'];

/** The `.env` files a guarded command can load, relative to the repo root. */
const ENV_FILES = ['.env', 'packages/database/.env', 'packages/database/prisma/.env'];

/** What each guarded script does — used only to word the refusal. */
const EFFECTS = {
  'db:reset': 'DROPS EVERY TABLE and re-applies every migration from scratch',
  'db:push': 'rewrites the schema to match schema.prisma with no migration file, and can drop columns with their data',
  'db:migrate': 'creates and applies a migration, and offers to RESET the whole database when it finds drift',
  'db:seed': 'writes seed tenants and users whose default password is public in this repository',
  'db:seed:demo': 'writes a demo chain with an admin login whose password is public in this repository',
  'db:seed:demo:clean': "deletes the demo chain's tenants, screens, users and audit rows",
  'db:backfill-hashes': 'writes Asset.fileHash on every row missing one (unless --dry-run)',
  'db:backfill-posters': 'writes video posters and probe facts onto Asset rows (with --apply)',
  'db:migrate-bug-screenshots': 'moves bug screenshots between buckets and rewrites Bug rows (with --apply)',
};

// Only an explicitly local host is ever auto-allowed.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal|postgres|db)$/i;

/**
 * Every value dotenv would read for `key` in `text`: `export KEY=…`, spaces
 * around `=`, quoted or bare, a trailing `# comment`. ALL occurrences — a
 * guard must never pick the safe one of two.
 */
function envFileValues(text, key) {
  const line = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*(?:=|:[ \\t])(.*)$`, 'gm');
  const values = [];
  let m;
  while ((m = line.exec(text)) !== null) {
    let v = m[1].trim();
    const quote = v[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      const end = v.indexOf(quote, 1);
      v = end === -1 ? v.slice(1) : v.slice(1, end);
    } else {
      v = v.split('#')[0].trim(); // dotenv ends a bare value at `#`
    }
    values.push(v);
  }
  return values;
}

function hostOf(url) {
  try {
    return new URL(url).hostname || '(no host)';
  } catch {
    return '(unparseable)';
  }
}

/**
 * The connection targets a guarded command can use. Hosts only: the URL
 * itself carries the password and is never returned, logged or printed.
 */
function resolveTargets({ env, envFiles }) {
  const targets = [];
  for (const key of URL_KEYS) {
    if (env[key]) {
      targets.push({ key, source: 'environment', host: hostOf(env[key]) });
      continue;
    }
    for (const file of envFiles) {
      for (const value of envFileValues(file.text, key)) {
        if (value) targets.push({ key, source: file.name, host: hostOf(value) });
      }
    }
  }
  return targets;
}

/**
 * The decision, pure (no I/O). `envFiles` is `[{ name, text }]` for the
 * `.env` files that exist. Same order as ever: no DATABASE_URL refuses even
 * with the override; all-local allows; the exact override allows; else refuse.
 */
function decide({ env, envFiles }) {
  const targets = resolveTargets({ env, envFiles });
  if (!targets.some((t) => t.key === 'DATABASE_URL')) {
    return { allow: false, reason: 'no-database-url', targets, offending: [] };
  }
  const offending = targets.filter((t) => !LOCAL_HOST.test(t.host));
  if (offending.length === 0) return { allow: true, reason: 'local', targets, offending };
  if (env[OVERRIDE_VAR] === OVERRIDE) return { allow: true, reason: 'override', targets, offending };
  return { allow: false, reason: 'not-local', targets, offending };
}

/** The `.env` files that exist under `root`. Anything but "absent" throws. */
function readEnvFiles(root) {
  const files = [];
  for (const name of ENV_FILES) {
    try {
      files.push({ name, text: fs.readFileSync(path.join(root, name), 'utf8') });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) continue;
      throw new Error(`could not read ${name} (${e && e.code ? e.code : e})`);
    }
  }
  return files;
}

function commandName(label) {
  return /^db:/.test(label) ? `pnpm ${label}` : label;
}

function listTargets(targets) {
  return targets.map((t) => `${t.key} → ${t.host} (${t.source})`).join(', ');
}

/** Word-wrap a paragraph to the width of the refusal box. */
function wrap(text, width = 70) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => `  ${l}`).join('\n');
}

/** The text the guard prints for a decision: `{ stream, text }`. */
function formatDecision(label, decision) {
  const cmd = commandName(label);
  if (decision.reason === 'no-database-url') {
    return { stream: 'stderr', text: `\n  REFUSING: no DATABASE_URL found, so ${cmd} cannot be shown to be safe.\n` };
  }
  if (decision.reason === 'local') {
    return { stream: 'stdout', text: `  guard: every database URL is local (${listTargets(decision.targets)}) — allowing ${cmd}.` };
  }
  const hosts = [...new Set(decision.offending.map((t) => t.host))].join('", "');
  if (decision.reason === 'override') {
    return { stream: 'stderr', text: `\n  ⚠ guard OVERRIDDEN for a NON-LOCAL host "${hosts}". Proceeding with ${cmd}.\n` };
  }
  const effect = EFFECTS[label] || 'can change data or schema';
  const width = Math.max(...decision.offending.map((t) => t.host.length));
  const rows = decision.offending
    .map((t, i) => `  ${i === 0 ? 'It would connect to:' : '                    '}  ${t.host.padEnd(width)}  (${t.key}, from ${t.source})`)
    .join('\n');
  return {
    stream: 'stderr',
    text: `
  ────────────────────────────────────────────────────────────────────
  REFUSING TO RUN ${cmd.toUpperCase()}

${rows}

${wrap(
  `That is not a local database. This command ${effect}. This repo's .env normally points at the PRODUCTION ` +
    'Supabase pooler, so running it here would change live tenant, screen, playlist and audit-log data.',
)}

  If you genuinely mean a throwaway database, point BOTH URLs at it
  (Prisma Migrate dials DIRECT_URL instead of DATABASE_URL when it is set):

    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \\
    DIRECT_URL=postgresql://postgres:postgres@localhost:5432/postgres ${cmd}

  To override against a non-local host (you almost never should):

    ${OVERRIDE_VAR}=${OVERRIDE} ${cmd}
  ────────────────────────────────────────────────────────────────────
`,
  };
}

/** Exit code: 0 = run the command, 1 = refuse. */
function main({
  argv = process.argv,
  env = process.env,
  root = ROOT,
  out = (s) => console.log(s),
  err = (s) => console.error(s),
} = {}) {
  const label = argv[2] || 'this destructive command';
  let envFiles = [];
  // With every URL set in the environment, no `.env` is consulted (or read).
  if (URL_KEYS.some((key) => !env[key])) {
    try {
      envFiles = readEnvFiles(root);
    } catch (e) {
      err(`\n  REFUSING: ${e.message}, so ${commandName(label)} cannot be shown to be safe.\n`);
      return 1;
    }
  }
  const decision = decide({ env, envFiles });
  const { stream, text } = formatDecision(label, decision);
  (stream === 'stdout' ? out : err)(text);
  return decision.allow ? 0 : 1;
}

// exitCode, not process.exit(): a pipe on macOS is asynchronous, and exiting
// at once can cut the refusal off mid-message.
if (require.main === module) process.exitCode = main();

module.exports = {
  ROOT,
  OVERRIDE_VAR,
  OVERRIDE,
  URL_KEYS,
  ENV_FILES,
  EFFECTS,
  LOCAL_HOST,
  envFileValues,
  hostOf,
  resolveTargets,
  decide,
  readEnvFiles,
  formatDecision,
  main,
};
