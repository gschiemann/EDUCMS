#!/usr/bin/env node
/*
 * Help-center prerender gate (2026-07-21).
 *
 * Caught in the wild: one help article (generate-with-ai) prerendered as the
 * "Article not found" page in an otherwise-green build — a silently 404ing
 * doc that no test would ever notice. This gate runs AFTER `next build` in
 * the deploy-reliability web job and fails if any article registered in
 * SLUG_ORDER is missing from the prerender output or was rendered as
 * not-found.
 *
 * Run (after a build): node apps/web/tools/check-help-prerender.cjs
 */

const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const INDEX = path.join(WEB, 'src', 'content', 'help', 'index.ts');
const OUT = path.join(WEB, '.next', 'server', 'app', 'help');

const src = fs.readFileSync(INDEX, 'utf8');
const m = src.match(/const SLUG_ORDER = \[([\s\S]*?)\];/);
if (!m) {
  console.error('FATAL: SLUG_ORDER not found in content/help/index.ts');
  process.exit(1);
}
const slugs = [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
if (slugs.length < 10) {
  console.error(`FATAL: only ${slugs.length} help slugs parsed — parser drift, refusing to green-light.`);
  process.exit(1);
}

let failures = 0;
for (const slug of slugs) {
  const html = path.join(OUT, `${slug}.html`);
  if (!fs.existsSync(html)) {
    failures += 1;
    console.error(`FAIL: help article "${slug}" was not prerendered (${html} missing).`);
    continue;
  }
  const body = fs.readFileSync(html, 'utf8');
  if (body.includes('Article not found')) {
    failures += 1;
    console.error(`FAIL: help article "${slug}" prerendered as "Article not found" — the doc silently 404s.`);
  }
}

if (failures > 0) {
  console.error(`\nhelp-prerender gate: ${failures} broken article(s). Rebuild; if it persists, the article's frontmatter or slug registration is wrong.`);
  process.exit(1);
}
console.log(`help-prerender gate: all ${slugs.length} articles prerendered with real content.`);
