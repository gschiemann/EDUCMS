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
  // Lane-6 P0: sports surfaces also render on Taurus.
  path.join('apps', 'web', 'src', 'app', 'board'),
  path.join('apps', 'web', 'src', 'app', 'ribbon'),
  path.join('apps', 'web', 'src', 'app', 'scorebug'),
];
const BASELINE_FILE = path.join(__dirname, 'taurus-safety-baseline.json');

// 2026-06-09 full-audit gate-gap fix: the EXTERNAL_HTML signage boards under
// public/templates + public/holiday-templates render on the SAME player the
// React widgets do — including NovaStar Taurus LED walls — but were NEVER in
// the scanner's scope (SCAN_DIRS is all apps/web/src; FILE_RE excludes .html).
// The `inset` shorthand collapses a positioned box to 0×0 on Chromium 83, so
// a board that uses it is invisible on Taurus. We swept all boards to longhand
// (309 declarations across 57 files), so the board baseline is ZERO — this
// pass locks that in: any `inset:`/`inset-*` that re-enters a board fails CI.
// Scoped to the inset patterns ONLY: boards legitimately use gap/backdrop/
// aspect-ratio/color-mix for standard LCD signage (CLAUDE.md rule #10 SCOPE),
// and inset is the one with a zero-regression spec-identical longhand fix.
const HTML_SCAN_DIRS = [
  path.join('apps', 'web', 'public', 'templates'),
  path.join('apps', 'web', 'public', 'holiday-templates'),
];
const HTML_FILE_RE = /\.html$/;

// Patterns that compile to Chromium-83-incompatible CSS at runtime.
// Heuristic; counts may include grid `gap` (acceptable on Chromium 83) — the
// ratchet still works because grid gap is also non-regressing.
const PATTERNS = {
  // Any `gap: …` declaration. Includes flex gap (broken on 83) and grid gap
  // (works on 83). The baseline allows current counts; only NEW additions fail.
  gap: /\bgap:\s*[^,;{}\n]+/g,
  // 2026-05-26 audit P0-5: Tailwind `gap-N` / `gap-x-N` / `gap-y-N` class
  // utilities compile to flex `gap: …` and have the same Chromium 83
  // incompatibility. The CSS-property pattern above doesn't catch class
  // usage in JSX — this one does. EmergencyOverlay had 3 of these before
  // we shipped P0-5 and they slipped past every previous audit.
  gapTw: /\bgap-(?:x-|y-)?(?:px|\d|\[)/g,
  // Container query units inside any expression — almost always inside
  // `clamp(...)` which Chromium 83 evaluates as invalid.
  cqUnits: /\b\d+(?:\.\d+)?cq[hwimnb]\b/g,
  // 2026-05-26 audit P0-5: Tailwind `backdrop-blur-*` / inline
  // `backdrop-filter: blur(…)`. Chromium 76+ supports it, but flaky on
  // Android System WebView < 88 and renders as transparent on Taurus.
  // Critical on overlay surfaces where the blur is the visible
  // "I am a separate panel from the playlist behind me" signal.
  backdropBlurTw: /\bbackdrop-blur(?:-[a-z]+)?\b/g,
  backdropFilter: /\bbackdrop-filter:\s*blur/g,
  // Lane-6 P0: `text-wrap: balance` is Chromium 114+. Silently ignored on
  // Taurus (Chromium 83) → headlines wrap badly on a 4K board.
  textWrapBalance: /\btext-wrap:\s*balance\b/g,
  // Lane-6 re-audit: `color-mix(` is Chromium 111+. Falls back to invalid
  // value on Chromium 83 — the entire declaration is dropped.
  colorMix: /\bcolor-mix\s*\(/g,
  // Lane-6 re-audit: `:has(` is Chromium 105+. Silently no-ops on Chromium
  // 83, leaving rules with `:has()`-conditional layout broken.
  hasSelector: /:has\(/g,
  // Lane-6 re-audit: `aspect-ratio:` is Chromium 88+. Below that the box
  // collapses; widgets that rely on it for visual proportion go to 0×0.
  aspectRatio: /\baspect-ratio:\s*[^,;{}\n]+/g,
  // Lane-6 re-audit: `oklch(` color function is Chromium 111+. Invalid on
  // older engines → custom prop resets to initial value, semantic colors
  // collapse. (globals.css has an @supports fallback; this catches NEW
  // oklch usage that lacks one.)
  oklch: /\boklch\s*\(/g,
  // 2026-05-28 audit P0-8: the `inset` shorthand is Chromium 87+. On
  // Chromium 83 the whole declaration is dropped → a `position: absolute`
  // box with no top/right/bottom/left collapses to 0×0 top-left and the
  // widget (measured by useScaleToFit) renders at scale(0) — invisible.
  // CLAUDE.md rule #10. This CSS-property pattern catches `inset: …` in
  // <style> blocks and inline objects.
  insetCss: /\binset:\s*[^,;{}\n]+/g,
  // Companion to insetCss: the Tailwind utilities `inset-0` / `inset-x-*`
  // / `inset-y-*` (compile to `inset` / `inset-inline` / `inset-block`,
  // all Chromium-83-incompatible) AND arbitrary `inset-[…]`. The
  // 2026-05-13 sweep caught the CSS property, the 2026-05-19 sweep caught
  // `inset-0`/`inset-N`, but NEITHER gate had a pattern — so the arbitrary
  // `inset-[4%]` in themes/high-school-athletics.tsx shipped a live Taurus
  // regression on a sports widget. Use longhand `top-* right-* bottom-*
  // left-*` instead. (Does NOT match longhand top-/right-/bottom-/left-.)
  insetTw: /\binset-(?:x-|y-)?(?:px|\d|\[)/g,
};

// Restricted pattern set for the HTML signage boards — inset only (see
// HTML_SCAN_DIRS note above for why the others are intentionally excluded).
const HTML_PATTERNS = {
  insetCss: PATTERNS.insetCss,
  insetTw: PATTERNS.insetTw,
};

const FILE_RE = /\.(tsx?|jsx?|css|scss)$/;

// Strip `//` line comments and `/* … */` block comments before pattern
// matching. A comment NEVER ships as rendered CSS, so removing it can only
// drop false positives — never hide a real Chromium-83 violation. This
// closes a recurring foot-gun: prose like "fixes the reliability gap: …"
// or "the inset: shorthand is broken" inside a code comment was being
// miscounted as a real `gap:` / `inset:` CSS declaration and red-ing CI
// (2026-05-29: a render-proof heartbeat comment tripped player/page.tsx
// gap 4→5). Stripping from `//` to EOL is safe even across URLs: anything
// after `//` is non-shipping comment text, so its removal can't mask code.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ');      // line comments
}

// HTML uses `<!-- … -->` comments, not `//` / `/* … */`. The JS stripComments
// would nuke from a `//` (e.g. inside a `https://` URL) to end-of-line and
// could hide a real `inset:` after it — a false NEGATIVE. So HTML files get an
// HTML-comment-only stripper.
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, ' ');
}

function scanFile(absPath, patterns = PATTERNS, stripper = stripComments) {
  const text = stripper(fs.readFileSync(absPath, 'utf8'));
  const out = {};
  let any = false;
  for (const [name, re] of Object.entries(patterns)) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m && m.length) { out[name] = m.length; any = true; }
  }
  return any ? out : null;
}

function walk(absDir, repoRel, out, opts = {}) {
  const { patterns = PATTERNS, fileRe = FILE_RE, stripper = stripComments } = opts;
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.posix.join(repoRel, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(abs, rel, out, opts);
    } else if (entry.isFile() && fileRe.test(entry.name)) {
      const counts = scanFile(abs, patterns, stripper);
      if (counts) out[rel] = counts;
    }
  }
}

function scanAll() {
  const out = {};
  for (const d of SCAN_DIRS) {
    walk(path.join(REPO_ROOT, d), d.replace(/\\/g, '/'), out);
  }
  // EXTERNAL_HTML signage boards — inset-only pass (see HTML_SCAN_DIRS note).
  for (const d of HTML_SCAN_DIRS) {
    walk(path.join(REPO_ROOT, d), d.replace(/\\/g, '/'), out, {
      patterns: HTML_PATTERNS,
      fileRe: HTML_FILE_RE,
      stripper: stripHtmlComments,
    });
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
