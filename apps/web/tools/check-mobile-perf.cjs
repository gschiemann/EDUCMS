#!/usr/bin/env node
/*
 * Mobile-performance regression guard.
 *
 * On 2026-06-16 the operator reported major lag tapping the mobile bottom nav
 * (esp. the "More" sheet — a pure local-state toggle, so its lag meant the
 * main thread / GPU was busy at tap time). Two root causes, both now fixed:
 *   1. Background-tab POLLING + a global refetch-on-focus storm hammered the
 *      main thread (each poll → O(n) recompute over ~150 screens) so taps
 *      queued behind it.
 *   2. GPU-expensive blur on the always-mounted mobile chrome (huge decorative
 *      blur blobs + stacked backdrop-blur on the toolbar/tab bar) made every
 *      repaint — including the More sheet sliding up — expensive on a phone.
 * Full write-up: docs/research/2026-06-16-mobile-perf-deepdive/.
 *
 * This guard LOCKS THAT IN so the next thing we add can't silently regress it.
 * It hard-fails (no baseline — the codebase is clean today) on:
 *   A. `refetchIntervalInBackground: true`  ANYWHERE under apps/web/src — never
 *      poll a tab/app the operator isn't looking at.
 *   B. `refetchOnWindowFocus: true` as the GLOBAL QueryClient default
 *      (providers.tsx) — per-hook opt-in is fine, a global default is a storm.
 *   C. A mobile-active `backdrop-blur*` (not `md:`/`lg:`/…-gated, not
 *      `backdrop-blur-none`) OR an un-gated big `blur-[…]` on the persistent
 *      global chrome (DashboardLayout / MobileTabBar / TopToolbar / Sidebar).
 *      Gate it behind a breakpoint (`md:backdrop-blur-xl`) or hide the element
 *      on phones (`hidden md:block`, so the line carries `md:`).
 *
 * ESCAPE HATCH: append `perf-allow` in a comment on the offending line if an
 * exception is genuinely justified (must be reviewed in the PR).
 *
 * Run:
 *   node apps/web/tools/check-mobile-perf.cjs     # check (CI mode)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..'); // repo root
const WEB_SRC = path.join('apps', 'web', 'src');

// Persistent global chrome — mounted on EVERY authenticated page, so any paint
// cost here is paid on every interaction (the bottom-nav-lag surface).
const CHROME_FILES = [
  path.join(WEB_SRC, 'components', 'layout', 'DashboardLayout.tsx'),
  path.join(WEB_SRC, 'components', 'layout', 'MobileTabBar.tsx'),
  path.join(WEB_SRC, 'components', 'layout', 'TopToolbar.tsx'),
  path.join(WEB_SRC, 'components', 'layout', 'Sidebar.tsx'),
];
const PROVIDERS_FILE = path.join(WEB_SRC, 'components', 'providers.tsx');

const FILE_RE = /\.(tsx?|jsx?)$/;
const ALLOW = 'perf-allow';

/**
 * Strip JS/JSX comments while PRESERVING line breaks (so reported line numbers
 * stay accurate and a multi-line `{/* … *​/}` block that merely *mentions*
 * `backdrop-blur` in prose can't trip the matchers). Comment bytes become
 * spaces; newlines are kept.
 */
function stripCommentsKeepLines(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function readLines(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const stripped = stripCommentsKeepLines(raw);
  return { rawLines: raw.split('\n'), strippedLines: stripped.split('\n') };
}

function walk(absDir, out) {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (entry.isFile() && FILE_RE.test(entry.name)) {
      out.push(abs);
    }
  }
}

const violations = [];
function flag(file, line, msg) {
  violations.push({ file: path.relative(REPO_ROOT, file), line, msg });
}

// ── Check A — no background-tab polling anywhere ────────────────────────────
const BG_POLL_RE = /refetchIntervalInBackground\s*:\s*true/;
{
  const files = [];
  walk(path.join(REPO_ROOT, WEB_SRC), files);
  for (const f of files) {
    const { rawLines, strippedLines } = readLines(f);
    strippedLines.forEach((ln, i) => {
      if (BG_POLL_RE.test(ln) && !rawLines[i].includes(ALLOW)) {
        flag(f, i + 1, 'refetchIntervalInBackground: true — never poll a backgrounded tab (drains the main thread; taps queue). Use false; refresh on return via refetchOnWindowFocus.');
      }
    });
  }
}

// ── Check B — global focus-refetch default must stay off ────────────────────
{
  const abs = path.join(REPO_ROOT, PROVIDERS_FILE);
  if (fs.existsSync(abs)) {
    const { rawLines, strippedLines } = readLines(abs);
    strippedLines.forEach((ln, i) => {
      if (/refetchOnWindowFocus\s*:\s*true/.test(ln) && !rawLines[i].includes(ALLOW)) {
        flag(abs, i + 1, 'refetchOnWindowFocus: true as the GLOBAL QueryClient default fires a refetch storm on every app-switch. Keep the global default false; opt in per-hook where freshness-on-return matters.');
      }
    });
  }
}

// ── Check C — no mobile-active blur on the persistent global chrome ─────────
// Match an optional Tailwind breakpoint prefix + the backdrop-blur token.
const BACKDROP_RE = /(?:\b(sm|md|lg|xl|2xl):)?backdrop-blur(-[a-z0-9]+)?\b/g;
// Big arbitrary blur radius, e.g. blur-[100px]. (Small blur-sm/md utilities on
// chrome are cheap and not matched; this targets the heavy decorative blobs.)
const BIG_BLUR_RE = /\bblur-\[/;
for (const rel of CHROME_FILES) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const { rawLines, strippedLines } = readLines(abs);
  strippedLines.forEach((ln, i) => {
    if (rawLines[i].includes(ALLOW)) return;
    // backdrop-blur: flag any UN-prefixed token that isn't `-none`.
    let m;
    BACKDROP_RE.lastIndex = 0;
    while ((m = BACKDROP_RE.exec(ln))) {
      const breakpoint = m[1];
      const suffix = m[2]; // includes leading '-', e.g. '-none', '-xl'
      if (!breakpoint && suffix !== '-none') {
        flag(abs, i + 1, `mobile-active "${m[0]}" on persistent chrome — backdrop-filter is an expensive per-repaint mobile composite. Gate it: "md:${m[0]}" (desktop only).`);
      }
    }
    // big blur-[…]: must be desktop-gated (line carries a breakpoint, e.g. the
    // element is `hidden md:block`, or the utility is `md:blur-[…]`).
    if (BIG_BLUR_RE.test(ln) && !/\b(sm|md|lg|xl|2xl):/.test(ln)) {
      flag(abs, i + 1, 'un-gated blur-[…] on persistent chrome — a large blur radius is a heavy phone-GPU composite. Hide it on mobile ("hidden md:block") or gate the utility ("md:blur-[…]").');
    }
  });
}

if (violations.length) {
  console.error('Mobile-performance regressions — see CLAUDE.md "Mobile performance standard":');
  for (const v of violations) console.error(`  ${v.file}:${v.line}\n    ${v.msg}`);
  console.error('');
  console.error(`Fix the pattern, or append "${ALLOW}" in a comment on the line if genuinely justified (reviewed in PR).`);
  process.exit(1);
}
console.log(`OK — mobile-perf guard clean (${CHROME_FILES.length} chrome files + bg-poll + focus-default).`);
