#!/usr/bin/env node
/**
 * Android string-resource parity (the en + es + zh rule for the APKs).
 *
 * apps/web/tools/check-i18n-parity.cjs covers the web catalogs and nothing
 * under apps/player. This gate covers the two Android modules:
 *
 *   1. Every apps/player/<module>/src/main/res/values/<file>.xml has a
 *      values-es/<file>.xml and values-zh/<file>.xml with the same string keys
 *      and the same printf placeholders (%1$s, %d ...) per key.
 *      A file that declares tools:ignore="MissingTranslation" on <resources>
 *      is a documented English-only waiver (apps/player/app strings.xml) and
 *      is skipped; it must not grow a key a translated sibling already has.
 *   2. The Manager's Kotlin has no hard-coded notification text: no string
 *      literal passed to setContentTitle / setContentText / bigText / a
 *      channel `description =`.
 *
 *   node scripts/check-android-i18n-parity.cjs            # check
 *   node scripts/check-android-i18n-parity.cjs --self-test
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['app', 'manager'].map((m) => path.join(ROOT, 'apps/player', m, 'src/main'));
const LOCALES = ['es', 'zh'];

function parseStrings(xml) {
  const out = new Map();
  const re = /<string\s+([^>]*?)>([\s\S]*?)<\/string>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = /name="([^"]+)"/.exec(m[1]);
    if (!name) continue;
    if (/translatable="false"/.test(m[1])) continue;
    out.set(name[1], m[2]);
  }
  return out;
}
function placeholders(value) {
  return (value.match(/%(?:\d+\$)?[sdfx]/g) || []).map((p) => p.replace(/^%\d+\$/, '%')).sort().join(',');
}
function waived(xml) {
  return /<resources[^>]*tools:ignore="[^"]*MissingTranslation/.test(xml);
}

function checkResources(resDir, problems) {
  const base = path.join(resDir, 'values');
  if (!fs.existsSync(base)) return;
  for (const file of fs.readdirSync(base).filter((f) => /^strings.*\.xml$/.test(f))) {
    const xml = fs.readFileSync(path.join(base, file), 'utf8');
    if (waived(xml)) continue;
    const en = parseStrings(xml);
    for (const loc of LOCALES) {
      const p = path.join(resDir, `values-${loc}`, file);
      if (!fs.existsSync(p)) {
        problems.push(`${path.relative(ROOT, p)} is missing (values/${file} has ${en.size} strings)`);
        continue;
      }
      const tr = parseStrings(fs.readFileSync(p, 'utf8'));
      for (const [k, v] of en) {
        if (!tr.has(k)) { problems.push(`${path.relative(ROOT, p)}: missing key "${k}"`); continue; }
        if (placeholders(v) !== placeholders(tr.get(k))) {
          problems.push(`${path.relative(ROOT, p)}: "${k}" placeholders differ from values/${file}`);
        }
        if (!tr.get(k).trim()) problems.push(`${path.relative(ROOT, p)}: "${k}" is empty`);
      }
      for (const k of tr.keys()) if (!en.has(k)) problems.push(`${path.relative(ROOT, p)}: extra key "${k}" not in values/${file}`);
    }
  }
}

const LITERAL_NOTIFICATION =
  /(setContentTitle|setContentText|bigText|setTicker|Toast\.makeText\([^)]*,)\s*\(?\s*"/;
const LITERAL_DESCRIPTION = /\bdescription\s*=\s*"/;

function scanKotlin(dir, problems) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { scanKotlin(p, problems); continue; }
    if (!entry.name.endsWith('.kt')) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (LITERAL_NOTIFICATION.test(code) || LITERAL_DESCRIPTION.test(code)) {
        problems.push(`${path.relative(ROOT, p)}:${i + 1}: user-visible text must be a string resource, not a literal`);
      }
    });
  }
}

function run() {
  const problems = [];
  for (const mod of MODULES) checkResources(path.join(mod, 'res'), problems);
  scanKotlin(path.join(ROOT, 'apps/player/manager/src/main/java'), problems);
  return problems;
}

function selfTest() {
  const assert = require('assert');
  assert.strictEqual(placeholders('Install %1$s now %d'), '%d,%s');
  assert.strictEqual(parseStrings('<string name="a">x</string><string name="b" translatable="false">y</string>').size, 1);
  assert.ok(waived('<resources xmlns:tools="x" tools:ignore="MissingTranslation">'));
  assert.ok(LITERAL_NOTIFICATION.test('.setContentTitle("Hi")'));
  assert.ok(!LITERAL_NOTIFICATION.test('.setContentTitle(ctx.getString(R.string.a))'));
  assert.ok(LITERAL_DESCRIPTION.test('description = "Tap"'));
  console.log('check-android-i18n-parity self-test: ok');
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const problems = run();
  if (problems.length) {
    console.error('Android i18n parity FAILED:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('Android i18n parity: ok');
}
