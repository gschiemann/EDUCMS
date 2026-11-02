#!/usr/bin/env node
/**
 * Tests for scripts/guard-destructive-db.cjs (Foundry Standard Phase 1, #5).
 *
 * Plain `node:test`, no deps, no database, no network:
 *   node --test scripts/__tests__/guard-destructive-db.test.cjs
 *
 * Every URL fixture is cut from the file that produces it — the production
 * shape from packages/database/certs/README.md, CI's throwaway Postgres from
 * .github/workflows/a11y.yml (the one workflow that runs db:push and db:seed),
 * the local stack from docker-compose.yml, the template from .env.example — so
 * a change to any of them re-runs these cases against the new value. The
 * routing cases read the two package.json files that define the scripts.
 *
 * Nothing here reads a developer's real .env: the decision is tested pure,
 * main() runs against a throwaway directory, and the CLI is spawned with both
 * URLs set in its environment, which is the case where the guard opens no
 * .env at all.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const guard = require('../guard-destructive-db.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO, 'scripts', 'guard-destructive-db.cjs');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

function cut(rel, re) {
  const m = read(rel).match(re);
  assert.ok(m, `${rel} no longer matches ${re} — re-cut this fixture from its producer`);
  return m[1];
}

const PROD = {
  DATABASE_URL: cut('packages/database/certs/README.md', /^DATABASE_URL=(\S+)$/m),
  DIRECT_URL: cut('packages/database/certs/README.md', /^DIRECT_URL=(\S+)$/m),
};
const PROD_HOST = new URL(PROD.DATABASE_URL).hostname;
const CI = {
  DATABASE_URL: cut('.github/workflows/a11y.yml', /^\s+DATABASE_URL:\s*(\S+)\s*$/m),
  DIRECT_URL: cut('.github/workflows/a11y.yml', /^\s+DIRECT_URL:\s*(\S+)\s*$/m),
};
const COMPOSE = {
  DATABASE_URL: cut('docker-compose.yml', /^\s+- DATABASE_URL=(\S+)\s*$/m),
  DIRECT_URL: cut('docker-compose.yml', /^\s+- DIRECT_URL=(\S+)\s*$/m),
};
const LOCALHOST = 'postgresql://postgres:postgres@localhost:5432/postgres';
const OVERRIDE = { [guard.OVERRIDE_VAR]: guard.OVERRIDE };

const envFile = (name, text) => ({ name, text });
const decide = (env, envFiles = []) => guard.decide({ env, envFiles });
const where = (d) => d.offending.map((t) => `${t.key}@${t.source}`);

// ── the decision ────────────────────────────────────────────────────────

test('production host refused — the pooler from packages/database/certs/README.md, named in the refusal', () => {
  assert.match(PROD_HOST, /\.pooler\.supabase\.com$/, 'the fixture must be the production pooler shape');
  for (const d of [
    decide({ ...PROD }),
    decide({}, [envFile('.env', `DATABASE_URL=${PROD.DATABASE_URL}\nDIRECT_URL=${PROD.DIRECT_URL}\n`)]),
  ]) {
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'not-local');
    const { stream, text } = guard.formatDecision('db:push', d);
    assert.equal(stream, 'stderr');
    assert.match(text, /REFUSING TO RUN PNPM DB:PUSH/);
    assert.ok(text.includes(PROD_HOST), 'the refusal names the host');
  }
});

test('production host + acknowledged override allowed — only the exact value, only from the environment', () => {
  const d = decide({ ...PROD, ...OVERRIDE });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'override');
  const { stream, text } = guard.formatDecision('db:seed', d);
  assert.equal(stream, 'stderr');
  assert.match(text, /guard OVERRIDDEN for a NON-LOCAL host/);
  assert.ok(text.includes(PROD_HOST));
  // A near miss is not an acknowledgement.
  for (const near of ['1', 'true', 'yes', 'I-KNOW-THIS-DROPS-EVERY-TABLE', ` ${guard.OVERRIDE}`, `${guard.OVERRIDE} `]) {
    assert.equal(decide({ ...PROD, [guard.OVERRIDE_VAR]: near }).allow, false, `override value ${JSON.stringify(near)}`);
  }
  // Written into a .env, it does nothing: the person running the command must type it.
  const inFile = decide({}, [envFile('.env', `DATABASE_URL=${PROD.DATABASE_URL}\n${guard.OVERRIDE_VAR}=${guard.OVERRIDE}\n`)]);
  assert.equal(inFile.allow, false);
});

test('localhost allowed without friction', () => {
  for (const env of [
    { DATABASE_URL: LOCALHOST },
    { DATABASE_URL: LOCALHOST, DIRECT_URL: LOCALHOST },
    { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/x', DIRECT_URL: 'postgresql://u:p@127.0.0.1:5432/x' },
  ]) {
    const d = decide(env);
    assert.equal(d.allow, true, JSON.stringify(env));
    assert.equal(d.reason, 'local');
    const { stream, text } = guard.formatDecision('db:reset', d);
    assert.equal(stream, 'stdout');
    assert.match(text, /allowing pnpm db:reset/);
  }
});

test('CI throwaway allowed — the ephemeral Postgres of a11y.yml, which runs db:push and db:seed', () => {
  const workflow = read('.github/workflows/a11y.yml');
  assert.match(workflow, /run: pnpm db:push/, 'a11y.yml is the caller this case protects');
  assert.match(workflow, /run: pnpm db:seed/);
  const d = decide({ ...CI });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'local');
});

test('local docker allowed — the db service of docker-compose.yml', () => {
  assert.equal(decide({ ...COMPOSE }).allow, true);
});

test('DIRECT_URL is a target: a local DATABASE_URL with a production DIRECT_URL left in a .env is refused', () => {
  // Prisma Migrate dials DIRECT_URL instead of DATABASE_URL when it is set, so
  // the escape the guard used to print reset whatever DIRECT_URL still named.
  const d = decide({ DATABASE_URL: LOCALHOST }, [
    envFile('packages/database/.env', `DATABASE_URL=${PROD.DATABASE_URL}\nDIRECT_URL=${PROD.DIRECT_URL}\n`),
  ]);
  assert.equal(d.allow, false);
  assert.deepEqual(where(d), ['DIRECT_URL@packages/database/.env']);
  assert.match(guard.formatDecision('db:reset', d).text, /DIRECT_URL, from packages\/database\/\.env/);
});

test('the environment wins over a .env for the key it sets — so pointing both URLs at a throwaway works', () => {
  const files = [envFile('.env', `DATABASE_URL=${PROD.DATABASE_URL}\nDIRECT_URL=${PROD.DIRECT_URL}\n`)];
  assert.equal(decide({ DATABASE_URL: LOCALHOST, DIRECT_URL: LOCALHOST }, files).allow, true);
  // An empty value is not a value: the .env one is what the command would get.
  assert.equal(decide({ DATABASE_URL: LOCALHOST, DIRECT_URL: '' }, files).allow, false);
});

test('every .env a guarded command loads is read, not only the repo root', () => {
  assert.deepEqual(guard.ENV_FILES, ['.env', 'packages/database/.env', 'packages/database/prisma/.env']);
  for (const name of guard.ENV_FILES) {
    const d = decide({}, [envFile(name, `DATABASE_URL=${PROD.DATABASE_URL}\n`)]);
    assert.equal(d.allow, false, name);
    assert.deepEqual(where(d), [`DATABASE_URL@${name}`]);
  }
  // A local root .env no longer vouches for the production one Prisma reads from packages/database.
  const d = decide({}, [
    envFile('.env', `DATABASE_URL=${LOCALHOST}\n`),
    envFile('packages/database/.env', `DATABASE_URL=${PROD.DATABASE_URL}\n`),
  ]);
  assert.equal(d.allow, false);
  assert.deepEqual(where(d), ['DATABASE_URL@packages/database/.env']);
  // Two values in one file: the production one is not hidden by the local one.
  assert.equal(decide({}, [envFile('.env', `DATABASE_URL=${LOCALHOST}\nDATABASE_URL=${PROD.DATABASE_URL}\n`)]).allow, false);
});

test('no DATABASE_URL anywhere is refused, even with the override', () => {
  for (const d of [
    decide({ ...OVERRIDE }),
    decide({ ...OVERRIDE, DIRECT_URL: LOCALHOST }),
    decide({}, [envFile('.env', 'DATABASE_URL=\nREDIS_URL=redis://localhost:6379\n')]),
  ]) {
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'no-database-url');
  }
  assert.match(guard.formatDecision('db:seed', decide({})).text, /REFUSING: no DATABASE_URL found, so pnpm db:seed cannot be shown to be safe/);
});

test('an unparseable or host-less URL is refused', () => {
  for (const url of ['${DATABASE_URL}', 'not a url', 'postgresql:///postgres?host=/var/run/postgresql']) {
    assert.equal(decide({ DATABASE_URL: url }).allow, false, url);
  }
});

test('the unedited .env.example (README quickstart, step 2) is refused — its host is a placeholder', () => {
  const d = decide({}, [envFile('.env', read('.env.example'))]);
  assert.equal(d.allow, false);
  assert.deepEqual(where(d), ['DATABASE_URL@.env', 'DIRECT_URL@.env']);
});

test('.env lines are read the way dotenv reads them', () => {
  const v = (text) => guard.envFileValues(text, 'DATABASE_URL');
  assert.deepEqual(v('DATABASE_URL=a'), ['a']);
  assert.deepEqual(v('export DATABASE_URL=a'), ['a']);
  assert.deepEqual(v('  DATABASE_URL = "a" # note'), ['a']);
  assert.deepEqual(v("DATABASE_URL='a'"), ['a']);
  assert.deepEqual(v('DATABASE_URL=a # note'), ['a']);
  assert.deepEqual(v('DATABASE_URL: a'), ['a']);
  assert.deepEqual(v('DATABASE_URL=a\r\nOTHER=b\r\n'), ['a']);
  assert.deepEqual(v('DATABASE_URL=a\nDATABASE_URL=b\n'), ['a', 'b']);
  assert.deepEqual(v('#DATABASE_URL=a\n# DATABASE_URL=b'), []);
  assert.deepEqual(v('DATABASE_URL_OLD=a\nMY_DATABASE_URL=b'), []);
});

test('no password is ever printed', () => {
  const canary = 'canary-value-never-printed';
  const url = PROD.DATABASE_URL.replace('USER:PASS', `postgres.ref:${canary}`);
  assert.notEqual(url, PROD.DATABASE_URL, 'the fixture carries a credential to redact');
  const local = `postgresql://postgres:${canary}@localhost:5432/postgres`;
  for (const [env, files] of [
    [{ DATABASE_URL: url }, []],
    [{ DATABASE_URL: url, ...OVERRIDE }, []],
    [{ DATABASE_URL: local, DIRECT_URL: local }, []],
    [{}, [envFile('.env', `DATABASE_URL=${url}\n`)]],
  ]) {
    const d = decide(env, files);
    assert.ok(!JSON.stringify(d).includes(canary), 'the decision holds hosts only');
    assert.ok(!guard.formatDecision('db:push', d).text.includes(canary), 'the printed text holds hosts only');
  }
});

test('the throwaway URLs and the override the refusal prints are the ones that work', () => {
  const { text } = guard.formatDecision('db:push', decide({ ...PROD }));
  const printed = {
    DATABASE_URL: text.match(/^\s+DATABASE_URL=(\S+)/m)[1],
    DIRECT_URL: text.match(/^\s+DIRECT_URL=(\S+)/m)[1],
  };
  assert.equal(decide(printed, [envFile('.env', `DIRECT_URL=${PROD.DIRECT_URL}\n`)]).allow, true);
  assert.match(text, new RegExp(`^\\s+${guard.OVERRIDE_VAR}=${guard.OVERRIDE} pnpm db:push$`, 'm'));
});

// ── main() and the CLI ──────────────────────────────────────────────────

test('main() reads every .env under its root, prints, and returns the exit code', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (env) => {
    const lines = { out: [], err: [] };
    const code = guard.main({
      argv: ['node', GUARD, 'db:push'],
      env,
      root,
      out: (s) => lines.out.push(s),
      err: (s) => lines.err.push(s),
    });
    return { code, out: lines.out.join('\n'), err: lines.err.join('\n') };
  };

  fs.mkdirSync(path.join(root, 'packages', 'database', 'prisma'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'database', 'prisma', '.env'), `DIRECT_URL=${PROD.DIRECT_URL}\n`);
  const refused = run({ DATABASE_URL: LOCALHOST });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /DIRECT_URL, from packages\/database\/prisma\/\.env/);
  assert.equal(refused.out, '');

  const allowed = run({ DATABASE_URL: LOCALHOST, DIRECT_URL: LOCALHOST });
  assert.equal(allowed.code, 0);
  assert.match(allowed.out, /allowing pnpm db:push/);

  // A .env that exists but cannot be read cannot be shown to be safe...
  fs.mkdirSync(path.join(root, '.env'));
  const unreadable = run({ DATABASE_URL: LOCALHOST });
  assert.equal(unreadable.code, 1);
  assert.match(unreadable.err, /REFUSING: could not read \.env \(EISDIR\)/);
  // ...unless both URLs are in the environment, in which case no .env is opened.
  assert.equal(run({ DATABASE_URL: LOCALHOST, DIRECT_URL: LOCALHOST }).code, 0);
});

test('the CLI exits non-zero on a refusal and zero on a local target', () => {
  // Both URLs set → the guard opens no .env, so this never reads a real one.
  const cli = (url) =>
    spawnSync(process.execPath, [GUARD, 'db:push'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DATABASE_URL: url, DIRECT_URL: url },
    });
  const refused = cli('postgresql://u:p@guard-test.invalid:5432/x');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /REFUSING TO RUN PNPM DB:PUSH/);
  assert.match(refused.stderr, /guard-test\.invalid/);
  assert.match(refused.stderr, /─{68}\s*$/, 'the whole refusal reaches the pipe');
  const allowed = cli(LOCALHOST);
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /allowing pnpm db:push/);
});

// ── routing: which scripts run the guard first ──────────────────────────

const ROOT_SCRIPTS = JSON.parse(read('package.json')).scripts;
const PKG_SCRIPTS = JSON.parse(read('packages/database/package.json')).scripts;

/** Scripts that touch no database, or must never depend on this guard. */
const UNGUARDED = {
  'db:generate': 'prisma generate never connects; postinstall runs it in CI and the Docker build, where there is no database',
  'db:deploy': 'scripts/railway-start.sh can fall back to it — the production boot must never depend on this guard',
};

/** The guard labels a script runs before its command, following pnpm delegation. */
function guardLabels(name, scope = 'root') {
  const cmd = (scope === 'root' ? ROOT_SCRIPTS : PKG_SCRIPTS)[name];
  assert.ok(cmd, `${scope} package.json has no script ${name}`);
  const call = scope === 'root' ? /^node scripts\/guard-destructive-db\.cjs (\S+) && \S/ : /^node \.\.\/\.\.\/scripts\/guard-destructive-db\.cjs (\S+) && \S/;
  const direct = cmd.match(call);
  if (direct) return [direct[1]];
  if (scope !== 'root') return [];
  const delegated = cmd.match(/^pnpm --filter @cms\/database run (\S+)$/);
  if (delegated) return guardLabels(delegated[1], 'package');
  const chain = cmd.split(' && ');
  if (chain.length > 1 && chain.every((c) => /^pnpm run \S+$/.test(c))) {
    const labels = chain.map((c) => guardLabels(c.slice('pnpm run '.length), 'root'));
    return labels.every((l) => l.length > 0) ? labels.flat() : [];
  }
  return [];
}

const GUARDED = {
  root: {
    'db:migrate': ['db:migrate'],
    'db:push': ['db:push'],
    'db:seed': ['db:seed'],
    'db:seed:demo': ['db:seed:demo'],
    'db:seed:demo:clean': ['db:seed:demo:clean'],
    'db:setup': ['db:push', 'db:seed'],
    'db:reset': ['db:reset'],
    'db:backfill-hashes': ['db:backfill-hashes'],
    'db:backfill-posters': ['db:backfill-posters'],
    'db:migrate-bug-screenshots': ['db:migrate-bug-screenshots'],
  },
  package: {
    'db:migrate': ['db:migrate'],
    'db:push': ['db:push'],
    'db:seed': ['db:seed'],
    'db:reset': ['db:reset'],
  },
};

for (const [scope, scripts] of Object.entries(GUARDED)) {
  for (const [name, labels] of Object.entries(scripts)) {
    test(`routed: ${scope} ${name} runs the guard (as ${labels.join(' + ')}) before its command`, () => {
      assert.deepEqual(guardLabels(name, scope), labels);
      for (const label of labels) assert.ok(guard.EFFECTS[label], `EFFECTS has no wording for ${label}`);
    });
  }
}

test('every db:* script is either routed through the guard or listed as deliberately unguarded', () => {
  for (const [scope, scripts] of [['root', ROOT_SCRIPTS], ['package', PKG_SCRIPTS]]) {
    for (const name of Object.keys(scripts).filter((n) => n.startsWith('db:'))) {
      assert.ok(
        name in UNGUARDED || guardLabels(name, scope).length > 0,
        `${scope} script ${name} can reach a database without scripts/guard-destructive-db.cjs — route it through the guard, or add it to UNGUARDED with the reason`,
      );
    }
  }
  const routed = new Set(Object.values(GUARDED).flatMap((s) => Object.values(s).flat()));
  assert.deepEqual(Object.keys(guard.EFFECTS).sort(), [...routed].sort(), 'EFFECTS names exactly the guarded scripts');
});

test('db:generate and db:deploy stay unguarded, and production never runs the guard', () => {
  for (const name of Object.keys(UNGUARDED)) {
    assert.ok(PKG_SCRIPTS[name], `packages/database has no ${name}`);
    assert.doesNotMatch(PKG_SCRIPTS[name], /guard-destructive-db/, `${name}: ${UNGUARDED[name]}`);
  }
  assert.equal(ROOT_SCRIPTS.postinstall, 'pnpm run db:generate');
  assert.equal(ROOT_SCRIPTS['db:generate'], 'pnpm --filter @cms/database run db:generate');
  const boot = read('scripts/railway-start.sh');
  assert.doesNotMatch(boot, /guard-destructive-db/);
  assert.match(boot, /prisma migrate deploy --schema=packages\/database\/prisma\/schema\.prisma/);
  assert.match(
    boot,
    /pnpm --filter @cms\/database run db:deploy/,
    'railway-start.sh no longer falls back to db:deploy — db:deploy may now be guarded; update UNGUARDED',
  );
});

test('the guard resolves the repo root from its own location', () => {
  assert.equal(guard.ROOT, REPO);
  assert.ok(fs.existsSync(path.join(guard.ROOT, 'package.json')));
});
