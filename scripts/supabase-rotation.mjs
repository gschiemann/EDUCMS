#!/usr/bin/env node
// Railway breach follow-up (2026-10-22): rotate the Supabase secret API key and
// the Postgres password everywhere we keep a copy, with no API downtime.
// Prints names and checks only — never a key or password.
//
//   node scripts/supabase-rotation.mjs check   # read-only: can every step run?
//   node scripts/supabase-rotation.mjs run     # do it
//
// Order (why it is safe): the new key is proven against Storage before it is
// used; the new password is set in Postgres and proven with a FRESH pooler
// connection before the API is redeployed, while the running API keeps its
// existing connections; the old key is deleted only after the new API is
// healthy. Needs: Railway CLI + Supabase CLI logged in, gh logged in.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REF = 'bhdaxzfalaycfopvcopm';
const REPO = 'gschiemann/EDUCMS';
const SERVICE_ID = '5220b230-9824-4c95-862e-74bb657b2312';
const ENV_ID = 'dac3f973-c916-49ab-8ba7-ec76ddaa1d95';
const T = ['--service', 'api', '--environment', 'production'];
const API = 'https://api-production-39a1.up.railway.app/api/v1';
const PRISMA = resolve(ROOT, 'packages/database/node_modules/.bin/prisma');

const say = (m) => console.log(m);
const railway = (args) => {
  const r = spawnSync('railway', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`railway ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || '').trim().slice(0, 200)}`);
  return r.stdout;
};
const vars = () => JSON.parse(railway(['variables', ...T, '--json']));

function supabaseToken() {
  let t = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim();
  if (t.startsWith('go-keyring-base64:')) t = Buffer.from(t.slice(18), 'base64').toString('utf8');
  if (!t.startsWith('sbp_')) throw new Error('Supabase CLI is not logged in (run: supabase login)');
  return t;
}
async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${supabaseToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path}: HTTP ${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
}

// A libpq/Prisma URL for running SQL from THIS machine (the Railway URLs carry a
// container-only sslcert path).
function localUrl(railwayUrl, password) {
  const u = new URL(railwayUrl);
  if (password !== undefined) u.password = encodeURIComponent(password);
  u.search = '?sslmode=require';
  return u.toString();
}
function sql(url, statement) {
  const r = spawnSync(PRISMA, ['db', 'execute', '--url', url, '--stdin'], { input: statement, encoding: 'utf8', cwd: resolve(ROOT, 'packages/database') });
  return { ok: r.status === 0, err: (r.stderr || r.stdout || '').replace(/postgres(ql)?:\/\/[^\s]+/g, '[url]').trim().slice(0, 240) };
}
function withPassword(url, password) {
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return u.toString();
}
function swapDbPassword(text, password) {
  return text.replace(/(postgres(?:ql)?:\/\/postgres\.[a-z0-9]+:)([^@\s"']*)(@)/g, (_, a, _old, c) => a + encodeURIComponent(password) + c);
}
function updateFile(rel, edit) {
  const f = resolve(ROOT, rel);
  if (!existsSync(f)) return;
  const before = readFileSync(f, 'utf8');
  const after = edit(before);
  if (after !== before) { writeFileSync(f, after); say(`  updated ${rel}`); }
}
async function deployMaster() {
  const sha = execFileSync('git', ['ls-remote', `https://github.com/${REPO}.git`, 'refs/heads/master'], { encoding: 'utf8' }).split(/\s/)[0];
  const token = JSON.parse(readFileSync(`${homedir()}/.railway/config.json`, 'utf8')).user?.accessToken;
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'mutation($s:String!,$e:String!,$c:String!){serviceInstanceDeployV2(serviceId:$s,environmentId:$e,commitSha:$c)}', variables: { s: SERVICE_ID, e: ENV_ID, c: sha } }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`deploy failed: ${JSON.stringify(body.errors).slice(0, 200)}`);
  say(`deploy of master ${sha.slice(0, 8)} started`);
  return body.data.serviceInstanceDeployV2;
}
async function waitForDeploy(id) {
  for (let i = 0; i < 60; i++) {
    const line = railway(['deployment', 'list', ...T]).split('\n').find((l) => l.includes(id)) || '';
    if (/SUCCESS/.test(line)) return true;
    if (/FAILED|CRASHED|REMOVED/.test(line)) return false;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return false;
}
async function healthy() {
  const ready = await fetch(`${API}/health/ready`).then((r) => r.ok).catch(() => false);
  const h = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  return ready && h?.db === 'ok';
}

async function check() {
  const v = vars();
  const keys = await mgmt('GET', `/projects/${REF}/api-keys`);
  const secrets = keys.filter((k) => k.type === 'secret');
  say(`Supabase CLI login: ok; secret keys: ${secrets.map((k) => k.name).join(', ')}`);
  say(`Railway SUPABASE_SERVICE_ROLE_KEY: ${v.SUPABASE_SERVICE_ROLE_KEY?.startsWith('sb_secret_') ? 'new-style secret key' : 'unexpected format'}`);
  const probe = sql(localUrl(v.DIRECT_URL), 'SELECT 1;');
  say(`Postgres reachable from here with the current password: ${probe.ok ? 'yes' : 'NO — ' + probe.err}`);
  say(`gh: ${spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0 ? 'logged in' : 'NOT logged in'}`);
  say(`API healthy now: ${(await healthy()) ? 'yes' : 'NO'}`);
}

async function run() {
  const v = vars();
  if (!(await healthy())) throw new Error('API is not healthy right now — not starting');
  const keys = await mgmt('GET', `/projects/${REF}/api-keys`);
  const oldKey = keys.find((k) => k.type === 'secret' && k.name === 'default');

  // 1. Service key: create, prove against Storage, stage everywhere.
  say('1/4 service key');
  const created = await mgmt('POST', `/projects/${REF}/api-keys?reveal=true`, { type: 'secret', name: 'venueos_api_20261023', description: 'VenueOS API — rotated after the 2026-10-21 Railway breach' });
  const key = created.api_key;
  if (!key?.startsWith('sb_secret_')) throw new Error('new key was not revealed');
  const probe = await fetch(`${v.SUPABASE_URL}/storage/v1/bucket`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!probe.ok) throw new Error(`new key failed the Storage check (HTTP ${probe.status}); nothing switched`);
  railway(['variables', ...T, '--skip-deploys', '--set', `SUPABASE_SERVICE_ROLE_KEY=${key}`]);
  spawnSync('gh', ['secret', 'set', 'SUPABASE_SERVICE_ROLE_KEY', '--repo', REPO], { input: key, encoding: 'utf8' });
  for (const f of ['.env', 'apps/api/.env']) updateFile(f, (t) => t.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${key}`));
  say('  new key proven against Storage and staged (Railway, GitHub, local)');

  // 2. Database password: set in Postgres, prove a fresh pooler login, stage everywhere.
  say('2/4 database password');
  const password = randomBytes(24).toString('hex');
  const alter = sql(localUrl(v.DIRECT_URL), `ALTER ROLE postgres WITH PASSWORD '${password}';`);
  if (!alter.ok) throw new Error(`could not change the password: ${alter.err}`);
  let proven = false;
  for (let i = 0; i < 60 && !proven; i++) {
    proven = sql(localUrl(v.DIRECT_URL, password), 'SELECT 1;').ok;
    if (!proven) await new Promise((r) => setTimeout(r, 5000));
  }
  if (!proven) {
    // Put the old password back so the running API (and Railway's staged URL)
    // stay consistent; the old one still logs in while the new one does not.
    const oldPassword = decodeURIComponent(new URL(v.DIRECT_URL).password);
    const back = sql(localUrl(v.DIRECT_URL), `ALTER ROLE postgres WITH PASSWORD '${oldPassword}';`);
    throw new Error(`the new password did not log in through the pooler within 5 minutes — ${back.ok ? 'old password restored' : 'COULD NOT restore the old password: ' + back.err}; Railway was not switched. The new service key IS staged (Railway/GitHub/local); deploy is safe. Tell Claude.`);
  }
  railway(['variables', ...T, '--skip-deploys', '--set', `DATABASE_URL=${withPassword(v.DATABASE_URL, password)}`, '--set', `DIRECT_URL=${withPassword(v.DIRECT_URL, password)}`]);
  spawnSync('gh', ['secret', 'set', 'SUPABASE_DB_URL', '--repo', REPO], { input: localUrl(v.DIRECT_URL, password), encoding: 'utf8' });
  for (const f of ['.env', 'apps/api/.env', '.mcp.json']) updateFile(f, (t) => swapDbPassword(t, password));
  say('  new password proven with a fresh login and staged (Railway, GitHub backup secret, local)');

  // 3. Deploy and confirm.
  say('3/4 deploy');
  const ok = (await waitForDeploy(await deployMaster())) && (await healthy());
  if (!ok) throw new Error('deploy not confirmed healthy — old service key kept. Tell Claude.');
  say('  API healthy on the new key and password');

  // 4. Retire the leaked key.
  say('4/4 delete the leaked service key');
  if (oldKey) {
    await mgmt('DELETE', `/projects/${REF}/api-keys/${oldKey.id}`);
    say(`  deleted secret key "${oldKey.name}"`);
  }
  say('Done. Reconnect the postgres tool in Claude (it uses .mcp.json).');
}

// Resumable steps (the first `run` on 2026-10-23 staged the new key, then
// stopped because a pooler login may not ALTER the privileged postgres role).
async function deleteOldKey() {
  if (!(await healthy())) throw new Error('API is not healthy — not deleting anything');
  const keys = await mgmt('GET', `/projects/${REF}/api-keys`);
  const mine = keys.find((k) => k.type === 'secret' && k.name === 'venueos_api_20261023');
  const old = keys.find((k) => k.type === 'secret' && k.name === 'default');
  if (!mine) throw new Error('the new key is not there — not deleting the old one');
  if (!old) { say('old "default" secret key already gone'); return; }
  await mgmt('DELETE', `/projects/${REF}/api-keys/${old.id}`);
  say('deleted the leaked secret key "default"');
}

async function dbPassword() {
  const v = vars();
  if (!(await healthy())) throw new Error('API is not healthy right now — not starting');
  const oldPassword = decodeURIComponent(new URL(v.DIRECT_URL).password);
  const password = randomBytes(24).toString('hex');
  // The Management API endpoint the dashboard's "Reset password" uses.
  await mgmt('PATCH', `/projects/${REF}/database/password`, { password });
  say('database password changed in Supabase; proving a fresh login…');
  let proven = false;
  for (let i = 0; i < 60 && !proven; i++) {
    proven = sql(localUrl(v.DIRECT_URL, password), 'SELECT 1;').ok;
    if (!proven) await new Promise((r) => setTimeout(r, 5000));
  }
  if (!proven) {
    await mgmt('PATCH', `/projects/${REF}/database/password`, { password: oldPassword }).catch(() => null);
    const back = sql(localUrl(v.DIRECT_URL), 'SELECT 1;').ok;
    throw new Error(`new password did not log in within 5 minutes — ${back ? 'old password restored and working' : 'OLD PASSWORD RESTORE NOT CONFIRMED'}; Railway not switched. Tell Claude.`);
  }
  railway(['variables', ...T, '--skip-deploys', '--set', `DATABASE_URL=${withPassword(v.DATABASE_URL, password)}`, '--set', `DIRECT_URL=${withPassword(v.DIRECT_URL, password)}`]);
  spawnSync('gh', ['secret', 'set', 'SUPABASE_DB_URL', '--repo', REPO], { input: localUrl(v.DIRECT_URL, password), encoding: 'utf8' });
  for (const f of ['.env', 'apps/api/.env', '.mcp.json']) updateFile(f, (t) => swapDbPassword(t, password));
  say('new password proven and staged (Railway, GitHub backup secret, local); deploying…');
  const ok = (await waitForDeploy(await deployMaster())) && (await healthy());
  if (!ok) throw new Error('deploy not confirmed healthy — tell Claude now.');
  say('API healthy on the new database password. Reconnect the postgres tool in Claude (it uses .mcp.json).');
}

const cmd = process.argv[2];
const steps = { check, run, 'delete-old-key': deleteOldKey, 'db-password': dbPassword };
(steps[cmd] ? steps[cmd]() : Promise.reject(new Error('usage: node scripts/supabase-rotation.mjs check|run|delete-old-key|db-password')))
  .catch((e) => { console.log(`STOPPED: ${e.message}`); process.exit(1); });
