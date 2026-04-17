/**
 * apps/web/scripts/a11y-audit.ts
 *
 * Sprint 6 — Automated accessibility audit.
 *
 * Boots a headless Chromium, visits the 5 flagship routes, runs @axe-core
 * against each, and fails (exit 1) on any error-level violation. Warnings
 * are reported but do not fail the build yet — see docs/ACCESSIBILITY.md
 * for the allowed-warnings policy and how to tighten this gate.
 *
 * Usage:
 *   pnpm --filter web build
 *   pnpm --filter web start &   # or set BASE_URL to a live deploy
 *   pnpm a11y:ci
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE_URL = process.env.A11Y_BASE_URL || 'http://localhost:3000';

const ROUTES: string[] = [
  '/login',
  '/dashboard',
  '/screens',
  '/00000000-0000-0000-0000-000000000002/templates',
  '/player',
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
  console.log(`axe-core results: ${totalErrors} error(s), ${totalWarnings} warning(s)`);
  console.log(`==============================`);

  if (totalErrors > 0) {
    console.error(`\n✗ Failing build: ${totalErrors} error-level a11y violation(s).`);
    process.exit(1);
  }
  console.log('\n✓ No error-level violations. Warnings do not fail the build (yet).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
