#!/usr/bin/env node
/**
 * SEC-010 guard — a prerendered route must never receive the enforced,
 * nonce-based `script-src`.
 *
 * WHY THIS EXISTS. A per-request nonce only exists on a per-request render.
 * Next serves a statically prerendered route from HTML built at deploy time,
 * whose inline flight scripts carry `nonce: $undefined` (measured 2026-09-04:
 * `/login` prerendered → seven un-nonced `<script>self.__next_f.push(…)</script>`
 * blocks; `/demo-school/dashboard` dynamic → all of them nonced). Ship an
 * enforcing nonce policy on such a route and the page white-screens.
 *
 * `src/lib/csp-script-policy.ts` names the prerendered routes so the
 * middleware skips them. That list is only as good as its last edit, and the
 * failure mode is a blank page for a customer. So this reads the build's OWN
 * `.next/prerender-manifest.json` — the ground truth for what Next actually
 * prerendered — and fails if any of it falls inside the enforced set.
 *
 * Run AFTER `next build`:
 *   node apps/web/tools/check-csp-prerender.cjs
 *
 * A failure has exactly two correct fixes, both printed by the script:
 *   • add the route's prefix to `CSP_UNNONCEABLE_PREFIXES` (it stays on the
 *     report-only policy, as it is today), or
 *   • make the route render dynamically so it can carry a nonce.
 * "Ship it anyway" is not one of them.
 */
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(webRoot, '.next', 'prerender-manifest.json');
const policyPath = path.join(webRoot, 'src', 'lib', 'csp-script-policy.ts');

if (!fs.existsSync(manifestPath)) {
  console.error(
    `[csp-prerender] ${path.relative(process.cwd(), manifestPath)} not found — run \`next build\` first.`,
  );
  process.exit(2);
}

/**
 * Parse the exclusion lists straight out of the TypeScript source.
 *
 * Deliberately a source parse rather than an import: this runs as plain CJS
 * from a shell/CI step with no TS toolchain, and the two arrays are simple
 * string literals. If either array stops being a literal, the regex misses and
 * the script fails loudly below rather than silently passing everything.
 */
function readList(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

const policySrc = fs.readFileSync(policyPath, 'utf8');
const prefixes = readList(policySrc, 'CSP_UNNONCEABLE_PREFIXES');
const exact = readList(policySrc, 'CSP_UNNONCEABLE_EXACT');

if (!prefixes || !exact) {
  console.error(
    '[csp-prerender] Could not read CSP_UNNONCEABLE_PREFIXES / CSP_UNNONCEABLE_EXACT from ' +
      `${path.relative(process.cwd(), policyPath)}. If those arrays were refactored, update this guard — ` +
      'do not delete it.',
  );
  process.exit(2);
}

/** Mirror of `shouldEnforceScriptCsp` — kept trivially small so it cannot drift. */
function enforced(pathname) {
  if (exact.includes(pathname)) return false;
  return !prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Routes the middleware never sees at all (its matcher excludes them), so a
 * prerendered entry here is irrelevant. Kept in step with `config.matcher` in
 * `src/proxy.ts`.
 */
function outsideMatcher(pathname) {
  if (pathname === '/player' || pathname.startsWith('/player/')) return true;
  if (pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  for (const dir of ['/templates/', '/holiday-templates/', '/celebrations/', '/demo/']) {
    if (pathname.startsWith(dir)) return true;
  }
  // Anything with a file extension in the last segment (icons, manifests, sw.js).
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const prerendered = Object.keys(manifest.routes || {});

const offenders = prerendered.filter((r) => !outsideMatcher(r) && enforced(r));

if (offenders.length === 0) {
  console.log(
    `[csp-prerender] OK — ${prerendered.length} prerendered routes, none inside the enforced script-src set.`,
  );
  process.exit(0);
}

console.error(
  '\n[csp-prerender] FAIL — these routes are PRERENDERED but would receive the enforced,\n' +
    'nonce-based script-src. Their inline scripts were built without a nonce, so the\n' +
    'browser would refuse them and the page would render blank:\n',
);
for (const r of offenders) console.error(`  ${r}`);
console.error(
  '\nFix ONE of these, per route:\n' +
    '  1. add its prefix to CSP_UNNONCEABLE_PREFIXES in src/lib/csp-script-policy.ts\n' +
    '     (it keeps the report-only policy — the pre-SEC-010 behaviour), or\n' +
    '  2. make the route render dynamically so Next can nonce its scripts.\n',
);
process.exit(1);
