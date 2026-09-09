#!/usr/bin/env node
/**
 * venueos.cjs — the engineering CLI.
 *
 * WHY: this repo has 20+ correctness gates spread across scripts/,
 * apps/api/tools/ and apps/web/tools/, and only four of them are reachable from
 * package.json. Every agent and every new developer therefore GUESSES paths. On
 * 2026-09-08 the lead ran the tenant-isolation gate as
 * `scripts/check-tenant-isolation.cjs` (it lives in apps/api/tools/), the call
 * crashed, and a `|| true` swallowed the crash so it briefly read as a pass.
 * That is the failure this file exists to remove.
 *
 * THE ANTI-DRIFT RULE: the gate list is never hand-maintained here. It is
 * DERIVED by parsing .github/workflows/*.yml for the checks CI actually runs.
 * A gate added to CI shows up automatically; a gate deleted from CI disappears.
 * Hand-copying the list is how AGENTS.md rotted 361 lines away from CLAUDE.md.
 *
 * Usage:
 *   node scripts/venueos.cjs gates            # what CI enforces, and where it lives
 *   node scripts/venueos.cjs verify           # run every CI-wired gate locally
 *   node scripts/venueos.cjs verify --only=taurus,tenant
 *   node scripts/venueos.cjs status           # local vs origin vs DEPLOYED vs CI
 *   node scripts/venueos.cjs env up           # isolated postgres + the real API image
 *   node scripts/venueos.cjs env down
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = 'https://api-production-39a1.up.railway.app/api/v1/health';

const c = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` };

function discoverGates() {
  const dir = path.join(ROOT, '.github/workflows');
  if (!fs.existsSync(dir)) return [];
  const seen = new Map();
  for (const f of fs.readdirSync(dir).filter(n => /\.ya?ml$/.test(n))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/node\s+([A-Za-z0-9/_.-]*check-[A-Za-z0-9_-]+\.cjs)/g)) {
      const rel = m[1];
      if (!seen.has(rel)) seen.set(rel, { rel, workflows: new Set() });
      seen.get(rel).workflows.add(f.replace(/\.ya?ml$/, ''));
    }
  }
  return [...seen.values()]
    .map(g => ({ ...g, name: path.basename(g.rel).replace(/^check-|\.cjs$/g, ''),
                 exists: fs.existsSync(path.join(ROOT, g.rel)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function cmdGates() {
  const gates = discoverGates();
  console.log(c.b(`\n  ${gates.length} gates are wired into CI:\n`));
  for (const g of gates) {
    const mark = g.exists ? c.g('✓') : c.r('MISSING');
    console.log(`  ${mark} ${c.b(g.name.padEnd(24))} ${c.d(g.rel)}`);
    console.log(`     ${c.d('from: ' + [...g.workflows].join(', '))}`);
  }
  const missing = gates.filter(g => !g.exists);
  if (missing.length) {
    console.log(c.r(`\n  ${missing.length} gate(s) referenced by CI do not exist on disk — CI would fail.\n`));
    process.exit(1);
  }
  console.log(c.d('\n  Run them with: node scripts/venueos.cjs verify\n'));
}

function cmdVerify(args) {
  const only = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
    .split(',').filter(Boolean);
  let gates = discoverGates().filter(g => g.exists);
  if (only.length) gates = gates.filter(g => only.some(o => g.name.includes(o) || g.rel.includes(o)));
  if (!gates.length) { console.log(c.r('  no gates matched')); process.exit(1); }

  console.log(c.b(`\n  Running ${gates.length} CI-wired gate(s)…\n`));
  const results = [];
  for (const g of gates) {
    const t0 = Date.now();
    const r = spawnSync('node', [g.rel], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    const ok = r.status === 0;
    results.push({ ...g, ok, ms: Date.now() - t0, out: ((r.stdout || '') + (r.stderr || '')).trim() });
    console.log(`  ${ok ? c.g('PASS') : c.r('FAIL')}  ${g.name.padEnd(24)} ${c.d(((Date.now() - t0) / 1000).toFixed(1) + 's')}`);
  }
  const failed = results.filter(x => !x.ok);
  for (const f of failed) {
    console.log(c.r(`\n  ── ${f.name} (${f.rel}) ──`));
    console.log(f.out.split('\n').slice(-25).map(l => '  ' + l).join('\n'));
  }
  console.log(failed.length
    ? c.r(`\n  ${failed.length} of ${results.length} gate(s) FAILED\n`)
    : c.g(`\n  all ${results.length} gates passed\n`));
  process.exit(failed.length ? 1 : 0);
}

function sh(cmd) { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); } catch { return ''; } }

async function cmdStatus() {
  const head = sh('git rev-parse HEAD');
  const branch = sh('git branch --show-current');
  const dirty = sh('git status --porcelain').split('\n').filter(Boolean).length;
  const ahead = sh(`git rev-list --count origin/${branch}..HEAD`) || '?';

  console.log(c.b('\n  LOCAL'));
  console.log(`    branch    ${branch}${dirty ? c.y(`  (${dirty} uncommitted)`) : c.g('  (clean)')}`);
  console.log(`    HEAD      ${head.slice(0, 12)}  ${c.d(sh('git log -1 --pretty=%s').slice(0, 60))}`);
  console.log(`    unpushed  ${ahead === '0' ? c.g('0') : c.y(ahead)}`);

  console.log(c.b('\n  DEPLOYED (api)'));
  let health = null;
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(10000) });
    health = await res.json();
  } catch (e) { console.log(c.r(`    unreachable: ${e.message}`)); }
  if (health) {
    const same = health.commit === head;
    console.log(`    commit    ${String(health.commit).slice(0, 12)} ${same ? c.g('== local HEAD') : c.y('!= local HEAD')}`);
    console.log(`    health    ${health.status === 'ok' ? c.g(health.status) : c.r(health.status)}  db=${health.db}  redis=${health.redis}  up=${health.uptime_s}s`);
  }

  console.log(c.b('\n  CI (this commit)'));
  const runs = sh(`gh run list --limit 60 --json headSha,workflowName,status,conclusion -q '[.[]|select(.headSha=="${head}")]|.[]|"\\(.status) \\(.conclusion) \\(.workflowName)"'`);
  if (!runs) console.log(c.d('    no runs for this commit (not pushed, or gh unavailable)'));
  else {
    const lines = runs.split('\n').filter(Boolean);
    const done = lines.filter(l => l.startsWith('completed'));
    const bad = done.filter(l => !l.includes('success'));
    const running = lines.length - done.length;
    console.log(`    ${c.g(done.length - bad.length + ' passed')}   ${bad.length ? c.r(bad.length + ' FAILED') : '0 failed'}   ${running ? c.y(running + ' still running') : '0 running'}`);
    for (const b of bad) console.log(c.r('    ✗ ' + b));
    if (running) console.log(c.d('    (in-progress is NOT a pass — wait for it)'));
  }
  console.log();
}

/**
 * `env` — a disposable full-stack sandbox: a throwaway postgres plus the REAL
 * production image, on its own docker network, never touching prod.
 *
 * This is the pattern that proved the Node 22 migration on 2026-09-08 (migrations
 * applied, Nest booted, 459 presets seeded, /health 200 db:ok). It was assembled
 * by hand that day; making it one command is the difference between "we could
 * verify a base-image bump" and "we do, every time".
 *
 * Deliberately NOT wired to .env: this stack gets its own database so a boot test
 * can never migrate, seed or reset production. That is the whole point.
 */
const NET = 'venueos-sandbox-net', PG = 'venueos-sandbox-pg', APP = 'venueos-sandbox-api';
const IMAGE = 'venueos-sandbox:latest', PORT = 18080;

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', cwd: ROOT });
}
function dockerOut(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  return (r.stdout || '').trim();
}

function envDown() {
  for (const n of [APP, PG]) docker(['rm', '-f', n], { quiet: true });
  docker(['network', 'rm', NET], { quiet: true });
  console.log(c.g('  sandbox torn down'));
}

async function envUp(args) {
  if (!dockerOut(['version', '--format', '{{.Server.Version}}'])) {
    console.error(c.r('  docker is not running')); process.exit(1);
  }
  const skipBuild = args.includes('--no-build');
  envDown();
  console.log(c.b('\n  Bringing up an ISOLATED stack (never touches production)\n'));

  docker(['network', 'create', NET], { quiet: true });
  console.log('  · postgres…');
  docker(['run', '-d', '--name', PG, '--network', NET,
          '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_USER=postgres',
          '-e', 'POSTGRES_DB=postgres', 'postgres:16-alpine'], { quiet: true });
  for (let i = 0; i < 40; i++) {
    if (spawnSync('docker', ['exec', PG, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) break;
    spawnSync('sleep', ['1']);
  }

  if (!skipBuild) {
    console.log('  · building the real production image (Dockerfile)…');
    if (docker(['build', '-t', IMAGE, '.']).status !== 0) { console.error(c.r('  image build failed')); process.exit(1); }
  }

  const rand = () => require('crypto').randomBytes(32).toString('hex');
  const db = `postgresql://postgres:postgres@${PG}:5432/postgres?connection_limit=10&pool_timeout=20`;
  console.log('  · booting the API…');
  docker(['run', '-d', '--name', APP, '--network', NET, '-p', `${PORT}:8080`,
          '-e', 'NODE_ENV=production', '-e', 'PORT=8080',
          '-e', `DATABASE_URL=${db}`, '-e', `DIRECT_URL=${db}`,
          '-e', `JWT_SECRET=${rand()}`, '-e', `SESSION_SECRET=${rand()}`,
          '-e', `DEVICE_SECRET_KEY=${rand()}`, '-e', `DEVICE_JWT_SECRET=${rand()}`,
          '-e', 'ALLOWED_ORIGINS=http://localhost:3000', IMAGE], { quiet: true });

  const url = `http://127.0.0.1:${PORT}/api/v1/health`;
  process.stdout.write('  · waiting for health');
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const h = await r.json();
        console.log(c.g('\n\n  READY'));
        console.log(`    health  ${h.status}  db=${h.db}  redis=${h.redis}`);
        console.log(`    api     http://127.0.0.1:${PORT}/api/v1`);
        console.log(c.d(`    logs    docker logs -f ${APP}`));
        console.log(c.d(`    down    node scripts/venueos.cjs env down\n`));
        return;
      }
    } catch {}
    process.stdout.write('.'); await new Promise(r => setTimeout(r, 2000));
  }
  console.error(c.r('\n  never became healthy. Last logs:'));
  docker(['logs', '--tail', '30', APP]);
  process.exit(1);
}

const [, , cmd, ...rest] = process.argv;
(async () => {
  if (cmd === 'gates') return cmdGates();
  if (cmd === 'verify') return cmdVerify(rest);
  if (cmd === 'status') return cmdStatus();
  if (cmd === 'env') {
    if (rest[0] === 'down') return envDown();
    if (rest[0] === 'up' || !rest[0]) return envUp(rest);
    console.log(c.r('  usage: venueos env up [--no-build] | env down')); process.exit(1);
  }
  console.log(`
  ${c.b('venueos')} — VenueOS engineering CLI

    ${c.b('gates')}    list every correctness gate CI enforces, and where it lives
    ${c.b('verify')}   run those gates locally   ${c.d('[--only=taurus,tenant]')}
    ${c.b('status')}   local vs origin vs DEPLOYED vs CI, in one view
    ${c.b('env up')}   isolated postgres + the REAL image  ${c.d('[--no-build]')}
    ${c.b('env down')} tear the sandbox down
`);
  process.exit(cmd ? 1 : 0);
})();
