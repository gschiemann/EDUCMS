#!/usr/bin/env node
/**
 * Browser Sentry + player chunk syntax guard (2026-11-23, launch audit
 * LIV-03 / OPS-04 / PLW-02 / SSC-06).
 *
 * WHY THIS EXISTS. The browser Sentry init lived in `sentry.client.config.ts`,
 * which the Turbopack build (Next 16's default) never loads, so the SDK did
 * not start in production and every build was green. The init now lives in
 * `src/instrumentation-client.ts`. This reads the BUILD — not the source —
 * and fails if the init is not in the chunks every page loads.
 *
 * It also parses the chunks `/player` loads first at ECMAScript 2020. The
 * player runs on Chromium-83 LED controllers (NovaStar Taurus); a chunk with
 * syntax that engine cannot parse (logical assignment `??=`, class static
 * blocks, top-level await, …) stops the whole player there, and no try/catch
 * can help. ES2020 is a stricter floor than Chromium 83 (which also parses
 * class fields), so a pass here is a pass there.
 *
 * Run AFTER `next build`:
 *   node apps/web/tools/check-client-sentry.cjs
 *   node apps/web/tools/check-client-sentry.cjs --self-test   # negative controls
 *
 * `NEXT_PUBLIC_SENTRY_DSN` must be the value the build saw (Next inlines it at
 * build time):
 *   - set   → that DSN must be in a chunk every page loads;
 *   - unset → the "not set" warning from instrumentation-client.ts must be.
 *
 * What it cannot see: chunks the player loads lazily (widget families). The
 * whole-build parse is a one-off measurement recorded with the change.
 *
 * Exit 1 = a check failed; exit 2 = the build output or the parser is missing
 * (a gate that cannot measure is red, not green).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS CI script, like its siblings */
const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '..');
const NEXT_DIR = path.join(WEB_ROOT, '.next');
const PLAYER_BUILD_MANIFEST = path.join(NEXT_DIR, 'server', 'app', 'player', 'page', 'build-manifest.json');
const PLAYER_CLIENT_MANIFEST = path.join(NEXT_DIR, 'server', 'app', 'player', 'page_client-reference-manifest.js');
const PLAYER_ENTRY = '[project]/apps/web/src/app/player/page';
const NOT_SET_WARNING = '[sentry] NEXT_PUBLIC_SENTRY_DSN not set';
const ECMA_VERSION = 2020;

function fatal(msg) {
  console.error(`[client-sentry] FATAL: ${msg}`);
  process.exit(2);
}

function loadAcorn() {
  try {
    // Next ships acorn compiled into its own package; `next` is a direct
    // dependency of this app, so no new dependency is needed.
    return require(require.resolve('next/dist/compiled/acorn', { paths: [WEB_ROOT] }));
  } catch (e) {
    return fatal(`cannot load a JavaScript parser (next/dist/compiled/acorn): ${e.message}`);
  }
}

/** null when `code` parses at ES2020 as a script or a module, else the error. */
function parseError(acorn, code) {
  let first = null;
  for (const sourceType of ['script', 'module']) {
    try {
      acorn.parse(code, { ecmaVersion: ECMA_VERSION, sourceType, allowHashBang: true });
      return null;
    } catch (e) {
      if (!first) first = e;
    }
  }
  const pos = typeof first.pos === 'number' ? first.pos : 0;
  return `${first.message} near ${JSON.stringify(code.slice(Math.max(0, pos - 40), pos + 40))}`;
}

function selfTest() {
  const acorn = loadAcorn();
  const mustFail = [
    'let a; a ??= 1;',
    'let a; a ||= 1;',
    'class A { static { this.x = 1; } }',
    'class A { #m() {} }',
    'await Promise.resolve(1);',
  ];
  const mustPass = ['const a = b?.c ?? d;', 'async function f() { for await (const x of y) {} }', 'const n = 10n;'];
  let ok = true;
  for (const src of mustFail) {
    if (parseError(acorn, src) === null) {
      console.error(`[client-sentry] self-test: ${JSON.stringify(src)} parsed at ES${ECMA_VERSION} — the parser floor is wrong`);
      ok = false;
    }
  }
  for (const src of mustPass) {
    const err = parseError(acorn, src);
    if (err !== null) {
      console.error(`[client-sentry] self-test: ${JSON.stringify(src)} failed to parse: ${err}`);
      ok = false;
    }
  }
  const sample = 'console.warn("[sentry] NEXT_PUBLIC_SENTRY_DSN not set — client error tracking disabled.")';
  if (!sample.includes(NOT_SET_WARNING)) ok = false;
  console.log(ok ? '[client-sentry] self-test OK' : '[client-sentry] self-test FAILED');
  process.exit(ok ? 0 : 1);
}

function readPlayerChunks() {
  if (!fs.existsSync(PLAYER_BUILD_MANIFEST) || !fs.existsSync(PLAYER_CLIENT_MANIFEST)) {
    fatal(`${path.relative(process.cwd(), PLAYER_BUILD_MANIFEST)} or its client-reference manifest is missing — run \`next build\` first.`);
  }
  const bm = JSON.parse(fs.readFileSync(PLAYER_BUILD_MANIFEST, 'utf8'));
  const crmSrc = fs.readFileSync(PLAYER_CLIENT_MANIFEST, 'utf8');
  const m = crmSrc.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) fatal('cannot read the /player client-reference manifest (format changed?)');
  let crm;
  try {
    crm = JSON.parse(m[1]);
  } catch (e) {
    fatal(`cannot parse the /player client-reference manifest: ${e.message}`);
  }
  const rootMain = Array.isArray(bm.rootMainFiles) ? bm.rootMainFiles : [];
  const entry = (crm.entryJSFiles && crm.entryJSFiles[PLAYER_ENTRY]) || [];
  if (rootMain.length === 0) fatal('the /player build manifest lists no rootMainFiles (format changed?)');
  if (entry.length === 0) fatal(`the client-reference manifest has no entryJSFiles for ${PLAYER_ENTRY}`);
  return { rootMain, firstLoad: [...new Set([...rootMain, ...entry])] };
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const acorn = loadAcorn();
  const { rootMain, firstLoad } = readPlayerChunks();
  const read = (rel) => {
    const abs = path.join(NEXT_DIR, rel);
    if (!fs.existsSync(abs)) fatal(`${rel} is listed in a manifest but missing on disk`);
    return fs.readFileSync(abs, 'utf8');
  };
  const failures = [];

  // A. The init is in the chunks every page (and the player) loads first.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || '';
  const marker = dsn || NOT_SET_WARNING;
  const holders = rootMain.filter((f) => read(f).includes(marker));
  if (holders.length === 0) {
    failures.push(
      dsn
        ? `the DSN in NEXT_PUBLIC_SENTRY_DSN is not in any root chunk: the browser Sentry init is not in the bundle (or the build saw a different DSN).`
        : `"${NOT_SET_WARNING}" is not in any root chunk: src/instrumentation-client.ts no longer carries the browser Sentry init (or the build had a DSN — then set NEXT_PUBLIC_SENTRY_DSN for this check too).`,
    );
  }

  // B. Every /player first-load chunk parses at ES2020.
  let bytes = 0;
  for (const f of firstLoad) {
    const code = read(f);
    bytes += Buffer.byteLength(code);
    const err = parseError(acorn, code);
    if (err) failures.push(`${f} does not parse at ES${ECMA_VERSION} (Chromium 83 floor): ${err}`);
  }

  console.log(
    `[client-sentry] browser init (${dsn ? 'DSN build' : 'no-DSN build'}) found in ${holders.length} root chunk(s); ` +
      `${firstLoad.length} /player first-load chunks (${(bytes / 1024).toFixed(0)} KiB) parsed at ES${ECMA_VERSION}.`,
  );
  if (failures.length) {
    for (const f of failures) console.error(`[client-sentry] FAIL: ${f}`);
    process.exit(1);
  }
  console.log('[client-sentry] OK');
}

main();
