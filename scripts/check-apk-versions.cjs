#!/usr/bin/env node
'use strict';

/**
 * check-apk-versions.cjs — the ONE RELEASE UNIT guard (2026-11-08).
 *
 * The Player APK and the Manager APK it carries are versioned from a single
 * file, apps/player/versions.properties:
 *
 *   unit.version     the Player APK = the release unit = the `player-v<unit>` tag
 *                    = the `## Release: player <unit>` hardware-qualification row.
 *   manager.version  the Manager APK bundled inside it. Moves ONLY in a release
 *                    that changes apps/player/manager (then it equals
 *                    unit.version); otherwise it stays, so the Player's bootstrap
 *                    finds nothing newer and never reinstalls an unchanged
 *                    companion (ManagerBootstrap / ManagerUpgradeMath compare
 *                    versionCodes: install only when bundled > installed).
 *
 * This script FAILS (exit 1, every offence listed) when:
 *   (a) either key is missing or not x.y.z (minor/patch ≤ 2 digits — the
 *       major*10000 + minor*100 + patch versionCode formula the API derives);
 *   (b) manager.version is at or below 1.0.24 (the last hand-typed Manager —
 *       versionCodes must stay monotonic above 10024), or above unit.version
 *       (the companion can never be newer than the unit that carries it);
 *   (c) a gradle module types a literal `versionCode = N` / `versionName = "…"`
 *       again, or stops reading versions.properties;
 *   (d) with --base <ref> (CI passes the PR base): apps/player/manager changed
 *       since <ref> but manager.version was not raised to unit.version — the
 *       fleet would run new Manager bytes under an old versionCode, and the
 *       Player would never install them. (A manager.version bump with no
 *       Manager change is reported as a warning: it only costs a reinstall.)
 *
 * Dependency-free plain Node so CI can run it with no `pnpm install`.
 *
 *   node scripts/check-apk-versions.cjs                 # check the checkout
 *   node scripts/check-apk-versions.cjs --base origin/master
 *   node scripts/check-apk-versions.cjs --json          # machine-readable
 *   node scripts/check-apk-versions.cjs --self-test     # negative + positive control
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const VERSIONS_FILE = 'apps/player/versions.properties';
const MODULES = {
  player: 'apps/player/app/build.gradle.kts',
  manager: 'apps/player/manager/build.gradle.kts',
};
const MANAGER_DIR = 'apps/player/manager';
/** The last hand-typed Manager (manager-v1.0.24, 2026-09-01). Nothing may ship at or below it. */
const MANAGER_FLOOR = '1.0.24';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;

function versionCode(v) {
  const m = SEMVER.exec(String(v || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * @param {{root:string, base?:string|null}} opts
 * @returns {{ok:boolean, errors:string[], warnings:string[], versions:{unit:string|null, manager:string|null}}}
 */
function evaluate(opts) {
  const root = opts.root;
  const errors = [];
  const warnings = [];
  const versionsPath = path.join(root, VERSIONS_FILE);
  let unit = null;
  let manager = null;

  if (!fs.existsSync(versionsPath)) {
    errors.push(`${VERSIONS_FILE} is missing — it is the only place an APK version may be typed`);
  } else {
    const props = parseProperties(fs.readFileSync(versionsPath, 'utf8'));
    unit = props['unit.version'] ?? null;
    manager = props['manager.version'] ?? null;
    if (!unit || !SEMVER.test(unit)) errors.push(`${VERSIONS_FILE}: unit.version must be x.y.z (got "${unit ?? ''}")`);
    if (!manager || !SEMVER.test(manager)) errors.push(`${VERSIONS_FILE}: manager.version must be x.y.z (got "${manager ?? ''}")`);
    if (unit && manager && SEMVER.test(unit) && SEMVER.test(manager)) {
      if (versionCode(manager) <= versionCode(MANAGER_FLOOR)) {
        errors.push(`${VERSIONS_FILE}: manager.version ${manager} is not above ${MANAGER_FLOOR} (versionCode ${versionCode(manager)} ≤ ${versionCode(MANAGER_FLOOR)}) — the Manager's versionCode must stay monotonic above the last hand-typed release`);
      }
      if (versionCode(manager) > versionCode(unit)) {
        errors.push(`${VERSIONS_FILE}: manager.version ${manager} is above unit.version ${unit} — the companion can never be newer than the unit that carries it`);
      }
    }
  }

  for (const [mod, rel] of Object.entries(MODULES)) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      errors.push(`${rel} is missing`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    const literalCode = /^\s*versionCode\s*=\s*\d+/m.exec(text);
    const literalName = /^\s*versionName\s*=\s*"[^"]*"/m.exec(text);
    if (literalCode) errors.push(`${rel}: types a literal "${literalCode[0].trim()}" — the ${mod} version comes from ${VERSIONS_FILE}`);
    if (literalName) errors.push(`${rel}: types a literal "${literalName[0].trim()}" — the ${mod} version comes from ${VERSIONS_FILE}`);
    if (!/versions\.properties/.test(text)) errors.push(`${rel}: does not read versions.properties`);
  }

  if (opts.base && unit && manager && SEMVER.test(unit) && SEMVER.test(manager)) {
    const diff = spawnSync('git', ['diff', '--name-only', `${opts.base}...HEAD`, '--', MANAGER_DIR], {
      cwd: root,
      encoding: 'utf8',
    });
    if (diff.status !== 0) {
      warnings.push(`could not diff against ${opts.base} (${(diff.stderr || '').trim() || 'git failed'}) — the "Manager changed ⇒ version raised" rule was not checked`);
    } else {
      const changed = diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      const baseProps = spawnSync('git', ['show', `${opts.base}:${VERSIONS_FILE}`], { cwd: root, encoding: 'utf8' });
      const baseManager = baseProps.status === 0 ? parseProperties(baseProps.stdout)['manager.version'] ?? null : null;
      const managerBumped = baseManager !== null && baseManager !== manager;
      if (changed.length > 0 && manager !== unit) {
        errors.push(
          `${changed.length} file(s) under ${MANAGER_DIR} changed since ${opts.base} but manager.version (${manager}) ` +
            `is not unit.version (${unit}) — new Manager bytes would ship under an old versionCode and the Player ` +
            `would never install them. Set manager.version=${unit} in ${VERSIONS_FILE}.`,
        );
      }
      if (changed.length === 0 && managerBumped) {
        warnings.push(
          `manager.version moved ${baseManager} → ${manager} with no change under ${MANAGER_DIR} since ${opts.base} — ` +
            `every screen will reinstall an unchanged companion (one Install tap on Android ≤ 11).`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, versions: { unit, manager } };
}

// ── self-test: a passing fixture, then each rule broken once ──────────────

function selfTest() {
  const os = require('os');
  const mk = (versions, gradles) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-versions-'));
    fs.mkdirSync(path.join(dir, 'apps/player/app'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'apps/player/manager'), { recursive: true });
    if (versions !== null) fs.writeFileSync(path.join(dir, VERSIONS_FILE), versions);
    fs.writeFileSync(path.join(dir, MODULES.player), gradles.player);
    fs.writeFileSync(path.join(dir, MODULES.manager), gradles.manager);
    return dir;
  };
  const good = 'rootProject.file("versions.properties")\n';
  const cases = [
    { name: 'passing', ok: true, versions: 'unit.version=1.1.30\nmanager.version=1.1.30\n', gradles: { player: good, manager: good } },
    { name: 'manager behind unit (unchanged companion)', ok: true, versions: 'unit.version=1.1.31\nmanager.version=1.1.30\n', gradles: { player: good, manager: good } },
    { name: 'missing file', ok: false, versions: null, gradles: { player: good, manager: good } },
    { name: 'manager at the floor', ok: false, versions: 'unit.version=1.1.30\nmanager.version=1.0.24\n', gradles: { player: good, manager: good } },
    { name: 'manager above unit', ok: false, versions: 'unit.version=1.1.30\nmanager.version=1.1.31\n', gradles: { player: good, manager: good } },
    { name: 'three-digit patch', ok: false, versions: 'unit.version=1.1.300\nmanager.version=1.1.30\n', gradles: { player: good, manager: good } },
    { name: 'literal in gradle', ok: false, versions: 'unit.version=1.1.30\nmanager.version=1.1.30\n', gradles: { player: `${good}        versionCode = 10130\n`, manager: good } },
    { name: 'gradle not reading the file', ok: false, versions: 'unit.version=1.1.30\nmanager.version=1.1.30\n', gradles: { player: good, manager: '// nothing\n' } },
  ];
  let failed = 0;
  for (const c of cases) {
    const dir = mk(c.versions, c.gradles);
    const res = evaluate({ root: dir });
    const pass = res.ok === c.ok;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${c.name}${pass ? '' : ` — expected ok=${c.ok}, got ${JSON.stringify(res.errors)}`}`);
    if (!pass) failed += 1;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failed) {
    console.error(`check-apk-versions self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log('check-apk-versions self-test: all cases behaved');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  const json = argv.includes('--json');
  const baseIdx = argv.indexOf('--base');
  const base = baseIdx >= 0 ? argv[baseIdx + 1] || null : null;
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1] || REPO_ROOT) : REPO_ROOT;
  const res = evaluate({ root, base });
  if (json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`unit.version=${res.versions.unit ?? '?'} (versionCode ${versionCode(res.versions.unit)})  manager.version=${res.versions.manager ?? '?'} (versionCode ${versionCode(res.versions.manager)})`);
    for (const w of res.warnings) console.log(`warning: ${w}`);
    for (const e of res.errors) console.error(`error: ${e}`);
    console.log(res.ok ? 'check-apk-versions: ok' : `check-apk-versions: ${res.errors.length} error(s)`);
  }
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { evaluate, versionCode, parseProperties };
