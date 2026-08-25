#!/usr/bin/env node
/**
 * check-i18n-parity — the three locale catalogs must never drift.
 *
 * Found missing during the 2026-08-25 emergency-surface localization: en/es/zh
 * are maintained at exact key parity by convention, but NOTHING enforced it —
 * a key added to en only would silently render its raw key path (or English
 * fallback) to a Spanish operator, and on the emergency surfaces that class of
 * drift is a life-safety copy bug, not cosmetics.
 *
 * Checks, per non-English catalog against en.json:
 *   1. KEY PARITY — every key in en exists in the locale and vice versa
 *      (flattened dot-paths; missing and extra both fail).
 *   2. ICU SHAPE — every message's {placeholder} set and <richTag> set match
 *      en exactly. A translation that drops {count} or renames a tag breaks
 *      at runtime only on that locale.
 *   3. EMPTINESS — no locale value may be an empty string when en's isn't.
 *
 * Zero deps, zero config, no baseline: parity is already true today, so this
 * is a hard gate, not a ratchet. Run: node apps/web/tools/check-i18n-parity.cjs
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'messages');
const BASE = 'en.json';
const locales = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== BASE);

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// TOP-LEVEL ICU argument names + <tag> names. Depth-aware on purpose: in
// `{count, plural, one {schedule} other {schedules}}` only `count` is an
// argument — the option bodies are per-language message TEXT and legitimately
// differ across locales (the naive regex flagged every plural/select as a
// mismatch). A `{` at depth 0 opens an argument (capture its name); every
// nested `{` is option text and is skipped. ICU `''` literal-quote handled.
function icuShape(msg) {
  const s = String(msg ?? '');
  const placeholders = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && s[i + 1] === "'") { i++; continue; } // escaped literal quote
    if (c === '{') {
      if (depth === 0) {
        const m = /^\{\s*([a-zA-Z0-9_]+)/.exec(s.slice(i));
        if (m) placeholders.push(m[1]);
      }
      depth++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  const tags = [...s.matchAll(/<([a-zA-Z0-9_]+)>/g)].map((m) => m[1]).sort();
  return JSON.stringify({ placeholders: placeholders.sort(), tags });
}

const en = flatten(JSON.parse(fs.readFileSync(path.join(DIR, BASE), 'utf8')));
const enKeys = Object.keys(en);
let failures = 0;
const report = (msg) => { failures++; console.error('  ' + msg); };

for (const file of locales) {
  const loc = flatten(JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')));
  const locKeys = new Set(Object.keys(loc));
  console.error(`— ${file} (${locKeys.size} keys vs en ${enKeys.length})`);
  for (const k of enKeys) {
    if (!locKeys.has(k)) { report(`MISSING in ${file}: ${k}`); continue; }
    if (loc[k] === '' && en[k] !== '') report(`EMPTY in ${file}: ${k}`);
    else if (icuShape(loc[k]) !== icuShape(en[k])) report(`ICU MISMATCH in ${file}: ${k} (${icuShape(en[k])} vs ${icuShape(loc[k])})`);
  }
  for (const k of locKeys) if (!(k in en)) report(`EXTRA in ${file} (not in en): ${k}`);
}

if (failures) {
  console.error(`\nFAIL: ${failures} i18n parity violation(s). The three catalogs`);
  console.error('ship together — add/edit every key in en, es, AND zh in the same commit.');
  process.exit(1);
}
console.log(`OK — i18n parity: en + ${locales.join(' + ')} agree on ${enKeys.length} keys, ICU shapes, non-emptiness.`);
