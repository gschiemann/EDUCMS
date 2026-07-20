#!/usr/bin/env node
/*
 * Bundle-budget ratchet (efficiency audit 2026-07-20, F3).
 *
 * The audit found the widget/template component world compiled into FOUR
 * ~3.4 MB chunks (13.6 of 30 MB static) — every route that mounts
 * WidgetRenderer (player, builder, gallery) parses the entire widget
 * catalog, which is boot-time poison on weak Android/Taurus player CPUs.
 * The structural fix (surface splitting / lazy widget registry) is
 * DEFERRED until the player service worker precaches the app shell —
 * sw-player.js caches MEDIA only today, so lazy chunks would break
 * offline resilience (see docs/research/2026-07-20-efficiency-audit/
 * 01-BUNDLE-SPLIT-PLAN.md).
 *
 * This gate stops the bleeding NOW: it locks the current sizes as the
 * CEILING and fails CI on growth. Ratchets DOWN only — same discipline
 * as taurus-safety / tenant-isolation / .a11y baselines.
 *
 *   - Runs AFTER `next build` (CI: the deploy-reliability web-build job).
 *   - Measures .next/static/chunks/*.js: the largest single chunk and the
 *     total chunk bytes.
 *   - FAILS (exit 1) when either exceeds baseline + tolerance (2% single
 *     chunk / 3% total — content-hash drift headroom, not a growth lane).
 *   - Exit 2 when the build output is missing (a crashed gate is never a
 *     pass — W0-05 discipline).
 *
 * Regenerate deliberately after a real reduction:
 *   UPDATE_BASELINE=1 node apps/web/tools/check-bundle-budget.cjs
 */

const fs = require('fs');
const path = require('path');

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
  let count = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith('.js')) {
        const size = fs.statSync(abs).size;
        total += size;
        count += 1;
        if (size > maxBytes) {
          maxBytes = size;
          maxName = path.relative(CHUNKS_DIR, abs);
        }
      }
    }
  };
  walk(CHUNKS_DIR);
  return { totalBytes: total, maxChunkBytes: maxBytes, maxChunkName: maxName, chunkCount: count };
}

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

function main() {
  const current = measure();
  console.log(
    `Bundle budget: ${current.chunkCount} chunks, total ${mb(current.totalBytes)}, ` +
    `largest ${mb(current.maxChunkBytes)} (${current.maxChunkName}).`,
  );

  if (process.env.UPDATE_BASELINE === '1') {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comment: 'Bundle-size ceilings (F3). Ratchets DOWN only — regenerate deliberately after a real reduction: UPDATE_BASELINE=1 node apps/web/tools/check-bundle-budget.cjs. Growth past tolerance REDS CI; do not bump to get green.',
          maxChunkBytes: current.maxChunkBytes,
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
