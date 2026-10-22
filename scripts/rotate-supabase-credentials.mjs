#!/usr/bin/env node
// Rotate the Supabase database password and/or service role key everywhere we
// keep a copy (docs/SECRET-ROTATION.md), after resetting them in the Supabase
// dashboard. Paste each new value once at the hidden prompt; press Enter to
// skip one. Nothing is printed or written to disk outside the stores below.
//
//   Railway (api service, staged with --skip-deploys — the next deploy picks
//   them up), GitHub repo secrets, local .env + apps/api/.env, .mcp.json.
//
// Usage: node scripts/rotate-supabase-credentials.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const REPO = 'gschiemann/EDUCMS';
const RAILWAY = ['--service', 'api', '--environment', 'production'];

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${(r.stderr || '').trim().slice(0, 300)}`);
  return r.stdout;
}

function ask(prompt) {
  return new Promise((done) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return done(value.trim());
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// Replace the password of every postgres URL in `text`, keeping user/host/params.
function swapDbPassword(text, password) {
  return text.replace(/(postgres(?:ql)?:\/\/[^:\/\s"'@]+:)([^@\s"']*)(@)/g, (_, a, _old, c) => a + encodeURIComponent(password) + c);
}

function updateFile(path, edit) {
  const file = resolve(ROOT, path);
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = edit(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`  updated ${path}`);
  }
}

const vars = JSON.parse(run('railway', ['variables', ...RAILWAY, '--json']));
const dbPassword = await ask('New Supabase DATABASE password (Enter to skip): ');
const serviceKey = await ask('New Supabase SERVICE ROLE key (Enter to skip): ');

if (dbPassword) {
  console.log('Database password:');
  const databaseUrl = swapDbPassword(vars.DATABASE_URL, dbPassword);
  const directUrl = swapDbPassword(vars.DIRECT_URL, dbPassword);
  run('railway', ['variables', ...RAILWAY, '--skip-deploys', '--set', `DATABASE_URL=${databaseUrl}`, '--set', `DIRECT_URL=${directUrl}`]);
  console.log('  updated Railway DATABASE_URL + DIRECT_URL (staged)');
  run('gh', ['secret', 'set', 'SUPABASE_DB_URL', '--repo', REPO], directUrl);
  console.log('  updated GitHub secret SUPABASE_DB_URL');
  for (const f of ['.env', 'apps/api/.env', '.mcp.json']) updateFile(f, (t) => swapDbPassword(t, dbPassword));
}

if (serviceKey) {
  console.log('Service role key:');
  run('railway', ['variables', ...RAILWAY, '--skip-deploys', '--set', `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`]);
  console.log('  updated Railway SUPABASE_SERVICE_ROLE_KEY (staged)');
  run('gh', ['secret', 'set', 'SUPABASE_SERVICE_ROLE_KEY', '--repo', REPO], serviceKey);
  console.log('  updated GitHub secret SUPABASE_SERVICE_ROLE_KEY');
  for (const f of ['.env', 'apps/api/.env']) {
    updateFile(f, (t) => t.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`));
  }
}

console.log(dbPassword || serviceKey ? 'Done. Tell Claude, and it will deploy the API.' : 'Nothing changed.');
