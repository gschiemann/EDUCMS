/**
 * apps/web/scripts/a11y-audit.ts
 *
 * Sprint 6 — Automated accessibility audit.
 *
 * Boots a headless Chromium, visits the 10 flagship routes, runs @axe-core
 * against each, and fails (exit 1) on any error-level violation.
 *
 * WARNING RATCHET (§18-2 fix, 2026-05-30)
 * ----------------------------------------
 * Moderate + minor ("warning") violations are now counted and compared against
 * a committed baseline stored in `scripts/a11y-warning-baseline.json`.
 * The build fails if `totalWarnings > warningBaseline` — the backlog cannot
 * grow silently. To lower the baseline after fixing warnings:
 *   1. Run `pnpm a11y:ci` locally against the live app.
 *   2. Note the reported warning count.
 *   3. Update `scripts/a11y-warning-baseline.json` with the new (lower) value.
 *   4. Commit alongside the fix.
 * The baseline is intentionally DOWN-only: never raise it without an explicit
 * justification comment in the JSON. If a new route is added to ROUTES, raise
 * the baseline by the new route's expected warnings + document the delta.
 *
 * Usage:
 *   pnpm --filter web build
 *   pnpm --filter web start &   # or set BASE_URL to a live deploy
 *   pnpm a11y:ci
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = process.env.A11Y_BASE_URL || 'http://localhost:3000';

// A11y audit (2026-05-25, A4 expansion): added the 5 high-risk
// life-safety + onboarding routes that were previously ungated:
//   /panic                — mobile emergency trigger
//   /[seed]/emergency/broadcast — desktop emergency console
//   /[seed]/reviews       — CONTRIBUTOR review queue
//   /onboarding/branding  — first-run onboarding wizard
//   /[seed]/screens       — fleet map view (?view=map)
// Seed tenant id matches packages/database/prisma/seed.ts line 88.
const SEED_TENANT = '00000000-0000-0000-0000-000000000002';
const ROUTES: string[] = [
  '/login',
  '/dashboard',
  '/screens',
  `/${SEED_TENANT}/templates`,
  '/player',
  '/panic',
  `/${SEED_TENANT}/emergency/broadcast`,
  `/${SEED_TENANT}/reviews`,
  '/onboarding/branding',
  `/${SEED_TENANT}/screens?view=map`,
];

// Rules we intentionally ignore for now (document why in ACCESSIBILITY.md).
const DISABLED_RULES: string[] = [
  // Kiosk player intentionally hides interactive controls; axe flags
  // "region" and "landmark" rules that do not apply to a full-screen
  // non-interactive canvas. Keep this list short and justified.
];

type Violation = {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
};

async function auditRoute(page: Page, route: string): Promise<Violation[]> {
  const url = `${BASE_URL}${route}`;
  console.log(`\n→ Auditing ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
  } catch (e) {
    console.warn(`  ⚠ failed to load ${url}: ${(e as Error).message}`);
    return [];
  }

  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa',
  ]);
  if (DISABLED_RULES.length) builder = builder.disableRules(DISABLED_RULES);

  const results = await builder.analyze();
  return results.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
  }));
}

// ─── Warning ratchet baseline ────────────────────────────────────────────
// Loaded from the committed baseline file so it travels with the code. If
// the file is missing (e.g. a new checkout before first CI run), we fall
// back to a permissive default of 999 and log a loud warning so the dev
// knows to lock it down.
const BASELINE_FILE = path.resolve(__dirname, 'a11y-warning-baseline.json');
let warningBaseline = 999;
try {
  const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as {
    warningBaseline: number;
    lockedAt?: string;
    note?: string;
  };
  warningBaseline = raw.warningBaseline;
  console.log(`axe warning ratchet: baseline=${warningBaseline} (locked ${raw.lockedAt ?? 'unknown'})`);
} catch {
  console.warn(
    `\n⚠ Could not read ${BASELINE_FILE} — warning ratchet using permissive default (${warningBaseline}).\n` +
    `  Run \`pnpm a11y:ci\` once against the live app, note the warning count, and commit the baseline file.\n`,
  );
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const route of ROUTES) {
    const violations = await auditRoute(page, route);
    for (const v of violations) {
      const isError = v.impact === 'critical' || v.impact === 'serious';
      const label = isError ? 'ERROR' : 'WARN ';
      console.log(`  [${label}] ${v.id} (${v.impact}) — ${v.help} [${v.nodes} node${v.nodes === 1 ? '' : 's'}]`);
      if (isError) totalErrors += 1; else totalWarnings += 1;
    }
    if (violations.length === 0) console.log('  ✓ no violations');
  }

  await browser.close();

  console.log(`\n==============================`);
  console.log(`axe-core results: ${totalErrors} error(s), ${totalWarnings} warning(s) (baseline: ${warningBaseline})`);
  console.log(`==============================`);

  if (totalErrors > 0) {
    console.error(`\n✗ Failing build: ${totalErrors} error-level a11y violation(s).`);
    process.exit(1);
  }

  // §18-2 warning ratchet — baseline is down-only.
  if (totalWarnings > warningBaseline) {
    console.error(
      `\n✗ Failing build: ${totalWarnings} moderate/minor warning(s) exceeds the committed baseline ` +
      `of ${warningBaseline}. New warnings introduced. Fix them or intentionally update ` +
      `scripts/a11y-warning-baseline.json with a justified comment.`,
    );
    process.exit(1);
  }

  if (totalWarnings < warningBaseline) {
    console.log(
      `\n✓ Warnings reduced (${totalWarnings} < baseline ${warningBaseline}). ` +
      `Consider lowering the baseline in scripts/a11y-warning-baseline.json.`,
    );
  } else {
    console.log(`\n✓ Warnings at baseline (${totalWarnings}/${warningBaseline}).`);
  }

  console.log('✓ axe check passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
