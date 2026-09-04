/**
 * sql.mjs — SQL against the disposable Postgres, with no host dependencies.
 *
 * The repo's node_modules are not installed in a fresh git worktree, so there
 * is no `pg` and no generated Prisma client to lean on. Rather than make the
 * harness depend on a workspace install, every statement is piped into the
 * container's own `psql` via `docker compose exec -T`. Zero new dependencies,
 * and it works the moment the stack is up.
 *
 * All access goes through the compose project declared in env.mjs, so this can
 * only ever reach the disposable database.
 */

import { execFile } from 'node:child_process';
import { CONFIG } from './env.mjs';

function run(args, input, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      { maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`${err.message}\n${stderr}`));
        resolve(stdout);
      },
    );
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

// `docker compose` re-interpolates the compose file on EVERY subcommand, so the
// throwaway secrets have to be resolvable here too — otherwise a mid-run
// `compose stop redis` dies on "required variable … is missing a value" and
// takes the failure-injection phase with it. run.sh writes them to this file.
import { existsSync } from 'node:fs';
const ENV_FILE = process.env.LOADTEST_ENV_FILE || 'scripts/loadtest/.out/stack.env';
const base = [
  'compose',
  ...(existsSync(ENV_FILE) ? ['--env-file', ENV_FILE] : []),
  '-f',
  CONFIG.composeFile,
  '-p',
  CONFIG.composeProject,
];

/** Run SQL, return raw rows as arrays of column strings (tab separated, -tA). */
export async function sql(text) {
  const out = await run(
    [...base, 'exec', '-T', 'pg', 'psql', '-U', 'venueos', '-d', 'venueos_loadtest', '-tAF\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    text,
  );
  return out
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('\t'));
}

/** Run SQL for its side effect only. */
export async function exec(text) {
  await run(
    [...base, 'exec', '-T', 'pg', 'psql', '-U', 'venueos', '-d', 'venueos_loadtest', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    text,
  );
}

/** One scalar. */
export async function scalar(text) {
  const rows = await sql(text);
  return rows.length ? rows[0][0] : null;
}

/** Run a node one-liner inside the API container (used for argon2 hashing). */
export async function nodeInApi(script) {
  const out = await run([...base, 'exec', '-T', 'api', 'node', '-e', script]);
  return out.trim();
}

/** docker compose passthrough (restart / stop / start for failure injection). */
export async function compose(...args) {
  return run([...base, ...args]);
}

/** Raw docker passthrough. */
export async function docker(...args) {
  return run(args);
}

// ── pg_stat_statements helpers ────────────────────────────────────────────

export async function resetQueryStats() {
  await exec(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT pg_stat_statements_reset();`);
}

/** Total statement calls + the top statements since the last reset. */
export async function readQueryStats(limit = 15) {
  const rows = await sql(
    `SELECT calls, round(total_exec_time)::text, left(regexp_replace(query, '\\s+', ' ', 'g'), 110)
       FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat_statements%'
      ORDER BY calls DESC LIMIT ${limit};`,
  );
  const totalRow = await sql(
    `SELECT COALESCE(sum(calls),0)::text FROM pg_stat_statements WHERE query NOT LIKE '%pg_stat_statements%';`,
  );
  return {
    total: Number(totalRow[0]?.[0] ?? 0),
    top: rows.map(([calls, ms, query]) => ({ calls: Number(calls), ms: Number(ms), query })),
  };
}
