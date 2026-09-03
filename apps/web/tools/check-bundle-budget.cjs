#!/usr/bin/env node
/*
 * Bundle-budget ratchet (efficiency audit 2026-07-20, F3).
 *
 * The audit found the widget/template component world compiled into FOUR
 * ~3.4 MB chunks (13.6 of 30 MB static) — every route that mounts
 * WidgetRenderer (player, builder, gallery) parses the entire widget
 * catalog, which is boot-time poison on weak Android/Taurus player CPUs.
 *
 * ── THE DEFERRED FIX IS DONE (P1-1, 2026-09-03) ──────────────────────────
 * This header used to say the structural fix was deferred until the player
 * service worker precached the app shell. It does now (P0-3), and the split
 * shipped: `WidgetRenderer` reaches every widget family through `lazyWidget`
 * proxies (widget-families.tsx), so a screen downloads the families its
 * manifest names and nothing else. Measured on a production build, the
 * largest chunk went 3.37 MB → 1.00 MB and the total 20.77 MB → 19.08 MB.
 * The ceilings below were regenerated against that build.
 *
 * This gate keeps them from creeping back. Ratchets DOWN only — same
 * discipline as taurus-safety / tenant-isolation / .a11y baselines.
 *
 *   - Runs AFTER `next build` (CI: the deploy-reliability web-build job).
 *   - Measures .next/static/chunks/*.js: the largest single chunk RAW, the
 *     largest single chunk GZIPPED, and the total chunk bytes.
 *   - FAILS (exit 1) when any exceeds baseline + tolerance (2% single chunk
 *     / 3% total — content-hash drift headroom, not a growth lane).
 *   - Exit 2 when the build output is missing (a crashed gate is never a
 *     pass — W0-05 discipline).
 *
 * ── WHY GZIP IS TRACKED TOO (P1-1) ───────────────────────────────────────
 * Raw bytes are what a device PARSES; compressed bytes are what it
 * DOWNLOADS, and the audit stated its budgets in compressed terms
 * ("individual route chunks preferably under 200 KB compressed"). A change
 * can hold raw size flat and still double transfer — e.g. by replacing
 * repetitive, highly-compressible markup with dense unique data — so the two
 * numbers are not substitutes. Deterministic: zlib level 9 on the same
 * bytes, with the same 2% drift tolerance as the raw ceiling.
 *
 * ── WHAT THIS GATE STILL CANNOT SEE ──────────────────────────────────────
 * It measures what the BUILD STORES, not what a screen DOWNLOADS. The player
 * pulls a small subset of these chunks, and the honest measurement of that is
 * `apps/web/tools/measure-player-boot.cjs`, which needs a browser and a
 * running server. Wiring that into CI as a second budget is the follow-up;
 * until then, do not read a green here as a statement about boot cost.
 *
 * Regenerate deliberately after a real reduction:
 *   UPDATE_BASELINE=1 node apps/web/tools/check-bundle-budget.cjs
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WEB_ROOT = path.resolve(__dirname, '..');
const CHUNKS_DIR = path.join(WEB_ROOT, '.next', 'static', 'chunks');
const BASELINE_PATH = path.join(__dirname, 'bundle-budget-baseline.json');

const SINGLE_TOLERANCE = 1.02; // 2% headroom for content-hash / minifier drift
const TOTAL_TOLERANCE = 1.03; // 3% on the aggregate

function measure() {
  if (!fs.existsSync(CHUNKS_DIR)) {
    console.error(`FATAL: ${path.relative(process.cwd(), CHUNKS_DIR)} missing — run \`pnpm --filter web build\` first. A gate that cannot measure is RED, not green.`);
    process.exit(2);
  }
  let total = 0;
  let maxBytes = 0;
  let maxName = '';
  let maxGzip = 0;
  let maxGzipName = '';
  let count = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith('.js')) {
        const buf = fs.readFileSync(abs);
        const size = buf.length;
        total += size;
        count += 1;
        if (size > maxBytes) {
          maxBytes = size;
          maxName = path.relative(CHUNKS_DIR, abs);
        }
        // Level 9 so the number is reproducible run-to-run and machine-to-
        // machine; it is a comparable metric, not a prediction of what any
        // particular CDN negotiates.
        const gz = zlib.gzipSync(buf, { level: 9 }).length;
        if (gz > maxGzip) {
          maxGzip = gz;
          maxGzipName = path.relative(CHUNKS_DIR, abs);
        }
      }
    }
  };
  walk(CHUNKS_DIR);
  return {
    totalBytes: total,
    maxChunkBytes: maxBytes,
    maxChunkName: maxName,
    maxChunkGzipBytes: maxGzip,
    maxChunkGzipName: maxGzipName,
    chunkCount: count,
  };
}

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

function main() {
  const current = measure();
  console.log(
    `Bundle budget: ${current.chunkCount} chunks, total ${mb(current.totalBytes)}, ` +
    `largest ${mb(current.maxChunkBytes)} (${current.maxChunkName}), ` +
    `largest gzipped ${kb(current.maxChunkGzipBytes)} (${current.maxChunkGzipName}).`,
  );

  if (process.env.UPDATE_BASELINE === '1') {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comment: 'Bundle-size ceilings (F3). Ratchets DOWN only — regenerate deliberately after a real reduction: UPDATE_BASELINE=1 node apps/web/tools/check-bundle-budget.cjs. Growth past tolerance REDS CI; do not bump to get green.',
          maxChunkBytes: current.maxChunkBytes,
          maxChunkGzipBytes: current.maxChunkGzipBytes,
          totalBytes: current.totalBytes,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Baseline written.');
    process.exit(0);
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    console.error('FATAL: no baseline. Create it once with UPDATE_BASELINE=1 after review.');
    process.exit(2);
  }

  const failures = [];
  if (current.maxChunkBytes > baseline.maxChunkBytes * SINGLE_TOLERANCE) {
    failures.push(
      `largest chunk ${mb(current.maxChunkBytes)} exceeds the ${mb(baseline.maxChunkBytes)} ceiling (+2% tolerance). ` +
      `Something big landed in a shared/page chunk — split it (next/dynamic) or justify + shrink elsewhere.`,
    );
  }
  // A baseline written before P1-1 has no gzip ceiling; skip that check rather
  // than invent one (a gate must never fail on a number it cannot compare).
  if (
    typeof baseline.maxChunkGzipBytes === 'number' &&
    current.maxChunkGzipBytes > baseline.maxChunkGzipBytes * SINGLE_TOLERANCE
  ) {
    failures.push(
      `largest gzipped chunk ${kb(current.maxChunkGzipBytes)} exceeds the ${kb(baseline.maxChunkGzipBytes)} ceiling (+2% tolerance) ` +
      `(${current.maxChunkGzipName}). Compressed size is what a kiosk DOWNLOADS — split it (next/dynamic) or shrink elsewhere.`,
    );
  }
  if (current.totalBytes > baseline.totalBytes * TOTAL_TOLERANCE) {
    failures.push(
      `total chunk payload ${mb(current.totalBytes)} exceeds the ${mb(baseline.totalBytes)} ceiling (+3% tolerance).`,
    );
  }

  if (failures.length) {
    console.error('\nFAIL: bundle budget exceeded:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nDo NOT raise the baseline to get green — the ceiling only ratchets down.');
    process.exit(1);
  }
  console.log('OK: bundle sizes within the ratcheted ceiling.');
  process.exit(0);
}

main();
