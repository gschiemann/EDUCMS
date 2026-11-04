#!/usr/bin/env node
/*
 * Pill-rules guard (pill cleanup, 2026-11-02 — owner-approved one-system UI).
 *
 * The rule (docs/research/2026-11-02-pill-audit/00-plan.md §2.1):
 *   a fully rounded tinted pill is ONLY a read-only status or count
 *   (`components/ui/status-pill.tsx`). Anything a person can press is a
 *   Button, a TabRow tab, a Segmented option, a FilterMenu row or a menu item
 *   — the shared components in `components/ui/`.
 *
 * What this flags, in every .tsx under apps/web/src OUTSIDE components/ui:
 *   1. a `<button>` whose className is `rounded-full` AND padded `px-*`
 *      (a clickable pill — icon dots and round icon buttons have no `px-`);
 *   2. a `<button aria-pressed …>` with a rounded, padded className
 *      (`rounded-lg|xl|2xl|md|full` + `px-*`) — a toggle chip, the unit of a
 *      "row of pills" filter strip.
 *
 * Existing instances are counted per file in `pill-rules-baseline.json`.
 * CI fails when a file goes ABOVE its baseline, or a file not in the baseline
 * has any. The baseline only goes DOWN: run `baseline` after a cleanup and
 * the counts shrink; it refuses to raise one.
 *
 * Escape hatch: `pill-allow: <reason>` in a comment on the button's line or
 * the line above it (reviewed in the PR) — e.g. a removable tag chip.
 *
 * Out of scope (other contracts): components/ui (the shared components
 * themselves), widgets + player (kiosk render path), tests.
 *
 * No dependencies (the Mobile Perf job runs it without an install).
 *
 * Run:
 *   node apps/web/tools/check-pill-rules.cjs            # check (CI mode)
 *   node apps/web/tools/check-pill-rules.cjs baseline   # lower the baseline
 *   node apps/web/tools/check-pill-rules.cjs --list     # print every hit
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(WEB_ROOT, 'src');
const BASELINE_FILE = path.join(__dirname, 'pill-rules-baseline.json');

const EXCLUDE = [
  /[\\/]components[\\/]ui[\\/]/,
  /[\\/]components[\\/]widgets[\\/]/,
  /[\\/]components[\\/]player[\\/]/,
  /[\\/]app[\\/]player[\\/]/,
  /[\\/]__tests__[\\/]/,
  /\.(test|spec)\.tsx$/,
];

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p, out); }
    else if (ent.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * The text of a JSX opening tag that starts at `start` (the `<`), up to and
 * including its closing `>` — skipping `>` inside `{…}` expressions (arrow
 * functions) and inside string / template literals.
 */
function openingTag(src, start) {
  let depth = 0;
  let quote = null; // '"', "'", '`'
  const tpl = []; // brace depth at which each open template literal resumes
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (quote === '`' && c === '$' && src[i + 1] === '{') { tpl.push(depth); depth++; quote = null; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') {
      depth--;
      if (tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); quote = '`'; }
      continue;
    }
    if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

/** The className attribute's raw text (string or expression), or ''. */
function classText(tag) {
  const m = /\bclassName\s*=\s*/.exec(tag);
  if (!m) return '';
  const from = m.index + m[0].length;
  if (tag[from] === '"' || tag[from] === "'") {
    const end = tag.indexOf(tag[from], from + 1);
    return tag.slice(from, end + 1);
  }
  if (tag[from] === '{') {
    let depth = 0;
    for (let i = from; i < tag.length; i++) {
      if (tag[i] === '{') depth++;
      else if (tag[i] === '}') { depth--; if (depth === 0) return tag.slice(from, i + 1); }
    }
  }
  return '';
}

const PADDED = /(^|[\s"'`{])(sm:|md:|lg:)?px-(\d|\[)/;
const FULL = /(^|[\s"'`{])rounded-full(\s|["'`}]|$)/;
const ROUNDED = /(^|[\s"'`{])rounded-(full|md|lg|xl|2xl)(\s|["'`}]|$)/;

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = [];
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = openingTag(src, m.index);
    if (!tag) continue;
    const cls = classText(tag);
    if (!cls) continue;
    const pressed = /\baria-pressed\b/.test(tag);
    const pill = FULL.test(cls) && PADDED.test(cls);
    const chip = pressed && ROUNDED.test(cls) && PADDED.test(cls);
    if (!pill && !chip) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const lines = src.split('\n');
    const near = (lines[line - 2] || '') + '\n' + (lines[line - 1] || '') + '\n' + tag;
    if (/pill-allow:/.test(near)) continue;
    hits.push({ line, kind: pill ? 'clickable pill' : 'toggle chip' });
  }
  return hits;
}

function main() {
  const mode = process.argv[2];
  const files = walk(SRC, []).filter((f) => !EXCLUDE.some((re) => re.test(f)));
  const counts = {};
  const detail = {};
  for (const f of files) {
    const hits = scanFile(f);
    if (hits.length) {
      const rel = path.relative(WEB_ROOT, f).split(path.sep).join('/');
      counts[rel] = hits.length;
      detail[rel] = hits;
    }
  }
  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (mode === '--list') {
    for (const [f, hits] of Object.entries(detail).sort()) for (const h of hits) console.log(`${f}:${h.line}  ${h.kind}`);
    console.log(`${total} total`);
    return;
  }

  if (mode === 'baseline') {
    const first = !fs.existsSync(BASELINE_FILE);
    const next = {};
    for (const [f, n] of Object.entries(counts)) {
      if (!first && (baseline[f] ?? 0) < n) {
        console.error(`✖ refusing to RAISE the baseline for ${f} (${baseline[f] ?? 0} → ${n}). Fix it, or mark a justified exception with "pill-allow: <reason>".`);
        process.exit(1);
      }
      next[f] = n;
    }
    const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`pill-rules baseline written: ${total} in ${Object.keys(sorted).length} files`);
    return;
  }

  const over = [];
  for (const [f, n] of Object.entries(counts)) {
    const b = baseline[f] ?? 0;
    if (n > b) over.push({ f, n, b });
  }
  const lowered = Object.entries(baseline).filter(([f, b]) => (counts[f] ?? 0) < b);
  if (over.length) {
    console.error('✖ Pill rules: new clickable pills / toggle chips outside components/ui.');
    console.error('  A pill is read-only (StatusPill). Use Button, TabRow, Segmented, FilterMenu or OverflowMenu.');
    for (const { f, n, b } of over) {
      console.error(`  ${f}: ${n} (baseline ${b})`);
      for (const h of detail[f]) console.error(`    line ${h.line}: ${h.kind}`);
    }
    console.error('  Justified exception: a "pill-allow: <reason>" comment on or above the line.');
    process.exit(1);
  }
  console.log(`✓ Pill rules: ${total} legacy instance(s) in ${Object.keys(counts).length} file(s), none above baseline.`);
  if (lowered.length) {
    console.log(`  ${lowered.length} file(s) are now BELOW baseline — run "node apps/web/tools/check-pill-rules.cjs baseline" to lock the gain in.`);
  }
}

if (require.main === module) main();
module.exports = { scanFile, openingTag, classText };
