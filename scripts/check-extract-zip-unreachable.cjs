#!/usr/bin/env node
/**
 * SEC-013 — PROOF that the `extract-zip` symlink-traversal advisory
 * (GHSA-jmr9-qjv8-65gv, HIGH, CVSS 8.1, `<=2.0.1` i.e. every published
 * release) is unreachable in VenueOS.
 *
 * WHY A PROOF AND NOT A SENTENCE. `scripts/npm-advisory-audit.cjs` waives this
 * advisory because there is no fixed version and we never run the code path.
 * Until now that was a paragraph a human wrote once. A paragraph does not
 * notice when someone adds `await install({browser: 'chrome'})` to a warm-up
 * script, or bumps a dependency whose new version calls the download path. So
 * the waiver now OWNS this check: the audit runs it, and if any link in the
 * chain below breaks, the waiver stops applying and the gate goes red.
 *
 * THE CHAIN, each link checked mechanically below:
 *
 *   1. `extract-zip` has exactly ONE dependent in the installed tree:
 *      `@puppeteer/browsers`.
 *   2. Inside `@puppeteer/browsers`, exactly ONE module references it:
 *      `fileUtil` — in `unpackArchive()`, the ".zip" arm.
 *   3. `unpackArchive` has exactly ONE caller: `install()` in `install.js` —
 *      the download-a-browser path.
 *   4. `puppeteer-core`, the only thing in our graph that depends on
 *      `@puppeteer/browsers`, NEVER calls `install`. It uses
 *      `computeExecutablePath` / `launch` / `resolveBuildId` / etc. So the
 *      unzip path is unreachable through the entire puppeteer-core API — not
 *      merely unused by us.
 *   5. VenueOS source never imports `@puppeteer/browsers`, never calls a
 *      browser-install API, and does not depend on `puppeteer` (the wrapper
 *      package, which unlike `puppeteer-core` downloads a browser on install).
 *   6. Defence in depth: every `.launch({...})` in our source passes an
 *      explicit `executablePath`, so even a hypothetical fallback could not
 *      trigger a download.
 *
 * WHY THE ADVISORY CANNOT SIMPLY BE FIXED (measured 2026-09-05):
 *   - `extract-zip` latest is 2.0.1 (published 2023); the advisory covers
 *     `<=2.0.1`, so there is no floor to pin.
 *   - `@puppeteer/browsers` DROPS extract-zip at **3.0.2**, and every 3.x is
 *     `"type": "module"` with `engines.node >= 22.12.0`.
 *   - The first `puppeteer-core` on `@puppeteer/browsers@3` is **25.0.2**,
 *     also `engines.node >= 22.12.0`.
 *   - The API runtime image is `node:20-alpine`, pinned by digest in
 *     `Dockerfile`. So removing this advisory is a Node-20 → Node-22 base
 *     image migration, not a dependency bump. Until that migration happens the
 *     honest posture is a PROVEN waiver, which is what this file provides.
 *
 * Run standalone: `node scripts/check-extract-zip-unreachable.cjs`
 * Requires node_modules to be installed (same precondition as the audit).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PNPM_DIR = path.join(ROOT, 'node_modules', '.pnpm');

/** Source trees that are OURS (everything else in the repo is vendored/build). */
const SOURCE_DIRS = ['apps', 'packages', 'scripts'];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);
const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.turbo', 'coverage',
  '.git', 'out', 'android', 'ios', '.pnpm-store',
]);

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const raw = read(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function dirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Every package physically installed under `node_modules/.pnpm`, as
 * `{ name, version, dir }`.
 *
 * pnpm's layout makes this unambiguous: inside `<store-entry>/node_modules/`
 * the package ITSELF is a real directory and every dependency beside it is a
 * symlink. (Scoped packages nest one level: `@scope/` is a real directory
 * whose entries follow the same rule.) That is a stronger enumeration than
 * parsing the store-entry directory NAME, which carries peer-suffix noise.
 */
function installedPackages() {
  const out = [];
  for (const entry of dirents(PNPM_DIR)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const nm = path.join(PNPM_DIR, entry.name, 'node_modules');
    for (const e of dirents(nm)) {
      const candidates = e.name.startsWith('@')
        ? dirents(path.join(nm, e.name)).map((f) => path.join(e.name, f.name))
        : [e.name];
      for (const rel of candidates) {
        const dir = path.join(nm, rel);
        let st;
        try {
          st = fs.lstatSync(dir);
        } catch {
          continue;
        }
        if (st.isSymbolicLink() || !st.isDirectory()) continue; // a dependency, not the package
        const pkg = readJson(path.join(dir, 'package.json'));
        if (!pkg || !pkg.name) continue;
        out.push({ name: pkg.name, version: pkg.version || '?', dir, pkg });
      }
    }
  }
  return out;
}

/** Every source file under our own trees. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of dirents(dir)) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (SOURCE_EXT.has(path.extname(e.name))) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  for (const d of SOURCE_DIRS) walk(path.join(ROOT, d));
  return out;
}

/** Every `.js` under a package's build output (both cjs and esm trees). */
function packageJsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of dirents(d)) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(path.join(d, e.name));
      } else if (e.name.endsWith('.js') || e.name.endsWith('.mjs') || e.name.endsWith('.cjs')) {
        out.push(path.join(d, e.name));
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Run the proof.
 * @returns {{ ok: boolean, lines: string[], failures: string[] }}
 */
function verify() {
  const lines = [];
  const failures = [];
  const say = (s) => lines.push(s);
  const fail = (s) => {
    failures.push(s);
    lines.push(`  ✗ ${s}`);
  };

  if (!fs.existsSync(PNPM_DIR)) {
    return {
      ok: false,
      lines: [`node_modules/.pnpm not found at ${PNPM_DIR} — run pnpm install first.`],
      failures: ['node_modules missing; cannot prove anything'],
    };
  }

  const packages = installedPackages();
  if (packages.length < 200) {
    return {
      ok: false,
      lines: [`only ${packages.length} packages enumerated — the enumerator is broken, refusing to claim a proof.`],
      failures: ['package enumeration produced an implausible count'],
    };
  }

  const zips = packages.filter((p) => p.name === 'extract-zip');
  if (zips.length === 0) {
    return {
      ok: true,
      lines: ['extract-zip is NOT installed. The advisory does not apply and the waiver is moot — delete it.'],
      failures: [],
    };
  }
  say(`extract-zip installed: ${zips.map((z) => z.version).join(', ')}`);

  // ── 1. who depends on extract-zip ───────────────────────────────────────
  const dependents = new Set();
  for (const p of packages) {
    const deps = {
      ...(p.pkg.dependencies || {}),
      ...(p.pkg.optionalDependencies || {}),
      ...(p.pkg.peerDependencies || {}),
    };
    if (deps['extract-zip']) dependents.add(p.name);
  }
  const dependentList = [...dependents].sort();
  say(`  1. dependents of extract-zip: ${dependentList.join(', ') || '(none)'}`);
  const unexpected = dependentList.filter((n) => n !== '@puppeteer/browsers');
  if (unexpected.length > 0) {
    fail(
      `a NEW dependent of extract-zip appeared: ${unexpected.join(', ')}. ` +
        'The unreachability argument only covers @puppeteer/browsers — re-derive it before the waiver can stand.',
    );
  }

  // ── 2 + 3. inside @puppeteer/browsers, only unpackArchive uses it, and
  //          only install() calls unpackArchive ──────────────────────────
  const browsers = packages.filter((p) => p.name === '@puppeteer/browsers');
  if (browsers.length === 0 && dependentList.length > 0) {
    fail('extract-zip has dependents but @puppeteer/browsers is not installed — the chain no longer describes reality.');
  }
  for (const b of browsers) {
    const files = packageJsFiles(b.dir);
    // Static `require('extract-zip')` (2.3.0), the ESM `from 'extract-zip'`
    // form, AND the LAZY `await import('extract-zip')` that 2.13.0 switched to
    // — matching only the first two is exactly how a refactor slips past this.
    const ZIP_IMPORT = /(?:require|import)\(\s*['"]extract-zip['"]\s*\)|from\s*['"]extract-zip['"]/;
    const usesZip = files.filter((f) => ZIP_IMPORT.test(read(f) || ''));
    const names = [...new Set(usesZip.map((f) => path.basename(f)))].sort();
    if (usesZip.length === 0) {
      fail(
        `@puppeteer/browsers@${b.version} declares extract-zip but no file appears to import it — ` +
          'the matcher has drifted from the package, so this check would be proving nothing.',
      );
    }
    say(`  2. @puppeteer/browsers@${b.version}: files importing extract-zip → ${names.join(', ') || '(none)'}`);
    const notFileUtil = names.filter((n) => !/^fileUtil\./.test(n));
    if (notFileUtil.length > 0) {
      fail(`@puppeteer/browsers@${b.version} imports extract-zip outside fileUtil (${notFileUtil.join(', ')}) — re-derive the chain.`);
    }

    const callers = files.filter((f) => {
      const base = path.basename(f);
      if (/^fileUtil\./.test(base)) return false;
      return /unpackArchive/.test(read(f) || '');
    });
    const callerNames = [...new Set(callers.map((f) => path.basename(f)))].sort();
    say(`  3. callers of unpackArchive → ${callerNames.join(', ') || '(none)'}`);
    const notInstall = callerNames.filter((n) => !/^install\./.test(n));
    if (notInstall.length > 0) {
      fail(
        `unpackArchive is now reachable from ${notInstall.join(', ')} in @puppeteer/browsers@${b.version}, ` +
          'not just the download path.',
      );
    }
  }

  // ── 4. puppeteer-core never calls install() ─────────────────────────────
  const cores = packages.filter((p) => p.name === 'puppeteer-core');
  if (cores.length === 0) {
    say('  4. puppeteer-core is not installed (nothing to check).');
  }
  for (const c of cores) {
    const files = packageJsFiles(c.dir);
    const symbols = new Set();
    for (const f of files) {
      const src = read(f) || '';
      // CJS: `const browsers_1 = require("@puppeteer/browsers")` then `browsers_1.install(...)`.
      for (const m of src.matchAll(/\bbrowsers_1\.([A-Za-z_$][\w$]*)/g)) symbols.add(m[1]);
      // ESM: `import { install, launch } from '@puppeteer/browsers'`.
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@puppeteer\/browsers['"]/g)) {
        for (const part of m[1].split(',')) {
          const id = part.trim().split(/\s+as\s+/)[0].trim();
          if (id) symbols.add(id);
        }
      }
    }
    const sorted = [...symbols].sort();
    say(`  4. puppeteer-core@${c.version} uses from @puppeteer/browsers: ${sorted.join(', ') || '(none)'}`);
    if (symbols.has('install') || symbols.has('installAll')) {
      fail(
        `puppeteer-core@${c.version} now references @puppeteer/browsers' install API — the download/extract path ` +
          'is reachable through the launcher and the waiver no longer holds.',
      );
    }
  }

  // ── 5. our own source ──────────────────────────────────────────────────
  const files = sourceFiles();
  if (files.length < 500) {
    fail(`only ${files.length} source files enumerated — the walker is broken, refusing to claim a proof.`);
  }
  const rel = (f) => path.relative(ROOT, f);
  const selfName = path.basename(__filename);
  const importsBrowsers = [];
  const launchSites = [];
  const launchWithoutExecPath = [];
  for (const f of files) {
    if (path.basename(f) === selfName) continue; // this file names the symbols on purpose
    const src = read(f) || '';
    if (/['"]@puppeteer\/browsers['"]/.test(src)) importsBrowsers.push(rel(f));
    // Check 6 covers PUPPETEER launches only. Playwright's `chromium.launch()`
    // ships its own browsers and never touches @puppeteer/browsers, so folding
    // the repo's Playwright harnesses in here would be a false positive — the
    // kind that teaches people to ignore a gate.
    if (!/['"]puppeteer(-core)?['"]/.test(src)) continue;
    // `puppeteer.launch({ ... })` / `await X.launch({ ... })`, non-greedy to the
    // first closing brace at the start of a line (the launch options object).
    for (const m of src.matchAll(/\.launch\(\s*\{[\s\S]*?\n\s*\}\s*\)/g)) {
      launchSites.push(rel(f));
      if (!/executablePath/.test(m[0])) launchWithoutExecPath.push(rel(f));
    }
  }
  say(`  5. source files importing @puppeteer/browsers: ${importsBrowsers.join(', ') || '(none)'}`);
  if (importsBrowsers.length > 0) {
    fail(
      `VenueOS source now imports @puppeteer/browsers directly (${importsBrowsers.join(', ')}). ` +
        'That package exposes install(), which is the extract-zip path — the waiver must be re-derived.',
    );
  }

  const declaresPuppeteerWrapper = [];
  for (const wsPkgJson of [
    'package.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'apps/player/package.json',
  ]) {
    const j = readJson(path.join(ROOT, wsPkgJson));
    if (!j) continue;
    if ((j.dependencies || {}).puppeteer) declaresPuppeteerWrapper.push(wsPkgJson);
  }
  say(`  5b. workspaces declaring the 'puppeteer' wrapper as a prod dep: ${declaresPuppeteerWrapper.join(', ') || '(none)'}`);
  if (declaresPuppeteerWrapper.length > 0) {
    fail(
      `'puppeteer' (the wrapper, which downloads a browser on install) is a production dependency in ` +
        `${declaresPuppeteerWrapper.join(', ')}. Use 'puppeteer-core' — the download path is exactly what this waiver claims we never run.`,
    );
  }

  // ── 6. defence in depth: every launch names an executable ──────────────
  const uniqueLaunch = [...new Set(launchSites)];
  say(`  6. puppeteer .launch({…}) sites in source: ${uniqueLaunch.join(', ') || '(none — nothing launches puppeteer)'}`);
  if (launchWithoutExecPath.length > 0) {
    fail(
      `a browser launch without an explicit executablePath: ${[...new Set(launchWithoutExecPath)].join(', ')}. ` +
        'Puppeteer would then look for a downloaded browser, which is the path this waiver says we never take.',
    );
  }

  return { ok: failures.length === 0, lines, failures };
}

function main() {
  const { ok, lines, failures } = verify();
  console.log('SEC-013 — extract-zip (GHSA-jmr9-qjv8-65gv) reachability proof');
  for (const l of lines) console.log(l);
  if (ok) {
    console.log('\nPROVEN UNREACHABLE: the download/extract path cannot be invoked from this codebase. ✅');
    process.exit(0);
  }
  console.error(`\nPROOF BROKEN (${failures.length}). The extract-zip waiver does NOT apply until this is re-derived:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { verify };
