#!/usr/bin/env node
/**
 * check-font-ceilings — a widget font-size must be allowed to GROW on a wall.
 *
 * ── THE FAULT (2026-09-11) ────────────────────────────────────────────
 * `font-size: clamp(12px, 2.2cqh, 20px)` reads as responsive and is not. On a
 * 2160px-tall zone the middle term computes to 47px and the 20px ceiling
 * discards it, so a 4K signage board renders 20px type. The operator hit this
 * on a gym class-schedule board and put it plainly: *"add a class and this is
 * how it lays out on the template? this is basic ass shit that we should have
 * correct already."*
 *
 * Rendering all 702 variants at 3840x2160 in a real browser found 231 widgets
 * with unreadable text, and this pattern was the single biggest cause — 196 of
 * them rendered text under 12px, some at 3.5px.
 *
 * ── WHY A STATIC CHECK WHEN A BROWSER SWEEP EXISTS ────────────────────
 * `apps/web/tools/widget-legibility/measure.mjs` is the truthful instrument: it
 * drives a real browser and measures what is painted. It also needs a running
 * Next server and several minutes, and this repo's runners were halved to
 * 2 vCPU / 7 GB when it went private (that is what OOM-killed the e2e gate).
 * So the SWEEP stays the deep, local/periodic check, and THIS runs on every
 * push: it cannot see a layout bug, but it catches the one authoring habit that
 * produced most of them, in under a second.
 *
 * A ceiling is only flagged when the declaration ALSO uses a container-query
 * unit — that is the signature of "meant to scale, capped anyway". A plain
 * `clamp(12px, 4vw, 20px)` is a different decision and is left alone.
 *
 * Usage:  node apps/web/tools/check-font-ceilings.cjs [baseline]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const SCAN = [
  'apps/web/src/components/widgets',
  'apps/web/src/components/player',
  'apps/web/src/app/player',
];
const BASELINE_PATH = path.join(__dirname, 'font-ceiling-baseline.json');

/**
 * The smallest ceiling a widget font may declare. 32px is deliberately lenient:
 * it is far below what a 4K board wants (~47px for body) and well above the
 * phone-sized caps that caused the fault, so it flags the habit without
 * dictating type scale. A genuinely small chip — a superscript, a unit marker —
 * should scale with its parent in `em` rather than carry its own tiny ceiling.
 */
const MIN_CEILING = 32;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/__tests__|node_modules/.test(e.name)) walk(p, out); }
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = SCAN.flatMap((d) => {
  const abs = path.join(ROOT, d);
  return fs.existsSync(abs) ? walk(abs) : [];
});

// font-size: clamp(<min>, <mid>, <max>) — capture all three terms.
const RE = /font-size:\s*clamp\(([^,()]+),([^,]*(?:\([^)]*\))?[^,]*),([^)]+)\)/g;
const found = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  let m;
  while ((m = RE.exec(src)) !== null) {
    const mid = m[2].trim();
    const max = m[3].trim();
    // NOTE: no \b before cq — in `1.6cqh` the preceding character is a digit, so
    // a word boundary never matches and the whole check silently finds nothing.
    // That exact slip made the first version of this file report a clean 0
    // against 157 real occurrences.
    if (!/cq[hiwb]|cqmin|cqmax/.test(mid)) continue;      // not meant to scale with the container
    const px = /^(\d+(?:\.\d+)?)px$/.exec(max);
    if (!px) continue;                                           // a non-px ceiling scales on its own
    if (parseFloat(px[1]) >= MIN_CEILING) continue;
    const line = src.slice(0, m.index).split('\n').length;
    found.push({ file: rel, line, decl: m[0].replace(/\s+/g, ' ').slice(0, 110) });
  }
}

const key = (h) => `${h.file}|${h.decl}`;
const mode = process.argv[2];

if (mode === 'baseline') {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({
    _readme: [
      'Widget font-size clamps whose px CEILING is below the minimum, i.e. type',
      'that cannot grow on a 4K board. Read by check-font-ceilings.cjs.',
      '',
      'THIS LIST ONLY RATCHETS DOWN. A new capped declaration fails the build; a',
      'listed one that is fixed ALSO fails until its entry is deleted, so a fix',
      'cannot silently regress. Adding an entry is a decision to ship type that',
      'is pinned small on a wall, and needs a reason.',
    ],
    minCeiling: MIN_CEILING,
    known: found.map(key).sort(),
  }, null, 2)}\n`);
  console.log(`baselined ${found.length} capped font ceilings → ${path.relative(ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

let baseline = { known: [] };
if (fs.existsSync(BASELINE_PATH)) baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const known = new Set(baseline.known || []);
const nowKeys = found.map(key);
const nowSet = new Set(nowKeys);

const added = found.filter((h) => !known.has(key(h)));
const stale = [...known].filter((k) => !nowSet.has(k));

if (added.length) {
  console.error(`\ncheck-font-ceilings: ${added.length} NEW font-size ceiling(s) that pin type below ${MIN_CEILING}px\n`);
  console.error('  A container-query font-size with a small px ceiling does not scale — on a');
  console.error('  3840x2160 board the ceiling wins and the text is unreadable.\n');
  for (const h of added.slice(0, 25)) console.error(`  ${h.file}:${h.line}\n      ${h.decl}`);
  if (added.length > 25) console.error(`  … and ${added.length - 25} more`);
  console.error('\n  Raise the ceiling so the cq term can win on a wall, or express the size in');
  console.error('  `em` relative to a parent that already scales. Measure the result:');
  console.error('    node apps/web/tools/widget-legibility/measure.mjs   (see its header)\n');
  process.exit(1);
}

if (stale.length) {
  console.error(`\ncheck-font-ceilings: ${stale.length} baseline entr(ies) no longer present — delete them:\n`);
  for (const s of stale.slice(0, 25)) console.error(`  ${s}`);
  if (stale.length > 25) console.error(`  … and ${stale.length - 25} more`);
  console.error('\n  A spent exemption left in place is cover for the next regression.');
  console.error('  Re-baseline with: node apps/web/tools/check-font-ceilings.cjs baseline\n');
  process.exit(1);
}

console.log(`OK — ${files.length} widget/player files scanned · ${found.length} capped font ceiling(s), all baselined (min ${MIN_CEILING}px).`);
