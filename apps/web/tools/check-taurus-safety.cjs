#!/usr/bin/env node
/*
 * Taurus-safety regression guard.
 *
 * NovaStar Taurus LED controllers run Chromium 83. Two CSS features that
 * are pervasive in modern web code are broken there:
 *   1. `gap` on flex containers — Chromium 84+ (only grid `gap` works on 83).
 *   2. Container queries (`cqh`/`cqw`/`cqi`/`cqmin`/`cqb`) — Chromium 105+.
 *      When used inside `clamp(min, Ncqh, max)`, the whole `clamp()` becomes
 *      invalid on Chromium 83 and the property is unset → text collapses.
 *
 * Player-shipped widgets MUST NOT introduce new instances of either.
 * Existing instances are tracked in `taurus-safety-baseline.json`; this
 * script fails CI if any file's count exceeds its baseline OR if a file not
 * in the baseline introduces any violation. The baseline only ratchets
 * DOWN — fixes are rewarded, regressions are blocked.
 *
 * Run:
 *   node apps/web/tools/check-taurus-safety.cjs            # check (CI mode)
 *   node apps/web/tools/check-taurus-safety.cjs baseline   # rewrite baseline
 */

const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '..');                // apps/web
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');          // repo root
const SCAN_DIRS = [
  path.join('apps', 'web', 'src', 'components', 'widgets'),
  path.join('apps', 'web', 'src', 'app', 'player'),
  path.join('apps', 'web', 'src', 'components', 'player'),
];
const BASELINE_FILE = path.join(__dirname, 'taurus-safety-baseline.json');

// Patterns that compile to Chromium-83-incompatible CSS at runtime.
// Heuristic; counts may include grid `gap` (acceptable on Chromium 83) — the
// ratchet still works because grid gap is also non-regressing.
const PATTERNS = {
  // Any `gap: …` declaration. Includes flex gap (broken on 83) and grid gap
  // (works on 83). The baseline allows current counts; only NEW additions fail.
  gap: /\bgap:\s*[^,;{}\n]+/g,
  // Container query units inside any expression — almost always inside
  // `clamp(...)` which Chromium 83 evaluates as invalid.
  cqUnits: /\b\d+(?:\.\d+)?cq[hwimnb]\b/g,
};

const FILE_RE = /\.(tsx?|jsx?|css|scss)$/;

function scanFile(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  const out = {};
  let any = false;
  for (const [name, re] of Object.entries(PATTERNS)) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m && m.length) { out[name] = m.length; any = true; }
  }
  return any ? out : null;
}

function walk(absDir, repoRel, out) {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.posix.join(repoRel, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(abs, rel, out);
    } else if (entry.isFile() && FILE_RE.test(entry.name)) {
      const counts = scanFile(abs);
      if (counts) out[rel] = counts;
    }
  }
}

function scanAll() {
  const out = {};
  for (const d of SCAN_DIRS) {
    walk(path.join(REPO_ROOT, d), d.replace(/\\/g, '/'), out);
  }
  // Stable ordering for deterministic baseline writes.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); }
  catch (e) { console.error('Failed to parse baseline:', e.message); process.exit(2); }
}

function main() {
  const mode = process.argv[2] || 'check';
  const current = scanAll();

  if (mode === 'baseline') {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n');
    const files = Object.keys(current).length;
    const totalGap = Object.values(current).reduce((s, e) => s + (e.gap || 0), 0);
    const totalCq = Object.values(current).reduce((s, e) => s + (e.cqUnits || 0), 0);
    console.log(`Wrote baseline: ${files} files · ${totalGap} gap · ${totalCq} cq units`);
    process.exit(0);
  }

  const baseline = readBaseline();
  const violations = [];
  for (const [file, counts] of Object.entries(current)) {
    const base = baseline[file] || {};
    for (const [pat, n] of Object.entries(counts)) {
      const allowed = base[pat] || 0;
      if (n > allowed) violations.push({ file, pat, was: allowed, now: n });
    }
  }

  if (violations.length) {
    console.error('Taurus-safety regressions — Chromium-83-forbidden patterns added:');
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.pat} ${v.was} → ${v.now}`);
    }
    console.error('');
    console.error('Two ways to clear this:');
    console.error('  1. Rewrite the new code to be Taurus-safe (see CLAUDE.md rule #10');
    console.error('     and the gap/cq-unit guidance), then re-run this check.');
    console.error('  2. If the addition is intentional AND non-player-rendered code,');
    console.error('     rebaseline: `node apps/web/tools/check-taurus-safety.cjs baseline`');
    console.error('     (must be reviewed in the PR — baselines should only ratchet DOWN).');
    process.exit(1);
  }

  const files = Object.keys(current).length;
  const totalGap = Object.values(current).reduce((s, e) => s + (e.gap || 0), 0);
  const totalCq = Object.values(current).reduce((s, e) => s + (e.cqUnits || 0), 0);
  console.log(`OK — ${files} player/widget files scanned · gap=${totalGap} cq=${totalCq} (within baseline).`);
}

main();
