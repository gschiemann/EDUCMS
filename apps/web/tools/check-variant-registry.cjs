#!/usr/bin/env node
/**
 * VARIANT REGISTRY INTEGRITY — a saved style must resolve to the widget the
 * operator actually picked.
 *
 * WHY THIS EXISTS (2026-09-11). `registerVariant` was a bare
 * `variants.set(v.id, v)` (variants.ts), so two registrations claiming one id
 * silently collapsed to whichever ran last. There was exactly one live
 * collision — `retail-loyalty-qr`, registered by the ALL_V2_WIDGETS loop
 * (variants-register.ts:1092, canonical widgetType RETAIL) and then clobbered
 * by the static registration at :1889 (widgetType RETAIL_LOYALTY_QR). Nothing
 * anywhere said so. The failure it produces is not a crash: an operator picks
 * widget A, the zone saves `config.variant: "A"`, and a wall screen shows
 * widget B forever. Signage has no user to notice — that IS the product.
 *
 * The sibling failure is a registered variant with no renderer: the picker
 * still shows the tile, the canvas falls through to the plain type dispatch,
 * and again the screen shows something the operator never chose.
 *
 * The registry cannot enforce either at runtime. It loads in the PLAYER, at
 * module scope, ~700 registrations in one chunk — a throw there aborts the
 * chunk and blanks every variant-rendered zone in the fleet, which is far
 * worse than the bug. So the runtime side only RECORDS
 * (`listVariantIdCollisions()`) and logs, and this script is the hard gate.
 *
 * HOW IT RUNS THE REGISTRY. It executes the real `variants-register.ts` in
 * node, via a `ts.transpileModule` require hook — the same TypeScript
 * compiler API `check-inset-serialization.cjs` already uses, no new dep. It
 * has to EXECUTE rather than parse: most ids are not string literals anywhere
 * (the v2 loop derives them with `w.type.toLowerCase().replace(/_/g, '-')`),
 * and the `retail-loyalty-qr` collision lives on exactly that side, so a
 * purely static sweep would miss the one bug this guard was written for.
 *
 * Real `react` / `lucide-react` etc. resolve from node_modules. Only
 * ESM-only specifiers (which node's CJS loader cannot parse) are stubbed —
 * the same short list jest maps in apps/web/jest.config.js. If a NEW ESM-only
 * dependency lands in the widget graph this script fails loudly with
 * "Unexpected token 'export'"; add the specifier to STUB_SPECIFIERS below and
 * to the jest moduleNameMapper. Do not widen it to silence a real error.
 *
 * THE BASELINE. `retail-loyalty-qr` is real and is NOT fixed here — renaming
 * an id orphans every saved `config.variant` that already holds it, which is
 * a migration, not a cleanup. It is listed in `variant-registry-baseline.json`
 * with its reason, exactly like `taurus-safety-baseline.json`. The ratchet is
 * mechanical in both directions: a collision missing from the baseline fails,
 * AND a baselined collision that no longer occurs fails until its entry is
 * deleted — an exemption nobody needs must not be allowed to sit there
 * granting cover to the next one.
 *
 * Run: node apps/web/tools/check-variant-registry.cjs
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const SRC = path.resolve(__dirname, '../src');

/**
 * Stand-in for a module we deliberately do not execute. Callable, newable and
 * infinitely property-accessible, so a widget module doing
 * `const Icon = Dynamic.Star` or `styled(x)` at module scope still loads —
 * nothing here is rendered, only the registration metadata is read.
 */
const STUB = new Proxy(function () { return null; }, {
  get(_t, p) { if (p === '__esModule') return true; return STUB; },
  apply() { return null; },
  construct() { return {}; },
});

// ESM-only packages + non-JS assets. Mirrors apps/web/jest.config.js.
const STUB_SPECIFIERS = new Set(['lucide-react/dynamic', 'next-intl']);
const STUB_EXTENSIONS = /\.(css|scss|sass|png|jpe?g|gif|svg|webp|avif|woff2?)$/;
const STUB_PREFIX = '\0variant-registry-stub:';

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (STUB_SPECIFIERS.has(request) || STUB_EXTENSIONS.test(request)) return STUB_PREFIX + request;
  // Next's `@/*` path alias — tsconfig maps it to apps/web/src/*.
  const req = request.startsWith('@/') ? path.join(SRC, request.slice(2)) : request;
  try {
    return originalResolve.call(this, req, parent, ...rest);
  } catch (err) {
    // TS source files carry no extension at the import site.
    const base = path.isAbsolute(req) ? req : path.resolve(path.dirname(parent.filename), req);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
    throw err;
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch { /* fall through to the real loader's error */ }
  if (typeof resolved === 'string' && resolved.startsWith(STUB_PREFIX)) return STUB;
  return originalLoad.call(this, request, parent, isMain);
};

function compileTs(mod, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  mod._compile(outputText, filename);
}
require.extensions['.ts'] = compileTs;
require.extensions['.tsx'] = compileTs;

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// `registerVariant` console.errors on every collision it records. That output
// is the point at runtime; here it would bury this script's own report, so
// swallow it and read the structured list instead.
const realError = console.error;
console.error = () => {};
require(path.join(SRC, 'components/widgets/variants-register.ts'));
const { listVariants, listVariantIdCollisions } = require(path.join(SRC, 'components/widgets/variants.ts'));
console.error = realError;

const variants = listVariants();
const collisions = listVariantIdCollisions();
const missingRenderer = variants.filter((v) => typeof v.render !== 'function');

// A baseline entry is matched on id + both widget types, so a THIRD
// registration for a baselined id, or the same id colliding between a
// different pair, is a new collision and still fails.
const BASELINE_FILE = path.join(__dirname, 'variant-registry-baseline.json');
const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).knownIdCollisions || []
  : [];
const signature = (c) => `${c.id}|${c.lostWidgetType}|${c.keptWidgetType}`;
const baselined = new Set(baseline.map(signature));
const seen = new Set(collisions.map(signature));

const newCollisions = collisions.filter((c) => !baselined.has(signature(c)));
const staleBaseline = baseline.filter((c) => !seen.has(signature(c)));

let failed = false;

if (newCollisions.length) {
  failed = true;
  console.log(`\n✗ ${newCollisions.length} DUPLICATE variant id${newCollisions.length === 1 ? '' : 's'} — a later registerVariant() silently replaced an earlier one:\n`);
  for (const c of newCollisions) {
    console.log(`    "${c.id}"`);
    console.log(`        kept: ${c.keptName} (${c.keptWidgetType})`);
    console.log(`        lost: ${c.lostName} (${c.lostWidgetType})`);
  }
  console.log('\n  Every zone whose config.variant is one of these ids renders the KEPT');
  console.log('  registration, whichever the operator actually picked. Rename one of the');
  console.log('  two ids — and migrate any saved config.variant that used the old value.');
  console.log(`  Do NOT add it to ${path.basename(BASELINE_FILE)} to get green; that file`);
  console.log('  records collisions we deliberately have not migrated yet, with reasons.');
}

if (staleBaseline.length) {
  failed = true;
  console.log(`\n✗ ${staleBaseline.length} stale baseline entr${staleBaseline.length === 1 ? 'y' : 'ies'} in ${path.basename(BASELINE_FILE)} — no longer collides:\n`);
  for (const c of staleBaseline) console.log(`    "${c.id}" (${c.lostWidgetType} → ${c.keptWidgetType})`);
  console.log('\n  Delete the entr(ies). A baseline only ratchets DOWN; a spent exemption');
  console.log('  left in place is cover for the next collision on the same id.');
}

if (missingRenderer.length) {
  failed = true;
  console.log(`\n✗ ${missingRenderer.length} registered variant${missingRenderer.length === 1 ? '' : 's'} with NO renderer — the picker shows the tile, the canvas shows the plain type default:\n`);
  for (const v of missingRenderer) {
    console.log(`    "${v.id}" (${v.widgetType}) — ${v.name}`);
  }
  console.log('\n  Usually a renamed/removed export reaching registerVariant through an');
  console.log('  `as any` cast, which is why the type checker stayed green.');
}

if (failed) {
  console.log(`\n  ${variants.length} variants registered; ${collisions.length} id collision(s) (${baselined.size} baselined), ${missingRenderer.length} missing renderer(s).\n`);
  process.exit(1);
}

console.log(
  `✓ variant registry clean — ${variants.length} variants, ` +
  `${collisions.length} id collision(s) (all ${baselined.size} baselined), 0 missing renderers`,
);
