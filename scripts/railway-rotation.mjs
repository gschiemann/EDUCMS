#!/usr/bin/env node
// Railway breach follow-up (2026-10-22): rotate the two device secrets through
// the key-ring window added in PR #129, and drop the revoked GitHub token, then
// deploy master. Prints names and checks only, never a secret value.
//
//   node scripts/railway-rotation.mjs start    # new device secrets, old ones kept as *_PREVIOUS, deploy
//   node scripts/railway-rotation.mjs finish   # after >= 2 h: remove *_PREVIOUS, deploy
//
// Needs the Railway CLI logged in (`railway whoami`). docs/SECRET-ROTATION.md has the why.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const SERVICE_ID = '5220b230-9824-4c95-862e-74bb657b2312'; // api
const ENV_ID = 'dac3f973-c916-49ab-8ba7-ec76ddaa1d95'; // production
const TARGET = ['--service', 'api', '--environment', 'production'];
const PAIRS = ['DEVICE_JWT_SECRET', 'DEVICE_SECRET_KEY'];

const railway = (args, input) => {
  const r = spawnSync('railway', args, { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`railway ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  return r.stdout;
};
const vars = () => JSON.parse(railway(['variables', ...TARGET, '--json']));

async function deployMaster() {
  const sha = execFileSync('git', ['ls-remote', 'https://github.com/gschiemann/EDUCMS.git', 'refs/heads/master'], { encoding: 'utf8' }).split(/\s/)[0];
  const token = JSON.parse(readFileSync(`${homedir()}/.railway/config.json`, 'utf8')).user?.accessToken;
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation($s:String!,$e:String!,$c:String!){serviceInstanceDeployV2(serviceId:$s,environmentId:$e,commitSha:$c)}',
      variables: { s: SERVICE_ID, e: ENV_ID, c: sha },
    }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`deploy failed: ${JSON.stringify(body.errors).slice(0, 300)}`);
  console.log(`deploy of master ${sha.slice(0, 8)} started (${body.data.serviceInstanceDeployV2})`);
  return body.data.serviceInstanceDeployV2;
}

async function start() {
  const v = vars();
  const sets = [];
  for (const name of PAIRS) {
    if (v[`${name}_PREVIOUS`]) throw new Error(`${name}_PREVIOUS is already set: a rotation window is open. Run "finish" first.`);
    if (!v[name] || v[name].length < 32) throw new Error(`${name} looks wrong (length ${v[name]?.length ?? 0}); not touching it.`);
    sets.push('--set', `${name}_PREVIOUS=${v[name]}`, '--set', `${name}=${randomBytes(32).toString('hex')}`);
  }
  railway(['variables', ...TARGET, '--skip-deploys', ...sets]);
  const after = vars();
  for (const name of PAIRS) {
    const ok = after[`${name}_PREVIOUS`] === v[name] && after[name] !== v[name] && /^[0-9a-f]{64}$/.test(after[name]);
    console.log(`${name}: ${ok ? 'new value set, old kept as _PREVIOUS' : 'CHECK FAILED'}`);
    if (!ok) throw new Error('verification failed; nothing deployed');
  }
  if (v.GH_TOKEN) {
    const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${v.GH_TOKEN}` } });
    if (r.status === 401) {
      railway(['variable', 'delete', 'GH_TOKEN', ...TARGET]);
      console.log('GH_TOKEN: revoked token removed (app updates read the public repo anonymously)');
    } else {
      console.log(`GH_TOKEN: GitHub says ${r.status}; left as is`);
    }
  }
  await deployMaster();
  console.log('Done. Screens move to the new keys by themselves. Run "finish" in 2 hours or more.');
}

async function finish() {
  const v = vars();
  for (const name of PAIRS) {
    if (!v[`${name}_PREVIOUS`]) { console.log(`${name}_PREVIOUS: not set, nothing to remove`); continue; }
    railway(['variable', 'delete', `${name}_PREVIOUS`, ...TARGET]);
    console.log(`${name}_PREVIOUS: removed`);
  }
  await deployMaster();
  console.log('Done. The old device secrets no longer work anywhere.');
}

const cmd = process.argv[2];
if (cmd === 'start') await start();
else if (cmd === 'finish') await finish();
else { console.log('usage: node scripts/railway-rotation.mjs start|finish'); process.exit(1); }
