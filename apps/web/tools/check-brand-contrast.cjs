#!/usr/bin/env node
/*
 * Brand-contrast gate (2026-07-22 — the VisionCore cream incident).
 *
 * A beta tenant's scraped brand primary was their site BACKGROUND
 * (#fcf9e2 cream). The Tailwind scale takeover served it as indigo-500/600 —
 * the workhorse shade used as text-on-white and as button bg under white
 * text — making half the Settings chrome invisible. The fix contract lives
 * in lib/branding.ts (ensureReadableOnWhite + the -strong/-mid derived vars)
 * and globals.css (shade-role mapping). This gate transpiles the REAL
 * lib/branding.ts and asserts the math on the LITERAL incident palette, so
 * the contract can't silently regress.
 *
 * Run: node apps/web/tools/check-brand-contrast.cjs   (exit 1 on violation)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'brand-contrast.ts'); // pure math module — zero imports by contract
const BRANDING = path.join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'branding.ts');

let ts;
try {
  ts = require('typescript');
} catch {
  console.error('FATAL: `typescript` not installed — run `pnpm install --ignore-scripts` first.');
  process.exit(2);
}

// Transpile lib/branding.ts in-memory (same pattern as check-capability-registry).
const source = fs.readFileSync(SRC, 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const Module = require('module');
const m = new Module(SRC);
m.paths = Module._nodeModulePaths(path.dirname(SRC));
try {
  m._compile(js, SRC);
} catch (e) {
  console.error(`FATAL: lib/brand-contrast.ts failed to evaluate: ${e.message}`);
  process.exit(2);
}
const { ensureReadableOnWhite, contrastRatio } = m.exports;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`ok: ${name}`);
  else { failures += 1; console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); }
}
function hueOf(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let deg = 0;
  if (max === r) deg = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) deg = (b - r) / d + 2;
  else deg = (r - g) / d + 4;
  return deg * 60;
}

check('pure module exports present', typeof ensureReadableOnWhite === 'function' && typeof contrastRatio === 'function');

// ── The literal incident palette (VisionCore Systems, tenant_branding row) ──
const CREAM_PRIMARY = '#fcf9e2';
const HEALTHY_ACCENT = '#116dff';

const strong = ensureReadableOnWhite(CREAM_PRIMARY, 4.5);
const strongHover = ensureReadableOnWhite(CREAM_PRIMARY, 5.2);
const stronger = ensureReadableOnWhite(CREAM_PRIMARY, 7);
const mid = ensureReadableOnWhite(CREAM_PRIMARY, 2.5);
console.log(`cream ${CREAM_PRIMARY} → mid ${mid}, strong ${strong}, strong-hover ${strongHover}, stronger ${stronger}`);
check(`strong ≥4.5:1 vs white (got ${strong} @ ${contrastRatio(strong, '#ffffff').toFixed(2)})`,
  contrastRatio(strong, '#ffffff') >= 4.5);
check('strong-hover ≥5.2:1', contrastRatio(strongHover, '#ffffff') >= 5.2);
check('stronger ≥7:1', contrastRatio(stronger, '#ffffff') >= 7);
check('mid ≥2.5:1', contrastRatio(mid, '#ffffff') >= 2.5);
check('strong keeps the brand HUE (deep gold, not black)',
  Math.abs(hueOf(strong) - hueOf('#e9d42f')) <= 25 && strong !== '#000000');
check('healthy accent passes through untouched', ensureReadableOnWhite(HEALTHY_ACCENT, 4.5) === HEALTHY_ACCENT);
check('healthy dark primary is unchanged by derivation', ensureReadableOnWhite('#4f46e5', 4.5) === '#4f46e5');

// branding.ts must WIRE the derivation into the CSS vars (source contract —
// the file has app imports, so we pin it by source rather than executing it).
const brandingSrc = fs.readFileSync(BRANDING, 'utf8');
check("branding.ts imports the pure module", /from '\.\/brand-contrast'/.test(brandingSrc));
check("cssVarsFromPalette derives --brand-primary-strong at 4.5",
  /--brand-primary-strong', hex\(pAny\.primaryStrong\) \?\? ensureReadableOnWhite\(pri, 4\.5\)/.test(brandingSrc));
check("cssVarsFromPalette derives --brand-accent-strong at 4.5",
  /--brand-accent-strong', hex\(pAny\.accentStrong\) \?\? ensureReadableOnWhite\(acc, 4\.5\)/.test(brandingSrc));

// The globals.css mapping must consume the derived vars for workhorse shades.
const css = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'globals.css'), 'utf8');
check('indigo-600 consumes --brand-primary-strong', /--color-indigo-600:\s*var\(--brand-primary-strong,/.test(css));
check('indigo-500 consumes --brand-primary-strong', /--color-indigo-500:\s*var\(--brand-primary-strong,/.test(css));
check('violet-600 consumes --brand-accent-strong', /--color-violet-600:\s*var\(--brand-accent-strong,/.test(css));
check('.text-brand is readable-on-white', /\.text-brand\s*\{\s*color:\s*var\(--brand-primary-strong,/.test(css));
check('raw primary no longer feeds any 500+ Tailwind shade directly',
  !/--color-(indigo|sky)-(5|6|7|8|9)\d0:\s*var\(--brand-primary,/.test(css) &&
  !/--color-violet-(5|6|7|8|9)\d0:\s*var\(--brand-accent,/.test(css));

if (failures > 0) {
  console.error(`\nbrand-contrast gate: ${failures} violation(s).`);
  process.exit(1);
}
console.log('brand-contrast gate: the cream incident can never ship again.');
