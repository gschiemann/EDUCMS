#!/usr/bin/env node
/*
 * TRACKED-KEYSTORE / SIGNING-SECRET GUARD
 * ==================================================================
 * Fails CI if a signing keystore (or a properties file that holds its
 * passwords) is TRACKED BY GIT, or if a non-default signing password is
 * hardcoded in a Gradle file.
 *
 * WHY
 * ---
 * This repo is PUBLIC (github.com/gschiemann/EDUCMS) and it already
 * ships `apps/player/app/debug.keystore` — force-included via a
 * `!app/debug.keystore` negation in apps/player/.gitignore, with its
 * passwords hardcoded in app/build.gradle.kts. That key signs the APK
 * that every K-12 kiosk installs as an OTA update, so anyone who clones
 * the repo can build an APK that Android accepts as a legitimate update
 * to our player.
 *
 * That ONE key is a known, dated, deliberate exception below — it
 * cannot be removed without a fleet-wide manual reinstall, so retiring
 * it is scheduled work (apps/player/RELEASE_SIGNING.md), not something
 * a guard should force.
 *
 * The POINT of this guard is to make sure a SECOND key never gets
 * committed while the known one is being retired. New keystore, no
 * exception entry → red build.
 *
 * USAGE
 *   node scripts/check-tracked-keystores.cjs
 *
 * ESCAPE HATCH
 *   Append `keystore-allow` in a comment on an offending Gradle line if
 *   an exception is genuinely justified (reviewed in PR). There is
 *   deliberately NO escape hatch for a tracked keystore FILE — adding
 *   one must be a conscious edit to EXCEPTIONS below.
 *
 * EXIT CODES
 *   0  clean      1  violation
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const IS_CI = !!process.env.GITHUB_ACTIONS;
const ALLOW_MARKER = 'keystore-allow';

// ─────────────────────────────────────────────────────────────────────
// ⚠️  KNOWN EXCEPTIONS — dated, deliberate, and TEMPORARY.  ⚠️
//
// Do NOT add to this list to make a red build green. Adding an entry
// here means "this secret is knowingly published to the internet."
// The only correct response to a NEW keystore appearing in git is to
// remove it from the repo and purge it from history.
// ─────────────────────────────────────────────────────────────────────
const EXCEPTIONS = [
  {
    file: 'apps/player/app/debug.keystore',
    since: '2026-04-XX (commit 12194240, "v1.0.12: stable keystore")',
    why:
      'Signs every published Player + Manager APK. Committed so each CI build reuses ONE key — ' +
      'without it Android rejects OTA updates with INSTALL_FAILED_UPDATE_INCOMPATIBLE. ' +
      'MUST BE TREATED AS PERMANENTLY COMPROMISED: the repo is public and the store password ' +
      'is hardcoded in app/build.gradle.kts. Retiring it rotates the signing identity, which ' +
      'forces a MANUAL REINSTALL of every deployed screen — see apps/player/RELEASE_SIGNING.md ' +
      'for the scheduled cutover (that doc is also where this entry gets deleted).',
  },
];

// Keystore / key-container extensions.
const KEYSTORE_EXT = /\.(jks|keystore|p12|pfx|bks)$/i;
// Files whose whole purpose is to carry signing passwords.
const SECRET_PROPS = /(^|\/)(keystore|signing)\.properties$/i;

// ─────────────────────────────────────────────────────────────────────

const violations = [];
const warnings = [];

function flag(file, msg, line) {
  violations.push({ file, msg, line });
}

// ── 1. Tracked keystore / signing-secret FILES ───────────────────────

let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
} catch (err) {
  console.error(`FAIL: could not list git-tracked files: ${err.message}`);
  process.exit(1);
}

const exceptionPaths = new Set(EXCEPTIONS.map((e) => e.file));
const seenExceptions = new Set();

for (const f of tracked) {
  const isKeystore = KEYSTORE_EXT.test(f);
  const isSecretProps = SECRET_PROPS.test(f);
  if (!isKeystore && !isSecretProps) continue;

  if (exceptionPaths.has(f)) {
    seenExceptions.add(f);
    continue;
  }
  flag(
    f,
    isKeystore
      ? 'signing keystore is TRACKED BY GIT in a PUBLIC repo — anyone who clones can sign an APK ' +
        'that Android accepts as a legitimate update to our player. Remove it from the repo, purge ' +
        'it from history, and treat the key as compromised.'
      : 'a signing-password properties file is TRACKED BY GIT in a PUBLIC repo. Move these values ' +
        'to GitHub Actions secrets / local gradle.properties (gitignored).'
  );
}

// Stale exception: the known keystore is gone → the entry should go too.
// Warn, don't fail: going red the moment someone does the RIGHT thing
// (deleting the keystore at cutover) would be a hostile ratchet.
for (const e of EXCEPTIONS) {
  if (!seenExceptions.has(e.file)) {
    warnings.push(
      `stale exception: "${e.file}" is no longer tracked by git. If the release-signing cutover is ` +
        `done, delete this entry from EXCEPTIONS in ${path.relative(REPO_ROOT, __filename)}.`
    );
  }
}

// ── 2. Hardcoded signing passwords in Gradle ─────────────────────────
//
// `"android"` is the universal AOSP debug-keystore password — it is not
// a secret in any meaningful sense, and it is what the known exception
// above uses. ANY OTHER hardcoded literal is a real credential.

const PW_RE = /\b(storePassword|keyPassword)\s*=\s*"([^"]*)"/g;

function gradleFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.gradle' || e.name === 'node_modules') continue;
      gradleFiles(full, out);
    } else if (/^build\.gradle(\.kts)?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

for (const abs of gradleFiles(path.join(REPO_ROOT, 'apps', 'player'))) {
  const rel = path.relative(REPO_ROOT, abs);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    let m;
    PW_RE.lastIndex = 0;
    while ((m = PW_RE.exec(line))) {
      if (m[2] === 'android') continue; // AOSP default debug password
      flag(
        rel,
        `hardcoded ${m[1]} in a PUBLIC repo. Read it from a Gradle property / env var instead ` +
          `(see the release-signing block in apps/player/app/build.gradle.kts).`,
        i + 1
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────

console.log('── tracked-keystore / signing-secret guard ──────────────────');
console.log(`  scanned ${tracked.length} git-tracked files`);
for (const e of EXCEPTIONS) {
  if (seenExceptions.has(e.file)) {
    console.log(`  KNOWN EXCEPTION (temporary): ${e.file}`);
    console.log(`      since: ${e.since}`);
  }
}
console.log('');

for (const w of warnings) {
  console.log(`  WARN  ${w}`);
  if (IS_CI) console.log(`::warning::keystore-guard: ${w}`);
}

if (violations.length) {
  console.error('');
  console.error('  ############################################################');
  console.error('  #  SIGNING SECRET COMMITTED TO A PUBLIC REPO               #');
  console.error('  ############################################################');
  console.error('');
  for (const v of violations) {
    console.error(`  ${v.file}${v.line ? `:${v.line}` : ''}`);
    console.error(`      ${v.msg}`);
    if (IS_CI) console.error(`::error file=${v.file}${v.line ? `,line=${v.line}` : ''}::keystore-guard: ${v.msg}`);
  }
  console.error('');
  console.error('  A committed key cannot be un-published — anyone who cloned the');
  console.error('  repo has it forever. Rotate it, purge it from history, and see');
  console.error('  apps/player/RELEASE_SIGNING.md.');
  process.exit(1);
}

console.log('OK — no NEW signing keystore or hardcoded signing password is tracked by git.');
process.exit(0);
