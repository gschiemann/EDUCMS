#!/usr/bin/env node
/*
 * EXTERNAL_HTML board EDITABILITY guard.
 *
 * THE GUARANTEE. Every board under `apps/web/public/templates/` renders in a
 * null-origin sandboxed iframe, so React cannot reach into it. The ONLY way an
 * operator can edit one is the shim baked into (or referenced by) the HTML: it
 * posts `educms-field-click {key,kind}` and the PropertiesPanel jumps to that
 * element's field editor. No shim ⇒ the board is a picture. That is the 2026-06-07
 * fire, in the operator's words: "none of the fucking templates are even editable,
 * you can't edit a single word."
 *
 * WHY THIS SCRIPT EXISTS. CLAUDE.md documents a shell sweep for exactly this, but
 * as measured on 2026-09-11 it was not a gate at all:
 *   - it hardcodes `find hs signage fitness` = 191 of 250 boards. `school/` (40)
 *     and `kiosk/` (19) are STRUCTURALLY INVISIBLE to it — a whole subdirectory
 *     can regress and the sweep prints nothing, because the sweep never looks.
 *   - NOTHING in CI ran it (zero hits for `educms-field-click` across .github/,
 *     tools/ and scripts/), so it only ever ran when a human remembered to.
 *   - the e2e spec covered 23 of 250 boards (9.2%), none from school/ or kiosk/.
 * So the hardcoded directory list IS the bug. This script DISCOVERS boards by
 * walking the tree — add a subdirectory and it is covered on the next run.
 *
 * WHAT IT CHECKS, per board:
 *   1. SHIM — a click-reporting shim is reachable, by any of the three
 *      conventions in the repo:
 *        a. baked `EDUCMS-SHIM-V<n>` (inject-shim-v2.cjs; click-to-edit landed
 *           in V5, so V2-V4 are apply-only and FAIL — that stale-shim survivor
 *           is the precise 2026-06-07 regression class),
 *        b. baked `EDUCMS-CLICK-V<n>` (inject-click-shim.cjs — the additive
 *           click shim for the menu boards whose hand-crafted V5 carries
 *           `applyMenu()` and must not be clobbered),
 *        c. an external `<script src=".../_edit-shim.js">` (the kiosk
 *           convention). The referenced file is RESOLVED ON DISK and must
 *           itself post `educms-field-click` — a dangling src is a fail, not
 *           a pass, which is the difference between this and a grep.
 *   2. HOT ZONES — the shim's walker arms `[data-field]`, `[data-mediafield]`,
 *      `[data-imgslot]`, `[data-img]`, `[data-slot]`, `[data-action]`,
 *      `[data-videoslot]`, `[data-posterslot]`. A board with a perfect shim and
 *      nothing marked up is still un-editable, so we require a floor of real
 *      hot zones. `data-field="theme.*"` is EXCLUDED: that is the hidden
 *      brand-token block, not operator-editable content (the e2e spec skips it
 *      for the same reason).
 *
 * RATCHET. Failures are tracked in `board-editability-baseline.json` exactly
 * like taurus-safety: a board already in the baseline may keep failing, a board
 * that is NOT in the baseline may not fail at all, and a board that starts
 * passing is REMOVED from the baseline by the same run that notices (so the
 * baseline can only ever tighten). As of 2026-09-11 the baseline is EMPTY —
 * all 250 boards pass — so this gate locks in a clean floor.
 *
 * Run:
 *   node apps/web/tools/check-board-editability.cjs           # check (CI mode)
 *   node apps/web/tools/check-board-editability.cjs report    # per-directory census
 *   node apps/web/tools/check-board-editability.cjs baseline  # rewrite baseline
 */

const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '..');                   // apps/web
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');             // repo root
const PUBLIC_ROOT = path.join(WEB_ROOT, 'public');
// The ONE root we walk. Subdirectories are discovered, never listed — that
// hardcoded list is the bug this guard exists to kill.
const BOARD_ROOT = path.join(PUBLIC_ROOT, 'templates');
const BASELINE_FILE = path.join(__dirname, 'board-editability-baseline.json');

// Click-to-edit landed in EDUCMS-SHIM-V5 (V2-V4 apply overrides only). A board
// left on an older marker greps as "has a shim" but cannot be clicked.
const MIN_CLICK_SHIM_VERSION = 5;

// Floor of operator-editable elements. Deliberately low: this guard proves a
// board is REACHABLE, not that it is richly annotated — per-widget field
// coverage is the Standard Audit Surface §19 job. Measured 2026-09-11 across
// all 250 boards the thinnest carries 13 (signage), so 3 is a floor no healthy
// board sits near and only a genuinely stripped board can trip it.
const MIN_HOT_ZONES = 3;

// Every attribute the shim's armEdit()/armMediaEdit() walkers arm. Keep in sync
// with the querySelectorAll lists in apps/web/scripts/inject-shim-v2.cjs.
const HOT_ZONE_ATTRS = [
  'data-field',
  'data-mediafield',
  'data-imgslot',
  'data-img',
  'data-slot',
  'data-action',
  'data-videoslot',
  'data-posterslot',
];

// `data-field="theme.*"` is the hidden brand-token block the shim reads for
// palette/font resolution — never operator-facing copy. Excluded from the count.
const THEME_FIELD_RE = /^theme\./;

const CLICK_PROTOCOL = 'educms-field-click';

/** Walk BOARD_ROOT for every .html board. Directories are discovered. */
function findBoards(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `_thumbs` holds generated preview images, never boards.
      if (entry.name === '_thumbs') continue;
      findBoards(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/** Count hot zones the shim would actually arm, minus the theme-token block. */
function countHotZones(html) {
  let n = 0;
  for (const attr of HOT_ZONE_ATTRS) {
    const re = new RegExp(`${attr}="([^"]*)"`, 'g');
    let m;
    while ((m = re.exec(html))) {
      if (attr === 'data-field' && THEME_FIELD_RE.test(m[1])) continue;
      n++;
    }
  }
  return n;
}

/**
 * Resolve an external `<script src>` the way the browser will: root-absolute
 * against apps/web/public, otherwise relative to the board. Returns the on-disk
 * path or null. A src we cannot resolve is a FAIL, not a silent pass — the
 * whole point of reading the file is that a grep for the src string cannot tell
 * a live shim from a 404.
 */
function resolveExternalShim(boardFile, src) {
  const clean = src.split('?')[0].split('#')[0];
  const full = clean.startsWith('/')
    ? path.join(PUBLIC_ROOT, clean.slice(1))
    : path.resolve(path.dirname(boardFile), clean);
  return fs.existsSync(full) ? full : null;
}

/**
 * Grade one board. Returns { rel, ok, reason, detail, shim, hotZones }.
 * `reason` is a stable code so the baseline records WHY, not just that.
 */
function gradeBoard(file) {
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const hotZones = countHotZones(html);

  let shim = null;      // human-readable provenance
  let shimOk = false;
  let reason = null;
  let detail = null;

  // (a) baked full shim — click-to-edit from V5 on.
  const vMatch = html.match(/EDUCMS-SHIM-V(\d+)/);
  // (b) baked additive click shim (menu boards).
  const cMatch = html.match(/EDUCMS-CLICK-V(\d+)/);
  // (c) external shim file (kiosk convention).
  const extMatch = html.match(/<script[^>]*\ssrc=["']([^"']*_edit-shim[^"']*)["']/i);

  if (extMatch) {
    const resolved = resolveExternalShim(file, extMatch[1]);
    if (!resolved) {
      reason = 'EXTERNAL_SHIM_MISSING';
      detail = `references ${extMatch[1]} but no such file on disk`;
    } else if (!fs.readFileSync(resolved, 'utf8').includes(CLICK_PROTOCOL)) {
      reason = 'EXTERNAL_SHIM_NO_CLICK';
      detail = `${path.relative(REPO_ROOT, resolved)} never posts ${CLICK_PROTOCOL}`;
    } else {
      const extV = fs.readFileSync(resolved, 'utf8').match(/EDUCMS-SHIM-V(\d+)/);
      shim = `external ${path.basename(resolved)}${extV ? ` (V${extV[1]})` : ''}`;
      shimOk = true;
    }
  } else if (cMatch) {
    // The additive click shim is click-only by design; it always carries the
    // protocol, so its presence + the protocol string is the whole contract.
    if (!html.includes(CLICK_PROTOCOL)) {
      reason = 'CLICK_SHIM_NO_PROTOCOL';
      detail = `carries EDUCMS-CLICK-V${cMatch[1]} but never posts ${CLICK_PROTOCOL}`;
    } else {
      shim = `EDUCMS-CLICK-V${cMatch[1]}`;
      shimOk = true;
    }
  } else if (vMatch) {
    const v = Number(vMatch[1]);
    if (v < MIN_CLICK_SHIM_VERSION) {
      // The 2026-06-07 trap verbatim: redesigning a board leaves the OLD shim
      // block baked in, so an apply-only V4 survivor ships un-clickable.
      reason = 'STALE_APPLY_ONLY_SHIM';
      detail = `EDUCMS-SHIM-V${v} predates click-to-edit (V${MIN_CLICK_SHIM_VERSION}+)`;
    } else if (!html.includes(CLICK_PROTOCOL)) {
      reason = 'SHIM_NO_CLICK_PROTOCOL';
      detail = `EDUCMS-SHIM-V${v} present but never posts ${CLICK_PROTOCOL}`;
    } else {
      shim = `EDUCMS-SHIM-V${v}`;
      shimOk = true;
    }
  } else if (html.includes(CLICK_PROTOCOL)) {
    // Hand-crafted shim with no injector marker. It posts the protocol, which
    // is the contract the panel actually consumes, so it passes — but name it
    // so a census makes the unmanaged boards visible.
    shim = 'hand-crafted (no injector marker)';
    shimOk = true;
  } else {
    reason = 'NO_SHIM';
    detail = `no ${CLICK_PROTOCOL} and no external _edit-shim reference`;
  }

  if (shimOk && hotZones < MIN_HOT_ZONES) {
    reason = 'NO_HOT_ZONES';
    detail = `${shim} loads but only ${hotZones} editable element(s) (need ${MIN_HOT_ZONES})`;
  }

  return { rel, ok: !reason, reason, detail, shim, hotZones };
}

function scanAll() {
  if (!fs.existsSync(BOARD_ROOT)) {
    console.error(`Board root not found: ${BOARD_ROOT}`);
    process.exit(2);
  }
  return findBoards(BOARD_ROOT).sort().map(gradeBoard);
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); }
  catch (e) { console.error('Failed to parse baseline:', e.message); process.exit(2); }
}

/** Directory bucket for the census — the first path segment under templates/. */
function dirOf(rel) {
  const tail = rel.split('apps/web/public/templates/')[1] || rel;
  const seg = tail.split('/');
  return seg.length > 1 ? seg[0] : '(root)';
}

function report(results) {
  const byDir = new Map();
  for (const r of results) {
    const d = dirOf(r.rel);
    if (!byDir.has(d)) byDir.set(d, { total: 0, fail: 0, shims: new Map(), minHz: Infinity });
    const b = byDir.get(d);
    b.total++;
    if (!r.ok) b.fail++;
    else {
      b.shims.set(r.shim, (b.shims.get(r.shim) || 0) + 1);
      b.minHz = Math.min(b.minHz, r.hotZones);
    }
  }
  console.log(`Board editability census — ${results.length} boards under apps/web/public/templates/\n`);
  for (const [d, b] of [...byDir].sort()) {
    const shims = [...b.shims].sort((a, z) => z[1] - a[1]).map(([s, n]) => `${s}×${n}`).join(', ');
    console.log(`  ${d.padEnd(10)} ${String(b.total).padStart(3)} boards · ${b.fail} failing · min hot zones ${b.minHz === Infinity ? '—' : b.minHz}`);
    console.log(`             ${shims}`);
  }
  const failing = results.filter((r) => !r.ok);
  if (failing.length) {
    console.log(`\n${failing.length} failing board(s):`);
    for (const r of failing) console.log(`  ${r.reason.padEnd(24)} ${r.rel} — ${r.detail}`);
  }
}

function main() {
  const mode = process.argv[2] || 'check';
  const results = scanAll();

  if (mode === 'report') { report(results); process.exit(0); }

  const failing = results.filter((r) => !r.ok);

  if (mode === 'baseline') {
    const next = {};
    for (const r of failing) next[r.rel] = r.reason;
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`Wrote baseline: ${failing.length} known-failing of ${results.length} boards.`);
    process.exit(0);
  }

  const baseline = readBaseline();
  // NEW breakage: a board that fails and is not in the baseline, OR one that
  // fails for a DIFFERENT reason than the one recorded (a board allowlisted for
  // thin hot zones must not be allowed to silently lose its shim entirely).
  const regressions = failing.filter((r) => baseline[r.rel] !== r.reason);
  // A baselined board that now passes — or vanished — must leave the baseline,
  // so the ratchet only ever tightens.
  const stale = Object.keys(baseline).filter(
    (rel) => !failing.some((r) => r.rel === rel && r.reason === baseline[rel]),
  );

  if (regressions.length) {
    console.error('Board editability regressions — these boards cannot be edited by click:\n');
    for (const r of regressions) {
      console.error(`  ${r.rel}`);
      console.error(`      ${r.reason}: ${r.detail}`);
    }
    console.error('');
    console.error('An EXTERNAL_HTML board lives in a null-origin sandboxed iframe: React cannot');
    console.error('reach into it, so if the shim is missing or stale the operator cannot edit a');
    console.error('single word on that board. Fix by re-running the injector for its subdirectory:');
    console.error('  node apps/web/scripts/inject-shim-v2.cjs <hs|signage|fitness|school>');
    console.error('  node apps/web/scripts/inject-click-shim.cjs signage   # menu boards only');
    console.error('  (kiosk boards load public/templates/kiosk/_edit-shim.js by <script src>)');
    console.error('');
    console.error('NO_HOT_ZONES means the shim loads but nothing is marked up — the board needs');
    console.error('data-field / data-imgslot / data-action attributes on its editable elements.');
    process.exit(1);
  }

  if (stale.length) {
    console.error('Board editability baseline is STALE — these entries no longer describe a');
    console.error('failure, so the baseline must tighten:\n');
    for (const rel of stale) console.error(`  ${rel} (was ${baseline[rel]})`);
    console.error('');
    console.error('Re-baseline: node apps/web/tools/check-board-editability.cjs baseline');
    process.exit(1);
  }

  const dirs = new Set(results.map((r) => dirOf(r.rel)));
  const known = failing.length;
  console.log(
    `OK — ${results.length} boards across ${dirs.size} discovered directories are click-editable` +
      (known ? ` (${known} known-failing, baselined).` : '.'),
  );
}

main();
