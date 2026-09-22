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

const DIR = process.env.I18N_DIR || path.join(__dirname, '..', 'src', 'i18n', 'messages');
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

// ── Angle-bracket tags (2026-09-22) ───────────────────────────────────────
// next-intl parses `<tag>…</tag>` in EVERY message as rich text. A tag the
// caller passes no handler for — or any tag read through plain `t()` — makes
// the lookup fail and the UI prints the message PATH instead of the text.
// That is how "Paste HTML or text here. <script> tags will be stripped."
// rendered as the literal `opsPages.bodyPlaceholder` on the Announcements
// page for months (found by eye during a browser pass, never by a check).
//
// Two rules, both derived from the source tree so they cannot drift:
//   1. a tag in a catalog message must be one some `t.rich(` / `t.markup(`
//      call in apps/web/src actually supplies a handler for;
//   2. a message that carries tags must be read by a `t.rich(` / `t.markup(`
//      call whose key is a dot-boundary suffix of the message path (the
//      namespace half of the path lives in `useTranslations('…')`).
const SRC = path.join(__dirname, '..', 'src');
function walkSource(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSource(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/__tests__|\.test\.|\.spec\./.test(p)) out.push(p);
  }
  return out;
}
const RICH_CALL = /\.(?:rich|markup)\(\s*['"`]([^'"`]+)['"`]\s*,/g;
const richKeys = new Set();
const richTags = new Set();
for (const file of walkSource(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = RICH_CALL.exec(text))) {
    richKeys.add(m[1]);
    // handler object follows the key: collect its `name:` / `name(` keys
    const window = text.slice(m.index, m.index + 800);
    const body = window.slice(window.indexOf('{'));
    for (const h of body.matchAll(/(?:^|[{,\s])([A-Za-z][\w-]*)\s*[:(]/g)) richTags.add(h[1]);
  }
}
const TAG_RE = /<\s*\/?\s*([A-Za-z][\w-]*)[^>]*>/g;
const isRead = (keyPath) => [...richKeys].some((k) => keyPath === k || keyPath.endsWith('.' + k));
let tagFailures = 0;
for (const file of [BASE, ...locales]) {
  const flat = flatten(JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')));
  for (const [key, msg] of Object.entries(flat)) {
    if (typeof msg !== 'string') continue;
    const tags = [...new Set([...msg.matchAll(TAG_RE)].map((t) => t[1]))];
    if (tags.length === 0) continue;
    const unknown = tags.filter((t) => !richTags.has(t));
    if (unknown.length) {
      tagFailures++;
      console.error(`  ${file} ${key}: tag <${unknown.join('>, <')}> has NO t.rich/t.markup handler anywhere in apps/web/src — the UI would print "${key}" instead of the text. Drop the angle brackets or add a handler.`);
    } else if (!isRead(key)) {
      tagFailures++;
      console.error(`  ${file} ${key}: carries <${tags.join('>, <')}> but no t.rich/t.markup call reads a key ending in "${key.split('.').slice(-1)[0]}" — plain t() on a tagged message prints the key path.`);
    }
  }
}
if (tagFailures) {
  console.error(`\nFAIL: ${tagFailures} catalog message(s) carry an angle-bracket tag next-intl cannot render.`);
  process.exit(1);
}
console.log(`OK — i18n tags: every <tag> in the catalogs has a t.rich/t.markup handler (${[...richTags].sort().join(', ')}) and is read through one.`);

