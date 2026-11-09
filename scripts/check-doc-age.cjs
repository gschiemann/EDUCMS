#!/usr/bin/env node
/**
 * Doc-age sweep.
 *
 * WHAT: lists every living Markdown document (docs/**, minus dated records; the root AGENTS.md,
 * CLAUDE.md, CONTRIBUTING.md; every nested CLAUDE.md) with its age in days, oldest first. A
 * document's date is its own header date ("Last verified: YYYY-MM-DD", "Last updated: YYYY-MM-DD",
 * "verified against code: YYYY-MM-DD") when it has one, else its last git commit date.
 *
 * WHY: Foundry Standard Article 46 (doc-age). The 2026-10 audit found security documents still
 * reading "last verified 2026-05-29" five months later; nobody noticed because nothing measured it.
 * Excluded as dated records, not expected to be fresh: docs/research/, docs/incidents/,
 * docs/handoffs/, docs/governance/decisions/.
 *
 * HOW WIRED: .github/workflows/rulebook.yml runs it report-only (continue-on-error). First the
 * backlog shrinks, then the switch flips and the step becomes blocking.
 *
 * Usage:
 *   node scripts/check-doc-age.cjs                  # table; exit 1 only when a file exceeds --max-days
 *   node scripts/check-doc-age.cjs --max-days 180   # default 180
 *   node scripts/check-doc-age.cjs --json
 *
 * Dependency-free plain Node. Needs full git history to date files (CI: fetch-depth: 0); a shallow
 * clone dates headerless files to the checkout commit, which only makes them look fresher.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXCLUDED = ['docs/research/', 'docs/incidents/', 'docs/handoffs/', 'docs/governance/decisions/'];
const ROOT_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md'];
const HEADER_RE = /(?:last\s+verified[^:\n]{0,60}|last\s+updated|verified\s+against\s+code)\s*:?[\s*]*(\d{4}-\d{2}-\d{2})/gi;
const DAY = 86400000;

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/** Tracked Markdown files this sweep covers (posix paths relative to root). `ls` is injectable. */
function listFiles(root, ls = (r) => git(r, ['ls-files', '-z']).split('\0').filter(Boolean)) {
  return ls(root)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => {
      if (EXCLUDED.some((p) => f.startsWith(p))) return false;
      if (f.startsWith('docs/')) return true;
      if (ROOT_FILES.includes(f)) return true;
      return path.posix.basename(f) === 'CLAUDE.md' && !f.includes('node_modules/');
    })
    .sort();
}

/** Newest "Last verified/updated" style date in the text, as a Date, or null. */
function headerDate(text) {
  let best = null;
  for (const m of text.matchAll(HEADER_RE)) {
    const d = new Date(m[1] + 'T00:00:00Z');
    if (!isNaN(d) && (!best || d > best)) best = d;
  }
  return best;
}

function gitDate(root, file) {
  const out = git(root, ['log', '-1', '--format=%cI', '--', file]).trim();
  return out ? new Date(out) : null;
}

/**
 * Compute rows, oldest first. `deps` lets tests inject files / readFile / commitDate / now.
 * Row: { file, ageDays, date (YYYY-MM-DD), source: 'header'|'git' }
 */
function sweep(root, deps = {}) {
  const readFile = deps.readFile || ((f) => fs.readFileSync(path.join(root, f), 'utf8'));
  const commitDate = deps.commitDate || ((f) => gitDate(root, f));
  const now = deps.now || new Date();
  const files = deps.files || listFiles(root);
  const rows = [];
  for (const file of files) {
    let text;
    try { text = readFile(file); } catch { continue; }
    let date = headerDate(text);
    let source = 'header';
    if (!date) { date = commitDate(file); source = 'git'; }
    if (!date) continue;
    rows.push({ file, date: date.toISOString().slice(0, 10), source, ageDays: Math.max(0, Math.floor((now - date) / DAY)) });
  }
  return rows.sort((a, b) => b.ageDays - a.ageDays || a.file.localeCompare(b.file));
}

function formatTable(rows, maxDays) {
  const w = Math.max(4, ...rows.map((r) => r.file.length));
  const lines = [`${'FILE'.padEnd(w)}  ${'AGE'.padStart(5)}  DATE        SOURCE  OVER`];
  for (const r of rows) {
    lines.push(`${r.file.padEnd(w)}  ${String(r.ageDays).padStart(5)}  ${r.date}  ${r.source.padEnd(6)}  ${r.ageDays > maxDays ? 'YES' : ''}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const i = argv.indexOf('--max-days');
  const maxDays = i >= 0 ? Number(argv[i + 1]) : 180;
  if (!Number.isFinite(maxDays) || maxDays < 0) { console.error('--max-days needs a non-negative number'); return 2; }
  const root = path.resolve(__dirname, '..');
  const rows = sweep(root);
  const over = rows.filter((r) => r.ageDays > maxDays);
  if (json) {
    console.log(JSON.stringify({ maxDays, files: rows.length, over: over.length, rows }, null, 2));
  } else {
    console.log(formatTable(rows, maxDays));
    console.log(`\n${rows.length} files scanned, oldest ${rows[0] ? rows[0].ageDays : 0} days, ${over.length} over ${maxDays} days`);
  }
  return over.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { listFiles, headerDate, sweep, formatTable, EXCLUDED };
