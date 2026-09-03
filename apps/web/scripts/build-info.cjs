#!/usr/bin/env node
/**
 * build-info.cjs — compute this build's BUNDLE IDENTITY and hand it to
 * `next build` (2026-09-02, efficiency program).
 *
 * ── THE BUG THIS FIXES ──────────────────────────────────────────────────
 * The stale-bundle detector (`/api/build-info` + the drift effect in
 * `player/page.tsx`) compared the deployed GIT COMMIT SHA against the SHA
 * baked into the running bundle. That identity is wrong in one specific,
 * expensive way: EVERY commit changes it. An API-only fix, an APK change,
 * a docs edit, a test-only commit — each still triggers a Vercel build,
 * each publishes a new commit SHA, and each therefore told EVERY kiosk in
 * the fleet "you are running an old bundle", producing a fleet-wide soft
 * reload and a shell re-download for a bundle whose bytes were identical.
 *
 * `bundleId` is instead a hash of the INPUTS that determine the client
 * bundle. A commit that cannot change what the browser downloads cannot
 * change it, so those deploys stop reloading the fleet.
 *
 * ── WHY INPUTS AND NOT THE BUILT OUTPUT ─────────────────────────────────
 * The value has to be INLINED into the client bundle (the running document
 * must know its own identity without a network call — see the drift effect
 * for why a "fetch it at boot and remember it" scheme has a race). Anything
 * inlined must exist BEFORE the compile, and the output hash by definition
 * does not. So this hashes the closure of build inputs, which is exactly
 * what Turborepo hashes for its own cache key and is the same standard
 * approximation. Failure mode if the closure is short: a genuinely-changed
 * bundle is not detected as drift, and the fleet keeps the older bundle
 * until the next `apps/web/src` change — noticeably better than today's
 * "reload on every unrelated deploy", and REFRESH_WEB (dashboard push +
 * the durable `pendingRefreshAt` manifest field) remains the operator's
 * direct lever either way.
 *
 * ── FAIL-SAFE ───────────────────────────────────────────────────────────
 * If this script does not run, or the value does not reach the bundle, the
 * player falls back to the ORIGINAL git-SHA comparison, byte for byte. The
 * bundle identity is an optimization on top of a mechanism that still
 * works without it — never a new dependency for it.
 *
 * Output: writes/updates `NEXT_PUBLIC_BUNDLE_ID` in `apps/web/.env.production.local`
 * (gitignored via `apps/web/.gitignore`'s `.env*`), which Next loads for
 * `next build` and inlines into both the client bundle and the
 * `/api/build-info` route handler. Prints the id.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEB = path.join(__dirname, '..');
const REPO = path.join(WEB, '..', '..');

/**
 * Directories walked in full. `apps/web/public` is DELIBERATELY ABSENT:
 * the ~168 MB of template HTML there is fetched at runtime by sandboxed
 * iframes, never compiled into the client bundle, so a board redesign must
 * not reload the fleet (the board is re-fetched on its own).
 */
const DIRS = [path.join(WEB, 'src')];

/** Individual files whose content changes the compile. */
const FILES = [
  path.join(WEB, 'next.config.ts'),
  path.join(WEB, 'postcss.config.mjs'),
  path.join(WEB, 'tsconfig.json'),
  path.join(WEB, 'package.json'),
  path.join(REPO, 'pnpm-lock.yaml'),
];

/**
 * Workspace packages compiled INTO the web bundle. Their `src` is walked
 * the same way; a shared-package fix is a real bundle change and must
 * reload the fleet.
 */
const PACKAGES_DIR = path.join(REPO, 'packages');

/**
 * Excluded from the walk. Tests never reach the client bundle, so a
 * test-only commit must not reload a single screen — that alone is a large
 * share of the deploys that used to.
 */
const EXCLUDE_RE = /(^|\/)(__tests__|__mocks__|node_modules|\.next)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/;

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a missing optional path is not an error
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO, full).split(path.sep).join('/');
    if (EXCLUDE_RE.test(rel)) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function computeBundleId() {
  /** @type {string[]} */
  const files = [];
  for (const dir of DIRS) walk(dir, files);

  // Workspace packages: only their source, never their build output.
  try {
    for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      walk(path.join(PACKAGES_DIR, entry.name, 'src'), files);
    }
  } catch {
    /* no packages dir — nothing to add */
  }

  for (const f of FILES) {
    if (fs.existsSync(f)) files.push(f);
  }

  // Sort by REPO-RELATIVE POSIX path so the id is identical on macOS, Linux
  // and a Vercel builder — an absolute-path or readdir-order sort would make
  // the same tree hash differently per machine and reload the fleet on a
  // rebuild of identical code.
  const rows = files
    .map((f) => ({ rel: path.relative(REPO, f).split(path.sep).join('/'), abs: f }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const h = crypto.createHash('sha256');
  for (const { rel, abs } of rows) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(abs));
    h.update('\0');
  }
  // 12 chars — the width `/api/build-info` and `normalizeBundleSha` already
  // compare on, so the value slots into the existing comparison unchanged.
  return { bundleId: h.digest('hex').slice(0, 12), fileCount: rows.length };
}

/**
 * Write (or replace) one key in `.env.production.local`, preserving every
 * other line. Next loads that file for `next build`, and it is gitignored
 * by `apps/web/.gitignore`'s `.env*`.
 */
function writeEnv(key, value) {
  const envPath = path.join(WEB, '.env.production.local');
  let lines = [];
  try {
    lines = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith(`${key}=`));
  } catch {
    /* first run */
  }
  lines.push(`${key}=${value}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
  return envPath;
}

function main() {
  const { bundleId, fileCount } = computeBundleId();
  const envPath = writeEnv('NEXT_PUBLIC_BUNDLE_ID', bundleId);
  console.log(
    `[build-info] bundleId=${bundleId} over ${fileCount} input file(s) → ${path.relative(REPO, envPath)}`,
  );
}

if (require.main === module) main();

module.exports = { computeBundleId };
