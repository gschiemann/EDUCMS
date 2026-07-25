#!/usr/bin/env node
// check-poster-freshness.cjs — GUARD: a template can never ship with a stale
// gallery preview.
//
// The templates gallery renders a pre-rendered static poster PNG per board
// (apps/web/public/templates/_thumbs/<rel>.png), NOT a live iframe — for perf
// (114 live 4K iframes pegged the main thread). The failure mode: someone edits
// a board's HTML but forgets to regenerate its poster, so the gallery keeps
// showing the OLD board forever. That burned a full session on 2026-07-24
// (redesigned + photo-baked fashion boards, gallery still showed the June
// posters). Operator: "dont ever let the previews not get updated when we
// update templates."
//
// This guard enforces the invariant: if a board HTML under public/templates/
// changed in this diff, its matching _thumbs poster PNG MUST have changed too.
// Otherwise CI fails and tells you to regenerate.
//
// Regenerate posters (start a static server for apps/web/public first):
//   node apps/web/scripts/gen-template-posters.cjs http://localhost:3000
// (or a scoped scripts/regen-*.cjs), then BUMP POSTER_VERSION in
// ScaledTemplateThumbnail.tsx so browsers/CDN refetch the new PNG.
//
// Usage:  node apps/web/tools/check-poster-freshness.cjs [baseRef]
//   baseRef defaults to $POSTER_CHECK_BASE or origin/master. Diff is
//   baseRef...HEAD (merge-base three-dot, works for both PRs and pushes).
const { execSync } = require('child_process');

const BASE = process.env.POSTER_CHECK_BASE || process.argv[2] || 'origin/master';
const PREFIX = 'apps/web/public/templates/';

function changedFiles() {
  const tries = [
    'git diff --name-only ' + BASE + '...HEAD',
    'git diff --name-only ' + BASE + ' HEAD',
    'git diff --name-only HEAD~1 HEAD',
  ];
  for (const cmd of tries) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return out ? out.split('\n').filter(Boolean) : [];
    } catch (_) { /* try next */ }
  }
  return null; // couldn't diff
}

// A board = a top-level EXTERNAL_HTML template file. Skip any path segment
// starting with "_" (_thumbs, _edit-shim.js, partials) — same rule the poster
// generator uses.
function isBoard(f) {
  if (!f.startsWith(PREFIX) || !f.endsWith('.html')) return false;
  const rel = f.slice(PREFIX.length);
  return !rel.split('/').some((seg) => seg.startsWith('_'));
}
// A board can ship BOTH native compositions from one HTML file, in which case
// it has two posters: `<name>.png` (landscape) and `<name>-portrait.png`. A
// portrait-only change legitimately leaves the landscape poster byte-identical,
// so accept EITHER poster being regenerated.
function postersFor(board) {
  const base = PREFIX + '_thumbs/' + board.slice(PREFIX.length).replace(/\.html$/, '');
  return [base + '.png', base + '-portrait.png'];
}

const changed = changedFiles();
if (changed === null) {
  console.log('poster-freshness: could not compute git diff (shallow clone?) — skipping.');
  process.exit(0);
}
const changedSet = new Set(changed);
const boards = changed.filter(isBoard);
const violations = boards.filter((b) => !postersFor(b).some((png) => changedSet.has(png)));

if (violations.length) {
  console.error('\n[X] Stale gallery posters — ' + violations.length + ' board(s) changed but their poster PNG did NOT:\n');
  for (const b of violations) console.error('  ' + b + '\n     needs: ' + postersFor(b).join('  or  '));
  console.error('\nRegenerate the poster(s), then BUMP POSTER_VERSION in');
  console.error('apps/web/src/components/templates/ScaledTemplateThumbnail.tsx:');
  console.error('  node apps/web/scripts/gen-template-posters.cjs http://localhost:3000');
  console.error('(start a static server for apps/web/public first). The gallery shows a');
  console.error('pre-rendered PNG per board, so an un-regenerated poster ships the OLD look.\n');
  process.exit(1);
}
console.log('[OK] poster-freshness — ' + boards.length + ' board(s) changed, every poster updated.');
