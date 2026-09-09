#!/usr/bin/env node
/**
 * guard-destructive-db.cjs — refuse to run a destructive Prisma command against
 * anything that looks like a real/shared database.
 *
 * WHY THIS EXISTS: `pnpm db:reset` runs `prisma migrate reset --force`, which
 * DROPS EVERY TABLE. It reads DATABASE_URL — and this repo's local `.env`
 * points at the PRODUCTION Supabase pooler, because that is what local tooling
 * and the MCP clients talk to. So the documented, friendly-looking dev command
 * was one keystroke away from dropping the live fleet's database, on a
 * life-safety product, with no confirmation step. An `echo` warning in the
 * npm script is not a guard: it prints and then runs the command anyway.
 *
 * The rule: a destructive command must FAIL CLOSED on anything it cannot prove
 * is a local throwaway database.
 */
const fs = require('fs');
const path = require('path');

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=("?)(.+?)\1\s*$/m);
  return m ? m[2] : null;
}

const url = readDatabaseUrl();
const OVERRIDE = 'i-know-this-drops-every-table';
const label = process.argv[2] || 'this destructive command';

if (!url) {
  console.error(`\n  REFUSING: no DATABASE_URL found, so ${label} cannot be shown to be safe.\n`);
  process.exit(1);
}

let host = '';
try { host = new URL(url).hostname; } catch { host = '(unparseable)'; }

// Only an explicitly local host is ever auto-allowed.
const isLocal = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal|postgres|db)$/i.test(host);

if (isLocal) {
  console.log(`  guard: DATABASE_URL host is "${host}" (local) — allowing ${label}.`);
  process.exit(0);
}

if (process.env.VENUEOS_ALLOW_DB_RESET === OVERRIDE) {
  console.warn(`\n  ⚠ guard OVERRIDDEN for a NON-LOCAL host "${host}". Proceeding with ${label}.\n`);
  process.exit(0);
}

console.error(`
  ────────────────────────────────────────────────────────────────────
  REFUSING TO RUN ${label.toUpperCase()}

  DATABASE_URL points at:  ${host}

  That is not a local database. This command DROPS EVERY TABLE and
  re-applies migrations from scratch. This repo's .env normally points
  at the PRODUCTION Supabase pooler, so running it here would destroy
  live tenant, screen, playlist and audit-log data.

  If you genuinely mean a throwaway database, point DATABASE_URL at it:

    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm db:reset

  To override against a non-local host (you almost never should):

    VENUEOS_ALLOW_DB_RESET=${OVERRIDE} pnpm db:reset
  ────────────────────────────────────────────────────────────────────
`);
process.exit(1);
